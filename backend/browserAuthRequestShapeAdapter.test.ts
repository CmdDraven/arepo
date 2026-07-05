import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createBrowserAuthRouteHarness } from "./browserAuthRouteHarness.js";
import { planBrowserAuthActivationConfigPolicy } from "./browserAuthActivationConfigPolicy.js";
import { planBrowserAuthActivationPreflight } from "./browserAuthActivationPreflight.js";
import { planBrowserAuthRouteContracts } from "./browserAuthRouteContracts.js";
import {
  BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_MOUNTED,
  BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_WIRED_INTO_ROUTES,
  adaptBrowserAuthRequestShape,
} from "./browserAuthRequestShapeAdapter.js";

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
    assert.equal(serialized.includes(secret), false, `request-shape adapter exposed ${secret}`);
  }
}

test("request-shape adapter classifies every planned browser-auth route", () => {
  const routePlan = planBrowserAuthRouteContracts();

  assert.equal(BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_MOUNTED, false);
  assert.equal(BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_WIRED_INTO_ROUTES, false);

  for (const contract of routePlan.contracts) {
    const adapted = adaptBrowserAuthRequestShape({
      method: contract.method,
      path: `${contract.path}?ignored=1`,
      headers: {
        host: "127.0.0.1:8734",
        origin: "http://127.0.0.1:8734",
      },
      remoteAddress: "127.0.0.1",
    });

    assert.equal(adapted.status, "disabled");
    assert.equal(adapted.routeEligible, true);
    assert.equal(adapted.routeId, contract.routeId);
    assert.equal(adapted.method, contract.method);
    assert.equal(adapted.path, contract.path);
    assert.equal(adapted.harnessRequest?.routeId, contract.routeId);
    assert.equal(adapted.authenticatesRequests, false);
    assert.equal(adapted.validatesCsrfTokens, false);
    assert.equal(adapted.verifiesSessions, false);
    assert.equal(adapted.mutatesState, false);
    assert.equal(adapted.callsLifecycleCoordinator, false);
    assert.equal(adapted.bypassesActivationGate, false);
    assert.equal(adapted.locality, "localhost");
    assert.ok(adapted.reasonCodes.includes("planned-browser-auth-route"));
    assertNoSecretMaterial(adapted);
  }
});

test("request-shape adapter reduces sensitive headers to safe presence and redaction only", () => {
  const adapted = adaptBrowserAuthRequestShape({
    method: "POST",
    path: "/api/node/auth/pairing/complete",
    headers: {
      host: "localhost:8734",
      origin: "http://localhost:8734",
      referer: "http://localhost:8734/settings",
      cookie: "arepo_session=secret-cookie",
      authorization: "Bearer arepo_secret_token",
      "set-cookie": "arepo_session=secret-cookie",
      "x-csrf-token": "bcsrfsec_raw_csrf_secret",
    },
    remoteAddress: "::1",
  });

  assert.equal(adapted.cookieHeaderPresent, true);
  assert.equal(adapted.authorizationHeaderPresent, true);
  assert.equal(adapted.setCookieHeaderPresent, true);
  assert.equal(adapted.csrfHeaderPresent, true);
  assert.equal(adapted.origin, "http://localhost:8734");
  assert.equal(adapted.originClass, "present");
  assert.equal(adapted.refererOrigin, "http://localhost:8734");
  assert.equal(adapted.refererClass, "present");
  assert.equal(adapted.locality, "localhost");
  assert.deepEqual(adapted.sanitizedHeaders.redactedHeaders, {
    authorization: "[redacted]",
    cookie: "[redacted]",
    "set-cookie": "[redacted]",
    "x-csrf-token": "[redacted]",
  });
  assert.ok(adapted.reasonCodes.includes("cookie-header-ignored"));
  assert.ok(adapted.reasonCodes.includes("authorization-header-ignored"));
  assert.ok(adapted.reasonCodes.includes("set-cookie-header-rejected"));
  assert.ok(adapted.reasonCodes.includes("csrf-header-ignored"));
  assertNoSecretMaterial(adapted);
});

