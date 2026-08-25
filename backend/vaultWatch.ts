import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { sourcePolicy } from "../src/lib/vault/sourcePolicy.js";
import { rebuildMachineIndex } from "./indexCache.js";
import { discoverVaultSources, readVaultFile, vaultFileKind } from "./vaultFs.js";
import type {
  IndexFreshness,
  VaultFile,
  VaultInfo,
  VaultRuntimeStatus,
  WatchedFileStatus,
} from "./types.js";
import { assessVaultAvailability } from "./vaultAvailability.js";
import { PublicApiError } from "./publicApiError.js";

type SnapshotEntry = {
  hash: string;
};

type MetadataEntry = {
  mtimeMs: number;
  size: number;
};

type DirectoryWatcher = {
  watcher: fsSync.FSWatcher;
  closing: boolean;
};

export type VaultWatchMaintenanceTimer = {
  cancel(): void;
};

export type VaultWatchMaintenanceScheduler = {
  now(): number;
  schedule(work: () => Promise<void>, delayMs: number): VaultWatchMaintenanceTimer;
};

export type VaultWatcherOptions = {
  maintenanceScheduler?: VaultWatchMaintenanceScheduler;
};

type VaultWatchPublicError =
  | "Vault watcher failed."
  | "Unable to watch vault directory."
  | "Vault rescan failed."
  | "Machine index rebuild failed.";

type VaultWatchState = {
  key: string;
  cwd: string;
  vault: VaultInfo;
  root: string;
  watchers: Map<string, DirectoryWatcher>;
  directories: Set<string>;
  snapshot: Map<string, SnapshotEntry>;
  metadata: Map<string, MetadataEntry>;
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
  maintenanceScheduler: VaultWatchMaintenanceScheduler;
  maintenanceTimer?: VaultWatchMaintenanceTimer;
  lastAuthoritativeReconciliationAt: number;
  indexStatusBeforeWatcherError?: IndexFreshness;
};

export type VaultIndexBuildObservation = {
  vaultId: string;
  root: string;
  sourceGeneration: number;
};

const states = new Map<string, VaultWatchState>();
const SCAN_DEBOUNCE_MS = 200;
const REBUILD_DEBOUNCE_MS = 800;
// Cheap topology/metadata maintenance is frequent enough to repair directory coverage promptly.
export const WATCHER_MAINTENANCE_INTERVAL_MS = 30_000;
// Hash every supported source within five minutes even when fs.watch and metadata both miss it.
export const WATCHER_AUTHORITATIVE_RECONCILIATION_MAX_MS = 5 * 60_000;
export const WATCHER_FAILURE_RETRY_MS = 5_000;

const systemMaintenanceScheduler: VaultWatchMaintenanceScheduler = {
  now: Date.now,
  schedule(work, delayMs) {
    const timer = setTimeout(() => {
      void work().catch(() => undefined);
    }, delayMs);
    timer.unref();
    return { cancel: () => clearTimeout(timer) };
  },
};

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
  options: VaultWatcherOptions = {},
): Promise<VaultWatchState> {
  const key = stateKey(cwd, vault.id);
  const root = await fs.realpath(vault.rootPath);
  const existing = states.get(key);
  if (existing && existing.root === root) {
    existing.vault = vault;
    return existing;
  }
  if (existing) stopVaultWatcher(cwd, vault.id);

  const discovery = await discoverVaultSources(vault);
  const snapshot = await snapshotVault(vault, discovery.files);
  const maintenanceScheduler = options.maintenanceScheduler ?? systemMaintenanceScheduler;
  const state: VaultWatchState = {
    key,
    cwd,
    vault,
    root,
    watchers: new Map(),
    directories: directorySet(discovery.folders),
    snapshot,
    metadata: metadataSnapshot(discovery.files),
    indexStatus: "fresh",
    changedPaths: new Set(),
    addedPaths: new Set(),
    deletedPaths: new Set(),
    lastIndexedAt: Date.now(),
    sourceGeneration: 0,
    rebuildQueue: new NewestSourceRebuildQueue((generation) =>
      rebuildObservedGeneration(state, generation),
    ),
    maintenanceScheduler,
    lastAuthoritativeReconciliationAt: maintenanceScheduler.now(),
  };
  states.set(key, state);
  await refreshDirectoryWatchers(state, state.directories);
  if (!state.maintenanceTimer) scheduleMaintenance(state, initialMaintenanceDelay(key));
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
    const discovery = await discoverVaultSources(vault);
    const nextSnapshot = await snapshotVault(vault, discovery.files);
    const diff = diffSnapshots(state.snapshot, nextSnapshot);
    state.snapshot = nextSnapshot;
    state.metadata = metadataSnapshot(discovery.files);
    state.lastAuthoritativeReconciliationAt = state.maintenanceScheduler.now();
    await refreshDirectoryWatchers(state, directorySet(discovery.folders));
    clearExternalChanges(state);
    if (markdownChanged(diff)) {
      state.sourceGeneration += 1;
      markStale(state);
      scheduleRebuild(state, 0);
    }
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
    markIndexFresh(state);
    state.lastIndexedAt = Date.now();
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
  for (const state of Array.from(states.values())) {
    if (state.cwd === cwd && !configuredIds.has(state.key)) {
      stopVaultWatcher(cwd, state.vault.id);
    }
  }
}

