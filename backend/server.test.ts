import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { routeRequest, type RequestLike } from "./server.js";
import { loadConfig } from "./config.js";
import { readAuthAuditEvents } from "./authAudit.js";
import {
  resolveAuthStoragePaths,
  writeBrowserSessionStore,
  writeCredentialStore,
  writeRevocationStore,
  writeTokenVerifierStore,
  type CredentialMetadata,
} from "./credentialStore.js";
import { createTokenVerifierMetadata, TOKEN_VERIFIER_SCHEME } from "./credentialVerifier.js";
import { machineIndexPath } from "./indexCache.js";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";
import { buildGraph } from "../src/lib/vault/graph.js";
import type {
  IndexFilterKind,
  IndexFilterResponse,
  IndexSearchResponse,
  LocalNodeRuntimeStatus,
  VaultIndexResponse,
  VaultInspectResponse,
  VaultInfo,
} from "./types.js";
import type { RoutePermission } from "./routePermissions.js";

function request(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
  options: { remoteAddress?: string } = {},
): RequestLike {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  return {
    method,
    url,
    headers,
    socket: options.remoteAddress ? { remoteAddress: options.remoteAddress } : undefined,
    async *[Symbol.asyncIterator]() {
      yield* payload;
    },
  };
}

async function writeConfig(
  cwd: string,
  appDataDir: string,
  options: {
    auth?: Record<string, unknown>;
    vaults?: VaultInfo[];
  } = {},
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
      auth: options.auth,
      vaults: options.vaults ?? [],
    }),
    "utf8",
  );
}

const protectedBearerToken = "server-protected-bearer-token-material";
const protectedNow = "2026-07-04T00:00:00.000Z";
const protectedFuture = "2027-07-04T00:00:00.000Z";

function testVault(rootPath: string, id = "protected-vault"): VaultInfo {
  return {
    id,
    displayName: "Protected Vault",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
    vaultIndexScope: { markdown: { minDepth: 0, maxDepth: null } },
  };
}

async function writeProtectedAuthStores(
  appDataDir: string,
  input: {
    vaultId?: string;
    vaultPermissions?: readonly RoutePermission[];
    nodePermissions?: readonly RoutePermission[];
  },
): Promise<void> {
  const credentialId = "server-protected-credential";
  const verifierId = "server-protected-verifier";
  const credential: CredentialMetadata = {
    credentialId,
    actorKind: "apiToken",
    label: "Server protected test token",
    nodePermissions: input.nodePermissions ?? [],
    vaultGrants: input.vaultId
      ? [{ vaultId: input.vaultId, permissions: input.vaultPermissions ?? [] }]
      : [],
    createdAt: protectedNow,
    expiresAt: protectedFuture,
    verifierIds: [verifierId],
    sessionIds: [],
    auditRefs: [],
  };
  await writeCredentialStore(appDataDir, { credentials: [credential] });
  await writeTokenVerifierStore(appDataDir, {
    tokenVerifiers: [
      createTokenVerifierMetadata({
        tokenMaterial: protectedBearerToken,
        credentialId,
        verifierId,
        createdAt: protectedNow,
        expiresAt: protectedFuture,
        hashParameters: {
          scheme: TOKEN_VERIFIER_SCHEME,
          iterations: 100_000,
          digest: "sha256",
          keyLength: 32,
          saltLength: 32,
        },
      }),
    ],
  });
  await writeBrowserSessionStore(appDataDir, { sessions: [] });
  await writeRevocationStore(appDataDir, { revocations: [] });
}

function relativeIsInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function fileExists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}

function statusBody(response: Awaited<ReturnType<typeof routeRequest>>) {
  return response.body as {
    indexStatus: string;
    changedExternally: boolean;
    changedPaths: string[];
    addedPaths: string[];
    deletedPaths: string[];
    file?: {
      path: string;
      exists: boolean;
      hash?: string;
      changedExternally: boolean;
      deletedExternally: boolean;
    };
  };
}

test("health endpoint returns local node info", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const response = await routeRequest(request("GET", "/api/health"), cwd);
  assert.equal(response.status, 200);
  assert.equal((response.body as { ok: boolean }).ok, true);
});

test("auth policy plumbing does not reject existing routes or accept credentials", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir);

  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: "Bearer not-accepted",
      cookie: "arepo_session=not-accepted",
    }),
    cwd,
  );

  assert.equal(response.status, 200);
  const status = await routeRequest(request("GET", "/api/node/status"), cwd);
  const body = status.body as LocalNodeRuntimeStatus;
  assert.equal(body.requestPolicy.enforcementActive, false);
  assert.equal(body.requestPolicy.acceptsBearerTokens, false);
  assert.equal(body.requestPolicy.acceptsSessions, false);
  assert.equal(body.requestPolicy.acceptsCredentials, false);
});

