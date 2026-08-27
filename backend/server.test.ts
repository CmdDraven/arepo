import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
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
  type VaultScopedGrant,
} from "./credentialStore.js";
import { createTokenVerifierMetadata, TOKEN_VERIFIER_SCHEME } from "./credentialVerifier.js";
import { machineIndexPath } from "./indexCache.js";
import {
  enrichmentPreferencesPath,
  readEnrichmentPreferences,
  writeRelatedNotesPreference,
} from "./enrichmentPreferences.js";
import { relatedNotesCachePath } from "./relatedNotesCache.js";
import { namedRelatedNotesPreference } from "../src/lib/vault/enrichmentPreferences.js";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";
import { buildGraph } from "../src/lib/vault/graph.js";
import { JSON_RAW_CONTENT_MAX_BYTES } from "../src/lib/vault/jsonBounds.js";
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

function installLstatInterceptor(
  intercept: (
    file: Parameters<typeof fs.lstat>[0],
    lstat: () => ReturnType<typeof fs.lstat>,
  ) => ReturnType<typeof fs.lstat>,
): () => void {
  const originalLstat = fs.lstat;
  fs.lstat = ((file, ...args) =>
    intercept(file, () => originalLstat(file, ...args))) as typeof fs.lstat;
  return () => {
    fs.lstat = originalLstat;
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
    vaultGrants?: readonly VaultScopedGrant[];
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
    vaultGrants:
      input.vaultGrants ??
      (input.vaultId
        ? [{ vaultId: input.vaultId, permissions: input.vaultPermissions ?? [] }]
        : []),
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

test("health endpoint returns local node info", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const response = await routeRequest(request("GET", "/api/health"), cwd);
  assert.equal(response.status, 200);
  assert.equal((response.body as { ok: boolean }).ok, true);
});

test("unexpected request-boundary failures do not expose filesystem details", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const sensitivePath = "/private/example/request-boundary-secret.txt";
  const failingRequest = request("GET", "/api/health");
  Object.defineProperty(failingRequest, "url", {
    get() {
      throw Object.assign(new Error(`EACCES: permission denied, open '${sensitivePath}'`), {
        code: "EACCES",
        syscall: "open",
        path: sensitivePath,
      });
    },
  });

  const response = await routeRequest(failingRequest, cwd);
  assert.deepEqual(response, {
    status: 500,
    body: { ok: false, error: "Internal server error", code: "internal-error" },
    headers: {},
  });
  const serialized = JSON.stringify(response);
  for (const hidden of [sensitivePath, "EACCES", "permission denied", "syscall", "stack"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test("disabled local mode browses server directories without listing files", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const root = await makeTestTempDir(t, "arepo-directory-browser-");
  await fs.mkdir(path.join(root, "zeta"));
  await fs.mkdir(path.join(root, "alpha"));
  await fs.writeFile(path.join(root, "hidden-file.txt"), "file\n", "utf8");

  const response = await routeRequest(
    request("GET", `/api/node/directories?path=${encodeURIComponent(root)}`),
    cwd,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    (response.body as { directories: { name: string }[] }).directories.map(({ name }) => name),
    ["alpha", "zeta"],
  );
  assert.equal(JSON.stringify(response.body).includes("hidden-file.txt"), false);

  const relative = await routeRequest(request("GET", "/api/node/directories?path=relative"), cwd);
  assert.deepEqual(relative, {
    status: 400,
    body: {
      ok: false,
      error: "Directory path must be absolute.",
      code: "invalid-directory-path",
    },
    headers: relative.headers,
  });
});

test("auth policy plumbing does not reject existing routes or accept credentials", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
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

test("disabled local vault listing preserves complete management visibility", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootA = await makeTestTempDir(t, "arepo-local-root-");
  const rootB = await makeTestTempDir(t, "arepo-local-root-");
  const vaultA = { ...testVault(rootA, "local-a"), displayName: "Local A" };
  const vaultB = { ...testVault(rootB, "local-b"), displayName: "Local B" };
  await writeConfig(cwd, appDataDir, { auth: { mode: "disabled" }, vaults: [vaultA, vaultB] });

  const response = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.equal(response.status, 200);
  const body = response.body as { vaultView: string; vaults: VaultInfo[] };
  assert.equal(body.vaultView, "management");
  assert.deepEqual(
    body.vaults.map((vault) => vault.id),
    [vaultA.id, vaultB.id],
  );
  assert.equal(body.vaults[0]?.rootPath, rootA);
  assert.equal(body.vaults[1]?.rootPath, rootB);
  assert.deepEqual(body.vaults[0]?.permissions, vaultA.permissions);
});

test("node status endpoint reports local runtime posture", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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
  assert.equal(status.browserSessionAuth.activationConfigPolicy.status, "inactive");
  assert.equal(status.browserSessionAuth.activationConfigPolicy.requestedActivation, false);
  assert.equal(status.browserSessionAuth.activationConfigPolicy.activationAllowed, false);
  assert.equal(status.browserSessionAuth.activationConfigPolicy.browserAuthEnabled, false);
  assert.equal(status.browserSessionAuth.activationConfigPolicy.mounted, false);
  assert.equal(status.browserSessionAuth.activationConfigPolicy.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.activationConfigPolicy.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.activationConfigPolicy.issuesCookies, false);
  assert.equal(status.browserSessionAuth.activationConfigPolicy.acceptsCookies, false);
  assert.equal(status.browserSessionAuth.activationGate.status, "blocked");
  assert.equal(status.browserSessionAuth.activationGate.allowed, false);
  assert.equal(status.browserSessionAuth.activationGate.browserAuthEnabled, false);
  assert.equal(status.browserSessionAuth.activationGate.mounted, false);
  assert.equal(status.browserSessionAuth.activationGate.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.activationGate.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.activationGate.issuesCookies, false);
  assert.equal(status.browserSessionAuth.activationGate.acceptsCookies, false);
  assert.equal(status.browserSessionAuth.activationGate.authenticatesRequests, false);
  assert.equal(status.browserSessionAuth.activationPreflight.status, "inactive");
  assert.equal(status.browserSessionAuth.activationPreflight.activationRequested, false);
  assert.equal(status.browserSessionAuth.activationPreflight.readyForFutureActivation, false);
  assert.equal(status.browserSessionAuth.activationPreflight.liveRouteMountingAllowed, false);
  assert.equal(status.browserSessionAuth.activationPreflight.browserAuthEnabled, false);
  assert.equal(status.browserSessionAuth.activationPreflight.mounted, false);
  assert.equal(status.browserSessionAuth.activationPreflight.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.activationPreflight.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.activationPreflight.issuesCookies, false);
  assert.equal(status.browserSessionAuth.activationPreflight.acceptsCookies, false);
  assert.equal(status.browserSessionAuth.activationPreflight.acceptsCsrfTokens, false);
  assert.ok(
    status.browserSessionAuth.activationPreflight.blockerCodes.includes(
      "browser-auth-route-mounting-blocked",
    ),
  );
  assert.equal(status.browserSessionAuth.routeContracts.status, "planning-only");
  assert.equal(status.browserSessionAuth.routeContracts.summary.totalPlannedRouteCount, 8);
  assert.equal(status.browserSessionAuth.routeContracts.summary.mountedLiveRouteCount, 0);
  assert.equal(status.browserSessionAuth.routeContracts.summary.issuingCookieRouteCount, 0);
  assert.equal(status.browserSessionAuth.routeContracts.summary.acceptingCookieRouteCount, 0);
  assert.equal(status.browserSessionAuth.routeContracts.summary.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.routeContracts.summary.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.routeHarness.status, "inactive");
  assert.equal(status.browserSessionAuth.routeHarness.mounted, false);
  assert.equal(status.browserSessionAuth.routeHarness.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.routeHarness.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.routeHarness.issuesCookies, false);
  assert.equal(status.browserSessionAuth.routeHarness.acceptsCookies, false);
  assert.equal(status.browserSessionAuth.routeHarness.issuesPairingCodes, false);
  assert.equal(status.browserSessionAuth.routeHarness.issuesBrowserSessions, false);
  assert.equal(status.browserSessionAuth.routeHarness.issuesCsrfTokens, false);
  assert.equal(status.browserSessionAuth.routeHarness.authenticatesRequests, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.status, "disabled-live-inert");
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.browserAuthEnabled, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.activationGateClosed, true);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.mountedInServer, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.betterAuthHandlerMounted, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.issuesCookies, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.acceptsCookies, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.validatesCsrf, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.createsBrowserSessions, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.authenticatesRequests, false);
  assert.equal(status.browserSessionAuth.disabledLiveAdapter.bearerProtectedModeUnchanged, true);
  assert.equal(status.browserSessionAuth.lifecycleCoordinator.status, "inactive");
  assert.equal(
    status.browserSessionAuth.lifecycleCoordinator.implementation,
    "in-memory-test-primitive",
  );
  assert.equal(status.browserSessionAuth.lifecycleCoordinator.mounted, false);
  assert.equal(status.browserSessionAuth.lifecycleCoordinator.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.lifecycleCoordinator.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.lifecycleCoordinator.issuesLiveCookies, false);
  assert.equal(status.browserSessionAuth.lifecycleCoordinator.acceptsCookies, false);
  assert.equal(status.browserSessionAuth.lifecycleCoordinator.enablesBrowserSessions, false);
  assert.equal(status.browserSessionAuth.lifecycleCoordinator.usesSanitizedAuditEvents, true);
  assert.equal(status.browserSessionAuth.pairing.enabled, false);
  assert.equal(status.browserSessionAuth.pairing.issueCode, "inactive");
  assert.equal(status.browserSessionAuth.pairing.consumeCode, "inactive");
  assert.equal(status.browserSessionAuth.pairing.storesRawCodes, false);
  assert.equal(status.browserSessionAuth.pairing.codeStore.status, "inactive");
  assert.equal(
    status.browserSessionAuth.pairing.codeStore.implementation,
    "in-memory-test-primitive",
  );
  assert.equal(status.browserSessionAuth.pairing.codeStore.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.pairing.codeStore.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.pairing.codeVerifier.status, "inactive");
  assert.equal(
    status.browserSessionAuth.pairing.codeVerifier.implementation,
    "hash-and-constant-time-compare-primitive",
  );
  assert.equal(status.browserSessionAuth.pairing.codeVerifier.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.pairing.codeVerifier.wiredIntoRoutes, false);
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
  assert.equal(status.browserSessionAuth.cookiePolicy.policyPrimitives.status, "inactive");
  assert.equal(
    status.browserSessionAuth.cookiePolicy.policyPrimitives.implementation,
    "policy-test-primitive",
  );
  assert.equal(
    status.browserSessionAuth.cookiePolicy.policyPrimitives.wiredIntoAuthorization,
    false,
  );
  assert.equal(status.browserSessionAuth.cookiePolicy.policyPrimitives.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.cookiePolicy.policyPrimitives.issuesCookies, false);
  assert.equal(status.browserSessionAuth.cookiePolicy.policyPrimitives.acceptsCookies, false);
  assert.equal(status.browserSessionAuth.cookiePolicy.headerSanitizer.status, "inactive");
  assert.equal(
    status.browserSessionAuth.cookiePolicy.headerSanitizer.implementation,
    "header-redaction-test-primitive",
  );
  assert.equal(
    status.browserSessionAuth.cookiePolicy.headerSanitizer.wiredIntoAuthorization,
    false,
  );
  assert.equal(status.browserSessionAuth.cookiePolicy.headerSanitizer.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.cookiePolicy.headerSanitizer.redactsCookieHeaders, true);
  assert.equal(
    status.browserSessionAuth.cookiePolicy.headerSanitizer.redactsAuthorizationHeaders,
    true,
  );
  assert.equal(
    status.browserSessionAuth.cookiePolicy.headerSanitizer.redactsSetCookieHeaders,
    true,
  );
  assert.equal(status.browserSessionAuth.cookiePolicy.headerSanitizer.redactsCsrfHeaders, true);
  assert.equal(status.browserSessionAuth.csrf.tokenIssuance, "inactive");
  assert.equal(status.browserSessionAuth.csrf.validation, "inactive");
  assert.equal(status.browserSessionAuth.csrf.unsafeMethodsRequireCsrfWhenSessionAuthLive, true);
  assert.equal(status.browserSessionAuth.csrf.bearerTokenRequiresBrowserCsrf, false);
  assert.equal(status.browserSessionAuth.csrf.storesRawTokens, false);
  assert.equal(status.browserSessionAuth.csrf.tokenStore.status, "inactive");
  assert.equal(
    status.browserSessionAuth.csrf.tokenStore.implementation,
    "in-memory-test-primitive",
  );
  assert.equal(status.browserSessionAuth.csrf.tokenStore.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.csrf.tokenStore.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.csrf.tokenVerifier.status, "inactive");
  assert.equal(
    status.browserSessionAuth.csrf.tokenVerifier.implementation,
    "hash-and-constant-time-compare-primitive",
  );
  assert.equal(status.browserSessionAuth.csrf.tokenVerifier.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.csrf.tokenVerifier.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.frontend.tokenStorage, false);
  assert.equal(status.browserSessionAuth.frontend.sessionSecretReadableByJs, false);
  assert.equal(status.browserSessionAuth.frontend.loginUi, "inactive");
  assert.equal(status.browserSessionAuth.audit.eventPrimitives.status, "inactive");
  assert.equal(
    status.browserSessionAuth.audit.eventPrimitives.implementation,
    "in-memory-test-primitive",
  );
  assert.equal(status.browserSessionAuth.audit.eventPrimitives.wiredIntoAuthorization, false);
  assert.equal(status.browserSessionAuth.audit.eventPrimitives.wiredIntoRoutes, false);
  assert.equal(status.browserSessionAuth.audit.eventPrimitives.sanitizesSecretMaterial, true);
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

test("node status endpoint reports non-local bind warning", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
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

test("node status endpoint returns reduced diagnostics when protected mode is not ready", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
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

test("protected-mode startup assessment denies protected routes when readiness is incomplete", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });

  const response = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.equal(response.status, 503);
  const body = response.body as { ok: false; code: string; reasonCodes: string[] };
  assert.equal(body.ok, false);
  assert.equal(body.code, "protected-mode-not-ready");
  assert.ok(body.reasonCodes.includes("auth-store-missing"));
});

test("protected mode enforces bearer credentials and vault route permissions", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const sourceBody = "# Protected\n\nsource-body-secret\n";
  const plainBody = "protected plain text — こんにちは\n";
  const chatBody =
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"protected-chat-secret"},"messages":[]}\n';
  await fs.writeFile(path.join(rootPath, "note.md"), sourceBody, "utf8");
  await fs.writeFile(path.join(rootPath, "plain.txt"), plainBody, "utf8");
  await fs.writeFile(path.join(rootPath, "conversation.arepo-chat.json"), chatBody, "utf8");
  const vault = testVault(rootPath);

  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" }, vaults: [vault] });
  await writeProtectedAuthStores(appDataDir, {
    vaultId: vault.id,
    vaultPermissions: ["readIndex"],
  });

  const indexRoutes = [
    `/api/vaults/${vault.id}/index`,
    `/api/vaults/${vault.id}/index/filters?filter=tags`,
    `/api/vaults/${vault.id}/index/search?q=Protected`,
    `/api/vaults/${vault.id}/index/inspect?path=note.md`,
  ];
  for (const indexRoute of indexRoutes) {
    const indexed = await routeRequest(
      request("GET", indexRoute, undefined, {
        authorization: `Bearer ${protectedBearerToken}`,
      }),
      cwd,
    );
    assert.equal(indexed.status, 200);
    assert.equal(JSON.stringify(indexed.body).includes("source-body-secret"), false);
    if (indexRoute.endsWith("/index")) {
      const indexResponse = indexed.body as VaultIndexResponse;
      assert.equal(Object.hasOwn(indexResponse.index.notes["note.md"] ?? {}, "body"), false);
      assert.equal(Object.hasOwn(indexResponse.index.notes, "plain.txt"), false);
      assert.equal(Object.hasOwn(indexResponse.index.notes, "conversation.arepo-chat.json"), false);
      assert.equal(JSON.stringify(indexResponse).includes(plainBody.trim()), false);
      assert.equal(JSON.stringify(indexResponse).includes("protected-chat-secret"), false);
    }
  }
  const plainStructuralSearch = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/search?q=plain.txt`, undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.deepEqual((plainStructuralSearch.body as IndexSearchResponse).results, []);

  const listed = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/files`, undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(listed.status, 200);
  assert.deepEqual(
    (listed.body as { files: { path: string; kind: string }[] }).files.map(
      ({ path: filePath, kind }) => ({ path: filePath, kind }),
    ),
    [
      { path: "conversation.arepo-chat.json", kind: "chat-json" },
      { path: "note.md", kind: "markdown" },
      { path: "plain.txt", kind: "plain-text" },
    ],
  );
  assert.equal(JSON.stringify(listed.body).includes(plainBody.trim()), false);
  assert.equal(JSON.stringify(listed.body).includes("protected-chat-secret"), false);

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

  const unauthorizedChat = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/file?path=conversation.arepo-chat.json`, undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(unauthorizedChat.status, 403);
  assert.equal(JSON.stringify(unauthorizedChat.body).includes("protected-chat-secret"), false);
  const unauthorizedPlain = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/file?path=plain.txt`, undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(unauthorizedPlain.status, 403);

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
  assert.equal((allowed.body as { content: string }).content, sourceBody);
  const allowedPlain = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/file?path=plain.txt`, undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(allowedPlain.status, 200);
  assert.equal((allowedPlain.body as { content: string; kind: string }).content, plainBody);
  assert.equal((allowedPlain.body as { content: string; kind: string }).kind, "plain-text");

  const paths = resolveAuthStoragePaths(appDataDir);
  const audit = await readAuthAuditEvents(paths.auditEvents);
  const serializedAudit = JSON.stringify(audit.events);
  assert.ok(audit.events.length >= 4);
  assert.equal(serializedAudit.includes(protectedBearerToken), false);
  assert.equal(serializedAudit.includes(invalidSecret), false);
  assert.equal(serializedAudit.includes("verifierHash"), false);
  assert.equal(serializedAudit.includes("salt"), false);
});

test("protected vault listing reveals only one granted vault and no registration paths", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootA = await makeTestTempDir(t, "arepo-visible-root-");
  const rootB = await makeTestTempDir(t, "arepo-hidden-root-");
  const rootC = await makeTestTempDir(t, "arepo-hidden-root-");
  const vaultA = { ...testVault(rootA, "vault-a"), displayName: "VISIBLE VAULT A" };
  const vaultB = {
    ...testVault(rootB, "vault-super-secret"),
    displayName: "SECRET HIDDEN VAULT",
  };
  const vaultC = { ...testVault(rootC, "vault-c-hidden"), displayName: "HIDDEN VAULT C" };
  await writeConfig(cwd, appDataDir, {
    auth: { mode: "protected" },
    vaults: [vaultA, vaultB, vaultC],
  });
  await writeProtectedAuthStores(appDataDir, {
    vaultGrants: [{ vaultId: vaultA.id, permissions: ["readIndex"] }],
  });

  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    nodeId: "local",
    displayName: "Local Node",
    mode: "local",
    apiVersion: 1,
    vaultView: "operational",
    vaults: [
      {
        id: vaultA.id,
        displayName: vaultA.displayName,
        availability: { status: "available" },
      },
    ],
  });

  const serialized = JSON.stringify(response.body);
  for (const hidden of [
    vaultB.id,
    vaultB.displayName,
    vaultB.rootPath,
    vaultC.id,
    vaultC.displayName,
    vaultC.rootPath,
    vaultA.rootPath,
    "permissions",
    "vaultIndexScope",
  ]) {
    assert.equal(serialized.includes(hidden), false, `response leaked ${hidden}`);
  }

  const audit = await readAuthAuditEvents(resolveAuthStoragePaths(appDataDir).auditEvents);
  const serializedAudit = JSON.stringify(audit.events);
  for (const hidden of [vaultB.id, vaultB.displayName, vaultB.rootPath, vaultA.rootPath]) {
    assert.equal(serializedAudit.includes(hidden), false, `audit leaked ${hidden}`);
  }
});

test("protected vault listing unions grants without broadening subsequent permissions", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootA = await makeTestTempDir(t, "arepo-root-");
  const rootB = await makeTestTempDir(t, "arepo-root-");
  const rootC = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(path.join(rootA, "a.md"), "# A\n", "utf8");
  await fs.writeFile(path.join(rootB, "b.md"), "# B\n", "utf8");
  await fs.writeFile(path.join(rootC, "c.md"), "# C\n", "utf8");
  const vaultA = { ...testVault(rootA, "vault-a"), displayName: "Vault A" };
  const vaultB = { ...testVault(rootB, "vault-b"), displayName: "Vault B" };
  const vaultC = { ...testVault(rootC, "vault-c"), displayName: "Vault C" };
  await writeConfig(cwd, appDataDir, {
    auth: { mode: "protected" },
    vaults: [vaultA, vaultB, vaultC],
  });
  await writeProtectedAuthStores(appDataDir, {
    vaultGrants: [
      { vaultId: vaultA.id, permissions: ["readIndex"] },
      { vaultId: vaultC.id, permissions: ["readContent"] },
    ],
  });
  const headers = { authorization: `Bearer ${protectedBearerToken}` };

  const listing = await routeRequest(request("GET", "/api/vaults", undefined, headers), cwd);
  assert.equal(listing.status, 200);
  assert.deepEqual(
    (listing.body as { vaults: { id: string }[] }).vaults.map((vault) => vault.id),
    [vaultA.id, vaultC.id],
  );
  assert.equal(JSON.stringify(listing.body).includes(vaultB.id), false);

  assert.equal(
    (await routeRequest(request("GET", `/api/vaults/${vaultA.id}/index`, undefined, headers), cwd))
      .status,
    200,
  );
  assert.equal(
    (
      await routeRequest(
        request("GET", `/api/vaults/${vaultA.id}/file?path=a.md`, undefined, headers),
        cwd,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await routeRequest(
        request("GET", `/api/vaults/${vaultC.id}/file?path=c.md`, undefined, headers),
        cwd,
      )
    ).status,
    200,
  );
  assert.equal(
    (await routeRequest(request("GET", `/api/vaults/${vaultC.id}/index`, undefined, headers), cwd))
      .status,
    403,
  );
  const deniedMutation = await routeRequest(
    request(
      "PUT",
      `/api/vaults/${vaultC.id}/file?path=c.md`,
      { content: "# Changed\n" },
      { ...headers, "x-arepo-confirmation": "confirm" },
    ),
    cwd,
  );
  assert.equal(deniedMutation.status, 403);
  assert.equal(await fs.readFile(path.join(rootC, "c.md"), "utf8"), "# C\n");
});

test("protected vault listing returns an empty collection for a valid zero-grant credential", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-hidden-root-");
  const hiddenVault = {
    ...testVault(rootPath, "vault-super-secret"),
    displayName: "SECRET HIDDEN VAULT",
  };
  await writeConfig(cwd, appDataDir, {
    auth: { mode: "protected" },
    vaults: [hiddenVault],
  });
  await writeProtectedAuthStores(appDataDir, {});

  const response = await routeRequest(
    request("GET", "/api/vaults", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(response.status, 200);
  assert.deepEqual((response.body as { vaults: unknown[] }).vaults, []);
  const serialized = JSON.stringify(response.body);
  for (const hidden of [hiddenVault.id, hiddenVault.displayName, hiddenVault.rootPath]) {
    assert.equal(serialized.includes(hidden), false);
  }
  assert.equal(serialized.includes("vaultCount"), false);
  assert.equal(serialized.includes("hiddenCount"), false);
});

test("manageVaults receives the full registration view without implied node capabilities", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootA = await makeTestTempDir(t, "arepo-vault-");
  const missingRoot = path.join(cwd, "missing-management-vault");
  const vaultA = { ...testVault(rootA, "vault-a"), displayName: "Managed A" };
  const vaultB = {
    ...testVault(missingRoot, "vault-b"),
    displayName: "Managed B",
    vaultIndexScope: { markdown: { minDepth: 1, maxDepth: 3 } },
  };
  await writeConfig(cwd, appDataDir, {
    auth: { mode: "protected" },
    vaults: [vaultA, vaultB],
  });
  await writeProtectedAuthStores(appDataDir, {
    nodePermissions: ["manageVaults"],
    vaultGrants: [{ vaultId: vaultA.id, permissions: ["readIndex", "readContent"] }],
  });
  const headers = { authorization: `Bearer ${protectedBearerToken}` };

  const response = await routeRequest(request("GET", "/api/vaults", undefined, headers), cwd);
  assert.equal(response.status, 200);
  const body = response.body as { vaultView: string; vaults: VaultInfo[] };
  assert.equal(body.vaultView, "management");
  assert.deepEqual(
    body.vaults.map((vault) => vault.id),
    [vaultA.id, vaultB.id],
  );
  assert.equal(body.vaults[0]?.rootPath, rootA);
  assert.deepEqual(body.vaults[0]?.permissions, vaultA.permissions);
  assert.deepEqual(body.vaults[1]?.vaultIndexScope, vaultB.vaultIndexScope);
  assert.deepEqual(body.vaults[1]?.availability, {
    status: "unavailable",
    reason: "root-not-found",
  });

  const nodeStatus = await routeRequest(
    request("GET", "/api/node/status", undefined, headers),
    cwd,
  );
  assert.equal(nodeStatus.status, 403);

  const scopeUpdate = await routeRequest(
    request(
      "PATCH",
      `/api/vaults/${vaultA.id}/index-scope`,
      { vaultIndexScope: { markdown: { minDepth: 0, maxDepth: 2 } } },
      headers,
    ),
    cwd,
  );
  assert.equal(scopeUpdate.status, 200);

  const addedRoot = await makeTestTempDir(t, "arepo-vault-");
  const confirmedHeaders = { ...headers, "x-arepo-confirmation": "confirm" };
  const added = await routeRequest(
    request("POST", "/api/vaults", { rootPath: addedRoot, displayName: "Added" }, confirmedHeaders),
    cwd,
  );
  assert.equal(added.status, 201);
  const addedVault = (added.body as { data: { vault: VaultInfo } }).data.vault;

  const removed = await routeRequest(
    request(
      "DELETE",
      `/api/vaults/${addedVault.id}`,
      { generatedDataAction: "keep" },
      confirmedHeaders,
    ),
    cwd,
  );
  assert.equal(removed.status, 200);
});

test("protected directory browsing requires manageVaults and grants no unrelated authority", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const vaultRoot = await makeTestTempDir(t, "arepo-vault-");
  const browseRoot = await makeTestTempDir(t, "arepo-directory-browser-");
  await fs.mkdir(path.join(browseRoot, "Visible child"));
  const vault = testVault(vaultRoot, "directory-policy-vault");
  await writeConfig(cwd, appDataDir, {
    auth: { mode: "protected" },
    vaults: [vault],
  });
  const route = `/api/node/directories?path=${encodeURIComponent(browseRoot)}`;
  const bearerHeaders = { authorization: `Bearer ${protectedBearerToken}` };
  await writeProtectedAuthStores(appDataDir, {
    vaultGrants: [{ vaultId: vault.id, permissions: ["readIndex", "readContent"] }],
  });

  const anonymous = await routeRequest(request("GET", route), cwd);
  assert.equal(anonymous.status, 401);
  assert.equal(JSON.stringify(anonymous.body).includes(browseRoot), false);

  const scoped = await routeRequest(request("GET", route, undefined, bearerHeaders), cwd);
  assert.equal(scoped.status, 403);
  assert.equal(JSON.stringify(scoped.body).includes(browseRoot), false);
  assert.equal(JSON.stringify(scoped.body).includes("Visible child"), false);

  await writeProtectedAuthStores(appDataDir, {});
  const zeroGrant = await routeRequest(request("GET", route, undefined, bearerHeaders), cwd);
  assert.equal(zeroGrant.status, 403);
  assert.equal(JSON.stringify(zeroGrant.body).includes(browseRoot), false);

  await writeProtectedAuthStores(appDataDir, { nodePermissions: ["manageVaults"] });
  const managed = await routeRequest(request("GET", route, undefined, bearerHeaders), cwd);
  assert.equal(managed.status, 200);
  assert.equal(
    (managed.body as { currentPath: string }).currentPath,
    await fs.realpath(browseRoot),
  );
  assert.deepEqual(
    (managed.body as { directories: { name: string }[] }).directories.map(({ name }) => name),
    ["Visible child"],
  );

  const nodeStatus = await routeRequest(
    request("GET", "/api/node/status", undefined, bearerHeaders),
    cwd,
  );
  assert.equal(nodeStatus.status, 403);
});

test("protected vault rebind requires authentication, manageVaults, and confirmation", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-vault-");
  const replacementRoot = await makeTestTempDir(t, "arepo-vault-");
  const vault = testVault(rootPath, "protected-rebind");
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" }, vaults: [vault] });
  await writeProtectedAuthStores(appDataDir, { nodePermissions: [] });
  const route = `/api/vaults/${vault.id}/rebind`;

  const anonymous = await routeRequest(request("POST", route, { rootPath: replacementRoot }), cwd);
  assert.equal(anonymous.status, 401);
  assert.equal((await loadConfig(cwd)).vaults[0]?.rootPath, rootPath);

  const unauthorized = await routeRequest(
    request(
      "POST",
      route,
      { rootPath: replacementRoot },
      {
        authorization: `Bearer ${protectedBearerToken}`,
        "x-arepo-confirmation": "confirm",
      },
    ),
    cwd,
  );
  assert.equal(unauthorized.status, 403);
  assert.equal((await loadConfig(cwd)).vaults[0]?.rootPath, rootPath);

  await writeProtectedAuthStores(appDataDir, { nodePermissions: ["manageVaults"] });
  const unconfirmed = await routeRequest(
    request(
      "POST",
      route,
      { rootPath: replacementRoot },
      {
        authorization: `Bearer ${protectedBearerToken}`,
      },
    ),
    cwd,
  );
  assert.equal(unconfirmed.status, 428);
  assert.equal((await loadConfig(cwd)).vaults[0]?.rootPath, rootPath);

  const confirmed = await routeRequest(
    request(
      "POST",
      route,
      { rootPath: replacementRoot },
      {
        authorization: `Bearer ${protectedBearerToken}`,
        "x-arepo-confirmation": "confirm",
      },
    ),
    cwd,
  );
  assert.equal(confirmed.status, 200);
  assert.equal((await loadConfig(cwd)).vaults[0]?.rootPath, replacementRoot);
});

test("protected mode returns reduced anonymous status and full authorized status", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
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
  assert.equal(full.browserSessionAuth.activationConfigPolicy.status, "inactive");
  assert.equal(full.browserSessionAuth.activationConfigPolicy.requestedActivation, false);
  assert.equal(full.browserSessionAuth.activationConfigPolicy.activationAllowed, false);
  assert.equal(full.browserSessionAuth.activationConfigPolicy.browserAuthEnabled, false);
  assert.equal(full.browserSessionAuth.activationConfigPolicy.mounted, false);
  assert.equal(full.browserSessionAuth.activationConfigPolicy.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.activationConfigPolicy.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.activationConfigPolicy.issuesCookies, false);
  assert.equal(full.browserSessionAuth.activationConfigPolicy.acceptsCookies, false);
  assert.equal(full.browserSessionAuth.activationGate.status, "blocked");
  assert.equal(full.browserSessionAuth.activationGate.allowed, false);
  assert.equal(full.browserSessionAuth.activationGate.browserAuthEnabled, false);
  assert.equal(full.browserSessionAuth.activationGate.mounted, false);
  assert.equal(full.browserSessionAuth.activationGate.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.activationGate.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.activationGate.issuesCookies, false);
  assert.equal(full.browserSessionAuth.activationGate.acceptsCookies, false);
  assert.equal(full.browserSessionAuth.activationGate.authenticatesRequests, false);
  assert.equal(full.browserSessionAuth.activationPreflight.status, "inactive");
  assert.equal(full.browserSessionAuth.activationPreflight.activationRequested, false);
  assert.equal(full.browserSessionAuth.activationPreflight.readyForFutureActivation, false);
  assert.equal(full.browserSessionAuth.activationPreflight.liveRouteMountingAllowed, false);
  assert.equal(full.browserSessionAuth.activationPreflight.browserAuthEnabled, false);
  assert.equal(full.browserSessionAuth.activationPreflight.mounted, false);
  assert.equal(full.browserSessionAuth.activationPreflight.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.activationPreflight.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.activationPreflight.issuesCookies, false);
  assert.equal(full.browserSessionAuth.activationPreflight.acceptsCookies, false);
  assert.equal(full.browserSessionAuth.activationPreflight.acceptsCsrfTokens, false);
  assert.ok(
    full.browserSessionAuth.activationPreflight.blockerCodes.includes(
      "browser-auth-route-mounting-blocked",
    ),
  );
  assert.equal(full.browserSessionAuth.routeContracts.status, "planning-only");
  assert.equal(full.browserSessionAuth.routeContracts.summary.totalPlannedRouteCount, 8);
  assert.equal(full.browserSessionAuth.routeContracts.summary.mountedLiveRouteCount, 0);
  assert.equal(full.browserSessionAuth.routeContracts.summary.issuingCookieRouteCount, 0);
  assert.equal(full.browserSessionAuth.routeContracts.summary.acceptingCookieRouteCount, 0);
  assert.equal(full.browserSessionAuth.routeContracts.summary.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.routeContracts.summary.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.routeHarness.status, "inactive");
  assert.equal(full.browserSessionAuth.routeHarness.mounted, false);
  assert.equal(full.browserSessionAuth.routeHarness.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.routeHarness.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.routeHarness.issuesCookies, false);
  assert.equal(full.browserSessionAuth.routeHarness.acceptsCookies, false);
  assert.equal(full.browserSessionAuth.routeHarness.issuesPairingCodes, false);
  assert.equal(full.browserSessionAuth.routeHarness.issuesBrowserSessions, false);
  assert.equal(full.browserSessionAuth.routeHarness.issuesCsrfTokens, false);
  assert.equal(full.browserSessionAuth.routeHarness.authenticatesRequests, false);
  assert.equal(full.browserSessionAuth.lifecycleCoordinator.status, "inactive");
  assert.equal(
    full.browserSessionAuth.lifecycleCoordinator.implementation,
    "in-memory-test-primitive",
  );
  assert.equal(full.browserSessionAuth.lifecycleCoordinator.mounted, false);
  assert.equal(full.browserSessionAuth.lifecycleCoordinator.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.lifecycleCoordinator.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.lifecycleCoordinator.issuesLiveCookies, false);
  assert.equal(full.browserSessionAuth.lifecycleCoordinator.acceptsCookies, false);
  assert.equal(full.browserSessionAuth.lifecycleCoordinator.enablesBrowserSessions, false);
  assert.equal(full.browserSessionAuth.lifecycleCoordinator.usesSanitizedAuditEvents, true);
  assert.equal(full.browserSessionAuth.pairing.status, "planning-only");
  assert.equal(full.browserSessionAuth.pairing.issueCode, "inactive");
  assert.equal(full.browserSessionAuth.pairing.consumeCode, "inactive");
  assert.equal(full.browserSessionAuth.pairing.storesRawCodes, false);
  assert.equal(full.browserSessionAuth.pairing.codeStore.status, "inactive");
  assert.equal(
    full.browserSessionAuth.pairing.codeStore.implementation,
    "in-memory-test-primitive",
  );
  assert.equal(full.browserSessionAuth.pairing.codeStore.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.pairing.codeStore.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.pairing.codeVerifier.status, "inactive");
  assert.equal(
    full.browserSessionAuth.pairing.codeVerifier.implementation,
    "hash-and-constant-time-compare-primitive",
  );
  assert.equal(full.browserSessionAuth.pairing.codeVerifier.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.pairing.codeVerifier.wiredIntoRoutes, false);
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
  assert.equal(full.browserSessionAuth.cookiePolicy.policyPrimitives.status, "inactive");
  assert.equal(
    full.browserSessionAuth.cookiePolicy.policyPrimitives.implementation,
    "policy-test-primitive",
  );
  assert.equal(full.browserSessionAuth.cookiePolicy.policyPrimitives.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.cookiePolicy.policyPrimitives.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.cookiePolicy.policyPrimitives.issuesCookies, false);
  assert.equal(full.browserSessionAuth.cookiePolicy.policyPrimitives.acceptsCookies, false);
  assert.equal(full.browserSessionAuth.cookiePolicy.headerSanitizer.status, "inactive");
  assert.equal(
    full.browserSessionAuth.cookiePolicy.headerSanitizer.implementation,
    "header-redaction-test-primitive",
  );
  assert.equal(full.browserSessionAuth.cookiePolicy.headerSanitizer.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.cookiePolicy.headerSanitizer.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.cookiePolicy.headerSanitizer.redactsCookieHeaders, true);
  assert.equal(
    full.browserSessionAuth.cookiePolicy.headerSanitizer.redactsAuthorizationHeaders,
    true,
  );
  assert.equal(full.browserSessionAuth.cookiePolicy.headerSanitizer.redactsSetCookieHeaders, true);
  assert.equal(full.browserSessionAuth.cookiePolicy.headerSanitizer.redactsCsrfHeaders, true);
  assert.equal(full.browserSessionAuth.csrf.tokenIssuance, "inactive");
  assert.equal(full.browserSessionAuth.csrf.validation, "inactive");
  assert.equal(full.browserSessionAuth.csrf.bearerTokenRequiresBrowserCsrf, false);
  assert.equal(full.browserSessionAuth.csrf.storesRawTokens, false);
  assert.equal(full.browserSessionAuth.csrf.tokenStore.status, "inactive");
  assert.equal(full.browserSessionAuth.csrf.tokenStore.implementation, "in-memory-test-primitive");
  assert.equal(full.browserSessionAuth.csrf.tokenStore.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.csrf.tokenStore.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.csrf.tokenVerifier.status, "inactive");
  assert.equal(
    full.browserSessionAuth.csrf.tokenVerifier.implementation,
    "hash-and-constant-time-compare-primitive",
  );
  assert.equal(full.browserSessionAuth.csrf.tokenVerifier.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.csrf.tokenVerifier.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.frontend.tokenStorage, false);
  assert.equal(full.browserSessionAuth.frontend.sessionSecretReadableByJs, false);
  assert.equal(full.browserSessionAuth.frontend.loginUi, "inactive");
  assert.ok(full.browserSessionAuth.audit.events.includes("browser_session_issue_denied"));
  assert.equal(full.browserSessionAuth.audit.eventPrimitives.status, "inactive");
  assert.equal(
    full.browserSessionAuth.audit.eventPrimitives.implementation,
    "in-memory-test-primitive",
  );
  assert.equal(full.browserSessionAuth.audit.eventPrimitives.wiredIntoAuthorization, false);
  assert.equal(full.browserSessionAuth.audit.eventPrimitives.wiredIntoRoutes, false);
  assert.equal(full.browserSessionAuth.audit.eventPrimitives.sanitizesSecretMaterial, true);
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

test("protected mode fails closed for routes without a permission policy", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("protected dry-run canary remains sanitized when anonymous dry-run is enabled", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
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

test("browser session and pairing auth stubs return sanitized unavailable responses", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
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

test("protected mode treats session-cookie auth as unsupported in this slice", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
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

test("protected credential bootstrap is localhost-only and returns raw token once", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("protected credential create revoke and audit responses remain sanitized", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
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

test("protected credential rotation revokes old token and returns replacement once", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
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

test("expired bearer credentials return sanitized 401 while active credentials keep readiness complete", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
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

test("unsupported auth modes still fail closed clearly", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
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

test("node status endpoint surfaces invalid config diagnostics", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
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

test("node status bounds protected startup and credential-store diagnostics", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-sensitive-");
  await writeConfig(cwd, appDataDir, {
    auth: { mode: "disabled", requestedMode: "protected" },
  });
  await writeProtectedAuthStores(appDataDir, {});
  const paths = resolveAuthStoragePaths(appDataDir);
  await fs.writeFile(paths.credentials, "{ sensitive invalid json", "utf8");

  const response = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(response.status, 200);
  const status = response.body as LocalNodeRuntimeStatus;
  assert.equal(status.credentialLifecycle.error, "Credential lifecycle status unavailable.");
  assert.equal(status.protectedModeStartup.corruptStores.length, 1);
  assert.equal(
    status.protectedModeStartup.corruptStores[0]?.error,
    "Auth store validation failed.",
  );
  const exposedErrors = JSON.stringify({
    lifecycle: status.credentialLifecycle.error,
    startup: status.protectedModeStartup.corruptStores[0]?.error,
  });
  for (const hidden of [
    appDataDir,
    paths.credentials,
    "Corrupt AREPO auth store",
    "invalid JSON",
  ]) {
    assert.equal(exposedErrors.includes(hidden), false, hidden);
  }
});

test("vault registration and file APIs stay inside configured root", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");

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

test("file mutation endpoints reject plain-text targets", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(path.join(rootPath, "read-only.txt"), "unchanged\n", "utf8");
  const vault: VaultInfo = {
    ...testVault(rootPath, "plain-text-mutations"),
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: true,
    },
  };
  await writeConfig(cwd, appDataDir, { vaults: [vault] });

  const responses = await Promise.all([
    routeRequest(
      request("PUT", `/api/vaults/${vault.id}/file?path=read-only.txt`, {
        content: "changed\n",
      }),
      cwd,
    ),
    routeRequest(
      request("POST", `/api/vaults/${vault.id}/file`, {
        path: "new.txt",
        content: "new\n",
      }),
      cwd,
    ),
    routeRequest(
      request("POST", `/api/vaults/${vault.id}/rename`, {
        fromPath: "read-only.txt",
        toPath: "renamed.txt",
        kind: "file",
      }),
      cwd,
    ),
    routeRequest(request("DELETE", `/api/vaults/${vault.id}/file?path=read-only.txt`), cwd),
  ]);

  assert.deepEqual(
    responses.map((response) => response.status),
    [400, 400, 400, 400],
  );
  assert.equal(await fs.readFile(path.join(rootPath, "read-only.txt"), "utf8"), "unchanged\n");
  await assert.rejects(() => fs.access(path.join(rootPath, "new.txt")));
});

test("failed mutation conflicts do not publish watcher success bookkeeping", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const target = path.join(rootPath, "note.md");
  const displaced = path.join(rootPath, "displaced.md");
  await fs.writeFile(target, "# Original\n", "utf8");
  const vault: VaultInfo = {
    ...testVault(rootPath, "mutation-conflict-watcher"),
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: true,
    },
  };
  await writeConfig(cwd, appDataDir, { vaults: [vault] });

  const before = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/file?path=note.md`),
    cwd,
  );
  await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  let replaced = false;
  const restoreLstat = installLstatInterceptor(async (file, lstat) => {
    if (!replaced && String(file) === target) {
      const entries = await fs.readdir(rootPath);
      if (entries.some((entry) => entry.startsWith(".note.md.") && entry.endsWith(".tmp"))) {
        replaced = true;
        await fs.rename(target, displaced);
        await fs.writeFile(target, "# External replacement\n", "utf8");
      }
    }
    return lstat();
  });
  let response: Awaited<ReturnType<typeof routeRequest>>;
  try {
    response = await routeRequest(
      request("PUT", `/api/vaults/${vault.id}/file?path=note.md`, {
        content: "# AREPO edit\n",
        expectedHash: (before.body as { hash: string }).hash,
        expectedMtimeMs: (before.body as { mtimeMs: number }).mtimeMs,
      }),
      cwd,
    );
  } finally {
    restoreLstat();
  }

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    ok: false,
    error: "Vault path changed during operation. Refresh and retry.",
    code: "CONFLICT",
  });
  assert.equal(JSON.stringify(response.body).includes(rootPath), false);
  assert.equal(await fs.readFile(target, "utf8"), "# External replacement\n");
  const status = statusBody(
    await routeRequest(request("GET", `/api/vaults/${vault.id}/status`), cwd),
  );
  assert.equal(status.changedExternally, true);
  assert.equal(status.indexStatus, "stale");
  assert.ok(status.changedPaths.includes("note.md"));
});

