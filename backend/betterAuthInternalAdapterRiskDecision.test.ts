import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planBetterAuthInternalAdapterRiskDecision } from "./betterAuthInternalAdapterRiskDecision.js";

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
    assert.equal(serialized.includes(secret), false, `risk decision exposed ${secret}`);
  }
}

test("Better Auth internal-adapter decision is explicit and inactive", () => {
  const decision = planBetterAuthInternalAdapterRiskDecision();

  assert.equal(decision.status, "accepted-with-conditions");
  assert.equal(
    decision.decision,
    "accept-official-plugin-pattern-internal-adapter-with-conditions",
  );
  assert.equal(decision.preferredFoundation, "better-auth");
  assert.equal(decision.backupFoundation, "server-side-session-core");
  assert.equal(decision.liveBrowserAuthEnabled, false);
  assert.equal(decision.mountedInServer, false);
  assert.equal(decision.mountedInRoutes, false);
  assert.equal(decision.wiredIntoAuthorization, false);
  assert.equal(decision.wiredIntoRoutes, false);
  assert.equal(decision.emitsSetCookieHeaders, false);
  assert.equal(decision.acceptsCookieCredentials, false);
  assert.equal(decision.parsesCookiesForLiveAuthorization, false);
  assert.equal(decision.validatesCsrfInLiveAuthorization, false);
  assert.equal(decision.changesBearerTokenProtectedMode, false);
  assertNoSecretMaterial(decision);
});

test("Better Auth internal-adapter decision classifies API usage narrowly", () => {
  const decision = planBetterAuthInternalAdapterRiskDecision();

  assert.equal(decision.apiClassification.createAuthEndpoint, "public-exported-api");
  assert.equal(decision.apiClassification.setSessionCookie, "public-exported-api");
  assert.equal(
    decision.apiClassification.ctxContextInternalAdapter,
    "official-plugin-pattern-internal-access",
  );
  assert.equal(decision.apiClassification.directTokenSigning, "unsupported-internal-access");
  assert.equal(decision.rationale.officialPluginPatternAppearsToUseInternalAdapter, true);
  assert.equal(decision.rationale.riskAcceptedOnlyForPluginBoundary, true);
  assert.equal(decision.rationale.generalBetterAuthInternalsAccepted, false);
  assert.equal(decision.rationale.activationRemainsBlockedUntilWrapperAndRemainingGatesPass, true);
  assert.equal(decision.rationale.expressSessionBackupRemainsOpenIfRiskBecomesUnacceptable, true);
});

test("Better Auth internal-adapter decision lists allowed operations narrowly", () => {
  const decision = planBetterAuthInternalAdapterRiskDecision();

  assert.deepEqual(decision.allowedOperations, [
    "find-or-create-local-subject-user",
    "create-session-for-accepted-arepo-pairing",
    "return-redacted-user-session-references",
    "lookup-session-for-wrapper-regression-tests",
    "revoke-current-session-through-wrapper",
    "revoke-all-subject-sessions-through-wrapper",
    "observe-expiry-state-through-wrapper",
  ]);
  assert.equal(
    decision.allowedOperations.includes("create-session-for-accepted-arepo-pairing"),
    true,
  );
  assert.equal(
    decision.allowedOperations.includes("return-redacted-user-session-references"),
    true,
  );
});

test("Better Auth internal-adapter decision forbids unsafe operations", () => {
  const decision = planBetterAuthInternalAdapterRiskDecision();

  assert.ok(decision.forbiddenOperations.includes("direct-token-signing"));
  assert.ok(decision.forbiddenOperations.includes("raw-session-token-return"));
  assert.ok(decision.forbiddenOperations.includes("raw-cookie-return"));
  assert.ok(decision.forbiddenOperations.includes("authorization-header-access"));
  assert.ok(decision.forbiddenOperations.includes("cookie-header-access"));
  assert.ok(decision.forbiddenOperations.includes("set-cookie-value-logging"));
  assert.ok(decision.forbiddenOperations.includes("arbitrary-internal-adapter-call"));
  assert.ok(decision.forbiddenOperations.includes("arbitrary-database-mutation"));
  assert.ok(decision.forbiddenOperations.includes("route-authorization-decision"));
  assert.ok(decision.forbiddenOperations.includes("frontend-provided-permission-state"));
  assert.ok(decision.forbiddenOperations.includes("vault-node-permission-cookie-storage"));
  assert.ok(
    decision.forbiddenOperations.includes("better-auth-session-object-as-authorization-policy"),
  );
  assert.ok(decision.forbiddenOperations.includes("unsupported-better-auth-internal-api"));
});

