import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planBrowserSecurity } from "./browserSecurityPolicy.js";
import { PROTECTED_ROUTE_POLICIES, type ProtectedRoutePolicy } from "./routePermissions.js";

function policyFor(route: string): ProtectedRoutePolicy {
  const policy = PROTECTED_ROUTE_POLICIES.find(
    (item) => `${item.method} ${item.routePattern}` === route,
  );
  assert.ok(policy, `Missing route policy for ${route}`);
  return policy;
}

test("reduced anonymous health and status can be planned without session only as reduced responses", () => {
  for (const route of ["GET /api/health", "GET /api/node/status"]) {
    const plan = planBrowserSecurity({
      client: "anonymous",
      routePolicy: policyFor(route),
      reducedAnonymousRequested: true,
    });
    assert.equal(plan.requestClass, "reducedAnonymousStatus");
    assert.equal(plan.authenticationRequired, false);
    assert.equal(plan.authorizationRequired, false);
    assert.equal(plan.reducedAnonymousResponseAllowed, true);
  }
});

test("full node diagnostics require auth and authorization", () => {
  const plan = planBrowserSecurity({
    client: "anonymous",
    routePolicy: policyFor("GET /api/node/status"),
  });
  assert.equal(plan.requestClass, "safeReadMetadata");
  assert.equal(plan.authenticationRequired, true);
  assert.equal(plan.authorizationRequired, true);
  assert.ok(plan.failureReasons.includes("missing-credential"));
});

test("directory browsing is an authenticated authorized metadata read", () => {
  const plan = planBrowserSecurity({
    client: "cliApiHeaderToken",
    routePolicy: policyFor("GET /api/node/directories"),
    credentialPresent: true,
    authorizationSatisfied: true,
  });
  assert.equal(plan.requestClass, "safeReadMetadata");
  assert.equal(plan.authenticationRequired, true);
  assert.equal(plan.authorizationRequired, true);
  assert.equal(plan.csrfCheckRequired, false);
});

test("cookie-session source mutation requires origin and CSRF", () => {
  const plan = planBrowserSecurity({
    client: "browserCookieSession",
    routePolicy: policyFor("POST /api/vaults/:vaultId/file"),
    origin: "http://localhost:8733",
    allowedOrigins: ["http://localhost:8733"],
    sessionState: "valid",
    csrfTokenPresent: true,
  });
  assert.equal(plan.requestClass, "sourceMutation");
  assert.equal(plan.originCheckRequired, true);
  assert.equal(plan.csrfCheckRequired, true);
});

test("relationship promotion receives the same browser protections as other source mutations", () => {
  const plan = planBrowserSecurity({
    client: "browserCookieSession",
    routePolicy: policyFor("POST /api/vaults/:vaultId/relationships/promote"),
    origin: "http://localhost:8733",
    allowedOrigins: ["http://localhost:8733"],
    sessionState: "valid",
    csrfTokenPresent: true,
  });
  assert.equal(plan.requestClass, "sourceMutation");
  assert.equal(plan.originCheckRequired, true);
  assert.equal(plan.csrfCheckRequired, true);
  assert.equal(plan.authorizationRequired, true);
});

test("cookie-session delete requires origin CSRF authorization and stronger confirmation", () => {
  const plan = planBrowserSecurity({
    client: "browserCookieSession",
    routePolicy: policyFor("DELETE /api/vaults/:vaultId/file?path=..."),
    origin: "http://localhost:8733",
    allowedOrigins: ["http://localhost:8733"],
    sessionState: "valid",
    csrfTokenPresent: true,
  });
  assert.equal(plan.requestClass, "delete");
  assert.equal(plan.originCheckRequired, true);
  assert.equal(plan.csrfCheckRequired, true);
  assert.equal(plan.authorizationRequired, true);
  assert.equal(plan.strongerConfirmationRequired, true);
  assert.deepEqual(plan.requiredConfirmation, ["delete"]);
});

test("cookie-session safe metadata GET requires auth and origin policy but not CSRF", () => {
  const plan = planBrowserSecurity({
    client: "browserCookieSession",
    routePolicy: policyFor("GET /api/vaults/:vaultId/index"),
    origin: "http://localhost:8733",
    allowedOrigins: ["http://localhost:8733"],
    sessionState: "valid",
  });
  assert.equal(plan.requestClass, "safeReadMetadata");
  assert.equal(plan.authenticationRequired, true);
  assert.equal(plan.originCheckRequired, true);
  assert.equal(plan.csrfCheckRequired, false);
});

