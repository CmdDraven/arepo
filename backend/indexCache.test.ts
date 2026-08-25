import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import {
  getMachineIndex,
  getMachineIndexResult,
  machineIndexPath,
  MACHINE_INDEX_VERSION,
  rebuildMachineIndex,
  removeMachineIndexIfOwned,
  STRUCTURAL_INDEX_DERIVATION_VERSION,
  vaultRootHash,
} from "./indexCache.js";
import { buildIndexFilterResponse } from "./indexFilters.js";
import { buildVaultInspectResponse } from "./indexInspect.js";
import { buildIndexSearchResponse } from "./indexSearch.js";
import type { VaultInfo } from "./types.js";

async function makeVault(t: TestContext): Promise<{ cwd: string; vault: VaultInfo }> {
  const cwd = await makeTestTempDir(t, "arepo-index-cache-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-index-cache-vault-");
  await writeFile(rootPath, "note.md", "# Note\n\nbody-only-cache-secret\n\n[[other]]\n");
  await writeFile(rootPath, "other.md", "# Other\n");
  await writeFile(rootPath, "plain.txt", "plain-text-cache-secret [[not-indexed]]\n");
  await writeFile(
    rootPath,
    "conversation.arepo-chat.json",
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"chat-cache-secret"},"messages":[]}\n',
  );
  return {
    cwd,
    vault: {
      id: "index-cache-test",
      displayName: "Index Cache Test",
      rootPath,
      permissions: {
        readIndex: true,
        readContent: true,
        writeContent: true,
        deleteFiles: false,
      },
    },
  };
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

test("concurrent machine index rebuilds do not leave a broken cache file", async (t) => {
  const { cwd, vault } = await makeVault(t);

  const results = await Promise.all(
    Array.from({ length: 20 }, () => rebuildMachineIndex(vault, cwd)),
  );

  const cacheFile = await machineIndexPath(vault, cwd);
  const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as {
    kind: string;
    data: { index: { notes: Record<string, unknown> } };
  };
  const cacheDirFiles = await fs.readdir(path.dirname(cacheFile));

  assert.equal(
    results.every((result) => Object.keys(result.index.notes).length === 2),
    true,
  );
  assert.equal(stored.kind, "arepo.machineIndex");
  assert.equal(Object.keys(stored.data.index.notes).length, 2);
  assert.equal(cacheDirFiles.filter((file) => file.endsWith(".tmp")).length, 0);
});

test("partial structural indexes are published through the existing machine-index format", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const failedPath = path.join(vault.rootPath, "failed.md");
  await fs.writeFile(failedPath, "---\nid: failed\ntitle: Failed\n---\n# Failed\n", "utf8");
  const originalReadFile = fs.readFile;
  t.after(() => {
    fs.readFile = originalReadFile;
  });
  fs.readFile = (async (file, ...args) => {
    if (file === failedPath) {
      throw Object.assign(new Error("injected per-source read failure"), { code: "EIO" });
    }
    return originalReadFile(file, ...args);
  }) as typeof fs.readFile;

  const data = await rebuildMachineIndex(vault, cwd);
  const cacheFile = await machineIndexPath(vault, cwd);
  const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as {
    kind: string;
    version: number;
    data: typeof data;
  };

  assert.equal(data.index.notes["failed.md"], undefined);
  assert.deepEqual(Object.keys(data.index.notes), ["note.md", "other.md"]);
  assert.deepEqual(
    data.issues.filter((issue) => issue.kind === "source-unreadable"),
    [
      {
        kind: "source-unreadable",
        path: "failed.md",
        message: "Source file could not be read.",
        severity: "error",
      },
    ],
  );
  assert.equal(stored.kind, "arepo.machineIndex");
  assert.equal(stored.version, 3);
  assert.deepEqual(stored.data, JSON.parse(JSON.stringify(data)));
});

test("machine-index publication failures remain global", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const blockedAppDataPath = path.join(cwd, "app-data-file");
  await fs.writeFile(blockedAppDataPath, "not a directory", "utf8");
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: { nodeId: "local", displayName: "Local Node", mode: "local", apiVersion: 1 },
      appDataDir: blockedAppDataPath,
      vaults: [],
    }),
    "utf8",
  );

  await assert.rejects(() => rebuildMachineIndex(vault, cwd));
});

