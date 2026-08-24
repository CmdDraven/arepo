import test from "node:test";
import assert from "node:assert/strict";
import { projectVaultList } from "./vaultListVisibility.js";
import type { NodeInfo, VaultInfo } from "./types.js";

const vaults: VaultInfo[] = [
  vault("vault-a", "Visible A", "/synthetic/private/a"),
  vault("vault-b", "Hidden B", "/synthetic/private/b"),
  vault("vault-c", "Visible C", "/synthetic/private/c"),
];
const node: NodeInfo = {
  nodeId: "local",
  displayName: "Local Node",
  mode: "local",
  apiVersion: 1,
  vaults,
};

test("disabled mode preserves the full management vault view", () => {
  const result = projectVaultList(node, { authMode: "disabled" });
  assert.equal(result.vaultView, "management");
  assert.deepEqual(result.vaults, vaults);
});

test("scoped protected view includes any granted vault and omits registration metadata", () => {
  const result = projectVaultList(node, {
    authMode: "protected",
    nodePermissions: [],
    vaultGrants: [
      { vaultId: "vault-a", permissions: ["readIndex"] },
      { vaultId: "vault-c", permissions: ["readContent"] },
    ],
  });
  assert.deepEqual(result, {
    nodeId: "local",
    displayName: "Local Node",
    mode: "local",
    apiVersion: 1,
    vaultView: "operational",
    vaults: [
      { id: "vault-a", displayName: "Visible A", availability: { status: "available" } },
      { id: "vault-c", displayName: "Visible C", availability: { status: "available" } },
    ],
  });
  assert.equal(JSON.stringify(result).includes("/synthetic/private"), false);
});

test("protected credentials without grants receive an empty operational collection", () => {
  const result = projectVaultList(node, {
    authMode: "protected",
    nodePermissions: [],
    vaultGrants: [],
  });
  assert.equal(result.vaultView, "operational");
  assert.deepEqual(result.vaults, []);
});

test("manageVaults preserves the complete management view without other node permissions", () => {
  const result = projectVaultList(node, {
    authMode: "protected",
    nodePermissions: ["manageVaults"],
    vaultGrants: [],
  });
  assert.equal(result.vaultView, "management");
  assert.deepEqual(result.vaults, vaults);
});

function vault(id: string, displayName: string, rootPath: string): VaultInfo {
  return {
    id,
    displayName,
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
    vaultIndexScope: { markdown: { minDepth: 0, maxDepth: null } },
    availability: { status: "available" },
  };
}
