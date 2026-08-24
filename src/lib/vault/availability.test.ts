import test from "node:test";
import assert from "node:assert/strict";

import {
  hasVisibleVaultData,
  isVaultAvailable,
  preferredVaultId,
  vaultAvailabilityLabel,
} from "./availability.ts";
import type { VaultInfo } from "./contracts.ts";

const permissions = {
  readIndex: true,
  readContent: true,
  writeContent: true,
  deleteFiles: false,
};

function vault(id: string, status: "available" | "unavailable"): VaultInfo {
  return {
    id,
    displayName: id,
    rootPath: `/vaults/${id}`,
    permissions,
    availability: status === "available" ? { status } : { status, reason: "root-not-found" },
  };
}

test("available and unavailable registrations coexist without losing selection", () => {
  const vaults = [vault("missing", "unavailable"), vault("working", "available")];
  assert.equal(preferredVaultId(vaults, null), "working");
  assert.equal(preferredVaultId(vaults, "missing"), "missing");
  assert.equal(isVaultAvailable(vaults[0]), false);
  assert.equal(isVaultAvailable(vaults[1]), true);
});

test("an unavailable active vault cannot expose previously loaded source state", () => {
  const missing = vault("stable-id", "unavailable");
  assert.equal(hasVisibleVaultData("stable-id", missing), false);
  assert.equal(hasVisibleVaultData("other-id", vault("working", "available")), false);
  assert.equal(hasVisibleVaultData("working", vault("working", "available")), true);
});

test("a rebound vault remains the same identity and becomes loadable when availability refreshes", () => {
  const before = vault("stable-id", "unavailable");
  const after = {
    ...before,
    rootPath: "/vaults/moved",
    availability: { status: "available" },
  } as const;
  assert.equal(before.id, after.id);
  assert.deepEqual(before.permissions, after.permissions);
  assert.equal(hasVisibleVaultData(after.id, after), true);
});

test("availability reasons have bounded user-facing labels", () => {
  assert.equal(vaultAvailabilityLabel("root-not-found"), "Root not found");
  assert.equal(vaultAvailabilityLabel("root-not-directory"), "Configured root is not a directory");
  assert.equal(vaultAvailabilityLabel("root-inaccessible"), "Root is inaccessible");
  assert.equal(JSON.stringify(vault("missing", "unavailable")).includes("ENOENT"), false);
});
