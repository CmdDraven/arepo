import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  assembleIndex,
  buildIndex,
  deriveMarkdownSource,
  validate,
  type ValidationIssue,
} from "../src/lib/vault/indexer.js";
import { sourceKindForPath, sourcePolicy } from "../src/lib/vault/sourcePolicy.js";
import { defaultVaultIndexScope, markdownPathInScope } from "./indexScope.js";
import { PublicApiError } from "./publicApiError.js";
import {
  normalizeMarkdownFilePath,
  normalizeReadableTextFilePath,
  normalizeVaultFolderPath,
  resolveInsideVault,
  toVaultPath,
} from "./path.js";
import type {
  VaultFile,
  VaultFileKind,
  VaultFileResponse,
  VaultFileWriteResponse,
  VaultIndexResponse,
  VaultIndexScope,
  VaultInfo,
} from "./types.js";

type WritePrecondition = {
  expectedMtimeMs?: unknown;
  expectedHash?: unknown;
};

const fileWriteLocks = new Map<string, Promise<void>>();
export const DEFAULT_MAX_CONCURRENT_MARKDOWN_READS = 32;

class VaultObservationUnavailableError extends PublicApiError {}
class VaultPathUnavailableError extends VaultObservationUnavailableError {}
class VaultSourceChangedDuringReadError extends VaultPathUnavailableError {}

const ISOLATABLE_SOURCE_FILESYSTEM_CODES = new Set([
  "EACCES",
  "EBUSY",
  "EIO",
  "EISDIR",
  "ELOOP",
  "ENAMETOOLONG",
  "ENOENT",
  "ENOTDIR",
  "ENXIO",
  "EOVERFLOW",
  "EPERM",
  "ESTALE",
  "ETIMEDOUT",
  "ERR_FS_FILE_TOO_LARGE",
]);

export type VaultDiscovery = {
  files: VaultFile[];
  folders: string[];
};

export type StructuralIndexSourceManifestEntry =
  | { path: string; state: "excluded" }
  | { path: string; state: "readable"; contentHash: string }
  | { path: string; state: "unavailable" };

export type StructuralIndexInputManifest = {
  scope: VaultIndexScope;
  sources: StructuralIndexSourceManifestEntry[];
};

export type CapturedStructuralIndexInputs = {
  manifest: StructuralIndexInputManifest;
  readableFiles: Record<string, string>;
  sourceIssues: ValidationIssue[];
  excludedPaths: string[];
};

export type StructuralIndexSourceDiscovery = {
  scope: VaultIndexScope;
  files: VaultFile[];
  excludedPaths: string[];
  root: string;
};

export type ProcessedStructuralIndexSources<T> = {
  manifest: StructuralIndexInputManifest;
  processedSources: Array<{ path: string; data: T }>;
  sourceIssues: ValidationIssue[];
  excludedPaths: string[];
};

export type StructuralIndexCaptureOptions = {
  maxConcurrentMarkdownReads?: number;
  afterSourcePathValidated?: (path: string) => void | Promise<void>;
  onSourceHandleOpened?: (path: string) => void;
  onSourceHandleStat?: (path: string) => void;
  afterSourceIdentityVerified?: (path: string) => void | Promise<void>;
  beforeSourceBodyRead?: (path: string) => void | Promise<void>;
  afterSourceBodyRead?: (path: string) => void | Promise<void>;
  onSourceHandleClosed?: (path: string) => void;
  onMarkdownBodyRead?: (path: string) => void;
  onMarkdownBodyReadComplete?: (path: string, bytes: number) => void;
  onMarkdownBodyReadSettled?: (path: string) => void;
  onHashCalculated?: (path: string, durationMs: number) => void;
  onDiscoveryComplete?: (fileCount: number, durationMs: number) => void;
  onSourceCaptureComplete?: (durationMs: number) => void;
  onMarkdownBodyRetained?: (path: string, bytes: number) => void;
  onMarkdownBodyReleased?: (path: string, bytes: number) => void;
  onMemoryCheckpoint?: (phase: string) => void;
};

