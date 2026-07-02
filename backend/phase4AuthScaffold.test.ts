import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";
import { routeRequest, type RequestLike } from "./server.js";
import {
  planProtectedRequestPipeline,
  PROTECTED_REQUEST_PIPELINE_ENFORCEMENT_ACTIVE,
  PROTECTED_REQUEST_PIPELINE_NETWORK_EXPOSURE_SAFE,
} from "./protectedRequestPipeline.js";
import type { LocalNodeRuntimeStatus } from "./types.js";

const unmountedProtectedModeNeedles = [
  "authAudit",
  "authRevocation",
  "credentialVerifier",
  "sessionVerifier",
  "credentialVerificationService",
  "credentialVerificationAudit",
  "httpCredentialAdapter",
  "requestAuthorizationPlanner",
  "protectedRequestPipeline",
  "planProtectedRequestPipeline",
] as const;

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
  auth?: { mode: "disabled" | "protected" },
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

function networkExposureValues(value: unknown): boolean[] {
  const values: boolean[] = [];
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(item)) {
      if (key === "networkExposureSafe" && typeof nested === "boolean") {
        values.push(nested);
      }
      visit(nested);
    }
  };
  visit(value);
  return values;
}

async function configuredWorkspace(auth?: {
  mode: "disabled" | "protected";
}): Promise<{ cwd: string; appDataDir: string }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-phase4-scaffold-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-phase4-data-"));
  await writeConfig(cwd, appDataDir, auth);
  return { cwd, appDataDir };
}

test("phase 4 unmounted verifier adapter planner and pipeline modules stay out of active handlers", async () => {
  const activeFiles = ["server.ts", "nodeService.ts"];
  for (const file of activeFiles) {
    const source = await fs.readFile(path.join(process.cwd(), "backend", file), "utf8");
    for (const needle of unmountedProtectedModeNeedles) {
      assert.equal(source.includes(needle), false, `${file} must not import ${needle}`);
    }
  }
});

test("disabled auth mode still permits current local V1 endpoint behavior", async () => {
  const { cwd } = await configuredWorkspace({ mode: "disabled" });
  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: "Bearer invalid-disabled-mode-token",
      cookie: "arepo_session=invalid-disabled-mode-session",
    }),
    cwd,
  );

  assert.equal(response.status, 200);
  assert.deepEqual((response.body as { vaults: unknown[] }).vaults, []);
});

test("requested protected mode remains unavailable and non-operational", async () => {
  const { cwd } = await configuredWorkspace({ mode: "protected" });

  const vaults = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: "Bearer invalid-protected-mode-token",
      cookie: "arepo_session=invalid-protected-mode-session",
    }),
    cwd,
  );
  assert.equal(vaults.status, 200);
  assert.deepEqual((vaults.body as { vaults: unknown[] }).vaults, []);

  const statusResponse = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(statusResponse.status, 200);
  const status = statusResponse.body as LocalNodeRuntimeStatus;

  assert.equal(status.auth.mode, "disabled");
  assert.equal(status.auth.requestedMode, "protected");
  assert.equal(status.auth.enabled, false);
  assert.equal(status.auth.enforcement, "none");
  assert.equal(status.auth.protectedModeAvailable, false);
  assert.equal(status.auth.protectedModeRequested, true);
  assert.match(status.auth.warning, /not implemented/);
  assert.equal(status.capabilities.authentication, false);

  assert.equal(status.requestPolicy.routePolicyInventoryPresent, true);
  assert.equal(status.requestPolicy.routePolicyCount, PROTECTED_ROUTE_POLICIES.length);
  assert.equal(status.requestPolicy.enforcementActive, false);
  assert.equal(status.requestPolicy.credentialVerificationActive, false);
  assert.equal(status.requestPolicy.auditRequestLoggingActive, false);
  assert.equal(status.requestPolicy.revocationChecksActive, false);
  assert.equal(status.requestPolicy.csrfOriginEnforcementActive, false);
  assert.equal(status.requestPolicy.acceptsCredentials, false);
  assert.equal(status.requestPolicy.acceptsSessions, false);
  assert.equal(status.requestPolicy.acceptsBearerTokens, false);
  assert.equal(status.requestPolicy.networkExposureSafe, false);

  assert.equal(status.protectedModeStartup.requestedAuthMode, "protected");
  assert.equal(status.protectedModeStartup.operationalAuthMode, "disabled");
  assert.equal(status.protectedModeStartup.protectedModeAvailable, false);
  assert.equal(status.protectedModeStartup.protectedModeMayStart, false);
  assert.equal(status.protectedModeStartup.enforcementActive, false);
  assert.equal(status.protectedModeStartup.credentialVerificationActive, false);
  assert.equal(status.protectedModeStartup.auditWiringActive, false);
  assert.equal(status.protectedModeStartup.revocationChecksActive, false);
  assert.equal(status.protectedModeStartup.csrfOriginEnforcementActive, false);
  assert.equal(status.protectedModeStartup.networkExposureSafe, false);

  assert.deepEqual(
    networkExposureValues(status).filter((value) => value),
    [],
  );
});

test("non-local bind remains unsafe without enforcement", async () => {
  const { cwd } = await configuredWorkspace({ mode: "disabled" });
  const originalHost = process.env.AREPO_HOST;
  process.env.AREPO_HOST = "0.0.0.0";
  try {
    const response = await routeRequest(request("GET", "/api/node/status"), cwd);
    assert.equal(response.status, 200);
    const status = response.body as LocalNodeRuntimeStatus;

    assert.equal(status.runtime.localOnlyMode, false);
    assert.match(status.runtime.startupWarnings[0] ?? "", /no authentication/);
    assert.equal(status.auth.mode, "disabled");
    assert.equal(status.auth.enforcement, "none");
    assert.match(status.auth.warning, /non-local binding is unsafe/);
    assert.equal(status.requestPolicy.enforcementActive, false);
    assert.equal(status.requestPolicy.networkExposureSafe, false);
    assert.equal(status.protectedModeStartup.nonLocalBindWithDisabledAuth, true);
    assert.equal(status.protectedModeStartup.networkExposureSafe, false);
    assert.deepEqual(
      networkExposureValues(status).filter((value) => value),
      [],
    );
  } finally {
    if (originalHost === undefined) {
      delete process.env.AREPO_HOST;
    } else {
      process.env.AREPO_HOST = originalHost;
    }
  }
});

test("unmounted protected request pipeline remains non-enforcing and fail-closed in isolation", async () => {
  const { appDataDir } = await configuredWorkspace({ mode: "disabled" });
  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: "Bearer scaffold-token" },
    },
    vaultId: "notes",
    audit: { mode: "dry-run", eventId: "evt-scaffold", timestamp: "2026-07-02T00:00:00.000Z" },
    now: new Date("2026-07-02T00:00:00.000Z"),
  });

  assert.equal(PROTECTED_REQUEST_PIPELINE_ENFORCEMENT_ACTIVE, false);
  assert.equal(PROTECTED_REQUEST_PIPELINE_NETWORK_EXPOSURE_SAFE, false);
  assert.notEqual(result.decision.wouldAllow, true);
  assert.equal(result.credential.status, "not-found");
  assert.equal(result.enforcementActive, false);
  assert.equal(result.networkExposureSafe, false);
  assert.equal(result.audit.status, "planned");
  assert.deepEqual(
    networkExposureValues(result).filter((value) => value),
    [],
  );
  assert.equal(JSON.stringify(result).includes("scaffold-token"), false);
});
