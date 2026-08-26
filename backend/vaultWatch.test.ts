import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { getMachineIndex, machineIndexPath, rebuildMachineIndex } from "./indexCache.js";
import { hashContent, readVaultFile } from "./vaultFs.js";
import {
  beginVaultIndexBuild,
  ensureVaultWatcher,
  getVaultRuntimeStatus,
  NewestSourceRebuildQueue,
  recordVaultIndexed,
  recordVaultIndexedAfterPublication,
  recordVaultMutation,
  stopAllVaultWatchers,
  stopVaultWatcher,
  WATCHER_AUTHORITATIVE_RECONCILIATION_MAX_MS,
  WATCHER_MAINTENANCE_INTERVAL_MS,
  type VaultWatchMaintenanceScheduler,
  type VaultWatchMaintenanceTimer,
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

type ScheduledMaintenance = {
  active: boolean;
  delayMs: number;
  work: () => Promise<void>;
};

class FakeMaintenanceScheduler implements VaultWatchMaintenanceScheduler {
  nowMs = 0;
  scheduled: ScheduledMaintenance[] = [];

  now(): number {
    return this.nowMs;
  }

  schedule(work: () => Promise<void>, delayMs: number): VaultWatchMaintenanceTimer {
    const entry: ScheduledMaintenance = { active: true, delayMs, work };
    this.scheduled.push(entry);
    return {
      cancel: () => {
        entry.active = false;
      },
    };
  }

  advance(milliseconds: number): void {
    this.nowMs += milliseconds;
  }

  async runNext(): Promise<boolean> {
    const entry = this.scheduled.find((item) => item.active);
    if (!entry) return false;
    entry.active = false;
    await entry.work();
    return true;
  }

  get activeCount(): number {
    return this.scheduled.filter((entry) => entry.active).length;
  }

  get activeEntries(): ScheduledMaintenance[] {
    return this.scheduled.filter((entry) => entry.active);
  }
}

class ControlledFsWatcher extends EventEmitter {
  closed = false;

  fail(error: Error): void {
    if (this.closed) return;
    this.emit("error", error);
  }

  signalChange(): void {
    if (this.closed) return;
    this.emit("change", "change", null);
  }

  unexpectedClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

class ControlledWatchRegistry {
  readonly watchers = new Map<string, ControlledFsWatcher[]>();

  watch = ((
    file: fsSync.PathLike,
    options?:
      fsSync.WatchOptions | BufferEncoding | ((event: string, filename: string | null) => void),
    listener?: (event: string, filename: string | null) => void,
  ) => {
    const absolutePath = path.resolve(file.toString());
    const watcher = new ControlledFsWatcher();
    const callback = typeof options === "function" ? options : listener;
    if (callback) watcher.on("change", callback);
    const existing = this.watchers.get(absolutePath) ?? [];
    existing.push(watcher);
    this.watchers.set(absolutePath, existing);
    return watcher as unknown as fsSync.FSWatcher;
  }) as typeof fsSync.watch;

  isWatched(absolutePath: string): boolean {
    return Boolean(
      this.watchers.get(path.resolve(absolutePath))?.some((watcher) => !watcher.closed),
    );
  }

  activeWatcher(absolutePath: string): ControlledFsWatcher {
    const watcher = this.watchers
      .get(path.resolve(absolutePath))
      ?.find((candidate) => !candidate.closed);
    if (!watcher) throw new Error(`No active controlled watcher for ${absolutePath}`);
    return watcher;
  }

  activeCountFor(absolutePath: string): number {
    return (
      this.watchers.get(path.resolve(absolutePath))?.filter((watcher) => !watcher.closed).length ??
      0
    );
  }

  activeCount(): number {
    return Array.from(this.watchers.values())
      .flat()
      .filter((watcher) => !watcher.closed).length;
  }
}

function installControlledWatch(t: import("node:test").TestContext): ControlledWatchRegistry {
  const originalWatch = fsSync.watch;
  const registry = new ControlledWatchRegistry();
  fsSync.watch = registry.watch;
  t.after(() => {
    fsSync.watch = originalWatch;
  });
  return registry;
}

async function getStatusWhileSignalingEstablishedWatcher(
  vault: VaultInfo,
  cwd: string,
  sourcePath: string,
  signal: () => void,
): Promise<Awaited<ReturnType<typeof getVaultRuntimeStatus>>> {
  const readStarted = deferred();
  const releaseRead = deferred();
  let intercepted = false;
  const restoreOpen = interceptUtf8HandleReads(sourcePath, async (read) => {
    const content = await read();
    if (!intercepted) {
      intercepted = true;
      readStarted.resolve();
      await releaseRead.promise;
    }
    return content;
  });

  try {
    const statusPromise = getVaultRuntimeStatus(vault, cwd);
    await readStarted.promise;
    signal();
    releaseRead.resolve();
    return await statusPromise;
  } finally {
    restoreOpen();
    releaseRead.resolve();
  }
}

function interceptUtf8HandleReads(
  sourcePath: string,
  intercept: (read: () => Promise<Buffer>) => Promise<Buffer>,
): () => void {
  const originalOpen = fs.open;
  fs.open = (async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (file === sourcePath) {
      const originalHandleReadFile = handle.readFile.bind(handle);
      Object.defineProperty(handle, "readFile", {
        configurable: true,
        value: () => intercept(() => originalHandleReadFile() as Promise<Buffer>),
      });
    }
    return handle;
  }) as typeof fs.open;
  return () => {
    fs.open = originalOpen;
  };
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

test("pending watcher events cannot bypass exact body-hash cache validation", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const notePath = path.join(rootPath, "note.md");
  const before = "# Alpha\n";
  const after = "# Bravo\n";
  await fs.writeFile(notePath, before, "utf8");
  const initialStat = await fs.stat(notePath);
  const registry = installControlledWatch(t);
  const vault = testVault(rootPath, "pending-cache-validation-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));
  await ensureVaultWatcher(vault, cwd);
  await getMachineIndex(vault, cwd);

  await fs.writeFile(notePath, after, "utf8");
  await fs.utimes(notePath, initialStat.atime, initialStat.mtime);
  registry.activeWatcher(rootPath).signalChange();
  let bodyReads = 0;
  let sourceDerivations = 0;
  const result = await getMachineIndex(vault, cwd, {
    instrumentation: {
      onMarkdownBodyRead: () => {
        bodyReads += 1;
      },
      onSourceDerived: () => {
        sourceDerivations += 1;
      },
    },
  });

  assert.equal(result.index.notes["note.md"]?.title, "Bravo");
  assert.equal(bodyReads, 1);
  assert.equal(sourceDerivations, 1);
});

test("watcher snapshot and watcher failure both retain canonical-read fallback", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  const registry = installControlledWatch(t);
  const vault = testVault(rootPath, "watcher-cache-fallback-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));
  await ensureVaultWatcher(vault, cwd);
  await getMachineIndex(vault, cwd);

  let trustedLookingSnapshotReads = 0;
  await getMachineIndex(vault, cwd, {
    instrumentation: {
      onMarkdownBodyRead: () => {
        trustedLookingSnapshotReads += 1;
      },
    },
  });
  assert.equal(trustedLookingSnapshotReads, 1);

  registry.activeWatcher(rootPath).fail(new Error("watcher failed"));
  let watcherErrorFallbackReads = 0;
  await getMachineIndex(vault, cwd, {
    instrumentation: {
      onMarkdownBodyRead: () => {
        watcherErrorFallbackReads += 1;
      },
    },
  });
  assert.equal(watcherErrorFallbackReads, 1);
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

test("maintenance covers new empty and nested directories before later source creation", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const scheduler = new FakeMaintenanceScheduler();
  const registry = installControlledWatch(t);
  const vault = testVault(rootPath, "topology-growth-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  assert.equal(registry.isWatched(rootPath), true);
  await fs.mkdir(path.join(rootPath, "a", "b", "c"), { recursive: true });
  assert.equal(await scheduler.runNext(), true);
  for (const directory of ["a", "a/b", "a/b/c"]) {
    assert.equal(registry.isWatched(path.join(rootPath, directory)), true, directory);
  }

  await fs.writeFile(path.join(rootPath, "a", "b", "c", "note.md"), "# Nested\n", "utf8");
  assert.equal(await scheduler.runNext(), true);
  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "stale");
  assert.deepEqual(status.addedPaths, ["a/b/c/note.md"]);
});

test("topology maintenance retires renamed and deleted directories without semantic changes", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const scheduler = new FakeMaintenanceScheduler();
  const registry = installControlledWatch(t);
  await fs.mkdir(path.join(rootPath, "old", "nested"), { recursive: true });
  await fs.writeFile(path.join(rootPath, "old", "nested", "attachment.bin"), "ignored", "utf8");
  const vault = testVault(rootPath, "topology-retirement-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  const oldPath = path.join(rootPath, "old");
  const oldNestedPath = path.join(oldPath, "nested");
  assert.equal(registry.isWatched(oldPath), true);
  assert.equal(registry.isWatched(oldNestedPath), true);

  const renamedPath = path.join(rootPath, "renamed");
  await fs.rename(oldPath, renamedPath);
  await scheduler.runNext();
  assert.equal(registry.isWatched(oldPath), false);
  assert.equal(registry.isWatched(oldNestedPath), false);
  assert.equal(registry.isWatched(renamedPath), true);
  assert.equal(registry.isWatched(path.join(renamedPath, "nested")), true);

  await fs.rm(renamedPath, { recursive: true });
  await scheduler.runNext();
  assert.equal(registry.isWatched(renamedPath), false);
  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "fresh");
  assert.equal(status.changedExternally, false);
  assert.deepEqual(status.changedPaths, []);
});

test("topology-only maintenance does not hash supported content or fingerprint attachments", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const scheduler = new FakeMaintenanceScheduler();
  const registry = installControlledWatch(t);
  const notePath = path.join(rootPath, "note.md");
  await fs.writeFile(notePath, "# Note\n", "utf8");
  const vault = testVault(rootPath, "topology-cheap-path-vault");
  const originalOpen = fs.open;
  let sourceReads = 0;
  t.after(() => {
    fs.open = originalOpen;
    stopVaultWatcher(cwd, vault.id);
  });

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  fs.open = (async (file, ...args) => {
    if (file === notePath) sourceReads += 1;
    return originalOpen(file, ...args);
  }) as typeof fs.open;
  const attachmentDirectory = path.join(rootPath, "assets");
  await fs.mkdir(attachmentDirectory);
  await fs.writeFile(path.join(attachmentDirectory, "image.bin"), "unsupported", "utf8");
  await scheduler.runNext();

  assert.equal(registry.isWatched(attachmentDirectory), true);
  assert.equal(sourceReads, 0);
  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "fresh");
  assert.deepEqual(status.changedPaths, []);
});

