import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { sourcePolicy } from "../src/lib/vault/sourcePolicy.js";
import { rebuildMachineIndex } from "./indexCache.js";
import { listFolders, listSupportedTextFiles, readVaultFile, vaultFileKind } from "./vaultFs.js";
import type { IndexFreshness, VaultInfo, VaultRuntimeStatus, WatchedFileStatus } from "./types.js";
import { assessVaultAvailability } from "./vaultAvailability.js";
import { PublicApiError } from "./publicApiError.js";

type SnapshotEntry = {
  hash: string;
};

type VaultWatchPublicError =
  | "Vault watcher failed."
  | "Unable to watch vault directory."
  | "Vault rescan failed."
  | "Machine index rebuild failed.";

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
  error?: VaultWatchPublicError;
  scanTimer?: NodeJS.Timeout;
  rebuildTimer?: NodeJS.Timeout;
  rebuilding?: Promise<void>;
  sourceGeneration: number;
  rebuildQueue: NewestSourceRebuildQueue;
  reconciliation?: Promise<void>;
};

export type VaultIndexBuildObservation = {
  vaultId: string;
  root: string;
  sourceGeneration: number;
};

const states = new Map<string, VaultWatchState>();
const SCAN_DEBOUNCE_MS = 200;
const REBUILD_DEBOUNCE_MS = 800;

export class NewestSourceRebuildQueue {
  private requestedGeneration = 0;
  private completedGeneration = 0;
  private running: Promise<void> | undefined;

  constructor(private readonly rebuild: (generation: number) => Promise<void>) {}

  request(generation: number): Promise<void> {
    this.requestedGeneration = Math.max(this.requestedGeneration, generation);
    if (this.running) return this.running;
    if (this.completedGeneration >= this.requestedGeneration) return Promise.resolve();

    const tracked = this.drain().finally(() => {
      if (this.running === tracked) this.running = undefined;
    });
    this.running = tracked;
    return tracked;
  }

  private async drain(): Promise<void> {
    while (this.completedGeneration < this.requestedGeneration) {
      const generation = this.requestedGeneration;
      await this.rebuild(generation);
      this.completedGeneration = generation;
    }
  }
}

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
    sourceGeneration: 0,
    rebuildQueue: new NewestSourceRebuildQueue((generation) =>
      rebuildObservedGeneration(state, generation),
    ),
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
  try {
    await rescanVault(state, { scheduleRebuild: true });
  } catch {
    // rescanVault records the bounded watcher error while holding the reconciliation lock.
  }
  return toStatus(state, filePath ?? undefined);
}

export async function recordVaultMutation(vault: VaultInfo, cwd = process.cwd()): Promise<void> {
  const state = await ensureVaultWatcher(vault, cwd);
  await withReconciliationLock(state, async () => {
    state.snapshot = await snapshotVault(vault);
    clearExternalChanges(state);
    state.sourceGeneration += 1;
    markStale(state);
    await refreshDirectoryWatchers(state);
    scheduleRebuild(state, 0);
  });
}

export async function beginVaultIndexBuild(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<VaultIndexBuildObservation> {
  const state = await ensureVaultWatcher(vault, cwd);
  return withReconciliationLock(state, () =>
    Promise.resolve({
      vaultId: state.vault.id,
      root: state.root,
      sourceGeneration: state.sourceGeneration,
    }),
  );
}

export async function recordVaultIndexed(
  vault: VaultInfo,
  observation: VaultIndexBuildObservation,
  cwd = process.cwd(),
): Promise<void> {
  const state = await ensureVaultWatcher(vault, cwd);
  await withReconciliationLock(state, async () => {
    await rescanVaultLocked(state, { scheduleRebuild: true });
    if (
      observation.vaultId !== state.vault.id ||
      observation.root !== state.root ||
      observation.sourceGeneration !== state.sourceGeneration
    ) {
      markStale(state);
      return;
    }
    state.indexStatus = "fresh";
    state.lastIndexedAt = Date.now();
    state.error = undefined;
  });
}

export async function startConfiguredVaultWatchers(
  vaults: VaultInfo[],
  cwd = process.cwd(),
): Promise<void> {
  const availableVaults = (
    await Promise.all(
      vaults.map(async (vault) => ({
        vault,
        availability: await assessVaultAvailability(vault.rootPath),
      })),
    )
  ).filter(({ availability }) => availability.status === "available");
  await Promise.all(availableVaults.map(({ vault }) => ensureVaultWatcher(vault, cwd)));
  const configuredIds = new Set(availableVaults.map(({ vault }) => stateKey(cwd, vault.id)));
  for (const key of states.keys()) {
    if (key.startsWith(`${cwd}:`) && !configuredIds.has(key)) {
      const [, vaultId] = key.split(":");
      if (vaultId) stopVaultWatcher(cwd, vaultId);
    }
  }
}

export async function stopVaultWatcherAndWait(cwd: string, vaultId: string): Promise<void> {
  const state = states.get(stateKey(cwd, vaultId));
  const rebuilding = state?.rebuilding;
  stopVaultWatcher(cwd, vaultId);
  if (rebuilding) await Promise.allSettled([rebuilding]);
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
      watcher.on("error", () => {
        state.indexStatus = "error";
        state.error = "Vault watcher failed.";
      });
      state.watchers.push(watcher);
    } catch {
      state.indexStatus = "error";
      state.error = "Unable to watch vault directory.";
    }
  }
}