test("chat and generic JSON metadata omit bodies while content endpoints return canonical source", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const chatBody = JSON.stringify({
    format: "arepo-chat-export",
    version: 1,
    conversation: { id: "conv-auth", title: "chat-title-secret" },
    messages: [
      {
        id: "msg-auth",
        author: "Alice",
        timestamp: "2026-08-24T10:00:00Z",
        text: "chat-body-secret [[not-indexed]]",
      },
    ],
  });
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  await fs.writeFile(path.join(rootPath, "conversation.arepo-chat.json"), chatBody, "utf8");
  const genericBody = '{\n  "mixed": [null, true, {"private":"generic-body-secret"}]\n}\n';
  const malformedBody = '{\n  "repair-me": true,\n';
  await fs.writeFile(path.join(rootPath, "data.json"), genericBody, "utf8");
  await fs.writeFile(path.join(rootPath, "malformed.json"), malformedBody, "utf8");
  const readable = testVault(rootPath, "chat-readable");
  await writeConfig(cwd, appDataDir, { vaults: [readable] });

  const listed = await routeRequest(request("GET", `/api/vaults/${readable.id}/files`), cwd);
  assert.equal(listed.status, 200);
  assert.deepEqual(
    (listed.body as { files: { path: string; kind: string }[] }).files.map(
      ({ path: filePath, kind }) => ({ path: filePath, kind }),
    ),
    [
      { path: "conversation.arepo-chat.json", kind: "chat-json" },
      { path: "data.json", kind: "generic-json" },
      { path: "malformed.json", kind: "generic-json" },
      { path: "note.md", kind: "markdown" },
    ],
  );
  assert.equal(JSON.stringify(listed.body).includes("chat-body-secret"), false);
  assert.equal(JSON.stringify(listed.body).includes("generic-body-secret"), false);

  const read = await routeRequest(
    request("GET", `/api/vaults/${readable.id}/file?path=conversation.arepo-chat.json`),
    cwd,
  );
  assert.equal(read.status, 200);
  assert.equal((read.body as { kind: string; content: string }).kind, "chat-json");
  assert.equal((read.body as { content: string }).content, chatBody);
  for (const [sourcePath, expected] of [
    ["data.json", genericBody],
    ["malformed.json", malformedBody],
  ] as const) {
    const genericRead = await routeRequest(
      request("GET", `/api/vaults/${readable.id}/file?path=${sourcePath}`),
      cwd,
    );
    assert.equal(genericRead.status, 200);
    assert.equal((genericRead.body as { kind: string }).kind, "generic-json");
    assert.equal((genericRead.body as { content: string }).content, expected);
  }

  const indexRoutes = [
    `/api/vaults/${readable.id}/index`,
    `/api/vaults/${readable.id}/index/filters?filter=tags`,
    `/api/vaults/${readable.id}/index/search?q=unrelated-query`,
    `/api/vaults/${readable.id}/index/inspect?path=note.md`,
  ];
  for (const route of indexRoutes) {
    const response = await routeRequest(request("GET", route), cwd);
    assert.equal(response.status, 200, route);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes("chat-title-secret"), false, route);
    assert.equal(serialized.includes("chat-body-secret"), false, route);
    assert.equal(serialized.includes("not-indexed"), false, route);
    assert.equal(serialized.includes("generic-body-secret"), false, route);
  }
  const chatStructuralSearch = await routeRequest(
    request("GET", `/api/vaults/${readable.id}/index/search?q=conversation.arepo-chat.json`),
    cwd,
  );
  assert.deepEqual((chatStructuralSearch.body as IndexSearchResponse).results, []);
});

