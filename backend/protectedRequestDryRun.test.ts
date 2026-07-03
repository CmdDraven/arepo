import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readAuthAuditEvents,
  serializeAuthAuditEventJsonl,
  type AuthAuditEvent,
} from "./authAudit.js";
import { resolveAuthStoragePaths } from "./credentialStore.js";
import {
  getProtectedRequestDryRunStatus,
  resetProtectedRequestDryRunDiagnostics,
} from "./protectedRequestDryRun.js";
import { routeRequest, type RequestLike } from "./server.js";
import type { LocalNodeRuntimeStatus, ProtectedRequestDryRunCanaryStatus } from "./types.js";

const bearerMaterial = "dry-run-bearer-token-material";
const sessionMaterial = "dry-run-session-secret-material";
const sourceBodyMaterial = "dry-run-source-document-body";

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
  assert.equal(status.requestPolicy.dryRunAuditConfigured, false);
  assert.equal(status.requestPolicy.dryRunAuditAppendCount, 0);
  assert.equal(status.requestPolicy.dryRunRunCount, 0);
  assert.equal(getProtectedRequestDryRunStatus({}).dryRunRunCount, 0);
});

test("dry-run canary endpoint reports disabled observation status by default", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd } = await workspace();

  const response = await routeRequest(
    request("GET", "/api/node/auth/dry-run", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
      cookie: `arepo_session=${sessionMaterial}`,
    }),
    cwd,
  );
  const body = response.body as ProtectedRequestDryRunCanaryStatus;
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.diagnosticOnly, true);
  assert.equal(body.dryRunConfigured, false);
  assert.equal(body.dryRunMounted, false);
  assert.equal(body.dryRunAuditConfigured, false);
  assert.equal(body.dryRunRunCount, 0);
  assert.equal(body.dryRunAuditAppendCount, 0);
  assert.equal(body.enforcementActive, false);
  assert.equal(body.protectedModeOperational, false);
  assert.equal(body.networkExposureSafe, false);
  assert.equal(serialized.includes(bearerMaterial), false);
  assert.equal(serialized.includes(sessionMaterial), false);
});

test("dry-run canary endpoint reports sanitized mounted dry-run status", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd } = await workspace({ mode: "disabled", dryRunRequestPolicy: true });
  const filesystemPath = "/tmp/arepo-sensitive-vault/Notes/secret.md";

  const response = await routeRequest(
    request("GET", "/api/node/auth/dry-run", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
      cookie: `arepo_session=${sessionMaterial}`,
      "x-source-body": sourceBodyMaterial,
      "x-vault-root": filesystemPath,
    }),
    cwd,
  );
  const body = response.body as ProtectedRequestDryRunCanaryStatus;
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(body.dryRunConfigured, true);
  assert.equal(body.dryRunMounted, true);
  assert.equal(body.dryRunAuditConfigured, false);
  assert.equal(body.dryRunRunCount, 1);
  assert.equal(body.lastDryRunStatus?.method, "GET");
  assert.equal(body.lastDryRunStatus?.status, "wouldDeny");
  assert.equal(body.enforcementActive, false);
  assert.equal(body.protectedModeOperational, false);
  assert.equal(body.networkExposureSafe, false);
  assert.equal(serialized.includes("path"), false);
  assert.equal(serialized.includes("/api/node/auth/dry-run"), false);
  assert.equal(serialized.includes(filesystemPath), false);
  assert.equal(serialized.includes(bearerMaterial), false);
  assert.equal(serialized.includes(sessionMaterial), false);
  assert.equal(serialized.includes(`Bearer ${bearerMaterial}`), false);
  assert.equal(serialized.includes(`"authorization":"Bearer ${bearerMaterial}"`), false);
  assert.equal(serialized.includes("cookie"), false);
  assert.equal(serialized.includes("arepo_session"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("salt"), false);
  assert.equal(serialized.includes(sourceBodyMaterial), false);
});

