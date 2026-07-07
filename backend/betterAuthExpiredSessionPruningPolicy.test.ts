import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planBetterAuthExpiredSessionPruningPolicy } from "./betterAuthExpiredSessionPruningPolicy.js";

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_secret",
  "session.token=secret",
  "better-auth-secret",
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `pruning policy exposed ${secret}`);
  }
}

test("Better Auth expired-session pruning policy is explicit and inactive", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.equal(policy.status, "accepted-with-conditions");
  assert.equal(
    policy.decision,
    "prune-arepo-sidecar-state-leave-better-auth-session-cleanup-to-better-auth",
  );
  assert.equal(policy.preferredFoundation, "better-auth");
  assert.equal(policy.backupFoundation, "server-side-session-core");
  assert.equal(policy.liveBrowserAuthEnabled, false);
  assert.equal(policy.mountedInServer, false);
  assert.equal(policy.mountedInRoutes, false);
  assert.equal(policy.wiredIntoAuthorization, false);
  assert.equal(policy.wiredIntoRoutes, false);
  assert.equal(policy.emitsSetCookieHeaders, false);
  assert.equal(policy.acceptsCookieCredentials, false);
  assert.equal(policy.parsesCookiesForLiveAuthorization, false);
  assert.equal(policy.validatesCsrfInLiveAuthorization, false);
  assert.equal(policy.changesBearerTokenProtectedMode, false);
  assertNoSecretMaterial(policy);
});

test("Better Auth pruning policy keeps validity and authorization ownership separate", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.equal(policy.ownership.betterAuthOwnsSessionValidityAndExpiry, true);
  assert.equal(policy.ownership.arepoOwnsSidecarAuthorizationState, true);
  assert.equal(policy.ownership.expiredBetterAuthSessionsAuthorizeRequests, false);
  assert.equal(policy.ownership.sidecarStateAloneAuthorizesRequests, false);
  assert.equal(policy.ownership.betterAuthSessionAloneAuthorizesRequests, false);
});

test("Better Auth pruning policy avoids direct Better Auth table cleanup", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.equal(policy.betterAuthSessionPruning.deleteBetterAuthRowsDirectly, false);
  assert.equal(
    policy.betterAuthSessionPruning.useSupportedBetterAuthCleanupApiIfAvailableLater,
    true,
  );
  assert.equal(
    policy.betterAuthSessionPruning.leaveExpiredSessionCleanupToBetterAuthUntilSupportedApiExists,
    true,
  );
  assert.equal(policy.betterAuthSessionPruning.directTableMutationForbidden, true);
});

test("Better Auth pruning policy marks sidecar state stale or expired without preserving authority", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.equal(
    policy.sidecarPruning.expiredSessionSidecarAction,
    "mark-expired-retain-redacted-tombstone",
  );
  assert.equal(
    policy.sidecarPruning.missingBetterAuthSessionSidecarAction,
    "mark-stale-fail-closed",
  );
  assert.equal(
    policy.sidecarPruning.activeBetterAuthMissingSidecarAction,
    "fail-closed-no-authority",
  );
  assert.equal(policy.sidecarPruning.mismatchedSessionSidecarAction, "mark-stale-fail-closed");
  assert.equal(policy.sidecarPruning.revokedSidecarAction, "retain-revoked-tombstone");
  assert.equal(policy.sidecarPruning.deleteAuthorityBearingSidecarStateAfterTombstone, true);
  assert.equal(policy.sidecarPruning.retainRedactedAuditTombstones, true);
});

test("Better Auth pruning policy defines safe pruning cadence", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.equal(policy.cadence.startupPruningAllowed, true);
  assert.equal(policy.cadence.startupPruningBounded, true);
  assert.equal(policy.cadence.manualOperatorPruningPlanned, true);
  assert.equal(policy.cadence.scheduledIntervalPruningDeferred, true);
  assert.equal(policy.cadence.sessionLookupClassificationAllowed, true);
  assert.equal(policy.cadence.logoutRevokePruningAllowed, true);
  assert.equal(policy.cadence.automaticPruningCreatesAuthority, false);
});

