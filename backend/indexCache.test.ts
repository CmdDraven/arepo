import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { buildVaultIndex } from "./vaultFs.js";
import {
  getMachineIndex,
  getMachineIndexResult,
  MARKDOWN_SOURCE_DERIVATION_VERSION,
  machineIndexPath,
  MACHINE_INDEX_VERSION,
  rebuildMachineIndex,
  refreshMachineIndex,
  removeMachineIndexIfOwned,
  STRUCTURAL_INDEX_DERIVATION_VERSION,
  vaultRootHash,
  type MachineIndexOperationOptions,
  type StoredMachineIndex,
} from "./indexCache.js";
import { buildIndexFilterResponse } from "./indexFilters.js";
import { buildVaultInspectResponse } from "./indexInspect.js";
import { buildIndexSearchResponse } from "./indexSearch.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";

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
  await writeFile(rootPath, "data.json", '{"generic":"generic-json-cache-secret"}\n');
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

function materializeStoredResponse(stored: {
  sourceDerivations: { path: string; data: VaultIndexResponse["index"]["notes"][string] }[];
  globalData: {
    index: Omit<VaultIndexResponse["index"], "notes">;
    issues: VaultIndexResponse["issues"];
  };
}): VaultIndexResponse {
  return {
    index: {
      notes: Object.fromEntries(
        stored.sourceDerivations.map((source) => [source.path, source.data]),
      ),
      ...stored.globalData.index,
    },
    issues: stored.globalData.issues,
  };
}

type WorkCounts = {
  bodyReads: number;
  sourceDerivations: number;
  globalAssemblies: number;
  publications: number;
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function installHandleBodyReadInterceptor(
  sourcePath: string,
  afterRead: () => Promise<void>,
): () => void {
  const originalOpen = fs.open;
  fs.open = (async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (file === sourcePath) {
      const originalReadFile = handle.readFile.bind(handle);
      Object.defineProperty(handle, "readFile", {
        configurable: true,
        value: async () => {
          const body = (await originalReadFile()) as Buffer;
          await afterRead();
          return body;
        },
      });
    }
    return handle;
  }) as typeof fs.open;
  return () => {
    fs.open = originalOpen;
  };
}

function measureWork(): { counts: WorkCounts; options: MachineIndexOperationOptions } {
  const counts: WorkCounts = {
    bodyReads: 0,
    sourceDerivations: 0,
    globalAssemblies: 0,
    publications: 0,
  };
  return {
    counts,
    options: {
      instrumentation: {
        onMarkdownBodyRead: () => {
          counts.bodyReads += 1;
        },
        onSourceDerived: () => {
          counts.sourceDerivations += 1;
        },
        onGlobalAssembly: () => {
          counts.globalAssemblies += 1;
        },
        onPublication: () => {
          counts.publications += 1;
        },
      },
    },
  };
}

function measureBodyLifetime(maxConcurrentMarkdownReads = 2): {
  state: {
    liveBodies: number;
    liveBytes: number;
    peakBodies: number;
    peakBytes: number;
    retained: number;
    released: number;
  };
  options: MachineIndexOperationOptions;
} {
  const state = {
    liveBodies: 0,
    liveBytes: 0,
    peakBodies: 0,
    peakBytes: 0,
    retained: 0,
    released: 0,
  };
  return {
    state,
    options: {
      maxConcurrentMarkdownReads,
      instrumentation: {
        onMarkdownBodyRetained: (_path, bytes) => {
          state.liveBodies += 1;
          state.liveBytes += bytes;
          state.retained += 1;
          state.peakBodies = Math.max(state.peakBodies, state.liveBodies);
          state.peakBytes = Math.max(state.peakBytes, state.liveBytes);
        },
        onMarkdownBodyReleased: (_path, bytes) => {
          state.liveBodies -= 1;
          state.liveBytes -= bytes;
          state.released += 1;
        },
      },
    },
  };
}