test("oversized JSON remains listed and returns a bounded content error", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const oversizedPath = path.join(rootPath, "oversized.json");
  await fs.writeFile(oversizedPath, "", "utf8");
  await fs.truncate(oversizedPath, JSON_RAW_CONTENT_MAX_BYTES + 1);
  const vault = testVault(rootPath, "oversized-json");
  await writeConfig(cwd, appDataDir, { vaults: [vault] });

  const listed = await routeRequest(request("GET", `/api/vaults/${vault.id}/files`), cwd);
  assert.equal(listed.status, 200);
  assert.deepEqual(
    (listed.body as { files: Array<{ path: string; kind: string }> }).files.map((file) => ({
      path: file.path,
      kind: file.kind,
    })),
    [{ path: "oversized.json", kind: "generic-json" }],
  );

  const index = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(index.status, 200);
  assert.deepEqual(Object.keys((index.body as VaultIndexResponse).index.notes), []);

  const read = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/file?path=oversized.json`),
    cwd,
  );
  assert.equal(read.status, 413);
  assert.deepEqual(read.body, {
    ok: false,
    error: "Source is too large to preview safely.",
    code: "source-too-large",
  });
  assert.equal(JSON.stringify(read.body).includes(rootPath), false);
});

test("file mutation endpoints reject chat-json targets", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const source =
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"conv"},"messages":[]}\n';
  await fs.writeFile(path.join(rootPath, "conversation.arepo-chat.json"), source, "utf8");
  const vault: VaultInfo = {
    ...testVault(rootPath, "chat-mutations"),
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: true,
    },
  };
  await writeConfig(cwd, appDataDir, { vaults: [vault] });

  const responses = await Promise.all([
    routeRequest(
      request("PUT", `/api/vaults/${vault.id}/file?path=conversation.arepo-chat.json`, {
        content: source,
      }),
      cwd,
    ),
    routeRequest(
      request("POST", `/api/vaults/${vault.id}/file`, {
        path: "new.arepo-chat.json",
        content: source,
      }),
      cwd,
    ),
    routeRequest(
      request("POST", `/api/vaults/${vault.id}/rename`, {
        fromPath: "conversation.arepo-chat.json",
        toPath: "renamed.arepo-chat.json",
        kind: "file",
      }),
      cwd,
    ),
    routeRequest(
      request("DELETE", `/api/vaults/${vault.id}/file?path=conversation.arepo-chat.json`),
      cwd,
    ),
  ]);

  assert.deepEqual(
    responses.map((response) => response.status),
    [400, 400, 400, 400],
  );
  assert.equal(
    await fs.readFile(path.join(rootPath, "conversation.arepo-chat.json"), "utf8"),
    source,
  );
  await assert.rejects(() => fs.access(path.join(rootPath, "new.arepo-chat.json")));
});

test("folder rename rejects immutable source descendants with a bounded atomic failure", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const sourceFolder = path.join(rootPath, "source", "nested");
  await fs.mkdir(sourceFolder, { recursive: true });
  await fs.writeFile(path.join(rootPath, "source", "note.md"), "# Note\n", "utf8");
  await fs.writeFile(path.join(sourceFolder, "read-only.txt"), "unchanged\n", "utf8");
  const vault = testVault(rootPath, "folder-rename-policy");
  await writeConfig(cwd, appDataDir, { vaults: [vault] });

  const response = await routeRequest(
    request("POST", `/api/vaults/${vault.id}/rename`, {
      fromPath: "source",
      toPath: "destination/renamed",
      kind: "folder",
    }),
    cwd,
  );

  assert.equal(response.status, 400);
  assert.equal((response.body as { ok: boolean }).ok, false);
  assert.equal(
    (response.body as { error: string }).error,
    "Folder rename is not allowed because the folder contains read-only source content",
  );
  assert.equal(JSON.stringify(response.body).includes(rootPath), false);
  assert.equal(await fs.readFile(path.join(rootPath, "source", "note.md"), "utf8"), "# Note\n");
  assert.equal(await fs.readFile(path.join(sourceFolder, "read-only.txt"), "utf8"), "unchanged\n");
  await assert.rejects(() => fs.access(path.join(rootPath, "destination")), /ENOENT/);
});

test("vault index scope update persists config and rebuilds the machine index", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-vault-");
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

test("vault storage endpoint reports content and cache sizes", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-vault-");
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

test("removing a vault can keep generated data without deleting source files", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-vault-");
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

test("removing a vault can discard verified AREPO-generated data without deleting source files", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-vault-");
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

test("discarding generated data retains durable enrichment preferences", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-vault-");
  await fs.writeFile(path.join(rootPath, "a.md"), "# A\ncanonical stale conflict version", "utf8");
  await fs.writeFile(path.join(rootPath, "b.md"), "# B\ncanonical stale conflict version", "utf8");
  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  await writeRelatedNotesPreference(vault, namedRelatedNotesPreference("balanced", true), cwd);
  await routeRequest(request("GET", `/api/vaults/${vault.id}/enrichment/related?path=a.md`), cwd);
  const preferenceFile = await enrichmentPreferencesPath(vault, cwd);
  const enrichmentCache = await relatedNotesCachePath(vault, cwd);
  await fs.access(preferenceFile);
  await fs.access(enrichmentCache);

  const removed = await routeRequest(
    request("DELETE", `/api/vaults/${vault.id}`, { generatedDataAction: "discard" }),
    cwd,
  );
  assert.equal(removed.status, 200);
  await fs.access(preferenceFile);
  await assert.rejects(() => fs.access(enrichmentCache), { code: "ENOENT" });
  assert.equal(
    (await readEnrichmentPreferences(vault, cwd)).preferences.producers.relatedNotes.enabled,
    true,
  );
});

test("removing an inaccessible vault registration does not require the vault root to exist", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-vault-");
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

test("one unavailable vault remains isolated from an available vault and node status", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const availableRoot = await makeTestTempDir(t, "arepo-vault-");
  const missingRoot = path.join(cwd, "missing-vault");
  await fs.writeFile(path.join(availableRoot, "working.md"), "# Working\n", "utf8");
  await fs.writeFile(path.join(availableRoot, "working.txt"), "available body\n", "utf8");
  const availableVault = testVault(availableRoot, "available");
  const unavailableVault = testVault(missingRoot, "unavailable");
  await writeConfig(cwd, appDataDir, { vaults: [availableVault, unavailableVault] });

  const listing = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.equal(listing.status, 200);
  const listedVaults = (listing.body as { vaults: VaultInfo[] }).vaults;
  assert.deepEqual(listedVaults.find((vault) => vault.id === "available")?.availability, {
    status: "available",
  });
  assert.deepEqual(listedVaults.find((vault) => vault.id === "unavailable")?.availability, {
    status: "unavailable",
    reason: "root-not-found",
  });

  const [files, content, index] = await Promise.all([
    routeRequest(request("GET", "/api/vaults/available/files"), cwd),
    routeRequest(request("GET", "/api/vaults/available/file?path=working.txt"), cwd),
    routeRequest(request("GET", "/api/vaults/available/index"), cwd),
  ]);
  assert.equal(files.status, 200);
  assert.equal((content.body as { content: string }).content, "available body\n");
  assert.ok((index.body as VaultIndexResponse).index.notes["working.md"]);

  for (const url of [
    "/api/vaults/unavailable/files",
    "/api/vaults/unavailable/file?path=secret.md",
    "/api/vaults/unavailable/index",
    "/api/vaults/unavailable/status",
    "/api/vaults/unavailable/storage",
  ]) {
    const response = await routeRequest(request("GET", url), cwd);
    assert.equal(response.status, 503, url);
    assert.deepEqual(response.body, {
      ok: false,
      error: "Vault root is unavailable.",
      code: "VAULT_ROOT_UNAVAILABLE",
      reason: "root-not-found",
    });
    assert.equal(JSON.stringify(response.body).includes(missingRoot), false);
  }

  const nodeStatus = await routeRequest(request("GET", "/api/node/status"), cwd);
  assert.equal(nodeStatus.status, 200);
  const status = nodeStatus.body as LocalNodeRuntimeStatus;
  assert.equal(status.vaults.find((vault) => vault.vaultId === "available")?.watcherHealth, "ok");
  assert.deepEqual(status.vaults.find((vault) => vault.vaultId === "unavailable")?.availability, {
    status: "unavailable",
    reason: "root-not-found",
  });
});

test("rebind preserves identity and policy, replaces watcher state, and rebuilds from the new root", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootA = path.join(cwd, "root-a");
  const rootB = path.join(cwd, "root-b");
  await fs.mkdir(rootA);
  await fs.writeFile(path.join(rootA, "old.md"), "# Old root\n", "utf8");
  await fs.writeFile(path.join(rootA, "old.txt"), "old body\n", "utf8");
  const original: VaultInfo = {
    ...testVault(rootA, "stable-vault-id"),
    displayName: "Durable vault",
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: false,
      deleteFiles: false,
    },
    vaultIndexScope: { markdown: { minDepth: 0, maxDepth: 2 } },
  };
  await writeConfig(cwd, appDataDir, { vaults: [original] });
  assert.equal(
    (await routeRequest(request("GET", `/api/vaults/${original.id}/index`), cwd)).status,
    200,
  );
  const oldIndexPath = await machineIndexPath(original, cwd);
  assert.equal(await fileExists(oldIndexPath), true);

  await fs.rename(rootA, rootB);
  await fs.unlink(path.join(rootB, "old.md"));
  await fs.writeFile(path.join(rootB, "new.md"), "# New root\n", "utf8");
  await fs.writeFile(path.join(rootB, "new.txt"), "new body\n", "utf8");
  await fs.writeFile(
    path.join(rootB, "new.arepo-chat.json"),
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"new"},"messages":[]}\n',
    "utf8",
  );

  const unavailable = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.equal(
    (unavailable.body as { vaults: VaultInfo[] }).vaults[0]?.availability?.status,
    "unavailable",
  );

  const rebound = await routeRequest(
    request("POST", `/api/vaults/${original.id}/rebind`, { rootPath: rootB }),
    cwd,
  );
  assert.equal(rebound.status, 200);
  const reboundVault = (rebound.body as { data: { vault: VaultInfo; indexRebuilt: boolean } }).data;
  assert.equal(reboundVault.indexRebuilt, true);
  assert.equal(reboundVault.vault.id, original.id);
  assert.equal(reboundVault.vault.displayName, original.displayName);
  assert.deepEqual(reboundVault.vault.permissions, original.permissions);
  assert.deepEqual(reboundVault.vault.vaultIndexScope, original.vaultIndexScope);
  assert.equal(reboundVault.vault.rootPath, rootB);
  assert.deepEqual(reboundVault.vault.availability, { status: "available" });
  const reboundIndexPath = await machineIndexPath(reboundVault.vault, cwd);
  assert.notEqual(reboundIndexPath, oldIndexPath);
  assert.equal(await fileExists(reboundIndexPath), true);

  const persisted = await loadConfig(cwd);
  assert.equal(persisted.vaults[0]?.rootPath, rootB);
  assert.equal(persisted.vaults[0]?.id, original.id);
  assert.deepEqual(persisted.vaults[0]?.permissions, original.permissions);
  assert.deepEqual(persisted.vaults[0]?.vaultIndexScope, original.vaultIndexScope);

  const files = await routeRequest(request("GET", `/api/vaults/${original.id}/files`), cwd);
  assert.deepEqual(
    (files.body as { files: { path: string }[] }).files.map((file) => file.path).sort(),
    ["new.arepo-chat.json", "new.md", "new.txt", "old.txt"],
  );
  const content = await routeRequest(
    request("GET", `/api/vaults/${original.id}/file?path=new.txt`),
    cwd,
  );
  assert.equal((content.body as { content: string }).content, "new body\n");
  const index = await routeRequest(request("GET", `/api/vaults/${original.id}/index`), cwd);
  assert.deepEqual(Object.keys((index.body as VaultIndexResponse).index.notes), ["new.md"]);

  await fs.mkdir(rootA);
  await fs.writeFile(path.join(rootA, "stale.md"), "# Stale old watcher\n", "utf8");
  await fs.writeFile(path.join(rootB, "after-rebind.txt"), "tracked\n", "utf8");
  await fs.writeFile(
    path.join(rootB, "after-rebind.arepo-chat.json"),
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"after"},"messages":[]}\n',
    "utf8",
  );
  const statusResponse = await routeRequest(
    request("GET", `/api/vaults/${original.id}/status`),
    cwd,
  );
  const runtime = statusBody(statusResponse);
  assert.ok(runtime.addedPaths.includes("after-rebind.txt"));
  assert.ok(runtime.addedPaths.includes("after-rebind.arepo-chat.json"));
  assert.equal(runtime.changedPaths.includes("stale.md"), false);
  assert.equal(runtime.indexStatus, "fresh");

  await fs.writeFile(path.join(rootB, "after-rebind.md"), "# Watched new root\n", "utf8");
  const markdownStatus = await routeRequest(
    request("GET", `/api/vaults/${original.id}/status`),
    cwd,
  );
  assert.equal(statusBody(markdownStatus).indexStatus, "stale");
  assert.ok(statusBody(markdownStatus).addedPaths.includes("after-rebind.md"));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const rebuilt = await routeRequest(request("GET", `/api/vaults/${original.id}/index`), cwd);
  assert.ok((rebuilt.body as VaultIndexResponse).index.notes["after-rebind.md"]);
  assert.equal(
    Object.hasOwn((rebuilt.body as VaultIndexResponse).index.notes, "after-rebind.arepo-chat.json"),
    false,
  );
});

test("rebind rejects invalid targets atomically and does not alter the registration", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const originalRoot = await makeTestTempDir(t, "arepo-vault-");
  const replacementFile = path.join(cwd, "replacement-file");
  await fs.writeFile(replacementFile, "not a directory", "utf8");
  const vault = testVault(originalRoot, "stable");
  await writeConfig(cwd, appDataDir, { vaults: [vault] });

  for (const rootPath of [
    path.join(cwd, "missing"),
    replacementFile,
    "relative/path",
    "\0unsafe",
  ] as const) {
    const response = await routeRequest(
      request("POST", `/api/vaults/${vault.id}/rebind`, { rootPath }),
      cwd,
    );
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(response.body).includes(originalRoot), false);
    assert.equal((await loadConfig(cwd)).vaults[0]?.rootPath, originalRoot);
  }

  const unknown = await routeRequest(
    request("POST", "/api/vaults/unknown/rebind", { rootPath: originalRoot }),
    cwd,
  );
  assert.equal(unknown.status, 400);
  assert.match((unknown.body as { error: string }).error, /Unknown vault/);
  assert.equal((await loadConfig(cwd)).vaults[0]?.rootPath, originalRoot);

  const relativeRegistration = await routeRequest(
    request("POST", "/api/vaults", { rootPath: "relative/path" }),
    cwd,
  );
  assert.equal(relativeRegistration.status, 400);
  assert.equal((relativeRegistration.body as { code: string }).code, "INVALID_VAULT_ROOT");
});

test("discard generated data refuses to delete unverified cache files", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-vault-");
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

test("vault indexing works without a user-authored index.md", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("index structural filters expose read-only machine-index views", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("index query routes reuse a valid cache while explicit reindex remains forceful", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(
    path.join(rootPath, "note.md"),
    "---\ntags: [cached]\n---\n# Cached Note\n",
    "utf8",
  );
  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  const cacheFile = await machineIndexPath(vault, cwd);
  const originalRename = fs.rename;
  let publicationAttempts = 0;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (to === cacheFile) {
      publicationAttempts += 1;
      throw new Error("injected publication failure");
    }
    return originalRename(from, to);
  }) as typeof fs.rename;

  const index = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  const search = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/search?q=Cached`),
    cwd,
  );
  const filters = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/filters?filter=tags`),
    cwd,
  );
  const inspect = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/inspect?path=note.md`),
    cwd,
  );

  assert.equal(index.status, 200);
  assert.equal(search.status, 200);
  assert.equal(filters.status, 200);
  assert.equal(inspect.status, 200);
  assert.equal(publicationAttempts, 0);

  const forced = await routeRequest(request("POST", `/api/vaults/${vault.id}/reindex`), cwd);
  assert.equal(forced.status, 500);
  assert.deepEqual(forced.body, {
    ok: false,
    error: "Internal server error",
    code: "internal-error",
  });
  assert.equal(publicationAttempts, 1);
});