export async function stopVaultWatcherAndWait(cwd: string, vaultId: string): Promise<void> {
  const state = states.get(stateKey(cwd, vaultId));
  const pending = [state?.rebuilding, state?.reconciliation].filter(
    (item): item is Promise<void> => item !== undefined,
  );
  stopVaultWatcher(cwd, vaultId);
  await Promise.allSettled(pending);
}

export function stopVaultWatcher(cwd: string, vaultId: string): void {
  const key = stateKey(cwd, vaultId);
  const state = states.get(key);
  if (!state) return;
  states.delete(key);
  closeDirectoryWatchers(state);
  if (state.scanTimer) clearTimeout(state.scanTimer);
  if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
  state.maintenanceTimer?.cancel();
  state.maintenanceTimer = undefined;
}

export function stopAllVaultWatchers(): void {
  for (const state of Array.from(states.values())) {
    stopVaultWatcher(state.cwd, state.vault.id);
  }
}

export async function stopVaultWatchersForDirectory(directory: string): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const state of Array.from(states.values())) {
    if (state.cwd !== directory && state.root !== directory) continue;
    if (state.rebuilding) pending.push(state.rebuilding);
    if (state.reconciliation) pending.push(state.reconciliation);
    stopVaultWatcher(state.cwd, state.vault.id);
  }
  await Promise.allSettled(pending);
}

async function refreshDirectoryWatchers(
  state: VaultWatchState,
  directories: Set<string>,
): Promise<void> {
  if (!isActiveState(state)) return;
  for (const [folder, entry] of state.watchers) {
    if (directories.has(folder)) continue;
    state.watchers.delete(folder);
    entry.closing = true;
    entry.watcher.close();
  }
  state.directories = new Set(directories);
  for (const folder of directories) {
    if (!isActiveState(state) || state.watchers.has(folder)) continue;
    const absoluteDir = folder ? path.join(state.root, folder) : state.root;
    try {
      const watcher = fsSync.watch(absoluteDir, { persistent: false }, () => {
        state.lastEventAt = Date.now();
        scheduleScan(state);
      });
      const entry: DirectoryWatcher = { watcher, closing: false };
      state.watchers.set(folder, entry);
      watcher.on("error", () => {
        if (state.watchers.get(folder) !== entry) return;
        state.watchers.delete(folder);
        entry.closing = true;
        watcher.close();
        setWatcherError(state, "Vault watcher failed.");
        scheduleMaintenance(state, WATCHER_FAILURE_RETRY_MS);
      });
      watcher.on("close", () => {
        if (entry.closing || state.watchers.get(folder) !== entry) return;
        state.watchers.delete(folder);
        setWatcherError(state, "Vault watcher failed.");
        scheduleMaintenance(state, WATCHER_FAILURE_RETRY_MS);
      });
    } catch {
      setWatcherError(state, "Unable to watch vault directory.");
      scheduleMaintenance(state, WATCHER_FAILURE_RETRY_MS);
    }
  }
  if (directories.size === state.watchers.size) clearRecoveredWatcherError(state);
}

