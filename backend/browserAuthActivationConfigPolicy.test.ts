import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planBrowserAuthActivationPreflight } from "./browserAuthActivationPreflight.js";
import {
  BROWSER_AUTH_ACTIVATION_CONFIG_POLICY_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_ACTIVATION_CONFIG_POLICY_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_ACTIVATION_CONFIG_POLICY_WIRED_INTO_ROUTES,
  planBrowserAuthActivationConfigPolicy,
} from "./browserAuthActivationConfigPolicy.js";

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
    assert.equal(serialized.includes(secret), false, `config policy exposed ${secret}`);
  }
}

test("missing browser auth config results in inactive default posture", () => {
  const plan = planBrowserAuthActivationConfigPolicy();

  assert.equal(BROWSER_AUTH_ACTIVATION_CONFIG_POLICY_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_ACTIVATION_CONFIG_POLICY_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_ACTIVATION_CONFIG_POLICY_WIRED_INTO_ROUTES, false);
  assert.equal(plan.status, "inactive");
  assert.equal(plan.requestedActivation, false);
  assert.equal(plan.effectiveActivationStatus, "inactive");
  assert.equal(plan.activationAllowed, false);
  assert.equal(plan.buildRuntimeAllowsActivation, false);
  assert.equal(plan.browserAuthEnabled, false);
  assert.equal(plan.mounted, false);
  assert.equal(plan.wiredIntoAuthorization, false);
  assert.equal(plan.wiredIntoRoutes, false);
  assert.equal(plan.issuesCookies, false);
  assert.equal(plan.acceptsCookies, false);
  assert.equal(plan.acceptsCsrfTokens, false);
  assert.ok(plan.blockerCodes.includes("browser-auth-config-activation-not-requested"));
  assert.ok(plan.blockerCodes.includes("browser-auth-config-live-mounting-blocked"));
});