test("explicit reindex repairs valid-looking generated derivatives from canonical Markdown", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Canonical Title\n", "utf8");
  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  const cacheFile = await machineIndexPath(vault, cwd);
  const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as {
    sourceDerivations: { data: { title: string } }[];
  };
  stored.sourceDerivations[0]!.data.title = "Poisoned Generated Title";
  await fs.writeFile(cacheFile, JSON.stringify(stored), "utf8");

  const response = await routeRequest(request("POST", `/api/vaults/${vault.id}/reindex`), cwd);
  assert.equal(response.status, 200);
  const data = (response.body as { data: VaultIndexResponse }).data;
  assert.equal(data.index.notes["note.md"]?.title, "Canonical Title");
  const repaired = JSON.parse(await fs.readFile(cacheFile, "utf8")) as typeof stored;
  assert.equal(repaired.sourceDerivations[0]?.data.title, "Canonical Title");
});

test("generated-cache read failures remain bounded global index failures", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  const cacheFile = await machineIndexPath(vault, cwd);
  const sensitivePath = "/private/example/generated-index.json";
  const originalReadFile = fs.readFile;
  t.after(() => {
    fs.readFile = originalReadFile;
  });
  fs.readFile = (async (file, ...args) => {
    if (file === cacheFile) {
      throw Object.assign(new Error(`EACCES: open '${sensitivePath}'`), {
        code: "EACCES",
        syscall: "open",
        path: sensitivePath,
      });
    }
    return originalReadFile(file, ...args);
  }) as typeof fs.readFile;

  const response = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    ok: false,
    error: "Internal server error",
    code: "internal-error",
  });
  for (const hidden of [sensitivePath, "EACCES", "syscall", "stack"]) {
    assert.equal(JSON.stringify(response).includes(hidden), false, hidden);
  }
});