test("get cache misses do not hide publication failures", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const blockedAppDataPath = path.join(cwd, "blocked-app-data");
  await fs.writeFile(blockedAppDataPath, "not a directory", "utf8");
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: { nodeId: "local", displayName: "Local Node", mode: "local", apiVersion: 1 },
      appDataDir: blockedAppDataPath,
      vaults: [],
    }),
    "utf8",
  );

  await assert.rejects(() => getMachineIndex(vault, cwd));
});

test("get creates a v3 cache with deterministic private validity metadata", async (t) => {
  const { cwd, vault } = await makeVault(t);

  const first = await getMachineIndexResult(vault, cwd);
  const cacheFile = await machineIndexPath(vault, cwd);
  const raw = await fs.readFile(cacheFile, "utf8");
  const stored = JSON.parse(raw) as {
    version: number;
    derivationVersion: number;
    manifest: {
      scope: unknown;
      sources: { path: string; state: string; contentHash?: string }[];
    };
    data: { index: { notes: Record<string, Record<string, unknown>> } };
  };

  assert.equal(first.cacheStatus, "rebuilt");
  assert.equal(stored.version, MACHINE_INDEX_VERSION);
  assert.equal(stored.derivationVersion, STRUCTURAL_INDEX_DERIVATION_VERSION);
  assert.deepEqual(
    stored.manifest.sources.map(({ path, state }) => ({ path, state })),
    [
      { path: "note.md", state: "readable" },
      { path: "other.md", state: "readable" },
    ],
  );
  assert.equal(
    stored.manifest.sources.every((source) => source.contentHash?.length === 64),
    true,
  );
  for (const hidden of [
    vault.rootPath,
    "body-only-cache-secret",
    "plain-text-cache-secret",
    "chat-cache-secret",
    "errno",
    "syscall",
    "stack",
  ]) {
    assert.equal(raw.includes(hidden), false, hidden);
  }
  assert.equal(Object.hasOwn(stored.data.index.notes, "plain.txt"), false);
  assert.equal(Object.hasOwn(stored.data.index.notes, "conversation.arepo-chat.json"), false);
  assert.equal(
    Object.values(stored.data.index.notes).some((note) => Object.hasOwn(note, "body")),
    false,
  );
});

test("unchanged, metadata-only, and non-structural changes reuse without publication", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const first = await getMachineIndex(vault, cwd);
  const cacheFile = await machineIndexPath(vault, cwd);
  const notePath = path.join(vault.rootPath, "note.md");
  const noteStat = await fs.stat(notePath);
  await fs.utimes(notePath, new Date(noteStat.atimeMs + 5_000), new Date(noteStat.mtimeMs + 5_000));
  await writeFile(vault.rootPath, "plain.txt", "changed plain text\n");
  await writeFile(
    vault.rootPath,
    "conversation.arepo-chat.json",
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"changed"},"messages":[]}\n',
  );
  await writeFile(vault.rootPath, "image.bin", "changed attachment\n");

  const originalRename = fs.rename;
  let publicationAttempts = 0;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (to === cacheFile) {
      publicationAttempts += 1;
      throw Object.assign(new Error("publication must not run"), { code: "EACCES" });
    }
    return originalRename(from, to);
  }) as typeof fs.rename;

  const second = await getMachineIndexResult(vault, cwd);
  assert.equal(second.cacheStatus, "hit");
  assert.deepEqual(second.data, first);
  assert.equal(publicationAttempts, 0);
});

test("content hashes invalidate same-size restored-mtime changes", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const notePath = path.join(vault.rootPath, "note.md");
  await fs.writeFile(notePath, "# Alpha\n", "utf8");
  const beforeStat = await fs.stat(notePath);
  assert.equal((await getMachineIndex(vault, cwd)).index.notes["note.md"]?.title, "Alpha");

  await fs.writeFile(notePath, "# Bravo\n", "utf8");
  await fs.utimes(notePath, beforeStat.atime, beforeStat.mtime);
  const next = await getMachineIndexResult(vault, cwd);

  assert.equal(next.cacheStatus, "rebuilt");
  assert.equal(next.data.index.notes["note.md"]?.title, "Bravo");
});

