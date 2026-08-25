import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  assembleIndex,
  deriveMarkdownSource,
  validate,
  type MarkdownSourceDerivation,
  type ValidationIssue,
  type VaultIndex,
} from "../src/lib/vault/indexer.js";
import { getAppDataDir } from "./config.js";
import {
  discoverStructuralIndexSources,
  processStructuralIndexSources,
  type StructuralIndexInputManifest,
} from "./vaultFs.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";

export const MACHINE_INDEX_VERSION = 5;
export const STRUCTURAL_INDEX_DERIVATION_VERSION = 1;
export const MARKDOWN_SOURCE_DERIVATION_VERSION = 1;
const OWNED_MACHINE_INDEX_VERSIONS = new Set([1, 2, 3, 4, MACHINE_INDEX_VERSION]);
const indexOperationLocks = new Map<string, Promise<void>>();

export type StoredMarkdownSourceDerivation = {
  path: string;
  contentHash: string;
  derivationVersion: number;
  data: MarkdownSourceDerivation;
};

export type StoredMachineIndex = {
  kind: "arepo.machineIndex";
  version: 5;
  derivationVersion: number;
  generatedAt: string;
  vault: {
    id: string;
    displayName: string;
    rootPathHash: string;
  };
  manifest: StructuralIndexInputManifest;
  sourceDerivations: StoredMarkdownSourceDerivation[];
  globalData: StoredGlobalIndexData;
};

export type StoredGlobalIndexData = {
  index: Omit<VaultIndex, "notes">;
  issues: ValidationIssue[];
};

export type MachineIndexResult = {
  data: VaultIndexResponse;
  cacheStatus: "hit" | "rebuilt";
};

export type MachineIndexInstrumentation = {
  onMarkdownBodyRead?: (path: string) => void;
  onMarkdownBodyReadComplete?: (path: string, bytes: number) => void;
  onMarkdownBodyReadSettled?: (path: string) => void;
  onHashCalculated?: (path: string, durationMs: number) => void;
  onDiscoveryComplete?: (fileCount: number, durationMs: number) => void;
  onSourceCaptureComplete?: (durationMs: number) => void;
  onMarkdownBodyRetained?: (path: string, bytes: number) => void;
  onMarkdownBodyReleased?: (path: string, bytes: number) => void;
  onMemoryCheckpoint?: (phase: string) => void;
  onSourceDerived?: (path: string, durationMs: number) => void;
  onSourceDerivativeReused?: (path: string) => void;
  onGlobalAssembly?: (durationMs: number) => void;
  onPublicResponseMaterialization?: (durationMs: number) => void;
  onCacheRead?: (bytes: number, durationMs: number) => void;
  onCacheHit?: () => void;
  onCacheSerialization?: (bytes: number, durationMs: number) => void;
  onCachePublication?: (bytes: number, durationMs: number) => void;
  onPublication?: () => void;
};

export type MachineIndexOperationOptions = {
  instrumentation?: MachineIndexInstrumentation;
  maxConcurrentMarkdownReads?: number;
};

export type GeneratedDataRemoval = {
  deletedPaths: string[];
  diagnostics: string[];
};

export async function getMachineIndex(
  vault: VaultInfo,
  cwd = process.cwd(),
  options: MachineIndexOperationOptions = {},
): Promise<VaultIndexResponse> {
  return (await getMachineIndexResult(vault, cwd, options)).data;
}

export async function getMachineIndexResult(
  vault: VaultInfo,
  cwd = process.cwd(),
  options: MachineIndexOperationOptions = {},
): Promise<MachineIndexResult> {
  return runMachineIndexOperation(vault, cwd, "get", options);
}

export async function refreshMachineIndex(
  vault: VaultInfo,
  cwd = process.cwd(),
  options: MachineIndexOperationOptions = {},
): Promise<VaultIndexResponse> {
  return (await runMachineIndexOperation(vault, cwd, "refresh", options)).data;
}

