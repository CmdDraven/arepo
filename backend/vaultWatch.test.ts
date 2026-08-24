import test from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { rebuildMachineIndex } from "./indexCache.js";
import { hashContent, readVaultFile } from "./vaultFs.js";
import {
  beginVaultIndexBuild,
  getVaultRuntimeStatus,
  NewestSourceRebuildQueue,
  recordVaultIndexed,
  recordVaultMutation,
  stopVaultWatcher,
} from "./vaultWatch.js";
import type { VaultInfo } from "./types.js";

function testVault(rootPath: string, id: string): VaultInfo {
  return {
    id,
    displayName: "Watcher test vault",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
    vaultIndexScope: { markdown: { minDepth: 0, maxDepth: null } },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("watcher fingerprints detect same-size content with restored mtime", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const absolutePath = path.join(rootPath, "note.md");
  const beforeContent = "# Alpha\n";
  const afterContent = "# Bravo\n";
  assert.equal(Buffer.byteLength(beforeContent), Buffer.byteLength(afterContent));
  await fs.writeFile(absolutePath, beforeContent, "utf8");
  const vault = testVault(rootPath, "same-metadata-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  const initial = await getVaultRuntimeStatus(vault, cwd, "note.md");
  const initialStat = await fs.stat(absolutePath);
  assert.equal(initial.changedExternally, false);
  assert.equal(initial.file?.hash, hashContent(beforeContent));
  assert.equal((await readVaultFile(vault, "note.md")).hash, hashContent(beforeContent));

  await fs.writeFile(absolutePath, afterContent, "utf8");
  await fs.utimes(absolutePath, initialStat.atime, initialStat.mtime);
  const restoredStat = await fs.stat(absolutePath);
  assert.ok(Math.abs(restoredStat.mtimeMs - initialStat.mtimeMs) < 1);
  assert.equal(restoredStat.size, initialStat.size);

  const changed = await getVaultRuntimeStatus(vault, cwd, "note.md");
  assert.equal(changed.changedExternally, true);
  assert.equal(changed.indexStatus, "stale");
  assert.deepEqual(changed.changedPaths, ["note.md"]);
  assert.equal(changed.file?.changedExternally, true);
  assert.equal(changed.file?.hash, hashContent(afterContent));
});

test("watcher fingerprints ignore metadata-only changes with identical content", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const absolutePath = path.join(rootPath, "note.md");
  await fs.writeFile(absolutePath, "# Note\n", "utf8");
  const vault = testVault(rootPath, "metadata-only-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await getVaultRuntimeStatus(vault, cwd);
  const initialStat = await fs.stat(absolutePath);
  await fs.utimes(
    absolutePath,
    new Date(initialStat.atimeMs + 2_000),
    new Date(initialStat.mtimeMs + 2_000),
  );

  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.changedExternally, false);
  assert.equal(status.indexStatus, "fresh");
  assert.deepEqual(status.changedPaths, []);
});

test("watcher preserves create, rename, and delete observation", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  await fs.writeFile(path.join(rootPath, "original.md"), "# Original\n", "utf8");
  const vault = testVault(rootPath, "lifecycle-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await getVaultRuntimeStatus(vault, cwd);
  await fs.writeFile(path.join(rootPath, "added.md"), "# Added\n", "utf8");
  const added = await getVaultRuntimeStatus(vault, cwd);
  assert.ok(added.addedPaths.includes("added.md"));

  await fs.rename(path.join(rootPath, "added.md"), path.join(rootPath, "renamed.md"));
  const renamed = await getVaultRuntimeStatus(vault, cwd);
  assert.ok(renamed.deletedPaths.includes("added.md"));
  assert.ok(renamed.addedPaths.includes("renamed.md"));

  await fs.unlink(path.join(rootPath, "original.md"));
  const deleted = await getVaultRuntimeStatus(vault, cwd, "original.md");
  assert.ok(deleted.deletedPaths.includes("original.md"));
  assert.equal(deleted.file?.exists, false);
  assert.equal(deleted.file?.deletedExternally, true);
});

test("overlapping reconciliations commit source snapshots in request order", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const notePath = path.join(rootPath, "note.md");
  const addedPath = path.join(rootPath, "added.md");
  await fs.writeFile(notePath, "# Alpha\n", "utf8");
  const vault = testVault(rootPath, "reconciliation-order-vault");
  const originalReadFile = fs.readFile;
  const firstSnapshotCaptured = deferred();
  const releaseFirstSnapshot = deferred();
  let noteReads = 0;
  t.after(() => {
    fs.readFile = originalReadFile;
    stopVaultWatcher(cwd, vault.id);
  });
  await getVaultRuntimeStatus(vault, cwd);

  fs.readFile = (async (file, ...args) => {
    if (file === notePath) {
      const captured = await originalReadFile(file, ...args);
      noteReads += 1;
      if (noteReads === 1) {
        firstSnapshotCaptured.resolve();
        await releaseFirstSnapshot.promise;
      }
      return captured;
    }
    return originalReadFile(file, ...args);
  }) as typeof fs.readFile;

  const older = getVaultRuntimeStatus(vault, cwd);
  await firstSnapshotCaptured.promise;
  await fs.writeFile(notePath, "# Bravo\n", "utf8");
  await fs.writeFile(addedPath, "# Added\n", "utf8");
  const newer = getVaultRuntimeStatus(vault, cwd);
  await nextTurn();
  assert.equal(noteReads, 1);

  releaseFirstSnapshot.resolve();
  await Promise.all([older, newer]);
  assert.equal(noteReads, 2);

  await fs.unlink(addedPath);
  const afterDelete = await getVaultRuntimeStatus(vault, cwd, "note.md");
  assert.ok(afterDelete.changedPaths.includes("note.md"));
  assert.ok(afterDelete.deletedPaths.includes("added.md"));
  assert.equal(afterDelete.addedPaths.includes("added.md"), false);
  assert.equal(afterDelete.file?.hash, hashContent("# Bravo\n"));
});

