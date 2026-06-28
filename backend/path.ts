import path from "node:path";

export type VaultPathKind = "file" | "folder";

export function normalizeVaultPath(input: unknown, kind: VaultPathKind): string {
  if (typeof input !== "string") {
    throw new Error("Path must be a string");
  }

  const raw = input.trim();
  if (!raw) throw new Error("Path is required");
  if (raw.includes("\\")) throw new Error("Use POSIX-style / separators");
  if (raw.startsWith("/") || path.win32.isAbsolute(raw)) {
    throw new Error("Absolute paths are not allowed inside a vault");
  }
  if (raw.includes("//")) throw new Error("Duplicate slashes are not allowed");

  const segments = raw.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Path segments must be non-empty and cannot be . or ..");
  }

  const normalized = path.posix.normalize(raw);
  if (normalized !== raw) throw new Error("Path must already be normalized");
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error("Path cannot escape the vault");
  }

  if (kind === "file" && !normalized.toLowerCase().endsWith(".md")) {
    throw new Error("Note files must use the .md extension");
  }
  if (kind === "folder" && normalized.toLowerCase().endsWith(".md")) {
    throw new Error("Folder paths must not end with .md");
  }

  return normalized;
}

export function resolveInsideVault(rootPath: string, vaultPath: string): string {
  const root = path.resolve(rootPath);
  const absolute = path.resolve(root, ...vaultPath.split("/"));
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resolved path escapes the configured vault root");
  }
  return absolute;
}

export function toVaultPath(rootPath: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(rootPath), absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File is outside the configured vault root");
  }
  return relative.split(path.sep).join("/");
}