test("index search endpoint finds structural machine-index fields", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("index inspect endpoint exposes file-level machine-index details", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("partial indexes keep index, search, filters, and inspect available for readable sources", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const readablePath = path.join(rootPath, "readable.md");
  const failedPath = path.join(rootPath, "failed.md");
  await fs.writeFile(
    readablePath,
    "---\nid: readable\ntitle: Readable Source\ntags: [available]\n---\n# Readable Source\n\n## Searchable Heading\n",
    "utf8",
  );
  await fs.writeFile(
    failedPath,
    "---\nid: failed\ntitle: Failed Source\ntags: [hidden]\n---\n# Sensitive Hidden Heading\n",
    "utf8",
  );
  const vault = testVault(rootPath, "partial-index-endpoints");
  await writeConfig(cwd, appDataDir, { vaults: [vault] });

  const initial = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(initial.status, 200);
  const originalOpen = fs.open;
  const sensitivePath = "/private/example/secret-vault/failed.md";
  const rawMessage = `EACCES: permission denied, open '${sensitivePath}'`;
  let failing = true;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === failedPath && failing) {
      throw Object.assign(new Error(rawMessage), {
        code: "EACCES",
        errno: -13,
        syscall: "open",
        path: sensitivePath,
      });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const indexResponse = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(indexResponse.status, 200);
  const partial = indexResponse.body as VaultIndexResponse;
  assert.deepEqual(Object.keys(partial.index.notes), ["readable.md"]);
  assert.deepEqual(
    partial.issues.filter((issue) => issue.kind === "source-unreadable"),
    [
      {
        kind: "source-unreadable",
        path: "failed.md",
        message: "Source file could not be read.",
        severity: "error",
      },
    ],
  );

  const searchResponse = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/search?q=Searchable%20Heading`),
    cwd,
  );
  assert.equal(searchResponse.status, 200);
  assert.ok(
    (searchResponse.body as IndexSearchResponse).results.some(
      (result) => result.path === "readable.md" && result.matchType === "heading",
    ),
  );
  const skippedSearch = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/search?q=Sensitive%20Hidden%20Heading`),
    cwd,
  );
  assert.equal(skippedSearch.status, 200);
  assert.equal((skippedSearch.body as IndexSearchResponse).total, 0);

  const filterResponse = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/filters?filter=tags`),
    cwd,
  );
  assert.equal(filterResponse.status, 200);
  assert.deepEqual(
    (filterResponse.body as IndexFilterResponse).results.map((result) => result.tag),
    ["available"],
  );

  const inspectResponse = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/inspect?path=readable.md`),
    cwd,
  );
  assert.equal(inspectResponse.status, 200);
  assert.equal((inspectResponse.body as VaultInspectResponse).title, "Readable Source");
  const skippedInspect = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index/inspect?path=failed.md`),
    cwd,
  );
  assert.equal(skippedInspect.status, 404);
  assert.deepEqual(skippedInspect.body, {
    ok: false,
    error: "Unknown indexed note: failed.md",
    code: "ENOENT",
  });

  const watcherStatus = await routeRequest(request("GET", `/api/vaults/${vault.id}/status`), cwd);
  assert.equal(watcherStatus.status, 200);
  assert.equal((watcherStatus.body as { error?: string }).error, "Vault rescan failed.");

  const serialized = JSON.stringify({
    indexResponse,
    searchResponse,
    skippedSearch,
    filterResponse,
    inspectResponse,
    skippedInspect,
    watcherStatus,
  });
  for (const hidden of [
    sensitivePath,
    rootPath,
    rawMessage,
    "EACCES",
    "EPERM",
    "permission denied",
    "errno",
    "syscall",
    "stack",
  ]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }

  failing = false;
  const recoveredResponse = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/index`),
    cwd,
  );
  assert.equal(recoveredResponse.status, 200);
  const recovered = recoveredResponse.body as VaultIndexResponse;
  assert.equal(recovered.index.notes["failed.md"]?.title, "Failed Source");
  assert.equal(
    recovered.issues.some((issue) => issue.kind === "source-unreadable"),
    false,
  );
});

