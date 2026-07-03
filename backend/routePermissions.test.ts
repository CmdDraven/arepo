import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  PROTECTED_ROUTE_POLICIES,
  ROUTE_PERMISSION_VOCABULARY,
  type ProtectedRoutePolicy,
  type RoutePermission,
} from "./routePermissions.js";

const currentBackendRoutes = [
  "OPTIONS *",
  "GET /api/health",
  "GET /api/node/status",
  "GET /api/vaults",
  "POST /api/vaults",
  "DELETE /api/vaults/:vaultId",
  "GET /api/vaults/:vaultId/files",
  "GET /api/vaults/:vaultId/file?path=...",
  "GET /api/vaults/:vaultId/status",
  "GET /api/vaults/:vaultId/storage",
  "PUT /api/vaults/:vaultId/file?path=...",
  "POST /api/vaults/:vaultId/file",
  "POST /api/vaults/:vaultId/folder",
  "POST /api/vaults/:vaultId/rename",
  "DELETE /api/vaults/:vaultId/file?path=...",
  "POST /api/vaults/:vaultId/reindex",
  "GET /api/vaults/:vaultId/index",
  "GET /api/vaults/:vaultId/index/filters?filter=...",
  "GET /api/vaults/:vaultId/index/search?q=...",
  "GET /api/vaults/:vaultId/index/inspect?path=...",
];

function routeKey(policy: ProtectedRoutePolicy): string {
  return `${policy.method} ${policy.routePattern}`;
}

function policyFor(route: string): ProtectedRoutePolicy {
  const policy = PROTECTED_ROUTE_POLICIES.find((item) => routeKey(item) === route);
  assert.ok(policy, `Missing route policy for ${route}`);
  return policy;
}

function assertRequires(policy: ProtectedRoutePolicy, permission: RoutePermission): void {
  assert.ok(
    policy.requiredPermissions.includes(permission),
    `${routeKey(policy)} should require ${permission}`,
  );
}

function assertDoesNotRequire(policy: ProtectedRoutePolicy, permission: RoutePermission): void {
  assert.equal(
    policy.requiredPermissions.includes(permission),
    false,
    `${routeKey(policy)} should not require ${permission}`,
  );
}

test("protected-route inventory covers every current backend endpoint", () => {
  assert.deepEqual(PROTECTED_ROUTE_POLICIES.map(routeKey).sort(), [...currentBackendRoutes].sort());
});

test("future permission vocabulary includes auth and audit permissions", () => {
  assert.deepEqual([...ROUTE_PERMISSION_VOCABULARY].sort(), [
    "deleteFiles",
    "manageAuth",
    "manageNode",
    "manageVaults",
    "readAudit",
    "readContent",
    "readIndex",
    "writeContent",
  ]);
});

test("generated-index routes require readIndex without readContent", () => {
  for (const route of [
    "GET /api/vaults/:vaultId/index",
    "GET /api/vaults/:vaultId/index/filters?filter=...",
    "GET /api/vaults/:vaultId/index/search?q=...",
    "GET /api/vaults/:vaultId/index/inspect?path=...",
  ]) {
    const policy = policyFor(route);
    assert.equal(policy.dataAccess.generatedIndex, true);
    assert.equal(policy.dataAccess.sourceContent, false);
    assertRequires(policy, "readIndex");
    assertDoesNotRequire(policy, "readContent");
  }
});

test("source file read requires readContent", () => {
  const policy = policyFor("GET /api/vaults/:vaultId/file?path=...");
  assert.equal(policy.dataAccess.sourceContent, true);
  assertRequires(policy, "readContent");
});

test("source mutations require writeContent", () => {
  for (const policy of PROTECTED_ROUTE_POLICIES.filter((item) => item.dataAccess.sourceMutation)) {
    assertRequires(policy, "writeContent");
  }
});

test("delete requires deleteFiles and stronger confirmation", () => {
  const policy = policyFor("DELETE /api/vaults/:vaultId/file?path=...");
  assertRequires(policy, "deleteFiles");
  assert.ok(policy.strongerConfirmation.includes("delete"));
});

test("vault registration requires manageVaults", () => {
  const policy = policyFor("POST /api/vaults");
  assertRequires(policy, "manageVaults");
  assert.ok(policy.strongerConfirmation.includes("vaultRegistration"));
});

test("vault removal requires manageVaults and stronger confirmation", () => {
  const policy = policyFor("DELETE /api/vaults/:vaultId");
  assertRequires(policy, "manageVaults");
  assert.ok(policy.strongerConfirmation.includes("vaultRemoval"));
  assert.equal(policy.dataAccess.sourceContent, false);
  assert.equal(policy.dataAccess.sourceMutation, false);
});

test("full node status diagnostics are classified as manageNode", () => {
  const policy = policyFor("GET /api/node/status");
  assertRequires(policy, "manageNode");
  assert.equal(policy.anonymousReducedStatusMayExist, true);
  assert.equal(policy.dataAccess.nodeManagement, true);
});

test("no route policy marks network exposure as safe", () => {
  for (const policy of PROTECTED_ROUTE_POLICIES) {
    assert.equal(policy.networkExposureSafe, false, `${routeKey(policy)} must not be network-safe`);
  }
});

test("request handling does not import route permission inventory", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("routePermissions"), false);
});