test("missed metadata-visible source events are recovered by cheap maintenance", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const scheduler = new FakeMaintenanceScheduler();
  installControlledWatch(t);
  const notePath = path.join(rootPath, "note.md");
  await fs.writeFile(notePath, "# Before\n", "utf8");
  const vault = testVault(rootPath, "missed-metadata-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  await fs.writeFile(notePath, "# After with more bytes\n", "utf8");
  await scheduler.runNext();

  const status = await getVaultRuntimeStatus(vault, cwd, "note.md");
  assert.equal(status.indexStatus, "stale");
  assert.deepEqual(status.changedPaths, ["note.md"]);
  assert.equal(status.file?.hash, hashContent("# After with more bytes\n"));
});

test("authoritative maintenance recovers missed same-size same-mtime source changes", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const scheduler = new FakeMaintenanceScheduler();
  installControlledWatch(t);
  const notePath = path.join(rootPath, "note.md");
  const fixedTime = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  await fs.writeFile(notePath, "# Alpha\n", "utf8");
  await fs.utimes(notePath, fixedTime, fixedTime);
  const vault = testVault(rootPath, "missed-same-metadata-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  await fs.writeFile(notePath, "# Bravo\n", "utf8");
  await fs.utimes(notePath, fixedTime, fixedTime);
  scheduler.advance(WATCHER_AUTHORITATIVE_RECONCILIATION_MAX_MS);
  await scheduler.runNext();

  const status = await getVaultRuntimeStatus(vault, cwd, "note.md");
  assert.equal(status.indexStatus, "stale");
  assert.deepEqual(status.changedPaths, ["note.md"]);
  assert.equal(status.file?.hash, hashContent("# Bravo\n"));
});

