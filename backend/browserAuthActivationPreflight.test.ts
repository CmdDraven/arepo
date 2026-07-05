import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_AUTH_ACTIVATION_PREFLIGHT_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_ACTIVATION_PREFLIGHT_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_ACTIVATION_PREFLIGHT_WIRED_INTO_ROUTES,
  planBrowserAuthActivationPreflight,
} from "./browserAuthActivationPreflight.js";

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
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `preflight exposed ${secret}`);
  }
}

test("default browser auth activation preflight is inactive and blocked", () => {
  const plan = planBrowserAuthActivationPreflight();

  assert.equal(BROWSER_AUTH_ACTIVATION_PREFLIGHT_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_ACTIVATION_PREFLIGHT_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_ACTIVATION_PREFLIGHT_WIRED_INTO_ROUTES, false);
  assert.equal(plan.status, "inactive");
  assert.equal(plan.activationRequested, false);
  assert.equal(plan.readyForFutureActivation, false);
  assert.equal(plan.liveRouteMountingAllowed, false);
  assert.equal(plan.browserAuthEnabled, false);
  assert.equal(plan.mounted, false);
  assert.equal(plan.wiredIntoAuthorization, false);
  assert.equal(plan.wiredIntoRoutes, false);
  assert.equal(plan.issuesCookies, false);
  assert.equal(plan.acceptsCookies, false);
  assert.equal(plan.acceptsCsrfTokens, false);
  assert.equal(plan.lifecycleCoordinatorMounted, false);
  assert.equal(plan.activationConfigPolicy.status, "inactive");
  assert.equal(plan.activationConfigPolicy.activationAllowed, false);
  assert.equal(plan.activationConfigPolicy.browserAuthEnabled, false);
  assert.equal(plan.activationConfigPolicy.mounted, false);
  assert.equal(plan.activationConfigPolicy.wiredIntoAuthorization, false);
  assert.equal(plan.activationConfigPolicy.wiredIntoRoutes, false);
  assert.ok(plan.blockerCodes.includes("browser-auth-activation-not-requested"));
  assert.ok(plan.blockerCodes.includes("browser-auth-route-mounting-blocked"));
});

test("activation request remains blocked without operator confirmation", () => {
  const plan = planBrowserAuthActivationPreflight({ activationRequested: true });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.activationRequested, true);
  assert.ok(plan.blockerCodes.includes("browser-auth-operator-confirmation-missing"));
  assert.ok(plan.requiredConfirmations.includes("confirm-browser-auth-activation"));
  assert.ok(plan.requiredConfirmations.includes("confirm-cookie-session-csrf-enforcement"));
});

test("stubbed browser auth route surfaces block activation", () => {
  const plan = planBrowserAuthActivationPreflight({
    activationRequested: true,
    operatorConfirmationPresent: true,
  });

  assert.ok(plan.blockerCodes.includes("browser-auth-session-routes-stubbed"));
  assert.ok(plan.blockerCodes.includes("browser-auth-pairing-routes-stubbed"));
  assert.ok(plan.blockerCodes.includes("browser-auth-csrf-endpoint-stubbed"));
});

test("inactive cookie credentials cookie issuance and csrf enforcement block activation", () => {
  const plan = planBrowserAuthActivationPreflight({
    activationRequested: true,
    operatorConfirmationPresent: true,
    sessionRoutes: "mounted",
    pairingRoutes: "mounted",
    csrfEndpoint: "mounted",
  });

  assert.ok(plan.blockerCodes.includes("browser-auth-cookie-credentials-not-accepted"));
  assert.ok(plan.blockerCodes.includes("browser-auth-live-cookie-issuance-inactive"));
  assert.ok(plan.blockerCodes.includes("browser-auth-csrf-enforcement-inactive"));
});

test("unmounted lifecycle coordinator and unresolved persistence block activation", () => {
  const plan = planBrowserAuthActivationPreflight({
    activationRequested: true,
    operatorConfirmationPresent: true,
    cookieCredentialsAccepted: true,
    cookieIssuance: "active",
    csrfEnforcement: "active",
    sessionRoutes: "mounted",
    pairingRoutes: "mounted",
    csrfEndpoint: "mounted",
  });

  assert.ok(plan.blockerCodes.includes("browser-auth-lifecycle-coordinator-unmounted"));
  assert.ok(plan.blockerCodes.includes("browser-auth-session-persistence-strategy-unresolved"));
});

test("non-local posture requires stronger remote policy and confirmation", () => {
  const plan = planBrowserAuthActivationPreflight({
    activationRequested: true,
    operatorConfirmationPresent: true,
    localOnlyMode: false,
  });

  assert.ok(plan.blockerCodes.includes("browser-auth-remote-binding-requires-stronger-policy"));
  assert.ok(
    plan.warningCodes.includes("browser-auth-non-local-bind-unsafe-without-stronger-policy"),
  );
  assert.ok(plan.warningCodes.includes("browser-auth-secure-cookie-policy-required"));
  assert.ok(plan.requiredConfirmations.includes("confirm-local-only-or-stronger-network-policy"));
});

test("inactive-boundary regression requirement is explicit", () => {
  const plan = planBrowserAuthActivationPreflight({
    activationRequested: true,
    operatorConfirmationPresent: true,
    inactiveBoundaryRegressionPresent: false,
  });

  assert.ok(plan.blockerCodes.includes("browser-auth-inactive-boundary-regression-required"));
});

test("preflight output is sanitized and contains only safe planning codes", () => {
  const plan = planBrowserAuthActivationPreflight({
    activationRequested: true,
    operatorConfirmationPresent: true,
    localOnlyMode: false,
  });

  assertNoSecretMaterial(plan);
  assert.ok(plan.safeNotes.includes("CORS is not authentication."));
  assert.ok(plan.warningCodes.includes("browser-auth-cors-is-not-authentication"));
  assert.ok(plan.warningCodes.includes("browser-auth-frontend-storage-must-remain-secretless"));
  assert.ok(plan.warningCodes.includes("browser-auth-bearer-flow-remains-live-credential-path"));
});

test("preflight planner is not imported into live server or authorization paths", async () => {
  const liveSourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/httpCredentialAdapter.ts",
  ];

  for (const file of liveSourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(source.includes("./browserAuthActivationPreflight.js"), false);
    assert.equal(source.includes("planBrowserAuthActivationPreflight"), false);
  }
});
