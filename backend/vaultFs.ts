import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { buildIndex, validate } from "../src/lib/vault/indexer.js";
import { normalizeVaultPath, resolveInsideVault, toVaultPath } from "./path.js";
import type { VaultFile, VaultIndexResponse, VaultInfo } from "./types.js";

type FileData = {
  path: string;
  content: string;
  mtimeMs: number;
  size: number;
  hash: string;
};

type WritePrecondition = {
  expectedMtimeMs?: unknown;
  expectedHash?: unknown;
};

export async function listMarkdownFiles(vault: VaultInfo): Promise<VaultFile[]> {
  const root = await realVaultRoot(vault);
  const out: VaultFile[] = [];
  await walk(root, async (absolutePath, dirent) => {
    if (dirent.isSymbolicLink() || !dirent.isFile() || !dirent.name.toLowerCase().endsWith(".md")) {
      return;
    }
    const stat = await fs.lstat(absolutePath);
    out.push({
      path: toVaultPath(root, absolutePath),
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

export async function readVaultFile(vault: VaultInfo, rawPath: unknown): Promise<FileData> {
  requirePermission(vault.permissions.readContent, "Vault is not readable");
  const vaultPath = normalizeVaultPath(rawPath, "file");
  const absolutePath = await resolveExistingVaultPath(vault, vaultPath);
  const [content, stat] = await Promise.all([
    fs.readFile(absolutePath, "utf8"),
    fs.lstat(absolutePath),
  ]);
  return {
    path: vaultPath,
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
): Promise<{ path: string; mtimeMs: number; size: number }> {
  requirePermission(vault.permissions.writeContent, "Vault is not writable");
  if (typeof content !== "string") throw new Error("content must be a string");
  const vaultPath = normalizeVaultPath(rawPath, "file");
  const absolutePath = await resolveWritableVaultPath(vault, vaultPath);
  await assertUnchangedIfExpected(absolutePath, precondition);
  await atomicWriteFile(absolutePath, content);
  const stat = await fs.lstat(absolutePath);
  return { path: vaultPath, mtimeMs: stat.mtimeMs, size: stat.size };
}

export async function createVaultFile(
  vault: VaultInfo,
  rawPath: unknown,
  content = "",
): Promise<{ path: string; mtimeMs: number; size: number }> {
  requirePermission(vault.permissions.writeContent, "Vault is not writable");
  if (typeof content !== "string") throw new Error("content must be a string");
  const vaultPath = normalizeVaultPath(rawPath, "file");
  const absolutePath = await resolveCreatableVaultPath(vault, vaultPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const handle = await fs.open(absolutePath, "wx");
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
  const stat = await fs.lstat(absolutePath);
  return { path: vaultPath, mtimeMs: stat.mtimeMs, size: stat.size };
}

export async function createVaultFolder(
  vault: VaultInfo,
  rawPath: unknown,
): Promise<{ path: string }> {
  requirePermission(vault.permissions.writeContent, "Vault is not writable");
  const vaultPath = normalizeVaultPath(rawPath, "folder");
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
  const from = normalizeVaultPath(fromPath, kind);
  const to = normalizeVaultPath(toPath, kind);
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
  const vaultPath = normalizeVaultPath(rawPath, "file");
  const absolutePath = await resolveExistingVaultPath(vault, vaultPath);
  await fs.unlink(absolutePath);
  return { path: vaultPath };
}

export async function buildVaultIndex(vault: VaultInfo): Promise<VaultIndexResponse> {
  requirePermission(vault.permissions.readIndex, "Vault index is not readable");
  const files = await listMarkdownFiles(vault);
  const map: Record<string, string> = {};
  await Promise.all(
    files.map(async (file) => {
      map[file.path] = await fs.readFile(await resolveExistingVaultPath(vault, file.path), "utf8");
    }),
  );
  const index = buildIndex(map);
  return { index, issues: validate(index) };
}

export async function atomicWriteFile(absolutePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const tmp = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, absolutePath);
}

async function walk(
  dir: string,
  visit: (absolutePath: string, dirent: import("node:fs").Dirent) => Promise<void>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".mdatlas") continue;
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