export async function rebuildMachineIndex(
  vault: VaultInfo,
  cwd = process.cwd(),
  options: MachineIndexOperationOptions = {},
): Promise<VaultIndexResponse> {
  return (await runMachineIndexOperation(vault, cwd, "force", options)).data;
}

async function runMachineIndexOperation(
  vault: VaultInfo,
  cwd: string,
  mode: "get" | "refresh" | "force",
  options: MachineIndexOperationOptions,
): Promise<MachineIndexResult> {
  const file = await machineIndexPath(vault, cwd);
  return withIndexLock(indexOperationLocks, file, async () => {
    const instrumentation = options.instrumentation;
    const captureInstrumentation = {
      maxConcurrentMarkdownReads: options.maxConcurrentMarkdownReads,
      onMarkdownBodyRead: instrumentation?.onMarkdownBodyRead,
      onMarkdownBodyReadComplete: instrumentation?.onMarkdownBodyReadComplete,
      onMarkdownBodyReadSettled: instrumentation?.onMarkdownBodyReadSettled,
      onHashCalculated: instrumentation?.onHashCalculated,
      onDiscoveryComplete: instrumentation?.onDiscoveryComplete,
      onSourceCaptureComplete: instrumentation?.onSourceCaptureComplete,
      onMarkdownBodyRetained: instrumentation?.onMarkdownBodyRetained,
      onMemoryCheckpoint: instrumentation?.onMemoryCheckpoint,
      onMarkdownBodyReleased: instrumentation?.onMarkdownBodyReleased,
    };
    const discovery = await discoverStructuralIndexSources(vault, captureInstrumentation);
    instrumentation?.onMemoryCheckpoint?.("before-cache-load");
    let stored = mode === "force" ? undefined : await readStoredMachineIndex(file, instrumentation);
    const expectedRootHash = await vaultRootHash(vault);
    let reusableStored =
      stored && stored.vault.id === vault.id && stored.vault.rootPathHash === expectedRootHash
        ? stored
        : undefined;
    let reusableManifest = reusableStored?.manifest;
    let reusableSourceDerivations = reusableStored?.sourceDerivations ?? [];
    const reusableGlobalDerivationVersion = reusableStored?.derivationVersion;
    let reusableGlobalData =
      mode === "get" && reusableGlobalDerivationVersion === STRUCTURAL_INDEX_DERIVATION_VERSION
        ? reusableStored?.globalData
        : undefined;
    stored = undefined;
    reusableStored = undefined;
    const cachedByPath = new Map(
      (mode === "force" ? [] : reusableSourceDerivations).map((entry) => [entry.path, entry]),
    );
    const processed = await processStructuralIndexSources(
      discovery,
      ({ path: sourcePath, content, contentHash }) => {
        const cached = cachedByPath.get(sourcePath);
        if (
          cached &&
          cached.contentHash === contentHash &&
          cached.derivationVersion === MARKDOWN_SOURCE_DERIVATION_VERSION &&
          cached.data.path === sourcePath
        ) {
          instrumentation?.onSourceDerivativeReused?.(sourcePath);
          return cached;
        }
        reusableGlobalData = undefined;
        const derivationStartedAt = instrumentation?.onSourceDerived ? performance.now() : 0;
        const derivative = toPersistedMarkdownSourceDerivation(
          deriveMarkdownSource(sourcePath, content),
        );
        if (instrumentation?.onSourceDerived) {
          instrumentation.onSourceDerived(sourcePath, performance.now() - derivationStartedAt);
        }
        return {
          path: sourcePath,
          contentHash,
          derivationVersion: MARKDOWN_SOURCE_DERIVATION_VERSION,
          data: derivative,
        };
      },
      captureInstrumentation,
    );
    const sourceDerivations = processed.processedSources.map(({ data }) => data);

    if (
      mode === "get" &&
      reusableGlobalData &&
      reusableManifest &&
      manifestsEqual(reusableManifest, processed.manifest) &&
      sourceDerivationsMatchManifest(reusableSourceDerivations, processed.manifest)
    ) {
      const materializationStartedAt = instrumentation?.onPublicResponseMaterialization
        ? performance.now()
        : 0;
      const data = materializeVaultIndexResponse(sourceDerivations, reusableGlobalData);
      instrumentation?.onPublicResponseMaterialization?.(
        performance.now() - materializationStartedAt,
      );
      instrumentation?.onMemoryCheckpoint?.("after-public-response-materialization");
      instrumentation?.onCacheHit?.();
      instrumentation?.onMemoryCheckpoint?.("operation-complete");
      return { data, cacheStatus: "hit" };
    }

    cachedByPath.clear();
    reusableManifest = undefined;
    reusableSourceDerivations = [];
    reusableGlobalData = undefined;
    instrumentation?.onMemoryCheckpoint?.("after-obsolete-cache-release");
    const { data, globalData } = assembleProcessedSources(
      processed,
      sourceDerivations,
      instrumentation,
    );
    await writeMachineIndexUnlocked(
      file,
      vault,
      processed.manifest,
      sourceDerivations,
      globalData,
      instrumentation,
      expectedRootHash,
    );
    instrumentation?.onMemoryCheckpoint?.("operation-complete");
    return { data, cacheStatus: "rebuilt" };
  });
}

