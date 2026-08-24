import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import {
  planReducedAnonymousDryRunCanary,
  planReducedAnonymousHealth,
  planReducedAnonymousNodeStatus,
} from "./reducedAnonymousStatusPlanner.js";
import { routeRequest, type RequestLike } from "./server.js";
import type { LocalNodeRuntimeStatus, ProtectedRequestDryRunCanaryStatus } from "./types.js";

const sensitiveValues = [
  "Bearer secret-token",
  "secret-token",
  "arepo_session=session-secret",
  "session-secret",
  "credential-123",
  "session-123",
  "token-123",
  "verifierHash",
  "salt",
  "markdownBody",
  "source document body",
  "/home/user/vault",
  "/tmp/arepo-vault/Notes/private.md",
  "http://localhost:8733",
  "Notes/private.md",
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

test("reduced health plan contains liveness and auth requirement fields only", () => {
  const plan = planReducedAnonymousHealth({
    publicWarnings: ["auth-required", "/home/user/vault", "non-local-bind-unsafe"],
  });
  const keys = Object.keys(plan).sort();

  assert.deepEqual(keys, [
    "apiVersion",
    "authRequired",
    "endpoint",
    "enforcementActive",
    "live",
    "networkExposureSafe",
    "ok",
    "protectedModeOperational",
    "publicWarnings",
    "reasonCodes",
    "responseKind",
    "service",
  ]);
  assert.equal(plan.endpoint, "health");
  assert.equal(plan.live, true);
  assert.equal(plan.authRequired, true);
  assert.deepEqual(plan.publicWarnings, ["auth-required", "non-local-bind-unsafe"]);
});

test("reduced node-status plan omits detailed status internals", () => {
  const plan = planReducedAnonymousNodeStatus({
    publicWarnings: ["protected-mode-required", "raw-origin:http://localhost:8733"],
  });
  const serialized = JSON.stringify(plan);

  assert.equal(plan.endpoint, "nodeStatus");
  assert.ok(plan.reasonCodes.includes("full-status-requires-auth"));
  assert.equal(serialized.includes("vaults"), false);
  assert.equal(serialized.includes("vaultId"), false);
  assert.equal(serialized.includes("rootPath"), false);
  assert.equal(serialized.includes("allowedOrigins"), false);
  assert.equal(serialized.includes("routePolicy"), false);
  assert.equal(serialized.includes("dryRunRunCount"), false);
  assert.equal(serialized.includes("storageSummary"), false);
  assertNoSensitiveMaterial(serialized);
});

test("reduced dry-run canary plan omits counters and planner internals", () => {
  const plan = planReducedAnonymousDryRunCanary({
    publicWarnings: ["protected-mode-not-operational", "cookie=session-secret"],
  });
  const serialized = JSON.stringify(plan);

  assert.equal(plan.endpoint, "dryRunCanary");
  assert.ok(plan.reasonCodes.includes("dry-run-canary-reduced"));
  assert.equal(serialized.includes("dryRunRunCount"), false);
  assert.equal(serialized.includes("dryRunAuditAppendCount"), false);
  assert.equal(serialized.includes("lastResponsePlan"), false);
  assert.equal(serialized.includes("plannedResponse"), false);
  assert.equal(serialized.includes("routePattern"), false);
  assertNoSensitiveMaterial(serialized);
});

test("all reduced plans report current scaffold truth", () => {
  for (const plan of [
    planReducedAnonymousHealth(),
    planReducedAnonymousNodeStatus(),
    planReducedAnonymousDryRunCanary(),
  ]) {
    assert.equal(plan.enforcementActive, false);
    assert.equal(plan.protectedModeOperational, false);
    assert.equal(plan.networkExposureSafe, false);
  }
});

test("reduced anonymous status planner is not imported by active server handlers", async (t) => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("reducedAnonymousStatusPlanner"), false);
  assert.equal(serverSource.includes("planReducedAnonymous"), false);
});

test("current health status and dry-run canary runtime responses remain full V1 diagnostics", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-reduced-status-");

  const health = await routeRequest(request("GET", "/api/health"), cwd);
  assert.equal(health.status, 200);
  assert.equal((health.body as { node?: unknown }).node !== undefined, true);
  assert.equal((health.body as { authRequired?: unknown }).authRequired, undefined);

  const status = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(status.status, 200);
  const statusBody = status.body as LocalNodeRuntimeStatus;
  assert.equal(Array.isArray(statusBody.vaults), true);
  assert.equal(statusBody.requestPolicy.routePolicyInventoryPresent, true);
  assert.equal(statusBody.protectedModeReadiness.readyForEnforcement, false);

  const canary = await routeRequest(request("GET", "/api/node/auth/dry-run"), cwd);
  assert.equal(canary.status, 200);
  const canaryBody = canary.body as ProtectedRequestDryRunCanaryStatus;
  assert.equal(canaryBody.diagnosticOnly, true);
  assert.equal(typeof canaryBody.dryRunRunCount, "number");
});

function assertNoSensitiveMaterial(serialized: string): void {
  for (const value of sensitiveValues) {
    assert.equal(serialized.includes(value), false, `unexpected sensitive value: ${value}`);
  }
}
