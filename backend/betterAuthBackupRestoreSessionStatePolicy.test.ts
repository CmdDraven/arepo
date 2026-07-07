import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planBetterAuthBackupRestoreSessionStatePolicy } from "./betterAuthBackupRestoreSessionStatePolicy.js";

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
    assert.equal(serialized.includes(secret), false, `backup restore policy exposed ${secret}`);
  }
}

test("Better Auth backup restore session-state policy is explicit and inactive", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.equal(policy.status, "accepted-with-conditions");
  assert.equal(policy.decision, "require-auth-state-epoch-and-fail-closed-on-restore-mismatch");
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

test("Better Auth backup restore policy classifies auth DB and sidecar state as sensitive generated app state", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.equal(policy.stateClassification.authDbIsSensitiveGeneratedAppState, true);
  assert.equal(policy.stateClassification.sidecarStateIsSensitiveGeneratedAppState, true);
  assert.equal(policy.stateClassification.authDbIsVaultContent, false);
  assert.equal(policy.stateClassification.sidecarStateIsVaultContent, false);
  assert.equal(policy.stateClassification.vaultSyncExportMustExcludeAuthStateByDefault, true);
  assert.equal(policy.backupPosture.operatorBackupsMayIncludeAppDataOnlyWithWarning, true);
  assert.equal(policy.backupPosture.authDbBackupDiscouragedWithoutOperatorProtection, true);
  assert.equal(policy.backupPosture.operatorToolEncryptionRecommended, true);
});

test("Better Auth backup restore policy distinguishes localhost and self-host risks", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.equal(policy.backupPosture.localhostOnlyRisk, "sensitive-local-app-state");
  assert.equal(
    policy.backupPosture.futureSelfHostRisk,
    "high-risk-without-operator-backup-and-https-policy",
  );
});

test("Better Auth backup restore policy fails closed for restored or mismatched state", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.equal(
    policy.restoreBehavior.authDbRestoredWithoutSidecar,
    "fail-closed-repairing-required",
  );
  assert.equal(
    policy.restoreBehavior.sidecarRestoredWithoutAuthDb,
    "fail-closed-repairing-required",
  );
  assert.equal(
    policy.restoreBehavior.bothRestoredDifferentPointsInTime,
    "fail-closed-reset-or-repairing-required",
  );
  assert.equal(
    policy.restoreBehavior.bothRestoredSamePointInTime,
    "suspicious-until-current-epoch-accepted",
  );
  assert.equal(policy.restoreBehavior.restoredStateSilentlyReenablesBrowserSessions, false);
  assert.equal(policy.restoreBehavior.restoredBrowserSessionAuthorityTrustedByDefault, false);
  assert.equal(policy.restoreBehavior.resetOrRePairingRequiredByDefault, true);
});

test("Better Auth backup restore policy requires auth state epoch binding", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.equal(policy.epochPolicy.authStateEpochRequiredBeforeLiveActivation, true);
  assert.equal(policy.epochPolicy.sidecarReferencesBindToCurrentAuthStateEpoch, true);
  assert.equal(policy.epochPolicy.backupRestoreShouldIncrementOrRotateEpoch, true);
  assert.equal(policy.epochPolicy.oldEpochStateFailsClosed, true);
  assert.equal(policy.epochPolicy.epochMismatchRequiresResetOrRePairing, true);
  assert.equal(policy.epochPolicy.epochStoredOutsideCookies, true);
  assert.equal(policy.epochPolicy.epochNotFrontendControlled, true);
});

test("Better Auth backup restore policy defines reset and re-pairing behavior", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.equal(policy.resetPolicy.deletingAuthDbRevokesAllBrowserSessions, true);
  assert.equal(policy.resetPolicy.deletingSidecarStateRevokesArepoRouteAuthority, true);
  assert.equal(policy.resetPolicy.authStateResetInvalidatesSidecarReferences, true);
  assert.equal(policy.resetPolicy.resetRequiresRePairing, true);
  assert.equal(policy.resetPolicy.revokeAllPreferredWhenStateIsConsistent, true);
  assert.equal(policy.resetPolicy.authDbResetPreferredWhenStateIsSuspicious, true);
  assert.equal(policy.resetPolicy.sidecarTombstoningPreferredForAudit, true);
});

