import test from "node:test";
import assert from "node:assert/strict";
import { planBrowserSessionAuth } from "./browserSessionAuthPlanner.js";

test("browser session auth planner reports planning-only inactive live state", () => {
  const plan = planBrowserSessionAuth({ authMode: "protected", localOnlyMode: true });

  assert.equal(plan.status, "planning-only");
  assert.equal(plan.acceptsSessionCookies, false);
  assert.equal(plan.sessionIssuance, "inactive");
  assert.equal(plan.csrfEnforcement, "inactive");
  assert.equal(plan.frontendTokenStorage, false);
  assert.equal(plan.networkExposureSafe, false);
  assert.equal(plan.readiness.ready, false);
  assert.ok(plan.readiness.blockers.includes("browser-session-auth-planning-only"));
  assert.ok(plan.readiness.blockers.includes("browser-session-cookies-not-accepted"));
  assert.ok(plan.readiness.blockers.includes("browser-session-issuance-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-session-csrf-enforcement-inactive"));
  assert.ok(plan.readiness.blockers.includes("browser-session-cookie-policy-planning-only"));
  assert.ok(plan.readiness.blockers.includes("browser-session-pairing-login-planning-only"));
});

test("browser session auth planner describes safe future cookie and store posture only", () => {
  const plan = planBrowserSessionAuth({ authMode: "disabled", localOnlyMode: false });
  const serialized = JSON.stringify(plan);

  assert.equal(plan.cookiePolicy.httpOnly, true);
  assert.equal(plan.cookiePolicy.sameSite, "lax");
  assert.equal(plan.cookiePolicy.secure, "required-on-https");
  assert.equal(plan.cookiePolicy.devHttpException, "localhost-only-planned");
  assert.equal(plan.cookiePolicy.path, "/api");
  assert.equal(plan.cookiePolicy.domainAttribute, false);
  assert.equal(plan.pairing.preferredFlow, "local-pairing-code-from-authorized-bearer");
  assert.equal(plan.sessionStore.verifierMetadataPlanned, true);
  assert.equal(plan.sessionStore.storesRawSessionSecrets, false);
  assert.equal(plan.sessionStore.revocationRequired, true);
  assert.equal(serialized.includes('"sessionSecret"'), false);
  assert.equal(serialized.includes('"csrfToken"'), false);
  assert.equal(serialized.includes('"pairingCode"'), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes('"salt"'), false);
  assert.equal(serialized.includes("Authorization"), false);
  assert.equal(serialized.includes("arepo_session"), false);
  assert.equal(serialized.includes("Set-Cookie"), false);
});