test("Markdown add, delete, and rename each invalidate the source inventory", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getMachineIndex(vault, cwd);

  await writeFile(vault.rootPath, "added.md", "# Added\n");
  const added = await getMachineIndexResult(vault, cwd);
  assert.equal(added.cacheStatus, "rebuilt");
  assert.ok(added.data.index.notes["added.md"]);

  await fs.unlink(path.join(vault.rootPath, "other.md"));
  const deleted = await getMachineIndexResult(vault, cwd);
  assert.equal(deleted.cacheStatus, "rebuilt");
  assert.equal(deleted.data.index.notes["other.md"], undefined);

  await fs.rename(path.join(vault.rootPath, "added.md"), path.join(vault.rootPath, "renamed.md"));
  const renamed = await getMachineIndexResult(vault, cwd);
  assert.equal(renamed.cacheStatus, "rebuilt");
  assert.equal(renamed.data.index.notes["added.md"], undefined);
  assert.ok(renamed.data.index.notes["renamed.md"]);
});

test("scope and excluded membership invalidate while excluded bodies do not", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await writeFile(vault.rootPath, "note.md", "# Note\n\n[[Hidden]]\n");
  await writeFile(vault.rootPath, "nested/Hidden.md", "# Hidden One\n");
  const rootOnly: VaultInfo = {
    ...vault,
    vaultIndexScope: { markdown: { minDepth: 0, maxDepth: 0 } },
  };
  const initial = await getMachineIndexResult(rootOnly, cwd);
  assert.equal(initial.data.index.brokenLinks[0]?.status, "excluded-by-index-scope");

  await writeFile(vault.rootPath, "nested/Hidden.md", "# Totally Different Hidden Body\n");
  assert.equal((await getMachineIndexResult(rootOnly, cwd)).cacheStatus, "hit");

  await writeFile(vault.rootPath, "nested/Second.md", "# Second\n");
  const membership = await getMachineIndexResult(rootOnly, cwd);
  assert.equal(membership.cacheStatus, "rebuilt");
  assert.deepEqual(membership.data.index.excludedPaths, ["nested/Hidden.md", "nested/Second.md"]);

  const allDepths: VaultInfo = {
    ...vault,
    vaultIndexScope: { markdown: { minDepth: 0, maxDepth: null } },
  };
  const changedScope = await getMachineIndexResult(allDepths, cwd);
  assert.equal(changedScope.cacheStatus, "rebuilt");
  assert.ok(changedScope.data.index.notes["nested/Hidden.md"]);
  assert.equal(changedScope.data.index.brokenLinks.length, 0);
});

test("source readability transitions retry and never reuse stale source semantics", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const failedPath = path.join(vault.rootPath, "failed.md");
  await fs.writeFile(failedPath, "# Recoverable\n\n# Sensitive Heading\n", "utf8");
  assert.ok((await getMachineIndex(vault, cwd)).index.notes["failed.md"]);

  const originalReadFile = fs.readFile;
  let failing = true;
  let failedReadAttempts = 0;
  t.after(() => {
    fs.readFile = originalReadFile;
  });
  fs.readFile = (async (file, ...args) => {
    if (file === failedPath) {
      failedReadAttempts += 1;
      if (failing) {
        throw Object.assign(new Error("EACCES: open '/private/example/secret.md'"), {
          code: "EACCES",
          syscall: "open",
          path: "/private/example/secret.md",
        });
      }
    }
    return originalReadFile(file, ...args);
  }) as typeof fs.readFile;

  const unavailable = await getMachineIndexResult(vault, cwd);
  assert.equal(unavailable.cacheStatus, "rebuilt");
  assert.equal(unavailable.data.index.notes["failed.md"], undefined);
  assert.ok(
    unavailable.data.issues.some(
      (issue) => issue.kind === "source-unreadable" && issue.path === "failed.md",
    ),
  );

  failedReadAttempts = 0;
  const stillUnavailable = await getMachineIndexResult(vault, cwd);
  assert.equal(stillUnavailable.cacheStatus, "hit");
  assert.equal(failedReadAttempts, 1);
  assert.equal(stillUnavailable.data.index.notes["failed.md"], undefined);

  failing = false;
  const recovered = await getMachineIndexResult(vault, cwd);
  assert.equal(recovered.cacheStatus, "rebuilt");
  assert.equal(recovered.data.index.notes["failed.md"]?.title, "Recoverable");
  assert.equal(
    recovered.data.issues.some((issue) => issue.kind === "source-unreadable"),
    false,
  );
});

