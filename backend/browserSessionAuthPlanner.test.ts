import test from "node:test";
import assert from "node:assert/strict";
import { planBrowserSessionAuth } from "./browserSessionAuthPlanner.js";

test("browser session auth planner reports planning-only inactive live state", () => {
  const plan = planBrowserSessionAuth({ authMode: "protected", localOnlyMode: true });

  assert.equal(plan.status, "planning-only");
  assert.equal(plan.liveSessionAuth, false);
  assert.equal(plan.acceptsSessionCookies, false);
  assert.equal(plan.sessionIssuance, "inactive");
  assert.equal(plan.csrfEnforcement, "inactive");
  assert.equal(plan.sessionRoutes, "stubbed");
  assert.equal(plan.pairingRoutes, "stubbed");
  assert.equal(plan.csrfEndpoint, "stubbed");
  assert.equal(plan.frontendTokenStorage, false);
  assert.equal(plan.networkExposureSafe, false);
  assert.equal(plan.readiness.ready, false);
  assert.ok(plan.readiness.blockers.includes("browser-session-auth-planning-only"));
  assert.ok(plan.readiness.blockers.includes("browser-session-cookies-not-accepted"));
  assert.ok(plan.readiness.blockers.includes("browser-session-issuance-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-session-csrf-enforcement-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-session-cookie-policy-planning-only"));
  assert.ok(plan.readiness.blockers.includes("browser-session-pairing-login-planning-only"));
  assert.ok(plan.readiness.blockers.includes("browser-pairing-issuance-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-pairing-consumption-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-session-lifecycle-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-session-logout-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-session-revoke-all-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-cookie-issuance-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-csrf-token-issuance-inactive"));
});

test("browser session auth planner describes inactive pairing lifecycle", () => {
  const plan = planBrowserSessionAuth({ authMode: "protected", localOnlyMode: true });
  const serialized = JSON.stringify(plan.pairing);

  assert.equal(plan.pairing.enabled, false);
  assert.equal(plan.pairing.status, "planning-only");
  assert.equal(plan.pairing.issueCode, "inactive");
  assert.equal(plan.pairing.consumeCode, "inactive");
  assert.equal(plan.pairing.preferredFlow, "local-pairing-code-from-authorized-bearer");
  assert.equal(plan.pairing.requiresExistingBearerCredential, true);
  assert.equal(plan.pairing.requiresLocalOrigin, true);
  assert.equal(plan.pairing.requiresStrongerConfirmation, true);
  assert.equal(plan.pairing.codesAreShortLived, true);
  assert.equal(plan.pairing.codesAreOneTimeUse, true);
  assert.equal(plan.pairing.storesRawCodes, false);
  assert.equal(plan.pairing.auditRecordsSanitized, true);
  assert.ok(plan.pairing.blockers.includes("browser-pairing-issuance-inactive"));
  assert.ok(plan.pairing.blockers.includes("browser-pairing-consumption-inactive"));
  assert.equal(serialized.includes("pairingCode"), false);
  assert.equal(serialized.includes("rawCode"), false);
  assert.equal(serialized.includes("Authorization"), false);
});

