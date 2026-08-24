import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { rebuildMachineIndex } from "./indexCache.js";
import { listFolders, listSupportedTextFiles, readVaultFile, vaultFileKind } from "./vaultFs.js";
import type { IndexFreshness, VaultInfo, VaultRuntimeStatus, WatchedFileStatus } from "./types.js";

type SnapshotEntry = {
  mtimeMs: number;
  size: number;
};

type VaultWatchState = {
  cwd: string;
  vault: VaultInfo;
  root: string;
  watchers: fsSync.FSWatcher[];
  snapshot: Map<string, SnapshotEntry>;
  indexStatus: IndexFreshness;
  changedPaths: Set<string>;
  addedPaths: Set<string>;
  deletedPaths: Set<string>;
  lastEventAt?: number;
  lastIndexedAt?: number;
  error?: string;
  scanTimer?: NodeJS.Timeout;
  rebuildTimer?: NodeJS.Timeout;
  rebuilding?: Promise<void>;
};

const states = new Map<string, VaultWatchState>();
const SCAN_DEBOUNCE_MS = 200;
const REBUILD_DEBOUNCE_MS = 800;

export async function ensureVaultWatcher(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<VaultWatchState> {
  const key = stateKey(cwd, vault.id);
  const root = await fs.realpath(vault.rootPath);
  const existing = states.get(key);
  if (existing && existing.root === root) {
    existing.vault = vault;
    return existing;
  }
  if (existing) stopVaultWatcher(cwd, vault.id);

  const state: VaultWatchState = {
    cwd,
    vault,
    root,
    watchers: [],
    snapshot: await snapshotVault(vault),
    indexStatus: "fresh",
    changedPaths: new Set(),
    addedPaths: new Set(),
    deletedPaths: new Set(),
    lastIndexedAt: Date.now(),
  };
  states.set(key, state);
  await refreshDirectoryWatchers(state);
  return state;
}

export async function getVaultRuntimeStatus(
  vault: VaultInfo,
  cwd = process.cwd(),
  filePath?: string | null,
): Promise<VaultRuntimeStatus> {
  const state = await ensureVaultWatcher(vault, cwd);
  await rescanVault(state, { scheduleRebuild: true });
  return toStatus(state, filePath ?? undefined);
}

export async function recordVaultMutation(vault: VaultInfo, cwd = process.cwd()): Promise<void> {
  const state = await ensureVaultWatcher(vault, cwd);
  state.snapshot = await snapshotVault(vault);
  clearExternalChanges(state);
  markStale(state);
  await refreshDirectoryWatchers(state);
  scheduleRebuild(state, 0);
}

export async function recordVaultIndexed(vault: VaultInfo, cwd = process.cwd()): Promise<void> {
  const state = await ensureVaultWatcher(vault, cwd);
  state.snapshot = await snapshotVault(vault);
  state.indexStatus = "fresh";
  state.lastIndexedAt = Date.now();
  state.error = undefined;
}

export async function startConfiguredVaultWatchers(
  vaults: VaultInfo[],
  cwd = process.cwd(),
): Promise<void> {
  await Promise.all(vaults.map((vault) => ensureVaultWatcher(vault, cwd)));
  const configuredIds = new Set(vaults.map((vault) => stateKey(cwd, vault.id)));
  for (const key of states.keys()) {
    if (key.startsWith(`${cwd}:`) && !configuredIds.has(key)) {
      const [, vaultId] = key.split(":");
      if (vaultId) stopVaultWatcher(cwd, vaultId);
    }
  }
}

export function stopVaultWatcher(cwd: string, vaultId: string): void {
  const key = stateKey(cwd, vaultId);
  const state = states.get(key);
  if (!state) return;
  for (const watcher of state.watchers) watcher.close();
  if (state.scanTimer) clearTimeout(state.scanTimer);
  if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
  states.delete(key);
}

export function stopAllVaultWatchers(): void {
  for (const key of Array.from(states.keys())) {
    const [cwd, vaultId] = key.split(":");
    if (cwd && vaultId) stopVaultWatcher(cwd, vaultId);
  }
}

export async function stopVaultWatchersForDirectory(directory: string): Promise<void> {
  const rebuilding: Promise<void>[] = [];
  for (const [key, state] of states) {
    if (state.cwd !== directory && state.root !== directory) continue;
    for (const watcher of state.watchers) watcher.close();
    if (state.scanTimer) clearTimeout(state.scanTimer);
    if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
    if (state.rebuilding) rebuilding.push(state.rebuilding);
    states.delete(key);
  }
  await Promise.allSettled(rebuilding);
}

async function refreshDirectoryWatchers(state: VaultWatchState): Promise<void> {
  for (const watcher of state.watchers) watcher.close();
  state.watchers = [];
  const folders = ["", ...(await listFolders(state.vault))];
  for (const folder of folders) {
    const absoluteDir = folder ? path.join(state.root, folder) : state.root;
    try {
      const watcher = fsSync.watch(absoluteDir, { persistent: false }, () => {
        state.lastEventAt = Date.now();
        scheduleScan(state);
      });
      watcher.on("error", (error) => {
        state.indexStatus = "error";
        state.error = error instanceof Error ? error.message : "Watcher failed";
      });
      state.watchers.push(watcher);
    } catch (error) {
      state.indexStatus = "error";
      state.error = error instanceof Error ? error.message : "Unable to watch vault directory";
    }
  }
}

function scheduleScan(state: VaultWatchState): void {
  if (state.scanTimer) clearTimeout(state.scanTimer);
  state.scanTimer = setTimeout(() => {
    void rescanVault(state, { scheduleRebuild: true }).catch((error) => {
      state.indexStatus = "error";
      state.error = error instanceof Error ? error.message : "Vault rescan failed";
    });
  }, SCAN_DEBOUNCE_MS);
  state.scanTimer.unref();
}

async function rescanVault(
  state: VaultWatchState,
  options: { scheduleRebuild: boolean },
): Promise<void> {
  const before = state.snapshot;
  const after = await snapshotVault(state.vault);
  const diff = diffSnapshots(before, after);
  if (diff.added.length || diff.changed.length || diff.deleted.length) {
    state.lastEventAt = Date.now();
    for (const item of diff.added) {
      state.addedPaths.add(item);
      state.changedPaths.add(item);
      state.deletedPaths.delete(item);
    }
    for (const item of diff.changed) state.changedPaths.add(item);
    for (const item of diff.deleted) {
      state.deletedPaths.add(item);
      state.changedPaths.add(item);
      state.addedPaths.delete(item);
    }
    state.snapshot = after;
    await refreshDirectoryWatchers(state);
    const markdownChanged = [...diff.added, ...diff.changed, ...diff.deleted].some(
      (filePath) => vaultFileKind(filePath) === "markdown",
    );
    if (markdownChanged) {
      markStale(state);
      if (options.scheduleRebuild) scheduleRebuild(state);
    }
  }
}

function scheduleRebuild(state: VaultWatchState, delay = REBUILD_DEBOUNCE_MS): void {
  if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
  state.rebuildTimer = setTimeout(() => {
    state.indexStatus = "rebuilding";
    state.rebuilding = rebuildMachineIndex(state.vault, state.cwd)
      .then(async () => {
        state.snapshot = await snapshotVault(state.vault);
        state.indexStatus = "fresh";
        state.lastIndexedAt = Date.now();
        state.error = undefined;
      })
      .catch((error) => {
        state.indexStatus = "error";
        state.error = error instanceof Error ? error.message : "Machine index rebuild failed";
      })
      .finally(() => {
        state.rebuilding = undefined;
      });
  }, delay);
  state.rebuildTimer.unref();
}

async function toStatus(state: VaultWatchState, filePath?: string): Promise<VaultRuntimeStatus> {
  const status: VaultRuntimeStatus = {
    vaultId: state.vault.id,
    indexStatus: state.indexStatus,
    changedExternally:
      state.changedPaths.size > 0 || state.addedPaths.size > 0 || state.deletedPaths.size > 0,
    changedPaths: Array.from(state.changedPaths).sort(),
    addedPaths: Array.from(state.addedPaths).sort(),
    deletedPaths: Array.from(state.deletedPaths).sort(),
    lastEventAt: state.lastEventAt,
    lastIndexedAt: state.lastIndexedAt,
    error: state.error,
  };
  if (filePath) {
    status.file = await fileStatus(state, filePath);
  }
  return status;
}

async function fileStatus(state: VaultWatchState, filePath: string): Promise<WatchedFileStatus> {
  try {
    const file = await readVaultFile(state.vault, filePath);
    return {
      path: file.path,
      exists: true,
      mtimeMs: file.mtimeMs,
      size: file.size,
      hash: file.hash,
      changedExternally: state.changedPaths.has(file.path),
      deletedExternally: false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      path: filePath,
      exists: false,
      changedExternally: state.changedPaths.has(filePath),
      deletedExternally: state.deletedPaths.has(filePath),
    };
  }
}

async function snapshotVault(vault: VaultInfo): Promise<Map<string, SnapshotEntry>> {
  const files = await listSupportedTextFiles(vault);
  return new Map(files.map((file) => [file.path, { mtimeMs: file.mtimeMs, size: file.size }]));
}

function diffSnapshots(
  before: Map<string, SnapshotEntry>,
  after: Map<string, SnapshotEntry>,
): { added: string[]; changed: string[]; deleted: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const [filePath, entry] of after) {
    const previous = before.get(filePath);
    if (!previous) added.push(filePath);
    else if (previous.mtimeMs !== entry.mtimeMs || previous.size !== entry.size) {
      changed.push(filePath);
    }
  }
  for (const filePath of before.keys()) {
    if (!after.has(filePath)) deleted.push(filePath);
  }
  return { added, changed, deleted };
}

function clearExternalChanges(state: VaultWatchState): void {
  state.changedPaths.clear();
  state.addedPaths.clear();
  state.deletedPaths.clear();
  state.lastEventAt = undefined;
}

function markStale(state: VaultWatchState): void {
  if (state.indexStatus !== "rebuilding") state.indexStatus = "stale";
}

function stateKey(cwd: string, vaultId: string): string {
  return `${cwd}:${vaultId}`;
}
