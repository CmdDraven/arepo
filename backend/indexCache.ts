import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getAppDataDir } from "./config.js";
import { buildVaultIndex } from "./vaultFs.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";

const MACHINE_INDEX_VERSION = 1;

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
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
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