test("dry-run canary endpoint reports sanitized audit append status", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd, appDataDir } = await workspace({
    mode: "disabled",
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });
  const paths = resolveAuthStoragePaths(appDataDir);
  await fs.mkdir(path.dirname(paths.auditEvents), { recursive: true });
  await fs.writeFile(paths.auditEvents, "{ corrupt jsonl\n", "utf8");

  const response = await routeRequest(
    request("GET", "/api/node/auth/dry-run", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
      cookie: `arepo_session=${sessionMaterial}`,
    }),
    cwd,
  );
  const body = response.body as ProtectedRequestDryRunCanaryStatus;
  const parsed = await readAuthAuditEvents(paths.auditEvents);
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(body.dryRunConfigured, true);
  assert.equal(body.dryRunMounted, true);
  assert.equal(body.dryRunAuditConfigured, true);
  assert.equal(body.dryRunAuditAppendCount, 1);
  assert.equal(body.lastAuditStatus?.status, "written");
  assert.equal(body.enforcementActive, false);
  assert.equal(body.protectedModeOperational, false);
  assert.equal(body.networkExposureSafe, false);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.events.length, 1);
  assert.equal(serialized.includes(bearerMaterial), false);
  assert.equal(serialized.includes(sessionMaterial), false);
  assert.equal(serialized.includes(`Bearer ${bearerMaterial}`), false);
  assert.equal(serialized.includes(`"authorization":"Bearer ${bearerMaterial}"`), false);
  assert.equal(serialized.includes("cookie"), false);
  assert.equal(serialized.includes("eventId"), false);
  assert.equal(serialized.includes(paths.auditEvents), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("salt"), false);
});

test("dry-run audit flag alone does nothing unless request-policy dry-run is enabled", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd, appDataDir } = await workspace({ mode: "disabled", dryRunAudit: true });

  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
    }),
    cwd,
  );
  const dryRun = getProtectedRequestDryRunStatus({ dryRunAudit: true });

  assert.equal(response.status, 200);
  assert.equal(dryRun.dryRunMiddlewareConfigured, false);
  assert.equal(dryRun.dryRunAuditConfigured, true);
  assert.equal(dryRun.dryRunRunCount, 0);
  assert.equal(dryRun.dryRunAuditAppendCount, 0);
  await assert.rejects(() => fs.access(path.join(appDataDir, "auth")), /ENOENT/);
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
  assert.equal(dryRun.dryRunAuditConfigured, false);
  assert.equal(dryRun.dryRunAuditAppendCount, 0);
  assert.equal(dryRun.lastDryRunAuditStatus?.status, "skipped");
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

test("dry-run audit appends sanitized JSONL events when explicitly enabled", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd, appDataDir } = await workspace({
    mode: "disabled",
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });

  const response = await routeRequest(
    request(
      "GET",
      "/api/vaults?token=query-secret",
      { markdownBody: sourceBodyMaterial },
      {
        authorization: `Bearer ${bearerMaterial}`,
        cookie: `arepo_session=${sessionMaterial}`,
      },
    ),
    cwd,
  );
  const paths = resolveAuthStoragePaths(appDataDir);
  const parsed = await readAuthAuditEvents(paths.auditEvents);
  const dryRun = getProtectedRequestDryRunStatus({
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });
  const serialized = JSON.stringify(parsed.events);

  assert.equal(response.status, 200);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.events.length, 1);
  assert.equal(dryRun.dryRunAuditConfigured, true);
  assert.equal(dryRun.dryRunAuditAppendCount, 1);
  assert.equal(dryRun.lastDryRunAuditStatus?.status, "written");
  assert.equal(serialized.includes(bearerMaterial), false);
  assert.equal(serialized.includes(sessionMaterial), false);
  assert.equal(serialized.includes("query-secret"), false);
  assert.equal(serialized.includes(sourceBodyMaterial), false);
  assert.equal(serialized.includes(`Bearer ${bearerMaterial}`), false);
  assert.equal(serialized.includes("arepo_session"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("salt"), false);
});