test("node status endpoint reports local runtime posture", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const response = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(response.status, 200);
  const status = response.body as LocalNodeRuntimeStatus;
  assert.equal(status.ok, true);
  assert.equal(status.node.nodeId, "local");
  assert.equal(status.node.mode, "local");
  assert.equal(status.runtime.host, "127.0.0.1");
  assert.equal(status.runtime.port, 8734);
  assert.equal(status.runtime.localOnlyMode, true);
  assert.deepEqual(status.runtime.startupWarnings, []);
  assert.ok(status.runtime.allowedOrigins.includes("http://localhost:8733"));
  assert.deepEqual(status.auth, {
    mode: "disabled",
    requestedMode: "disabled",
    enabled: false,
    enforcement: "none",
    protectedModeAvailable: false,
    protectedModeRequested: false,
    warning: "Authentication is disabled and not enforced in V1 local-only mode.",
  });
  assert.equal(status.requestPolicy.routePolicyInventoryPresent, true);
  assert.equal(status.requestPolicy.routePolicyCount, PROTECTED_ROUTE_POLICIES.length);
  assert.equal(status.requestPolicy.browserSecurityPolicyPresent, true);
  assert.equal(status.requestPolicy.authorizationPlannerPresent, true);
  assert.equal(status.requestPolicy.dryRunMiddlewareConfigured, false);
  assert.equal(status.requestPolicy.dryRunMiddlewareMounted, false);
  assert.equal(status.requestPolicy.dryRunObservationOnly, true);
  assert.equal(status.requestPolicy.dryRunAuditConfigured, false);
  assert.equal(status.requestPolicy.dryRunAuditAppendCount, 0);
  assert.equal(status.requestPolicy.enforcementActive, false);
  assert.equal(status.requestPolicy.credentialVerificationActive, false);
  assert.equal(status.requestPolicy.auditRequestLoggingActive, false);
  assert.equal(status.requestPolicy.revocationChecksActive, false);
  assert.equal(status.requestPolicy.csrfOriginEnforcementActive, false);
  assert.equal(status.requestPolicy.acceptsCredentials, false);
  assert.equal(status.requestPolicy.acceptsSessions, false);
  assert.equal(status.requestPolicy.acceptsBearerTokens, false);
  assert.equal(status.requestPolicy.networkExposureSafe, false);
  assert.equal(status.browserSessionAuth.status, "planning-only");
  assert.equal(status.browserSessionAuth.liveSessionAuth, false);
  assert.equal(status.browserSessionAuth.acceptsSessionCookies, false);
  assert.equal(status.browserSessionAuth.sessionIssuance, "inactive");
  assert.equal(status.browserSessionAuth.csrfEnforcement, "inactive");
  assert.equal(status.browserSessionAuth.sessionRoutes, "stubbed");
  assert.equal(status.browserSessionAuth.pairingRoutes, "stubbed");
  assert.equal(status.browserSessionAuth.csrfEndpoint, "stubbed");
  assert.equal(status.browserSessionAuth.frontendTokenStorage, false);
  assert.equal(status.browserSessionAuth.networkExposureSafe, false);
  assert.equal(status.browserSessionAuth.pairing.enabled, false);
  assert.equal(status.browserSessionAuth.pairing.issueCode, "inactive");
  assert.equal(status.browserSessionAuth.pairing.consumeCode, "inactive");
  assert.equal(status.browserSessionAuth.pairing.storesRawCodes, false);
  assert.equal(status.browserSessionAuth.sessionLifecycle.issuance, "inactive");
  assert.equal(status.browserSessionAuth.sessionLifecycle.logout, "inactive");
  assert.equal(status.browserSessionAuth.sessionLifecycle.revokeAll, "inactive");
  assert.equal(status.browserSessionAuth.sessionLifecycle.acceptsSessionCookies, false);
  assert.equal(status.browserSessionAuth.sessionLifecycle.storesRawSessionSecrets, false);
  assert.equal(status.browserSessionAuth.sessionLifecycle.returnsSessionSecretsInJson, false);
  assert.equal(status.browserSessionAuth.sessionStore.status, "inactive");
  assert.equal(status.browserSessionAuth.sessionStore.implementation, "in-memory-test-primitive");
  assert.equal(status.browserSessionAuth.sessionStore.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.sessionVerifier.status, "inactive");
  assert.equal(
    status.browserSessionAuth.sessionVerifier.implementation,
    "hash-and-constant-time-compare-primitive",
  );
  assert.equal(status.browserSessionAuth.sessionVerifier.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.cookiePolicy.issuance, "inactive");
  assert.equal(status.browserSessionAuth.cookiePolicy.httpOnly, "required");
  assert.equal(status.browserSessionAuth.cookiePolicy.secure, "required-outside-local-dev");
  assert.equal(status.browserSessionAuth.cookiePolicy.domain, "omitted");
  assert.equal(status.browserSessionAuth.cookiePolicy.setsCookiesToday, false);
  assert.equal(status.browserSessionAuth.csrf.tokenIssuance, "inactive");
  assert.equal(status.browserSessionAuth.csrf.validation, "inactive");
  assert.equal(status.browserSessionAuth.csrf.unsafeMethodsRequireCsrfWhenSessionAuthLive, true);
  assert.equal(status.browserSessionAuth.csrf.bearerTokenRequiresBrowserCsrf, false);
  assert.equal(status.browserSessionAuth.csrf.storesRawTokens, false);
  assert.equal(status.browserSessionAuth.frontend.tokenStorage, false);
  assert.equal(status.browserSessionAuth.frontend.sessionSecretReadableByJs, false);
  assert.equal(status.browserSessionAuth.frontend.loginUi, "inactive");
  assert.equal(status.protectedModeStartup.requestedAuthMode, "disabled");
  assert.equal(status.protectedModeStartup.operationalAuthMode, "disabled");
  assert.equal(status.protectedModeStartup.protectedModeAvailable, false);
  assert.equal(status.protectedModeStartup.protectedModeMayStart, false);
  assert.deepEqual(status.protectedModeStartup.missingRequiredStores, []);
  assert.deepEqual(status.protectedModeStartup.corruptStores, []);
  assert.equal(status.protectedModeStartup.enforcementActive, false);
  assert.equal(status.protectedModeStartup.credentialVerificationActive, false);
  assert.equal(status.protectedModeStartup.auditWiringActive, false);
  assert.equal(status.protectedModeStartup.revocationChecksActive, false);
  assert.equal(status.protectedModeStartup.csrfOriginEnforcementActive, false);
  assert.equal(status.protectedModeStartup.networkExposureSafe, false);
  assert.equal(status.protectedModeReadiness.readyForEnforcement, false);
  assert.equal(status.protectedModeReadiness.enforcementActive, false);
  assert.equal(status.protectedModeReadiness.protectedModeOperational, false);
  assert.equal(status.protectedModeReadiness.networkExposureSafe, false);
  assert.ok(status.protectedModeReadiness.blockers.includes("auth-mode-disabled"));
  assert.ok(status.protectedModeReadiness.blockers.includes("credential-verification-inactive"));
  assert.ok(
    status.protectedModeReadiness.blockers.includes("credential-session-issuance-inactive"),
  );
  assert.ok(
    status.protectedModeReadiness.blockers.includes("credential-session-lifecycle-planning-only"),
  );
  assert.ok(status.protectedModeReadiness.blockers.includes("revocation-checks-inactive"));
  assert.ok(status.protectedModeReadiness.blockers.includes("audit-enforcement-inactive"));
  assert.ok(status.protectedModeReadiness.blockers.includes("audit-requirement-planning-only"));
  assert.ok(status.protectedModeReadiness.blockers.includes("browser-request-guard-planning-only"));
  assert.ok(
    status.protectedModeReadiness.blockers.includes("reduced-anonymous-status-not-enforced"),
  );
  assert.ok(
    status.protectedModeReadiness.blockers.includes("reduced-anonymous-status-planning-only"),
  );
  assert.ok(status.protectedModeReadiness.blockers.includes("stronger-confirmation-not-enforced"));
  assert.ok(status.protectedModeReadiness.blockers.includes("stronger-confirmation-planning-only"));
  assert.equal(status.protectedModeReadiness.checks.reducedAnonymousStatusEnforced, false);
  assert.equal(status.protectedModeReadiness.checks.reducedAnonymousStatusPlannerAvailable, true);
  assert.equal(status.protectedModeReadiness.checks.strongerConfirmationEnforced, false);
  assert.equal(status.protectedModeReadiness.checks.strongerConfirmationPlannerAvailable, true);
  assert.equal(status.protectedModeReadiness.checks.auditEnforcementActive, false);
  assert.equal(status.protectedModeReadiness.checks.auditRequirementPlannerAvailable, true);
  assert.equal(status.protectedModeReadiness.checks.csrfOriginEnforcementActive, false);
  assert.equal(status.protectedModeReadiness.checks.browserRequestGuardPlannerAvailable, true);
  assert.equal(status.protectedModeReadiness.checks.credentialIssuanceActive, false);
  assert.equal(status.protectedModeReadiness.checks.sessionIssuanceActive, false);
  assert.equal(status.protectedModeReadiness.checks.tokenIssuanceActive, false);
  assert.equal(
    status.protectedModeReadiness.checks.credentialSessionLifecyclePlannerAvailable,
    true,
  );
  assert.equal(status.protectedModeReadiness.routePolicy.inventoryPresent, true);
  assert.equal(
    status.protectedModeReadiness.routePolicy.routePolicyCount,
    PROTECTED_ROUTE_POLICIES.length,
  );
  assert.equal(status.protectedModeReadiness.routePolicy.complete, true);
  assert.equal(status.vaultCount, 1);
  assert.equal(status.vaults[0]?.vaultId, vault.id);
  assert.equal(status.vaults[0]?.storageSummaryAvailable, true);
  assert.equal(status.capabilities.storageSummary, true);
  assert.equal(status.capabilities.remoteNodes, false);
  assert.equal(status.capabilities.authentication, false);
  assert.equal(status.capabilities.sync, false);
  assert.equal(status.capabilities.ai, false);
  assert.equal(status.capabilities.database, false);
  assert.equal(status.capabilities.migrationSupport, false);
});