test("multiple unavailable sources have deterministic bounded manifest and issue order", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const aPath = path.join(vault.rootPath, "a-failed.md");
  const zPath = path.join(vault.rootPath, "z-failed.md");
  await fs.writeFile(aPath, "# A secret body\n", "utf8");
  await fs.writeFile(zPath, "# Z secret body\n", "utf8");
  const originalReadFile = fs.readFile;
  t.after(() => {
    fs.readFile = originalReadFile;
  });
  fs.readFile = (async (file, ...args) => {
    if (file === aPath || file === zPath) {
      throw Object.assign(new Error(`EACCES: ${String(file)}`), { code: "EACCES" });
    }
    return originalReadFile(file, ...args);
  }) as typeof fs.readFile;

  const data = await getMachineIndex(vault, cwd);
  const raw = await originalReadFile(await machineIndexPath(vault, cwd), "utf8");
  const stored = JSON.parse(raw) as {
    manifest: { sources: { path: string; state: string }[] };
  };
  assert.deepEqual(
    data.issues.filter((issue) => issue.kind === "source-unreadable").map((issue) => issue.path),
    ["a-failed.md", "z-failed.md"],
  );
  assert.deepEqual(
    stored.manifest.sources.filter((source) => source.state === "unavailable"),
    [
      { path: "a-failed.md", state: "unavailable" },
      { path: "z-failed.md", state: "unavailable" },
    ],
  );
  for (const hidden of [vault.rootPath, "EACCES", "secret body", "errno", "syscall", "stack"]) {
    assert.equal(raw.includes(hidden), false, hidden);
  }
});

test("legacy, mismatched, and malformed generated caches rebuild safely", async (t) => {
  const cases: [string, (stored: Record<string, unknown>) => string][] = [
    ["v1", (stored) => JSON.stringify({ ...stored, version: 1 })],
    ["v2", (stored) => JSON.stringify({ ...stored, version: 2 })],
    [
      "derivation",
      (stored) =>
        JSON.stringify({
          ...stored,
          derivationVersion: STRUCTURAL_INDEX_DERIVATION_VERSION + 1,
        }),
    ],
    [
      "vault id",
      (stored) =>
        JSON.stringify({
          ...stored,
          vault: { ...(stored.vault as Record<string, unknown>), id: "wrong" },
        }),
    ],
    [
      "root",
      (stored) =>
        JSON.stringify({
          ...stored,
          vault: { ...(stored.vault as Record<string, unknown>), rootPathHash: "wrong" },
        }),
    ],
    [
      "scope",
      (stored) =>
        JSON.stringify({
          ...stored,
          manifest: {
            ...(stored.manifest as Record<string, unknown>),
            scope: { markdown: { minDepth: 0, maxDepth: 0 } },
          },
        }),
    ],
    ["malformed JSON", () => "{not-json"],
    ["malformed data", (stored) => JSON.stringify({ ...stored, data: { index: {} } })],
  ];

  for (const [label, mutate] of cases) {
    await t.test(label, async (t) => {
      const { cwd, vault } = await makeVault(t);
      await getMachineIndex(vault, cwd);
      const cacheFile = await machineIndexPath(vault, cwd);
      const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as Record<string, unknown>;
      await fs.writeFile(cacheFile, mutate(stored), "utf8");
      const result = await getMachineIndexResult(vault, cwd);
      assert.equal(result.cacheStatus, "rebuilt");
      assert.equal(
        (JSON.parse(await fs.readFile(cacheFile, "utf8")) as { version: number }).version,
        MACHINE_INDEX_VERSION,
      );
    });
  }
});