export async function listMarkdownFiles(vault: VaultInfo): Promise<VaultFile[]> {
  return (await listSupportedTextFiles(vault)).filter(
    (file) => sourcePolicy(file.kind).contributesToMarkdownIndex,
  );
}

export async function listSupportedTextFiles(vault: VaultInfo): Promise<VaultFile[]> {
  const root = await realVaultRoot(vault);
  const out: VaultFile[] = [];
  await walk(root, async (absolutePath, dirent) => {
    if (dirent.isSymbolicLink() || !dirent.isFile()) return;
    const kind = vaultFileKind(absolutePath);
    if (!kind) return;
    const stat = await fs.lstat(absolutePath);
    out.push({
      path: toVaultPath(root, absolutePath),
      kind,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  });
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export async function listFolders(vault: VaultInfo): Promise<string[]> {
  const root = await realVaultRoot(vault);
  const folders: string[] = [];
  await walk(root, async (absolutePath, dirent) => {
    if (dirent.isSymbolicLink() || !dirent.isDirectory()) return;
    const rel = toVaultPath(root, absolutePath);
    if (rel !== ".") folders.push(rel);
  });
  return folders.sort((a, b) => a.localeCompare(b));
}

export async function discoverVaultSources(vault: VaultInfo): Promise<VaultDiscovery> {
  const root = await realVaultRoot(vault);
  const files: VaultFile[] = [];
  const folders: string[] = [];
  await walk(root, async (absolutePath, dirent) => {
    if (dirent.isSymbolicLink()) return;
    if (dirent.isDirectory()) {
      const rel = toVaultPath(root, absolutePath);
      if (rel !== ".") folders.push(rel);
      return;
    }
    if (!dirent.isFile()) return;
    const kind = vaultFileKind(absolutePath);
    if (!kind) return;
    const stat = await fs.lstat(absolutePath);
    files.push({
      path: toVaultPath(root, absolutePath),
      kind,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  folders.sort((a, b) => a.localeCompare(b));
  return { files, folders };
}

export async function readVaultFile(
  vault: VaultInfo,
  rawPath: unknown,
): Promise<VaultFileResponse> {
  if (!vault.permissions.readContent) {
    throw vaultObservationUnavailableError("Vault is not readable");
  }
  const vaultPath = normalizeReadableTextFilePath(rawPath);
  const root = await realVaultRoot(vault);
  const { content, contentHash, stat } = await readVerifiedVaultFileFromRoot(root, vaultPath);
  return {
    path: vaultPath,
    kind: requiredVaultFileKind(vaultPath),
    content,
    mtimeMs: Number(stat.mtimeNs) / 1_000_000,
    size: Number(stat.size),
    hash: contentHash,
  };
}

export async function writeVaultFile(
  vault: VaultInfo,
  rawPath: unknown,
  content: unknown,
  precondition: WritePrecondition = {},
): Promise<VaultFileWriteResponse> {
  requirePermission(vault.permissions.writeContent, "Vault is not writable");
  if (typeof content !== "string") throw publicVaultError("content must be a string");
  const vaultPath = normalizeMarkdownFilePath(rawPath);
  const absolutePath = await resolveWritableVaultPath(vault, vaultPath);
  return withFileWriteLock(absolutePath, async () => {
    await assertUnchangedIfExpected(absolutePath, precondition);
    await atomicWriteFileUnlocked(absolutePath, content);
    const stat = await fs.lstat(absolutePath);
    return {
      path: vaultPath,
      kind: "markdown" as const,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      hash: hashContent(content),
    };
  });
}

export async function createVaultFile(
  vault: VaultInfo,
  rawPath: unknown,
  content = "",
): Promise<VaultFile> {
  requirePermission(vault.permissions.writeContent, "Vault is not writable");
  if (typeof content !== "string") throw publicVaultError("content must be a string");
  const vaultPath = normalizeMarkdownFilePath(rawPath);
  const absolutePath = await resolveCreatableVaultPath(vault, vaultPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const handle = await fs.open(absolutePath, "wx");
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
  const stat = await fs.lstat(absolutePath);
  return { path: vaultPath, kind: "markdown" as const, mtimeMs: stat.mtimeMs, size: stat.size };
}

export async function createVaultFolder(
  vault: VaultInfo,
  rawPath: unknown,
): Promise<{ path: string }> {
  requirePermission(vault.permissions.writeContent, "Vault is not writable");
  const vaultPath = normalizeVaultFolderPath(rawPath);
  const absolutePath = await resolveCreatableVaultPath(vault, vaultPath);
  await fs.mkdir(absolutePath, { recursive: false });
  return { path: vaultPath };
}

export async function renameVaultPath(
  vault: VaultInfo,
  fromPath: unknown,
  toPath: unknown,
  kind: "file" | "folder" = "file",
): Promise<{ fromPath: string; toPath: string }> {
  requirePermission(vault.permissions.writeContent, "Vault is not writable");
  const from =
    kind === "folder" ? normalizeVaultFolderPath(fromPath) : normalizeMarkdownFilePath(fromPath);
  const to =
    kind === "folder" ? normalizeVaultFolderPath(toPath) : normalizeMarkdownFilePath(toPath);
  const fromAbsolute = await resolveExistingVaultPath(vault, from);
  const toAbsolute = await resolveCreatableVaultPath(vault, to);
  if (kind === "folder") {
    await assertNoSymlinksInTree(fromAbsolute);
    await assertNoImmutableSupportedSourcesInTree(fromAbsolute);
  }
  await fs.mkdir(path.dirname(toAbsolute), { recursive: true });
  try {
    await fs.lstat(toAbsolute);
    throw publicVaultError("Destination already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.rename(fromAbsolute, toAbsolute);
  return { fromPath: from, toPath: to };
}

export async function deleteVaultFile(
  vault: VaultInfo,
  rawPath: unknown,
): Promise<{ path: string }> {
  requirePermission(vault.permissions.deleteFiles, "Vault is not configured for deletes");
  const vaultPath = normalizeMarkdownFilePath(rawPath);
  const absolutePath = await resolveExistingVaultPath(vault, vaultPath);
  await fs.unlink(absolutePath);
  return { path: vaultPath };
}

export async function buildVaultIndex(vault: VaultInfo): Promise<VaultIndexResponse> {
  const discovery = await discoverStructuralIndexSources(vault);
  const processed = await processStructuralIndexSources(discovery, ({ path, content }) =>
    deriveMarkdownSource(path, content),
  );
  const index = assembleIndex(
    Object.fromEntries(processed.processedSources.map(({ path, data }) => [path, data])),
    {
      excludedPaths: processed.excludedPaths,
    },
  );
  return { index, issues: [...processed.sourceIssues, ...validate(index)] };
}

export async function discoverStructuralIndexSources(
  vault: VaultInfo,
  options: StructuralIndexCaptureOptions = {},
): Promise<StructuralIndexSourceDiscovery> {
  requirePermission(vault.permissions.readIndex, "Vault index is not readable");
  const configuredScope = vault.vaultIndexScope ?? defaultVaultIndexScope();
  const scope: VaultIndexScope = {
    markdown: {
      minDepth: configuredScope.markdown.minDepth,
      maxDepth: configuredScope.markdown.maxDepth,
    },
  };
  const discoveryStartedAt = options.onDiscoveryComplete ? performance.now() : 0;
  const allFiles = await listMarkdownFiles(vault);
  options.onDiscoveryComplete?.(allFiles.length, performance.now() - discoveryStartedAt);
  options.onMemoryCheckpoint?.("after-source-discovery");
  const files = allFiles.filter((file) => markdownPathInScope(file.path, scope));
  const excludedPaths = allFiles
    .filter((file) => !markdownPathInScope(file.path, scope))
    .map((file) => file.path);
  const root = await realVaultRoot(vault);
  return { scope, files, excludedPaths, root };
}

export async function processStructuralIndexSources<T>(
  discovery: StructuralIndexSourceDiscovery,
  processReadableSource: (source: {
    path: string;
    content: string;
    contentHash: string;
  }) => T | Promise<T>,
  options: StructuralIndexCaptureOptions = {},
): Promise<ProcessedStructuralIndexSources<T>> {
  const { scope, files, excludedPaths, root } = discovery;
  const sourceIssues: ValidationIssue[] = [];
  const sources: StructuralIndexSourceManifestEntry[] = excludedPaths.map((path) => ({
    path,
    state: "excluded",
  }));
  const captureStartedAt = options.onSourceCaptureComplete ? performance.now() : 0;
  const outcomes = await mapWithConcurrency(
    files,
    options.maxConcurrentMarkdownReads ?? DEFAULT_MAX_CONCURRENT_MARKDOWN_READS,
    async (file) => {
      let content: string;
      let contentHash: string;
      let bytes: number;
      try {
        ({ content, contentHash, bytes } = await readVerifiedVaultFileFromRoot(
          root,
          file.path,
          options,
        ));
        options.onMarkdownBodyReadComplete?.(file.path, bytes);
      } catch (error) {
        if (!isIsolatableIndexSourceFailure(error)) throw error;
        return { path: file.path, state: "unavailable" as const };
      }

      options.onMarkdownBodyRetained?.(file.path, bytes);
      try {
        const data = await processReadableSource({ path: file.path, content, contentHash });
        return { path: file.path, state: "readable" as const, contentHash, data };
      } finally {
        options.onMarkdownBodyReleased?.(file.path, bytes);
      }
    },
  );

  const processedSources: Array<{ path: string; data: T }> = [];
  for (const outcome of outcomes) {
    if (outcome.state === "unavailable") {
      sources.push({ path: outcome.path, state: "unavailable" });
      sourceIssues.push({
        kind: "source-unreadable",
        path: outcome.path,
        message: "Source file could not be read.",
        severity: "error",
      });
    } else {
      sources.push({
        path: outcome.path,
        state: "readable",
        contentHash: outcome.contentHash,
      });
      processedSources.push({ path: outcome.path, data: outcome.data });
    }
  }
  sources.sort((a, b) => a.path.localeCompare(b.path));
  options.onSourceCaptureComplete?.(performance.now() - captureStartedAt);
  options.onMemoryCheckpoint?.("after-source-processing");
  return {
    manifest: { scope, sources },
    processedSources,
    sourceIssues,
    excludedPaths,
  };
}

export async function captureStructuralIndexInputs(
  vault: VaultInfo,
  options: StructuralIndexCaptureOptions = {},
): Promise<CapturedStructuralIndexInputs> {
  const discovery = await discoverStructuralIndexSources(vault, options);
  const { scope, files, excludedPaths, root } = discovery;
  const readableFiles: Record<string, string> = {};
  const sourceIssues: ValidationIssue[] = [];
  const sources: StructuralIndexSourceManifestEntry[] = excludedPaths.map((path) => ({
    path,
    state: "excluded",
  }));
  const captureStartedAt = options.onSourceCaptureComplete ? performance.now() : 0;
  const reads = await mapWithConcurrency(
    files,
    options.maxConcurrentMarkdownReads ?? DEFAULT_MAX_CONCURRENT_MARKDOWN_READS,
    async (file) => {
      try {
        const { content, contentHash, bytes } = await readVerifiedVaultFileFromRoot(
          root,
          file.path,
          options,
        );
        options.onMarkdownBodyReadComplete?.(file.path, bytes);
        options.onMarkdownBodyRetained?.(file.path, bytes);
        return {
          path: file.path,
          content,
          contentHash,
        };
      } catch (error) {
        if (!isIsolatableIndexSourceFailure(error)) throw error;
        return { path: file.path, content: undefined };
      }
    },
  );
  for (const read of reads) {
    if (read.content === undefined) {
      sources.push({ path: read.path, state: "unavailable" });
      sourceIssues.push({
        kind: "source-unreadable",
        path: read.path,
        message: "Source file could not be read.",
        severity: "error",
      });
    } else {
      readableFiles[read.path] = read.content;
      sources.push({
        path: read.path,
        state: "readable",
        contentHash: read.contentHash,
      });
    }
  }
  sources.sort((a, b) => a.path.localeCompare(b.path));
  options.onSourceCaptureComplete?.(performance.now() - captureStartedAt);
  options.onMemoryCheckpoint?.("after-source-capture");
  return { manifest: { scope, sources }, readableFiles, sourceIssues, excludedPaths };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  requestedLimit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(items.length, Math.floor(requestedLimit)));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstFailure: unknown;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        if (firstFailure !== undefined) return;
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        try {
          results[index] = await work(items[index]);
        } catch (error) {
          if (firstFailure === undefined) firstFailure = error;
          return;
        }
      }
    }),
  );
  if (firstFailure !== undefined) throw firstFailure;
  return results;
}

export function buildVaultIndexFromInputs(
  inputs: CapturedStructuralIndexInputs,
): VaultIndexResponse {
  const index = buildIndex(inputs.readableFiles, { excludedPaths: inputs.excludedPaths });
  return { index, issues: [...inputs.sourceIssues, ...validate(index)] };
}

export async function atomicWriteFile(absolutePath: string, content: string): Promise<void> {
  return withFileWriteLock(absolutePath, () => atomicWriteFileUnlocked(absolutePath, content));
}

async function atomicWriteFileUnlocked(absolutePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const directory = path.dirname(absolutePath);
  const tmp = path.join(
    directory,
    `.${path.basename(absolutePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const existingMode = await fs
    .stat(absolutePath)
    .then((stat) => stat.mode)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0o666;
      throw error;
    });
  try {
    const handle = await fs.open(tmp, "wx", existingMode);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, absolutePath);
    await syncDirectory(directory);
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined);
    throw error;
  }
}

async function walk(
  dir: string,
  visit: (absolutePath: string, dirent: import("node:fs").Dirent) => Promise<void>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".arepo") continue;
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(dir, entry.name);
    await visit(absolutePath, entry);
    if (entry.isDirectory()) await walk(absolutePath, visit);
  }
}

function requirePermission(allowed: boolean, message: string): void {
  if (!allowed) throw publicVaultError(message);
}

async function realVaultRoot(vault: VaultInfo): Promise<string> {
  const root = await fs.realpath(vault.rootPath);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory()) {
    throw vaultObservationUnavailableError("Vault root is not a directory");
  }
  return root;
}

async function resolveExistingVaultPath(vault: VaultInfo, vaultPath: string): Promise<string> {
  const root = await realVaultRoot(vault);
  return resolveExistingVaultPathFromRoot(root, vaultPath);
}

async function resolveExistingVaultPathFromRoot(root: string, vaultPath: string): Promise<string> {
  const absolutePath = resolveInsideVault(root, vaultPath);
  await assertNoSymlinkSegments(root, vaultPath, false);
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    throw vaultPathUnavailableError("Symlinks are not allowed inside vault paths");
  }
  const real = await fs.realpath(absolutePath);
  ensureInside(root, real);
  return absolutePath;
}

type VaultFileIdentity = {
  dev: bigint;
  ino: bigint;
};

type ResolvedExistingVaultFile = {
  absolutePath: string;
  identity: VaultFileIdentity;
};

type VerifiedVaultFileRead = {
  content: string;
  contentHash: string;
  bytes: number;
  stat: import("node:fs").BigIntStats;
};

async function resolveExistingVaultFileFromRoot(
  root: string,
  vaultPath: string,
): Promise<ResolvedExistingVaultFile> {
  const absolutePath = resolveInsideVault(root, vaultPath);
  await assertNoSymlinkSegments(root, vaultPath, false);
  const stat = await fs.lstat(absolutePath, { bigint: true });
  if (stat.isSymbolicLink()) {
    throw vaultPathUnavailableError("Symlinks are not allowed inside vault paths");
  }
  if (!stat.isFile()) {
    throw vaultPathUnavailableError("Vault source is not a regular file");
  }
  const real = await fs.realpath(absolutePath);
  ensureInside(root, real);
  const realStat = await fs.lstat(real, { bigint: true });
  if (!realStat.isFile() || !sameVaultFileIdentity(stat, realStat)) {
    throw vaultSourceChangedDuringReadError();
  }
  return { absolutePath, identity: fileIdentity(stat) };
}

async function readVerifiedVaultFileFromRoot(
  root: string,
  vaultPath: string,
  options: StructuralIndexCaptureOptions = {},
): Promise<VerifiedVaultFileRead> {
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let handle: import("node:fs/promises").FileHandle | undefined;
    try {
      const resolved = await resolveExistingVaultFileFromRoot(root, vaultPath);
      await options.afterSourcePathValidated?.(vaultPath);
      handle = await fs.open(resolved.absolutePath, sourceReadOpenFlags());
      options.onSourceHandleOpened?.(vaultPath);
      const openedStat = await handle.stat({ bigint: true });
      options.onSourceHandleStat?.(vaultPath);
      if (!openedStat.isFile() || !sameVaultFileIdentity(resolved.identity, openedStat)) {
        throw vaultSourceChangedDuringReadError();
      }
      await options.afterSourceIdentityVerified?.(vaultPath);
      options.onMarkdownBodyRead?.(vaultPath);
      try {
        await options.beforeSourceBodyRead?.(vaultPath);
        const body = await handle.readFile();
        await options.afterSourceBodyRead?.(vaultPath);
        const hashStartedAt = options.onHashCalculated ? performance.now() : 0;
        const contentHash = hashBytes(body);
        if (options.onHashCalculated) {
          options.onHashCalculated(vaultPath, performance.now() - hashStartedAt);
        }
        return {
          content: body.toString("utf8"),
          contentHash,
          bytes: body.byteLength,
          stat: openedStat,
        };
      } finally {
        options.onMarkdownBodyReadSettled?.(vaultPath);
      }
    } catch (error) {
      if (attempt + 1 < maxAttempts && isRetryableSourceReplacement(error)) continue;
      throw error;
    } finally {
      if (handle) {
        await handle.close();
        options.onSourceHandleClosed?.(vaultPath);
      }
    }
  }
  throw new Error("Unreachable verified vault read state");
}

function sourceReadOpenFlags(): number {
  if (process.platform === "win32") return fsConstants.O_RDONLY;
  return fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
}

function fileIdentity(stat: import("node:fs").BigIntStats): VaultFileIdentity {
  return { dev: stat.dev, ino: stat.ino };
}

function sameVaultFileIdentity(expected: VaultFileIdentity, actual: VaultFileIdentity): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

function isRetryableSourceReplacement(error: unknown): boolean {
  if (error instanceof VaultSourceChangedDuringReadError) return false;
  const code =
    typeof error === "object" && error !== null ? (error as NodeJS.ErrnoException).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP" || code === "EISDIR";
}

function isIsolatableIndexSourceFailure(error: unknown): boolean {
  if (error instanceof VaultPathUnavailableError) return true;
  return isExpectedSourceFilesystemFailure(error);
}

export function isExpectedVaultObservationFailure(error: unknown): boolean {
  return (
    error instanceof VaultObservationUnavailableError || isExpectedSourceFilesystemFailure(error)
  );
}

function isExpectedSourceFilesystemFailure(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null ? (error as NodeJS.ErrnoException).code : undefined;
  return typeof code === "string" && ISOLATABLE_SOURCE_FILESYSTEM_CODES.has(code);
}

async function resolveWritableVaultPath(vault: VaultInfo, vaultPath: string): Promise<string> {
  const root = await realVaultRoot(vault);
  const absolutePath = resolveInsideVault(root, vaultPath);
  await assertNoSymlinkSegments(root, vaultPath, true);
  const stat = await fs.lstat(absolutePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (stat?.isSymbolicLink()) {
    throw vaultPathUnavailableError("Symlinks are not allowed inside vault paths");
  }
  if (stat) {
    const real = await fs.realpath(absolutePath);
    ensureInside(root, real);
  }
  return absolutePath;
}

async function resolveCreatableVaultPath(vault: VaultInfo, vaultPath: string): Promise<string> {
  const root = await realVaultRoot(vault);
  const absolutePath = resolveInsideVault(root, vaultPath);
  await assertNoSymlinkSegments(root, vaultPath, true);
  return absolutePath;
}

async function assertNoSymlinkSegments(
  root: string,
  vaultPath: string,
  allowMissingLeaf: boolean,
): Promise<void> {
  const segments = vaultPath.split("/");
  let current = root;
  const maxExistingSegments = allowMissingLeaf ? segments.length - 1 : segments.length;
  for (let i = 0; i < maxExistingSegments; i++) {
    current = path.join(current, segments[i]);
    const stat = await fs.lstat(current).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      throw vaultPathUnavailableError("Symlinks are not allowed inside vault paths");
    }
    if (!stat.isDirectory() && i < maxExistingSegments - 1) {
      throw vaultPathUnavailableError("Vault path parent is not a directory");
    }
  }
}

async function assertNoSymlinksInTree(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw publicVaultError("Symlinks are not allowed inside vault paths");
    }
    if (entry.isDirectory()) await assertNoSymlinksInTree(absolutePath);
  }
}

async function assertNoImmutableSupportedSourcesInTree(root: string): Promise<void> {
  await walk(root, async (absolutePath, dirent) => {
    if (!dirent.isFile()) return;
    const kind = sourceKindForPath(absolutePath);
    if (kind && !sourcePolicy(kind).mutable) {
      throw publicVaultError(
        "Folder rename is not allowed because the folder contains read-only source content",
      );
    }
  });
}

function ensureInside(root: string, absolutePath: string): void {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw publicVaultError("Resolved path escapes the configured vault root");
  }
}

async function assertUnchangedIfExpected(
  absolutePath: string,
  precondition: WritePrecondition,
): Promise<void> {
  const expectedHash =
    typeof precondition.expectedHash === "string" ? precondition.expectedHash : undefined;
  const expectedMtimeMs =
    typeof precondition.expectedMtimeMs === "number" ? precondition.expectedMtimeMs : undefined;
  if (!expectedHash && typeof expectedMtimeMs !== "number") return;

  const content = await fs.readFile(absolutePath, "utf8");
  const stat = await fs.lstat(absolutePath);
  const hashMatches = expectedHash ? hashContent(content) === expectedHash : true;
  const mtimeMatches =
    typeof expectedMtimeMs === "number" ? Math.abs(stat.mtimeMs - expectedMtimeMs) < 1 : true;
  if (!hashMatches || !mtimeMatches) {
    throw new PublicApiError(
      409,
      "File changed on disk since it was opened. Reload before saving.",
      {
        code: "CONFLICT",
      },
    );
  }
}

export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function hashBytes(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function vaultFileKind(filePath: string): VaultFileKind | null {
  return sourceKindForPath(filePath);
}

function requiredVaultFileKind(filePath: string): VaultFileKind {
  const kind = vaultFileKind(filePath);
  if (!kind) throw publicVaultError("Unsupported readable source file suffix");
  return kind;
}

function publicVaultError(message: string): PublicApiError {
  return new PublicApiError(400, message, { code: "invalid-vault-operation" });
}

function vaultPathUnavailableError(message: string): VaultPathUnavailableError {
  return new VaultPathUnavailableError(400, message, { code: "invalid-vault-operation" });
}

function vaultSourceChangedDuringReadError(): VaultSourceChangedDuringReadError {
  return new VaultSourceChangedDuringReadError(400, "Vault source changed while being read", {
    code: "invalid-vault-operation",
  });
}

function vaultObservationUnavailableError(message: string): VaultObservationUnavailableError {
  return new VaultObservationUnavailableError(400, message, {
    code: "invalid-vault-operation",
  });
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP") throw error;
  } finally {
    await handle.close();
  }
}

async function withFileWriteLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = fileWriteLocks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  fileWriteLocks.set(key, queued);
  await previous.catch(() => undefined);

  try {
    return await work();
  } finally {
    releaseCurrent();
    if (fileWriteLocks.get(key) === queued) fileWriteLocks.delete(key);
  }
}