test("node status endpoint reports non-local bind warning", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const originalHost = process.env.AREPO_HOST;
  process.env.AREPO_HOST = "0.0.0.0";
  try {
    const response = await routeRequest(request("GET", "/api/node/status"), cwd);
    assert.equal(response.status, 200);
    const status = response.body as LocalNodeRuntimeStatus;
    assert.equal(status.runtime.host, "0.0.0.0");
    assert.equal(status.runtime.localOnlyMode, false);
    assert.match(status.runtime.startupWarnings[0] ?? "", /Non-local exposure is unsafe/);
    assert.equal(status.auth.mode, "disabled");
    assert.equal(status.auth.requestedMode, "disabled");
    assert.equal(status.auth.enabled, false);
    assert.equal(status.auth.enforcement, "none");
    assert.equal(status.auth.protectedModeAvailable, false);
    assert.match(status.auth.warning, /non-local binding is unsafe/);
    assert.equal(status.requestPolicy.networkExposureSafe, false);
    assert.equal(status.protectedModeStartup.nonLocalBindWithDisabledAuth, true);
    assert.equal(status.protectedModeStartup.networkExposureSafe, false);
    assert.ok(
      status.protectedModeReadiness.blockers.includes("non-local-bind-without-protected-mode"),
    );
    assert.equal(status.protectedModeReadiness.networkExposureSafe, false);
  } finally {
    if (originalHost === undefined) {
      delete process.env.AREPO_HOST;
    } else {
      process.env.AREPO_HOST = originalHost;
    }
  }
});

test("node status endpoint returns reduced diagnostics when protected mode is not ready", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });

  const response = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(response.status, 503);
  const status = response.body as {
    ok: true;
    responseKind: string;
    endpoint: string;
    authRequired: boolean;
    protectedModeOperational: boolean;
    publicWarnings: string[];
  };
  assert.equal(status.ok, true);
  assert.equal(status.responseKind, "reduced-anonymous-status");
  assert.equal(status.endpoint, "nodeStatus");
  assert.equal(status.authRequired, true);
  assert.equal(status.protectedModeOperational, false);
  assert.ok(status.publicWarnings.includes("protected-mode-not-operational"));
  assert.equal("runtime" in status, false);
  assert.equal("vaults" in status, false);
});

test("protected-mode startup assessment denies protected routes when readiness is incomplete", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });

  const response = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.equal(response.status, 503);
  const body = response.body as { ok: false; code: string; reasonCodes: string[] };
  assert.equal(body.ok, false);
  assert.equal(body.code, "protected-mode-not-ready");
  assert.ok(body.reasonCodes.includes("auth-store-missing"));
});

