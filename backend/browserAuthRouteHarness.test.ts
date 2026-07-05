import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserAuthLifecycleCoordinator } from "./browserAuthLifecycleCoordinator.js";
import { planBrowserAuthActivationConfigPolicy } from "./browserAuthActivationConfigPolicy.js";
import { planBrowserAuthActivationPreflight } from "./browserAuthActivationPreflight.js";
import { planBrowserAuthRouteContracts } from "./browserAuthRouteContracts.js";
import {
  BROWSER_AUTH_ROUTE_HARNESS_MOUNTED,
  BROWSER_AUTH_ROUTE_HARNESS_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_ROUTE_HARNESS_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_ROUTE_HARNESS_WIRED_INTO_ROUTES,
  createBrowserAuthRouteHarness,
  type BrowserAuthHarnessRouteId,
  type BrowserAuthRouteHarnessResult,
} from "./browserAuthRouteHarness.js";

const plannedRouteIds: readonly BrowserAuthHarnessRouteId[] = [
  "browser-pairing-start",
  "browser-pairing-complete",
  "browser-session-issue",
  "browser-session-status",
  "browser-csrf-issue",
  "browser-session-logout",
  "browser-session-revoke-current",
  "browser-session-revoke-all",
] as const;

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_secret",
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `route harness exposed ${secret}`);
  }
}

function assertInactiveResult(result: BrowserAuthRouteHarnessResult): void {
  assert.equal(result.ok, false);
  assert.equal(result.status, "inactive");
  assert.equal(result.httpStatus, 501);
  assert.deepEqual(result.error, {
    code: "browser_session_auth_inactive",
    message: "Browser-session authentication is planned but not active.",
  });
  assert.equal(result.activationGate.allowed, false);
  assert.equal(result.headers["set-cookie"], undefined);
  assert.deepEqual(result.setCookieHeaders, []);
  assert.equal(result.issuedCookies, false);
  assert.equal(result.acceptedCookies, false);
  assert.equal(result.issuedPairingCode, false);
  assert.equal(result.consumedPairingCode, false);
  assert.equal(result.issuedBrowserSession, false);
  assert.equal(result.issuedCsrfToken, false);
  assert.equal(result.validatedCsrfToken, false);
  assert.equal(result.authenticatedRequest, false);
  assert.equal(result.liveAuthorizationDecision, false);
  assert.equal(result.lifecycleCoordinatorCalled, false);
  assert.equal(result.networkExposureSafe, false);
  assertNoSecretMaterial(result);
}

test("browser auth route harness is inactive unmounted diagnostics only", () => {
  const harness = createBrowserAuthRouteHarness();
  const diagnostics = harness.diagnostics();

  assert.equal(BROWSER_AUTH_ROUTE_HARNESS_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_ROUTE_HARNESS_MOUNTED, false);
  assert.equal(BROWSER_AUTH_ROUTE_HARNESS_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_ROUTE_HARNESS_WIRED_INTO_ROUTES, false);
  assert.equal(diagnostics.status, "inactive");
  assert.equal(diagnostics.implementation, "dark-route-test-harness");
  assert.equal(diagnostics.mounted, false);
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.routeCount, 8);
  assert.equal(diagnostics.issuesCookies, false);
  assert.equal(diagnostics.acceptsCookies, false);
  assert.equal(diagnostics.issuesPairingCodes, false);
  assert.equal(diagnostics.consumesPairingCodes, false);
  assert.equal(diagnostics.issuesBrowserSessions, false);
  assert.equal(diagnostics.issuesCsrfTokens, false);
  assert.equal(diagnostics.validatesCsrfTokens, false);
  assert.equal(diagnostics.authenticatesRequests, false);
  assertNoSecretMaterial(diagnostics);
});

test("each planned browser auth route has inactive harness coverage", () => {
  const routePlan = planBrowserAuthRouteContracts();
  const harness = createBrowserAuthRouteHarness({ routePlan });

  assert.deepEqual(
    routePlan.contracts.map((contract) => contract.routeId).sort(),
    [...plannedRouteIds].sort(),
  );

  for (const routeId of plannedRouteIds) {
    const contract = routePlan.contracts.find((candidate) => candidate.routeId === routeId);
    const result = harness.handle({
      routeId,
      method: contract?.method,
      path: contract?.path,
    });

    assert.equal(result.routeId, routeId);
    assert.equal(result.method, contract?.method);
    assert.equal(result.path, contract?.path);
    assert.equal(result.routeContractStatus, contract?.status);
    assertInactiveResult(result);
  }
});

