import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planBetterAuthRenewalUpdateAgePolicy } from "./betterAuthRenewalUpdateAgePolicy.js";

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
    assert.equal(serialized.includes(secret), false, `renewal policy exposed ${secret}`);
  }
}

test("Better Auth renewal update-age policy is explicit and inactive", () => {
  const policy = planBetterAuthRenewalUpdateAgePolicy();

  assert.equal(policy.status, "accepted-with-conditions");
  assert.equal(policy.decision, "bounded-update-age-renewal-for-freshness-only");
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

test("Better Auth renewal update-age policy chooses bounded lifetime and updateAge", () => {
  const policy = planBetterAuthRenewalUpdateAgePolicy();

  assert.equal(policy.sessionLifetime.bounded, true);
  assert.equal(policy.sessionLifetime.maxAgeSeconds, 1800);
  assert.equal(policy.sessionLifetime.maxAgeMinutes, 30);
  assert.equal(policy.updateAge.posture, "enabled-bounded");
  assert.equal(policy.updateAge.updateAgeSeconds, 300);
  assert.equal(policy.updateAge.updateAgeMinutes, 5);
  assert.equal(policy.updateAge.renewalExtendsExpiry, true);
  assert.equal(policy.updateAge.renewalExtendsAuthorization, false);
  assert.equal(policy.updateAge.renewalRotatesAuthority, false);
  assert.equal(policy.updateAge.renewalCreatesNewSubjectAuthority, false);
});

test("Better Auth renewal update-age policy keeps AREPO sidecar authorization authoritative", () => {
  const policy = planBetterAuthRenewalUpdateAgePolicy();

  assert.equal(policy.authorityPolicy.betterAuthOwnsFreshnessAndCookieMechanics, true);
  assert.equal(policy.authorityPolicy.arepoSidecarAuthorizationRemainsAuthoritative, true);
  assert.equal(policy.authorityPolicy.routePermissionsRemainArepoOwned, true);
  assert.equal(policy.authorityPolicy.renewalNeverGrantsAuthorization, true);
  assert.equal(policy.authorityPolicy.renewalRequiresSidecarReference, true);
  assert.equal(policy.authorityPolicy.renewalBlockedWhenSidecarMissing, true);
  assert.equal(policy.authorityPolicy.renewalBlockedWhenSidecarRevoked, true);
  assert.equal(policy.authorityPolicy.renewalBlockedWhenSidecarStale, true);
  assert.equal(policy.authorityPolicy.renewalBlockedWhenSidecarMismatched, true);
});

test("Better Auth renewal update-age policy requires CSRF sequencing for unsafe requests", () => {
  const policy = planBetterAuthRenewalUpdateAgePolicy();

  assert.equal(policy.requestSequencing.safeReadOnlyRequestsMayRefreshLastSeen, true);
  assert.equal(policy.requestSequencing.unsafeRequestRenewalBeforeCsrfValidationAllowed, false);
  assert.equal(policy.requestSequencing.unsafeRequestMutationRequiresCsrfBeforeMutation, true);
  assert.equal(policy.requestSequencing.unsafeRequestRenewalRequiresCsrfSequencing, true);
  assert.equal(policy.requestSequencing.activationGateMustPassBeforeRenewalPath, true);
  assert.equal(policy.requestSequencing.routeContractMustAllowCookieBackedPath, true);
});

test("Better Auth renewal update-age policy is overridden by revoke and expiry", () => {
  const policy = planBetterAuthRenewalUpdateAgePolicy();

  assert.equal(policy.revocationExpiryInteraction.revokeCurrentOverridesRenewal, true);
  assert.equal(policy.revocationExpiryInteraction.revokeAllOverridesRenewal, true);
  assert.equal(policy.revocationExpiryInteraction.expiryOverridesRenewal, true);
  assert.equal(policy.revocationExpiryInteraction.expiredSessionsMustNotBeRevivedByRenewal, true);
  assert.equal(
    policy.revocationExpiryInteraction.missingOrRevokedSidecarMustBlockLastSeenUpdate,
    true,
  );
});

test("Better Auth renewal update-age policy records audit and last-seen requirements", () => {
  const policy = planBetterAuthRenewalUpdateAgePolicy();

  assert.equal(policy.auditPolicy.renewalAuditRequired, true);
  assert.equal(policy.auditPolicy.lastSeenUpdateAllowed, true);
  assert.equal(policy.auditPolicy.lastSeenMustBeSafeMetadataOnly, true);
  assert.deepEqual(policy.auditPolicy.auditCategories, [
    "browser_session_renewal_attempted",
    "browser_session_renewal_succeeded",
    "browser_session_renewal_denied",
  ]);
  assert.equal(policy.auditPolicy.auditMustRedactSessionReferences, true);
  assert.equal(policy.auditPolicy.auditMustNotIncludeCookieOrTokenMaterial, true);
});

test("Better Auth renewal update-age policy records backup restore risk", () => {
  const policy = planBetterAuthRenewalUpdateAgePolicy();

  assert.equal(policy.backupRestorePolicy.restoredOldAuthDbCanRestoreFreshnessState, true);
  assert.equal(policy.backupRestorePolicy.restoredOldSidecarMismatchMustBlockRenewal, true);
  assert.equal(policy.backupRestorePolicy.backupRestoreRequiresSessionResetOrRePairingPolicy, true);
  assert.equal(policy.backupRestorePolicy.operatorWarningRequired, true);
});

test("Better Auth renewal update-age policy keeps remaining blockers explicit", () => {
  const policy = planBetterAuthRenewalUpdateAgePolicy();

  assert.deepEqual(policy.remainingActivationBlockers, [
    "internal-adapter-wrapper-implementation-needed",
    "production-arepo-better-auth-plugin-needed",
    "arepo-sidecar-authorization-store-needed",
    "backup-restore-session-state-policy-needed",
    "arepo-owned-csrf-live-integration-blocked",
    "better-auth-output-sanitization-wrapper-needed",
    "activation-gate-mounting-still-forbidden",
  ]);
  assert.equal(policy.activationRequirements.internalAdapterWrapperImplemented, false);
  assert.equal(policy.activationRequirements.sidecarAuthorizationStoreImplemented, false);
  assert.equal(policy.activationRequirements.csrfIntegrationImplemented, false);
  assert.equal(policy.activationRequirements.expiredSessionPruningPolicyAccepted, true);
  assert.equal(policy.activationRequirements.backupRestorePolicyAccepted, false);
  assert.equal(policy.activationRequirements.disabledLiveMountingDesignAccepted, false);
});

test("Better Auth renewal update-age policy model is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./betterAuthRenewalUpdateAgePolicy.js"),
      false,
      `${file} imports Better Auth renewal update-age policy`,
    );
    assert.equal(
      source.includes("planBetterAuthRenewalUpdateAgePolicy"),
      false,
      `${file} references Better Auth renewal update-age policy`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
