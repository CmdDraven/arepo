import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  assembleIndex,
  deriveMarkdownSource,
  validate,
  type MarkdownSourceDerivation,
} from "../src/lib/vault/indexer.js";
import { getAppDataDir } from "./config.js";
import {
  captureStructuralIndexInputs,
  type CapturedStructuralIndexInputs,
  type StructuralIndexInputManifest,
} from "./vaultFs.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";

export const MACHINE_INDEX_VERSION = 4;
export const STRUCTURAL_INDEX_DERIVATION_VERSION = 1;
export const MARKDOWN_SOURCE_DERIVATION_VERSION = 1;
const OWNED_MACHINE_INDEX_VERSIONS = new Set([1, 2, 3, MACHINE_INDEX_VERSION]);
const indexOperationLocks = new Map<string, Promise<void>>();

export type StoredMarkdownSourceDerivation = {
  path: string;
  contentHash: string;
  derivationVersion: number;
  data: MarkdownSourceDerivation;
};

export type StoredMachineIndex = {
  kind: "arepo.machineIndex";
  version: 4;
  derivationVersion: number;
  generatedAt: string;
  vault: {
    id: string;
    displayName: string;
    rootPathHash: string;
  };
  manifest: StructuralIndexInputManifest;
  sourceDerivations: StoredMarkdownSourceDerivation[];
  data: VaultIndexResponse;
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
  onSourceDerived?: (path: string, durationMs: number) => void;
  onSourceDerivativeReused?: (path: string) => void;
  onGlobalAssembly?: (durationMs: number) => void;
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
    const inputs = await captureStructuralIndexInputs(vault, {
      maxConcurrentMarkdownReads: options.maxConcurrentMarkdownReads,
      onMarkdownBodyRead: instrumentation?.onMarkdownBodyRead,
      onMarkdownBodyReadComplete: instrumentation?.onMarkdownBodyReadComplete,
      onMarkdownBodyReadSettled: instrumentation?.onMarkdownBodyReadSettled,
      onHashCalculated: instrumentation?.onHashCalculated,
      onDiscoveryComplete: instrumentation?.onDiscoveryComplete,
      onSourceCaptureComplete: instrumentation?.onSourceCaptureComplete,
    });
    const stored =
      mode === "force" ? undefined : await readStoredMachineIndex(file, instrumentation);
    const expectedRootHash = await vaultRootHash(vault);
    const reusableStored =
      stored && stored.vault.id === vault.id && stored.vault.rootPathHash === expectedRootHash
        ? stored
        : undefined;

    if (
      mode === "get" &&
      reusableStored &&
      reusableStored.derivationVersion === STRUCTURAL_INDEX_DERIVATION_VERSION &&
      manifestsEqual(reusableStored.manifest, inputs.manifest) &&
      sourceDerivationsMatchManifest(reusableStored.sourceDerivations, inputs.manifest)
    ) {
      instrumentation?.onCacheHit?.();
      return { data: reusableStored.data, cacheStatus: "hit" };
    }

    const { data, sourceDerivations } = buildFromCapturedInputs(
      inputs,
      mode === "force" ? [] : (reusableStored?.sourceDerivations ?? []),
      instrumentation,
    );
    await writeMachineIndexUnlocked(
      file,
      vault,
      inputs.manifest,
      sourceDerivations,
      data,
      instrumentation,
      expectedRootHash,
    );
    return { data, cacheStatus: "rebuilt" };
  });
}

function buildFromCapturedInputs(
  inputs: CapturedStructuralIndexInputs,
  cachedSourceDerivations: StoredMarkdownSourceDerivation[],
  instrumentation?: MachineIndexInstrumentation,
): {
  data: VaultIndexResponse;
  sourceDerivations: StoredMarkdownSourceDerivation[];
} {
  const cachedByPath = new Map(cachedSourceDerivations.map((entry) => [entry.path, entry]));
  const active: Record<string, MarkdownSourceDerivation> = {};
  const sourceDerivations: StoredMarkdownSourceDerivation[] = [];
  for (const source of inputs.manifest.sources) {
    if (source.state !== "readable") continue;
    const cached = cachedByPath.get(source.path);
    let derivative: MarkdownSourceDerivation;
    if (
      cached &&
      cached.contentHash === source.contentHash &&
      cached.derivationVersion === MARKDOWN_SOURCE_DERIVATION_VERSION &&
      cached.data.path === source.path
    ) {
      derivative = cached.data;
      instrumentation?.onSourceDerivativeReused?.(source.path);
    } else {
      const body = inputs.readableFiles[source.path];
      if (body === undefined) {
        throw new Error("Readable structural source is missing its captured body.");
      }
      const derivationStartedAt = instrumentation?.onSourceDerived ? performance.now() : 0;
      derivative = toPersistedMarkdownSourceDerivation(deriveMarkdownSource(source.path, body));
      if (instrumentation?.onSourceDerived) {
        instrumentation.onSourceDerived(source.path, performance.now() - derivationStartedAt);
      }
    }
    active[source.path] = derivative;
    sourceDerivations.push({
      path: source.path,
      contentHash: source.contentHash,
      derivationVersion: MARKDOWN_SOURCE_DERIVATION_VERSION,
      data: derivative,
    });
  }

  const assemblyStartedAt = instrumentation?.onGlobalAssembly ? performance.now() : 0;
  const index = assembleIndex(active, { excludedPaths: inputs.excludedPaths });
  const data = toPersistedVaultIndexResponse({
    index,
    issues: [...inputs.sourceIssues, ...validate(index)],
  });
  if (instrumentation?.onGlobalAssembly) {
    instrumentation.onGlobalAssembly(performance.now() - assemblyStartedAt);
  }
  return { data, sourceDerivations };
}

async function writeMachineIndexUnlocked(
  file: string,
  vault: VaultInfo,
  manifest: StructuralIndexInputManifest,
  sourceDerivations: StoredMarkdownSourceDerivation[],
  data: VaultIndexResponse,
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
    data,
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
    const publicationStartedAt = instrumentation?.onCachePublication ? performance.now() : 0;
    await writeTempFileForRename(tmp, serialized);
    await fs.rename(tmp, file);
    if (instrumentation?.onCachePublication) {
      instrumentation.onCachePublication(serializedBytes, performance.now() - publicationStartedAt);
    }
    instrumentation?.onPublication?.();
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
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = isStoredMachineIndex(parsed) ? parsed : undefined;
    instrumentation?.onCacheRead?.(Buffer.byteLength(raw, "utf8"), performance.now() - startedAt);
    return result;
  } catch {
    instrumentation?.onCacheRead?.(Buffer.byteLength(raw, "utf8"), performance.now() - startedAt);
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

function toPersistedVaultIndexResponse(data: VaultIndexResponse): VaultIndexResponse {
  return JSON.parse(JSON.stringify(data)) as VaultIndexResponse;
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
    isVaultIndexResponse(value.data)
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

function isVaultIndexResponse(value: unknown): value is VaultIndexResponse {
  if (!isRecord(value) || !isRecord(value.index) || !Array.isArray(value.issues)) return false;
  const index = value.index;
  if (
    !isRecord(index.notes) ||
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
  if (!Object.values(index.notes).every(isMarkdownSourceDerivation)) return false;
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
