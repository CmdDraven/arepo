import path from "node:path";
import { sourceKindForPath, sourcePolicy } from "../src/lib/vault/sourcePolicy.js";
import { PublicApiError } from "./publicApiError.js";

function normalizeVaultRelativePath(input: unknown): string {
  if (typeof input !== "string") {
    throw invalidPath("Path must be a string");
  }

  const raw = input.trim();
  if (!raw) throw invalidPath("Path is required");
  if (raw.includes("\\")) throw invalidPath("Use POSIX-style / separators");
  if (raw.startsWith("/") || path.win32.isAbsolute(raw)) {
    throw invalidPath("Absolute paths are not allowed inside a vault");
  }
  if (raw.includes("//")) throw invalidPath("Duplicate slashes are not allowed");

  const segments = raw.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw invalidPath("Path segments must be non-empty and cannot be . or ..");
  }

  const normalized = path.posix.normalize(raw);
  if (normalized !== raw) throw invalidPath("Path must already be normalized");
  if (normalized.startsWith("../") || normalized === "..") {
    throw invalidPath("Path cannot escape the vault");
  }

  return normalized;
}

export function normalizeReadableTextFilePath(input: unknown): string {
  const normalized = normalizeVaultRelativePath(input);
  if (!sourceKindForPath(normalized)) {
    throw invalidPath("Readable source files must use .md, .txt, or the .arepo-chat.json suffix");
  }
  return normalized;
}

export function normalizeMarkdownFilePath(input: unknown): string {
  const normalized = normalizeVaultRelativePath(input);
  const kind = sourceKindForPath(normalized);
  if (kind !== "markdown" || !sourcePolicy(kind).mutable) {
    throw invalidPath("Mutable note files must use the .md extension");
  }
  return normalized;
}

export function normalizeVaultFolderPath(input: unknown): string {
  const normalized = normalizeVaultRelativePath(input);
  if (normalized.toLowerCase().endsWith(".md")) {
    throw invalidPath("Folder paths must not end with .md");
  }
  return normalized;
}

export function resolveInsideVault(rootPath: string, vaultPath: string): string {
  const root = path.resolve(rootPath);
  const absolute = path.resolve(root, ...vaultPath.split("/"));
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw invalidPath("Resolved path escapes the configured vault root");
  }
  return absolute;
}

export function toVaultPath(rootPath: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(rootPath), absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw invalidPath("File is outside the configured vault root");
  }
  return relative.split(path.sep).join("/");
}

function invalidPath(message: string): PublicApiError {
  return new PublicApiError(400, message, { code: "invalid-vault-path" });
}
