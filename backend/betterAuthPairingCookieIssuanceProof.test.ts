import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { runIsolatedBetterAuthPairingCookieIssuanceProof } from "./betterAuthPairingCookieIssuanceProof.js";

const secretSamples = [
  "arepo_session=",
  "Authorization: Bearer",
  "Cookie:",
  "Set-Cookie:",
  "bpairsec_pairing_cookie_secret",
  "bsver_pairing_cookie_session_secret",
  "bcsrfsec_pairing_cookie_csrf_secret",
  "better-auth-secret",
  "session.token=secret",
  "sha256:",
  "verifierHash",
  "tokenHash",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `pairing cookie proof exposed ${secret}`);
  }
}

test("Better Auth pairing-cookie proof stays isolated and inactive", async (t) => {
  const proof = await runIsolatedBetterAuthPairingCookieIssuanceProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.status, "isolated-pairing-cookie-issuance-proof");
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

test("Better Auth pairing-cookie proof does not require normal login surfaces", async (t) => {
  const proof = await runIsolatedBetterAuthPairingCookieIssuanceProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.pairingProof.arepoBearerProtectedOperatorAlreadyAuthenticated, true);
  assert.equal(proof.pairingProof.arepoPairingCompletionAccepted, true);
  assert.equal(proof.pairingProof.usernamePasswordEnabled, false);
  assert.equal(proof.pairingProof.oauthEnabled, false);
  assert.equal(proof.pairingProof.socialLoginEnabled, false);
  assert.equal(proof.pairingProof.emailLoginRequired, false);
  assert.equal(proof.pairingProof.frontendSecretStorageRequired, false);
  assert.equal(proof.pairingProof.loginUiRequired, false);
});

test("Better Auth pairing-cookie proof records internal versus supported API boundary", async (t) => {
  const proof = await runIsolatedBetterAuthPairingCookieIssuanceProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.boundaryProof.betterAuthUserRecordRequired, true);
  assert.equal(proof.boundaryProof.betterAuthAccountRecordRequired, false);
  assert.equal(proof.boundaryProof.betterAuthInternalAdapterUsed, true);
  assert.equal(proof.boundaryProof.betterAuthPublicSessionApiProven, false);
  assert.equal(proof.boundaryProof.publicSetCookieResponseBoundaryProven, false);
  assert.equal(proof.boundaryProof.publicCryptoPrimitiveUsedForTestCookie, true);
  assert.equal(proof.boundaryProof.productionActivationBlockedOnSupportedBoundary, true);
  assert.ok(proof.remainingBlockers.includes("supported-pairing-cookie-response-boundary-needed"));
});

test("Better Auth pairing-cookie proof signs only redacted pairing-cookie metadata", async (t) => {
  const proof = await runIsolatedBetterAuthPairingCookieIssuanceProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.cookieProof.signedCookieProducedFromPairingSession, true);
  assert.equal(proof.cookieProof.signedCookieObservedOnlyAsRedactedMetadata, true);
  assert.equal(proof.cookieProof.signedCookieMetadata.name, "arepo_session");
  assert.equal(proof.cookieProof.signedCookieMetadata.classification, "issuance");
  assert.equal(proof.cookieProof.signedCookieMetadata.deliveryBoundary, "test-only-cookie-header");
  assert.equal(proof.cookieProof.signedCookieMetadata.path, "/api");
  assert.equal(proof.cookieProof.signedCookieMetadata.httpOnly, true);
  assert.equal(proof.cookieProof.signedCookieMetadata.valueRedacted, true);
  assert.equal(proof.cookieProof.signedCookieCanLookupSession, true);
  assert.equal(proof.wrappedResponses.pairingCookieLookup.body.sessionPresent, true);
});

test("Better Auth pairing-cookie proof rejects direct raw token injection", async (t) => {
  const proof = await runIsolatedBetterAuthPairingCookieIssuanceProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.cookieProof.directRawTokenCookieInjectionAuthenticates, false);
  assert.equal(proof.wrappedResponses.directRawTokenInjection.body.sessionPresent, null);
});