function assembleProcessedSources(
  inputs: {
    sourceIssues: import("../src/lib/vault/indexer.js").ValidationIssue[];
    excludedPaths: string[];
  },
  sourceDerivations: StoredMarkdownSourceDerivation[],
  instrumentation?: MachineIndexInstrumentation,
): { data: VaultIndexResponse; globalData: StoredGlobalIndexData } {
  const active: Record<string, MarkdownSourceDerivation> = {};
  for (const source of sourceDerivations) {
    active[source.path] = source.data;
  }
  instrumentation?.onMemoryCheckpoint?.("after-source-derivation");

  const assemblyStartedAt = instrumentation?.onGlobalAssembly ? performance.now() : 0;
  const index = assembleIndex(active, { excludedPaths: inputs.excludedPaths });
  const { notes: _notes, ...globalIndex } = index;
  const globalData = toPersistedGlobalIndexData({
    index: globalIndex,
    issues: [...inputs.sourceIssues, ...validate(index)],
  });
  const data = materializeVaultIndexResponse(sourceDerivations, globalData);
  if (instrumentation?.onGlobalAssembly) {
    instrumentation.onGlobalAssembly(performance.now() - assemblyStartedAt);
  }
  instrumentation?.onMemoryCheckpoint?.("after-global-assembly");
  return { data, globalData };
}

