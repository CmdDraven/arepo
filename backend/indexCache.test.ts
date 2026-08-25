import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { buildVaultIndex } from "./vaultFs.js";
import { machineIndexPath, rebuildMachineIndex, writeMachineIndex } from "./indexCache.js";
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

test("machine index cache writes tolerate concurrent writes to the same vault", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const data = await buildVaultIndex(vault);

  await Promise.all(Array.from({ length: 40 }, () => writeMachineIndex(vault, data, cwd)));

  const cacheFile = await machineIndexPath(vault, cwd);
  const raw = await fs.readFile(cacheFile, "utf8");
  const stored = JSON.parse(raw) as {
    kind: string;
    version: number;
    data: { index: { notes: Record<string, Record<string, unknown>> } };
  };
  const cacheDirFiles = await fs.readdir(path.dirname(cacheFile));

  assert.equal(stored.kind, "arepo.machineIndex");
  assert.equal(stored.version, 2);
  assert.equal(raw.includes("body-only-cache-secret"), false);
  assert.equal(raw.includes("plain-text-cache-secret"), false);
  assert.equal(raw.includes("chat-cache-secret"), false);
  assert.equal(Object.hasOwn(stored.data.index.notes, "plain.txt"), false);
  assert.equal(Object.hasOwn(stored.data.index.notes, "conversation.arepo-chat.json"), false);
  assert.equal(
    Object.values(stored.data.index.notes).some((note) => Object.hasOwn(note, "body")),
    false,
  );
  assert.equal(cacheDirFiles.filter((file) => file.endsWith(".tmp")).length, 0);
});

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
  assert.equal(stored.version, 2);
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