test("Better Auth pruning policy fails closed for expired missing mismatched and restored state", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.equal(policy.failClosedCases.expiredSessionWithActiveSidecar, true);
  assert.equal(policy.failClosedCases.missingBetterAuthSessionWithActiveSidecar, true);
  assert.equal(policy.failClosedCases.activeBetterAuthSessionWithMissingSidecar, true);
  assert.equal(policy.failClosedCases.mismatchedSessionAndSidecar, true);
  assert.equal(policy.failClosedCases.restoredAuthDbSidecarMismatch, true);
  assert.equal(policy.failClosedCases.restoredSidecarAuthDbMismatch, true);
  assert.equal(policy.failClosedCases.suspiciousFutureExpiry, true);
  assert.equal(policy.failClosedCases.clockSkewBeyondTolerance, true);
});

test("Better Auth pruning policy records clock skew and future expiry handling", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.equal(
    policy.clockPolicy.suspiciousFutureExpiryAction,
    "fail-closed-and-require-operator-review",
  );
  assert.equal(policy.clockPolicy.clockSkewAction, "fail-closed-when-outside-small-tolerance");
  assert.equal(policy.clockPolicy.smallToleranceSeconds, 300);
  assert.equal(policy.clockPolicy.pruningMustUseDeterministicClockInTests, true);
});

test("Better Auth pruning policy cannot be bypassed by renewal revocation or backup restore", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.equal(policy.interaction.revokeCurrentMarksSidecarRevokedBeforePruning, true);
  assert.equal(policy.interaction.revokeAllMarksMatchingSidecarsRevokedBeforePruning, true);
  assert.equal(policy.interaction.renewalCannotRevivePrunedSidecar, true);
  assert.equal(policy.interaction.renewalCannotReviveExpiredBetterAuthSession, true);
  assert.equal(policy.interaction.deterministicExpiryClassifiesExpiredBeforePruning, true);
  assert.equal(policy.interaction.backupRestoreInconsistencyRequiresResetOrRePairing, true);
});

test("Better Auth pruning policy defines sanitized audit and status posture", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.equal(policy.auditStatusPolicy.pruningAuditRequired, true);
  assert.deepEqual(policy.auditStatusPolicy.auditCategories, [
    "browser_session_pruning_started",
    "browser_session_pruning_completed",
    "browser_session_pruning_denied",
    "browser_session_sidecar_marked_expired",
    "browser_session_sidecar_marked_stale",
  ]);
  assert.equal(policy.auditStatusPolicy.auditMustUseRedactedReferencesOnly, true);
  assert.equal(policy.auditStatusPolicy.auditMustNotRetainCredentialMaterial, true);
  assert.equal(policy.auditStatusPolicy.reducedAnonymousStatusExposesPruningDetails, false);
  assert.equal(policy.auditStatusPolicy.fullAuthorizedStatusMayExposeAggregateCounts, true);
});

test("Better Auth pruning policy keeps remaining blockers explicit", () => {
  const policy = planBetterAuthExpiredSessionPruningPolicy();

  assert.deepEqual(policy.remainingActivationBlockers, [
    "internal-adapter-wrapper-implementation-needed",
    "production-arepo-better-auth-plugin-needed",
    "arepo-sidecar-authorization-store-needed",
    "arepo-owned-csrf-live-integration-blocked",
    "better-auth-output-sanitization-wrapper-needed",
    "activation-gate-mounting-still-forbidden",
  ]);
  assert.equal(policy.activationRequirements.internalAdapterWrapperImplemented, false);
  assert.equal(policy.activationRequirements.sidecarAuthorizationStoreImplemented, false);
  assert.equal(policy.activationRequirements.backupRestorePolicyAccepted, true);
  assert.equal(policy.activationRequirements.csrfIntegrationImplemented, false);
  assert.equal(policy.activationRequirements.disabledLiveMountingDesignAccepted, false);
});

test("Better Auth pruning policy model is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./betterAuthExpiredSessionPruningPolicy.js"),
      false,
      `${file} imports Better Auth expired-session pruning policy`,
    );
    assert.equal(
      source.includes("planBetterAuthExpiredSessionPruningPolicy"),
      false,
      `${file} references Better Auth expired-session pruning policy`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
