import type { VaultScopedGrant } from "./credentialStore.js";
import type { RoutePermission } from "./routePermissions.js";
import type { NodeInfo, OperationalVaultSummary, VaultListResponse } from "./types.js";

export type VaultListAccess =
  | { authMode: "disabled" }
  | {
      authMode: "protected";
      nodePermissions: readonly RoutePermission[];
      vaultGrants: readonly VaultScopedGrant[];
    };

const VAULT_DISCOVERY_PERMISSIONS = new Set<RoutePermission>([
  "readIndex",
  "readContent",
  "writeContent",
  "deleteFiles",
]);

export function projectVaultList(node: NodeInfo, access: VaultListAccess): VaultListResponse {
  if (access.authMode === "disabled" || access.nodePermissions.includes("manageVaults")) {
    return { ...node, vaultView: "management", vaults: node.vaults };
  }

  const visibleVaultIds = new Set(
    access.vaultGrants
      .filter((grant) =>
        grant.permissions.some((permission) => VAULT_DISCOVERY_PERMISSIONS.has(permission)),
      )
      .map((grant) => grant.vaultId),
  );
  const vaults: OperationalVaultSummary[] = node.vaults
    .filter((vault) => visibleVaultIds.has(vault.id))
    .map((vault) => ({
      id: vault.id,
      displayName: vault.displayName,
      ...(vault.availability ? { availability: vault.availability } : {}),
    }));
  return { ...node, vaultView: "operational", vaults };
}
