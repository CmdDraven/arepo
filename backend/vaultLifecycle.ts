import { loadConfig, saveConfig } from "./config.js";
import { removeMachineIndexIfOwned, type GeneratedDataRemoval } from "./indexCache.js";
import { stopVaultWatcher } from "./vaultWatch.js";
import type { VaultInfo } from "./types.js";

export type GeneratedDataAction = "keep" | "discard";

export type RemovedVaultGeneratedData = GeneratedDataRemoval & {
  action: GeneratedDataAction;
};

export type RemoveVaultResult = {
  vault: VaultInfo;
  remainingVaults: VaultInfo[];
  generatedData: RemovedVaultGeneratedData;
};

export async function removeVault(
  input: { vaultId?: unknown; generatedDataAction?: unknown },
  cwd = process.cwd(),
): Promise<RemoveVaultResult> {
  const vaultId = typeof input.vaultId === "string" ? input.vaultId : "";
  if (!vaultId) throw new Error("vaultId is required");
  const generatedDataAction =
    input.generatedDataAction === "discard" ? "discard" : ("keep" as GeneratedDataAction);

  const config = await loadConfig(cwd, { validateVaultRoots: false });
  const index = config.vaults.findIndex((vault) => vault.id === vaultId);
  if (index < 0) throw new Error(`Unknown vault: ${vaultId}`);

  const [vault] = config.vaults.splice(index, 1);
  await saveConfig(config, cwd);
  stopVaultWatcher(cwd, vault.id);

  const generatedData =
    generatedDataAction === "discard"
      ? { action: generatedDataAction, ...(await removeMachineIndexIfOwned(vault, cwd)) }
      : { action: generatedDataAction, deletedPaths: [], diagnostics: [] };

  return {
    vault,
    remainingVaults: config.vaults,
    generatedData,
  };
}
