import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BETTER_AUTH_DEPENDENCY_PROOF_LIVE_BROWSER_AUTH_ENABLED,
  BETTER_AUTH_DEPENDENCY_PROOF_MOUNTED,
  BETTER_AUTH_DEPENDENCY_PROOF_WIRED_INTO_AUTHORIZATION,
  BETTER_AUTH_DEPENDENCY_PROOF_WIRED_INTO_ROUTES,
  runIsolatedBetterAuthDependencyProof,
} from "./betterAuthDependencyProof.js";

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_secret",
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `Better Auth proof exposed ${secret}`);
  }
}

test("isolated Better Auth dependency proof imports and instantiates without enabling live auth", async () => {
  const proof = await runIsolatedBetterAuthDependencyProof();

  assert.equal(BETTER_AUTH_DEPENDENCY_PROOF_LIVE_BROWSER_AUTH_ENABLED, false);
  assert.equal(BETTER_AUTH_DEPENDENCY_PROOF_MOUNTED, false);
  assert.equal(BETTER_AUTH_DEPENDENCY_PROOF_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BETTER_AUTH_DEPENDENCY_PROOF_WIRED_INTO_ROUTES, false);
  assert.equal(proof.status, "isolated-proof");
  assert.equal(proof.packageName, "better-auth");
  assert.match(proof.packageVersion, /^\d+\.\d+\.\d+/);
  assert.equal(proof.dependencyInstalled, true);
  assert.equal(proof.importedBetterAuth, true);
  assert.equal(proof.instantiatedBetterAuth, true);
  assert.equal(proof.importedNodeHandlerHelpers, true);
  assert.equal(proof.liveBrowserAuthEnabled, false);
  assert.equal(proof.mountedInServer, false);
  assert.equal(proof.mountedHandler, false);
  assert.equal(proof.wiredIntoAuthorization, false);
  assert.equal(proof.wiredIntoRoutes, false);
  assert.equal(proof.emitsLiveSetCookieHeaders, false);
  assert.equal(proof.acceptsCookieCredentialsInLiveAuth, false);
  assert.equal(proof.parsesCookiesForLiveAuthorization, false);
  assert.equal(proof.validatesCsrfInLiveAuthorization, false);
  assert.equal(proof.changesBearerTokenProtectedMode, false);
  assert.equal(proof.noPluginsEnabled, true);
  assert.equal(proof.emailAndPasswordEnabled, false);
  assert.equal(proof.socialProvidersEnabled, false);
  assertNoSecretMaterial(proof);
});

test("isolated Better Auth proof exercises handler shape and sanitized cookie policy", async () => {
  const proof = await runIsolatedBetterAuthDependencyProof();

  assert.equal(proof.publicHandlerShape.standardRequestResponseHandler, true);
  assert.equal(proof.publicHandlerShape.nodeHandlerAdapterAvailable, true);
  assert.equal(proof.publicHandlerShape.fromNodeHeadersAvailable, true);
  assert.equal(proof.cookiePolicy.configuredSessionCookie.name, "arepo_session");
  assert.equal(proof.cookiePolicy.configuredSessionCookie.path, "/api");
  assert.equal(proof.cookiePolicy.configuredSessionCookie.sameSite, "lax");
  assert.equal(proof.cookiePolicy.configuredSessionCookie.httpOnly, true);
  assert.equal(proof.cookiePolicy.configuredSessionCookie.secure, false);
  assert.equal(proof.cookiePolicy.configuredSessionCookie.maxAgeSeconds, 60 * 30);
  assert.equal(proof.cookiePolicy.configuredSessionCookie.valueRedacted, true);
  assert.deepEqual(proof.cookiePolicy.trustedOrigins, ["http://127.0.0.1:8734"]);
  assert.equal(proof.cookiePolicy.useSecureCookies, false);
  assert.equal(proof.requestProof.getSessionWithoutCookieStatus, 200);
  assert.equal(proof.requestProof.getSessionWithoutCookieReturnedNull, true);
  assert.equal(proof.requestProof.signOutWithoutSessionStatus, 200);
  assert.ok(proof.requestProof.signOutClearingCookieCount > 0);
  assert.equal(
    proof.requestProof.clearingCookies.some((cookie) => cookie.name === "arepo_session"),
    true,
  );
  assert.equal(
    proof.requestProof.clearingCookies.every((cookie) => cookie.valueRedacted),
    true,
  );
  assertNoSecretMaterial(proof.requestProof);
});

