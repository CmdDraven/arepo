import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import {
  adaptBetterAuthRouteRequest,
  runIsolatedBetterAuthRouteRequestAdapterProof,
  wrapBetterAuthResponse,
} from "./betterAuthRouteRequestAdapterProof.js";

const secretSamples = [
  "arepo-route-adapter-proof-password",
  "arepo_session=",
  "Authorization: Bearer",
  "Cookie:",
  "Set-Cookie:",
  "bpairsec_route_adapter_pairing_secret",
  "bsver_route_adapter_session_secret",
  "bcsrfsec_route_adapter_csrf_secret",
  "sha256:route-adapter-hash",
  "verifierHash",
  "tokenHash",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `proof exposed ${secret}`);
  }
}

test("routeRequest-style input converts to standard Request shape", async (t) => {
  const adapted = adaptBetterAuthRouteRequest({
    method: "POST",
    path: "/api/auth/sign-in/email",
    query: { mode: "proof" },
    headers: { origin: "http://127.0.0.1:8734" },
    body: { ok: true },
  });

  const url = new URL(adapted.request.url);
  assert.equal(adapted.request.method, "POST");
  assert.equal(url.pathname, "/api/auth/sign-in/email");
  assert.equal(url.searchParams.get("mode"), "proof");
  assert.equal(adapted.request.headers.get("origin"), "http://127.0.0.1:8734");
  assert.equal(adapted.request.headers.get("content-type"), "application/json");
  assert.equal(await adapted.request.text(), JSON.stringify({ ok: true }));
  assert.deepEqual(adapted.converted, {
    methodRepresented: true,
    pathRepresented: true,
    queryRepresented: true,
    headersRepresented: true,
    bodyRepresented: true,
  });
});

test("Better Auth routeRequest adapter proof observes signed cookie issuance and clearing with redaction", async (t) => {
  const proof = await runIsolatedBetterAuthRouteRequestAdapterProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.status, "isolated-route-request-adapter-proof");
  assert.equal(proof.packageName, "better-auth");
  assert.equal(proof.liveBrowserAuthEnabled, false);
  assert.equal(proof.mountedInServer, false);
  assert.equal(proof.wiredIntoAuthorization, false);
  assert.equal(proof.wiredIntoRoutes, false);
  assert.equal(proof.emitsLiveSetCookieHeaders, false);
  assert.equal(proof.acceptsCookieCredentialsInLiveAuth, false);
  assert.equal(proof.parsesCookiesForLiveAuthorization, false);
  assert.equal(proof.validatesCsrfInLiveAuthorization, false);
  assert.equal(proof.changesBearerTokenProtectedMode, false);

  assert.equal(proof.adapterProof.routeRequestInputConverted, true);
  assert.equal(proof.adapterProof.methodPathQueryHeadersBodyRepresented, true);
  assert.equal(proof.adapterProof.responseCapturedWithoutExpress, true);
  assert.equal(proof.adapterProof.responseWrappedWithRedaction, true);
  assert.equal(proof.adapterProof.adapterCouldFitBehindActivationGate, true);
  assert.equal(proof.adapterProof.requiresDifferentStore, false);

  assert.equal(proof.cookieProof.signedCookieIssuanceObservedThroughHandler, true);
  assert.equal(proof.cookieProof.signedCookieIssuanceRoute, "sign-up-email");
  assert.equal(proof.cookieProof.pairingPathCookieIssuance, "unresolved");
  assert.equal(proof.cookieProof.cookieClearingObservedThroughHandler, true);
  assert.equal(proof.cookieProof.issuanceCookies[0]?.name, "arepo_session");
  assert.equal(proof.cookieProof.issuanceCookies[0]?.classification, "issuance");
  assert.equal(proof.cookieProof.issuanceCookies[0]?.path, "/api");
  assert.equal(proof.cookieProof.issuanceCookies[0]?.sameSite, "Lax");
  assert.equal(proof.cookieProof.issuanceCookies[0]?.httpOnly, true);
  assert.equal(proof.cookieProof.issuanceCookies[0]?.maxAgePresent, true);
  assert.equal(proof.cookieProof.issuanceCookies[0]?.valueRedacted, true);
  assert.ok(
    proof.cookieProof.clearingCookies.some(
      (cookie) => cookie.name === "arepo_session" && cookie.classification === "clearing",
    ),
  );

  assertNoSecretMaterial(proof);
});