test("named browser auth harness handlers remain blocked before active operations", () => {
  const harness = createBrowserAuthRouteHarness();
  const results = [
    harness.pairingStart(),
    harness.pairingComplete(),
    harness.sessionIssue(),
    harness.sessionStatus(),
    harness.csrfIssue(),
    harness.logout(),
    harness.revokeCurrentSession(),
    harness.revokeAllSessions(),
  ];

  for (const result of results) assertInactiveResult(result);
  assert.equal(results[0]?.routeId, "browser-pairing-start");
  assert.equal(results[1]?.routeId, "browser-pairing-complete");
  assert.equal(results[4]?.routeId, "browser-csrf-issue");
  assert.equal(results[5]?.routeId, "browser-session-logout");
  assert.equal(results[6]?.routeId, "browser-session-revoke-current");
  assert.equal(results[7]?.routeId, "browser-session-revoke-all");
});

test("browser auth harness does not call lifecycle coordinator while gate blocks", () => {
  let coordinatorCallCount = 0;
  const markCalled = (): never => {
    coordinatorCallCount += 1;
    throw new Error("coordinator should not be called while activation gate blocks");
  };
  const coordinator = {
    createPairingCode: markCalled,
    consumePairingCode: markCalled,
    createSessionFromPairingCode: markCalled,
    createCsrfTokenForSession: markCalled,
    verifySession: markCalled,
    verifyCsrfToken: markCalled,
    revokeSession: markCalled,
    revokeAllSessionsForSubject: markCalled,
    plannedCookieMetadata: markCalled,
    auditEvents: markCalled,
    diagnostics: markCalled,
    stores: {},
  } as unknown as BrowserAuthLifecycleCoordinator;

  const harness = createBrowserAuthRouteHarness({ lifecycleCoordinator: coordinator });

  for (const routeId of plannedRouteIds) {
    assertInactiveResult(harness.handle({ routeId }));
  }
  assert.equal(coordinatorCallCount, 0);
});

test("browser auth harness still blocks with activation-requested planning posture", () => {
  const activationConfigPolicy = planBrowserAuthActivationConfigPolicy({
    browserAuth: {
      activationRequested: true,
      operatorConfirmation: true,
      cookiePolicy: { secureCookies: true, sameSite: "strict" },
      csrfEnforcement: "active",
      sessionPersistenceStrategy: "persistent",
      auditEventsReady: true,
      revocationAndExpiryPreserved: true,
      routeContractsReady: true,
      inactiveBoundaryRegressionPresent: true,
      frontendNoSecretStorage: true,
    },
  });
  const activationPreflight = planBrowserAuthActivationPreflight({
    activationRequested: true,
    operatorConfirmationPresent: true,
    sessionRoutes: "mounted",
    pairingRoutes: "mounted",
    csrfEndpoint: "mounted",
    cookieIssuance: "active",
    cookieCredentialsAccepted: true,
    csrfEnforcement: "active",
    sessionPersistenceStrategy: "persistent",
    lifecycleCoordinatorMounted: true,
  });
  const harness = createBrowserAuthRouteHarness();

  const result = harness.sessionIssue({
    operatorConfirmationPresent: true,
    activationGate: {
      activationConfigPolicy,
      activationPreflight,
      operatorConfirmationPresent: true,
    },
  });

  assertInactiveResult(result);
  assert.ok(result.activationGate.blockerCodes.includes("browser-auth-activation-gate-blocked"));
  assert.ok(
    result.activationGate.blockerCodes.includes(
      "browser-auth-config-activation-disabled-by-runtime-policy",
    ),
  );
});

test("browser auth route harness is not imported into live server or authorization paths", async () => {
  const liveSourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/httpCredentialAdapter.ts",
  ];

  for (const file of liveSourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(source.includes("./browserAuthRouteHarness.js"), false);
    assert.equal(source.includes("createBrowserAuthRouteHarness"), false);
  }
});
