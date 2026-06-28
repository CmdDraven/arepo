import fs from "node:fs/promises";
import path from "node:path";
import { machineIndexPath } from "./indexCache.js";
import type { VaultInfo } from "./types.js";

export type StorageBucket = {
  fileCount: number;
  bytes: number;
};

export type VaultStorageSummary = {
  vaultId: string;
  vaultRoot: string;
  total: StorageBucket;
  markdownText: StorageBucket;
  attachments: StorageBucket;
  appDataCache: StorageBucket & {
    machineIndexBytes: number;
    files: { kind: "machine-index"; path: string; bytes: number }[];
  };
};

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd", ".txt"]);

export async function getVaultStorageSummary(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<VaultStorageSummary> {
  const root = await realVaultRoot(vault);
  const vaultBuckets = await scanVaultStorage(root);
  const appDataCache = await vaultAppDataCacheStorage(vault, cwd);
  return {
    vaultId: vault.id,
    vaultRoot: root,
    ...vaultBuckets,
    appDataCache,
  };
}

export async function scanVaultStorage(root: string): Promise<{
  total: StorageBucket;
  markdownText: StorageBucket;
  attachments: StorageBucket;
}> {
  const realRoot = await fs.realpath(root);
  const total = emptyBucket();
  const markdownText = emptyBucket();
  const attachments = emptyBucket();

  await walkRegularFiles(realRoot, async (absolutePath, stat) => {
    increment(total, stat.size);
    if (isMarkdownOrTextFile(absolutePath)) {
      increment(markdownText, stat.size);
    } else {
      increment(attachments, stat.size);
    }
  });

  return { total, markdownText, attachments };
}

export async function safeFileSize(absolutePath: string): Promise<number> {
  const stat = await fs.lstat(absolutePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) return 0;
  return stat.size;
}

async function vaultAppDataCacheStorage(
  vault: VaultInfo,
  cwd: string,
): Promise<VaultStorageSummary["appDataCache"]> {
  const indexPath = await machineIndexPath(vault, cwd);
  const machineIndexBytes = await safeFileSize(indexPath);
  return {
    fileCount: machineIndexBytes > 0 ? 1 : 0,
    bytes: machineIndexBytes,
    machineIndexBytes,
    files:
      machineIndexBytes > 0
        ? [{ kind: "machine-index", path: indexPath, bytes: machineIndexBytes }]
        : [],
  };
}

async function walkRegularFiles(
  dir: string,
  visit: (absolutePath: string, stat: import("node:fs").Stats) => Promise<void>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walkRegularFiles(absolutePath, visit);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    await visit(absolutePath, stat);
  }
}

async function realVaultRoot(vault: VaultInfo): Promise<string> {
  const root = await fs.realpath(vault.rootPath);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory()) throw new Error("Vault root is not a directory");
  return root;
}

function isMarkdownOrTextFile(file: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function emptyBucket(): StorageBucket {
  return { fileCount: 0, bytes: 0 };
}

function increment(bucket: StorageBucket, bytes: number): void {
  bucket.fileCount += 1;
  bucket.bytes += bytes;
}