test("Better Auth backup restore policy records mismatch detection as AREPO-owned", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.equal(policy.mismatchDetectionPolicy.detectMissingBetterAuthSessionForSidecar, true);
  assert.equal(policy.mismatchDetectionPolicy.detectMissingSidecarForBetterAuthSession, true);
  assert.equal(policy.mismatchDetectionPolicy.detectEpochMismatch, true);
  assert.equal(policy.mismatchDetectionPolicy.detectDuplicatedSidecarReference, true);
  assert.equal(policy.mismatchDetectionPolicy.detectSuspiciousFutureExpiry, true);
  assert.equal(policy.mismatchDetectionPolicy.detectionIsBestEffortUntilSidecarStoreExists, true);
  assert.equal(
    policy.mismatchDetectionPolicy.betterAuthAloneCannotDetectArepoRestoreSemantics,
    true,
  );
});

test("Better Auth backup restore policy cannot be bypassed by renewal pruning revoke or CSRF", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.equal(policy.interaction.renewalBlockedOnRestoreSuspicion, true);
  assert.equal(policy.interaction.pruningMarksSuspiciousStateStaleOrExpired, true);
  assert.equal(policy.interaction.revokeCurrentAllowedOnlyWhenReferencesMatch, true);
  assert.equal(policy.interaction.revokeAllAllowedForCurrentEpochSubject, true);
  assert.equal(policy.interaction.csrfCannotOverrideRestoreSuspicion, true);
  assert.equal(policy.interaction.activationGateMustBlockUntilPolicyImplemented, true);
});

test("Better Auth backup restore policy defines sanitized operator status and audit posture", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.equal(policy.operatorStatusPolicy.operatorWarningsRequired, true);
  assert.equal(policy.operatorStatusPolicy.reducedAnonymousStatusMayReportRestoreSuspicion, true);
  assert.equal(policy.operatorStatusPolicy.reducedAnonymousStatusExposesSessionMetadata, false);
  assert.equal(policy.operatorStatusPolicy.fullAuthorizedStatusMayExposeAggregateCounts, true);
  assert.equal(policy.operatorStatusPolicy.warningsMustBeSanitized, true);
  assert.equal(policy.auditStatusPolicy.auditRequired, true);
  assert.deepEqual(policy.auditStatusPolicy.auditCategories, [
    "browser_auth_state_reset",
    "browser_auth_restore_suspected",
    "browser_auth_epoch_mismatch",
    "browser_auth_sidecar_mismatch",
    "browser_auth_repairing_required",
  ]);
  assert.equal(policy.auditStatusPolicy.auditMustUseRedactedReferencesOnly, true);
  assert.equal(policy.auditStatusPolicy.auditMustNotRetainCredentialMaterial, true);
});

test("Better Auth backup restore policy keeps remaining blockers explicit", () => {
  const policy = planBetterAuthBackupRestoreSessionStatePolicy();

  assert.deepEqual(policy.remainingActivationBlockers, [
    "production-arepo-better-auth-plugin-needed",
    "arepo-sidecar-authorization-store-needed",
    "arepo-owned-csrf-live-integration-blocked",
    "better-auth-output-sanitization-wrapper-needed",
    "activation-gate-mounting-still-forbidden",
  ]);
  assert.equal(policy.activationRequirements.internalAdapterWrapperImplemented, false);
  assert.equal(policy.activationRequirements.sidecarAuthorizationStoreImplemented, false);
  assert.equal(policy.activationRequirements.authStateEpochImplemented, false);
  assert.equal(policy.activationRequirements.csrfIntegrationImplemented, false);
  assert.equal(policy.activationRequirements.disabledLiveMountingDesignAccepted, false);
});

test("Better Auth backup restore policy model is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./betterAuthBackupRestoreSessionStatePolicy.js"),
      false,
      `${file} imports Better Auth backup restore session-state policy`,
    );
    assert.equal(
      source.includes("planBetterAuthBackupRestoreSessionStatePolicy"),
      false,
      `${file} references Better Auth backup restore session-state policy`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
