import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runIsolatedBetterAuthPairingCookieBoundaryProof } from "./betterAuthPairingCookieBoundaryProof.js";

const secretSamples = [
  "arepo_session=",
  "Authorization: Bearer",
  "Cookie:",
  "Set-Cookie:",
  "bpairsec_boundary_pairing_secret",
  "bsver_boundary_session_secret",
  "bcsrfsec_boundary_csrf_secret",
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
    assert.equal(serialized.includes(secret), false, `pairing boundary proof exposed ${secret}`);
  }
}

test("Better Auth pairing-cookie boundary proof stays isolated and inactive", async () => {
  const proof = await runIsolatedBetterAuthPairingCookieBoundaryProof();

  assert.equal(proof.status, "isolated-pairing-cookie-boundary-proof");
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

test("Better Auth pairing-cookie boundary proof records plugin boundary decision", async () => {
  const proof = await runIsolatedBetterAuthPairingCookieBoundaryProof();

  assert.equal(proof.decision, "supported-plugin-boundary-likely-needs-next-spike");
  assert.equal(proof.boundarySurvey.directPublicSessionCreationApiFound, false);
  assert.equal(proof.boundarySurvey.publicHandlerFlowWithoutNormalLoginFound, false);
  assert.equal(proof.boundarySurvey.publicPluginEndpointSupported, true);
  assert.equal(proof.boundarySurvey.publicSetSessionCookieHelperExported, true);
  assert.equal(proof.boundarySurvey.officialPluginUsesSameInternalAdapterPattern, true);
  assert.equal(proof.boundarySurvey.selectedBoundary, "better-auth-plugin-endpoint");
  assert.equal(proof.boundarySurvey.selectedBoundaryClassification, "public-plugin-endpoint");
  assert.equal(proof.boundarySurvey.internalAdapterUsedInsidePluginEndpoint, true);
  assert.equal(proof.boundarySurvey.internalSigningUsed, false);
  assert.equal(proof.boundarySurvey.exportedButUndocumentedApiUsed, false);
  assert.ok(proof.remainingBlockers.includes("production-arepo-better-auth-plugin-needed"));
  assert.ok(proof.remainingBlockers.includes("internal-adapter-wrapper-implementation-needed"));
});

test("Better Auth pairing-cookie boundary proof avoids normal login surfaces", async () => {
  const proof = await runIsolatedBetterAuthPairingCookieBoundaryProof();

  assert.equal(proof.pairingProof.arepoPairingAcceptanceModeled, true);
  assert.equal(proof.pairingProof.usernamePasswordEnabled, false);
  assert.equal(proof.pairingProof.oauthEnabled, false);
  assert.equal(proof.pairingProof.socialLoginEnabled, false);
  assert.equal(proof.pairingProof.emailLoginRequired, false);
  assert.equal(proof.pairingProof.frontendSecretStorageRequired, false);
  assert.equal(proof.pairingProof.normalLoginUiRequired, false);
});

test("Better Auth pairing-cookie boundary proof emits only redacted cookie metadata", async () => {
  const proof = await runIsolatedBetterAuthPairingCookieBoundaryProof();

  assert.equal(proof.cookieProof.pluginBoundaryProducedSignedCookie, true);
  assert.equal(proof.cookieProof.signedCookieObservedOnlyAsRedactedMetadata, true);
  assert.ok(
    proof.cookieProof.issuanceCookies.some(
      (cookie) =>
        cookie.name === "arepo_session" &&
        cookie.classification === "issuance" &&
        cookie.httpOnly === true &&
        cookie.path === "/api" &&
        cookie.valueRedacted === true,
    ),
  );
  assert.ok(
    proof.cookieProof.clearingCookies.some(
      (cookie) =>
        cookie.name === "arepo_session" &&
        cookie.classification === "clearing" &&
        cookie.valueRedacted === true,
    ),
  );
});

test("Better Auth pairing-cookie boundary proof supports lookup and rejects raw token injection", async () => {
  const proof = await runIsolatedBetterAuthPairingCookieBoundaryProof();

  assert.equal(proof.cookieProof.signedCookieCanLookupSession, true);
  assert.equal(proof.wrappedResponses.getSession.body.sessionPresent, true);
  assert.equal(proof.cookieProof.directRawTokenCookieInjectionAuthenticates, false);
  assert.equal(proof.wrappedResponses.directRawTokenInjection.body.sessionPresent, null);
});

test("Better Auth pairing-cookie boundary proof covers sign-out revoke-all and expiry", async () => {
  const proof = await runIsolatedBetterAuthPairingCookieBoundaryProof();

  assert.equal(proof.sessionProof.betterAuthUserCreatedOrReusedForArepoSubject, true);
  assert.equal(proof.sessionProof.betterAuthSessionCreatedByPluginBoundary, true);
  assert.equal(proof.sessionProof.signOutInvalidatesPairingCookieSession, true);
  assert.equal(proof.sessionProof.revokeCurrentInvalidatesSelectedSession, true);
  assert.equal(proof.sessionProof.revokeAllInvalidatesSelectedSubjectSessions, true);
  assert.equal(proof.sessionProof.revokeAllPreservesOtherSubjectSession, true);
  assert.equal(proof.sessionProof.deterministicExpiryAppliesToPairingCookieSession, true);
  assert.equal(proof.wrappedResponses.getSessionAfterSignOut.body.sessionPresent, null);
  assert.equal(proof.wrappedResponses.getSessionAfterRevokeCurrent.body.sessionPresent, null);
  assert.equal(proof.wrappedResponses.getSessionAfterRevokeAll.body.sessionPresent, null);
  assert.equal(proof.wrappedResponses.otherSubjectAfterRevokeAll.body.sessionPresent, true);
  assert.equal(proof.wrappedResponses.getSessionAfterExpiry.body.sessionPresent, null);
});

test("Better Auth pairing-cookie boundary proof preserves AREPO-owned authorization model", async () => {
  const proof = await runIsolatedBetterAuthPairingCookieBoundaryProof();

  assert.equal(proof.compatibilityProof.preservesHybridMetadataModel, true);
  assert.equal(proof.compatibilityProof.preservesArepoOwnedAuthorizationState, true);
  assert.equal(proof.compatibilityProof.compatibleWithRouteRequestAdapter, true);
  assert.equal(proof.compatibilityProof.compatibleWithActivationGate, true);
  assert.equal(proof.compatibilityProof.productionPluginImplementationStillNeeded, true);
  assert.ok(proof.remainingBlockers.includes("arepo-sidecar-authorization-store-needed"));
  assert.ok(proof.remainingBlockers.includes("arepo-owned-csrf-live-integration-blocked"));
});

test("Better Auth pairing-cookie boundary proof findings are explicit", async () => {
  const proof = await runIsolatedBetterAuthPairingCookieBoundaryProof();
  const findings = new Map(proof.findings.map((finding) => [finding.id, finding]));

  assert.equal(findings.get("direct-public-session-api")?.status, "blocked-for-production");
  assert.ok(
    findings
      .get("direct-public-session-api")
      ?.blockerCodes.includes("direct-public-session-cookie-api-not-found"),
  );
  assert.equal(findings.get("public-handler-login-flow")?.status, "not-required");
  assert.equal(findings.get("plugin-boundary")?.status, "supported-plugin-boundary");
  assert.ok(
    findings
      .get("plugin-boundary")
      ?.blockerCodes.includes("production-arepo-better-auth-plugin-needed"),
  );
  assert.equal(findings.get("signed-cookie-issuance")?.status, "passed");
  assert.equal(findings.get("session-lookup")?.status, "passed");
  assert.equal(findings.get("direct-token-injection")?.status, "passed");
  assert.equal(findings.get("sign-out")?.status, "passed");
  assert.equal(findings.get("revoke-current")?.status, "passed");
  assert.equal(findings.get("revoke-all")?.status, "passed");
  assert.equal(findings.get("expiry")?.status, "passed");
  assert.equal(findings.get("hybrid-metadata")?.status, "passed");
  assert.equal(findings.get("no-login-ui")?.status, "passed");
  assert.equal(findings.get("not-live-authorization")?.status, "passed");
});

test("Better Auth pairing-cookie boundary proof is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./betterAuthPairingCookieBoundaryProof.js"),
      false,
      `${file} imports pairing-cookie boundary proof`,
    );
    assert.equal(
      source.includes("runIsolatedBetterAuthPairingCookieBoundaryProof"),
      false,
      `${file} references pairing-cookie boundary proof`,
    );
    assert.equal(source.includes("better-auth"), false, `${file} imports Better Auth`);
  }
});
