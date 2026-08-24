import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { planAuditRequirement } from "./auditRequirementPlanner.js";
import { routeRequest, type RequestLike } from "./server.js";

const sensitiveValues = [
  "Authorization",
  "Bearer secret-token",
  "secret-token",
  "cookie=session-secret",
  "session-secret",
  "credential-123",
  "session-123",
  "token-123",
  "event-123",
  "verifierHash",
  "salt",
  "/home/user/vault",
  "/tmp/arepo-vault/Notes/private.md",
  "Notes/private.md",
  "source document body",
  "http://localhost:8733",
];

function request(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): RequestLike {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      yield* payload;
    },
  };
}

test("auth attempts require audit", () => {
  const plan = planAuditRequirement({ operation: "auth-attempt" });

  assert.equal(plan.status, "required");
  assert.equal(plan.auditRequired, true);
  assert.ok(plan.reasonCodes.includes("auth-attempt"));
});

test("credential creation and revocation require audit", () => {
  for (const operation of ["credential-created", "credential-revoked"] as const) {
    const plan = planAuditRequirement({ operation });
    assert.equal(plan.status, "required");
    assert.equal(plan.auditRequired, true);
    assert.ok(plan.reasonCodes.includes("credential-lifecycle"));
  }
});

test("session and token lifecycle operations require audit", () => {
  for (const operation of [
    "session-created",
    "session-renewed",
    "session-revoked",
    "token-created",
    "token-revoked",
  ] as const) {
    const plan = planAuditRequirement({ operation });
    assert.equal(plan.status, "required");
    assert.equal(plan.auditRequired, true);
    assert.ok(
      plan.reasonCodes.includes("session-lifecycle") ||
        plan.reasonCodes.includes("token-lifecycle"),
    );
  }
});

test("node secret rotation requires audit", () => {
  const plan = planAuditRequirement({ operation: "node-secret-rotated" });

  assert.equal(plan.status, "required");
  assert.equal(plan.auditRequired, true);
  assert.ok(plan.reasonCodes.includes("node-secret-rotation"));
});

test("vault registration removal and permission changes require audit", () => {
  for (const operation of [
    "vault-registered",
    "vault-removed",
    "vault-permissions-changed",
  ] as const) {
    const plan = planAuditRequirement({ operation });
    assert.equal(plan.status, "required");
    assert.equal(plan.auditRequired, true);
  }

  const routePlan = planAuditRequirement({
    request: { method: "POST", routePattern: "/api/vaults" },
  });
  assert.equal(routePlan.status, "required");
  assert.equal(routePlan.operation, "vault-registered");
});

test("vault rebind requires vault-lifecycle audit planning", () => {
  const plan = planAuditRequirement({
    request: { method: "POST", routePattern: "/api/vaults/:vaultId/rebind" },
  });
  assert.equal(plan.status, "required");
  assert.equal(plan.auditRequired, true);
  assert.equal(plan.operation, "vault-rebound");
  assert.ok(plan.reasonCodes.includes("vault-lifecycle"));
});

test("source file create write rename delete require audit", () => {
  for (const requestShape of [
    { method: "POST" as const, routePattern: "/api/vaults/:vaultId/file" },
    { method: "PUT" as const, routePattern: "/api/vaults/:vaultId/file?path=..." },
    { method: "POST" as const, routePattern: "/api/vaults/:vaultId/rename" },
    { method: "DELETE" as const, routePattern: "/api/vaults/:vaultId/file?path=..." },
  ]) {
    const plan = planAuditRequirement({ request: requestShape });
    assert.equal(plan.status, "required");
    assert.equal(plan.auditRequired, true);
    assert.ok(plan.reasonCodes.includes("source-mutation"));
  }
});

test("conflict overwrite requires audit", () => {
  const plan = planAuditRequirement({
    request: {
      method: "PUT",
      routePattern: "/api/vaults/:vaultId/file?path=...",
      conflictOverwrite: true,
    },
  });

  assert.equal(plan.status, "required");
  assert.equal(plan.auditRequired, true);
  assert.equal(plan.operation, "conflict-overwritten");
  assert.ok(plan.reasonCodes.includes("conflict-overwrite"));
});