test("index requests do not require an initial watcher snapshot of an unreadable source", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(
    path.join(rootPath, "readable.md"),
    "---\nid: readable\ntitle: Readable\n---\n# Readable\n",
    "utf8",
  );
  const failedPath = path.join(rootPath, "failed.md");
  await fs.writeFile(failedPath, "---\nid: failed\ntitle: Failed\n---\n# Failed\n", "utf8");
  const vault = testVault(rootPath, "initial-partial-index");
  await writeConfig(cwd, appDataDir, { vaults: [vault] });
  const originalOpen = fs.open;
  const sensitivePath = "/private/example/initial-watcher-secret.md";
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === failedPath) {
      throw Object.assign(new Error(`EPERM: operation not permitted, open '${sensitivePath}'`), {
        code: "EPERM",
        syscall: "open",
        path: sensitivePath,
      });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const response = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);

  assert.equal(response.status, 200);
  const data = response.body as VaultIndexResponse;
  assert.deepEqual(Object.keys(data.index.notes), ["readable.md"]);
  assert.ok(
    data.issues.some((issue) => issue.kind === "source-unreadable" && issue.path === "failed.md"),
  );
  const serialized = JSON.stringify(response);
  for (const hidden of [sensitivePath, rootPath, "EPERM", "operation not permitted", "syscall"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test("unexpected initial watcher observation failures propagate before structural indexing", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const notePath = path.join(rootPath, "note.md");
  await fs.writeFile(notePath, "---\nid: note\ntitle: Note\n---\n# Note\n", "utf8");
  const vault = testVault(rootPath, "unexpected-initial-observation");
  await writeConfig(cwd, appDataDir, { vaults: [vault] });
  const originalOpen = fs.open;
  let noteReads = 0;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === notePath) {
      noteReads += 1;
      throw new Error("unexpected watcher invariant failure");
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const response = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);

  assert.equal(noteReads, 1);
  assert.deepEqual(response.body, {
    ok: false,
    error: "Internal server error",
    code: "internal-error",
  });
  assert.equal(JSON.stringify(response).includes("unexpected watcher invariant failure"), false);
});

