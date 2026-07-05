import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyFutureArepoCsrfRoutes,
  runIsolatedBetterAuthCsrfOwnershipProof,
  sanitizedCsrfFailureReasons,
} from "./betterAuthCsrfOwnershipProof.js";

const secretSamples = [
  "arepo-csrf-proof-password",
  "arepo_session=",
  "Authorization: Bearer",
  "Cookie:",
  "Set-Cookie:",
  "bpairsec_csrf_ownership_pairing_secret",
  "bsver_csrf_ownership_session_secret",
  "bcsrfsec_",
  "sha256:",
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

test("Better Auth CSRF ownership proof is isolated and keeps live auth inactive", async () => {
  const proof = await runIsolatedBetterAuthCsrfOwnershipProof();

  assert.equal(proof.status, "isolated-csrf-ownership-proof");
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
  assertNoSecretMaterial(proof);
});

test("Better Auth own endpoint origin behavior is exercised without claiming arbitrary route coverage", async () => {
  const proof = await runIsolatedBetterAuthCsrfOwnershipProof();

  assert.equal(proof.betterAuthEndpointProof.signOutWithoutOriginStatus, 403);
  assert.equal(proof.betterAuthEndpointProof.signOutWithoutOriginRejected, true);
  assert.equal(proof.betterAuthEndpointProof.signOutWrongOriginStatus, 403);
  assert.equal(proof.betterAuthEndpointProof.signOutWrongOriginRejected, true);
  assert.equal(proof.betterAuthEndpointProof.signOutTrustedOriginStatus, 200);
  assert.equal(proof.betterAuthEndpointProof.signOutTrustedOriginAllowed, true);
  assert.equal(
    proof.betterAuthEndpointProof.ownEndpointProtectionKind,
    "origin-and-fetch-metadata",
  );
  assert.equal(proof.betterAuthEndpointProof.rawResponsesRedacted, true);

  assert.equal(proof.arbitraryArepoRouteProof.betterAuthHandlerMountedForArepoRoutes, false);
  assert.equal(proof.arbitraryArepoRouteProof.betterAuthProtectsArbitraryArepoRoutes, false);
  assert.equal(proof.arbitraryArepoRouteProof.arepoMustOwnCsrfForUnsafeApiRoutes, true);
  assert.equal(proof.arbitraryArepoRouteProof.sameSiteAloneSufficient, false);
  assert.equal(proof.arbitraryArepoRouteProof.originRefererSupplementalOnly, true);
  assert.deepEqual(proof.arbitraryArepoRouteProof.blockerCodes, [
    "arepo-owned-csrf-required-for-unsafe-api-routes",
  ]);
});

test("CSRF ownership proof classifies unsafe and safe AREPO route categories", async () => {
  const proof = await runIsolatedBetterAuthCsrfOwnershipProof();
  const classifications = proof.routePolicy.classifications;
  const directClassifications = classifyFutureArepoCsrfRoutes();

  assert.deepEqual(classifications, directClassifications);
  assert.equal(proof.routePolicy.unsafeRoutesRequireCsrf, true);
  assert.equal(proof.routePolicy.safeReadRoutesSessionOnlyAllowed, true);
  assert.equal(proof.routePolicy.validationBeforeMutation, true);
  assert.ok(
    classifications.some(
      (route) =>
        route.method === "POST" &&
        route.category === "vault-mutation" &&
        route.futureCookieBackedRequiresCsrf &&
        route.futureRequiresOriginOrRefererCheck &&
        route.validationBeforeMutation &&
        route.reasonCode === "unsafe-cookie-backed-arepo-route-requires-arepo-csrf",
    ),
  );
  assert.ok(
    classifications.some(
      (route) =>
        route.method === "DELETE" &&
        route.category === "vault-mutation" &&
        route.futureCookieBackedRequiresCsrf,
    ),
  );
  assert.ok(
    classifications.some(
      (route) =>
        route.method === "POST" &&
        route.category === "session-mutation" &&
        route.futureCookieBackedRequiresCsrf,
    ),
  );
  assert.ok(
    classifications.some(
      (route) =>
        route.method === "GET" &&
        route.category === "safe-read" &&
        !route.futureCookieBackedRequiresCsrf &&
        route.reasonCode === "safe-method-no-csrf-token-required",
    ),
  );
});

test("CSRF ownership proof records Better Auth external CSRF limits and AREPO primitive compatibility", async () => {
  const proof = await runIsolatedBetterAuthCsrfOwnershipProof();

  assert.equal(proof.externalCsrfApiProof.supportedTokenIssueApiFound, false);
  assert.equal(proof.externalCsrfApiProof.supportedTokenVerifyApiFound, false);
  assert.deepEqual(proof.externalCsrfApiProof.exportedMiddlewareObserved, [
    "originCheckMiddleware",
    "originCheck",
    "formCsrfMiddleware",
  ]);
  assert.equal(proof.externalCsrfApiProof.usableOutsideBetterAuthEndpoints, "unproven");

  assert.equal(proof.arepoCsrfPrimitiveCompatibility.compatibleWithLikelyOwnershipModel, true);
  assert.equal(proof.arepoCsrfPrimitiveCompatibility.implementation, "in-memory-test-primitive");
  assert.equal(proof.arepoCsrfPrimitiveCompatibility.storesRawTokens, false);
  assert.equal(proof.arepoCsrfPrimitiveCompatibility.exposesHashesInDiagnostics, false);
  assert.equal(proof.arepoCsrfPrimitiveCompatibility.wiredIntoAuthorization, false);
  assert.equal(proof.arepoCsrfPrimitiveCompatibility.wiredIntoRoutes, false);
  assert.equal(proof.arepoCsrfPrimitiveCompatibility.activeTokenCount, 1);
  assertNoSecretMaterial(proof.arepoCsrfPrimitiveCompatibility);
});

test("CSRF failure outputs are sanitized and use stable reason codes", async () => {
  const proof = await runIsolatedBetterAuthCsrfOwnershipProof();
  const reasons = sanitizedCsrfFailureReasons();

  assert.deepEqual(proof.failurePolicy.sanitizedReasonCodes, reasons);
  assert.deepEqual(
    reasons.map((reason) => reason.code),
    [
      "missing-csrf-token",
      "invalid-csrf-token",
      "expired-csrf-token",
      "revoked-csrf-token",
      "untrusted-origin",
      "missing-origin",
    ],
  );
  for (const reason of reasons) {
    assert.equal(reason.status, 403);
    assert.equal(reason.auditCategory, "browser_csrf_denied");
    assert.equal(reason.sanitized, true);
  }
  assertNoSecretMaterial(reasons);
});

test("CSRF ownership findings state AREPO ownership for arbitrary unsafe API routes", async () => {
  const proof = await runIsolatedBetterAuthCsrfOwnershipProof();

  assert.equal(
    proof.findings.find((finding) => finding.id === "better-auth-own-endpoint-origin-protection")
      ?.status,
    "passed",
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "arbitrary-arepo-route-protection")?.status,
    "arepo-owned",
  );
  assert.ok(
    proof.findings
      .find((finding) => finding.id === "arbitrary-arepo-route-protection")
      ?.blockerCodes.includes("arepo-owned-csrf-required-for-unsafe-api-routes"),
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "external-csrf-token-api")?.status,
    "unsupported",
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "unsafe-route-policy")?.status,
    "arepo-owned",
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "samesite-policy")?.status,
    "passed",
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "arepo-csrf-primitives")?.status,
    "passed",
  );
});

test("Better Auth CSRF ownership proof is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./betterAuthCsrfOwnershipProof.js"),
      false,
      `${file} imports CSRF ownership proof`,
    );
    assert.equal(
      source.includes("runIsolatedBetterAuthCsrfOwnershipProof"),
      false,
      `${file} references CSRF ownership proof`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