test("concurrent machine index rebuilds do not leave a broken cache file", async (t) => {
  const { cwd, vault } = await makeVault(t);

  const results = await Promise.all(
    Array.from({ length: 20 }, () => rebuildMachineIndex(vault, cwd)),
  );

  const cacheFile = await machineIndexPath(vault, cwd);
  const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as StoredMachineIndex;
  const cacheDirFiles = await fs.readdir(path.dirname(cacheFile));

  assert.equal(
    results.every((result) => Object.keys(result.index.notes).length === 2),
    true,
  );
  assert.equal(stored.kind, "arepo.machineIndex");
  assert.equal(stored.sourceDerivations.length, 2);
  assert.equal(Object.hasOwn(stored.globalData.index, "notes"), false);
  assert.equal(cacheDirFiles.filter((file) => file.endsWith(".tmp")).length, 0);
});

test("partial structural indexes are published through the existing machine-index format", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const failedPath = path.join(vault.rootPath, "failed.md");
  await fs.writeFile(failedPath, "---\nid: failed\ntitle: Failed\n---\n# Failed\n", "utf8");
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === failedPath) {
      throw Object.assign(new Error("injected per-source read failure"), { code: "EIO" });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const data = await rebuildMachineIndex(vault, cwd);
  const cacheFile = await machineIndexPath(vault, cwd);
  const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as {
    kind: string;
    version: number;
    sourceDerivations: { path: string; data: (typeof data.index.notes)[string] }[];
    globalData: { index: Omit<typeof data.index, "notes">; issues: typeof data.issues };
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
  assert.equal(stored.version, MACHINE_INDEX_VERSION);
  assert.deepEqual(materializeStoredResponse(stored), JSON.parse(JSON.stringify(data)));
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

test("get creates a v5 cache with deterministic private validity metadata", async (t) => {
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
    sourceDerivations: {
      path: string;
      contentHash: string;
      derivationVersion: number;
      data: Record<string, unknown>;
    }[];
    globalData: { index: Record<string, unknown>; issues: unknown[] };
  };

  assert.equal(first.cacheStatus, "rebuilt");
  assert.equal(stored.version, MACHINE_INDEX_VERSION);
  assert.equal(stored.derivationVersion, STRUCTURAL_INDEX_DERIVATION_VERSION);
  assert.deepEqual(
    stored.sourceDerivations.map(({ path, derivationVersion }) => ({
      path,
      derivationVersion,
    })),
    [
      { path: "note.md", derivationVersion: MARKDOWN_SOURCE_DERIVATION_VERSION },
      { path: "other.md", derivationVersion: MARKDOWN_SOURCE_DERIVATION_VERSION },
    ],
  );
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
    "generic-json-cache-secret",
    "errno",
    "syscall",
    "stack",
  ]) {
    assert.equal(raw.includes(hidden), false, hidden);
  }
  assert.equal(Object.hasOwn(stored, "data"), false);
  assert.equal(Object.hasOwn(stored.globalData.index, "notes"), false);
  assert.equal(
    stored.sourceDerivations.some((derivative) => Object.hasOwn(derivative.data, "body")),
    false,
  );
});

test("v5 work counters prove cold, warm, changed, fallback, and force behavior", async (t) => {
  const { cwd, vault } = await makeVault(t);

  const cold = measureWork();
  await getMachineIndex(vault, cwd, cold.options);
  assert.deepEqual(cold.counts, {
    bodyReads: 2,
    sourceDerivations: 2,
    globalAssemblies: 1,
    publications: 1,
  });

  const warm = measureWork();
  await getMachineIndex(vault, cwd, warm.options);
  assert.deepEqual(warm.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 0,
    publications: 0,
  });

  await fs.writeFile(path.join(vault.rootPath, "note.md"), "# Changed\n\n[[other]]\n", "utf8");
  const changed = measureWork();
  const changedData = await getMachineIndex(vault, cwd, changed.options);
  assert.equal(changedData.index.notes["note.md"]?.title, "Changed");
  assert.deepEqual(changed.counts, {
    bodyReads: 2,
    sourceDerivations: 1,
    globalAssemblies: 1,
    publications: 1,
  });

  const noObservationFallback = measureWork();
  await getMachineIndex(vault, cwd, noObservationFallback.options);
  assert.deepEqual(noObservationFallback.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 0,
    publications: 0,
  });

  const forced = measureWork();
  await rebuildMachineIndex(vault, cwd, forced.options);
  assert.deepEqual(forced.counts, {
    bodyReads: 2,
    sourceDerivations: 2,
    globalAssemblies: 1,
    publications: 1,
  });
});