test("user-authored index.md is indexed as a normal note when present", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("external file change is surfaced through vault status", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("external additions and deletions are reflected in status and rebuilt index", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("plain-text watcher changes stay visible without staling or rebuilding the Markdown index", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  await fs.writeFile(path.join(rootPath, "plain.txt"), "first\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  const initialIndex = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(initialIndex.status, 200);
  const cachePath = await machineIndexPath(vault, cwd);
  const cacheBefore = await fs.readFile(cachePath, "utf8");
  const cacheStatBefore = await fs.stat(cachePath);

  await fs.writeFile(path.join(rootPath, "plain.txt"), "second — こんにちは\n", "utf8");
  const changed = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/status?path=plain.txt`),
    cwd,
  );
  assert.equal(changed.status, 200);
  const changedStatus = statusBody(changed);
  assert.equal(changedStatus.indexStatus, "fresh");
  assert.ok(changedStatus.changedPaths.includes("plain.txt"));
  assert.equal(changedStatus.file?.exists, true);

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const settled = await routeRequest(request("GET", `/api/vaults/${vault.id}/status`), cwd);
  assert.equal(statusBody(settled).indexStatus, "fresh");
  assert.ok(statusBody(settled).changedPaths.includes("plain.txt"));
  assert.equal(await fs.readFile(cachePath, "utf8"), cacheBefore);
  assert.equal((await fs.stat(cachePath)).mtimeMs, cacheStatBefore.mtimeMs);
});

test("chat and generic JSON watcher changes refresh status without rebuilding Markdown", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  const chatPath = path.join(rootPath, "conversation.arepo-chat.json");
  const ordinaryJsonPath = path.join(rootPath, "data.json");
  await fs.writeFile(
    chatPath,
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"before"},"messages":[]}\n',
    "utf8",
  );
  await fs.writeFile(ordinaryJsonPath, '{"state":"before"}\n', "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  const initialIndex = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  assert.equal(initialIndex.status, 200);
  const cachePath = await machineIndexPath(vault, cwd);
  const cacheBefore = await fs.readFile(cachePath, "utf8");
  const cacheStatBefore = await fs.stat(cachePath);

  await fs.writeFile(
    chatPath,
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"after"},"messages":[]}\n',
    "utf8",
  );
  await fs.writeFile(ordinaryJsonPath, '{"state":"after and larger"}\n', "utf8");
  const changed = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/status?path=conversation.arepo-chat.json`),
    cwd,
  );
  assert.equal(changed.status, 200);
  const changedStatus = statusBody(changed);
  assert.equal(changedStatus.indexStatus, "fresh");
  assert.ok(changedStatus.changedPaths.includes("conversation.arepo-chat.json"));
  assert.equal(changedStatus.changedPaths.includes("data.json"), true);
  assert.equal(changedStatus.file?.exists, true);

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const settled = await routeRequest(request("GET", `/api/vaults/${vault.id}/status`), cwd);
  assert.equal(statusBody(settled).indexStatus, "fresh");
  assert.ok(statusBody(settled).changedPaths.includes("conversation.arepo-chat.json"));
  assert.equal(await fs.readFile(cachePath, "utf8"), cacheBefore);
  assert.equal((await fs.stat(cachePath)).mtimeMs, cacheStatBefore.mtimeMs);
});

test("mixed Markdown and chat changes rebuild only because Markdown changed", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Before\n", "utf8");
  await fs.writeFile(
    path.join(rootPath, "conversation.arepo-chat.json"),
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"before"},"messages":[]}\n',
    "utf8",
  );

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  await fs.writeFile(path.join(rootPath, "note.md"), "# After\n", "utf8");
  await fs.writeFile(
    path.join(rootPath, "conversation.arepo-chat.json"),
    '{"format":"arepo-chat-export","version":1,"conversation":{"id":"after"},"messages":[]}\n',
    "utf8",
  );

  const changed = await routeRequest(request("GET", `/api/vaults/${vault.id}/status`), cwd);
  assert.equal(statusBody(changed).indexStatus, "stale");
  assert.ok(statusBody(changed).changedPaths.includes("note.md"));
  assert.ok(statusBody(changed).changedPaths.includes("conversation.arepo-chat.json"));

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const rebuilt = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  const rebuiltIndex = rebuilt.body as VaultIndexResponse;
  assert.equal(rebuiltIndex.index.notes["note.md"]?.title, "After");
  assert.equal(Object.hasOwn(rebuiltIndex.index.notes, "conversation.arepo-chat.json"), false);
});

