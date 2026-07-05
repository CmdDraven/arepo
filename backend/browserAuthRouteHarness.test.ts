import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserAuthLifecycleCoordinator } from "./browserAuthLifecycleCoordinator.js";
import { createInMemoryBrowserAuthLifecycleCoordinator } from "./browserAuthLifecycleCoordinator.js";
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
  type BrowserAuthRouteHarnessTestOnlyResult,
} from "./browserAuthRouteHarness.js";
import { createBrowserAuthTestOnlyActivationAllowance } from "./browserAuthTestOnlyActivation.js";

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
const pairingSecret = "bpairsec_route_harness_pairing_secret";
const sessionSecret = "bsver_route_harness_session_secret";
const csrfSecret = "bcsrfsec_route_harness_csrf_secret";

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `route harness exposed ${secret}`);
  }
}

function assertInactiveResult(
  result: BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult,
): asserts result is BrowserAuthRouteHarnessResult {
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

function assertNoUnsafeMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of [...secretSamples, pairingSecret, sessionSecret, csrfSecret]) {
    assert.equal(serialized.includes(secret), false, `route harness exposed ${secret}`);
  }
}

function assertNoRawSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of [pairingSecret, sessionSecret, csrfSecret]) {
    assert.equal(serialized.includes(secret), false, `stored record exposed ${secret}`);
  }
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
  assert.equal(result.activationGate.allowed, false);
  if (result.activationGate.allowed) throw new Error("Expected activation gate to block.");
  assert.ok(result.activationGate.blockerCodes.includes("browser-auth-activation-gate-blocked"));
  assert.ok(
    result.activationGate.blockerCodes.includes(
      "browser-auth-config-activation-disabled-by-runtime-policy",
    ),
  );
});

test("test-only harness flow creates pairing session and csrf records without storing raw secrets", () => {
  const coordinator = createInMemoryBrowserAuthLifecycleCoordinator({ clock: () => 1_000 });
  const harness = createBrowserAuthRouteHarness({ lifecycleCoordinator: coordinator });
  const testOnlyActivation = createBrowserAuthTestOnlyActivationAllowance();

  const pairing = harness.pairingStart({
    testOnlyActivation,
    subjectId: "subject-a",
    pairingCodeId: "bpair_route_harness_1",
    pairingCodeSecret: pairingSecret,
  });
  assert.equal(pairing.status, "test-only-active");
  assert.equal(pairing.ok, true);
  if (!pairing.ok) throw new Error("Expected pairing start to succeed.");
  assert.equal(pairing.result.operation, "pairing-start");
  if (pairing.result.operation !== "pairing-start") {
    throw new Error("Expected pairing start result.");
  }
  assert.equal(pairing.result.pairingCodeSecret, pairingSecret);
  const pairingRecord = coordinator.stores.pairingCodes.getPairingCode(
    pairing.result.pairingCodeId,
  );
  assert.match(pairingRecord?.pairingCodeHash ?? "", /^sha256:/);
  assertNoRawSecretMaterial(pairingRecord);

  const complete = harness.pairingComplete({
    testOnlyActivation,
    pairingCodeId: pairing.result.pairingCodeId,
    pairingCodeSecret: pairingSecret,
    sessionId: "bsess_route_harness_1",
    sessionVerifierSecret: sessionSecret,
    csrfTokenId: "bcsrf_route_harness_1",
    csrfTokenSecret: csrfSecret,
  });

  assert.equal(complete.status, "test-only-active");
  assert.equal(complete.ok, true);
  if (!complete.ok) throw new Error("Expected pairing completion to succeed.");
  assert.equal(complete.result.operation, "pairing-complete");
  if (complete.result.operation !== "pairing-complete") {
    throw new Error("Expected pairing complete result.");
  }
  assert.equal(complete.result.sessionVerifierSecret, sessionSecret);
  assert.equal(complete.result.csrfTokenSecret, csrfSecret);
  const sessionRecord = coordinator.stores.sessions.getSession(complete.result.sessionId);
  const csrfRecord = coordinator.stores.csrfTokens.getToken(complete.result.csrfTokenId);
  assert.match(sessionRecord?.verifierHash ?? "", /^sha256:/);
  assert.match(csrfRecord?.tokenHash ?? "", /^sha256:/);
  assertNoRawSecretMaterial(sessionRecord);
  assertNoRawSecretMaterial(csrfRecord);
  assert.deepEqual(complete.setCookieHeaders, []);
  assert.equal(complete.issuedCookies, false);
  assert.equal(complete.authenticatedRequest, false);
  assert.equal(complete.liveAuthorizationDecision, false);
});

