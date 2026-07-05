import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyHttpCredentialExtraction } from "./httpCredentialAdapter.js";
import { routeRequest, type RequestLike } from "./server.js";
import {
  writeBrowserSessionStore,
  writeCredentialStore,
  writeRevocationStore,
  writeTokenVerifierStore,
  type CredentialMetadata,
} from "./credentialStore.js";
import { createTokenVerifierMetadata, TOKEN_VERIFIER_SCHEME } from "./credentialVerifier.js";
import type { LocalNodeRuntimeStatus, VaultInfo } from "./types.js";
import type { RoutePermission } from "./routePermissions.js";

const protectedBearerToken = "inactive-boundary-protected-bearer-token";
const protectedNow = "2026-07-05T00:00:00.000Z";
const protectedFuture = "2027-07-05T00:00:00.000Z";

const inactiveBrowserAuthRoutes = [
  ["POST", "/api/node/auth/session"],
  ["POST", "/api/node/auth/session/logout"],
  ["POST", "/api/node/auth/session/revoke-all"],
  ["GET", "/api/node/auth/csrf"],
  ["POST", "/api/node/auth/pairing/start"],
  ["POST", "/api/node/auth/pairing/complete"],
] as const;

const browserAuthPrimitiveImportSpecifiers = [
  "./browserSessionStore.js",
  "./browserSessionVerifier.js",
  "./browserCsrfTokenStore.js",
  "./browserCsrfTokenVerifier.js",
  "./browserPairingCodeStore.js",
  "./browserPairingCodeVerifier.js",
  "./browserAuthAuditEvents.js",
  "./browserCookiePolicy.js",
  "./browserHeaderSanitizer.js",
  "./browserAuthLifecycleCoordinator.js",
  "./browserAuthActivationPreflight.js",
  "./browserAuthRouteContracts.js",
  "./browserAuthActivationConfigPolicy.js",
  "./browserAuthActivationGate.js",
  "./browserAuthRouteHarness.js",
  "./browserAuthRequestShapeAdapter.js",
  "./browserAuthTestOnlyActivation.js",
  "./browserAuthCookieSerialization.js",
  "./browserAuthFoundationRequirements.js",
  "./betterAuthCompatibilityModel.js",
  "./betterAuthDependencyProof.js",
  "better-auth/minimal",
  "better-auth/node",
] as const;

const browserAuthPrimitiveFactories = [
  "createInMemoryBrowserSessionStore",
  "generateBrowserSessionVerifierSecret",
  "createInMemoryBrowserCsrfTokenStore",
  "generateBrowserCsrfTokenSecret",
  "createInMemoryBrowserPairingCodeStore",
  "generateBrowserPairingCodeSecret",
  "buildBrowserAuthAuditEvent",
  "createInMemoryBrowserAuthAuditSink",
  "plannedBrowserSessionCookiePolicy",
  "sanitizeBrowserAuthHeaders",
  "createInMemoryBrowserAuthLifecycleCoordinator",
  "planBrowserAuthActivationPreflight",
  "planBrowserAuthRouteContracts",
  "planBrowserAuthActivationConfigPolicy",
  "evaluateBrowserAuthActivationGate",
  "createBrowserAuthRouteHarness",
  "adaptBrowserAuthRequestShape",
  "createBrowserAuthTestOnlyActivationAllowance",
  "planBrowserAuthTestOnlyIssueCookies",
  "planBrowserAuthTestOnlyClearCookies",
  "listBrowserAuthFoundationRequirements",
  "planBetterAuthCompatibility",
  "runIsolatedBetterAuthDependencyProof",
] as const;

const secretSamples = [
  protectedBearerToken,
  "arepo_session=inactive-boundary-session-cookie",
  "bpairsec_inactive_boundary_pairing_code",
  "bsver_inactive_boundary_session_secret",
  "bcsrfsec_inactive_boundary_csrf_secret",
  "sha256:inactive-boundary-hash",
  "verifierHash",
  "tokenHash",
  "salt",
  "stack",
] as const;

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
  options: { auth?: Record<string, unknown>; vaults?: VaultInfo[] } = {},
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