test("plain-text and chat fingerprints remain observable without staling Markdown", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const textPath = path.join(rootPath, "plain.txt");
  const chatPath = path.join(rootPath, "conversation.arepo-chat.json");
  const chatBefore =
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"alpha"},"messages":[]}\n';
  const chatAfter =
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"bravo"},"messages":[]}\n';
  await fs.writeFile(textPath, "alpha\n", "utf8");
  await fs.writeFile(chatPath, chatBefore, "utf8");
  const vault = testVault(rootPath, "read-only-sources-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await getVaultRuntimeStatus(vault, cwd);
  const textStat = await fs.stat(textPath);
  const chatStat = await fs.stat(chatPath);
  await fs.writeFile(textPath, "bravo\n", "utf8");
  await fs.writeFile(chatPath, chatAfter, "utf8");
  await fs.utimes(textPath, textStat.atime, textStat.mtime);
  await fs.utimes(chatPath, chatStat.atime, chatStat.mtime);

  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "fresh");
  assert.deepEqual(status.changedPaths, ["conversation.arepo-chat.json", "plain.txt"]);
});

test("newest-source rebuild queue serializes publication and coalesces rapid generations", async (t) => {
  const directory = await makeTestTempDir(t, "arepo-watch-order-");
  const publishedPath = path.join(directory, "published.txt");
  const firstStarted = deferred();
  const newestStarted = deferred();
  const releaseFirst = deferred();
  const releaseNewest = deferred();
  const starts: number[] = [];
  let active = 0;
  let maxActive = 0;

  const queue = new NewestSourceRebuildQueue(async (generation) => {
    starts.push(generation);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (generation === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    } else {
      newestStarted.resolve();
      await releaseNewest.promise;
    }
    await fs.writeFile(publishedPath, String(generation), "utf8");
    active -= 1;
  });

  const first = queue.request(1);
  await firstStarted.promise;
  const second = queue.request(2);
  const newest = queue.request(3);
  assert.deepEqual(starts, [1]);

  releaseFirst.resolve();
  await newestStarted.promise;
  assert.deepEqual(starts, [1, 3]);
  releaseNewest.resolve();
  await Promise.all([first, second, newest]);

  assert.equal(maxActive, 1);
  assert.deepEqual(starts, [1, 3]);
  assert.equal(await fs.readFile(publishedPath, "utf8"), "3");
});

