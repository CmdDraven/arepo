import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  runIsolatedBetterAuthSessionScopeMetadataProof,
  sanitizeArepoBrowserDeviceLabel,
} from "./betterAuthSessionScopeMetadataProof.js";

const secretSamples = [
  "arepo_session=",
  "Authorization: Bearer",
  "Cookie:",
  "Set-Cookie:",
  "secret-cookie-value",
  "bpairsec_session_scope_pairing_secret",
  "bsver_session_scope_session_secret",
  "bcsrfsec_session_scope_csrf_secret",
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
    assert.equal(serialized.includes(secret), false, `session-scope proof exposed ${secret}`);
  }
}

test("Better Auth session-scope metadata proof stays isolated and inactive", async () => {
  const proof = await runIsolatedBetterAuthSessionScopeMetadataProof();

  assert.equal(proof.status, "isolated-session-scope-metadata-proof");
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

test("Better Auth session-scope proof chooses hybrid metadata ownership", async () => {
  const proof = await runIsolatedBetterAuthSessionScopeMetadataProof();

  assert.equal(
    proof.chosenModel,
    "hybrid-better-auth-session-references-plus-arepo-owned-authorization",
  );
  assert.deepEqual(proof.betterAuthOwns, [
    "session-cookie-mechanics",
    "session-expiry",
    "session-revocation",
  ]);
  assert.deepEqual(proof.arepoOwns, [
    "local-operator-subject-policy",
    "vault-node-permission-posture",
    "route-authorization-decisions",
    "device-label-policy",
    "audit-redaction-policy",
  ]);
});

test("Better Auth session-scope proof exposes only redacted stable references", async () => {
  const proof = await runIsolatedBetterAuthSessionScopeMetadataProof();

  assert.equal(proof.bridgeReferences.betterAuthUserIdReferenceAvailable, true);
  assert.equal(proof.bridgeReferences.betterAuthSessionIdReferenceAvailable, true);
  assert.equal(proof.bridgeReferences.betterAuthUserIdAcceptedAsReference, true);
  assert.equal(proof.bridgeReferences.betterAuthSessionIdAcceptedAsReference, true);
  assert.equal(proof.bridgeReferences.referenceValuesRedacted, true);
  assert.equal(proof.bridgeReferences.preferredBridgeKey, "better-auth-user-id-and-session-id");
  assert.equal(proof.lookupProof.sessionLookupExposesStableReferences, true);
  assert.equal(proof.lookupProof.sessionMetadataReadableWithoutSecrets, true);
});

test("Better Auth session-scope proof keeps authorization and permissions AREPO-owned", async () => {
  const proof = await runIsolatedBetterAuthSessionScopeMetadataProof();

  assert.equal(proof.metadataPlacement.localOperatorIdentity, "arepo-owned-app-data-state");
  assert.equal(
    proof.metadataPlacement.vaultNodePermissions,
    "arepo-owned-authorization-state-only",
  );
  assert.equal(proof.metadataPlacement.permissionPostureSerializedIntoCookies, false);
  assert.equal(proof.metadataPlacement.permissionPostureTrustedFromFrontendInput, false);
  assert.equal(proof.metadataPlacement.userControlledMetadataTrustedForAuthorization, false);
  assert.equal(proof.authorizationProof.futureRoutePermissionsConsumeArepoOwnedStateOnly, true);
  assert.equal(proof.authorizationProof.rawBetterAuthSessionObjectsTrustedForAuthorization, false);
  assert.ok(proof.remainingBlockers.includes("arepo-sidecar-authorization-store-needed"));
});

test("Better Auth session-scope proof sanitizes device labels", async () => {
  const proof = await runIsolatedBetterAuthSessionScopeMetadataProof();
  const sanitized = sanitizeArepoBrowserDeviceLabel("  Operator\nLaptop\t ");
  const unsafe = sanitizeArepoBrowserDeviceLabel("Cookie: arepo_session=secret");
  const long = sanitizeArepoBrowserDeviceLabel("x".repeat(200));

  assert.equal(sanitized.value, "Operator Laptop");
  assert.equal(sanitized.changed, true);
  assert.equal(unsafe.value, "redacted-device-label");
  assert.equal(unsafe.rejectedSecretLikeInput, true);
  assert.equal(long.value.length, long.maxLength);
  assert.equal(proof.deviceLabelProof.rawInputStored, false);
  assert.equal(proof.deviceLabelProof.sanitizedValue, "Operator Laptop Local Only");
  assert.equal(proof.deviceLabelProof.unsafeInputRedactedTo, "redacted-device-label");
  assert.equal(proof.deviceLabelProof.storedSanitizedHintRetrieved, true);
  assert.equal(proof.deviceLabelProof.controlCharactersRemoved, true);
  assert.equal(proof.deviceLabelProof.secretShapedInputRejected, true);
});

test("Better Auth session-scope metadata survives DB reopen and revocation remains targeted", async () => {
  const proof = await runIsolatedBetterAuthSessionScopeMetadataProof();

  assert.equal(proof.lookupProof.metadataSurvivesAppDataDbReopen, true);
  assert.equal(proof.lookupProof.safeSessionReferenceAvailableAfterReopen, true);
  assert.equal(proof.revocationProof.revokeCurrentTargetsCorrectSession, true);
  assert.equal(proof.revocationProof.revokeAllTargetsCorrectSubject, true);
  assert.equal(proof.revocationProof.revokeAllPreservesOtherSubject, true);
});

test("Better Auth session-scope proof defines safe status and audit posture", async () => {
  const proof = await runIsolatedBetterAuthSessionScopeMetadataProof();

  assert.equal(proof.statusAuditProof.reducedAnonymousStatusShouldExposeMetadata, false);
  assert.equal(proof.statusAuditProof.fullAuthorizedStatusMayExposeRedactedReferences, true);
  assert.equal(proof.statusAuditProof.auditMayUseRedactedSubjectSessionDeviceRefs, true);
  assert.equal(proof.statusAuditProof.auditMustNotStorePermissionSnapshotFromCookie, true);
  assert.equal(proof.backupRestoreProof.metadataBackupRestoreCreatesAuthorityRisk, true);
  assert.equal(proof.backupRestoreProof.restoredAuthDbRequiresArepoSidecarConsistencyCheck, true);
});

test("Better Auth session-scope proof findings are explicit", async () => {
  const proof = await runIsolatedBetterAuthSessionScopeMetadataProof();
  const findings = new Map(proof.findings.map((finding) => [finding.id, finding]));

  assert.equal(findings.get("stable-session-user-identifiers")?.status, "passed");
  assert.equal(findings.get("local-operator-subject")?.status, "accepted-design");
  assert.ok(
    findings
      .get("local-operator-subject")
      ?.blockerCodes.includes("arepo-sidecar-authorization-store-needed"),
  );
  assert.equal(findings.get("device-label")?.status, "accepted-design");
  assert.equal(findings.get("vault-node-permissions")?.status, "accepted-design");
  assert.equal(findings.get("metadata-db-reopen")?.status, "passed");
  assert.equal(findings.get("revoke-current")?.status, "passed");
  assert.equal(findings.get("revoke-all")?.status, "passed");
  assert.equal(findings.get("reduced-status")?.status, "accepted-design");
  assert.equal(findings.get("audit-references")?.status, "accepted-design");
  assert.equal(findings.get("future-route-authorization")?.status, "accepted-design");
  assert.equal(findings.get("not-live-authorization")?.status, "passed");
});

test("Better Auth session-scope proof is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./betterAuthSessionScopeMetadataProof.js"),
      false,
      `${file} imports session-scope metadata proof`,
    );
    assert.equal(
      source.includes("runIsolatedBetterAuthSessionScopeMetadataProof"),
      false,
      `${file} references session-scope metadata proof`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