test("Better Auth pairing-cookie proof signs out and expires pairing-issued sessions", async (t) => {
  const proof = await runIsolatedBetterAuthPairingCookieIssuanceProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.revokeProof.signOutInvalidatesPairingCookieSession, true);
  assert.equal(proof.revokeProof.signOutCookieClearingObserved, true);
  assert.ok(
    proof.revokeProof.clearingCookieMetadata.some(
      (cookie) =>
        cookie.name === "arepo_session" &&
        cookie.classification === "clearing" &&
        cookie.valueRedacted === true,
    ),
  );
  assert.equal(proof.wrappedResponses.afterSignOut.body.sessionPresent, null);

  assert.equal(proof.expiryProof.expiryAppliesToPairingCookieSession, true);
  assert.equal(proof.expiryProof.expiredPairingCookieSessionRejected, true);
  assert.equal(proof.expiryProof.expiredLookupClearingCookieObserved, true);
  assert.equal(proof.wrappedResponses.afterExpiry.body.sessionPresent, null);
});

test("Better Auth pairing-cookie proof records subject and metadata limits", async (t) => {
  const proof = await runIsolatedBetterAuthPairingCookieIssuanceProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.sessionProof.subjectKind, "arepo-local-operator");
  assert.equal(proof.sessionProof.betterAuthUserCreatedForSubject, true);
  assert.equal(proof.sessionProof.betterAuthSessionCreatedAfterPairing, true);
  assert.equal(proof.sessionProof.sanitizedDeviceHintStoredInUserAgent, true);
  assert.equal(proof.sessionProof.localOperatorSubjectRepresentedSafely, true);
  assert.equal(proof.sessionProof.arbitraryVaultScopeMetadataSupported, false);
  assert.equal(proof.sessionProof.arbitraryVaultScopeMetadataStatus, "needs-schema-extension");
  assert.ok(proof.remainingBlockers.includes("session-scope-metadata-design-needed"));
});

test("Better Auth pairing-cookie proof findings are explicit", async (t) => {
  const proof = await runIsolatedBetterAuthPairingCookieIssuanceProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );
  const findings = new Map(proof.findings.map((finding) => [finding.id, finding]));

  assert.equal(findings.get("pairing-to-session")?.status, "proven-through-internal-adapter");
  assert.ok(
    findings
      .get("pairing-to-session")
      ?.blockerCodes.includes("supported-pairing-session-api-needed"),
  );
  assert.equal(findings.get("signed-cookie-production")?.status, "proven-through-internal-adapter");
  assert.ok(
    findings
      .get("signed-cookie-production")
      ?.blockerCodes.includes("supported-pairing-cookie-response-boundary-needed"),
  );
  assert.equal(findings.get("supported-api-boundary")?.status, "blocked-for-production");
  assert.equal(findings.get("session-lookup")?.status, "passed");
  assert.equal(findings.get("direct-token-injection")?.status, "passed");
  assert.equal(findings.get("sign-out-revoke")?.status, "passed");
  assert.equal(findings.get("expiry")?.status, "passed");
  assert.equal(findings.get("no-login-ux")?.status, "passed");
  assert.equal(findings.get("subject-schema")?.status, "needs-schema-extension");
  assert.equal(findings.get("metadata-scope")?.status, "needs-schema-extension");
  assert.equal(findings.get("not-live-authorization")?.status, "passed");
});

test("Better Auth pairing-cookie proof is isolated from live server authorization and frontend paths", async (t) => {
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
      source.includes("./betterAuthPairingCookieIssuanceProof.js"),
      false,
      `${file} imports pairing-cookie proof`,
    );
    assert.equal(
      source.includes("runIsolatedBetterAuthPairingCookieIssuanceProof"),
      false,
      `${file} references pairing-cookie proof`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