test("test-only pairing completion consumes codes once and reports sanitized failures", () => {
  const coordinator = createInMemoryBrowserAuthLifecycleCoordinator({ clock: () => 1_000 });
  const harness = createBrowserAuthRouteHarness({ lifecycleCoordinator: coordinator });
  const testOnlyActivation = createBrowserAuthTestOnlyActivationAllowance();
  const pairing = harness.pairingStart({
    testOnlyActivation,
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
  });
  assert.equal(pairing.ok, true);
  if (!pairing.ok || pairing.result.operation !== "pairing-start") {
    throw new Error("Expected pairing start result.");
  }

  const missing = harness.pairingComplete({ testOnlyActivation });
  const wrong = harness.pairingComplete({
    testOnlyActivation,
    pairingCodeId: pairing.result.pairingCodeId,
    pairingCodeSecret: "wrong-code",
  });
  const valid = harness.pairingComplete({
    testOnlyActivation,
    pairingCodeId: pairing.result.pairingCodeId,
    pairingCodeSecret: pairingSecret,
  });
  const consumed = harness.pairingComplete({
    testOnlyActivation,
    pairingCodeId: pairing.result.pairingCodeId,
    pairingCodeSecret: pairingSecret,
  });

  assert.equal(missing.status, "test-only-rejected");
  assert.equal(wrong.status, "test-only-rejected");
  assert.equal(valid.status, "test-only-active");
  assert.equal(consumed.status, "test-only-rejected");
  if (missing.status === "test-only-rejected") {
    assert.equal(missing.error.reason, "missing-code");
  }
  if (wrong.status === "test-only-rejected") {
    assert.equal(wrong.error.reason, "wrong-code");
  }
  if (consumed.status === "test-only-rejected") {
    assert.equal(consumed.error.reason, "consumed-code");
  }
  assertNoUnsafeMaterial({ missing, wrong, consumed });
});

test("test-only harness reports expired revoked and locked pairing code failures", () => {
  let now = 1_000;
  const coordinator = createInMemoryBrowserAuthLifecycleCoordinator({ clock: () => now });
  const harness = createBrowserAuthRouteHarness({ lifecycleCoordinator: coordinator });
  const testOnlyActivation = createBrowserAuthTestOnlyActivationAllowance();
  const expired = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
    ttlMs: 10,
  });
  now = 2_000;
  const expiredResult = harness.pairingComplete({
    testOnlyActivation,
    pairingCodeId: expired.pairingCodeId,
    pairingCodeSecret: pairingSecret,
  });
  now = 1_000;
  const revoked = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
  });
  coordinator.stores.pairingCodes.revokePairingCode(revoked.pairingCodeId);
  const revokedResult = harness.pairingComplete({
    testOnlyActivation,
    pairingCodeId: revoked.pairingCodeId,
    pairingCodeSecret: pairingSecret,
  });
  const locked = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
    maxFailedAttempts: 1,
  });
  const lockedResult = harness.pairingComplete({
    testOnlyActivation,
    pairingCodeId: locked.pairingCodeId,
    pairingCodeSecret: "wrong-code",
  });

  assert.equal(expiredResult.status, "test-only-rejected");
  assert.equal(revokedResult.status, "test-only-rejected");
  assert.equal(lockedResult.status, "test-only-rejected");
  if (expiredResult.status === "test-only-rejected") {
    assert.equal(expiredResult.error.reason, "expired-code");
  }
  if (revokedResult.status === "test-only-rejected") {
    assert.equal(revokedResult.error.reason, "revoked-code");
  }
  if (lockedResult.status === "test-only-rejected") {
    assert.equal(lockedResult.error.reason, "locked-code");
  }
  assertNoUnsafeMaterial({ expiredResult, revokedResult, lockedResult });
});