test("v5 warm hits materialize notes from derivatives without global assembly", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const cold = await getMachineIndex(vault, cwd);
  let materializations = 0;
  const warmWork = measureWork();
  warmWork.options.instrumentation!.onPublicResponseMaterialization = () => {
    materializations += 1;
  };

  const warm = await getMachineIndexResult(vault, cwd, warmWork.options);
  const stored = JSON.parse(
    await fs.readFile(await machineIndexPath(vault, cwd), "utf8"),
  ) as StoredMachineIndex & Record<string, unknown>;

  assert.equal(warm.cacheStatus, "hit");
  assert.deepEqual(warm.data, cold);
  assert.equal(materializations, 1);
  assert.equal(warmWork.counts.globalAssemblies, 0);
  assert.equal(warmWork.counts.sourceDerivations, 0);
  assert.equal(warmWork.counts.publications, 0);
  assert.equal(Object.hasOwn(stored, "data"), false);
  assert.equal(Object.hasOwn(stored.globalData.index, "notes"), false);
  assert.deepEqual(materializeStoredResponse(stored), cold);
});

test("v5 generated representation is deterministic apart from generatedAt", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const firstData = await rebuildMachineIndex(vault, cwd);
  const cacheFile = await machineIndexPath(vault, cwd);
  const first = JSON.parse(await fs.readFile(cacheFile, "utf8")) as StoredMachineIndex;
  const secondData = await rebuildMachineIndex(vault, cwd);
  const second = JSON.parse(await fs.readFile(cacheFile, "utf8")) as StoredMachineIndex;

  assert.deepEqual(secondData, firstData);
  assert.deepEqual(
    { ...second, generatedAt: "<generated>" },
    { ...first, generatedAt: "<generated>" },
  );
});

test("cold, warm, changed, and force operations release each canonical body promptly", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const runMeasured = async (
    operation: (options: MachineIndexOperationOptions) => Promise<unknown>,
  ) => {
    const measured = measureBodyLifetime();
    await operation(measured.options);
    assert.equal(measured.state.retained, 2);
    assert.equal(measured.state.released, 2);
    assert.equal(measured.state.liveBodies, 0);
    assert.equal(measured.state.liveBytes, 0);
    assert.ok(measured.state.peakBodies > 0);
    assert.ok(measured.state.peakBodies <= 2);
    assert.ok(measured.state.peakBytes < 1024);
  };

  await runMeasured((options) => getMachineIndex(vault, cwd, options));
  await runMeasured((options) => getMachineIndex(vault, cwd, options));
  await fs.writeFile(path.join(vault.rootPath, "note.md"), "# Changed\n\n[[other]]\n", "utf8");
  await runMeasured((options) => getMachineIndex(vault, cwd, options));
  await runMeasured((options) => rebuildMachineIndex(vault, cwd, options));
});

test("refresh reassembles globally while reusing unchanged source derivations", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getMachineIndex(vault, cwd);

  const measured = measureWork();
  const refreshed = await refreshMachineIndex(vault, cwd, measured.options);

  assert.equal(refreshed.index.notes["note.md"]?.title, "Note");
  assert.deepEqual(measured.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 1,
    publications: 1,
  });
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
  await writeFile(vault.rootPath, "data.json", '{"generic":"changed"}\n');
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

  const measured = measureWork();
  const second = await getMachineIndexResult(vault, cwd, measured.options);
  assert.equal(second.cacheStatus, "hit");
  assert.deepEqual(second.data, first);
  assert.equal(publicationAttempts, 0);
  assert.deepEqual(measured.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 0,
    publications: 0,
  });
});

test("content hashes invalidate same-size restored-mtime changes", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const notePath = path.join(vault.rootPath, "note.md");
  await fs.writeFile(notePath, "# Alpha\n", "utf8");
  const beforeStat = await fs.stat(notePath);
  assert.equal((await getMachineIndex(vault, cwd)).index.notes["note.md"]?.title, "Alpha");

  await fs.writeFile(notePath, "# Bravo\n", "utf8");
  await fs.utimes(notePath, beforeStat.atime, beforeStat.mtime);
  const measured = measureWork();
  const next = await getMachineIndexResult(vault, cwd, measured.options);

  assert.equal(next.cacheStatus, "rebuilt");
  assert.equal(next.data.index.notes["note.md"]?.title, "Bravo");
  assert.deepEqual(measured.counts, {
    bodyReads: 2,
    sourceDerivations: 1,
    globalAssemblies: 1,
    publications: 1,
  });
});

