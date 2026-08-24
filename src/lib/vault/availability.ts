import type { VaultAvailabilityReason, VaultInfo } from "./contracts";

export function isVaultAvailable(vault: VaultInfo | null | undefined): boolean {
  return Boolean(vault && vault.availability?.status !== "unavailable");
}

export function preferredVaultId(
  vaults: readonly VaultInfo[],
  requestedId: string | null,
): string | null {
  if (requestedId && vaults.some((vault) => vault.id === requestedId)) return requestedId;
  return vaults.find((vault) => isVaultAvailable(vault))?.id ?? vaults[0]?.id ?? null;
}

export function hasVisibleVaultData(
  loadedVaultId: string | null,
  activeVault: VaultInfo | null,
): boolean {
  return Boolean(activeVault && isVaultAvailable(activeVault) && loadedVaultId === activeVault.id);
}

export function vaultAvailabilityLabel(reason: VaultAvailabilityReason): string {
  switch (reason) {
    case "root-not-found":
      return "Root not found";
    case "root-not-directory":
      return "Configured root is not a directory";
    case "root-inaccessible":
      return "Root is inaccessible";
  }
}