async function writeMachineIndexUnlocked(
  file: string,
  vault: VaultInfo,
  manifest: StructuralIndexInputManifest,
  sourceDerivations: StoredMarkdownSourceDerivation[],
  globalData: StoredGlobalIndexData,
  instrumentation?: MachineIndexInstrumentation,
  rootPathHash?: string,
): Promise<void> {
  const stored: StoredMachineIndex = {
    kind: "arepo.machineIndex",
    version: MACHINE_INDEX_VERSION,
    derivationVersion: STRUCTURAL_INDEX_DERIVATION_VERSION,
    generatedAt: new Date().toISOString(),
    vault: {
      id: vault.id,
      displayName: vault.displayName,
      rootPathHash: rootPathHash ?? (await vaultRootHash(vault)),
    },
    manifest,
    sourceDerivations,
    globalData,
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  try {
    const serializationStartedAt = instrumentation?.onCacheSerialization ? performance.now() : 0;
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    const serializedBytes =
      instrumentation?.onCacheSerialization || instrumentation?.onCachePublication
        ? Buffer.byteLength(serialized, "utf8")
        : 0;
    if (instrumentation?.onCacheSerialization) {
      instrumentation.onCacheSerialization(
        serializedBytes,
        performance.now() - serializationStartedAt,
      );
    }
    instrumentation?.onMemoryCheckpoint?.("after-cache-serialization");
    const publicationStartedAt = instrumentation?.onCachePublication ? performance.now() : 0;
    await writeTempFileForRename(tmp, serialized);
    await fs.rename(tmp, file);
    if (instrumentation?.onCachePublication) {
      instrumentation.onCachePublication(serializedBytes, performance.now() - publicationStartedAt);
    }
    instrumentation?.onPublication?.();
    instrumentation?.onMemoryCheckpoint?.("after-cache-publication");
  } catch (error) {
    await fs.unlink(tmp).catch((unlinkError: NodeJS.ErrnoException) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
}

async function readStoredMachineIndex(
  file: string,
  instrumentation?: MachineIndexInstrumentation,
): Promise<StoredMachineIndex | undefined> {
  const startedAt = instrumentation?.onCacheRead ? performance.now() : 0;
  let raw: string | undefined;
  let rawBytes = 0;
  try {
    raw = await fs.readFile(file, "utf8");
    rawBytes = Buffer.byteLength(raw, "utf8");
    instrumentation?.onMemoryCheckpoint?.("after-cache-read");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    instrumentation?.onMemoryCheckpoint?.("after-cache-parse");
    const result = isStoredMachineIndex(parsed) ? parsed : undefined;
    instrumentation?.onMemoryCheckpoint?.("after-cache-validation");
    raw = undefined;
    instrumentation?.onMemoryCheckpoint?.("after-cache-raw-release");
    instrumentation?.onCacheRead?.(rawBytes, performance.now() - startedAt);
    return result;
  } catch {
    raw = undefined;
    instrumentation?.onCacheRead?.(rawBytes, performance.now() - startedAt);
    return undefined;
  }
}

function manifestsEqual(
  stored: StructuralIndexInputManifest,
  current: StructuralIndexInputManifest,
): boolean {
  return JSON.stringify(stored) === JSON.stringify(current);
}

function sourceDerivationsMatchManifest(
  sourceDerivations: StoredMarkdownSourceDerivation[],
  manifest: StructuralIndexInputManifest,
): boolean {
  const readable = manifest.sources.filter(
    (source): source is Extract<typeof source, { state: "readable" }> =>
      source.state === "readable",
  );
  return (
    readable.length === sourceDerivations.length &&
    readable.every((source, index) => {
      const derivative = sourceDerivations[index];
      return (
        derivative?.path === source.path &&
        derivative.contentHash === source.contentHash &&
        derivative.derivationVersion === MARKDOWN_SOURCE_DERIVATION_VERSION &&
        derivative.data.path === source.path
      );
    })
  );
}

function toPersistedMarkdownSourceDerivation(
  data: MarkdownSourceDerivation,
): MarkdownSourceDerivation {
  return JSON.parse(JSON.stringify(data)) as MarkdownSourceDerivation;
}

function toPersistedGlobalIndexData(data: StoredGlobalIndexData): StoredGlobalIndexData {
  return JSON.parse(JSON.stringify(data)) as StoredGlobalIndexData;
}

function materializeVaultIndexResponse(
  sourceDerivations: StoredMarkdownSourceDerivation[],
  globalData: StoredGlobalIndexData,
): VaultIndexResponse {
  const notes: Record<string, MarkdownSourceDerivation> = {};
  for (const source of sourceDerivations) notes[source.path] = source.data;
  return {
    index: { notes, ...globalData.index },
    issues: globalData.issues,
  };
}

function isStoredMachineIndex(value: unknown): value is StoredMachineIndex {
  if (!isRecord(value)) return false;
  return (
    value.kind === "arepo.machineIndex" &&
    value.version === MACHINE_INDEX_VERSION &&
    Number.isInteger(value.derivationVersion) &&
    typeof value.generatedAt === "string" &&
    isRecord(value.vault) &&
    typeof value.vault.id === "string" &&
    typeof value.vault.displayName === "string" &&
    typeof value.vault.rootPathHash === "string" &&
    isStructuralIndexManifest(value.manifest) &&
    isStoredSourceDerivations(value.sourceDerivations) &&
    isStoredGlobalIndexData(value.globalData)
  );
}

function isStoredSourceDerivations(value: unknown): value is StoredMarkdownSourceDerivation[] {
  if (!Array.isArray(value)) return false;
  let previousPath: string | undefined;
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      path.isAbsolute(entry.path) ||
      entry.path.includes("\\") ||
      !/^[a-f0-9]{64}$/.test(String(entry.contentHash)) ||
      !Number.isInteger(entry.derivationVersion) ||
      !isMarkdownSourceDerivation(entry.data) ||
      entry.data.path !== entry.path
    ) {
      return false;
    }
    if (previousPath !== undefined && previousPath.localeCompare(entry.path) >= 0) return false;
    previousPath = entry.path;
  }
  return true;
}

function isStructuralIndexManifest(value: unknown): value is StructuralIndexInputManifest {
  if (!isRecord(value) || !isRecord(value.scope) || !isRecord(value.scope.markdown)) return false;
  const { minDepth, maxDepth } = value.scope.markdown;
  if (
    !Number.isInteger(minDepth) ||
    (minDepth as number) < 0 ||
    (maxDepth !== null &&
      (!Number.isInteger(maxDepth) || (maxDepth as number) < (minDepth as number))) ||
    !Array.isArray(value.sources)
  ) {
    return false;
  }
  let previousPath: string | undefined;
  for (const source of value.sources) {
    if (!isRecord(source) || typeof source.path !== "string" || !source.path) return false;
    if (path.isAbsolute(source.path) || source.path.includes("\\")) return false;
    if (previousPath !== undefined && previousPath.localeCompare(source.path) >= 0) return false;
    previousPath = source.path;
    if (source.state === "readable") {
      if (!/^[a-f0-9]{64}$/.test(String(source.contentHash))) return false;
    } else if (source.state !== "unavailable" && source.state !== "excluded") {
      return false;
    }
  }
  return true;
}

function isStoredGlobalIndexData(value: unknown): value is StoredGlobalIndexData {
  if (!isRecord(value) || !isRecord(value.index) || !Array.isArray(value.issues)) return false;
  const index = value.index;
  if (
    Object.hasOwn(index, "notes") ||
    !isStringRecord(index.bySlug) ||
    !isStringArrayRecord(index.duplicateSlugs) ||
    !isStringRecord(index.byId) ||
    !isStringArrayRecord(index.duplicateIds) ||
    !isStringRecord(index.excludedBySlug) ||
    !isStringArrayRecord(index.duplicateExcludedSlugs) ||
    !isRecord(index.outgoingLinks) ||
    !isRecord(index.backlinks)
  ) {
    return false;
  }
  if (
    !isStringArray(index.excludedPaths) ||
    !Array.isArray(index.brokenLinks) ||
    !isStringArray(index.orphanNotes)
  ) {
    return false;
  }
  for (const links of Object.values(index.outgoingLinks)) {
    if (!Array.isArray(links) || !links.every(isOutgoingLink)) return false;
  }
  for (const links of Object.values(index.backlinks)) {
    if (!Array.isArray(links) || !links.every(isBacklink)) return false;
  }
  if (!index.brokenLinks.every(isBrokenLink)) return false;
  return value.issues.every(
    (issue) =>
      isRecord(issue) &&
      typeof issue.kind === "string" &&
      typeof issue.path === "string" &&
      typeof issue.message === "string" &&
      (issue.severity === "warning" || issue.severity === "error"),
  );
}

function isMarkdownSourceDerivation(value: unknown): value is MarkdownSourceDerivation {
  return (
    isRecord(value) &&
    isRecord(value.frontmatter) &&
    typeof value.path === "string" &&
    typeof value.slug === "string" &&
    typeof value.title === "string" &&
    isHeadingArray(value.headings) &&
    isStringArray(value.anchors) &&
    Array.isArray(value.wikilinks) &&
    value.wikilinks.every(isWikiLink) &&
    isStringArray(value.tags)
  );
}

function isWikiLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.target === "string" &&
    typeof value.raw === "string" &&
    isOptionalString(value.anchor) &&
    isOptionalString(value.alias)
  );
}