test("protected mode enforces bearer credentials and vault route permissions", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  await fs.writeFile(path.join(rootPath, "note.md"), "# Protected\n", "utf8");
  const vault = testVault(rootPath);

  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" }, vaults: [vault] });
  await writeProtectedAuthStores(appDataDir, {
    vaultId: vault.id,
    vaultPermissions: ["readIndex"],
  });

  const route = `/api/vaults/${vault.id}/file?path=note.md`;
  const missing = await routeRequest(request("GET", route), cwd);
  assert.equal(missing.status, 401);
  assert.equal((missing.body as { code: string }).code, "requires-authentication");

  const invalidSecret = "invalid-server-protected-token";
  const invalid = await routeRequest(
    request("GET", route, undefined, { authorization: `Bearer ${invalidSecret}` }),
    cwd,
  );
  assert.equal(invalid.status, 401);
  assert.equal(JSON.stringify(invalid.body).includes(invalidSecret), false);

  const unauthorized = await routeRequest(
    request("GET", route, undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(unauthorized.status, 403);
  assert.equal((unauthorized.body as { code: string }).code, "requires-authorization");

  await writeProtectedAuthStores(appDataDir, {
    vaultId: vault.id,
    vaultPermissions: ["readContent"],
  });
  const allowed = await routeRequest(
    request("GET", route, undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(allowed.status, 200);
  assert.equal((allowed.body as { content: string }).content, "# Protected\n");

  const paths = resolveAuthStoragePaths(appDataDir);
  const audit = await readAuthAuditEvents(paths.auditEvents);
  const serializedAudit = JSON.stringify(audit.events);
  assert.ok(audit.events.length >= 4);
  assert.equal(serializedAudit.includes(protectedBearerToken), false);
  assert.equal(serializedAudit.includes(invalidSecret), false);
  assert.equal(serializedAudit.includes("verifierHash"), false);
  assert.equal(serializedAudit.includes("salt"), false);
});

test("protected mode returns reduced anonymous status and full authorized status", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });
  await writeProtectedAuthStores(appDataDir, { nodePermissions: ["manageNode"] });

  const anonymous = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(anonymous.status, 200);
  const reduced = anonymous.body as {
    ok: true;
    responseKind: string;
    endpoint: string;
    authRequired: boolean;
    protectedModeOperational: boolean;
  };
  assert.equal(reduced.ok, true);
  assert.equal(reduced.responseKind, "reduced-anonymous-status");
  assert.equal(reduced.endpoint, "nodeStatus");
  assert.equal(reduced.authRequired, true);
  assert.equal("runtime" in reduced, false);
  assert.equal("protectedModeReadiness" in reduced, false);
  assert.equal("browserSessionAuth" in reduced, false);

  const authorized = await routeRequest(
    request("GET", "/api/node/status", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(authorized.status, 200);
  const full = authorized.body as LocalNodeRuntimeStatus;
  assert.equal(full.auth.mode, "protected");
  assert.equal(full.auth.enabled, true);
  assert.equal(full.auth.enforcement, "protected");
  assert.equal(full.requestPolicy.enforcementActive, true);
  assert.equal(full.requestPolicy.acceptsBearerTokens, true);
  assert.equal(full.requestPolicy.acceptsSessions, false);
  assert.equal(full.browserSessionAuth.status, "planning-only");
  assert.equal(full.browserSessionAuth.liveSessionAuth, false);
  assert.equal(full.browserSessionAuth.acceptsSessionCookies, false);
  assert.equal(full.browserSessionAuth.sessionIssuance, "inactive");
  assert.equal(full.browserSessionAuth.csrfEnforcement, "inactive");
  assert.equal(full.browserSessionAuth.sessionRoutes, "stubbed");
  assert.equal(full.browserSessionAuth.pairingRoutes, "stubbed");
  assert.equal(full.browserSessionAuth.csrfEndpoint, "stubbed");
  assert.equal(full.browserSessionAuth.frontendTokenStorage, false);
  assert.equal(full.browserSessionAuth.pairing.status, "planning-only");
  assert.equal(full.browserSessionAuth.pairing.issueCode, "inactive");
  assert.equal(full.browserSessionAuth.pairing.consumeCode, "inactive");
  assert.equal(full.browserSessionAuth.pairing.storesRawCodes, false);
  assert.equal(full.browserSessionAuth.sessionLifecycle.issuance, "inactive");
  assert.equal(full.browserSessionAuth.sessionLifecycle.logout, "inactive");
  assert.equal(full.browserSessionAuth.sessionLifecycle.revokeAll, "inactive");
  assert.equal(full.browserSessionAuth.sessionLifecycle.acceptsSessionCookies, false);
  assert.equal(full.browserSessionAuth.sessionLifecycle.storesRawSessionSecrets, false);
  assert.equal(full.browserSessionAuth.sessionLifecycle.returnsSessionSecretsInJson, false);
  assert.equal(full.browserSessionAuth.sessionStore.status, "inactive");
  assert.equal(full.browserSessionAuth.sessionStore.implementation, "in-memory-test-primitive");
  assert.equal(full.browserSessionAuth.sessionStore.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.sessionVerifier.status, "inactive");
  assert.equal(
    full.browserSessionAuth.sessionVerifier.implementation,
    "hash-and-constant-time-compare-primitive",
  );
  assert.equal(full.browserSessionAuth.sessionVerifier.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.cookiePolicy.issuance, "inactive");
  assert.equal(full.browserSessionAuth.cookiePolicy.setsCookiesToday, false);
  assert.equal(full.browserSessionAuth.csrf.tokenIssuance, "inactive");
  assert.equal(full.browserSessionAuth.csrf.validation, "inactive");
  assert.equal(full.browserSessionAuth.csrf.bearerTokenRequiresBrowserCsrf, false);
  assert.equal(full.browserSessionAuth.csrf.storesRawTokens, false);
  assert.equal(full.browserSessionAuth.frontend.tokenStorage, false);
  assert.equal(full.browserSessionAuth.frontend.sessionSecretReadableByJs, false);
  assert.equal(full.browserSessionAuth.frontend.loginUi, "inactive");
  assert.ok(full.browserSessionAuth.audit.events.includes("browser_session_issue_denied"));
  assert.equal(full.browserSessionAuth.audit.excludesRawSessionSecrets, true);
  assert.equal(full.browserSessionAuth.audit.excludesRawPairingCodes, true);
  assert.equal(full.browserSessionAuth.audit.excludesRawCsrfTokens, true);
  assert.ok(
    full.browserSessionAuth.readiness.blockers.includes("browser-session-cookies-not-accepted"),
  );
  assert.ok(
    full.browserSessionAuth.readiness.blockers.includes("browser-session-lifecycle-inactive"),
  );
  assert.equal(full.protectedModeReadiness.browserSessionAuth.acceptsSessionCookies, false);
  assert.equal(
    full.protectedModeReadiness.browserSessionAuth.sessionLifecycle.issuance,
    "inactive",
  );
  assert.equal(full.protectedModeReadiness.readyForEnforcement, true);
  assert.equal(full.protectedModeReadiness.protectedModeOperational, true);
  assert.equal(full.protectedModeReadiness.enforcementActive, true);
  assert.equal(full.protectedModeReadiness.networkExposureSafe, false);
});

test("protected mode fails closed for routes without a permission policy", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  const vault = testVault(rootPath);
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" }, vaults: [vault] });
  await writeProtectedAuthStores(appDataDir, {
    vaultId: vault.id,
    vaultPermissions: ["readIndex", "readContent"],
  });

  const response = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/uncovered`, undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(response.status, 404);
  const body = response.body as { ok: false; code: string; reasonCodes: string[] };
  assert.equal(body.ok, false);
  assert.equal(body.code, "route-not-found");
  assert.ok(body.reasonCodes.includes("route-not-found"));
});

test("protected dry-run canary remains sanitized when anonymous dry-run is enabled", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir, {
    auth: { mode: "protected", dryRunRequestPolicy: true },
  });
  await writeProtectedAuthStores(appDataDir, { nodePermissions: ["manageNode"] });

  const response = await routeRequest(
    request("GET", "/api/node/auth/dry-run", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
      "x-source-body": "secret-source-body",
    }),
    cwd,
  );
  assert.equal(response.status, 200);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(protectedBearerToken), false);
  assert.equal(serialized.includes("secret-source-body"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("salt"), false);

  const anonymous = await routeRequest(request("GET", "/api/node/auth/dry-run"), cwd);
  assert.equal(anonymous.status, 200);
  assert.equal((anonymous.body as { diagnosticOnly: boolean }).diagnosticOnly, true);
});

test("browser session and pairing auth stubs return sanitized unavailable responses", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  const secret = "raw-browser-session-or-pairing-secret";
  const routes = [
    ["POST", "/api/node/auth/session"],
    ["POST", "/api/node/auth/session/logout"],
    ["POST", "/api/node/auth/session/revoke-all"],
    ["GET", "/api/node/auth/csrf"],
    ["POST", "/api/node/auth/pairing/start"],
    ["POST", "/api/node/auth/pairing/complete"],
  ] as const;

  await writeConfig(cwd, appDataDir, { auth: { mode: "disabled" } });
  for (const [method, route] of routes) {
    const response = await routeRequest(
      request(
        method,
        route,
        { sessionSecret: secret, csrfToken: secret, pairingCode: secret },
        {
          authorization: `Bearer ${secret}`,
          cookie: `arepo_session=${secret}`,
          "x-arepo-confirmation": "wrong",
        },
      ),
      cwd,
    );
    assert.equal(response.status, 501);
    assert.equal(response.headers?.["set-cookie"], undefined);
    assert.deepEqual(response.body, {
      ok: false,
      error: {
        code: "browser_session_auth_inactive",
        message: "Browser-session authentication is planned but not active.",
      },
    });
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("authorization"), false);
    assert.equal(serialized.includes("cookie"), false);
    assert.equal(serialized.includes("sessionSecret"), false);
    assert.equal(serialized.includes("csrfToken"), false);
    assert.equal(serialized.includes("pairingCode"), false);
    assert.equal(serialized.includes("verifierHash"), false);
    assert.equal(serialized.includes("salt"), false);
    assert.equal(serialized.includes("stack"), false);
  }

  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });
  await writeProtectedAuthStores(appDataDir, { nodePermissions: ["manageNode", "manageAuth"] });
  for (const [method, route] of routes) {
    const response = await routeRequest(
      request(
        method,
        route,
        { sessionSecret: secret },
        {
          authorization: `Bearer ${protectedBearerToken}`,
          cookie: `arepo_session=${secret}`,
        },
      ),
      cwd,
    );
    assert.equal(response.status, 501);
    assert.equal(response.headers?.["set-cookie"], undefined);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes(protectedBearerToken), false);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("verifierHash"), false);
    assert.equal(serialized.includes("salt"), false);
  }
});

test("protected mode treats session-cookie auth as unsupported in this slice", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });
  await writeProtectedAuthStores(appDataDir, { nodePermissions: ["manageNode"] });

  const secret = "unsupported-session-secret";
  const response = await routeRequest(
    request("GET", "/api/node/status", undefined, { cookie: `arepo_session=${secret}` }),
    cwd,
  );
  assert.equal(response.status, 401);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("arepo_session"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("salt"), false);
});

test("protected credential bootstrap is localhost-only and returns raw token once", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  const vault = testVault(rootPath);
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" }, vaults: [vault] });

  const nonLocal = await routeRequest(
    request(
      "POST",
      "/api/node/credentials/bootstrap",
      { label: "Operator" },
      {},
      { remoteAddress: "10.0.0.2" },
    ),
    cwd,
  );
  assert.equal(nonLocal.status, 403);

  const beforeStatus = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(beforeStatus.status, 503);
  assert.equal(
    (beforeStatus.body as { publicWarnings: string[] }).publicWarnings.includes(
      "protected-mode-not-operational",
    ),
    true,
  );

  const bootstrap = await routeRequest(
    request(
      "POST",
      "/api/node/credentials/bootstrap",
      { label: "Operator" },
      {},
      { remoteAddress: "127.0.0.1" },
    ),
    cwd,
  );
  assert.equal(bootstrap.status, 201);
  const issued = bootstrap.body as {
    ok: true;
    data: { bearerToken: string; tokenType: "Bearer"; credential: { credentialId: string } };
  };
  assert.equal(issued.ok, true);
  assert.equal(issued.data.tokenType, "Bearer");
  assert.match(issued.data.bearerToken, /^arepo_/);

  const paths = resolveAuthStoragePaths(appDataDir);
  const [credentialStoreRaw, verifierStoreRaw] = await Promise.all([
    fs.readFile(paths.credentials, "utf8"),
    fs.readFile(paths.tokenVerifiers, "utf8"),
  ]);
  assert.equal(credentialStoreRaw.includes(issued.data.bearerToken), false);
  assert.equal(verifierStoreRaw.includes(issued.data.bearerToken), false);

  const repeated = await routeRequest(
    request(
      "POST",
      "/api/node/credentials/bootstrap",
      { label: "Operator 2" },
      {},
      { remoteAddress: "127.0.0.1" },
    ),
    cwd,
  );
  assert.equal(repeated.status, 409);

  const listed = await routeRequest(
    request("GET", "/api/node/credentials", undefined, {
      authorization: `Bearer ${issued.data.bearerToken}`,
    }),
    cwd,
  );
  assert.equal(listed.status, 200);
  const serializedList = JSON.stringify(listed.body);
  assert.equal(serializedList.includes(issued.data.bearerToken), false);
  assert.equal(serializedList.includes("verifierHash"), false);
  assert.equal(serializedList.includes("saltId"), false);

  const fullStatus = await routeRequest(
    request("GET", "/api/node/status", undefined, {
      authorization: `Bearer ${issued.data.bearerToken}`,
    }),
    cwd,
  );
  assert.equal(fullStatus.status, 200);
  const status = fullStatus.body as LocalNodeRuntimeStatus;
  assert.equal(status.credentialLifecycle.activeCredentialCount, 1);
  assert.equal(status.credentialLifecycle.bootstrapAvailable, false);
  assert.equal(JSON.stringify(status).includes(issued.data.bearerToken), false);
});

test("protected credential create revoke and audit responses remain sanitized", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });
  await writeProtectedAuthStores(appDataDir, { nodePermissions: ["manageNode", "manageAuth"] });

  const noConfirmation = await routeRequest(
    request(
      "POST",
      "/api/node/credentials",
      { label: "Created token", nodePermissions: ["manageNode"] },
      { authorization: `Bearer ${protectedBearerToken}` },
    ),
    cwd,
  );
  assert.equal(noConfirmation.status, 428);

  const wrongConfirmation = await routeRequest(
    request(
      "POST",
      "/api/node/credentials",
      { label: "Created token", nodePermissions: ["manageNode"] },
      {
        authorization: `Bearer ${protectedBearerToken}`,
        "x-arepo-confirmation": "not-confirm",
      },
    ),
    cwd,
  );
  assert.equal(wrongConfirmation.status, 428);
  assert.equal(JSON.stringify(wrongConfirmation.body).includes("not-confirm"), false);

  const created = await routeRequest(
    request(
      "POST",
      "/api/node/credentials",
      { label: "Created token", nodePermissions: ["manageNode"] },
      {
        authorization: `Bearer ${protectedBearerToken}`,
        "x-arepo-confirmation": "confirm",
      },
    ),
    cwd,
  );
  assert.equal(created.status, 201);
  const createdBody = created.body as {
    ok: true;
    data: { bearerToken: string; credential: { credentialId: string } };
  };
  const createdToken = createdBody.data.bearerToken;
  const credentialId = createdBody.data.credential.credentialId;
  assert.match(createdToken, /^arepo_/);

  const createdStatus = await routeRequest(
    request("GET", "/api/node/status", undefined, { authorization: `Bearer ${createdToken}` }),
    cwd,
  );
  assert.equal(createdStatus.status, 200);

  const listed = await routeRequest(
    request("GET", "/api/node/credentials", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(listed.status, 200);
  const serializedList = JSON.stringify(listed.body);
  assert.equal(serializedList.includes(createdToken), false);
  assert.equal(serializedList.includes("verifierHash"), false);
  assert.equal(serializedList.includes("saltId"), false);

  const revokeWithoutConfirmation = await routeRequest(
    request(
      "POST",
      `/api/node/credentials/${encodeURIComponent(credentialId)}/revoke`,
      {},
      { authorization: `Bearer ${protectedBearerToken}` },
    ),
    cwd,
  );
  assert.equal(revokeWithoutConfirmation.status, 428);

  const revokeWithWrongConfirmation = await routeRequest(
    request(
      "POST",
      `/api/node/credentials/${encodeURIComponent(credentialId)}/revoke`,
      {},
      {
        authorization: `Bearer ${protectedBearerToken}`,
        "x-arepo-confirmation": "not-confirm",
      },
    ),
    cwd,
  );
  assert.equal(revokeWithWrongConfirmation.status, 428);
  assert.equal(JSON.stringify(revokeWithWrongConfirmation.body).includes("not-confirm"), false);

  const revoked = await routeRequest(
    request(
      "POST",
      `/api/node/credentials/${encodeURIComponent(credentialId)}/revoke`,
      { reason: "test revocation" },
      {
        authorization: `Bearer ${protectedBearerToken}`,
        "x-arepo-confirmation": "confirm",
      },
    ),
    cwd,
  );
  assert.equal(revoked.status, 200);
  assert.equal((revoked.body as { data: { revoked: boolean } }).data.revoked, true);

  const revokedAgain = await routeRequest(
    request(
      "POST",
      `/api/node/credentials/${encodeURIComponent(credentialId)}/revoke`,
      {},
      {
        authorization: `Bearer ${protectedBearerToken}`,
        "x-arepo-confirmation": "confirm",
      },
    ),
    cwd,
  );
  assert.equal(revokedAgain.status, 200);
  assert.equal((revokedAgain.body as { data: { revoked: boolean } }).data.revoked, false);

  const revokedTokenUse = await routeRequest(
    request("GET", "/api/node/status", undefined, { authorization: `Bearer ${createdToken}` }),
    cwd,
  );
  assert.equal(revokedTokenUse.status, 401);

  const paths = resolveAuthStoragePaths(appDataDir);
  const parsed = await readAuthAuditEvents(paths.auditEvents);
  const serializedAudit = JSON.stringify(parsed.events);
  assert.ok(parsed.events.some((event) => event.kind === "credential.created"));
  assert.ok(parsed.events.some((event) => event.kind === "credential.revoked"));
  assert.equal(serializedAudit.includes(createdToken), false);
  assert.equal(serializedAudit.includes(protectedBearerToken), false);
  assert.equal(serializedAudit.includes("verifierHash"), false);
  assert.equal(serializedAudit.includes("salt"), false);
  assert.equal(serializedAudit.includes("not-confirm"), false);
});

test("protected credential rotation revokes old token and returns replacement once", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });
  await writeProtectedAuthStores(appDataDir, { nodePermissions: ["manageNode", "manageAuth"] });

  const bootstrapCredentialId = "server-protected-credential";
  const wrongConfirmation = await routeRequest(
    request(
      "POST",
      `/api/node/credentials/${bootstrapCredentialId}/rotate`,
      { label: "Rotated operator" },
      {
        authorization: `Bearer ${protectedBearerToken}`,
        "x-arepo-confirmation": "not-confirm",
      },
    ),
    cwd,
  );
  assert.equal(wrongConfirmation.status, 428);
  assert.equal(JSON.stringify(wrongConfirmation.body).includes("not-confirm"), false);

  const rotated = await routeRequest(
    request(
      "POST",
      `/api/node/credentials/${bootstrapCredentialId}/rotate`,
      { label: "Rotated operator" },
      {
        authorization: `Bearer ${protectedBearerToken}`,
        "x-arepo-confirmation": "confirm",
      },
    ),
    cwd,
  );
  assert.equal(rotated.status, 201);
  const body = rotated.body as {
    data: {
      bearerToken: string;
      credential: { credentialId: string };
      oldCredential: { status: string };
    };
  };
  assert.match(body.data.bearerToken, /^arepo_/);
  assert.equal(body.data.oldCredential.status, "revoked");

  const oldToken = await routeRequest(
    request("GET", "/api/node/status", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(oldToken.status, 401);

  const newToken = await routeRequest(
    request("GET", "/api/node/status", undefined, {
      authorization: `Bearer ${body.data.bearerToken}`,
    }),
    cwd,
  );
  assert.equal(newToken.status, 200);

  const listed = await routeRequest(
    request("GET", "/api/node/credentials", undefined, {
      authorization: `Bearer ${body.data.bearerToken}`,
    }),
    cwd,
  );
  assert.equal(listed.status, 200);
  const serializedList = JSON.stringify(listed.body);
  assert.equal(serializedList.includes(body.data.bearerToken), false);
  assert.equal(serializedList.includes(protectedBearerToken), false);
});

test("expired bearer credentials return sanitized 401 while active credentials keep readiness complete", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });

  const expiredToken = "server-expired-token-material";
  const expiredCredential: CredentialMetadata = {
    credentialId: "server-expired-credential",
    actorKind: "apiToken",
    label: "Expired token",
    nodePermissions: ["manageNode"],
    vaultGrants: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    verifierIds: ["server-expired-verifier"],
    sessionIds: [],
    auditRefs: [],
  };
  const activeCredential: CredentialMetadata = {
    credentialId: "server-active-credential",
    actorKind: "apiToken",
    label: "Active token",
    nodePermissions: ["manageNode"],
    vaultGrants: [],
    createdAt: protectedNow,
    expiresAt: protectedFuture,
    verifierIds: ["server-active-verifier"],
    sessionIds: [],
    auditRefs: [],
  };
  await writeCredentialStore(appDataDir, { credentials: [expiredCredential, activeCredential] });
  await writeTokenVerifierStore(appDataDir, {
    tokenVerifiers: [
      createTokenVerifierMetadata({
        tokenMaterial: expiredToken,
        credentialId: expiredCredential.credentialId,
        verifierId: "server-expired-verifier",
        createdAt: expiredCredential.createdAt,
        expiresAt: expiredCredential.expiresAt,
        hashParameters: {
          scheme: TOKEN_VERIFIER_SCHEME,
          iterations: 100_000,
          digest: "sha256",
          keyLength: 32,
          saltLength: 32,
        },
      }),
      createTokenVerifierMetadata({
        tokenMaterial: protectedBearerToken,
        credentialId: activeCredential.credentialId,
        verifierId: "server-active-verifier",
        createdAt: activeCredential.createdAt,
        expiresAt: activeCredential.expiresAt,
        hashParameters: {
          scheme: TOKEN_VERIFIER_SCHEME,
          iterations: 100_000,
          digest: "sha256",
          keyLength: 32,
          saltLength: 32,
        },
      }),
    ],
  });
  await writeBrowserSessionStore(appDataDir, { sessions: [] });
  await writeRevocationStore(appDataDir, { revocations: [] });

  const response = await routeRequest(
    request("GET", "/api/node/status", undefined, { authorization: `Bearer ${expiredToken}` }),
    cwd,
  );
  assert.equal(response.status, 401);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(expiredToken), false);
  assert.equal(serialized.includes("verifierHash"), false);

  const active = await routeRequest(
    request("GET", "/api/node/status", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(active.status, 200);
  assert.equal(
    (active.body as LocalNodeRuntimeStatus).credentialLifecycle.expiredCredentialCount,
    1,
  );
});

test("unsupported auth modes still fail closed clearly", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
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
      auth: {
        mode: "token",
      },
      vaults: [],
    }),
    "utf8",
  );

  const response = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(response.status, 400);
  const body = response.body as { ok: false; error: string };
  assert.equal(body.ok, false);
  assert.match(body.error, /unsupported auth mode "token"/);
});

test("node status endpoint surfaces invalid config diagnostics", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: {
        nodeId: "bad node id",
        displayName: "Local Node",
        mode: "local",
        apiVersion: 1,
      },
      vaults: [],
    }),
    "utf8",
  );

  const response = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(response.status, 400);
  const body = response.body as { ok: false; error: string };
  assert.equal(body.ok, false);
  assert.match(body.error, /nodeId must contain only/);
});

test("vault registration and file APIs stay inside configured root", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));

  const created = await routeRequest(
    request("POST", "/api/vaults", { rootPath, displayName: "Docs" }),
    cwd,
  );
  assert.equal(created.status, 201);
  const vaultId = (created.body as { data: { vault: { id: string } } }).data.vault.id;

  const file = await routeRequest(
    request("POST", `/api/vaults/${vaultId}/file`, { path: "notes.md" }),
    cwd,
  );
  assert.equal(file.status, 201);

  const traversal = await routeRequest(
    request("GET", `/api/vaults/${vaultId}/file?path=../secret.md`),
    cwd,
  );
  assert.equal(traversal.status, 400);
});

test("vault index scope update persists config and rebuilds the machine index", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-vault-"));
  await fs.mkdir(path.join(rootPath, "Notes", "Nestest"), { recursive: true });
  await fs.writeFile(path.join(rootPath, "README.md"), "# Readme\n", "utf8");
  await fs.writeFile(path.join(rootPath, "Notes", "note.md"), "# Note\n", "utf8");
  await fs.writeFile(path.join(rootPath, "Notes", "Nestest", "note.md"), "# Nested\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const scoped = await routeRequest(
    request("PATCH", `/api/vaults/${vault.id}/index-scope`, {
      vaultIndexScope: { markdown: { minDepth: 0, maxDepth: 1 } },
    }),
    cwd,
  );
  assert.equal(scoped.status, 200);
  const body = scoped.body as {
    data: { vault: VaultInfo; index: VaultIndexResponse };
  };
  assert.deepEqual(body.data.vault.vaultIndexScope, {
    markdown: { minDepth: 0, maxDepth: 1 },
  });
  assert.deepEqual(Object.keys(body.data.index.index.notes).sort(), ["Notes/note.md", "README.md"]);

  const config = await loadConfig(cwd);
  assert.deepEqual(config.vaults[0]?.vaultIndexScope, {
    markdown: { minDepth: 0, maxDepth: 1 },
  });

  const invalid = await routeRequest(
    request("PATCH", `/api/vaults/${vault.id}/index-scope`, {
      vaultIndexScope: { markdown: { minDepth: 2, maxDepth: 1 } },
    }),
    cwd,
  );
  assert.equal(invalid.status, 400);
  const afterInvalid = await loadConfig(cwd);
  assert.deepEqual(afterInvalid.vaults[0]?.vaultIndexScope, {
    markdown: { minDepth: 0, maxDepth: 1 },
  });
});

test("vault storage endpoint reports content and cache sizes", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-vault-"));
  await fs.mkdir(path.join(rootPath, "assets"), { recursive: true });
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  await fs.writeFile(path.join(rootPath, "assets", "file.bin"), Buffer.alloc(4));

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const response = await routeRequest(request("GET", `/api/vaults/${vault.id}/storage`), cwd);
  assert.equal(response.status, 200);
  const storage = response.body as {
    total: { fileCount: number; bytes: number };
    markdownText: { fileCount: number; bytes: number };
    attachments: { fileCount: number; bytes: number };
    appDataCache: { fileCount: number; bytes: number; machineIndexBytes: number };
  };
  assert.equal(storage.total.fileCount, 2);
  assert.equal(storage.total.bytes, 11);
  assert.equal(storage.markdownText.fileCount, 1);
  assert.equal(storage.markdownText.bytes, 7);
  assert.equal(storage.attachments.fileCount, 1);
  assert.equal(storage.attachments.bytes, 4);
  assert.equal(storage.appDataCache.fileCount, 1);
  assert.equal(storage.appDataCache.machineIndexBytes > 0, true);
});

test("removing a vault can keep generated data without deleting source files", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-vault-"));
  const sourceFile = path.join(rootPath, "note.md");
  await fs.writeFile(sourceFile, "# Note\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  const generatedFile = await machineIndexPath(vault, cwd);
  assert.equal(await fileExists(generatedFile), true);

  const removed = await routeRequest(
    request("DELETE", `/api/vaults/${vault.id}`, { generatedDataAction: "keep" }),
    cwd,
  );
  assert.equal(removed.status, 200);
  assert.equal(await fileExists(sourceFile), true);
  assert.equal(await fileExists(generatedFile), true);

  const list = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.deepEqual((list.body as { vaults: VaultInfo[] }).vaults, []);
  const body = removed.body as {
    data: { generatedData: { action: string; deletedPaths: string[]; diagnostics: string[] } };
  };
  assert.equal(body.data.generatedData.action, "keep");
  assert.deepEqual(body.data.generatedData.deletedPaths, []);
  assert.deepEqual(body.data.generatedData.diagnostics, []);
});

test("removing a vault can discard verified AREPO-generated data without deleting source files", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-vault-"));
  const sourceFile = path.join(rootPath, "note.md");
  await fs.writeFile(sourceFile, "# Note\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  const generatedFile = await machineIndexPath(vault, cwd);
  assert.equal(await fileExists(generatedFile), true);

  const removed = await routeRequest(
    request("DELETE", `/api/vaults/${vault.id}`, { generatedDataAction: "discard" }),
    cwd,
  );
  assert.equal(removed.status, 200);
  assert.equal(await fileExists(sourceFile), true);
  assert.equal(await fileExists(generatedFile), false);

  const body = removed.body as {
    data: { generatedData: { action: string; deletedPaths: string[]; diagnostics: string[] } };
  };
  assert.equal(body.data.generatedData.action, "discard");
  assert.deepEqual(body.data.generatedData.deletedPaths, [generatedFile]);
  assert.deepEqual(body.data.generatedData.diagnostics, []);
});

test("removing an inaccessible vault registration does not require the vault root to exist", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-vault-"));
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  await fs.rm(rootPath, { recursive: true, force: true });

  const staleList = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.equal(staleList.status, 200);
  assert.equal((staleList.body as { vaults: VaultInfo[] }).vaults[0]?.id, vault.id);

  const removed = await routeRequest(
    request("DELETE", `/api/vaults/${vault.id}`, { generatedDataAction: "keep" }),
    cwd,
  );
  assert.equal(removed.status, 200);
  const list = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.deepEqual((list.body as { vaults: VaultInfo[] }).vaults, []);
});

test("discard generated data refuses to delete unverified cache files", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-vault-"));
  const sourceFile = path.join(rootPath, "note.md");
  await fs.writeFile(sourceFile, "# Note\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  const generatedFile = await machineIndexPath(vault, cwd);
  await fs.writeFile(generatedFile, JSON.stringify({ kind: "not.arepo" }), "utf8");

  const removed = await routeRequest(
    request("DELETE", `/api/vaults/${vault.id}`, { generatedDataAction: "discard" }),
    cwd,
  );
  assert.equal(removed.status, 200);
  assert.equal(await fileExists(sourceFile), true);
  assert.equal(await fileExists(generatedFile), true);

  const body = removed.body as {
    data: { generatedData: { deletedPaths: string[]; diagnostics: string[] } };
  };
  assert.deepEqual(body.data.generatedData.deletedPaths, []);
  assert.match(body.data.generatedData.diagnostics[0] ?? "", /could not be verified/);
});

test("vault indexing works without a user-authored index.md", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  await fs.mkdir(path.join(rootPath, "Projects"));
  await fs.writeFile(
    path.join(rootPath, "Home.md"),
    "# Home\n\nSee [[Alpha]] and [[Missing Note]].\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootPath, "Projects", "Alpha.md"),
    "# Alpha\n\nBack to [[Home]].\n",
    "utf8",
  );

  const created = await routeRequest(
    request("POST", "/api/vaults", { rootPath, displayName: "Acceptance Vault" }),
    cwd,
  );
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const cacheFile = await machineIndexPath(vault, cwd);
  await fs.access(cacheFile);
  assert.equal(relativeIsInside(appDataDir, cacheFile), true);
  assert.equal(relativeIsInside(rootPath, cacheFile), false);

  const response = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(response.status, 200);
  const { index, issues } = response.body as VaultIndexResponse;
  assert.deepEqual(Object.keys(index.notes).sort(), ["Home.md", "Projects/Alpha.md"]);
  assert.equal(index.notes["index.md"], undefined);
  assert.equal(index.backlinks["Projects/Alpha.md"]?.[0]?.fromPath, "Home.md");
  assert.equal(index.brokenLinks[0]?.target, "Missing Note");

  const graph = buildGraph(index, issues);
  assert.ok(graph.nodes.some((node) => node.id === "Home.md"));
  assert.ok(
    graph.edges.some((edge) => edge.source === "Home.md" && edge.target === "Projects/Alpha.md"),
  );
  assert.ok(graph.nodes.some((node) => node.id === "missing:Missing Note"));
});

test("index structural filters expose read-only machine-index views", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  await fs.mkdir(path.join(rootPath, "A"), { recursive: true });
  await fs.mkdir(path.join(rootPath, "B"), { recursive: true });
  await fs.writeFile(
    path.join(rootPath, "A", "note.md"),
    "---\nid: same\ntitle: Note\ntags: [alpha, shared]\n---\n# Note\n\n## One {#dup}\n## Two {#dup}\n[[Missing]]\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootPath, "B", "other.md"),
    "---\nid: same\ntitle: Other\ntags: [beta]\n---\n# Other\n\n[[A/note]]\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootPath, "Orphan.md"),
    "---\nid: orphan\ntitle: Orphan\ntags: []\n---\n# Orphan\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootPath, "RootTagged.md"),
    "---\nid: root\ntitle: Root Tagged\ntags: [alpha]\n---\n# Root Tagged\n",
    "utf8",
  );

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  async function filter(kind: IndexFilterKind): Promise<IndexFilterResponse> {
    const response = await routeRequest(
      request("GET", `/api/vaults/${vault.id}/index/filters?filter=${kind}`),
      cwd,
    );
    assert.equal(response.status, 200);
    return response.body as IndexFilterResponse;
  }

  const broken = await filter("broken-links");
  assert.equal(broken.source, "machine-index");
  assert.ok(
    broken.results.some((result) => result.path === "A/note.md" && result.target === "Missing"),
  );

  const orphans = await filter("orphan-notes");
  assert.ok(orphans.results.some((result) => result.path === "Orphan.md"));

  const tags = await filter("tags");
  assert.ok(tags.results.some((result) => result.path === "A/note.md" && result.tag === "alpha"));
  assert.ok(tags.results.some((result) => result.path === "B/other.md" && result.tag === "beta"));

  const folders = await filter("folders");
  assert.ok(folders.results.some((result) => result.path === "A/note.md" && result.folder === "A"));
  assert.ok(
    folders.results.some((result) => result.path === "RootTagged.md" && result.folder === "/"),
  );

  const duplicateIds = await filter("duplicate-ids");
  assert.equal(duplicateIds.results.filter((result) => result.duplicateKey === "same").length, 2);

  const duplicateAnchors = await filter("duplicate-anchors");
  assert.equal(
    duplicateAnchors.results.filter(
      (result) => result.path === "A/note.md" && result.anchor === "dup",
    ).length,
    2,
  );
});

test("index search endpoint finds structural machine-index fields", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  await fs.mkdir(path.join(rootPath, "Topics"), { recursive: true });
  await fs.writeFile(
    path.join(rootPath, "Topics", "alpha-note.md"),
    "---\nid: alpha-id\ntitle: Alpha Note\ntags: [project-map]\n---\n# Alpha Note\n\n## Roadmap Section {#roadmap-anchor}\n\n[[target-note]]\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootPath, "target-note.md"),
    "---\nid: target-id\ntitle: Target Note\ntags: []\n---\n# Target Note\n",
    "utf8",
  );

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  async function search(q: string): Promise<IndexSearchResponse> {
    const response = await routeRequest(
      request("GET", `/api/vaults/${vault.id}/index/search?q=${encodeURIComponent(q)}`),
      cwd,
    );
    assert.equal(response.status, 200);
    return response.body as IndexSearchResponse;
  }

  const pathResults = await search("Topics/alpha-note.md");
  assert.equal(pathResults.source, "machine-index");
  assert.ok(
    pathResults.results.some(
      (result) => result.matchType === "file" && result.matchedField === "path",
    ),
  );

  const titleResults = await search("Alpha Note");
  assert.ok(
    titleResults.results.some(
      (result) => result.matchType === "file" && result.matchedField === "title",
    ),
  );
  assert.equal(titleResults.results[0]?.matchedField, "title");

  const idResults = await search("alpha-id");
  assert.ok(idResults.results.some((result) => result.matchType === "frontmatter-id"));

  const tagResults = await search("project-map");
  assert.ok(tagResults.results.some((result) => result.matchType === "tag"));

  const headingResults = await search("Roadmap Section");
  assert.ok(
    headingResults.results.some(
      (result) => result.matchType === "heading" && result.headingText === "Roadmap Section",
    ),
  );

  const anchorResults = await search("roadmap-anchor");
  assert.ok(
    anchorResults.results.some(
      (result) => result.matchType === "anchor" && result.anchor === "roadmap-anchor",
    ),
  );

  const linkResults = await search("target-note");
  assert.ok(
    linkResults.results.some(
      (result) => result.matchType === "link-target" && result.targetPath === "target-note.md",
    ),
  );

  const backlinkResults = await search("alpha-note");
  assert.ok(
    backlinkResults.results.some(
      (result) => result.matchType === "backlink" && result.path === "target-note.md",
    ),
  );

  const empty = await search("body-only-text-that-is-not-indexed");
  assert.equal(empty.total, 0);
});

test("index inspect endpoint exposes file-level machine-index details", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  await fs.mkdir(path.join(rootPath, "Refs"), { recursive: true });
  await fs.writeFile(
    path.join(rootPath, "note.md"),
    "---\nid: same\ntitle: Note\ntags: [alpha]\n---\n# Note\n\n## First {#dup}\n## Second {#dup}\n[[Refs/ref]]\n[[Missing]]\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootPath, "other.md"),
    "---\nid: same\ntitle: Other\ntags: []\n---\n# Other\n\n[[note]]\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootPath, "Refs", "ref.md"),
    "---\nid: ref\ntitle: Reference\ntags: []\n---\n# Reference\n\n[[note]]\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(rootPath, "orphan.md"),
    "---\nid: orphan\ntitle: Orphan\ntags: []\n---\n# Orphan\n",
    "utf8",
  );

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const response = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/inspect?path=note.md`),
    cwd,
  );
  assert.equal(response.status, 200);
  const inspect = response.body as VaultInspectResponse;
  assert.equal(inspect.source, "machine-index");
  assert.equal(inspect.path, "note.md");
  assert.equal(inspect.title, "Note");
  assert.equal(inspect.frontmatterId, "same");
  assert.deepEqual(inspect.tags, ["alpha"]);
  assert.ok(inspect.headings.some((heading) => heading.anchor === "dup"));
  assert.ok(
    inspect.outgoingLinks.some(
      (link) => link.target === "Refs/ref" && link.targetPath === "Refs/ref.md",
    ),
  );
  assert.ok(inspect.backlinks.some((backlink) => backlink.fromPath === "other.md"));
  assert.ok(inspect.backlinks.some((backlink) => backlink.fromPath === "Refs/ref.md"));
  assert.ok(inspect.brokenOutgoingLinks.some((link) => link.target === "Missing"));
  assert.equal(inspect.duplicateId?.id, "same");
  assert.deepEqual(inspect.duplicateId?.paths.sort(), ["note.md", "other.md"]);
  assert.equal(inspect.duplicateAnchors[0]?.anchor, "dup");
  assert.equal(inspect.duplicateAnchors[0]?.headings.length, 2);
  assert.equal(inspect.orphan, false);
  assert.ok(inspect.issues.some((issue) => issue.kind === "broken-wikilink"));

  const orphanResponse = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/inspect?path=orphan.md`),
    cwd,
  );
  assert.equal(orphanResponse.status, 200);
  assert.equal((orphanResponse.body as VaultInspectResponse).orphan, true);
});

test("user-authored index.md is indexed as a normal note when present", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  await fs.writeFile(path.join(rootPath, "Home.md"), "# Home\n\n[[index]]\n", "utf8");
  await fs.writeFile(path.join(rootPath, "index.md"), "# Optional Homepage\n\n[[Home]]\n", "utf8");

  const created = await routeRequest(
    request("POST", "/api/vaults", { rootPath, displayName: "Docs" }),
    cwd,
  );
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const response = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(response.status, 200);
  const { index } = response.body as VaultIndexResponse;
  assert.equal(index.notes["index.md"]?.title, "Optional Homepage");
  assert.equal(index.backlinks["index.md"]?.[0]?.fromPath, "Home.md");
  assert.equal(index.backlinks["Home.md"]?.[0]?.fromPath, "index.md");
});

test("external file change is surfaced through vault status", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n\nExternal edit.\n", "utf8");
  const status = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/status?path=note.md`),
    cwd,
  );
  assert.equal(status.status, 200);
  const body = statusBody(status);
  assert.equal(body.changedExternally, true);
  assert.ok(["stale", "rebuilding", "fresh"].includes(body.indexStatus));
  assert.equal(body.file?.exists, true);
  assert.equal(body.file?.changedExternally, true);
  assert.ok(body.changedPaths.includes("note.md"));
});

