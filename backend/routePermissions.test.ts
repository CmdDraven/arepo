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
  "GET /api/node/auth/dry-run",
  "GET /api/node/directories",
  "POST /api/node/auth/session",
  "POST /api/node/auth/session/logout",
  "POST /api/node/auth/session/revoke-all",
  "GET /api/node/auth/csrf",
  "POST /api/node/auth/pairing/start",
  "POST /api/node/auth/pairing/complete",
  "POST /api/node/credentials/bootstrap",
  "GET /api/node/credentials",
  "POST /api/node/credentials",
  "POST /api/node/credentials/:credentialId/revoke",
  "POST /api/node/credentials/:credentialId/rotate",
  "GET /api/vaults",
  "POST /api/vaults",
  "DELETE /api/vaults/:vaultId",
  "POST /api/vaults/:vaultId/rebind",
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
  "PATCH /api/vaults/:vaultId/index-scope",
  "GET /api/vaults/:vaultId/index",
  "GET /api/vaults/:vaultId/index/filters?filter=...",
  "GET /api/vaults/:vaultId/index/search?q=...",
  "GET /api/vaults/:vaultId/index/inspect?path=...",
  "GET /api/vaults/:vaultId/enrichment/settings",
  "PUT /api/vaults/:vaultId/enrichment/settings",
  "GET /api/vaults/:vaultId/enrichment/related?path=...",
  "GET /api/vaults/:vaultId/enrichment/related/curation?path=...",
  "PUT /api/vaults/:vaultId/enrichment/related/curation",
  "DELETE /api/vaults/:vaultId/enrichment/related/curation",
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