test("v1 and v2 owned generated files remain removable", async (t) => {
  for (const version of [1, 2]) {
    await t.test(`v${version}`, async (t) => {
      const { cwd, vault } = await makeVault(t);
      const file = await machineIndexPath(vault, cwd);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(
        file,
        JSON.stringify({
          kind: "arepo.machineIndex",
          version,
          vault: { id: vault.id, rootPathHash: await vaultRootHash(vault) },
        }),
        "utf8",
      );
      assert.deepEqual((await removeMachineIndexIfOwned(vault, cwd)).deletedPaths, [file]);
    });
  }
});

test("non-ENOENT generated-cache read failures remain global", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getMachineIndex(vault, cwd);
  const cacheFile = await machineIndexPath(vault, cwd);
  const originalReadFile = fs.readFile;
  t.after(() => {
    fs.readFile = originalReadFile;
  });
  fs.readFile = (async (file, ...args) => {
    if (file === cacheFile) {
      throw Object.assign(new Error("EMFILE reading generated cache"), { code: "EMFILE" });
    }
    return originalReadFile(file, ...args);
  }) as typeof fs.readFile;

  await assert.rejects(() => getMachineIndex(vault, cwd), /EMFILE/);
});

test("cache hits enforce readIndex permission and preserve query behavior", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const rebuilt = await getMachineIndex(vault, cwd);
  const cached = await getMachineIndex(vault, cwd);
  assert.deepEqual(
    buildIndexSearchResponse(cached, "Note"),
    buildIndexSearchResponse(rebuilt, "Note"),
  );
  assert.deepEqual(
    buildIndexFilterResponse(cached, "orphan-notes"),
    buildIndexFilterResponse(rebuilt, "orphan-notes"),
  );
  assert.deepEqual(
    buildVaultInspectResponse(cached, "note.md"),
    buildVaultInspectResponse(rebuilt, "note.md"),
  );

  const denied: VaultInfo = {
    ...vault,
    permissions: { ...vault.permissions, readIndex: false },
  };
  await assert.rejects(() => getMachineIndex(denied, cwd), /Vault index is not readable/);
});

test("force rebuild publishes even when the cache is valid", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getMachineIndex(vault, cwd);
  const cacheFile = await machineIndexPath(vault, cwd);
  const originalRename = fs.rename;
  let attempts = 0;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (to === cacheFile) {
      attempts += 1;
      throw new Error("forced publication failure");
    }
    return originalRename(from, to);
  }) as typeof fs.rename;

  assert.equal((await getMachineIndexResult(vault, cwd)).cacheStatus, "hit");
  await assert.rejects(() => rebuildMachineIndex(vault, cwd), /forced publication failure/);
  assert.equal(attempts, 1);
});

test("concurrent get misses single-flight publication and return coherent data", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const cacheFile = await machineIndexPath(vault, cwd);
  const originalRename = fs.rename;
  let publications = 0;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (to === cacheFile) publications += 1;
    return originalRename(from, to);
  }) as typeof fs.rename;

  const results = await Promise.all(
    Array.from({ length: 20 }, () => getMachineIndexResult(vault, cwd)),
  );
  assert.equal(results.filter((result) => result.cacheStatus === "rebuilt").length, 1);
  assert.equal(results.filter((result) => result.cacheStatus === "hit").length, 19);
  assert.equal(publications, 1);
  assert.equal(
    results.every((result) => result.data.index.notes["note.md"]?.title === "Note"),
    true,
  );
});

test("concurrent force rebuild and get serialize without stale publication", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getMachineIndex(vault, cwd);
  await fs.writeFile(path.join(vault.rootPath, "note.md"), "# Current\n", "utf8");

  const [forced, retrieved] = await Promise.all([
    rebuildMachineIndex(vault, cwd),
    getMachineIndexResult(vault, cwd),
  ]);
  assert.equal(forced.index.notes["note.md"]?.title, "Current");
  assert.equal(retrieved.cacheStatus, "hit");
  assert.equal(retrieved.data.index.notes["note.md"]?.title, "Current");
  const stored = JSON.parse(await fs.readFile(await machineIndexPath(vault, cwd), "utf8")) as {
    data: typeof forced;
  };
  assert.equal(stored.data.index.notes["note.md"]?.title, "Current");
});