test("external additions and deletions are reflected in status and rebuilt index", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  await fs.writeFile(path.join(rootPath, "a.md"), "# A\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  await fs.writeFile(path.join(rootPath, "b.md"), "# B\n", "utf8");
  const added = await routeRequest(request("GET", `/api/vaults/${vault.id}/status`), cwd);
  assert.equal(added.status, 200);
  assert.ok(statusBody(added).addedPaths.includes("b.md"));

  await fs.unlink(path.join(rootPath, "a.md"));
  const deleted = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/status?path=a.md`),
    cwd,
  );
  assert.equal(deleted.status, 200);
  assert.equal(statusBody(deleted).file?.exists, false);
  assert.ok(statusBody(deleted).deletedPaths.includes("a.md"));

  const indexResponse = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(indexResponse.status, 200);
  const { index } = indexResponse.body as VaultIndexResponse;
  assert.equal(index.notes["a.md"], undefined);
  assert.ok(index.notes["b.md"]);
});

test("watch/index status ignores symlink escapes", async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-data-"));
  await writeConfig(cwd, appDataDir);
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-outside-"));
  await fs.writeFile(path.join(outside, "escape.md"), "# Escape\n", "utf8");
  try {
    await fs.symlink(outside, path.join(rootPath, "linked"), "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks unavailable");
      return;
    }
    throw error;
  }

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;

  const indexResponse = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(indexResponse.status, 200);
  const { index } = indexResponse.body as VaultIndexResponse;
  assert.equal(index.notes["linked/escape.md"], undefined);

  const files = await routeRequest(request("GET", `/api/vaults/${vault.id}/files`), cwd);
  assert.equal(files.status, 200);
  assert.deepEqual((files.body as { files: { path: string }[] }).files, []);
});

test("cors allows default local dev origins, env extras, and rejects arbitrary origins", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-server-"));
  const localhost = await routeRequest(
    request("GET", "/api/health", undefined, { origin: "http://localhost:8733" }),
    cwd,
  );
  assert.equal(localhost.status, 200);
  assert.equal(localhost.headers?.["access-control-allow-origin"], "http://localhost:8733");

  const loopback = await routeRequest(
    request("GET", "/api/health", undefined, { origin: "http://127.0.0.1:8733" }),
    cwd,
  );
  assert.equal(loopback.status, 200);
  assert.equal(loopback.headers?.["access-control-allow-origin"], "http://127.0.0.1:8733");

  const originalAllowedOrigins = process.env.AREPO_ALLOWED_ORIGINS;
  process.env.AREPO_ALLOWED_ORIGINS = "http://localhost:9001";
  try {
    const extra = await routeRequest(
      request("GET", "/api/health", undefined, { origin: "http://localhost:9001" }),
      cwd,
    );
    assert.equal(extra.status, 200);
    assert.equal(extra.headers?.["access-control-allow-origin"], "http://localhost:9001");
  } finally {
    if (originalAllowedOrigins === undefined) {
      delete process.env.AREPO_ALLOWED_ORIGINS;
    } else {
      process.env.AREPO_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  }

  const rejected = await routeRequest(
    request("GET", "/api/health", undefined, { origin: "https://example.com" }),
    cwd,
  );
  assert.equal(rejected.status, 403);
  assert.equal((rejected.body as { ok: boolean }).ok, false);
});