test("browser session auth planner describes inactive session issuance and revocation lifecycle", () => {
  const plan = planBrowserSessionAuth({ authMode: "protected", localOnlyMode: true });
  const serialized = JSON.stringify(plan.sessionLifecycle);

  assert.equal(plan.sessionLifecycle.issuance, "inactive");
  assert.equal(plan.sessionLifecycle.sessionStore, "planned");
  assert.equal(plan.sessionLifecycle.sessionVerifier, "planned");
  assert.equal(plan.sessionLifecycle.sessionRevocation, "planned");
  assert.equal(plan.sessionLifecycle.expiry, "planned");
  assert.equal(plan.sessionLifecycle.logout, "inactive");
  assert.equal(plan.sessionLifecycle.revokeAll, "inactive");
  assert.equal(plan.sessionLifecycle.currentSessionRevocation, "planned");
  assert.equal(plan.sessionLifecycle.allSessionRevocation, "planned");
  assert.equal(plan.sessionLifecycle.derivedSessionInvalidation, "planned");
  assert.equal(plan.sessionLifecycle.acceptsSessionCookies, false);
  assert.equal(plan.sessionLifecycle.storesRawSessionSecrets, false);
  assert.equal(plan.sessionLifecycle.returnsSessionSecretsInJson, false);
  assert.equal(serialized.includes("sessionSecret"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes('"salt"'), false);
  assert.equal(serialized.includes("Authorization"), false);
});

test("browser session auth planner describes inactive cookie and csrf posture", () => {
  const plan = planBrowserSessionAuth({ authMode: "disabled", localOnlyMode: false });
  const serialized = JSON.stringify({
    cookiePolicy: plan.cookiePolicy,
    csrf: plan.csrf,
  });

  assert.equal(plan.cookiePolicy.issuance, "inactive");
  assert.equal(plan.cookiePolicy.httpOnly, "required");
  assert.equal(plan.cookiePolicy.sameSite, "planned");
  assert.equal(plan.cookiePolicy.secure, "required-outside-local-dev");
  assert.equal(plan.cookiePolicy.devHttpException, "planned-localhost-only");
  assert.equal(plan.cookiePolicy.path, "planned");
  assert.equal(plan.cookiePolicy.domain, "omitted");
  assert.equal(plan.cookiePolicy.setsCookiesToday, false);
  assert.equal(plan.cookiePolicy.nonLocalHttp, "unsafe");
  assert.equal(plan.csrf.endpoint, "stubbed");
  assert.equal(plan.csrf.tokenIssuance, "inactive");
  assert.equal(plan.csrf.validation, "inactive");
  assert.equal(plan.csrf.enforcement, "inactive");
  assert.equal(plan.csrf.unsafeMethodsRequireCsrfWhenSessionAuthLive, true);
  assert.equal(plan.csrf.bearerTokenRequiresBrowserCsrf, false);
  assert.equal(plan.csrf.originRefererDefenseInDepth, true);
  assert.equal(plan.csrf.storesRawTokens, false);
  assert.equal(plan.csrf.logsRawTokens, false);
  assert.equal(serialized.includes("csrfToken"), false);
  assert.equal(serialized.includes("Set-Cookie"), false);
  assert.equal(serialized.includes("arepo_session"), false);
});

test("browser session auth planner describes safe future store frontend and audit posture only", () => {
  const plan = planBrowserSessionAuth({ authMode: "disabled", localOnlyMode: false });
  const serialized = JSON.stringify(plan);

  assert.equal(plan.sessionStore.verifierMetadataPlanned, true);
  assert.equal(plan.sessionStore.status, "inactive");
  assert.equal(plan.sessionStore.implementation, "in-memory-test-primitive");
  assert.equal(plan.sessionStore.wiredIntoAuthorization, false);
  assert.equal(plan.sessionStore.storesRawSessionSecrets, false);
  assert.equal(plan.sessionStore.revocationRequired, true);
  assert.equal(plan.sessionVerifier.status, "inactive");
  assert.equal(plan.sessionVerifier.implementation, "hash-and-constant-time-compare-primitive");
  assert.equal(plan.sessionVerifier.wiredIntoAuthorization, false);
  assert.equal(plan.sessionVerifier.storesRawSessionSecrets, false);
  assert.equal(plan.frontend.tokenStorage, false);
  assert.equal(plan.frontend.sessionSecretReadableByJs, false);
  assert.equal(plan.frontend.loginUi, "inactive");
  assert.equal(plan.audit.status, "planned");
  assert.ok(plan.audit.events.includes("browser_pairing_issue_attempted"));
  assert.ok(plan.audit.events.includes("browser_pairing_issue_succeeded"));
  assert.ok(plan.audit.events.includes("browser_pairing_issue_denied"));
  assert.ok(plan.audit.events.includes("browser_pairing_consume_attempted"));
  assert.ok(plan.audit.events.includes("browser_pairing_consume_succeeded"));
  assert.ok(plan.audit.events.includes("browser_pairing_consume_denied"));
  assert.ok(plan.audit.events.includes("browser_session_issue_attempted"));
  assert.ok(plan.audit.events.includes("browser_session_issue_succeeded"));
  assert.ok(plan.audit.events.includes("browser_session_issue_denied"));
  assert.ok(plan.audit.events.includes("browser_session_logout_succeeded"));
  assert.ok(plan.audit.events.includes("browser_session_revoke_all_succeeded"));
  assert.ok(plan.audit.events.includes("browser_session_denied_invalid"));
  assert.ok(plan.audit.events.includes("browser_session_denied_expired"));
  assert.ok(plan.audit.events.includes("browser_session_denied_revoked"));
  assert.ok(plan.audit.events.includes("browser_csrf_denied"));
  assert.equal(plan.audit.excludesRawBearerTokens, true);
  assert.equal(plan.audit.excludesRawSessionSecrets, true);
  assert.equal(plan.audit.excludesRawPairingCodes, true);
  assert.equal(plan.audit.excludesRawCsrfTokens, true);
  assert.equal(plan.audit.excludesAuthorizationHeaders, true);
  assert.equal(plan.audit.excludesCookies, true);
  assert.equal(plan.audit.excludesVerifierHashes, true);
  assert.equal(plan.audit.excludesSalts, true);
  assert.equal(plan.audit.excludesUnsafeBrowserFingerprints, true);
  assert.equal(serialized.includes('"rawBearerToken"'), false);
  assert.equal(serialized.includes('"rawSessionSecret"'), false);
  assert.equal(serialized.includes('"rawCsrfToken"'), false);
  assert.equal(serialized.includes('"rawPairingCode"'), false);
  assert.equal(serialized.includes('"authorizationHeader"'), false);
  assert.equal(serialized.includes('"cookieHeader"'), false);
  assert.equal(serialized.includes('"verifierHash"'), false);
  assert.equal(serialized.includes('"salt"'), false);
  assert.equal(serialized.includes("arepo_session"), false);
  assert.equal(serialized.includes("Set-Cookie"), false);
});
