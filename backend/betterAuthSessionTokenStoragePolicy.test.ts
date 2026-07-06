import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planBetterAuthSessionTokenStoragePolicy } from "./betterAuthSessionTokenStoragePolicy.js";

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_secret",
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
    assert.equal(serialized.includes(secret), false, `policy exposed ${secret}`);
  }
}

test("Better Auth session-token storage policy is explicit and inactive", () => {
  const policy = planBetterAuthSessionTokenStoragePolicy();

  assert.equal(policy.status, "accepted-with-conditions");
  assert.equal(policy.decision, "accept-better-auth-session-token-storage-with-conditions");
  assert.equal(policy.preferredFoundation, "better-auth");
  assert.equal(policy.backupFoundation, "server-side-session-core");
  assert.equal(policy.betterAuthTokenColumnAccepted, true);
  assert.equal(policy.liveBrowserAuthEnabled, false);
  assert.equal(policy.mountedInServer, false);
  assert.equal(policy.wiredIntoAuthorization, false);
  assert.equal(policy.wiredIntoRoutes, false);
  assert.equal(policy.emitsSetCookieHeaders, false);
  assert.equal(policy.acceptsCookieCredentials, false);
  assert.equal(policy.parsesCookiesForLiveAuthorization, false);
  assert.equal(policy.validatesCsrfInLiveAuthorization, false);
  assert.equal(policy.changesBearerTokenProtectedMode, false);
  assertNoSecretMaterial(policy);
});

test("Better Auth session-token policy requires app-data vault exclusion", () => {
  const policy = planBetterAuthSessionTokenStoragePolicy();
  const mitigationCodes = policy.requiredMitigations.map((mitigation) => mitigation.code);

  assert.equal(policy.appDataPathExpectation, "app-data/auth/better-auth.sqlite");
  assert.equal(policy.authDatabaseClassification, "sensitive-generated-app-state");
  assert.equal(policy.authDatabaseMustLiveOutsideVaultRoots, true);
  assert.equal(policy.authDatabaseExcludedFromVaultSyncExport, true);
  assert.ok(mitigationCodes.includes("store-auth-db-outside-vault-roots"));
  assert.ok(mitigationCodes.includes("exclude-auth-db-from-vault-sync-export"));
  assert.ok(mitigationCodes.includes("classify-auth-db-sensitive-generated-state"));
  assert.ok(mitigationCodes.includes("owner-only-file-permissions-best-effort"));
});

test("Better Auth session-token policy treats stored tokens as sensitive framework-owned material", () => {
  const policy = planBetterAuthSessionTokenStoragePolicy();

  assert.equal(
    policy.sessionTokenClassification,
    "framework-owned-opaque-session-secret-treated-as-bearer-equivalent-at-rest",
  );
  assert.equal(policy.extraArepoHashingRequiredBeforeActivation, false);
  assert.equal(policy.extraArepoEncryptionRequiredBeforeActivation, false);
  assert.equal(
    policy.extraHardeningDecision,
    "accept-library-owned-session-token-model-with-app-data-protections",
  );
  assert.ok(policy.risks.some((risk) => risk.code === "app-data-db-copy-risk"));
  assert.ok(
    policy.operatorWarnings.some((warning) => warning.includes("sensitive generated app data")),
  );
});

test("Better Auth session-token policy defines reset corruption and backup behavior", () => {
  const policy = planBetterAuthSessionTokenStoragePolicy();
  const mitigationCodes = policy.requiredMitigations.map((mitigation) => mitigation.code);

  assert.equal(policy.resetBehavior.deletingAuthDatabaseRevokesAllBrowserSessions, true);
  assert.equal(policy.resetBehavior.requiresRePairingAfterReset, true);
  assert.equal(policy.resetBehavior.missingDatabaseFailsClosedForBrowserSessions, true);
  assert.equal(policy.corruptionBehavior.failClosed, true);
  assert.equal(policy.corruptionBehavior.doNotSilentlyRecreateLiveSessions, true);
  assert.equal(policy.corruptionBehavior.operatorResetRequired, true);
  assert.equal(policy.backupRestoreBehavior.backupsContainSensitiveGeneratedAuthState, true);
  assert.equal(policy.backupRestoreBehavior.restoredOldDatabaseCanRevalidateOldSessions, true);
  assert.equal(policy.backupRestoreBehavior.restoreRequiresSessionResetOrRePairing, true);
  assert.equal(
    policy.backupRestoreBehavior.revocationAndExpiryReliableOnlyWhenAuthDbStateIsCurrent,
    true,
  );
  assert.ok(mitigationCodes.includes("reset-auth-db-revokes-browser-sessions"));
  assert.ok(mitigationCodes.includes("corruption-fails-closed"));
  assert.ok(mitigationCodes.includes("backup-restore-requires-session-reset-or-repairing"));
});

test("Better Auth session-token policy distinguishes localhost and future self-host risk", () => {
  const policy = planBetterAuthSessionTokenStoragePolicy();

  assert.equal(policy.posture.localhostOnlyRisk, "acceptable-with-local-app-data-protection");
  assert.equal(
    policy.posture.futureSelfHostRisk,
    "requires-stronger-filesystem-backup-and-https-policy",
  );
  assert.ok(policy.risks.some((risk) => risk.code === "self-host-file-system-risk"));
});

test("Better Auth session-token policy keeps activation blockers explicit", () => {
  const policy = planBetterAuthSessionTokenStoragePolicy();

  assert.deepEqual(policy.remainingActivationBlockers, [
    "deterministic-expiry-proof-needed",
    "pairing-cookie-issuance-path-unproven",
    "session-scope-metadata-design-needed",
    "arepo-owned-csrf-live-integration-blocked",
    "better-auth-output-sanitization-unproven",
    "activation-gate-mounting-still-forbidden",
  ]);
  assert.equal(
    policy.requiredMitigations.every((mitigation) =>
      mitigation.code === "no-extra-arepo-hashing-before-library-contract-review"
        ? mitigation.requiredBeforeLiveActivation === false
        : mitigation.requiredBeforeLiveActivation === true,
    ),
    true,
  );
});

test("Better Auth session-token storage policy is not imported into live server authorization or frontend paths", async () => {
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
    assert.equal(source.includes("./betterAuthSessionTokenStoragePolicy.js"), false);
    assert.equal(source.includes("planBetterAuthSessionTokenStoragePolicy"), false);
  }
});
