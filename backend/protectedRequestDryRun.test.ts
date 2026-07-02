import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getProtectedRequestDryRunStatus,
  resetProtectedRequestDryRunDiagnostics,
} from "./protectedRequestDryRun.js";
import { routeRequest, type RequestLike } from "./server.js";
import type { LocalNodeRuntimeStatus } from "./types.js";

const bearerMaterial = "dry-run-bearer-token-material";
const sessionMaterial = "dry-run-session-secret-material";

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

async function writeConfig(
  cwd: string,
  appDataDir: string,
  auth: Record<string, unknown> = { mode: "disabled" },
): Promise<void> {
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: {
        nodeId: "local",
        displayName: "Local Node",
        mode: "local",
        apiVersion: 1,
      },
      appDataDir,
      auth,
      vaults: [],
    }),
    "utf8",
  );
}

async function workspace(
  auth: Record<string, unknown> = { mode: "disabled" },
): Promise<{ cwd: string; appDataDir: string }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-dry-run-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-dry-run-data-"));
  await writeConfig(cwd, appDataDir, auth);
  return { cwd, appDataDir };
}

test("default config does not mount dry-run middleware", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd } = await workspace();

  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
      cookie: `arepo_session=${sessionMaterial}`,
    }),
    cwd,
  );
  const statusResponse = await routeRequest(request("GET", "/api/node/status"), cwd);
  const status = statusResponse.body as LocalNodeRuntimeStatus;

  assert.equal(response.status, 200);
  assert.deepEqual((response.body as { vaults: unknown[] }).vaults, []);
  assert.equal(status.requestPolicy.dryRunMiddlewareConfigured, false);
  assert.equal(status.requestPolicy.dryRunMiddlewareMounted, false);
  assert.equal(status.requestPolicy.dryRunRunCount, 0);
  assert.equal(getProtectedRequestDryRunStatus({}).dryRunRunCount, 0);
});

test("explicit dry-run config mounts observation only and calls the protected request pipeline", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd } = await workspace({ mode: "disabled", dryRunRequestPolicy: true });

  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
    }),
    cwd,
  );
  const dryRun = getProtectedRequestDryRunStatus({ dryRunRequestPolicy: true });

  assert.equal(response.status, 200);
  assert.equal(dryRun.dryRunMiddlewareConfigured, true);
  assert.equal(dryRun.dryRunMiddlewareMounted, true);
  assert.equal(dryRun.dryRunObservationOnly, true);
  assert.equal(dryRun.dryRunRunCount, 1);
  assert.equal(dryRun.lastDryRunResult?.path, "/api/vaults");
  assert.equal(dryRun.lastDryRunResult?.status, "wouldDeny");
  assert.equal(dryRun.lastDryRunResult?.enforcementActive, false);
  assert.equal(dryRun.lastDryRunResult?.networkExposureSafe, false);
});

test("mounted dry-run middleware never rejects requests or sets cookies", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd } = await workspace({ mode: "disabled", dryRunRequestPolicy: true });

  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
      cookie: `arepo_session=${sessionMaterial}`,
    }),
    cwd,
  );
  const serializedBody = JSON.stringify(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers?.["set-cookie"], undefined);
  assert.equal(serializedBody.includes("credentialId"), false);
  assert.equal(serializedBody.includes("actorKind"), false);
  assert.equal(serializedBody.includes("auth"), false);
});

test("mounted dry-run middleware does not create credentials sessions or audit files", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd, appDataDir } = await workspace({ mode: "disabled", dryRunRequestPolicy: true });

  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
      cookie: `arepo_session=${sessionMaterial}`,
    }),
    cwd,
  );

  assert.equal(response.status, 200);
  await assert.rejects(() => fs.access(path.join(appDataDir, "auth")), /ENOENT/);
});

test("dry-run diagnostics are sanitized and report inactive enforcement", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd } = await workspace({ mode: "disabled", dryRunRequestPolicy: true });

  await routeRequest(
    request("GET", "/api/vaults?token=query-secret", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
      cookie: `arepo_session=${sessionMaterial}`,
      origin: "http://localhost:8733",
    }),
    cwd,
  );
  const statusResponse = await routeRequest(request("GET", "/api/node/status"), cwd);
  const status = statusResponse.body as LocalNodeRuntimeStatus;
  const serialized = JSON.stringify(status.requestPolicy);

  assert.equal(status.requestPolicy.dryRunMiddlewareConfigured, true);
  assert.equal(status.requestPolicy.dryRunMiddlewareMounted, true);
  assert.equal(status.requestPolicy.enforcementActive, false);
  assert.equal(status.requestPolicy.credentialVerificationActive, false);
  assert.equal(status.requestPolicy.auditRequestLoggingActive, false);
  assert.equal(status.requestPolicy.revocationChecksActive, false);
  assert.equal(status.requestPolicy.csrfOriginEnforcementActive, false);
  assert.equal(status.requestPolicy.networkExposureSafe, false);
  assert.equal(serialized.includes(bearerMaterial), false);
  assert.equal(serialized.includes(sessionMaterial), false);
  assert.equal(serialized.includes("query-secret"), false);
  assert.equal(serialized.includes(`Bearer ${bearerMaterial}`), false);
  assert.equal(serialized.includes("arepo_session"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("salt"), false);
});

test("non-local bind remains unsafe when dry-run is mounted", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd } = await workspace({ mode: "disabled", dryRunRequestPolicy: true });
  const originalHost = process.env.AREPO_HOST;
  process.env.AREPO_HOST = "0.0.0.0";
  try {
    const response = await routeRequest(request("GET", "/api/node/status"), cwd);
    const status = response.body as LocalNodeRuntimeStatus;

    assert.equal(response.status, 200);
    assert.equal(status.runtime.localOnlyMode, false);
    assert.match(status.runtime.startupWarnings[0] ?? "", /no authentication/);
    assert.equal(status.requestPolicy.dryRunMiddlewareMounted, true);
    assert.equal(status.requestPolicy.enforcementActive, false);
    assert.equal(status.requestPolicy.networkExposureSafe, false);
    assert.equal(status.protectedModeStartup.nonLocalBindWithDisabledAuth, true);
    assert.equal(status.protectedModeStartup.networkExposureSafe, false);
  } finally {
    if (originalHost === undefined) {
      delete process.env.AREPO_HOST;
    } else {
      process.env.AREPO_HOST = originalHost;
    }
  }
});

test("requested protected mode remains unavailable when dry-run is mounted", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd } = await workspace({ mode: "protected", dryRunRequestPolicy: true });

  const response = await routeRequest(request("GET", "/api/node/status"), cwd);
  const status = response.body as LocalNodeRuntimeStatus;

  assert.equal(response.status, 200);
  assert.equal(status.auth.mode, "disabled");
  assert.equal(status.auth.requestedMode, "protected");
  assert.equal(status.auth.enforcement, "none");
  assert.equal(status.auth.protectedModeAvailable, false);
  assert.equal(status.requestPolicy.dryRunMiddlewareMounted, true);
  assert.equal(status.requestPolicy.enforcementActive, false);
  assert.equal(status.requestPolicy.networkExposureSafe, false);
  assert.equal(status.protectedModeStartup.protectedModeAvailable, false);
  assert.equal(status.protectedModeStartup.protectedModeMayStart, false);
});
