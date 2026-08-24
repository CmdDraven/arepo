import { loadConfig, saveConfig } from "./config.js";
import { rebuildMachineIndex } from "./indexCache.js";
import { validateVaultRoot, withVaultAvailability } from "./vaultAvailability.js";
import { ensureVaultWatcher, recordVaultIndexed, stopVaultWatcherAndWait } from "./vaultWatch.js";
import type { VaultInfo } from "./types.js";
import { PublicApiError } from "./publicApiError.js";

export type RebindVaultResult = {
  vault: VaultInfo;
  indexRebuilt: boolean;
};

export async function rebindVaultRoot(
  vaultId: string,
  rootInput: unknown,
  cwd = process.cwd(),
): Promise<RebindVaultResult> {
  const config = await loadConfig(cwd);
  const vaultIndex = config.vaults.findIndex((vault) => vault.id === vaultId);
  if (vaultIndex < 0) {
    throw new PublicApiError(400, `Unknown vault: ${vaultId}`, { code: "unknown-vault" });
  }

  const rootPath = await validateVaultRoot(rootInput);
  const previousVault = config.vaults[vaultIndex];
  const reboundVault: VaultInfo = { ...previousVault, rootPath, availability: undefined };

  await stopVaultWatcherAndWait(cwd, vaultId);
  config.vaults[vaultIndex] = reboundVault;
  try {
    await saveConfig(config, cwd);
  } catch (error) {
    await ensureVaultWatcher(previousVault, cwd).catch(() => undefined);
    throw error;
  }

  let indexRebuilt = false;
  try {
    await rebuildMachineIndex(reboundVault, cwd);
    await recordVaultIndexed(reboundVault, cwd);
    indexRebuilt = true;
  } catch {
    await ensureVaultWatcher(reboundVault, cwd).catch(() => undefined);
  }

  return {
    vault: await withVaultAvailability(reboundVault),
    indexRebuilt,
  };
}
