import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planBrowserAuthActivationConfigPolicy } from "./browserAuthActivationConfigPolicy.js";
import { planBrowserAuthActivationPreflight } from "./browserAuthActivationPreflight.js";
import { planBrowserAuthRouteContracts } from "./browserAuthRouteContracts.js";
import {
  BROWSER_AUTH_ACTIVATION_GATE_ALLOWS_BROWSER_AUTH,
  BROWSER_AUTH_ACTIVATION_GATE_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_ACTIVATION_GATE_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_ACTIVATION_GATE_WIRED_INTO_ROUTES,
  evaluateBrowserAuthActivationGate,
} from "./browserAuthActivationGate.js";

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
    assert.equal(serialized.includes(secret), false, `activation gate exposed ${secret}`);
  }
}

test("browser auth activation gate blocks by default", () => {
  const decision = evaluateBrowserAuthActivationGate();

  assert.equal(BROWSER_AUTH_ACTIVATION_GATE_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_ACTIVATION_GATE_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_ACTIVATION_GATE_WIRED_INTO_ROUTES, false);
  assert.equal(BROWSER_AUTH_ACTIVATION_GATE_ALLOWS_BROWSER_AUTH, false);
  assert.equal(decision.status, "blocked");
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "browser_auth_activation_blocked");
  assert.equal(decision.browserAuthEnabled, false);
  assert.equal(decision.mounted, false);
  assert.equal(decision.wiredIntoAuthorization, false);
  assert.equal(decision.wiredIntoRoutes, false);
  assert.equal(decision.issuesCookies, false);
  assert.equal(decision.acceptsCookies, false);
  assert.equal(decision.issuesPairingCodes, false);
  assert.equal(decision.consumesPairingCodes, false);
  assert.equal(decision.issuesBrowserSessions, false);
  assert.equal(decision.issuesCsrfTokens, false);
  assert.equal(decision.validatesCsrfTokens, false);
  assert.equal(decision.authenticatesRequests, false);
  assert.ok(decision.blockerCodes.includes("browser-auth-activation-gate-blocked"));
  assert.ok(decision.blockerCodes.includes("browser-auth-activation-gate-route-contract-missing"));
});

test("browser auth activation gate blocks even with future-style activation requested", () => {
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
  const routeContract = planBrowserAuthRouteContracts().contracts.find(
    (contract) => contract.routeId === "browser-session-issue",
  );
  assert.ok(routeContract);

  const decision = evaluateBrowserAuthActivationGate({
    routeId: "browser-session-issue",
    routeContract,
    activationConfigPolicy,
    activationPreflight,
    operatorConfirmationPresent: true,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.routeId, "browser-session-issue");
  assert.ok(decision.blockerCodes.includes("browser-auth-activation-gate-blocked"));
  assert.ok(decision.blockerCodes.includes("browser-auth-activation-gate-route-contract-inactive"));
  assert.ok(
    decision.blockerCodes.includes("browser-auth-config-activation-disabled-by-runtime-policy"),
  );
  assert.ok(decision.blockerCodes.includes("browser-auth-config-live-mounting-blocked"));
});

test("browser auth activation gate output is sanitized", () => {
  const decision = evaluateBrowserAuthActivationGate({
    routeId: "browser-pairing-complete",
    operatorConfirmationPresent: false,
  });

  assertNoSecretMaterial(decision);
  assert.ok(
    decision.blockerCodes.includes("browser-auth-activation-gate-operator-confirmation-missing"),
  );
});

test("browser auth activation gate is not imported into live server or authorization paths", async () => {
  const liveSourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/httpCredentialAdapter.ts",
  ];

  for (const file of liveSourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(source.includes("./browserAuthActivationGate.js"), false);
    assert.equal(source.includes("evaluateBrowserAuthActivationGate"), false);
  }
});