test("isolated Better Auth proof exercises and labels session behavior honestly", async () => {
  const proof = await runIsolatedBetterAuthDependencyProof();

  assert.equal(proof.sessionProof.userCreatedThroughInternalAdapter, true);
  assert.equal(proof.sessionProof.sessionCreatedThroughInternalAdapter, true);
  assert.equal(proof.sessionProof.sessionLookupThroughInternalAdapter, true);
  assert.equal(proof.sessionProof.revokeCurrentThroughInternalAdapter, true);
  assert.equal(proof.sessionProof.revokeAllThroughInternalAdapter, true);
  assert.equal(proof.sessionProof.directCookieInjectionAuthenticates, false);
  assert.equal(proof.sessionProof.directPairingToPublicSessionApi, "needs-adapter-spike");
  assert.equal(proof.sessionProof.usesExternalIdentityProvider, false);
  assert.equal(proof.sessionProof.appDataStorage, "needs-database-adapter-spike");
  assert.equal(proof.sessionProof.expirySeconds, 60 * 30);
  assert.equal(proof.sessionProof.refreshUpdateAgeSeconds, 60 * 5);
  assert.equal(proof.csrfProof.coveredForArepoUnsafeApiRoutes, "unknown");
  assert.equal(proof.csrfProof.likelyArepoOwnedUntilProven, true);
  assert.deepEqual(proof.csrfProof.blockerCodes, ["csrf-ownership-unresolved"]);
  assertNoSecretMaterial(proof.sessionProof);
  assertNoSecretMaterial(proof.csrfProof);
});

test("isolated Better Auth proof keeps unsupported or unclear requirements explicit", async () => {
  const proof = await runIsolatedBetterAuthDependencyProof();
  const findingById = new Map(proof.findings.map((finding) => [finding.id, finding]));

  assert.equal(findingById.get("import-and-instantiate")?.status, "passed");
  assert.equal(findingById.get("request-response-handler")?.status, "passed");
  assert.equal(findingById.get("cookie-policy-control")?.status, "passed");
  assert.equal(findingById.get("session-lookup")?.status, "passed");
  assert.equal(findingById.get("logout-signout")?.status, "passed");
  assert.equal(findingById.get("revoke-current")?.status, "passed");
  assert.equal(findingById.get("revoke-all")?.status, "passed");
  assert.equal(findingById.get("session-creation")?.status, "needs-adapter-spike");
  assert.equal(findingById.get("local-app-data-storage")?.status, "needs-adapter-spike");
  assert.equal(findingById.get("csrf-ownership")?.status, "unknown");
  assert.ok(
    findingById
      .get("session-creation")
      ?.blockerCodes.includes("pairing-to-better-auth-session-unproven"),
  );
  assert.ok(
    findingById
      .get("local-app-data-storage")
      ?.blockerCodes.includes("app-data-session-store-unproven"),
  );
  assert.ok(findingById.get("csrf-ownership")?.blockerCodes.includes("csrf-ownership-unresolved"));
  assertNoSecretMaterial(proof.findings);
});

test("Better Auth dependency proof is isolated from live server authorization and frontend paths", async () => {
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
    assert.equal(source.includes("./betterAuthDependencyProof.js"), false);
    assert.equal(source.includes("runIsolatedBetterAuthDependencyProof"), false);
    assert.equal(source.includes("better-auth/minimal"), false);
    assert.equal(source.includes("better-auth/node"), false);
  }
});
