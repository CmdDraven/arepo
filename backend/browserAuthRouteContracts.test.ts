import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planBrowserAuthActivationPreflight } from "./browserAuthActivationPreflight.js";
import {
  BROWSER_AUTH_ROUTE_CONTRACTS_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_ROUTE_CONTRACTS_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_ROUTE_CONTRACTS_WIRED_INTO_ROUTES,
  planBrowserAuthRouteContracts,
} from "./browserAuthRouteContracts.js";

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
    assert.equal(serialized.includes(secret), false, `route contract output exposed ${secret}`);
  }
}

test("browser auth route contracts are planning-only inactive or stubbed by default", () => {
  const plan = planBrowserAuthRouteContracts();

  assert.equal(BROWSER_AUTH_ROUTE_CONTRACTS_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_ROUTE_CONTRACTS_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_ROUTE_CONTRACTS_WIRED_INTO_ROUTES, false);
  assert.equal(plan.status, "planning-only");
  assert.equal(plan.summary.totalPlannedRouteCount, 8);
  assert.equal(plan.summary.stubbedRouteCount, 6);
  assert.equal(plan.summary.plannedInactiveRouteCount, 2);
  for (const contract of plan.contracts) {
    assert.match(contract.status, /^(stubbed|planned-inactive)$/);
    assert.equal(contract.mountedLive, false);
    assert.equal(contract.networkExposureSafe, false);
    assert.ok(contract.activationBlockerCodes.includes("browser-auth-route-mounting-blocked"));
  }
});

test("no browser auth contract is live mounted or allowed to issue or accept cookies", () => {
  const plan = planBrowserAuthRouteContracts();

  assert.equal(plan.summary.mountedLiveRouteCount, 0);
  assert.equal(plan.summary.issuingCookieRouteCount, 0);
  assert.equal(plan.summary.acceptingCookieRouteCount, 0);
  for (const contract of plan.contracts) {
    assert.equal(contract.mountedLive, false);
    assert.equal(contract.issuesCookies, false);
    assert.equal(contract.acceptsCookies, false);
    assert.equal(contract.bearerTokenAuthorizationCurrent, true);
  }
});

test("unsafe future cookie-backed routes require csrf in their contracts", () => {
  const plan = planBrowserAuthRouteContracts();
  const unsafeRouteIds = [
    "browser-pairing-start",
    "browser-pairing-complete",
    "browser-session-issue",
    "browser-session-logout",
    "browser-session-revoke-current",
    "browser-session-revoke-all",
  ];

  for (const routeId of unsafeRouteIds) {
    const contract = plan.contracts.find((candidate) => candidate.routeId === routeId);
    assert.equal(contract?.futureRequiresCsrf, true, `${routeId} should require future CSRF`);
  }
});

test("pairing routes require pairing semantics and remain inactive", () => {
  const plan = planBrowserAuthRouteContracts();
  const start = plan.contracts.find((contract) => contract.routeId === "browser-pairing-start");
  const complete = plan.contracts.find(
    (contract) => contract.routeId === "browser-pairing-complete",
  );

  assert.equal(start?.status, "stubbed");
  assert.equal(start?.futureAuditCategory, "pairing_code_issue_planned");
  assert.equal(start?.futureRequiresPairingCodeVerification, false);
  assert.equal(complete?.status, "stubbed");
  assert.equal(complete?.futureAuditCategory, "pairing_code_consume_planned");
  assert.equal(complete?.futureRequiresPairingCodeVerification, true);
});

test("session csrf logout and revoke contracts require future browser-session semantics", () => {
  const plan = planBrowserAuthRouteContracts();
  const sessionRouteIds = [
    "browser-session-status",
    "browser-csrf-issue",
    "browser-session-logout",
    "browser-session-revoke-current",
    "browser-session-revoke-all",
  ];

  for (const routeId of sessionRouteIds) {
    const contract = plan.contracts.find((candidate) => candidate.routeId === routeId);
    assert.equal(
      contract?.futureRequiresBrowserSessionAuth,
      true,
      `${routeId} should require future browser-session auth`,
    );
    assert.equal(contract?.mountedLive, false);
  }
  assert.equal(
    plan.contracts.find((contract) => contract.routeId === "browser-session-logout")
      ?.futureRequiresCsrf,
    true,
  );
  assert.equal(
    plan.contracts.find((contract) => contract.routeId === "browser-session-revoke-all")
      ?.futureRequiresCsrf,
    true,
  );
});

test("route contract summary counts future security requirements", () => {
  const plan = planBrowserAuthRouteContracts();

  assert.equal(plan.summary.futureCsrfRequiredRouteCount, 6);
  assert.equal(plan.summary.futureBrowserSessionAuthRequiredRouteCount, 5);
  assert.equal(plan.summary.futurePairingCodeVerificationRouteCount, 2);
  assert.equal(plan.summary.bearerTokenAuthorizationCurrent, true);
  assert.equal(plan.summary.wiredIntoAuthorization, false);
  assert.equal(plan.summary.wiredIntoRoutes, false);
});

test("route contract output is sanitized", () => {
  const plan = planBrowserAuthRouteContracts();

  assertNoSecretMaterial(plan);
  for (const contract of plan.contracts) {
    assert.ok(
      contract.sanitizedFailureBehavior === "browser_session_auth_inactive" ||
        contract.sanitizedFailureBehavior === "not_mounted",
    );
  }
});

test("activation preflight remains blocked while route contracts are inactive or stubbed", () => {
  const routePlan = planBrowserAuthRouteContracts();
  const preflight = planBrowserAuthActivationPreflight({
    activationRequested: true,
    operatorConfirmationPresent: true,
    sessionRoutes:
      routePlan.summary.mountedLiveRouteCount === routePlan.summary.totalPlannedRouteCount
        ? "mounted"
        : "stubbed",
    pairingRoutes: "stubbed",
    csrfEndpoint: "stubbed",
  });

  assert.equal(preflight.status, "blocked");
  assert.ok(preflight.blockerCodes.includes("browser-auth-session-routes-stubbed"));
  assert.ok(preflight.blockerCodes.includes("browser-auth-pairing-routes-stubbed"));
  assert.ok(preflight.blockerCodes.includes("browser-auth-csrf-endpoint-stubbed"));
});

test("route contract planner is not imported into live server or authorization paths", async () => {
  const liveSourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/httpCredentialAdapter.ts",
  ];

  for (const file of liveSourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(source.includes("./browserAuthRouteContracts.js"), false);
    assert.equal(source.includes("planBrowserAuthRouteContracts"), false);
  }
});