test("explicit index completion cannot absorb a source edit made during its build", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const appDataDir = await makeTestTempDir(t, "arepo-watch-data-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const notePath = path.join(rootPath, "note.md");
  await fs.writeFile(notePath, "# Alpha\n", "utf8");
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: { nodeId: "local", displayName: "Local Node", mode: "local", apiVersion: 1 },
      appDataDir,
      vaults: [],
    }),
    "utf8",
  );
  const vault = testVault(rootPath, "explicit-index-race-vault");
  const originalReadFile = fs.readFile;
  const buildCapturedSource = deferred();
  const releaseBuild = deferred();
  let interceptBuildRead = true;
  t.after(() => {
    fs.readFile = originalReadFile;
    stopVaultWatcher(cwd, vault.id);
  });

  await getVaultRuntimeStatus(vault, cwd);
  const observation = await beginVaultIndexBuild(vault, cwd);
  fs.readFile = (async (file, ...args) => {
    if (file === notePath && interceptBuildRead) {
      interceptBuildRead = false;
      const captured = await originalReadFile(file, ...args);
      buildCapturedSource.resolve();
      await releaseBuild.promise;
      return captured;
    }
    return originalReadFile(file, ...args);
  }) as typeof fs.readFile;

  const building = rebuildMachineIndex(vault, cwd);
  await buildCapturedSource.promise;
  await fs.writeFile(notePath, "# Bravo\n", "utf8");
  releaseBuild.resolve();
  const built = await building;
  assert.equal(built.index.notes["note.md"]?.title, "Alpha");

  await recordVaultIndexed(vault, observation, cwd);
  const status = await getVaultRuntimeStatus(vault, cwd, "note.md");
  assert.equal(status.indexStatus, "stale");
  assert.ok(status.changedPaths.includes("note.md"));
  assert.equal(status.file?.hash, hashContent("# Bravo\n"));
});

test("vault runtime status bounds path-bearing rescan failures", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const absolutePath = path.join(rootPath, "note.md");
  await fs.writeFile(absolutePath, "# Note\n", "utf8");
  const vault = testVault(rootPath, "rescan-error-vault");
  const originalReadFile = fs.readFile;
  t.after(() => {
    fs.readFile = originalReadFile;
    stopVaultWatcher(cwd, vault.id);
  });
  await getVaultRuntimeStatus(vault, cwd);

  const sensitivePath = "/private/example/watcher-secret.md";
  fs.readFile = (async (file, ...args) => {
    if (file === absolutePath) {
      throw Object.assign(new Error(`EACCES: permission denied, open '${sensitivePath}'`), {
        code: "EACCES",
        syscall: "open",
        path: sensitivePath,
      });
    }
    return originalReadFile(file, ...args);
  }) as typeof fs.readFile;

  const status = await getVaultRuntimeStatus(vault, cwd, "note.md");
  assert.equal(status.indexStatus, "error");
  assert.equal(status.error, "Vault rescan failed.");
  assert.equal(status.file, undefined);
  const serialized = JSON.stringify(status);
  for (const hidden of [sensitivePath, "EACCES", "permission denied", "syscall", "open '"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test("vault runtime status bounds path-bearing rebuild failures", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const blockedAppDataPath = path.join(cwd, "private-secret-app-data");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
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
  const vault = testVault(rootPath, "rebuild-error-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await getVaultRuntimeStatus(vault, cwd);
  await recordVaultMutation(vault, cwd);
  let status = await getVaultRuntimeStatus(vault, cwd);
  for (let attempt = 0; attempt < 50 && status.error === undefined; attempt += 1) {
    await nextTurn();
    status = await getVaultRuntimeStatus(vault, cwd);
  }

  assert.equal(status.indexStatus, "error");
  assert.equal(status.error, "Machine index rebuild failed.");
  const serialized = JSON.stringify(status);
  for (const hidden of [blockedAppDataPath, "ENOTDIR", "not a directory", "mkdir", "stack"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test("vault runtime status bounds watcher filesystem failures", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  const vault: VaultInfo = {
    id: "watcher-error-vault",
    displayName: "Watcher error vault",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
    vaultIndexScope: { markdown: { minDepth: 0, maxDepth: null } },
  };
  const originalWatch = fsSync.watch;
  const sensitivePath = "/private/example/watcher-secret.md";
  t.after(() => {
    fsSync.watch = originalWatch;
    stopVaultWatcher(cwd, vault.id);
  });
  fsSync.watch = (() => {
    throw Object.assign(new Error(`EACCES: permission denied, watch '${sensitivePath}'`), {
      code: "EACCES",
      syscall: "watch",
      path: sensitivePath,
    });
  }) as typeof fsSync.watch;

  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "error");
  assert.equal(status.error, "Unable to watch vault directory.");
  const serialized = JSON.stringify(status);
  for (const hidden of [sensitivePath, "EACCES", "permission denied", "syscall"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});