test("autonomous maintenance ignores metadata-only changes and preserves source policy", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const scheduler = new FakeMaintenanceScheduler();
  installControlledWatch(t);
  const markdownPath = path.join(rootPath, "note.md");
  const textPath = path.join(rootPath, "plain.txt");
  const chatPath = path.join(rootPath, "conversation.arepo-chat.json");
  await fs.writeFile(markdownPath, "# Note\n", "utf8");
  await fs.writeFile(textPath, "alpha\n", "utf8");
  await fs.writeFile(
    chatPath,
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"alpha"},"messages":[]}\n',
    "utf8",
  );
  const vault = testVault(rootPath, "maintenance-source-policy-vault");
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  const markdownStat = await fs.stat(markdownPath);
  await fs.utimes(
    markdownPath,
    new Date(markdownStat.atimeMs + 2_000),
    new Date(markdownStat.mtimeMs + 2_000),
  );
  await scheduler.runNext();
  let status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "fresh");
  assert.deepEqual(status.changedPaths, []);

  await fs.writeFile(textPath, "bravo with more bytes\n", "utf8");
  await fs.writeFile(
    chatPath,
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"bravo-longer"},"messages":[]}\n',
    "utf8",
  );
  await scheduler.runNext();
  status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "fresh");
  assert.deepEqual(status.changedPaths, ["conversation.arepo-chat.json", "plain.txt"]);
});