test("Markdown add, delete, and rename each invalidate the source inventory", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getMachineIndex(vault, cwd);

  await writeFile(vault.rootPath, "added.md", "# Added\n");
  const addWork = measureWork();
  const added = await getMachineIndexResult(vault, cwd, addWork.options);
  assert.equal(added.cacheStatus, "rebuilt");
  assert.ok(added.data.index.notes["added.md"]);
  assert.deepEqual(addWork.counts, {
    bodyReads: 3,
    sourceDerivations: 1,
    globalAssemblies: 1,
    publications: 1,
  });

  await fs.unlink(path.join(vault.rootPath, "other.md"));
  const deleteWork = measureWork();
  const deleted = await getMachineIndexResult(vault, cwd, deleteWork.options);
  assert.equal(deleted.cacheStatus, "rebuilt");
  assert.equal(deleted.data.index.notes["other.md"], undefined);
  assert.deepEqual(deleteWork.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 1,
    publications: 1,
  });

  await fs.rename(path.join(vault.rootPath, "added.md"), path.join(vault.rootPath, "renamed.md"));
  const renameWork = measureWork();
  const renamed = await getMachineIndexResult(vault, cwd, renameWork.options);
  assert.equal(renamed.cacheStatus, "rebuilt");
  assert.equal(renamed.data.index.notes["added.md"], undefined);
  assert.ok(renamed.data.index.notes["renamed.md"]);
  assert.deepEqual(renameWork.counts, {
    bodyReads: 2,
    sourceDerivations: 1,
    globalAssemblies: 1,
    publications: 1,
  });
});

test("multiple changed sources rederive only those sources", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await writeFile(vault.rootPath, "third.md", "# Third\n");
  await getMachineIndex(vault, cwd);
  await writeFile(vault.rootPath, "note.md", "# Note Changed\n");
  await writeFile(vault.rootPath, "other.md", "# Other Changed\n");

  const measured = measureWork();
  const result = await getMachineIndex(vault, cwd, measured.options);

  assert.equal(result.index.notes["note.md"]?.title, "Note Changed");
  assert.equal(result.index.notes["other.md"]?.title, "Other Changed");
  assert.deepEqual(measured.counts, {
    bodyReads: 3,
    sourceDerivations: 2,
    globalAssemblies: 1,
    publications: 1,
  });
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
  const excludedBodyWork = measureWork();
  assert.equal(
    (await getMachineIndexResult(rootOnly, cwd, excludedBodyWork.options)).cacheStatus,
    "hit",
  );
  assert.deepEqual(excludedBodyWork.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 0,
    publications: 0,
  });

  await writeFile(vault.rootPath, "nested/Second.md", "# Second\n");
  const membershipWork = measureWork();
  const membership = await getMachineIndexResult(rootOnly, cwd, membershipWork.options);
  assert.equal(membership.cacheStatus, "rebuilt");
  assert.deepEqual(membership.data.index.excludedPaths, ["nested/Hidden.md", "nested/Second.md"]);
  assert.deepEqual(membershipWork.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 1,
    publications: 1,
  });

  const allDepths: VaultInfo = {
    ...vault,
    vaultIndexScope: { markdown: { minDepth: 0, maxDepth: null } },
  };
  const changedScopeWork = measureWork();
  const changedScope = await getMachineIndexResult(allDepths, cwd, changedScopeWork.options);
  assert.equal(changedScope.cacheStatus, "rebuilt");
  assert.ok(changedScope.data.index.notes["nested/Hidden.md"]);
  assert.equal(changedScope.data.index.brokenLinks.length, 0);
  assert.deepEqual(changedScopeWork.counts, {
    bodyReads: 4,
    sourceDerivations: 2,
    globalAssemblies: 1,
    publications: 1,
  });

  const removedFromScopeWork = measureWork();
  const removedFromScope = await getMachineIndexResult(rootOnly, cwd, removedFromScopeWork.options);
  assert.equal(removedFromScope.data.index.notes["nested/Hidden.md"], undefined);
  assert.deepEqual(removedFromScopeWork.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 1,
    publications: 1,
  });
});