test("explicit activation request remains blocked by runtime policy", () => {
  const plan = planBrowserAuthActivationConfigPolicy({
    browserAuth: {
      activationRequested: true,
      operatorConfirmation: "confirm-browser-auth-activation",
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

  assert.equal(plan.status, "blocked");
  assert.equal(plan.requestedActivation, true);
  assert.equal(plan.activationAllowed, false);
  assert.ok(
    plan.blockerCodes.includes("browser-auth-config-activation-disabled-by-runtime-policy"),
  );
  assert.ok(plan.blockerCodes.includes("browser-auth-config-live-mounting-blocked"));
});

test("missing operator confirmation blocks activation", () => {
  const plan = planBrowserAuthActivationConfigPolicy({
    browserAuth: { activationRequested: true },
  });

  assert.ok(plan.blockerCodes.includes("browser-auth-config-operator-confirmation-missing"));
  assert.ok(plan.requiredConfirmations.includes("confirm-browser-auth-config-activation"));
  assert.ok(plan.requiredConfirmations.includes("confirm-browser-auth-cookie-session-csrf-policy"));
});

test("non-local posture requires stronger policy and secure cookies", () => {
  const plan = planBrowserAuthActivationConfigPolicy({
    localOnlyMode: false,
    browserAuth: {
      activationRequested: true,
      operatorConfirmation: true,
      strongerRemotePolicyConfigured: false,
      cookiePolicy: { sameSite: "lax", secureCookies: false },
    },
  });

  assert.ok(
    plan.blockerCodes.includes("browser-auth-config-remote-binding-requires-stronger-policy"),
  );
  assert.ok(plan.blockerCodes.includes("browser-auth-config-secure-cookie-policy-missing"));
  assert.ok(
    plan.warningCodes.includes("browser-auth-config-non-local-bind-unsafe-without-stronger-policy"),
  );
  assert.ok(
    plan.requiredConfirmations.includes(
      "confirm-browser-auth-local-only-or-stronger-network-policy",
    ),
  );
});

test("unsafe cookie policy assumptions block activation", () => {
  const unsafeSameSite = planBrowserAuthActivationConfigPolicy({
    browserAuth: {
      activationRequested: true,
      operatorConfirmation: true,
      cookiePolicy: { sameSite: "none", domain: "example.test" },
    },
  });
  const missingSameSite = planBrowserAuthActivationConfigPolicy({
    browserAuth: {
      activationRequested: true,
      operatorConfirmation: true,
      cookiePolicy: { secureCookies: true },
    },
  });

  assert.ok(unsafeSameSite.blockerCodes.includes("browser-auth-config-samesite-policy-unsafe"));
  assert.ok(unsafeSameSite.warningCodes.includes("browser-auth-config-cookie-domain-discouraged"));
  assert.ok(missingSameSite.blockerCodes.includes("browser-auth-config-samesite-policy-missing"));
});

test("missing csrf persistence audit revocation route and boundary gates block activation", () => {
  const plan = planBrowserAuthActivationConfigPolicy({
    browserAuth: {
      activationRequested: true,
      operatorConfirmation: true,
      cookiePolicy: { sameSite: "strict", secureCookies: true },
      csrfEnforcement: "inactive",
      sessionPersistenceStrategy: "unresolved",
      auditEventsReady: false,
      revocationAndExpiryPreserved: false,
      routeContractsReady: false,
      inactiveBoundaryRegressionPresent: false,
      frontendNoSecretStorage: false,
    },
  });

  assert.ok(plan.blockerCodes.includes("browser-auth-config-csrf-enforcement-inactive"));
  assert.ok(
    plan.blockerCodes.includes("browser-auth-config-session-persistence-strategy-unresolved"),
  );
  assert.ok(plan.blockerCodes.includes("browser-auth-config-audit-readiness-missing"));
  assert.ok(plan.blockerCodes.includes("browser-auth-config-revocation-expiry-readiness-missing"));
  assert.ok(plan.blockerCodes.includes("browser-auth-config-route-contracts-not-ready"));
  assert.ok(
    plan.blockerCodes.includes("browser-auth-config-inactive-boundary-regression-required"),
  );
  assert.ok(
    plan.blockerCodes.includes("browser-auth-config-frontend-secret-storage-not-prohibited"),
  );
});

test("unknown browser auth config keys are handled safely", () => {
  const plan = planBrowserAuthActivationConfigPolicy({
    browserAuth: {
      activationRequested: true,
      operatorConfirmation: true,
      rawToken: "Bearer arepo_secret_token",
      cookieHeader: "arepo_session=secret-cookie",
    },
  });

  assert.deepEqual(plan.unknownConfigKeys, ["cookieHeader", "rawToken"]);
  assert.ok(plan.blockerCodes.includes("browser-auth-config-unknown-setting-present"));
  assertNoSecretMaterial(plan);
});

test("planner output is sanitized and contains no credential material", () => {
  const plan = planBrowserAuthActivationConfigPolicy({
    localOnlyMode: false,
    browserAuth: {
      activationRequested: true,
      operatorConfirmation: "wrong-confirmation",
      cookiePolicy: { sameSite: "none", domain: "example.test" },
      csrfEnforcement: "inactive",
      sessionPersistenceStrategy: "unresolved",
    },
  });

  assertNoSecretMaterial(plan);
  assert.ok(plan.warningCodes.includes("browser-auth-config-cors-is-not-authentication"));
  assert.ok(plan.warningCodes.includes("browser-auth-config-future-shape-only"));
  assert.ok(plan.warningCodes.includes("browser-auth-config-frontend-must-not-store-secrets"));
});

test("activation preflight consumes config policy as pure planning input and remains blocked", () => {
  const preflight = planBrowserAuthActivationPreflight({
    activationRequested: true,
    operatorConfirmationPresent: true,
    browserAuthConfig: {
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

  assert.equal(preflight.status, "blocked");
  assert.equal(preflight.activationConfigPolicy.status, "blocked");
  assert.equal(preflight.activationConfigPolicy.requestedActivation, true);
  assert.equal(preflight.activationConfigPolicy.activationAllowed, false);
  assert.equal(preflight.activationConfigPolicy.wiredIntoAuthorization, false);
  assert.equal(preflight.activationConfigPolicy.wiredIntoRoutes, false);
  assert.ok(
    preflight.activationConfigPolicy.blockerCodes.includes(
      "browser-auth-config-activation-disabled-by-runtime-policy",
    ),
  );
});

test("config policy planner is not imported into live server or authorization paths", async () => {
  const liveSourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/httpCredentialAdapter.ts",
  ];

  for (const file of liveSourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(source.includes("./browserAuthActivationConfigPolicy.js"), false);
    assert.equal(source.includes("planBrowserAuthActivationConfigPolicy"), false);
  }
});
