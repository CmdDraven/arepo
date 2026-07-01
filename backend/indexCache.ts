import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getAppDataDir } from "./config.js";
import { buildVaultIndex } from "./vaultFs.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";

const MACHINE_INDEX_VERSION = 1;
const indexWriteLocks = new Map<string, Promise<void>>();

export type StoredMachineIndex = {
  kind: "arepo.machineIndex";
  version: 1;
  generatedAt: string;
  vault: {
    id: string;
    displayName: string;
    rootPathHash: string;
  };
  data: VaultIndexResponse;
};

export async function getMachineIndex(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<VaultIndexResponse> {
  return rebuildMachineIndex(vault, cwd);
}

export async function rebuildMachineIndex(
  vault: VaultInfo,
  cwd = process.cwd(),
): Promise<VaultIndexResponse> {
  const data = await buildVaultIndex(vault);
  await writeMachineIndex(vault, data, cwd);
  return data;
}

export async function writeMachineIndex(
  vault: VaultInfo,
  data: VaultIndexResponse,
  cwd = process.cwd(),
): Promise<string> {
  const file = await machineIndexPath(vault, cwd);
  await withIndexWriteLock(file, async () => {
    const stored: StoredMachineIndex = {
      kind: "arepo.machineIndex",
      version: MACHINE_INDEX_VERSION,
      generatedAt: new Date().toISOString(),
      vault: {
        id: vault.id,
        displayName: vault.displayName,
        rootPathHash: await vaultRootHash(vault),
      },
      data,
    };
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
    try {
      await writeTempFileForRename(tmp, `${JSON.stringify(stored, null, 2)}\n`);
      await fs.rename(tmp, file);
    } catch (error) {
      await fs.unlink(tmp).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== "ENOENT") {
          throw unlinkError;
        }
      });
      throw error;
    }
  });
  return file;
}

export async function machineIndexPath(vault: VaultInfo, cwd = process.cwd()): Promise<string> {
  const appDataDir = await getAppDataDir(cwd);
  return path.join(
    appDataDir,
    "indexes",
    `${safeVaultKey(vault.id)}-${await vaultRootHash(vault)}.json`,
  );
}

export async function vaultRootHash(vault: VaultInfo): Promise<string> {
  const root = await fs.realpath(vault.rootPath).catch(() => path.resolve(vault.rootPath));
  return crypto.createHash("sha256").update(root, "utf8").digest("hex").slice(0, 16);
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

async function withIndexWriteLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = indexWriteLocks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  indexWriteLocks.set(key, queued);
  await previous.catch(() => undefined);

  try {
    return await work();
  } finally {
    releaseCurrent();
    if (indexWriteLocks.get(key) === queued) {
      indexWriteLocks.delete(key);
    }
  }
}