test("dry-run audit append preserves existing JSONL events", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd, appDataDir } = await workspace({
    mode: "disabled",
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });
  const paths = resolveAuthStoragePaths(appDataDir);
  const existing: AuthAuditEvent = {
    eventId: "evt-existing",
    timestamp: "2026-07-03T00:00:00.000Z",
    kind: "auth.attempt.rejected",
    result: "rejected",
    reasonCode: "seed",
  };
  await fs.mkdir(path.dirname(paths.auditEvents), { recursive: true });
  await fs.writeFile(paths.auditEvents, serializeAuthAuditEventJsonl(existing), "utf8");

  const response = await routeRequest(request("GET", "/api/vaults"), cwd);
  const parsed = await readAuthAuditEvents(paths.auditEvents);

  assert.equal(response.status, 200);
  assert.equal(parsed.events[0]?.eventId, "evt-existing");
  assert.equal(parsed.events.length, 2);
});

test("corrupt existing JSONL lines do not prevent dry-run audit append", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const { cwd, appDataDir } = await workspace({
    mode: "disabled",
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });
  const paths = resolveAuthStoragePaths(appDataDir);
  await fs.mkdir(path.dirname(paths.auditEvents), { recursive: true });
  await fs.writeFile(paths.auditEvents, "{bad json\n", "utf8");

  const response = await routeRequest(request("GET", "/api/vaults"), cwd);
  const parsed = await readAuthAuditEvents(paths.auditEvents);

  assert.equal(response.status, 200);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.events.length, 1);
  assert.equal(
    getProtectedRequestDryRunStatus({ dryRunRequestPolicy: true, dryRunAudit: true })
      .lastDryRunAuditStatus?.status,
    "written",
  );
});

test("dry-run audit write failure is diagnostic only", async () => {
  resetProtectedRequestDryRunDiagnostics();
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-dry-run-"));
  const appDataDir = path.join(cwd, "app-data-file");
  await fs.writeFile(appDataDir, "not a directory", "utf8");
  await writeConfig(cwd, appDataDir, {
    mode: "disabled",
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });

  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: `Bearer ${bearerMaterial}`,
    }),
    cwd,
  );
  const dryRun = getProtectedRequestDryRunStatus({
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });

  assert.equal(response.status, 200);
  assert.equal(dryRun.dryRunAuditAppendCount, 0);
  assert.equal(dryRun.lastDryRunAuditStatus?.status, "failed");
  assert.equal(dryRun.lastDryRunAuditStatus?.enforcementActive, false);
  assert.equal(dryRun.lastDryRunAuditStatus?.networkExposureSafe, false);
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
  assert.equal(status.requestPolicy.dryRunAuditConfigured, false);
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
  const { cwd } = await workspace({
    mode: "disabled",
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });
  const originalHost = process.env.AREPO_HOST;
  process.env.AREPO_HOST = "0.0.0.0";
  try {
    const response = await routeRequest(request("GET", "/api/node/status"), cwd);
    const status = response.body as LocalNodeRuntimeStatus;

    assert.equal(response.status, 200);
    assert.equal(status.runtime.localOnlyMode, false);
    assert.match(status.runtime.startupWarnings[0] ?? "", /no authentication/);
    assert.equal(status.requestPolicy.dryRunMiddlewareMounted, true);
    assert.equal(status.requestPolicy.dryRunAuditConfigured, true);
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
  const { cwd } = await workspace({
    mode: "protected",
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });

  const response = await routeRequest(request("GET", "/api/node/status"), cwd);
  const status = response.body as LocalNodeRuntimeStatus;

  assert.equal(response.status, 200);
  assert.equal(status.auth.mode, "disabled");
  assert.equal(status.auth.requestedMode, "protected");
  assert.equal(status.auth.enforcement, "none");
  assert.equal(status.auth.protectedModeAvailable, false);
  assert.equal(status.requestPolicy.dryRunMiddlewareMounted, true);
  assert.equal(status.requestPolicy.dryRunAuditConfigured, true);
  assert.equal(status.requestPolicy.enforcementActive, false);
  assert.equal(status.requestPolicy.networkExposureSafe, false);
  assert.equal(status.protectedModeStartup.protectedModeAvailable, false);
  assert.equal(status.protectedModeStartup.protectedModeMayStart, false);
});