function scheduleScan(state: VaultWatchState): void {
  if (!isActiveState(state)) return;
  if (state.scanTimer) clearTimeout(state.scanTimer);
  state.scanTimer = setTimeout(() => {
    state.scanTimer = undefined;
    if (!isActiveState(state)) return;
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
  const discovery = await discoverVaultSources(state.vault);
  await commitDiscoveredVaultSnapshot(state, discovery.files, discovery.folders, options);
}

async function commitDiscoveredVaultSnapshot(
  state: VaultWatchState,
  files: VaultFile[],
  folders: string[],
  options: { scheduleRebuild: boolean },
): Promise<void> {
  if (!isActiveState(state)) return;
  const before = state.snapshot;
  await refreshDirectoryWatchers(state, directorySet(folders));
  const after = await snapshotVault(state.vault, files);
  if (!isActiveState(state)) return;
  const diff = diffSnapshots(before, after);
  state.snapshot = after;
  state.metadata = metadataSnapshot(files);
  state.lastAuthoritativeReconciliationAt = state.maintenanceScheduler.now();
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
    if (markdownChanged(diff)) {
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

function scheduleMaintenance(state: VaultWatchState, delayMs: number): void {
  if (!isActiveState(state)) return;
  state.maintenanceTimer?.cancel();
  state.maintenanceTimer = state.maintenanceScheduler.schedule(async () => {
    state.maintenanceTimer = undefined;
    if (!isActiveState(state)) return;
    try {
      await runMaintenance(state);
    } catch {
      // runMaintenance records only bounded watcher state.
    } finally {
      if (isActiveState(state)) {
        scheduleMaintenance(
          state,
          watcherCoverageComplete(state)
            ? WATCHER_MAINTENANCE_INTERVAL_MS
            : WATCHER_FAILURE_RETRY_MS,
        );
      }
    }
  }, delayMs);
}

async function runMaintenance(state: VaultWatchState): Promise<void> {
  await withReconciliationLock(state, async () => {
    try {
      const discovery = await discoverVaultSources(state.vault);
      const directories = directorySet(discovery.folders);
      const metadata = metadataSnapshot(discovery.files);
      await refreshDirectoryWatchers(state, directories);
      // Reserve one maintenance interval so timer phase never pushes verification past the max.
      const authoritativeDue =
        state.maintenanceScheduler.now() - state.lastAuthoritativeReconciliationAt >=
        WATCHER_AUTHORITATIVE_RECONCILIATION_MAX_MS - WATCHER_MAINTENANCE_INTERVAL_MS;
      if (!metadataSnapshotsEqual(state.metadata, metadata) || authoritativeDue) {
        await commitDiscoveredVaultSnapshot(state, discovery.files, discovery.folders, {
          scheduleRebuild: true,
        });
      } else {
        state.metadata = metadata;
      }
    } catch (error) {
      state.indexStatus = "error";
      state.error = "Vault rescan failed.";
      throw error;
    }
  });
}

function scheduleRebuild(state: VaultWatchState, delay = REBUILD_DEBOUNCE_MS): void {
  if (!isActiveState(state)) return;
  if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
  state.rebuildTimer = setTimeout(() => {
    state.rebuildTimer = undefined;
    if (!isActiveState(state)) return;
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
  if (!isWatcherError(state.error)) state.error = undefined;
  try {
    await rebuildMachineIndex(state.vault, state.cwd);
    if (generation === state.sourceGeneration) {
      markIndexFresh(state);
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

async function snapshotVault(
  vault: VaultInfo,
  files: VaultFile[],
): Promise<Map<string, SnapshotEntry>> {
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

function metadataSnapshot(files: VaultFile[]): Map<string, MetadataEntry> {
  return new Map(files.map((file) => [file.path, { mtimeMs: file.mtimeMs, size: file.size }]));
}

function metadataSnapshotsEqual(
  before: Map<string, MetadataEntry>,
  after: Map<string, MetadataEntry>,
): boolean {
  if (before.size !== after.size) return false;
  for (const [filePath, entry] of after) {
    const previous = before.get(filePath);
    if (!previous || previous.mtimeMs !== entry.mtimeMs || previous.size !== entry.size) {
      return false;
    }
  }
  return true;
}

function directorySet(folders: string[]): Set<string> {
  return new Set(["", ...folders]);
}

function markdownChanged(diff: { added: string[]; changed: string[]; deleted: string[] }): boolean {
  return [...diff.added, ...diff.changed, ...diff.deleted].some((filePath) => {
    const kind = vaultFileKind(filePath);
    return kind ? sourcePolicy(kind).contributesToMarkdownIndex : false;
  });
}

function initialMaintenanceDelay(key: string): number {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 1 + (hash % WATCHER_MAINTENANCE_INTERVAL_MS);
}

function setWatcherError(state: VaultWatchState, error: VaultWatchPublicError): void {
  if (state.error && !isWatcherError(state.error)) return;
  if (!isWatcherError(state.error)) {
    state.indexStatusBeforeWatcherError = state.indexStatus;
  }
  state.indexStatus = "error";
  state.error = error;
}

function clearRecoveredWatcherError(state: VaultWatchState): void {
  if (!isWatcherError(state.error)) return;
  state.error = undefined;
  if (state.indexStatus === "error") {
    state.indexStatus = state.indexStatusBeforeWatcherError ?? "fresh";
  }
  state.indexStatusBeforeWatcherError = undefined;
}

function isWatcherError(error: VaultWatchPublicError | undefined): boolean {
  return error === "Vault watcher failed." || error === "Unable to watch vault directory.";
}

function closeDirectoryWatchers(state: VaultWatchState): void {
  for (const entry of state.watchers.values()) {
    entry.closing = true;
    entry.watcher.close();
  }
  state.watchers.clear();
}

function isActiveState(state: VaultWatchState): boolean {
  return states.get(state.key) === state;
}

function watcherCoverageComplete(state: VaultWatchState): boolean {
  return state.watchers.size === state.directories.size;
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

function markIndexFresh(state: VaultWatchState): void {
  if (isWatcherError(state.error)) {
    state.indexStatusBeforeWatcherError = "fresh";
    state.indexStatus = "error";
    return;
  }
  state.indexStatus = "fresh";
  state.error = undefined;
}

function stateKey(cwd: string, vaultId: string): string {
  return `${cwd}:${vaultId}`;
}