test("mixed Markdown and plain-text watcher changes rebuild only the Markdown index", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Before\n", "utf8");
  await fs.writeFile(path.join(rootPath, "plain.txt"), "before\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  const vault = (created.body as { data: { vault: VaultInfo } }).data.vault;
  await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  await fs.writeFile(path.join(rootPath, "note.md"), "# After\n", "utf8");
  await fs.writeFile(path.join(rootPath, "plain.txt"), "after\n", "utf8");

  const changed = await routeRequest(request("GET", `/api/vaults/${vault.id}/status`), cwd);
  assert.equal(statusBody(changed).indexStatus, "stale");
  assert.ok(statusBody(changed).changedPaths.includes("note.md"));
  assert.ok(statusBody(changed).changedPaths.includes("plain.txt"));

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const rebuilt = await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd);
  const rebuiltIndex = rebuilt.body as VaultIndexResponse;
  assert.equal(rebuiltIndex.index.notes["note.md"]?.title, "After");
  assert.equal(Object.hasOwn(rebuiltIndex.index.notes, "plain.txt"), false);
});

test("watch/index status ignores symlink escapes", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
  const appDataDir = await makeTestTempDir(t, "arepo-data-");
  await writeConfig(cwd, appDataDir);
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const outside = await makeTestTempDir(t, "arepo-outside-");
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

test("cors allows default local dev origins, env extras, and rejects arbitrary origins", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-server-");
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

test("related-note endpoint is lazy, Markdown-only, bounded, and never returns source bodies", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-related-server-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-related-server-vault-");
  const appDataDir = path.join(cwd, "app-data");
  const vault = testVault(rootPath, "related-vault");
  const sourceSecret = "private-source-body-never-returned";
  await fs.writeFile(
    path.join(rootPath, "a.md"),
    `# Alpha\n${sourceSecret} canonical stale conflict version`,
  );
  await fs.writeFile(path.join(rootPath, "b.md"), "# Beta\ncanonical stale conflict version");
  await fs.writeFile(path.join(rootPath, "plain.txt"), "canonical stale conflict version");
  await writeConfig(cwd, appDataDir, { vaults: [vault] });
  await writeRelatedNotesPreference(vault, namedRelatedNotesPreference("balanced", true), cwd);

  const response = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/enrichment/related?path=a.md`),
    cwd,
  );
  assert.equal(response.status, 200);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(sourceSecret), false);
  assert.equal(serialized.includes(rootPath), false);
  assert.equal((response.body as { sourcePath: string }).sourcePath, "a.md");
  assert.equal(
    (response.body as { candidates: { targetPath: string }[] }).candidates[0]?.targetPath,
    "b.md",
  );

  const nonMarkdown = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/enrichment/related?path=plain.txt`),
    cwd,
  );
  assert.equal(nonMarkdown.status, 400);
  assert.deepEqual(nonMarkdown.body, {
    ok: false,
    error: "Related notes require a valid Markdown path.",
    code: "invalid-related-notes-path",
  });
});

test("enrichment settings default off, enable explicitly, fail invalid updates safely, and purge on disable", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-enrichment-server-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-enrichment-server-vault-");
  const appDataDir = path.join(cwd, "app-data");
  const vault = testVault(rootPath, "enrichment-settings-vault");
  await fs.writeFile(path.join(rootPath, "a.md"), "# Alpha\ncanonical stale conflict version");
  await fs.writeFile(path.join(rootPath, "b.md"), "# Beta\ncanonical stale conflict version");
  await writeConfig(cwd, appDataDir, { vaults: [vault] });
  const settingsUrl = `/api/vaults/${vault.id}/enrichment/settings`;
  const relatedUrl = `/api/vaults/${vault.id}/enrichment/related?path=a.md`;

  const initial = await routeRequest(request("GET", settingsUrl), cwd);
  assert.equal(initial.status, 200);
  assert.equal(
    (initial.body as { preferences: { producers: { relatedNotes: { enabled: boolean } } } })
      .preferences.producers.relatedNotes.enabled,
    false,
  );
  assert.deepEqual((await routeRequest(request("GET", relatedUrl), cwd)).body, {
    status: "disabled",
    producer: "arepo.related-notes",
    candidates: [],
  });

  const enabled = await routeRequest(
    request("PUT", settingsUrl, {
      relatedNotes: namedRelatedNotesPreference("balanced", true),
    }),
    cwd,
  );
  assert.equal(enabled.status, 200);
  const ready = await routeRequest(request("GET", relatedUrl), cwd);
  assert.equal(ready.status, 200);
  assert.equal((ready.body as { status: string }).status, "ready");
  const cache = await relatedNotesCachePath(vault, cwd);
  await fs.access(cache);

  const invalid = await routeRequest(
    request("PUT", settingsUrl, { relatedNotes: { enabled: true, preset: "future" } }),
    cwd,
  );
  assert.equal(invalid.status, 400);
  const afterInvalid = await routeRequest(request("GET", settingsUrl), cwd);
  assert.equal(
    (afterInvalid.body as { preferences: { producers: { relatedNotes: { preset: string } } } })
      .preferences.producers.relatedNotes.preset,
    "balanced",
  );

  const disabled = await routeRequest(
    request("PUT", settingsUrl, {
      relatedNotes: namedRelatedNotesPreference("balanced", false),
    }),
    cwd,
  );
  assert.equal(disabled.status, 200);
  await assert.rejects(() => fs.access(cache), { code: "ENOENT" });
  const afterDisable = await routeRequest(request("GET", relatedUrl), cwd);
  assert.equal((afterDisable.body as { status: string }).status, "disabled");
});

test("enrichment consent and custom settings remain isolated per vault", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-enrichment-isolation-cwd-");
  const appDataDir = path.join(cwd, "app-data");
  const rootA = await makeTestTempDir(t, "arepo-enrichment-a-");
  const rootB = await makeTestTempDir(t, "arepo-enrichment-b-");
  const vaultA = testVault(rootA, "vault-a");
  const vaultB = testVault(rootB, "vault-b");
  for (const root of [rootA, rootB]) {
    await fs.writeFile(path.join(root, "a.md"), "# A\ncanonical stale conflict version");
    await fs.writeFile(path.join(root, "b.md"), "# B\ncanonical stale conflict version");
  }
  await writeConfig(cwd, appDataDir, { vaults: [vaultA, vaultB] });
  const custom = namedRelatedNotesPreference("exploratory", true);
  await routeRequest(
    request("PUT", `/api/vaults/${vaultA.id}/enrichment/settings`, { relatedNotes: custom }),
    cwd,
  );
  const aResult = await routeRequest(
    request("GET", `/api/vaults/${vaultA.id}/enrichment/related?path=a.md`),
    cwd,
  );
  const bResult = await routeRequest(
    request("GET", `/api/vaults/${vaultB.id}/enrichment/related?path=a.md`),
    cwd,
  );
  assert.equal((aResult.body as { status: string }).status, "ready");
  assert.equal((bResult.body as { status: string }).status, "disabled");
  assert.equal(
    (
      (await routeRequest(request("GET", `/api/vaults/${vaultB.id}/enrichment/settings`), cwd))
        .body as { preferences: { producers: { relatedNotes: { preset: string } } } }
    ).preferences.producers.relatedNotes.preset,
    "balanced",
  );
  const vaultBCache = await relatedNotesCachePath(vaultB, cwd);
  await assert.rejects(() => fs.access(vaultBCache), {
    code: "ENOENT",
  });
});

test("protected enrichment settings are readable with readIndex and writable only with manageVaults", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-enrichment-protected-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-enrichment-protected-vault-");
  const appDataDir = path.join(cwd, "app-data");
  const vault = testVault(rootPath, "enrichment-protected-vault");
  await fs.writeFile(path.join(rootPath, "a.md"), "# A\n");
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" }, vaults: [vault] });
  const url = `/api/vaults/${vault.id}/enrichment/settings`;
  const authorization = { authorization: `Bearer ${protectedBearerToken}` };

  await writeProtectedAuthStores(appDataDir, {
    vaultId: vault.id,
    vaultPermissions: ["readIndex"],
  });
  assert.equal(
    (await routeRequest(request("GET", url, undefined, authorization), cwd)).status,
    200,
  );
  assert.equal(
    (
      await routeRequest(
        request(
          "PUT",
          url,
          { relatedNotes: namedRelatedNotesPreference("balanced", true) },
          authorization,
        ),
        cwd,
      )
    ).status,
    403,
  );

  await writeProtectedAuthStores(appDataDir, { nodePermissions: ["manageVaults"] });
  assert.equal(
    (
      await routeRequest(
        request(
          "PUT",
          url,
          { relatedNotes: namedRelatedNotesPreference("balanced", true) },
          authorization,
        ),
        cwd,
      )
    ).status,
    200,
  );
});

test("enrichment-cache publication failure stays bounded and cannot break structural index", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-related-failure-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-related-failure-vault-");
  const appDataDir = path.join(cwd, "app-data");
  const vault = testVault(rootPath, "related-failure-vault");
  await fs.writeFile(path.join(rootPath, "a.md"), "# Alpha\ncanonical stale conflict version");
  await fs.writeFile(path.join(rootPath, "b.md"), "# Beta\ncanonical stale conflict version");
  await writeConfig(cwd, appDataDir, { vaults: [vault] });
  await writeRelatedNotesPreference(vault, namedRelatedNotesPreference("balanced", true), cwd);

  assert.equal(
    (await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd)).status,
    200,
  );
  await fs.mkdir(appDataDir, { recursive: true });
  await fs.writeFile(path.join(appDataDir, "enrichments"), "blocks enrichment directory", "utf8");
  const failed = await routeRequest(
    request("GET", `/api/vaults/${vault.id}/enrichment/related?path=a.md`),
    cwd,
  );
  assert.deepEqual(failed.body, {
    ok: false,
    error: "Internal server error",
    code: "internal-error",
  });
  assert.equal(JSON.stringify(failed.body).includes(appDataDir), false);
  assert.equal(
    (await routeRequest(request("GET", `/api/vaults/${vault.id}/index`), cwd)).status,
    200,
  );
});

test("protected related-note endpoint requires both readIndex and readContent", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-related-protected-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-related-protected-vault-");
  const appDataDir = path.join(cwd, "app-data");
  const vault = testVault(rootPath, "related-protected-vault");
  await fs.writeFile(path.join(rootPath, "a.md"), "# A\ncanonical stale conflict version");
  await fs.writeFile(path.join(rootPath, "b.md"), "# B\ncanonical stale conflict version");
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" }, vaults: [vault] });
  await writeProtectedAuthStores(appDataDir, {
    vaultId: vault.id,
    vaultPermissions: ["readIndex"],
  });
  const url = `/api/vaults/${vault.id}/enrichment/related?path=a.md`;
  const denied = await routeRequest(
    request("GET", url, undefined, { authorization: `Bearer ${protectedBearerToken}` }),
    cwd,
  );
  assert.equal(denied.status, 403);

  await writeProtectedAuthStores(appDataDir, {
    vaultId: vault.id,
    vaultPermissions: ["readIndex", "readContent"],
  });
  const allowed = await routeRequest(
    request("GET", url, undefined, { authorization: `Bearer ${protectedBearerToken}` }),
    cwd,
  );
  assert.equal(allowed.status, 200);
  assert.equal(JSON.stringify(allowed.body).includes(rootPath), false);
});