test("cookie-session source-content GET requires auth origin policy and no CSRF", () => {
  const plan = planBrowserSecurity({
    client: "browserCookieSession",
    routePolicy: policyFor("GET /api/vaults/:vaultId/file?path=..."),
    origin: "http://localhost:8733",
    allowedOrigins: ["http://localhost:8733"],
    sessionState: "valid",
  });
  assert.equal(plan.requestClass, "sourceContentRead");
  assert.equal(plan.authenticationRequired, true);
  assert.equal(plan.authorizationRequired, true);
  assert.equal(plan.originCheckRequired, true);
  assert.equal(plan.csrfCheckRequired, false);
});

test("CLI API header token requests require auth and authorization but not CSRF", () => {
  const plan = planBrowserSecurity({
    client: "cliApiHeaderToken",
    routePolicy: policyFor("POST /api/vaults/:vaultId/file"),
    credentialPresent: true,
  });
  assert.equal(plan.authenticationRequired, true);
  assert.equal(plan.authorizationRequired, true);
  assert.equal(plan.originCheckRequired, false);
  assert.equal(plan.csrfCheckRequired, false);
});

test("browser header-token requests still plan origin policy", () => {
  const plan = planBrowserSecurity({
    client: "browserHeaderToken",
    routePolicy: policyFor("GET /api/vaults/:vaultId/index"),
    origin: "http://localhost:8733",
    allowedOrigins: ["http://localhost:8733"],
    credentialPresent: true,
  });
  assert.equal(plan.originCheckRequired, true);
  assert.equal(plan.csrfCheckRequired, false);
});

test("auth management and vault management require CSRF and stronger confirmation for cookie sessions", () => {
  for (const requestClass of ["authManagement", "vaultManagement"] as const) {
    const plan = planBrowserSecurity({
      client: "browserCookieSession",
      requestClass,
      origin: "http://localhost:8733",
      allowedOrigins: ["http://localhost:8733"],
      sessionState: "valid",
      csrfTokenPresent: true,
    });
    assert.equal(plan.csrfCheckRequired, true);
    assert.equal(plan.strongerConfirmationRequired, true);
  }
});

test("browser session and pairing stubs classify as auth management capability routes", () => {
  for (const route of [
    "POST /api/node/auth/session",
    "POST /api/node/auth/session/logout",
    "POST /api/node/auth/session/revoke-all",
    "GET /api/node/auth/csrf",
    "POST /api/node/auth/pairing/start",
    "POST /api/node/auth/pairing/complete",
  ]) {
    const plan = planBrowserSecurity({
      client: "browserCookieSession",
      routePolicy: policyFor(route),
      origin: "http://localhost:8733",
      allowedOrigins: ["http://localhost:8733"],
      sessionState: "valid",
      csrfTokenPresent: true,
    });
    assert.equal(plan.requestClass, "authManagement");
    assert.equal(plan.csrfCheckRequired, true);
    assert.equal(plan.reducedAnonymousResponseAllowed, false);
  }
});

test("preflight OPTIONS is not authorization", () => {
  const plan = planBrowserSecurity({
    client: "anonymous",
    routePolicy: policyFor("OPTIONS *"),
  });
  assert.equal(plan.requestClass, "preflight");
  assert.equal(plan.authenticationRequired, false);
  assert.equal(plan.authorizationRequired, false);
  assert.equal(plan.preflightIsAuthorization, false);
});

test("missing or untrusted origin produces planned rejection reasons for cookie-sensitive operations", () => {
  const missing = planBrowserSecurity({
    client: "browserCookieSession",
    routePolicy: policyFor("PUT /api/vaults/:vaultId/file?path=..."),
    sessionState: "valid",
    csrfTokenPresent: true,
  });
  assert.ok(missing.failureReasons.includes("missing-origin"));

  const untrusted = planBrowserSecurity({
    client: "browserCookieSession",
    routePolicy: policyFor("PUT /api/vaults/:vaultId/file?path=..."),
    origin: "https://example.com",
    allowedOrigins: ["http://localhost:8733"],
    sessionState: "valid",
    csrfTokenPresent: true,
  });
  assert.ok(untrusted.failureReasons.includes("untrusted-origin"));
});

test("policy can plan session and disabled-auth failure reasons", () => {
  const plan = planBrowserSecurity({
    client: "browserCookieSession",
    routePolicy: policyFor("GET /api/vaults/:vaultId/index"),
    origin: "http://localhost:8733",
    allowedOrigins: ["http://localhost:8733"],
    sessionState: "revoked",
    nonLocalBindWithDisabledAuth: true,
  });
  assert.ok(plan.failureReasons.includes("revoked-session"));
  assert.ok(plan.failureReasons.includes("disabled-auth-with-non-local-bind"));
});

test("browser security helpers never claim network exposure is safe", () => {
  const plan = planBrowserSecurity({
    client: "cliApiHeaderToken",
    routePolicy: policyFor("GET /api/vaults/:vaultId/index"),
    credentialPresent: true,
  });
  assert.equal(plan.networkExposureSafe, false);
});

test("request handling does not import browser security policy helpers", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("browserSecurityPolicy"), false);
});