function scheduleScan(state: VaultWatchState): void {
  if (state.scanTimer) clearTimeout(state.scanTimer);
  state.scanTimer = setTimeout(() => {
    void rescanVault(state, { scheduleRebuild: true }).catch(() => undefined);
  }, SCAN_DEBOUNCE_MS);
  state.scanTimer.unref();
}

async function rescanVault(
  state: VaultWatchState,
  options: { scheduleRebuild: boolean },
): Promise<void> {
  return withReconciliationLock(state, () => rescanVaultLocked(state, options));
}

async function rescanVaultLocked(
  state: VaultWatchState,
  options: { scheduleRebuild: boolean },
): Promise<void> {
  try {
    await commitVaultSnapshot(state, options);
  } catch (error) {
    state.indexStatus = "error";
    state.error = "Vault rescan failed.";
    throw error;
  }
}

async function commitVaultSnapshot(
  state: VaultWatchState,
  options: { scheduleRebuild: boolean },
): Promise<void> {
  const before = state.snapshot;
  const after = await snapshotVault(state.vault);
  const diff = diffSnapshots(before, after);
  state.snapshot = after;
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
    await refreshDirectoryWatchers(state);
    const markdownChanged = [...diff.added, ...diff.changed, ...diff.deleted].some((filePath) => {
      const kind = vaultFileKind(filePath);
      return kind ? sourcePolicy(kind).contributesToMarkdownIndex : false;
    });
    if (markdownChanged) {
      state.sourceGeneration += 1;
      markStale(state);
      if (options.scheduleRebuild) scheduleRebuild(state);
    }
  }
}

async function withReconciliationLock<T>(
  state: VaultWatchState,
  work: () => Promise<T>,
): Promise<T> {
  const previous = state.reconciliation ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  state.reconciliation = queued;
  await previous.catch(() => undefined);

  try {
    return await work();
  } finally {
    releaseCurrent();
    if (state.reconciliation === queued) state.reconciliation = undefined;
  }
}

function scheduleRebuild(state: VaultWatchState, delay = REBUILD_DEBOUNCE_MS): void {
  if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
  state.rebuildTimer = setTimeout(() => {
    state.rebuildTimer = undefined;
    const rebuilding = state.rebuildQueue.request(state.sourceGeneration);
    state.rebuilding = rebuilding;
    void rebuilding.then(
      () => {
        if (state.rebuilding === rebuilding) state.rebuilding = undefined;
      },
      () => {
        if (state.rebuilding === rebuilding) state.rebuilding = undefined;
      },
    );
  }, delay);
  state.rebuildTimer.unref();
}

async function rebuildObservedGeneration(
  state: VaultWatchState,
  generation: number,
): Promise<void> {
  state.indexStatus = "rebuilding";
  state.error = undefined;
  try {
    await rebuildMachineIndex(state.vault, state.cwd);
    if (generation === state.sourceGeneration) {
      state.indexStatus = "fresh";
      state.lastIndexedAt = Date.now();
    } else {
      state.indexStatus = "stale";
    }
  } catch {
    if (generation === state.sourceGeneration) {
      state.indexStatus = "error";
      state.error = "Machine index rebuild failed.";
    } else {
      state.indexStatus = "stale";
    }
  }
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
    try {
      status.file = await fileStatus(state, filePath);
    } catch (error) {
      if (error instanceof PublicApiError) throw error;
      state.indexStatus = "error";
      state.error = "Vault rescan failed.";
      status.indexStatus = "error";
      status.error = "Vault rescan failed.";
    }
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
  const contents = await Promise.all(files.map((file) => readVaultFile(vault, file.path)));
  return new Map(contents.map((file) => [file.path, { hash: file.hash }]));
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
    else if (previous.hash !== entry.hash) {
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