test("source readability transitions retry and never reuse stale source semantics", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const failedPath = path.join(vault.rootPath, "failed.md");
  await fs.writeFile(failedPath, "# Recoverable\n\n# Sensitive Heading\n", "utf8");
  assert.ok((await getMachineIndex(vault, cwd)).index.notes["failed.md"]);

  const originalOpen = fs.open;
  let failing = true;
  let failedReadAttempts = 0;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
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
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const unavailableWork = measureWork();
  const unavailable = await getMachineIndexResult(vault, cwd, unavailableWork.options);
  assert.equal(unavailable.cacheStatus, "rebuilt");
  assert.equal(unavailable.data.index.notes["failed.md"], undefined);
  assert.ok(
    unavailable.data.issues.some(
      (issue) => issue.kind === "source-unreadable" && issue.path === "failed.md",
    ),
  );
  assert.deepEqual(unavailableWork.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 1,
    publications: 1,
  });

  failedReadAttempts = 0;
  const stillUnavailableWork = measureWork();
  const stillUnavailable = await getMachineIndexResult(vault, cwd, stillUnavailableWork.options);
  assert.equal(stillUnavailable.cacheStatus, "hit");
  assert.equal(failedReadAttempts, 1);
  assert.equal(stillUnavailable.data.index.notes["failed.md"], undefined);
  assert.deepEqual(stillUnavailableWork.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 0,
    publications: 0,
  });

  failing = false;
  const recoveredWork = measureWork();
  const recovered = await getMachineIndexResult(vault, cwd, recoveredWork.options);
  assert.equal(recovered.cacheStatus, "rebuilt");
  assert.equal(recovered.data.index.notes["failed.md"]?.title, "Recoverable");
  assert.equal(
    recovered.data.issues.some((issue) => issue.kind === "source-unreadable"),
    false,
  );
  assert.deepEqual(recoveredWork.counts, {
    bodyReads: 3,
    sourceDerivations: 1,
    globalAssemblies: 1,
    publications: 1,
  });
});

test("multiple unavailable sources have deterministic bounded manifest and issue order", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const aPath = path.join(vault.rootPath, "a-failed.md");
  const zPath = path.join(vault.rootPath, "z-failed.md");
  await fs.writeFile(aPath, "# A secret body\n", "utf8");
  await fs.writeFile(zPath, "# Z secret body\n", "utf8");
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === aPath || file === zPath) {
      throw Object.assign(new Error(`EACCES: ${String(file)}`), { code: "EACCES" });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const data = await getMachineIndex(vault, cwd);
  const raw = await fs.readFile(await machineIndexPath(vault, cwd), "utf8");
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
    ["v3", (stored) => JSON.stringify({ ...stored, version: 3 })],
    ["v4", (stored) => JSON.stringify({ ...stored, version: 4 })],
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
    [
      "malformed global data",
      (stored) => JSON.stringify({ ...stored, globalData: { index: {}, issues: [] } }),
    ],
    [
      "global data containing notes",
      (stored) => {
        const globalData = stored.globalData as { index: Record<string, unknown> };
        return JSON.stringify({
          ...stored,
          globalData: { ...globalData, index: { ...globalData.index, notes: {} } },
        });
      },
    ],
    [
      "malformed global link",
      (stored) => {
        const globalData = stored.globalData as {
          index: Record<string, unknown>;
          issues: unknown[];
        };
        return JSON.stringify({
          ...stored,
          globalData: {
            ...globalData,
            index: { ...globalData.index, outgoingLinks: { "note.md": [{ target: 42 }] } },
          },
        });
      },
    ],
    [
      "malformed global issue",
      (stored) => {
        const globalData = stored.globalData as {
          index: Record<string, unknown>;
          issues: unknown[];
        };
        return JSON.stringify({
          ...stored,
          globalData: { ...globalData, issues: [{ kind: "missing-id", path: 42 }] },
        });
      },
    ],
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

test("source and global derivation versions invalidate only their semantic layer", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getMachineIndex(vault, cwd);
  const cacheFile = await machineIndexPath(vault, cwd);
  const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as {
    derivationVersion: number;
    sourceDerivations: { derivationVersion: number }[];
  };

  stored.sourceDerivations[0]!.derivationVersion = MARKDOWN_SOURCE_DERIVATION_VERSION + 1;
  await fs.writeFile(cacheFile, JSON.stringify(stored), "utf8");
  const sourceVersion = measureWork();
  await getMachineIndex(vault, cwd, sourceVersion.options);
  assert.deepEqual(sourceVersion.counts, {
    bodyReads: 2,
    sourceDerivations: 1,
    globalAssemblies: 1,
    publications: 1,
  });

  const globallyOld = JSON.parse(await fs.readFile(cacheFile, "utf8")) as {
    derivationVersion: number;
  };
  globallyOld.derivationVersion = STRUCTURAL_INDEX_DERIVATION_VERSION + 1;
  await fs.writeFile(cacheFile, JSON.stringify(globallyOld), "utf8");
  const globalVersion = measureWork();
  await getMachineIndex(vault, cwd, globalVersion.options);
  assert.deepEqual(globalVersion.counts, {
    bodyReads: 2,
    sourceDerivations: 0,
    globalAssemblies: 1,
    publications: 1,
  });
});

