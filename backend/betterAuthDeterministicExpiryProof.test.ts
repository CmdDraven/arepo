import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runIsolatedBetterAuthDeterministicExpiryProof } from "./betterAuthDeterministicExpiryProof.js";

const secretSamples = [
  "arepo-expiry-proof-password",
  "arepo-expiry-signout-control-password",
  "arepo_session=",
  "Authorization: Bearer",
  "Cookie:",
  "Set-Cookie:",
  "bpairsec_expiry_pairing_secret",
  "bsver_expiry_session_secret",
  "bcsrfsec_expiry_csrf_secret",
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
    assert.equal(serialized.includes(secret), false, `expiry proof exposed ${secret}`);
  }
}

test("Better Auth deterministic expiry proof stays isolated and inactive", async () => {
  const proof = await runIsolatedBetterAuthDeterministicExpiryProof();

  assert.equal(proof.status, "isolated-deterministic-expiry-proof");
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

test("Better Auth deterministic expiry proof records bounded lifetime and no slow waits", async () => {
  const proof = await runIsolatedBetterAuthDeterministicExpiryProof();

  assert.equal(proof.expiryConfig.boundedSessionLifetimeConfigured, true);
  assert.equal(proof.expiryConfig.expirySeconds, 60 * 30);
  assert.equal(proof.expiryConfig.refreshUpdateAgeSeconds, 60 * 5);
  assert.equal(proof.expiryConfig.sessionRenewalMayExtendExpiry, true);
  assert.equal(proof.expiryConfig.disableRefreshUsedForProofLookups, true);
  assert.equal(proof.proofMethod.slowRealTimeWaitUsed, false);
  assert.equal(proof.proofMethod.clockInjectionSupported, false);
  assert.equal(proof.proofMethod.databaseTimestampManipulationUsed, false);
  assert.equal(proof.proofMethod.internalAdapterExpiryOverrideUsed, true);
  assert.equal(proof.proofMethod.requestResponseBoundaryChecked, true);
  assert.equal(proof.proofMethod.appDataBoundaryChecked, true);
});

test("Better Auth deterministic expiry proof covers app-data session expiry filtering", async () => {
  const proof = await runIsolatedBetterAuthDeterministicExpiryProof();

  assert.equal(proof.appDataBoundary.expiryMetadataPresent, true);
  assert.equal(proof.appDataBoundary.expiredSessionExcludedFromActiveLookup, true);
  assert.equal(proof.appDataBoundary.expiredSessionFindSessionStillReturnsRecord, true);
  assert.equal(proof.appDataBoundary.safeExpiryClassification, "expired");
});

test("Better Auth deterministic expiry proof covers signed-cookie get-session rejection", async () => {
  const proof = await runIsolatedBetterAuthDeterministicExpiryProof();

  assert.equal(proof.requestResponseBoundary.signedCookieIssued, true);
  assert.equal(proof.requestResponseBoundary.sessionLookupBeforeExpiryWorked, true);
  assert.equal(proof.requestResponseBoundary.expiredSignedCookieSessionRejected, true);
  assert.equal(proof.requestResponseBoundary.expiredLookupReturnedNull, true);
  assert.equal(proof.requestResponseBoundary.expiredLookupClearingCookieObserved, true);
  assert.equal(proof.requestResponseBoundary.cookieMetadata.valueRedacted, true);
  assert.ok(
    proof.requestResponseBoundary.cookieMetadata.issued.some(
      (cookie) =>
        cookie.name === "arepo_session" &&
        cookie.classification === "issuance" &&
        cookie.valueRedacted === true,
    ),
  );
  assert.ok(
    proof.requestResponseBoundary.cookieMetadata.expiredClearing.some(
      (cookie) =>
        cookie.name === "arepo_session" &&
        cookie.classification === "clearing" &&
        cookie.valueRedacted === true,
    ),
  );
  assert.equal(proof.wrappedResponses.getSessionBeforeExpiry.body.sessionPresent, true);
  assert.equal(proof.wrappedResponses.getSessionAfterExpiry.body.sessionPresent, null);
});

test("Better Auth deterministic expiry proof keeps logout revoke behavior distinct", async () => {
  const proof = await runIsolatedBetterAuthDeterministicExpiryProof();

  assert.equal(proof.revokeBoundary.signOutStillClearsCookie, true);
  assert.equal(proof.revokeBoundary.signOutDistinctFromExpiry, true);
  assert.equal(proof.wrappedResponses.signOutControl.body.success, true);
});

test("Better Auth deterministic expiry proof records cleanup and backup restore policy", async () => {
  const proof = await runIsolatedBetterAuthDeterministicExpiryProof();

  assert.equal(proof.cleanupPolicy.betterAuthDeletesExpiredSessionOnGetSession, true);
  assert.equal(proof.cleanupPolicy.explicitPruningStillRecommended, true);
  assert.equal(proof.cleanupPolicy.backupRestoreCanRestoreUnexpiredSessions, true);
  assert.equal(proof.cleanupPolicy.restoredExpiredSessionsShouldStillFailLookup, true);
  assert.equal(proof.posture.localhostOnly, "expiry-proof-compatible");
  assert.equal(proof.posture.futureSelfHost, "requires-current-auth-db-and-backup-restore-policy");
});

test("Better Auth deterministic expiry proof findings are explicit", async () => {
  const proof = await runIsolatedBetterAuthDeterministicExpiryProof();
  const findings = new Map(proof.findings.map((finding) => [finding.id, finding]));

  assert.equal(findings.get("bounded-session-lifetime-configured")?.status, "passed");
  assert.equal(findings.get("expiry-metadata-inspection")?.status, "passed");
  assert.equal(findings.get("app-data-expiry-filter")?.status, "passed");
  assert.equal(findings.get("signed-cookie-expiry")?.status, "proven-through-internal-adapter");
  assert.equal(findings.get("no-slow-real-time-wait")?.status, "passed");
  assert.equal(findings.get("renewal-update-age-recorded")?.status, "passed");
  assert.equal(findings.get("logout-revoke-distinct-from-expiry")?.status, "passed");
  assert.equal(findings.get("expired-session-cleanup")?.status, "passed");
  assert.ok(
    findings
      .get("expired-session-cleanup")
      ?.blockerCodes.includes("expired-session-pruning-policy-needed"),
  );
  assert.ok(
    findings
      .get("backup-restore-expiry-risk")
      ?.blockerCodes.includes("backup-restore-session-state-policy-needed"),
  );
  assert.equal(findings.get("not-live-authorization")?.status, "passed");
});

test("Better Auth deterministic expiry proof is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./betterAuthDeterministicExpiryProof.js"),
      false,
      `${file} imports deterministic expiry proof`,
    );
    assert.equal(
      source.includes("runIsolatedBetterAuthDeterministicExpiryProof"),
      false,
      `${file} references deterministic expiry proof`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