test("vault collection discovery is authenticated then shaped by endpoint-specific grants", () => {
  const policy = policyFor("GET /api/vaults");
  assert.deepEqual(policy.requiredPermissions, []);
  assert.deepEqual(policy.conditionalPermissions, [
    {
      permissions: ["manageVaults"],
      when: "Returning full vault registration metadata, filesystem roots, or vault permissions.",
    },
  ]);
  assert.match(policy.notes, /endpoint-specific response shaping/);
  assert.match(policy.notes, /not generic planner enforcement/);
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

test("related-note enrichment requires both structural and source read grants", () => {
  const policy = policyFor("GET /api/vaults/:vaultId/enrichment/related?path=...");
  assert.equal(policy.dataAccess.generatedIndex, true);
  assert.equal(policy.dataAccess.sourceContent, true);
  assert.deepEqual(policy.requiredPermissions, ["readIndex", "readContent"]);
});

test("enrichment preferences are readable with readIndex and writable only by vault managers", () => {
  const read = policyFor("GET /api/vaults/:vaultId/enrichment/settings");
  assert.deepEqual(read.requiredPermissions, ["readIndex"]);
  assert.equal(read.dataAccess.sourceContent, false);
  const write = policyFor("PUT /api/vaults/:vaultId/enrichment/settings");
  assert.deepEqual(write.requiredPermissions, ["manageVaults"]);
  assert.equal(write.dataAccess.nodeManagement, true);
});

test("Related Notes curation is readable with readIndex and mutable with writeContent", () => {
  const read = policyFor("GET /api/vaults/:vaultId/enrichment/related/curation?path=...");
  assert.deepEqual(read.requiredPermissions, ["readIndex"]);
  assert.equal(read.dataAccess.userCuration, true);
  assert.equal(read.dataAccess.sourceContent, false);
  for (const method of ["PUT", "DELETE"] as const) {
    const write = policyFor(`${method} /api/vaults/:vaultId/enrichment/related/curation`);
    assert.deepEqual(write.requiredPermissions, ["readIndex", "writeContent"]);
    assert.equal(write.dataAccess.userCuration, true);
    assert.equal(write.dataAccess.sourceMutation, false);
  }
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

test("server directory browsing requires manageVaults without unrelated authority", () => {
  const policy = policyFor("GET /api/node/directories");
  assert.deepEqual(policy.requiredPermissions, ["manageVaults"]);
  assertDoesNotRequire(policy, "manageNode");
  assertDoesNotRequire(policy, "manageAuth");
  assert.equal(policy.dataAccess.nodeManagement, true);
  assert.equal(policy.dataAccess.sourceContent, false);
  assert.equal(policy.dataAccess.sourceMutation, false);
});

test("vault removal requires manageVaults and stronger confirmation", () => {
  const policy = policyFor("DELETE /api/vaults/:vaultId");
  assertRequires(policy, "manageVaults");
  assert.ok(policy.strongerConfirmation.includes("vaultRemoval"));
  assert.equal(policy.dataAccess.sourceContent, false);
  assert.equal(policy.dataAccess.sourceMutation, false);
});

test("vault rebind requires manageVaults and registration-level confirmation", () => {
  const policy = policyFor("POST /api/vaults/:vaultId/rebind");
  assertRequires(policy, "manageVaults");
  assert.ok(policy.strongerConfirmation.includes("vaultRegistration"));
  assert.equal(policy.dataAccess.sourceContent, false);
  assert.equal(policy.dataAccess.sourceMutation, false);
});

test("full node status diagnostics are classified as manageNode", () => {
  const policy = policyFor("GET /api/node/status");
  assertRequires(policy, "manageNode");
  assert.equal(policy.anonymousReducedStatusMayExist, true);
  assert.equal(policy.dataAccess.nodeManagement, true);
});

test("dry-run canary diagnostics are classified as manageNode with reduced future exposure", () => {
  const policy = policyFor("GET /api/node/auth/dry-run");
  assertRequires(policy, "manageNode");
  assert.equal(policy.anonymousReducedStatusMayExist, true);
  assert.equal(policy.dataAccess.nodeManagement, true);
  assert.equal(policy.dataAccess.sourceContent, false);
  assert.equal(policy.dataAccess.generatedIndex, false);
});

test("credential lifecycle routes require auth-management policy", () => {
  const bootstrap = policyFor("POST /api/node/credentials/bootstrap");
  assert.deepEqual(bootstrap.requiredPermissions, []);
  assert.equal(bootstrap.dataAccess.authManagement, true);
  assert.ok(bootstrap.strongerConfirmation.includes("authChange"));

  const list = policyFor("GET /api/node/credentials");
  assertRequires(list, "manageAuth");
  assert.equal(list.strongerConfirmation.length, 0);

  const create = policyFor("POST /api/node/credentials");
  assertRequires(create, "manageAuth");
  assert.ok(create.strongerConfirmation.includes("authChange"));

  const revoke = policyFor("POST /api/node/credentials/:credentialId/revoke");
  assertRequires(revoke, "manageAuth");
  assert.ok(revoke.strongerConfirmation.includes("tokenRevocation"));

  const rotate = policyFor("POST /api/node/credentials/:credentialId/rotate");
  assertRequires(rotate, "manageAuth");
  assert.ok(rotate.strongerConfirmation.includes("authChange"));
  assert.ok(rotate.strongerConfirmation.includes("tokenRevocation"));
});

test("browser session and pairing stubs are route-policy covered but unavailable", () => {
  for (const route of [
    "POST /api/node/auth/session",
    "POST /api/node/auth/session/logout",
    "POST /api/node/auth/session/revoke-all",
    "GET /api/node/auth/csrf",
    "POST /api/node/auth/pairing/start",
    "POST /api/node/auth/pairing/complete",
  ]) {
    const policy = policyFor(route);
    assert.deepEqual(policy.requiredPermissions, []);
    assert.equal(policy.dataAccess.authManagement, true);
    assert.equal(policy.dataAccess.sourceContent, false);
    assert.equal(policy.dataAccess.sourceMutation, false);
    assert.equal(policy.dataAccess.generatedIndex, false);
    assert.equal(policy.strongerConfirmation.length, 0);
    assert.equal(policy.networkExposureSafe, false);
  }
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
