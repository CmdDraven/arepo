import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BETTER_AUTH_APP_DATA_STORE_PROOF_LIVE_BROWSER_AUTH_ENABLED,
  BETTER_AUTH_APP_DATA_STORE_PROOF_MOUNTED,
  BETTER_AUTH_APP_DATA_STORE_PROOF_WIRED_INTO_AUTHORIZATION,
  BETTER_AUTH_APP_DATA_STORE_PROOF_WIRED_INTO_ROUTES,
  runIsolatedBetterAuthAppDataStoreProof,
} from "./betterAuthAppDataStoreProof.js";

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_secret",
  "arepo-app-data-proof@example.invalid",
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `app-data proof exposed ${secret}`);
  }
}

test("Better Auth app-data store proof initializes local SQLite outside live auth", async () => {
  const proof = await runIsolatedBetterAuthAppDataStoreProof();

  assert.equal(BETTER_AUTH_APP_DATA_STORE_PROOF_LIVE_BROWSER_AUTH_ENABLED, false);
  assert.equal(BETTER_AUTH_APP_DATA_STORE_PROOF_MOUNTED, false);
  assert.equal(BETTER_AUTH_APP_DATA_STORE_PROOF_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BETTER_AUTH_APP_DATA_STORE_PROOF_WIRED_INTO_ROUTES, false);
  assert.equal(proof.status, "isolated-app-data-store-proof");
  assert.equal(proof.packageName, "better-auth");
  assert.equal(proof.storageEngine, "node-sqlite");
  assert.equal(proof.addedDatabaseDependency, false);
  assert.equal(proof.databaseLocation, "app-data/auth/better-auth.sqlite");
  assert.equal(proof.liveBrowserAuthEnabled, false);
  assert.equal(proof.mountedInServer, false);
  assert.equal(proof.wiredIntoAuthorization, false);
  assert.equal(proof.wiredIntoRoutes, false);
  assert.equal(proof.emitsLiveSetCookieHeaders, false);
  assert.equal(proof.acceptsCookieCredentialsInLiveAuth, false);
  assert.equal(proof.changesBearerTokenProtectedMode, false);
  assertNoSecretMaterial(proof);
});

test("Better Auth app-data store proof runs migrations and records schema policy blockers", async () => {
  const proof = await runIsolatedBetterAuthAppDataStoreProof();

  assert.equal(proof.migrations.runMigrationsAvailable, true);
  assert.equal(proof.migrations.migrationsRan, true);
  assert.deepEqual(proof.migrations.tableNames, ["account", "session", "user", "verification"]);
  assert.ok(proof.migrations.sessionColumnNames.includes("token"));
  assert.equal(proof.migrations.schemaOwnershipDecisionNeeded, true);
  assert.equal(proof.storageProof.sessionTokenColumnPresent, true);
  assert.equal(
    proof.storageProof.storedSessionTokenPolicy,
    "better-auth-session-token-column-present",
  );
  assert.equal(proof.storageProof.backupResetCorruptionPolicyNeeded, true);
  assert.ok(
    proof.findings
      .find((finding) => finding.id === "stored-session-token-policy")
      ?.blockerCodes.includes("better-auth-session-token-storage-policy-review-needed"),
  );
});

test("Better Auth app-data store proof exercises lookup expiry revoke current and revoke all", async () => {
  const proof = await runIsolatedBetterAuthAppDataStoreProof();

  assert.equal(proof.storageProof.databaseCreatedInAppData, true);
  assert.equal(proof.storageProof.databaseOutsideVault, true);
  assert.equal(proof.storageProof.persistedAcrossReopen, true);
  assert.equal(proof.storageProof.sessionLookupWorked, true);
  assert.equal(proof.storageProof.expiredSessionExcludedFromActiveLookup, false);
  assert.equal(proof.storageProof.revokeCurrentWorked, true);
  assert.equal(proof.storageProof.revokeAllForSubjectWorked, true);
  assert.equal(proof.storageProof.deterministicCleanupWorked, true);
  assert.equal(proof.sessionConfig.expirySeconds, 60 * 30);
  assert.equal(proof.sessionConfig.refreshUpdateAgeSeconds, 60 * 5);
  for (const id of [
    "app-data-sqlite-initialization",
    "schema-migration",
    "session-lookup",
    "revoke-current",
    "revoke-all",
    "persistence-across-reopen",
    "cleanup",
  ] as const) {
    assert.equal(proof.findings.find((finding) => finding.id === id)?.status, "passed");
  }
  const expiryFinding = proof.findings.find((finding) => finding.id === "session-expiry-filter");
  assert.equal(expiryFinding?.status, "needs-adapter-spike");
  assert.ok(expiryFinding?.blockerCodes.includes("deterministic-expiry-adapter-proof-needed"));
});

test("Better Auth app-data store proof is isolated from live server authorization and frontend paths", async () => {
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
    assert.equal(source.includes("./betterAuthAppDataStoreProof.js"), false);
    assert.equal(source.includes("runIsolatedBetterAuthAppDataStoreProof"), false);
    assert.equal(source.includes("node:sqlite"), false);
    assert.equal(source.includes("better-auth"), false);
  }
});
