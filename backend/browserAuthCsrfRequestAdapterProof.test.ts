import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createInMemoryBrowserCsrfTokenStore } from "./browserCsrfTokenStore.js";
import {
  evaluateBrowserAuthCsrfRequestProof,
  runBrowserAuthCsrfRequestAdapterProof,
  type BrowserAuthCsrfRequestShape,
} from "./browserAuthCsrfRequestAdapterProof.js";

const secretSamples = [
  "arepo_session=",
  "Authorization: Bearer",
  "Cookie:",
  "Set-Cookie:",
  "bpairsec_csrf_request_pairing_secret",
  "bsver_csrf_request_session_secret",
  "bcsrfsec_",
  "sha256:",
  "verifierHash",
  "tokenHash",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `proof exposed ${secret}`);
  }
}

test("CSRF request adapter proof stays unmounted and inactive", () => {
  const proof = runBrowserAuthCsrfRequestAdapterProof();

  assert.equal(proof.status, "unmounted-arepo-owned-csrf-request-adapter-proof");
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

test("CSRF request adapter classifies safe and unsafe methods separately", () => {
  const proof = runBrowserAuthCsrfRequestAdapterProof();

  assert.equal(proof.safeMethod.status, "allow");
  assert.equal(proof.safeMethod.methodClass, "safe");
  assert.equal(proof.safeMethod.requiresCsrf, false);
  assert.equal(proof.safeMethod.reasonCode, "safe-method-no-csrf-token-required");

  assert.equal(proof.validUnsafeRequest.status, "allow");
  assert.equal(proof.validUnsafeRequest.methodClass, "unsafe");
  assert.equal(proof.validUnsafeRequest.requiresCsrf, true);
  assert.equal(proof.validUnsafeRequest.reasonCode, "valid-csrf-proof-test-only");
  assert.equal(proof.validUnsafeRequest.testOnly, true);
  assert.equal(proof.validUnsafeRequest.liveAuthorization, false);
  assert.equal(proof.validUnsafeRequest.liveMutationAllowed, false);

  assert.deepEqual(proof.policy.safeMethods, ["GET", "HEAD", "OPTIONS"]);
  assert.deepEqual(proof.policy.unsafeMethods, ["POST", "PUT", "PATCH", "DELETE"]);
  assert.equal(proof.policy.unsafeCookieBackedRoutesRequireCsrf, true);
  assert.equal(proof.policy.usesArepoCsrfStoreVerifier, true);
});

test("CSRF request adapter denies all required token failure cases with sanitized reasons", () => {
  const proof = runBrowserAuthCsrfRequestAdapterProof();

  assertDeny(proof.denialResults.missing, "missing-csrf-token");
  assertDeny(proof.denialResults.malformed, "malformed-csrf-token");
  assertDeny(proof.denialResults.wrong, "wrong-csrf-token");
  assertDeny(proof.denialResults.expired, "expired-csrf-token");
  assertDeny(proof.denialResults.revoked, "revoked-csrf-token");
  assertDeny(proof.denialResults.consumed, "consumed-csrf-token");
  assertDeny(proof.denialResults.sessionMismatch, "csrf-session-mismatch");

  for (const result of Object.values(proof.denialResults)) {
    assert.equal(result.statusCode, 403);
    assert.equal(result.liveAuthorization, false);
    assert.equal(result.liveMutationAllowed, false);
    assert.equal(result.tokenMaterialEchoed, false);
    assert.equal(result.setCookieEmitted, false);
    assert.equal(result.authenticatesRequest, false);
    assertNoSecretMaterial(result);
  }
});

test("CSRF request adapter applies supplemental origin and referer checks", () => {
  const proof = runBrowserAuthCsrfRequestAdapterProof();

  assertDeny(proof.denialResults.missingOrigin, "missing-origin");
  assert.equal(proof.denialResults.missingOrigin.originClass, "absent");
  assert.equal(proof.denialResults.missingOrigin.refererClass, "absent");

  assertDeny(proof.denialResults.untrustedOrigin, "untrusted-origin");
  assert.equal(proof.denialResults.untrustedOrigin.originClass, "untrusted");

  assert.equal(proof.trustedRefererRequest.status, "allow");
  assert.equal(proof.trustedRefererRequest.originClass, "absent");
  assert.equal(proof.trustedRefererRequest.refererClass, "trusted");
  assert.equal(proof.trustedRefererRequest.reasonCode, "valid-csrf-proof-test-only");
  assert.equal(proof.policy.originRefererSupplemental, true);
  assert.equal(proof.policy.sameSiteTreatedAsSufficient, false);
  assert.equal(proof.trustedRefererRequest.sameSiteTreatedAsSufficient, false);
});

test("CSRF request adapter can evaluate direct valid and mismatched request shapes", () => {
  const store = createInMemoryBrowserCsrfTokenStore({ clock: () => 10 });
  const tokenSecret = "bcsrfsec_direct_request_shape_test_only";
  const token = store.createToken({
    sessionId: "session-direct",
    csrfTokenId: "csrf-direct",
    tokenSecret,
    expiresAtMs: 1_000,
  });
  const valid = evaluateBrowserAuthCsrfRequestProof({
    csrfStore: store,
    request: requestShape({
      csrfTokenId: token.csrfTokenId,
      csrfTokenSecret: tokenSecret,
      expectedSessionId: "session-direct",
    }),
  });
  const mismatch = evaluateBrowserAuthCsrfRequestProof({
    csrfStore: store,
    request: requestShape({
      csrfTokenId: token.csrfTokenId,
      csrfTokenSecret: tokenSecret,
      expectedSessionId: "other-session",
    }),
  });

  assert.equal(valid.status, "allow");
  assert.equal(valid.reasonCode, "valid-csrf-proof-test-only");
  assert.equal(valid.testOnly, true);
  assert.equal(valid.liveAuthorization, false);
  assert.equal(mismatch.status, "deny");
  assert.equal(mismatch.reasonCode, "csrf-session-mismatch");
  assertNoSecretMaterial(valid);
  assertNoSecretMaterial(mismatch);
});

test("CSRF request adapter findings record pre-mutation validation and non-live status", () => {
  const proof = runBrowserAuthCsrfRequestAdapterProof();
  const findingIds = new Map(proof.findings.map((finding) => [finding.id, finding]));

  assert.equal(findingIds.get("safe-method-classification")?.status, "passed");
  assert.equal(findingIds.get("unsafe-method-csrf-required")?.status, "passed");
  assert.equal(findingIds.get("csrf-token-verification")?.status, "passed");
  assert.equal(findingIds.get("session-binding")?.status, "passed");
  assert.equal(findingIds.get("origin-referer-supplement")?.status, "passed");
  assert.equal(findingIds.get("samesite-insufficient")?.status, "passed");
  assert.equal(findingIds.get("sanitized-denials")?.status, "passed");
  assert.equal(findingIds.get("not-live-authorization")?.status, "passed");
  assert.equal(proof.validUnsafeRequest.validationBeforeMutation, true);
});

test("CSRF request adapter proof is isolated from live server authorization and frontend paths", async () => {
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
      source.includes("./browserAuthCsrfRequestAdapterProof.js"),
      false,
      `${file} imports CSRF request adapter proof`,
    );
    assert.equal(
      source.includes("runBrowserAuthCsrfRequestAdapterProof"),
      false,
      `${file} references CSRF request adapter proof`,
    );
  }
});

function assertDeny(result: { status: string; reasonCode: string }, reasonCode: string): void {
  assert.equal(result.status, "deny");
  assert.equal(result.reasonCode, reasonCode);
}

function requestShape(
  override: Partial<BrowserAuthCsrfRequestShape> = {},
): BrowserAuthCsrfRequestShape {
  return {
    method: "POST",
    path: "/api/vaults/example/files",
    routeKind: "vault-mutation",
    origin: "http://127.0.0.1:8734",
    trustedOrigins: ["http://127.0.0.1:8734"],
    requireOriginOrReferer: true,
    sameSitePolicy: "lax",
    ...override,
  };
}