async function writeProtectedAuthStores(
  appDataDir: string,
  input: { nodePermissions?: readonly RoutePermission[] } = {},
): Promise<void> {
  const credentialId = "inactive-boundary-credential";
  const verifierId = "inactive-boundary-verifier";
  const credential: CredentialMetadata = {
    credentialId,
    actorKind: "apiToken",
    label: "Inactive boundary test token",
    nodePermissions: input.nodePermissions ?? ["manageNode", "manageAuth"],
    vaultGrants: [],
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

async function protectedFixture(): Promise<{ cwd: string; appDataDir: string }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-browser-boundary-"));
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-browser-boundary-data-"));
  await writeConfig(cwd, appDataDir, { auth: { mode: "protected" } });
  await writeProtectedAuthStores(appDataDir);
  return { cwd, appDataDir };
}

function assertNoSetCookie(response: Awaited<ReturnType<typeof routeRequest>>): void {
  assert.equal(response.headers?.["set-cookie"], undefined);
  assert.equal(response.headers?.["Set-Cookie"], undefined);
}

function assertSanitizedBody(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `response exposed ${secret}`);
  }
}

test("live server and request authorization code do not import inert browser-auth primitives", async () => {
  const liveSourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/protectedResponsePlanner.ts",
  ];

  for (const file of liveSourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    for (const specifier of browserAuthPrimitiveImportSpecifiers) {
      assert.equal(source.includes(specifier), false, `${file} imports ${specifier}`);
    }
    for (const factoryName of browserAuthPrimitiveFactories) {
      assert.equal(
        source.includes(factoryName),
        false,
        `${file} calls or references ${factoryName}`,
      );
    }
  }
});

test("live protected enforcement pins request authorization to bearer credentials only", async () => {
  const source = await fs.readFile(
    path.join(process.cwd(), "backend", "protectedModeEnforcement.ts"),
    "utf8",
  );

  assert.equal(source.includes('allowedCredentialSource: "bearerHeader"'), true);
  assert.equal(source.includes('allowedCredentialSource: "either"'), false);
  assert.equal(source.includes('allowedCredentialSource: "browserSessionCookie"'), false);
});

test("HTTP credential adapter rejects cookie credentials when live bearer-only source is requested", () => {
  const result = classifyHttpCredentialExtraction(
    {
      method: "GET",
      path: "/api/node/credentials",
      cookies: { arepo_session: "inactive-boundary-session-cookie" },
    },
    { allowedSource: "bearerHeader" },
  );

  assert.equal(result.status, "malformed");
  assert.equal(result.credentialSource, "browserSessionCookie");
  assert.equal(result.reasonCode, "ambiguous-credentials");
  assertSanitizedBody(result);
});

test("browser session pairing and csrf routes remain inactive sanitized stubs", async () => {
  const { cwd } = await protectedFixture();
  const secret = "bsver_inactive_boundary_session_secret";

  for (const [method, route] of inactiveBrowserAuthRoutes) {
    const response = await routeRequest(
      request(
        method,
        route,
        {
          sessionSecret: secret,
          csrfToken: "bcsrfsec_inactive_boundary_csrf_secret",
          pairingCode: "bpairsec_inactive_boundary_pairing_code",
        },
        {
          authorization: `Bearer ${protectedBearerToken}`,
          cookie: `arepo_session=${secret}`,
          "x-csrf-token": "bcsrfsec_inactive_boundary_csrf_secret",
        },
      ),
      cwd,
    );

    assert.equal(response.status, 501);
    assertNoSetCookie(response);
    assert.deepEqual(response.body, {
      ok: false,
      error: {
        code: "browser_session_auth_inactive",
        message: "Browser-session authentication is planned but not active.",
      },
    });
    assertSanitizedBody(response.body);
  }
});