test("malformed source derivatives and v4 caches rederive safely", async (t) => {
  for (const cacheKind of ["malformed derivative", "v4"] as const) {
    await t.test(cacheKind, async (t) => {
      const { cwd, vault } = await makeVault(t);
      await getMachineIndex(vault, cwd);
      const cacheFile = await machineIndexPath(vault, cwd);
      const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as Record<string, unknown>;
      if (cacheKind === "v4") {
        stored.version = 4;
        delete stored.sourceDerivations;
      } else {
        const sourceDerivations = stored.sourceDerivations as {
          data: { title: unknown };
        }[];
        sourceDerivations[0]!.data.title = 42;
      }
      await fs.writeFile(cacheFile, JSON.stringify(stored), "utf8");

      const measured = measureWork();
      await getMachineIndex(vault, cwd, measured.options);
      assert.deepEqual(measured.counts, {
        bodyReads: 2,
        sourceDerivations: 2,
        globalAssemblies: 1,
        publications: 1,
      });
      assert.equal(
        (JSON.parse(await fs.readFile(cacheFile, "utf8")) as { version: number }).version,
        MACHINE_INDEX_VERSION,
      );
    });
  }
});

test("v1 through v4 owned generated files remain removable", async (t) => {
  for (const version of [1, 2, 3, 4]) {
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

test("direct, whole-hit, and partial-reuse public index/query behavior is equivalent", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const direct = JSON.parse(JSON.stringify(await buildVaultIndex(vault))) as Awaited<
    ReturnType<typeof buildVaultIndex>
  >;
  const initial = await getMachineIndex(vault, cwd);
  const wholeHit = await getMachineIndex(vault, cwd);
  assert.deepEqual(initial, direct);
  assert.deepEqual(wholeHit, direct);

  await writeFile(vault.rootPath, "note.md", "# Updated\n\n[[other]]\n");
  const directUpdated = JSON.parse(JSON.stringify(await buildVaultIndex(vault))) as typeof direct;
  const partial = await getMachineIndex(vault, cwd);
  assert.deepEqual(partial, directUpdated);
  for (const data of [directUpdated, partial]) {
    assert.deepEqual(
      buildIndexSearchResponse(data, "Updated"),
      buildIndexSearchResponse(directUpdated, "Updated"),
    );
    assert.deepEqual(
      buildIndexFilterResponse(data, "orphan-notes"),
      buildIndexFilterResponse(directUpdated, "orphan-notes"),
    );
    assert.deepEqual(
      buildVaultInspectResponse(data, "note.md"),
      buildVaultInspectResponse(directUpdated, "note.md"),
    );
  }
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

test("concurrent gets after one change single-flight derivation and publication", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getMachineIndex(vault, cwd);
  await fs.writeFile(path.join(vault.rootPath, "note.md"), "# Concurrent\n", "utf8");
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

  const measured = measureWork();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => getMachineIndexResult(vault, cwd, measured.options)),
  );
  assert.equal(results.filter((result) => result.cacheStatus === "rebuilt").length, 1);
  assert.equal(results.filter((result) => result.cacheStatus === "hit").length, 19);
  assert.equal(publications, 1);
  assert.equal(
    results.every((result) => result.data.index.notes["note.md"]?.title === "Concurrent"),
    true,
  );
  assert.deepEqual(measured.counts, {
    bodyReads: 40,
    sourceDerivations: 1,
    globalAssemblies: 1,
    publications: 1,
  });
});

test("serialized canonical verification rejects naive late-join single-flight semantics", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getMachineIndex(vault, cwd);
  const firstReadCaptured = deferred();
  const releaseFirstRead = deferred();
  let pauseNextNoteRead = true;
  let restoreOpen: () => void = () => undefined;
  t.after(() => {
    releaseFirstRead.resolve();
    restoreOpen();
  });
  const notePath = path.join(vault.rootPath, "note.md");
  restoreOpen = installHandleBodyReadInterceptor(notePath, async () => {
    if (pauseNextNoteRead) {
      pauseNextNoteRead = false;
      firstReadCaptured.resolve();
      await releaseFirstRead.promise;
    }
  });

  const serializedAWork = measureWork();
  const serializedBWork = measureWork();
  const serializedA = getMachineIndexResult(vault, cwd, {
    ...serializedAWork.options,
    maxConcurrentMarkdownReads: 1,
  });
  await firstReadCaptured.promise;
  await fs.writeFile(notePath, "# Changed After A Read\n", "utf8");
  const serializedB = getMachineIndexResult(vault, cwd, {
    ...serializedBWork.options,
    maxConcurrentMarkdownReads: 1,
  });
  releaseFirstRead.resolve();

  const [aResult, bResult] = await Promise.all([serializedA, serializedB]);
  restoreOpen();
  assert.equal(aResult.data.index.notes["note.md"]?.title, "Note");
  assert.equal(bResult.data.index.notes["note.md"]?.title, "Changed After A Read");
  assert.equal(serializedAWork.counts.bodyReads, 2);
  assert.equal(serializedBWork.counts.bodyReads, 2);

  await fs.writeFile(notePath, "# Note\n\nbody-only-cache-secret\n\n[[other]]\n", "utf8");
  await rebuildMachineIndex(vault, cwd);
  const naiveReadCaptured = deferred();
  const releaseNaiveRead = deferred();
  pauseNextNoteRead = true;
  restoreOpen = installHandleBodyReadInterceptor(notePath, async () => {
    if (pauseNextNoteRead) {
      pauseNextNoteRead = false;
      naiveReadCaptured.resolve();
      await releaseNaiveRead.promise;
    }
  });

  let inFlight:
    | Promise<ReturnType<typeof getMachineIndexResult> extends Promise<infer T> ? T : never>
    | undefined;
  const naiveSingleFlight = () => {
    if (inFlight) return inFlight;
    const operation = getMachineIndexResult(vault, cwd, {
      maxConcurrentMarkdownReads: 1,
    }).finally(() => {
      if (inFlight === operation) inFlight = undefined;
    });
    inFlight = operation;
    return operation;
  };

  const naiveA = naiveSingleFlight();
  await naiveReadCaptured.promise;
  await fs.writeFile(notePath, "# Changed After Naive A Read\n", "utf8");
  const naiveB = naiveSingleFlight();
  assert.equal(naiveB, naiveA);
  releaseNaiveRead.resolve();

  const [naiveAResult, naiveBResult] = await Promise.all([naiveA, naiveB]);
  restoreOpen();
  assert.equal(naiveAResult.data.index.notes["note.md"]?.title, "Note");
  assert.equal(naiveBResult.data.index.notes["note.md"]?.title, "Note");
  assert.equal(inFlight, undefined);
  const independentlyVerified = await getMachineIndexResult(vault, cwd, {
    maxConcurrentMarkdownReads: 1,
  });
  assert.equal(
    independentlyVerified.data.index.notes["note.md"]?.title,
    "Changed After Naive A Read",
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
  const stored = JSON.parse(
    await fs.readFile(await machineIndexPath(vault, cwd), "utf8"),
  ) as StoredMachineIndex;
  assert.equal(
    stored.sourceDerivations.find((source) => source.path === "note.md")?.data.title,
    "Current",
  );
});
