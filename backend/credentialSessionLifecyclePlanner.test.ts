import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { planCredentialSessionLifecycle } from "./credentialSessionLifecyclePlanner.js";
import { routeRequest, type RequestLike } from "./server.js";

const sensitiveValues = [
  "Authorization",
  "Bearer secret-token",
  "secret-token",
  "cookie=session-secret",
  "session-secret",
  "csrf-secret",
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
  "http://evil.example",
  "localhost:8733",
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

test("credential creation requires stronger confirmation and audit", () => {
  for (const operation of ["create-local-admin-credential", "create-user-credential"] as const) {
    const plan = planCredentialSessionLifecycle({ operation });

    assert.ok(plan.results.includes("requires-stronger-confirmation"));
    assert.ok(plan.results.includes("requires-audit"));
    assert.ok(plan.requirementCodes.includes("credential-creation"));
    assert.equal(plan.createsCredential, false);
  }
});

test("credential rotation requires stronger confirmation and audit", () => {
  const plan = planCredentialSessionLifecycle({ operation: "rotate-credential-secret" });

  assert.ok(plan.results.includes("requires-stronger-confirmation"));
  assert.ok(plan.results.includes("requires-audit"));
  assert.ok(plan.requirementCodes.includes("credential-rotation"));
});

test("credential revocation requires stronger confirmation audit and revocation compatibility", () => {
  const plan = planCredentialSessionLifecycle({ operation: "revoke-credential" });

  assert.ok(plan.results.includes("requires-stronger-confirmation"));
  assert.ok(plan.results.includes("requires-audit"));
  assert.ok(plan.results.includes("requires-revocation-check"));
  assert.ok(plan.requirementCodes.includes("credential-revocation"));
});

test("credential verification requires verifier availability and revocation checks", () => {
  const plan = planCredentialSessionLifecycle({ operation: "verify-credential" });

  assert.ok(plan.results.includes("requires-revocation-check"));
  assert.ok(plan.requirementCodes.includes("verifier-availability-required"));
  assert.ok(plan.requirementCodes.includes("sanitized-failure-handling-required"));
  assert.ok(plan.requirementCodes.includes("credential-verification"));
});

test("browser session creation requires cookie policy expiry revocation browser guard and audit", () => {
  const plan = planCredentialSessionLifecycle({ operation: "create-browser-session" });

  assert.ok(plan.results.includes("requires-audit"));
  assert.ok(plan.results.includes("requires-expiry"));
  assert.ok(plan.results.includes("requires-revocation-check"));
  assert.ok(plan.results.includes("requires-origin-csrf-guard"));
  assert.ok(plan.requirementCodes.includes("secure-cookie-policy-required"));
  assert.equal(plan.createsSession, false);
  assert.equal(plan.setsCookie, false);
});

test("browser session renewal requires expiry and revocation checks", () => {
  const plan = planCredentialSessionLifecycle({ operation: "renew-browser-session" });

  assert.ok(plan.results.includes("requires-expiry"));
  assert.ok(plan.results.includes("requires-revocation-check"));
  assert.ok(plan.requirementCodes.includes("browser-session-renewal"));
});

test("browser session revocation requires audit and revocation compatibility", () => {
  const plan = planCredentialSessionLifecycle({ operation: "revoke-browser-session" });

  assert.ok(plan.results.includes("requires-audit"));
  assert.ok(plan.results.includes("requires-revocation-check"));
  assert.ok(plan.requirementCodes.includes("browser-session-revocation"));
});

test("API token creation rotation and revocation require confirmation audit expiry classification and revocation checks", () => {
  for (const operation of ["create-api-token", "rotate-api-token", "revoke-api-token"] as const) {
    const plan = planCredentialSessionLifecycle({ operation });

    assert.ok(plan.results.includes("requires-stronger-confirmation"));
    assert.ok(plan.results.includes("requires-audit"));
    assert.ok(plan.results.includes("requires-expiry"));
    assert.ok(plan.results.includes("requires-revocation-check"));
    assert.ok(plan.requirementCodes.includes("long-lived-token-classification-required"));
    assert.equal(plan.createsToken, false);
  }
});

test("revoke-all operations require stronger confirmation and audit", () => {
  for (const operation of ["revoke-all-for-actor", "emergency-revoke-all"] as const) {
    const plan = planCredentialSessionLifecycle({ operation });

    assert.ok(plan.results.includes("requires-stronger-confirmation"));
    assert.ok(plan.results.includes("requires-audit"));
    assert.ok(plan.results.includes("requires-revocation-check"));
  }

  const emergency = planCredentialSessionLifecycle({ operation: "emergency-revoke-all" });
  assert.ok(emergency.requirementCodes.includes("local-only-safety-required"));
});

test("unsupported lifecycle operation classes return stable reason codes", () => {
  const plan = planCredentialSessionLifecycle({ operation: "mint-secret-cookie" });

  assert.deepEqual(plan.results, ["unsupported-operation", "not-implemented"]);
  assert.deepEqual(plan.requirementCodes, ["planning-only", "unsupported-operation"]);
});

test("planner output is sanitized and invariant flags remain false", () => {
  const plan = planCredentialSessionLifecycle({ operation: "create-browser-session" });
  const serialized = JSON.stringify(plan);

  for (const value of sensitiveValues) {
    assert.equal(serialized.includes(value), false, `unexpected sensitive value: ${value}`);
  }
  assert.equal(plan.createsCredential, false);
  assert.equal(plan.createsSession, false);
  assert.equal(plan.createsToken, false);
  assert.equal(plan.setsCookie, false);
  assert.equal(plan.enforcementActive, false);
  assert.equal(plan.protectedModeOperational, false);
  assert.equal(plan.networkExposureSafe, false);
});

test("credential session lifecycle planner is not imported by active server handlers", async (t) => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("credentialSessionLifecyclePlanner"), false);
  assert.equal(serverSource.includes("planCredentialSessionLifecycle"), false);
});

test("current V1 endpoint behavior is unchanged by lifecycle planning", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-lifecycle-plan-");
  const appDataDir = await makeTestTempDir(t, "arepo-lifecycle-plan-data-");
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
});