test("cookie and csrf-style headers do not authenticate protected routes", async () => {
  const { cwd } = await protectedFixture();
  const cases: Record<string, string>[] = [
    { cookie: "arepo_session=inactive-boundary-session-cookie" },
    { "x-csrf-token": "bcsrfsec_inactive_boundary_csrf_secret" },
    { "x-xsrf-token": "bcsrfsec_inactive_boundary_csrf_secret" },
    {
      cookie: "arepo_session=inactive-boundary-session-cookie",
      "x-csrf-token": "bcsrfsec_inactive_boundary_csrf_secret",
    },
  ];

  for (const headers of cases) {
    const response = await routeRequest(
      request("GET", "/api/node/credentials", undefined, headers),
      cwd,
    );

    assert.equal(response.status, 401);
    assertNoSetCookie(response);
    assertSanitizedBody(response.body);
  }
});

test("bearer-token protected mode remains the only live credential path", async () => {
  const { cwd } = await protectedFixture();

  const listed = await routeRequest(
    request("GET", "/api/node/credentials", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  const malformedBearer = await routeRequest(
    request("GET", "/api/node/credentials", undefined, {
      authorization: "Bearer malformed-token",
    }),
    cwd,
  );

  assert.equal(listed.status, 200);
  assertNoSetCookie(listed);
  assertSanitizedBody(listed.body);
  assert.equal(malformedBearer.status, 401);
  assertNoSetCookie(malformedBearer);
  assertSanitizedBody(malformedBearer.body);
});

test("representative live routes and inactive stubs do not emit Set-Cookie", async () => {
  const { cwd } = await protectedFixture();
  const liveRequests = [
    request("GET", "/api/health"),
    request("GET", "/api/node/status"),
    request("GET", "/api/node/status", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    request("GET", "/api/node/credentials", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    request("GET", "/api/node/credentials"),
    ...inactiveBrowserAuthRoutes.map(([method, route]) => request(method, route)),
  ];

  for (const liveRequest of liveRequests) {
    const response = await routeRequest(liveRequest, cwd);
    assertNoSetCookie(response);
    assertSanitizedBody(response.body);
  }
});

test("full protected status reports browser-auth primitives as inactive and unwired", async () => {
  const { cwd } = await protectedFixture();
  const response = await routeRequest(
    request("GET", "/api/node/status", undefined, {
      authorization: `Bearer ${protectedBearerToken}`,
    }),
    cwd,
  );
  assert.equal(response.status, 200);
  assertNoSetCookie(response);
  const status = response.body as LocalNodeRuntimeStatus;
  const browserSessionAuth = status.browserSessionAuth;

  assert.equal(browserSessionAuth.status, "planning-only");
  assert.equal(browserSessionAuth.liveSessionAuth, false);
  assert.equal(browserSessionAuth.acceptsSessionCookies, false);
  assert.equal(browserSessionAuth.sessionIssuance, "inactive");
  assert.equal(browserSessionAuth.csrfEnforcement, "inactive");
  assert.equal(browserSessionAuth.sessionRoutes, "stubbed");
  assert.equal(browserSessionAuth.pairingRoutes, "stubbed");
  assert.equal(browserSessionAuth.csrfEndpoint, "stubbed");
  assert.equal(browserSessionAuth.activationConfigPolicy.status, "inactive");
  assert.equal(browserSessionAuth.activationConfigPolicy.activationAllowed, false);
  assert.equal(browserSessionAuth.activationConfigPolicy.browserAuthEnabled, false);
  assert.equal(browserSessionAuth.activationConfigPolicy.mounted, false);
  assert.equal(browserSessionAuth.activationConfigPolicy.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.activationConfigPolicy.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.activationConfigPolicy.issuesCookies, false);
  assert.equal(browserSessionAuth.activationConfigPolicy.acceptsCookies, false);
  assert.equal(browserSessionAuth.activationGate.status, "blocked");
  assert.equal(browserSessionAuth.activationGate.allowed, false);
  assert.equal(browserSessionAuth.activationGate.browserAuthEnabled, false);
  assert.equal(browserSessionAuth.activationGate.mounted, false);
  assert.equal(browserSessionAuth.activationGate.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.activationGate.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.activationGate.issuesCookies, false);
  assert.equal(browserSessionAuth.activationGate.acceptsCookies, false);
  assert.equal(browserSessionAuth.activationGate.authenticatesRequests, false);
  assert.equal(browserSessionAuth.activationPreflight.status, "inactive");
  assert.equal(browserSessionAuth.activationPreflight.liveRouteMountingAllowed, false);
  assert.equal(browserSessionAuth.activationPreflight.browserAuthEnabled, false);
  assert.equal(browserSessionAuth.activationPreflight.mounted, false);
  assert.equal(browserSessionAuth.activationPreflight.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.activationPreflight.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.activationPreflight.issuesCookies, false);
  assert.equal(browserSessionAuth.activationPreflight.acceptsCookies, false);
  assert.equal(browserSessionAuth.routeContracts.status, "planning-only");
  assert.equal(browserSessionAuth.routeContracts.summary.mountedLiveRouteCount, 0);
  assert.equal(browserSessionAuth.routeContracts.summary.issuingCookieRouteCount, 0);
  assert.equal(browserSessionAuth.routeContracts.summary.acceptingCookieRouteCount, 0);
  assert.equal(browserSessionAuth.routeContracts.summary.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.routeContracts.summary.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.routeHarness.status, "inactive");
  assert.equal(browserSessionAuth.routeHarness.mounted, false);
  assert.equal(browserSessionAuth.routeHarness.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.routeHarness.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.routeHarness.issuesCookies, false);
  assert.equal(browserSessionAuth.routeHarness.acceptsCookies, false);
  assert.equal(browserSessionAuth.routeHarness.issuesPairingCodes, false);
  assert.equal(browserSessionAuth.routeHarness.issuesBrowserSessions, false);
  assert.equal(browserSessionAuth.routeHarness.issuesCsrfTokens, false);
  assert.equal(browserSessionAuth.routeHarness.authenticatesRequests, false);
  assert.equal(browserSessionAuth.lifecycleCoordinator.status, "inactive");
  assert.equal(browserSessionAuth.lifecycleCoordinator.mounted, false);
  assert.equal(browserSessionAuth.lifecycleCoordinator.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.lifecycleCoordinator.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.lifecycleCoordinator.issuesLiveCookies, false);
  assert.equal(browserSessionAuth.lifecycleCoordinator.acceptsCookies, false);
  assert.equal(browserSessionAuth.lifecycleCoordinator.enablesBrowserSessions, false);
  assert.equal(browserSessionAuth.lifecycleCoordinator.usesSanitizedAuditEvents, true);
  assert.equal(browserSessionAuth.pairing.codeStore.status, "inactive");
  assert.equal(browserSessionAuth.pairing.codeStore.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.pairing.codeStore.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.pairing.codeVerifier.status, "inactive");
  assert.equal(browserSessionAuth.pairing.codeVerifier.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.pairing.codeVerifier.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.sessionStore.status, "inactive");
  assert.equal(browserSessionAuth.sessionStore.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.sessionVerifier.status, "inactive");
  assert.equal(browserSessionAuth.sessionVerifier.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.csrf.tokenStore.status, "inactive");
  assert.equal(browserSessionAuth.csrf.tokenStore.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.csrf.tokenStore.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.csrf.tokenVerifier.status, "inactive");
  assert.equal(browserSessionAuth.csrf.tokenVerifier.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.csrf.tokenVerifier.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.cookiePolicy.policyPrimitives.status, "inactive");
  assert.equal(browserSessionAuth.cookiePolicy.policyPrimitives.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.cookiePolicy.policyPrimitives.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.cookiePolicy.policyPrimitives.issuesCookies, false);
  assert.equal(browserSessionAuth.cookiePolicy.policyPrimitives.acceptsCookies, false);
  assert.equal(browserSessionAuth.cookiePolicy.headerSanitizer.status, "inactive");
  assert.equal(browserSessionAuth.cookiePolicy.headerSanitizer.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.cookiePolicy.headerSanitizer.wiredIntoRoutes, false);
  assert.equal(browserSessionAuth.audit.eventPrimitives.status, "inactive");
  assert.equal(browserSessionAuth.audit.eventPrimitives.wiredIntoAuthorization, false);
  assert.equal(browserSessionAuth.audit.eventPrimitives.wiredIntoRoutes, false);
  assertSanitizedBody(status);
});
