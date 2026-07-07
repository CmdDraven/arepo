import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createBrowserAuthDisabledLiveAdapter,
  type BrowserAuthDisabledLiveAdapterRouteId,
} from "./browserAuthDisabledLiveAdapter.js";
import { planBrowserAuthRouteContracts } from "./browserAuthRouteContracts.js";

const plannedRoutes: readonly BrowserAuthDisabledLiveAdapterRouteId[] = [
  "browser-pairing-start",
  "browser-pairing-complete",
  "browser-session-issue",
  "browser-session-status",
  "browser-csrf-issue",
  "browser-session-logout",
  "browser-session-revoke-current",
  "browser-session-revoke-all",
];

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_secret",
  "session.token=secret",
  "better-auth-secret",
  "actual-raw-session-token-value",
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `disabled-live adapter exposed ${secret}`);
  }
}

test("browser-auth disabled-live adapter reports inert diagnostics", () => {
  const adapter = createBrowserAuthDisabledLiveAdapter();
  const diagnostics = adapter.diagnostics();

  assert.equal(diagnostics.status, "disabled-live-inert");
  assert.equal(diagnostics.browserAuthEnabled, false);
  assert.equal(diagnostics.activationGateClosed, true);
  assert.equal(diagnostics.mountedInServer, false);
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.betterAuthHandlerMounted, false);
  assert.equal(diagnostics.internalAdapterWrapperLive, false);
  assert.equal(diagnostics.issuesCookies, false);
  assert.equal(diagnostics.acceptsCookies, false);
  assert.equal(diagnostics.parsesCookiesForAuthorization, false);
  assert.equal(diagnostics.validatesCsrf, false);
  assert.equal(diagnostics.createsBrowserSessions, false);
  assert.equal(diagnostics.consumesPairingCodes, false);
  assert.equal(diagnostics.authenticatesRequests, false);
  assert.equal(diagnostics.bearerProtectedModeUnchanged, true);
  assert.equal(diagnostics.routeCount, plannedRoutes.length);
  assertNoSecretMaterial(diagnostics);
});

test("browser-auth disabled-live adapter covers every planned route", () => {
  const adapter = createBrowserAuthDisabledLiveAdapter();
  const routePlan = planBrowserAuthRouteContracts();

  assert.deepEqual(
    routePlan.contracts.map((contract) => contract.routeId),
    plannedRoutes,
  );

  for (const routeId of plannedRoutes) {
    const result = adapter.handle({
      routeId,
      cookieHeaderPresent: true,
      authorizationHeaderPresent: true,
      csrfHeaderPresent: true,
    });
    const contract = routePlan.contracts.find((candidate) => candidate.routeId === routeId);

    assert.equal(result.ok, false);
    assert.equal(result.status, "inactive");
    assert.equal(result.httpStatus, 501);
    assert.equal(result.routeId, routeId);
    assert.equal(result.path, contract?.path);
    assert.equal(result.method, contract?.method);
    assert.equal(result.routeContractStatus, contract?.status);
    assert.equal(result.error.code, "browser_session_auth_inactive");
    assert.equal(result.error.reasonCode, "browser_auth_disabled_live_adapter_blocked");
    assert.equal(result.activationGate.allowed, false);
    assert.equal(result.activationGate.browserAuthEnabled, false);
    assert.equal(result.activationGate.wiredIntoAuthorization, false);
    assert.equal(result.activationGate.wiredIntoRoutes, false);
    assertNoSecretMaterial(result);
  }
});

test("browser-auth disabled-live adapter blocks before active behavior points", () => {
  const adapter = createBrowserAuthDisabledLiveAdapter();

  for (const routeId of plannedRoutes) {
    const result = adapter.handle({ routeId });

    assert.equal(result.betterAuthHandlerMounted, false);
    assert.equal(result.betterAuthHandlerCalled, false);
    assert.equal(result.internalAdapterWrapperCalled, false);
    assert.equal(result.setSessionCookieCalled, false);
    assert.equal(result.issuedCookies, false);
    assert.equal(result.acceptedCookies, false);
    assert.equal(result.parsedCookiesForAuthorization, false);
    assert.equal(result.issuedPairingCode, false);
    assert.equal(result.consumedPairingCode, false);
    assert.equal(result.issuedBrowserSession, false);
    assert.equal(result.createdBetterAuthSession, false);
    assert.equal(result.issuedCsrfToken, false);
    assert.equal(result.validatedCsrfToken, false);
    assert.equal(result.authenticatedRequest, false);
    assert.equal(result.liveAuthorizationDecision, false);
    assert.equal(result.changedBearerTokenProtectedMode, false);
    assert.equal(result.frontendStorageUsed, false);
  }
});

test("browser-auth disabled-live adapter emits no Set-Cookie", () => {
  const adapter = createBrowserAuthDisabledLiveAdapter();

  for (const routeId of plannedRoutes) {
    const result = adapter.handle({ routeId });

    assert.deepEqual(result.headers, {});
    assert.deepEqual(result.setCookieHeaders, []);
    assert.equal(
      Object.keys(result.headers).some((header) => header.toLowerCase() === "set-cookie"),
      false,
    );
  }
});

test("browser-auth disabled-live adapter source does not import active Better Auth or live auth paths", async () => {
  const source = await fs.readFile(
    path.join(process.cwd(), "backend/browserAuthDisabledLiveAdapter.ts"),
    "utf8",
  );

  for (const forbidden of [
    'from "better-auth',
    'from "./betterAuthInternalAdapterWrapper',
    'from "./betterAuthArepoPluginBoundaryProof',
    'from "./betterAuthDependencyProof',
    'from "./browserAuthCookieSerialization',
    'from "./browserAuthLifecycleCoordinator',
    'from "./requestAuthorizationPlanner',
    'from "./protectedModeEnforcement',
    'from "./httpCredentialAdapter',
    "setSessionCookie(",
  ]) {
    assert.equal(source.includes(forbidden), false, `disabled-live adapter imports ${forbidden}`);
  }
});

test("browser-auth disabled-live adapter is not imported by live server authorization or frontend paths", async () => {
  const sourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/httpCredentialAdapter.ts",
    "src/routes/index.tsx",
  ];

  for (const file of sourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(
      source.includes("./browserAuthDisabledLiveAdapter.js"),
      false,
      `${file} imports disabled-live browser-auth adapter`,
    );
    assert.equal(
      source.includes("createBrowserAuthDisabledLiveAdapter"),
      false,
      `${file} references disabled-live browser-auth adapter`,
    );
  }
});