test("security rejections and authorization denial require audit", () => {
  for (const operation of [
    "path-rejected",
    "origin-rejected",
    "csrf-rejected",
    "authorization-denied",
  ] as const) {
    const plan = planAuditRequirement({ operation });
    assert.equal(plan.status, "required");
    assert.equal(plan.auditRequired, true);
    assert.ok(
      plan.reasonCodes.includes("security-rejection") ||
        plan.reasonCodes.includes("authorization-denied"),
    );
  }
});

test("emergency reset and remote node lifecycle require audit", () => {
  for (const operation of [
    "emergency-local-reset",
    "remote-node-registered",
    "remote-node-removed",
  ] as const) {
    const plan = planAuditRequirement({ operation });
    assert.equal(plan.status, "required");
    assert.equal(plan.auditRequired, true);
  }
});

test("safe generated-index reads are deliberately not required", () => {
  for (const requestShape of [
    { method: "GET" as const, routePattern: "/api/vaults/:vaultId/index" },
    { method: "GET" as const, routePattern: "/api/vaults/:vaultId/index/search?q=..." },
    { method: "GET" as const, routePattern: "/api/vaults/:vaultId/files" },
  ]) {
    const plan = planAuditRequirement({ request: requestShape });
    assert.equal(plan.status, "not-required");
    assert.equal(plan.auditRequired, false);
    assert.ok(plan.reasonCodes.includes("generated-index-read"));
  }
});

test("source-content reads are deliberately recommended", () => {
  const plan = planAuditRequirement({
    request: { method: "GET", routePattern: "/api/vaults/:vaultId/file?path=..." },
  });

  assert.equal(plan.status, "recommended");
  assert.equal(plan.auditRequired, false);
  assert.equal(plan.operation, "source-content-read");
  assert.ok(plan.reasonCodes.includes("source-content-read"));
});

test("unknown routes and unsupported operations return stable reason codes", () => {
  const unknown = planAuditRequirement({
    request: { method: "GET", routePattern: "/api/unknown/private" },
  });
  const unsupported = planAuditRequirement({ operation: "unknown-sensitive-thing" });

  assert.equal(unknown.status, "unknown-route");
  assert.deepEqual(unknown.reasonCodes, ["unknown-route"]);
  assert.equal(unsupported.status, "unsupported-operation");
  assert.deepEqual(unsupported.reasonCodes, ["unsupported-operation"]);
});

test("planner output is sanitized and invariant flags remain false", () => {
  const plan = planAuditRequirement({
    operation: "file-written",
    request: {
      method: "PUT",
      routePattern: "/api/vaults/:vaultId/file?path=...",
      conflictOverwrite: true,
    },
  });
  const serialized = JSON.stringify(plan);

  for (const value of sensitiveValues) {
    assert.equal(serialized.includes(value), false, `unexpected sensitive value: ${value}`);
  }
  assert.equal(plan.enforcementActive, false);
  assert.equal(plan.protectedModeOperational, false);
  assert.equal(plan.networkExposureSafe, false);
});

test("audit requirement planner is not imported by active server handlers", async (t) => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("auditRequirementPlanner"), false);
  assert.equal(serverSource.includes("planAuditRequirement"), false);
});

test("current V1 endpoint behavior does not write audit logs because of this planner", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-audit-plan-");
  const appDataDir = await makeTestTempDir(t, "arepo-audit-plan-data-");
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: { nodeId: "local", displayName: "Local Node", mode: "local", apiVersion: 1 },
      appDataDir,
      vaults: [],
    }),
    "utf8",
  );

  const response = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.equal(response.status, 200);
  await assert.rejects(() => fs.access(path.join(appDataDir, "auth", "audit")), /ENOENT/);
});