function isOutgoingLink(value: unknown): boolean {
  return (
    isWikiLink(value) &&
    isRecord(value) &&
    isOptionalString(value.targetPath) &&
    typeof value.status === "string" &&
    typeof value.broken === "boolean" &&
    (value.targetPaths === undefined || isStringArray(value.targetPaths))
  );
}

function isBacklink(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.fromPath === "string" &&
    isOptionalString(value.anchor) &&
    isOptionalString(value.alias)
  );
}

function isBrokenLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.fromPath === "string" &&
    typeof value.target === "string" &&
    typeof value.raw === "string" &&
    typeof value.status === "string" &&
    isOptionalString(value.anchor) &&
    isOptionalString(value.targetPath)
  );
}

function isHeadingArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (heading) =>
        isRecord(heading) &&
        typeof heading.level === "number" &&
        typeof heading.text === "string" &&
        typeof heading.anchor === "string" &&
        typeof heading.explicit === "boolean",
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isStringArrayRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function machineIndexPath(vault: VaultInfo, cwd = process.cwd()): Promise<string> {
  const appDataDir = await getAppDataDir(cwd);
  return path.join(
    appDataDir,
    "indexes",
    `${safeVaultKey(vault.id)}-${await vaultRootHash(vault)}.json`,
  );
}