test("request-shape adapter safely classifies invalid origin and remote posture", () => {
  const remote = adaptBrowserAuthRequestShape({
    method: "GET",
    path: "/api/node/auth/csrf",
    headers: { host: "example.test", origin: "not a url", referer: "not a url" },
    remoteAddress: "203.0.113.10",
  });
  const localNetwork = adaptBrowserAuthRequestShape({
    method: "GET",
    path: "/api/node/auth/csrf",
    headers: { host: "192.168.1.20:8734", origin: "http://192.168.1.20:8734" },
  });

  assert.equal(remote.originClass, "invalid-or-redacted");
  assert.equal(remote.refererClass, "invalid-or-redacted");
  assert.equal(remote.locality, "non-local");
  assert.equal(localNetwork.originClass, "present");
  assert.equal(localNetwork.locality, "local-network");
  assertNoSecretMaterial(remote);
  assertNoSecretMaterial(localNetwork);
});

test("request-shape adapter marks unsupported routes without authenticating", () => {
  const adapted = adaptBrowserAuthRequestShape({
    method: "GET",
    path: "/api/node/status",
    headers: {
      cookie: "arepo_session=secret-cookie",
      authorization: "Bearer arepo_secret_token",
    },
  });

  assert.equal(adapted.routeEligible, false);
  assert.equal(adapted.routeId, undefined);
  assert.equal(adapted.harnessRequest, undefined);
  assert.equal(adapted.authenticatesRequests, false);
  assert.ok(adapted.reasonCodes.includes("unsupported-browser-auth-route"));
  assertNoSecretMaterial(adapted);
});

test("request-shape adapter plus harness remains blocked for planned routes", () => {
  const harness = createBrowserAuthRouteHarness();

  for (const contract of planBrowserAuthRouteContracts().contracts) {
    const adapted = adaptBrowserAuthRequestShape({
      method: contract.method,
      path: contract.path,
      headers: {
        cookie: "arepo_session=secret-cookie",
        authorization: "Bearer arepo_secret_token",
        "x-csrf-token": "bcsrfsec_raw_csrf_secret",
      },
    });

    assert.ok(adapted.harnessRequest);
    const result = harness.handle(adapted.harnessRequest);
    assert.equal(result.status, "inactive");
    assert.equal(result.httpStatus, 501);
    assert.equal(result.activationGate.allowed, false);
    assert.equal(result.issuedCookies, false);
    assert.equal(result.issuedPairingCode, false);
    assert.equal(result.consumedPairingCode, false);
    assert.equal(result.issuedBrowserSession, false);
    assert.equal(result.issuedCsrfToken, false);
    assert.equal(result.validatedCsrfToken, false);
    assert.equal(result.authenticatedRequest, false);
    assert.deepEqual(result.setCookieHeaders, []);
    assertNoSecretMaterial(result);
  }
});

test("activation-requested posture still cannot bypass the gate through adapter output", () => {
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
  const adapted = adaptBrowserAuthRequestShape({
    method: "POST",
    path: "/api/node/auth/session",
    headers: {
      cookie: "arepo_session=secret-cookie",
      "x-csrf-token": "bcsrfsec_raw_csrf_secret",
    },
  });
  assert.ok(adapted.harnessRequest);

  const result = createBrowserAuthRouteHarness().handle({
    ...adapted.harnessRequest,
    operatorConfirmationPresent: true,
    activationGate: {
      activationConfigPolicy,
      activationPreflight,
      operatorConfirmationPresent: true,
    },
  });

  assert.equal(result.activationGate.allowed, false);
  assert.equal(result.issuedCookies, false);
  assert.equal(result.issuedBrowserSession, false);
  assert.equal(result.issuedCsrfToken, false);
  assert.equal(result.liveAuthorizationDecision, false);
  assertNoSecretMaterial(result);
});

test("request-shape adapter is not imported into live server authorization or frontend paths", async () => {
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
    assert.equal(source.includes("./browserAuthRequestShapeAdapter.js"), false);
    assert.equal(source.includes("adaptBrowserAuthRequestShape"), false);
  }
});
