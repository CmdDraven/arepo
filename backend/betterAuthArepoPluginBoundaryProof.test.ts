import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runIsolatedBetterAuthArepoPluginBoundaryProof } from "./betterAuthArepoPluginBoundaryProof.js";

const secretSamples = [
  "arepo_session=",
  "Authorization: Bearer",
  "Cookie:",
  "Set-Cookie:",
  "bpairsec_plugin_boundary_pairing_secret",
  "bsver_plugin_boundary_session_secret",
  "bcsrfsec_plugin_boundary_csrf_secret",
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
    assert.equal(serialized.includes(secret), false, `plugin-boundary proof exposed ${secret}`);
  }
}

test("AREPO Better Auth plugin-boundary proof stays isolated and inactive", async () => {
  const proof = await runIsolatedBetterAuthArepoPluginBoundaryProof();

  assert.equal(proof.status, "isolated-arepo-better-auth-plugin-boundary-proof");
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

test("AREPO Better Auth plugin-boundary proof blocks before active behavior by default", async () => {
  const proof = await runIsolatedBetterAuthArepoPluginBoundaryProof();

  assert.equal(proof.blockedAttempt.gateAllowed, false);
  assert.equal(proof.blockedAttempt.reasonCode, "browser_auth_activation_blocked");
  assert.equal(proof.blockedAttempt.sessionCreateAttempts, 0);
  assert.equal(proof.blockedAttempt.setSessionCookieAttempts, 0);
  assert.equal(proof.blockedAttempt.sidecarReferenceCreateAttempts, 0);
  assert.equal(proof.blockedAttempt.auditSuccessEvents, 0);
  assert.equal(proof.blockedAttempt.setCookieCount, 0);
  assert.equal(proof.pluginBoundary.activationGateRunsBeforeSessionCreation, true);
  assert.equal(proof.pluginBoundary.routeContractCheckedBeforeSessionCreation, true);
  assert.equal(proof.wrappedResponses.blockedPairingComplete.setCookieCount, 0);
});

test("AREPO Better Auth plugin-boundary proof exercises test-only plugin session flow", async () => {
  const proof = await runIsolatedBetterAuthArepoPluginBoundaryProof();

  assert.equal(proof.allowedProof.testOnlyAllowed, true);
  assert.equal(proof.allowedProof.betterAuthSessionCreated, true);
  assert.equal(proof.allowedProof.setSessionCookieCalled, true);
  assert.equal(proof.allowedProof.signedCookieObservedOnlyAsRedactedMetadata, true);
  assert.ok(
    proof.allowedProof.issuanceCookies.some(
      (cookie) =>
        cookie.name === "arepo_session" &&
        cookie.classification === "issuance" &&
        cookie.httpOnly === true &&
        cookie.path === "/api" &&
        cookie.valueRedacted === true,
    ),
  );
  assert.equal(proof.allowedProof.signedCookieCanLookupSession, true);
  assert.equal(proof.wrappedResponses.getSession.body.sessionPresent, true);
});

test("AREPO Better Auth plugin-boundary proof rejects raw token injection and covers sign-out revoke and expiry", async () => {
  const proof = await runIsolatedBetterAuthArepoPluginBoundaryProof();

  assert.equal(proof.allowedProof.directRawTokenCookieInjectionAuthenticates, false);
  assert.equal(proof.wrappedResponses.directRawTokenInjection.body.sessionPresent, null);
  assert.equal(proof.allowedProof.signOutInvalidatesPluginIssuedCookieSession, true);
  assert.equal(proof.allowedProof.revokeCurrentInvalidatesSelectedPluginIssuedSession, true);
  assert.equal(proof.allowedProof.revokeAllInvalidatesOnlySelectedSubjectSessions, true);
  assert.equal(proof.allowedProof.revokeAllPreservesOtherSubjectSession, true);
  assert.equal(proof.allowedProof.deterministicExpiryAppliesToPluginIssuedSession, true);
  assert.equal(proof.wrappedResponses.getSessionAfterSignOut.body.sessionPresent, null);
  assert.equal(proof.wrappedResponses.getSessionAfterRevokeCurrent.body.sessionPresent, null);
  assert.equal(proof.wrappedResponses.getSessionAfterRevokeAll.body.sessionPresent, null);
  assert.equal(proof.wrappedResponses.otherSubjectAfterRevokeAll.body.sessionPresent, true);
  assert.equal(proof.wrappedResponses.getSessionAfterExpiry.body.sessionPresent, null);
});

test("AREPO Better Auth plugin-boundary proof models AREPO-owned sidecar authorization", async () => {
  const proof = await runIsolatedBetterAuthArepoPluginBoundaryProof();

  assert.equal(proof.sidecarAuthorization.status, "modeled-in-memory-proof-only");
  assert.equal(
    proof.sidecarAuthorization.createdOnlyAfterPairingAcceptanceAndActivationAllowance,
    true,
  );
  assert.equal(proof.sidecarAuthorization.keyedByBetterAuthUserAndSessionReferences, true);
  assert.equal(proof.sidecarAuthorization.referenceValuesRedacted, true);
  assert.equal(proof.sidecarAuthorization.localOperatorSubjectStored, true);
  assert.equal(proof.sidecarAuthorization.sanitizedDeviceLabelStored, true);
  assert.equal(proof.sidecarAuthorization.sanitizedDeviceLabel, "Operator Laptop Local Only");
  assert.equal(
    proof.sidecarAuthorization.secretShapedDeviceLabelRedactedTo,
    "redacted-device-label",
  );
  assert.equal(proof.sidecarAuthorization.vaultNodePermissionsStoredInSidecar, false);
  assert.equal(proof.sidecarAuthorization.permissionPostureSerializedIntoCookies, false);
  assert.equal(proof.sidecarAuthorization.permissionPostureTrustedFromFrontendInput, false);
  assert.equal(proof.sidecarAuthorization.betterAuthSessionObjectsTrustedForAuthorization, false);
  assert.equal(proof.sidecarAuthorization.cookieDerivedAuthority, false);
  assert.equal(proof.sidecarAuthorization.revokeCurrentMarkedReferenceRevoked, true);
  assert.equal(proof.sidecarAuthorization.revokeAllMarkedOnlyMatchingSubjectReferences, true);
  assert.equal(proof.sidecarAuthorization.revokeAllPreservedOtherSubjectReference, true);
  assert.ok(proof.sidecarAuthorization.safeDiagnostics.redactedReferenceCount >= 3);
});

test("AREPO Better Auth plugin-boundary proof records CSRF sequencing without enabling CSRF", async () => {
  const proof = await runIsolatedBetterAuthArepoPluginBoundaryProof();

  assert.equal(proof.csrfSequencing.liveCsrfEnabled, false);
  assert.equal(proof.csrfSequencing.sequencingOnlyNotLive, true);
  assert.equal(proof.csrfSequencing.afterSessionLookupBeforeUnsafeMutation, true);
  assert.equal(proof.csrfSequencing.beforeCookieBackedLogoutRevoke, true);
  assert.equal(proof.csrfSequencing.beforeConfigVaultSessionMutation, true);
  assert.equal(proof.csrfSequencing.beforeRoutePermissionExecutionForUnsafeMethods, true);
  assert.equal(proof.csrfSequencing.sameSiteNotTreatedAsSufficient, true);
});

test("AREPO Better Auth plugin-boundary proof classifies internal-adapter risk", async () => {
  const proof = await runIsolatedBetterAuthArepoPluginBoundaryProof();

  assert.equal(proof.apiUsage.createAuthEndpoint, "public-exported-api");
  assert.equal(proof.apiUsage.setSessionCookie, "public-exported-api");
  assert.equal(proof.apiUsage.ctxContextInternalAdapter, "official-plugin-pattern-internal-access");
  assert.equal(proof.apiUsage.directTokenSigning, "not-used");
  assert.equal(proof.apiUsage.unsupportedInternalApiUsed, false);
  assert.equal(proof.internalAdapterRisk.classification, "official-plugin-pattern-internal-access");
  assert.equal(proof.internalAdapterRisk.officialBetterAuthPluginsUsePattern, true);
  assert.equal(proof.internalAdapterRisk.wrapperCanIsolateRisk, true);
  assert.equal(proof.internalAdapterRisk.activationBlockedUntilAcceptedOrReplaced, true);
  assert.equal(proof.internalAdapterRisk.expressSessionBackupShouldRemainOpenIfRejected, true);
  assert.ok(proof.remainingBlockers.includes("internal-adapter-wrapper-implementation-needed"));
});

test("AREPO Better Auth plugin-boundary proof emits sanitized audit-like events", async () => {
  const proof = await runIsolatedBetterAuthArepoPluginBoundaryProof();

  assert.equal(proof.auditProof.status, "sanitized-audit-like-events-in-isolated-proof");
  assert.equal(proof.auditProof.containsRawCredentialMaterial, false);
  assert.ok(proof.auditProof.eventCategories.includes("activation_blocked"));
  assert.ok(proof.auditProof.eventCategories.includes("pairing_accepted"));
  assert.ok(proof.auditProof.eventCategories.includes("session_issued_isolated"));
  assert.ok(proof.auditProof.eventCategories.includes("cookie_issuance_observed"));
  assert.ok(proof.auditProof.eventCategories.includes("sidecar_authorization_reference_created"));
  assert.ok(proof.auditProof.eventCategories.includes("sign_out"));
  assert.ok(proof.auditProof.eventCategories.includes("revoke_current"));
  assert.ok(proof.auditProof.eventCategories.includes("revoke_all"));
  assert.ok(proof.auditProof.eventCategories.includes("expiry_observed"));
  assert.ok(proof.auditProof.eventCategories.includes("raw_token_injection_rejected"));
});

test("AREPO Better Auth plugin-boundary proof findings are explicit", async () => {
  const proof = await runIsolatedBetterAuthArepoPluginBoundaryProof();
  const findings = new Map(proof.findings.map((finding) => [finding.id, finding]));

  assert.equal(findings.get("default-activation-gate")?.status, "blocked-by-default");
  assert.equal(findings.get("test-only-plugin-flow")?.status, "accepted-in-isolated-proof");
  assert.equal(findings.get("signed-cookie")?.status, "passed");
  assert.equal(findings.get("session-lookup")?.status, "passed");
  assert.equal(findings.get("direct-token-injection")?.status, "passed");
  assert.equal(findings.get("sign-out")?.status, "passed");
  assert.equal(findings.get("revoke-current")?.status, "passed");
  assert.equal(findings.get("revoke-all")?.status, "passed");
  assert.equal(findings.get("expiry")?.status, "passed");
  assert.equal(findings.get("sidecar-authorization")?.status, "accepted-in-isolated-proof");
  assert.equal(findings.get("csrf-sequencing")?.status, "needs-live-integration-later");
  assert.equal(findings.get("audit-redaction")?.status, "accepted-in-isolated-proof");
  assert.equal(findings.get("internal-adapter-risk")?.status, "needs-risk-decision");
  assert.equal(findings.get("not-live-authorization")?.status, "passed");
});

test("AREPO Better Auth plugin-boundary proof is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./betterAuthArepoPluginBoundaryProof.js"),
      false,
      `${file} imports AREPO Better Auth plugin-boundary proof`,
    );
    assert.equal(
      source.includes("runIsolatedBetterAuthArepoPluginBoundaryProof"),
      false,
      `${file} references AREPO Better Auth plugin-boundary proof`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