test("overlapping reconciliations commit source snapshots in request order", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const scheduler = new FakeMaintenanceScheduler();
  installControlledWatch(t);
  const notePath = path.join(rootPath, "note.md");
  const addedPath = path.join(rootPath, "added.md");
  await fs.writeFile(notePath, "# Alpha\n", "utf8");
  const vault = testVault(rootPath, "reconciliation-order-vault");
  const firstSnapshotCaptured = deferred();
  const releaseFirstSnapshot = deferred();
  let noteReads = 0;
  let restoreOpen: () => void = () => undefined;
  t.after(() => {
    restoreOpen();
    stopVaultWatcher(cwd, vault.id);
  });
  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });

  restoreOpen = interceptUtf8HandleReads(notePath, async (read) => {
    const captured = await read();
    noteReads += 1;
    if (noteReads === 1) {
      firstSnapshotCaptured.resolve();
      await releaseFirstSnapshot.promise;
    }
    return captured;
  });

  const older = getVaultRuntimeStatus(vault, cwd);
  await firstSnapshotCaptured.promise;
  await fs.writeFile(notePath, "# Bravo\n", "utf8");
  await fs.writeFile(addedPath, "# Added\n", "utf8");
  const newer = scheduler.runNext();
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
  const buildCapturedSource = deferred();
  const releaseBuild = deferred();
  let interceptBuildRead = true;
  let restoreOpen: () => void = () => undefined;
  t.after(() => {
    restoreOpen();
    stopVaultWatcher(cwd, vault.id);
  });

  await getVaultRuntimeStatus(vault, cwd);
  const observation = await beginVaultIndexBuild(vault, cwd);
  restoreOpen = interceptUtf8HandleReads(notePath, async (read) => {
    if (interceptBuildRead) {
      interceptBuildRead = false;
      const captured = await read();
      buildCapturedSource.resolve();
      await releaseBuild.promise;
      return captured;
    }
    return read();
  });

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
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
    stopVaultWatcher(cwd, vault.id);
  });
  await getVaultRuntimeStatus(vault, cwd);

  const sensitivePath = "/private/example/watcher-secret.md";
  fs.open = (async (file, ...args) => {
    if (file === absolutePath) {
      throw Object.assign(new Error(`EACCES: permission denied, open '${sensitivePath}'`), {
        code: "EACCES",
        syscall: "open",
        path: sensitivePath,
      });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

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
  await fs.writeFile(path.join(rootPath, "note.md"), "# Changed\n", "utf8");
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

test("unexpected post-publication watcher bookkeeping failures are bounded and logged", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const notePath = path.join(rootPath, "note.md");
  await fs.writeFile(notePath, "# Note\n", "utf8");
  const vault = testVault(rootPath, "post-publication-bookkeeping-vault");
  const originalOpen = fs.open;
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  t.after(() => {
    fs.open = originalOpen;
    console.error = originalConsoleError;
    stopVaultWatcher(cwd, vault.id);
  });

  const observation = await beginVaultIndexBuild(vault, cwd);
  fs.open = (async (file, ...args) => {
    if (file === notePath) throw new Error("unexpected bookkeeping invariant detail");
    return originalOpen(file, ...args);
  }) as typeof fs.open;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  await recordVaultIndexedAfterPublication(vault, observation, cwd);

  assert.deepEqual(logged, [
    ["Unexpected vault watcher bookkeeping failure after index publication."],
  ]);
  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.error, "Vault rescan failed.");
  const serialized = JSON.stringify({ logged, status });
  assert.equal(serialized.includes("unexpected bookkeeping invariant detail"), false);
});

test("watcher-triggered rebuild publishes a partial index for one unreadable source", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const appDataDir = await makeTestTempDir(t, "arepo-watch-data-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const changedPath = path.join(rootPath, "changed.md");
  const failedPath = path.join(rootPath, "failed.md");
  await fs.writeFile(changedPath, "# Before\n", "utf8");
  await fs.writeFile(failedPath, "# Failed\n", "utf8");
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
  const vault = testVault(rootPath, "watcher-partial-rebuild-vault");
  const originalOpen = fs.open;
  const sensitivePath = "/private/example/watcher-partial-secret.md";
  t.after(() => {
    fs.open = originalOpen;
    stopVaultWatcher(cwd, vault.id);
  });

  await getVaultRuntimeStatus(vault, cwd);
  await fs.writeFile(changedPath, "# After\n", "utf8");
  await recordVaultMutation(vault, cwd);
  fs.open = (async (file, ...args) => {
    if (file === failedPath) {
      throw Object.assign(new Error(`EACCES: permission denied, open '${sensitivePath}'`), {
        code: "EACCES",
        syscall: "open",
        path: sensitivePath,
      });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const cacheFile = await machineIndexPath(vault, cwd);
  let stored:
    | {
        sourceDerivations: { path: string; data: { title: string } }[];
        globalData: { issues: { kind: string; path: string }[] };
      }
    | undefined;
  for (let attempt = 0; attempt < 50 && !stored; attempt += 1) {
    stored = await fs
      .readFile(cacheFile, "utf8")
      .then((raw) => JSON.parse(raw) as typeof stored)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
    if (!stored) await nextTurn();
  }

  assert.ok(stored);
  assert.equal(
    stored.sourceDerivations.find((source) => source.path === "changed.md")?.data.title,
    "After",
  );
  assert.equal(
    stored.sourceDerivations.some((source) => source.path === "failed.md"),
    false,
  );
  assert.ok(
    stored.globalData.issues.some(
      (issue) => issue.kind === "source-unreadable" && issue.path === "failed.md",
    ),
  );
  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.error, "Vault rescan failed.");
  assert.notEqual(status.error, "Machine index rebuild failed.");
  const serialized = JSON.stringify({ stored, status });
  for (const hidden of [sensitivePath, rootPath, "EACCES", "permission denied", "syscall"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test("watcher failures remain bounded and maintenance restores coverage", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  const vault = testVault(rootPath, "watcher-error-vault");
  const scheduler = new FakeMaintenanceScheduler();
  const registry = new ControlledWatchRegistry();
  const originalWatch = fsSync.watch;
  const sensitivePath = "/private/example/watcher-secret.md";
  let failing = true;
  t.after(() => {
    fsSync.watch = originalWatch;
    stopVaultWatcher(cwd, vault.id);
  });
  fsSync.watch = ((file) => {
    if (!failing) return registry.watch(file);
    throw Object.assign(new Error(`EACCES: permission denied, watch '${sensitivePath}'`), {
      code: "EACCES",
      syscall: "watch",
      path: sensitivePath,
    });
  }) as typeof fsSync.watch;

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  let status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "error");
  assert.equal(status.error, "Unable to watch vault directory.");
  const serialized = JSON.stringify(status);
  for (const hidden of [sensitivePath, "EACCES", "permission denied", "syscall"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }

  failing = false;
  await scheduler.runNext();
  assert.equal(registry.isWatched(rootPath), true);
  status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "fresh");
  assert.equal(status.error, undefined);
});

test("established watcher errors remain bounded and maintenance restores one watcher", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const notePath = path.join(rootPath, "note.md");
  await fs.writeFile(notePath, "# Note\n", "utf8");
  const vault = testVault(rootPath, "established-watcher-error-vault");
  const scheduler = new FakeMaintenanceScheduler();
  const registry = installControlledWatch(t);
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  const failedWatcher = registry.activeWatcher(rootPath);
  const originalMaintenance = scheduler.activeEntries[0];
  assert.ok(originalMaintenance);
  const sensitivePath = "/private/example/secret-vault";
  const rawMessage = `EACCES: permission denied, watch '${sensitivePath}'`;
  const failure = Object.assign(new Error(rawMessage), {
    code: "EACCES",
    errno: -13,
    syscall: "watch",
    path: sensitivePath,
  });

  const status = await getStatusWhileSignalingEstablishedWatcher(vault, cwd, notePath, () =>
    failedWatcher.fail(failure),
  );

  assert.equal(failedWatcher.closed, true);
  assert.equal(registry.isWatched(rootPath), false);
  assert.equal(status.indexStatus, "error");
  assert.equal(status.error, "Vault watcher failed.");
  const serialized = JSON.stringify(status);
  for (const hidden of [
    sensitivePath,
    rawMessage,
    "EACCES",
    "permission denied",
    "errno",
    "syscall",
    "stack",
    "-13",
  ]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
  assert.equal(originalMaintenance.active, false);
  assert.deepEqual(
    scheduler.activeEntries.map((entry) => entry.delayMs),
    [5_000],
  );

  assert.equal(await scheduler.runNext(), true);
  assert.equal(registry.activeCountFor(rootPath), 1);
  assert.equal(registry.activeCount(), 1);
  assert.deepEqual(
    scheduler.activeEntries.map((entry) => entry.delayMs),
    [WATCHER_MAINTENANCE_INTERVAL_MS],
  );
  const recovered = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(recovered.indexStatus, "fresh");
  assert.equal(recovered.error, undefined);
});

test("unexpected established watcher close is retried without duplicate coverage", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const notePath = path.join(rootPath, "note.md");
  await fs.writeFile(notePath, "# Note\n", "utf8");
  const vault = testVault(rootPath, "unexpected-watcher-close-vault");
  const scheduler = new FakeMaintenanceScheduler();
  const registry = installControlledWatch(t);
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  const closedWatcher = registry.activeWatcher(rootPath);
  const originalMaintenance = scheduler.activeEntries[0];
  assert.ok(originalMaintenance);
  const status = await getStatusWhileSignalingEstablishedWatcher(vault, cwd, notePath, () =>
    closedWatcher.unexpectedClose(),
  );

  assert.equal(closedWatcher.closed, true);
  assert.equal(registry.isWatched(rootPath), false);
  assert.equal(status.indexStatus, "error");
  assert.equal(status.error, "Vault watcher failed.");
  assert.equal(originalMaintenance.active, false);
  assert.deepEqual(
    scheduler.activeEntries.map((entry) => entry.delayMs),
    [5_000],
  );

  assert.equal(await scheduler.runNext(), true);
  assert.equal(registry.activeCountFor(rootPath), 1);
  assert.equal(registry.activeCount(), 1);
  assert.deepEqual(
    scheduler.activeEntries.map((entry) => entry.delayMs),
    [WATCHER_MAINTENANCE_INTERVAL_MS],
  );
  const recovered = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(recovered.indexStatus, "fresh");
  assert.equal(recovered.error, undefined);
});

test("intentional topology watcher close does not schedule failure recovery", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  const childPath = path.join(rootPath, "child");
  await fs.mkdir(childPath);
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  const vault = testVault(rootPath, "intentional-topology-close-vault");
  const scheduler = new FakeMaintenanceScheduler();
  const registry = installControlledWatch(t);
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  const childWatcher = registry.activeWatcher(childPath);
  const scheduledBeforeMaintenance = scheduler.scheduled.length;
  await fs.rmdir(childPath);
  assert.equal(await scheduler.runNext(), true);

  assert.equal(childWatcher.closed, true);
  assert.equal(registry.isWatched(childPath), false);
  assert.equal(registry.activeCountFor(rootPath), 1);
  assert.equal(registry.activeCount(), 1);
  const maintenanceCreated = scheduler.scheduled.slice(scheduledBeforeMaintenance);
  assert.deepEqual(
    maintenanceCreated.filter((entry) => entry.active).map((entry) => entry.delayMs),
    [WATCHER_MAINTENANCE_INTERVAL_MS],
  );
  assert.equal(
    maintenanceCreated.some((entry) => entry.active && entry.delayMs === 5_000),
    false,
  );
  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "fresh");
  assert.equal(status.error, undefined);
  assert.equal(status.changedExternally, false);
  assert.deepEqual(status.changedPaths, []);
});

test("stopVaultWatcher closes established coverage without rescheduling", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  await fs.mkdir(path.join(rootPath, "child"));
  const vault = testVault(rootPath, "stop-established-watchers-vault");
  const scheduler = new FakeMaintenanceScheduler();
  const registry = installControlledWatch(t);
  t.after(() => stopVaultWatcher(cwd, vault.id));

  await ensureVaultWatcher(vault, cwd, { maintenanceScheduler: scheduler });
  assert.equal(registry.activeCount(), 2);
  assert.equal(scheduler.activeCount, 1);
  const scheduledBeforeStop = scheduler.scheduled.length;

  stopVaultWatcher(cwd, vault.id);

  assert.equal(registry.activeCount(), 0);
  assert.equal(
    Array.from(registry.watchers.values())
      .flat()
      .every((watcher) => watcher.closed),
    true,
  );
  assert.equal(scheduler.scheduled.length, scheduledBeforeStop);
  assert.equal(scheduler.activeCount, 0);
  assert.equal(await scheduler.runNext(), false);
  assert.equal(scheduler.activeCount, 0);
  assert.equal(registry.activeCount(), 0);
});

test("maintenance ownership avoids duplicates and stops with watcher lifecycle", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const firstRoot = await makeTestTempDir(t, "arepo-watch-root-");
  const secondRoot = await makeTestTempDir(t, "arepo-watch-root-");
  const scheduler = new FakeMaintenanceScheduler();
  const registry = installControlledWatch(t);
  const first = testVault(firstRoot, "maintenance-lifecycle-first");
  const second = testVault(secondRoot, "maintenance-lifecycle-second");
  t.after(() => stopAllVaultWatchers());

  await ensureVaultWatcher(first, cwd, { maintenanceScheduler: scheduler });
  assert.equal(scheduler.activeCount, 1);
  assert.ok((scheduler.scheduled[0]?.delayMs ?? 0) > 0);
  assert.ok((scheduler.scheduled[0]?.delayMs ?? Infinity) <= WATCHER_MAINTENANCE_INTERVAL_MS);
  await ensureVaultWatcher(first, cwd, { maintenanceScheduler: scheduler });
  assert.equal(scheduler.activeCount, 1);
  assert.equal(registry.activeCount(), 1);

  stopVaultWatcher(cwd, first.id);
  assert.equal(scheduler.activeCount, 0);
  assert.equal(registry.activeCount(), 0);
  assert.equal(await scheduler.runNext(), false);

  await ensureVaultWatcher(first, cwd, { maintenanceScheduler: scheduler });
  await ensureVaultWatcher(second, cwd, { maintenanceScheduler: scheduler });
  assert.equal(scheduler.activeCount, 2);
  assert.equal(registry.activeCount(), 2);
  stopAllVaultWatchers();
  assert.equal(scheduler.activeCount, 0);
  assert.equal(registry.activeCount(), 0);
  assert.equal(await scheduler.runNext(), false);
});
