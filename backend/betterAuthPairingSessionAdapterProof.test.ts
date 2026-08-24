import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import {
  BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_LIVE_BROWSER_AUTH_ENABLED,
  BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_MOUNTED,
  BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_WIRED_INTO_AUTHORIZATION,
  BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_WIRED_INTO_ROUTES,
  runIsolatedBetterAuthPairingSessionAdapterProof,
} from "./betterAuthPairingSessionAdapterProof.js";

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_secret",
  "arepo-pairing-subject@example.invalid",
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `pairing-session proof exposed ${secret}`);
  }
}

test("Better Auth pairing-session adapter proof remains isolated and inactive", async (t) => {
  const proof = await runIsolatedBetterAuthPairingSessionAdapterProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_LIVE_BROWSER_AUTH_ENABLED, false);
  assert.equal(BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_MOUNTED, false);
  assert.equal(BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_WIRED_INTO_ROUTES, false);
  assert.equal(proof.status, "isolated-pairing-session-adapter-proof");
  assert.equal(proof.packageName, "better-auth");
  assert.equal(proof.liveBrowserAuthEnabled, false);
  assert.equal(proof.mountedInServer, false);
  assert.equal(proof.wiredIntoAuthorization, false);
  assert.equal(proof.wiredIntoRoutes, false);
  assert.equal(proof.emitsLiveSetCookieHeaders, false);
  assert.equal(proof.acceptsCookieCredentialsInLiveAuth, false);
  assert.equal(proof.changesBearerTokenProtectedMode, false);
  assertNoSecretMaterial(proof);
});

test("Better Auth pairing-session adapter proof maps accepted pairing to internal session creation", async (t) => {
  const proof = await runIsolatedBetterAuthPairingSessionAdapterProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.pairingProof.arepoBearerProtectedOperatorAlreadyAuthenticated, true);
  assert.equal(proof.pairingProof.arepoPairingCompletionAccepted, true);
  assert.equal(proof.pairingProof.usernamePasswordEnabled, false);
  assert.equal(proof.pairingProof.oauthEnabled, false);
  assert.equal(proof.pairingProof.socialLoginEnabled, false);
  assert.equal(proof.pairingProof.frontendSecretStorageRequired, false);
  assert.equal(proof.sessionProof.subjectKind, "arepo-local-operator");
  assert.equal(proof.sessionProof.betterAuthUserCreatedForSubject, true);
  assert.equal(proof.sessionProof.betterAuthSessionCreatedAfterPairing, true);
  assert.equal(proof.sessionProof.sessionLookupWorked, true);
  assert.equal(proof.sessionProof.sanitizedDeviceHintStoredInUserAgent, true);
  assert.equal(proof.sessionProof.arbitraryVaultScopeMetadataSupported, false);
  assert.equal(proof.sessionProof.arbitraryVaultScopeMetadataStatus, "needs-schema-extension");
  assert.equal(
    proof.findings.find((finding) => finding.id === "pairing-to-session")?.status,
    "passed",
  );
  assert.equal(
    proof.findings.find((finding) => finding.id === "metadata")?.status,
    "needs-schema-extension",
  );
});

test("Better Auth pairing-session adapter proof records cookie CSRF and public API blockers", async (t) => {
  const proof = await runIsolatedBetterAuthPairingSessionAdapterProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.sessionProof.signedCookieIssuedFromPairingPath, false);
  assert.equal(proof.sessionProof.signedCookieIssuanceStatus, "needs-cookie-adapter-spike");
  assert.equal(proof.sessionProof.logoutClearingCookieCount > 0, true);
  assert.equal(
    proof.sessionProof.logoutClearingCookies.every((cookie) => cookie.valueRedacted),
    true,
  );
  assert.equal(proof.sessionProof.directRawTokenInjectionAuthenticates, false);
  assert.equal(proof.csrfProof.coveredForArepoUnsafeApiRoutes, "unknown");
  assert.deepEqual(proof.csrfProof.blockerCodes, ["csrf-ownership-unresolved"]);
  assert.ok(
    proof.findings
      .find((finding) => finding.id === "cookie-issuance")
      ?.blockerCodes.includes("signed-cookie-issuance-from-pairing-unproven"),
  );
  assert.ok(
    proof.findings
      .find((finding) => finding.id === "csrf-ownership")
      ?.blockerCodes.includes("csrf-ownership-unresolved"),
  );
  assertNoSecretMaterial(proof.sessionProof.logoutClearingCookies);
});

test("Better Auth pairing-session adapter proof exercises revoke current revoke all and expiry config", async (t) => {
  const proof = await runIsolatedBetterAuthPairingSessionAdapterProof(
    await makeTestTempDir(t, "arepo-ba-"),
  );

  assert.equal(proof.sessionProof.revokeCurrentWorked, true);
  assert.equal(proof.sessionProof.revokeAllForSubjectWorked, true);
  assert.equal(proof.sessionProof.expirySeconds, 60 * 30);
  assert.equal(proof.findings.find((finding) => finding.id === "revoke-current")?.status, "passed");
  assert.equal(proof.findings.find((finding) => finding.id === "revoke-all")?.status, "passed");
  assert.equal(proof.findings.find((finding) => finding.id === "expiry")?.status, "passed");
  assert.equal(
    proof.findings.find((finding) => finding.id === "direct-token-injection")?.status,
    "passed",
  );
});

test("Better Auth pairing-session adapter proof is isolated from live server authorization and frontend paths", async (t) => {
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
    assert.equal(source.includes("./betterAuthPairingSessionAdapterProof.js"), false);
    assert.equal(source.includes("runIsolatedBetterAuthPairingSessionAdapterProof"), false);
    assert.equal(source.includes("better-auth"), false);
  }
});