test("test-only session status logout revoke current and revoke all mutate only coordinator state", () => {
  const coordinator = createInMemoryBrowserAuthLifecycleCoordinator({ clock: () => 1_000 });
  const harness = createBrowserAuthRouteHarness({ lifecycleCoordinator: coordinator });
  const testOnlyActivation = createBrowserAuthTestOnlyActivationAllowance();
  const subjectA = issueSession(harness, testOnlyActivation, "subject-a", "a");
  const subjectB = issueSession(harness, testOnlyActivation, "subject-b", "b");
  const subjectC = issueSession(harness, testOnlyActivation, "subject-c", "c");

  const status = harness.sessionStatus({
    testOnlyActivation,
    sessionId: subjectA.sessionId,
  });
  assert.equal(status.status, "test-only-active");
  if (status.ok && status.result.operation === "session-status") {
    assert.equal(status.result.session?.sessionId, subjectA.sessionId);
    assert.equal(status.result.session?.status, "active");
    assertNoUnsafeMaterial(status.result);
  } else {
    throw new Error("Expected session status result.");
  }

  const logout = harness.logout({ testOnlyActivation, sessionId: subjectA.sessionId });
  assert.equal(logout.status, "test-only-active");
  if (logout.ok && logout.result.operation === "logout") {
    assert.equal(logout.result.revokedSession, true);
    assert.equal(logout.result.revokedCsrfTokenCount, 1);
  } else {
    throw new Error("Expected logout result.");
  }
  assert.deepEqual(coordinator.verifySession(subjectA.sessionId, subjectA.sessionSecret), {
    ok: false,
    reason: "revoked-session",
  });
  assert.deepEqual(coordinator.verifyCsrfToken(subjectA.csrfTokenId, subjectA.csrfSecret), {
    ok: false,
    reason: "revoked-token",
  });
  assert.equal(coordinator.verifySession(subjectB.sessionId, subjectB.sessionSecret).ok, true);

  const revokeCurrent = harness.revokeCurrentSession({
    testOnlyActivation,
    sessionId: subjectC.sessionId,
  });
  assert.equal(revokeCurrent.status, "test-only-active");
  if (revokeCurrent.ok && revokeCurrent.result.operation === "revoke-current-session") {
    assert.equal(revokeCurrent.result.revokedSession, true);
    assert.equal(revokeCurrent.result.revokedCsrfTokenCount, 1);
  } else {
    throw new Error("Expected revoke current result.");
  }
  assert.deepEqual(coordinator.verifySession(subjectC.sessionId, subjectC.sessionSecret), {
    ok: false,
    reason: "revoked-session",
  });
  assert.equal(coordinator.verifySession(subjectB.sessionId, subjectB.sessionSecret).ok, true);

  const revokeAll = harness.revokeAllSessions({
    testOnlyActivation,
    revokeSubjectId: "subject-b",
  });
  assert.equal(revokeAll.status, "test-only-active");
  if (revokeAll.ok && revokeAll.result.operation === "revoke-all-sessions") {
    assert.equal(revokeAll.result.revokedSessionCount, 1);
    assert.equal(revokeAll.result.revokedCsrfTokenCount, 1);
  } else {
    throw new Error("Expected revoke all result.");
  }
  assert.deepEqual(coordinator.verifySession(subjectB.sessionId, subjectB.sessionSecret), {
    ok: false,
    reason: "revoked-session",
  });
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

function issueSession(
  harness: ReturnType<typeof createBrowserAuthRouteHarness>,
  testOnlyActivation: ReturnType<typeof createBrowserAuthTestOnlyActivationAllowance>,
  subjectId: string,
  suffix: string,
): { sessionId: string; sessionSecret: string; csrfTokenId: string; csrfSecret: string } {
  const pairing = harness.pairingStart({
    testOnlyActivation,
    subjectId,
    pairingCodeSecret: `pairing-${suffix}`,
  });
  if (!pairing.ok || pairing.result.operation !== "pairing-start") {
    throw new Error("Expected pairing start result.");
  }
  const sessionSecretForSubject = `session-${suffix}`;
  const csrfSecretForSubject = `csrf-${suffix}`;
  const completed = harness.pairingComplete({
    testOnlyActivation,
    pairingCodeId: pairing.result.pairingCodeId,
    pairingCodeSecret: `pairing-${suffix}`,
    sessionVerifierSecret: sessionSecretForSubject,
    csrfTokenSecret: csrfSecretForSubject,
  });
  if (!completed.ok || completed.result.operation !== "pairing-complete") {
    throw new Error("Expected pairing complete result.");
  }
  return {
    sessionId: completed.result.sessionId,
    sessionSecret: sessionSecretForSubject,
    csrfTokenId: completed.result.csrfTokenId,
    csrfSecret: csrfSecretForSubject,
  };
}
