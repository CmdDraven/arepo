import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { buildIndex, validate } from "../src/lib/vault/indexer.js";
import { defaultVaultIndexScope, markdownPathInScope } from "./indexScope.js";
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
  VaultInfo,
} from "./types.js";

type WritePrecondition = {
  expectedMtimeMs?: unknown;
  expectedHash?: unknown;
};

const fileWriteLocks = new Map<string, Promise<void>>();

export async function listMarkdownFiles(vault: VaultInfo): Promise<VaultFile[]> {
  return (await listSupportedTextFiles(vault)).filter((file) => file.kind === "markdown");
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

export async function readVaultFile(
  vault: VaultInfo,
  rawPath: unknown,
): Promise<VaultFileResponse> {
  requirePermission(vault.permissions.readContent, "Vault is not readable");
  const vaultPath = normalizeReadableTextFilePath(rawPath);
  const absolutePath = await resolveExistingVaultPath(vault, vaultPath);
  const [content, stat] = await Promise.all([
    fs.readFile(absolutePath, "utf8"),
    fs.lstat(absolutePath),
  ]);
  return {
    path: vaultPath,
    kind: requiredVaultFileKind(vaultPath),
    content,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    hash: hashContent(content),
  };
}

export async function writeVaultFile(
  vault: VaultInfo,
  rawPath: unknown,
  content: unknown,
  precondition: WritePrecondition = {},
): Promise<VaultFileWriteResponse> {
  requirePermission(vault.permissions.writeContent, "Vault is not writable");
  if (typeof content !== "string") throw new Error("content must be a string");
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
  if (typeof content !== "string") throw new Error("content must be a string");
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
  if (kind === "folder") await assertNoSymlinksInTree(fromAbsolute);
  await fs.mkdir(path.dirname(toAbsolute), { recursive: true });
  try {
    await fs.lstat(toAbsolute);
    throw new Error("Destination already exists");
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
  requirePermission(vault.permissions.readIndex, "Vault index is not readable");
  const scope = vault.vaultIndexScope ?? defaultVaultIndexScope();
  const allFiles = await listMarkdownFiles(vault);
  const files = allFiles.filter((file) => markdownPathInScope(file.path, scope));
  const excludedPaths = allFiles
    .filter((file) => !markdownPathInScope(file.path, scope))
    .map((file) => file.path);
  const map: Record<string, string> = {};
  await Promise.all(
    files.map(async (file) => {
      map[file.path] = await fs.readFile(await resolveExistingVaultPath(vault, file.path), "utf8");
    }),
  );
  const index = buildIndex(map, { excludedPaths });
  return { index, issues: validate(index) };
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
  if (!allowed) throw new Error(message);
}

async function realVaultRoot(vault: VaultInfo): Promise<string> {
  const root = await fs.realpath(vault.rootPath);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory()) throw new Error("Vault root is not a directory");
  return root;
}

async function resolveExistingVaultPath(vault: VaultInfo, vaultPath: string): Promise<string> {
  const root = await realVaultRoot(vault);
  const absolutePath = resolveInsideVault(root, vaultPath);
  await assertNoSymlinkSegments(root, vaultPath, false);
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) throw new Error("Symlinks are not allowed inside vault paths");
  const real = await fs.realpath(absolutePath);
  ensureInside(root, real);
  return absolutePath;
}

async function resolveWritableVaultPath(vault: VaultInfo, vaultPath: string): Promise<string> {
  const root = await realVaultRoot(vault);
  const absolutePath = resolveInsideVault(root, vaultPath);
  await assertNoSymlinkSegments(root, vaultPath, true);
  const stat = await fs.lstat(absolutePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (stat?.isSymbolicLink()) throw new Error("Symlinks are not allowed inside vault paths");
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
    if (stat.isSymbolicLink()) throw new Error("Symlinks are not allowed inside vault paths");
    if (!stat.isDirectory() && i < maxExistingSegments - 1) {
      throw new Error("Vault path parent is not a directory");
    }
  }
}

async function assertNoSymlinksInTree(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlinks are not allowed inside vault paths");
    if (entry.isDirectory()) await assertNoSymlinksInTree(absolutePath);
  }
}

function ensureInside(root: string, absolutePath: string): void {
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resolved path escapes the configured vault root");
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
    const error = new Error("File changed on disk since it was opened. Reload before saving.");
    (error as NodeJS.ErrnoException).code = "CONFLICT";
    throw error;
  }
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function vaultFileKind(filePath: string): VaultFileKind | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".txt")) return "plain-text";
  if (lower.endsWith(".arepo-chat.json")) return "chat-json";
  return null;
}

function requiredVaultFileKind(filePath: string): VaultFileKind {
  const kind = vaultFileKind(filePath);
  if (!kind) throw new Error("Unsupported readable source file suffix");
  return kind;
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