export async function removeMachineIndexIfOwned(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<GeneratedDataRemoval> {
  const file = await machineIndexPath(vault, cwd);
  const indexesDir = path.join(await getAppDataDir(cwd), "indexes");
  if (!isPathInside(indexesDir, file)) {
    return {
      deletedPaths: [],
      diagnostics: [
        `Generated index path was not removed because it is outside AREPO app-data indexes: ${file}`,
      ],
    };
  }

  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return { deletedPaths: [], diagnostics: [] };
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return {
      deletedPaths: [],
      diagnostics: [
        `Generated index path was not removed because it is not a regular AREPO-owned file: ${file}`,
      ],
    };
  }

  const raw = await fs.readFile(file, "utf8");
  let stored: { kind?: unknown; version?: unknown; vault?: Record<string, unknown> };
  try {
    stored = JSON.parse(raw) as typeof stored;
  } catch {
    return {
      deletedPaths: [],
      diagnostics: [
        `Generated index path was not removed because its AREPO ownership marker could not be parsed: ${file}`,
      ],
    };
  }

  const expectedRootHash = await vaultRootHash(vault);
  if (
    stored.kind !== "arepo.machineIndex" ||
    typeof stored.version !== "number" ||
    !OWNED_MACHINE_INDEX_VERSIONS.has(stored.version) ||
    stored.vault?.id !== vault.id ||
    stored.vault?.rootPathHash !== expectedRootHash
  ) {
    return {
      deletedPaths: [],
      diagnostics: [
        `Generated index path was not removed because it could not be verified as AREPO-owned data for vault ${vault.id}: ${file}`,
      ],
    };
  }

  await fs.unlink(file);
  return { deletedPaths: [file], diagnostics: [] };
}

export async function vaultRootHash(vault: VaultInfo): Promise<string> {
  const root = await fs.realpath(vault.rootPath).catch(() => path.resolve(vault.rootPath));
  return crypto.createHash("sha256").update(root, "utf8").digest("hex").slice(0, 16);
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeVaultKey(vaultId: string): string {
  return vaultId.replace(/[^a-zA-Z0-9_-]/g, "-") || "vault";
}

async function writeTempFileForRename(file: string, content: string): Promise<void> {
  const handle = await fs.open(file, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function withIndexLock<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  locks.set(key, queued);
  await previous.catch(() => undefined);

  try {
    return await work();
  } finally {
    releaseCurrent();
    if (locks.get(key) === queued) locks.delete(key);
  }
}