test("Better Auth routeRequest adapter proof exercises session lookup revoke and raw-token rejection", async (t) => {
  const proof = await runIsolatedBetterAuthRouteRequestAdapterProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.sessionProof.sessionLookupThroughAcceptedCookieWorked, true);
  assert.equal(proof.sessionProof.revokeCurrentInvalidatedCookieSession, true);
  assert.equal(proof.sessionProof.directRawTokenCookieInjectionAuthenticates, false);
  assert.equal(proof.sessionProof.deterministicExpiryThroughAdapter, "unresolved");
  assert.equal(proof.csrfProof.coveredForArepoUnsafeApiRoutes, "unknown");
  assert.deepEqual(proof.csrfProof.blockerCodes, ["csrf-ownership-unresolved"]);

  assert.equal(proof.wrappedResponses.signUp.status, 200);
  assert.equal(proof.wrappedResponses.signUp.body.tokenFieldPresent, true);
  assert.equal(proof.wrappedResponses.signUp.body.tokenFieldRedacted, true);
  assert.equal(proof.wrappedResponses.signUp.body.rawBodyRedacted, true);
  assert.equal(proof.wrappedResponses.getSession.body.sessionPresent, true);
  assert.equal(proof.wrappedResponses.signOut.body.success, true);
  assert.equal(proof.wrappedResponses.getSessionAfterRevoke.body.sessionPresent, null);
  assert.equal(proof.wrappedResponses.directRawTokenInjection.body.sessionPresent, null);

  assert.equal(
    proof.findings.find((finding) => finding.id === "route-request-conversion")?.status,
    "passed",
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "response-wrapping")?.status,
    "passed",
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "handler-without-express")?.status,
    "passed",
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "signed-cookie-issuance")?.status,
    "needs-policy-review",
  );
  assert.ok(
    proof.findings
      .find((finding) => finding.id === "signed-cookie-issuance")
      ?.blockerCodes.includes("pairing-cookie-issuance-path-unproven"),
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "deterministic-expiry")?.status,
    "unknown",
  );
  assert.ok(
    proof.findings
      .find((finding) => finding.id === "deterministic-expiry")
      ?.blockerCodes.includes("deterministic-expiry-adapter-proof-needed"),
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "csrf-ownership")?.status,
    "unknown",
  );
  assertNoSecretMaterial(proof);
});

test("response wrapper redacts set-cookie values and raw response bodies", () => {
  const response = new Response(JSON.stringify({ token: "raw-secret-token", success: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie":
        "arepo_session=raw-cookie-value; Max-Age=1800; Path=/api; HttpOnly; SameSite=Lax",
    },
  });
  const wrapped = wrapBetterAuthResponse(response, {
    token: "raw-secret-token",
    success: true,
  });

  assert.equal(wrapped.status, 200);
  assert.equal(wrapped.setCookieCount, 1);
  assert.equal(wrapped.setCookies[0]?.name, "arepo_session");
  assert.equal(wrapped.setCookies[0]?.valueRedacted, true);
  assert.equal(wrapped.headers.setCookieValuesRedacted, true);
  assert.equal(wrapped.headers.cookieHeaderEchoed, false);
  assert.equal(wrapped.headers.authorizationHeaderEchoed, false);
  assert.equal(wrapped.body.tokenFieldPresent, true);
  assert.equal(wrapped.body.tokenFieldRedacted, true);
  assert.equal(wrapped.body.rawBodyRedacted, true);
  assert.equal(JSON.stringify(wrapped).includes("raw-cookie-value"), false);
  assert.equal(JSON.stringify(wrapped).includes("raw-secret-token"), false);
});

test("Better Auth routeRequest adapter proof is isolated from live server authorization and frontend paths", async (t) => {
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
    assert.equal(
      source.includes("./betterAuthRouteRequestAdapterProof.js"),
      false,
      `${file} imports routeRequest adapter proof`,
    );
    assert.equal(
      source.includes("runIsolatedBetterAuthRouteRequestAdapterProof"),
      false,
      `${file} references routeRequest adapter proof`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