test("Better Auth internal-adapter decision requires wrapper and upgrade policy", () => {
  const decision = planBetterAuthInternalAdapterRiskDecision();

  assert.equal(decision.wrapperPolicy.required, true);
  assert.equal(decision.wrapperPolicy.location, "inside-better-auth-plugin-boundary-only");
  assert.equal(decision.wrapperPolicy.returnsOnlySafeReferences, true);
  assert.equal(decision.wrapperPolicy.neverReturnsRawSessionTokens, true);
  assert.equal(decision.wrapperPolicy.neverPerformsRoutePermissionChecks, true);
  assert.equal(decision.wrapperPolicy.neverAcceptsFrontendPermissionState, true);
  assert.equal(decision.wrapperPolicy.neverSerializesVaultNodePermissionsIntoCookies, true);
  assert.equal(decision.wrapperPolicy.sanitizesErrorsAndReasonCodes, true);
  assert.ok(decision.mitigations.includes("narrow-wrapper-required"));
  assert.ok(decision.mitigations.includes("allowlisted-operations-only"));
  assert.ok(decision.mitigations.includes("better-auth-version-pinning-required"));
  assert.ok(decision.mitigations.includes("better-auth-upgrade-review-required"));
  assert.equal(decision.upgradePolicy.betterAuthVersionPinnedBeforeActivation, true);
  assert.equal(decision.upgradePolicy.upgradeRequiresManualReview, true);
  assert.equal(decision.upgradePolicy.upgradeRequiresProofSuitePass, true);
  assert.equal(decision.upgradePolicy.wrapperContractChangesBlockActivation, true);
});

test("Better Auth internal-adapter decision keeps AREPO and Better Auth responsibilities separate", () => {
  const decision = planBetterAuthInternalAdapterRiskDecision();

  assert.ok(decision.arepoOwnedResponsibilities.includes("activation-gates"));
  assert.ok(decision.arepoOwnedResponsibilities.includes("route-contracts"));
  assert.ok(decision.arepoOwnedResponsibilities.includes("pairing-ux"));
  assert.ok(decision.arepoOwnedResponsibilities.includes("route-permissions"));
  assert.ok(decision.arepoOwnedResponsibilities.includes("audit-policy"));
  assert.ok(decision.arepoOwnedResponsibilities.includes("inactive-boundary-tests"));
  assert.ok(decision.arepoOwnedResponsibilities.includes("hybrid-sidecar-authorization-state"));
  assert.ok(decision.arepoOwnedResponsibilities.includes("csrf-policy-for-arepo-api-routes"));
  assert.ok(decision.betterAuthOwnedResponsibilities.includes("session-cookie-mechanics"));
  assert.ok(decision.betterAuthOwnedResponsibilities.includes("session-records"));
  assert.ok(decision.betterAuthOwnedResponsibilities.includes("session-expiry"));
  assert.ok(decision.betterAuthOwnedResponsibilities.includes("session-revocation-primitives"));
});

test("Better Auth internal-adapter decision keeps remaining blockers explicit", () => {
  const decision = planBetterAuthInternalAdapterRiskDecision();

  assert.deepEqual(decision.remainingActivationBlockers, [
    "production-arepo-better-auth-plugin-needed",
    "arepo-sidecar-authorization-store-needed",
    "arepo-owned-csrf-live-integration-blocked",
    "better-auth-output-sanitization-wrapper-needed",
    "activation-gate-mounting-still-forbidden",
  ]);
  assert.ok(decision.regressionTestsRequired.includes("wrapper-allows-only-named-operations"));
  assert.ok(decision.regressionTestsRequired.includes("wrapper-never-returns-raw-session-token"));
  assert.ok(
    decision.regressionTestsRequired.includes(
      "plugin-boundary-blocks-before-wrapper-when-gate-denies",
    ),
  );
  assert.ok(decision.regressionTestsRequired.includes("inactive-boundary-forbids-live-imports"));
});

test("Better Auth internal-adapter decision model is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./betterAuthInternalAdapterRiskDecision.js"),
      false,
      `${file} imports Better Auth internal-adapter risk decision`,
    );
    assert.equal(
      source.includes("planBetterAuthInternalAdapterRiskDecision"),
      false,
      `${file} references Better Auth internal-adapter risk decision`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
