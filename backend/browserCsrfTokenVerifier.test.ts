import test from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_CSRF_TOKEN_HASH_SCHEME,
  BROWSER_CSRF_TOKEN_VERIFIER_NETWORK_EXPOSURE_SAFE,
  BROWSER_CSRF_TOKEN_VERIFIER_WIRED_INTO_AUTHORIZATION,
  BROWSER_CSRF_TOKEN_VERIFIER_WIRED_INTO_ROUTES,
  assessBrowserCsrfTokenStatus,
  generateBrowserCsrfTokenId,
  generateBrowserCsrfTokenSecret,
  hashBrowserCsrfToken,
  isBrowserCsrfTokenActive,
  verifyBrowserCsrfToken,
} from "./browserCsrfTokenVerifier.js";

const csrfTokenId = "bcsrf_test_token";
const tokenSecret = "bcsrfsec_test_secret";

test("browser csrf token verifier hashes match only the correct token secret", () => {
  const tokenHash = hashBrowserCsrfToken({ csrfTokenId, tokenSecret });

  assert.match(tokenHash, /^sha256:/);
  assert.equal(tokenHash.includes(tokenSecret), false);
  assert.equal(tokenHash.includes(csrfTokenId), false);
  assert.equal(verifyBrowserCsrfToken({ csrfTokenId, tokenSecret, tokenHash }), true);
  assert.equal(
    verifyBrowserCsrfToken({
      csrfTokenId,
      tokenSecret: "wrong-secret",
      tokenHash,
    }),
    false,
  );
});

test("browser csrf token verifier generators create tagged non-empty opaque values", () => {
  const generatedTokenId = generateBrowserCsrfTokenId();
  const generatedSecret = generateBrowserCsrfTokenSecret();

  assert.match(generatedTokenId, /^bcsrf_[A-Za-z0-9_-]+$/);
  assert.match(generatedSecret, /^bcsrfsec_[A-Za-z0-9_-]+$/);
  assert.notEqual(generatedTokenId, generateBrowserCsrfTokenId());
  assert.notEqual(generatedSecret, generateBrowserCsrfTokenSecret());
});

test("browser csrf token verifier reports active expired revoked and consumed states", () => {
  assert.equal(
    assessBrowserCsrfTokenStatus(
      { expiresAtMs: 2_000, revokedAtMs: null, consumedAtMs: null },
      1_000,
    ),
    "active",
  );
  assert.equal(
    assessBrowserCsrfTokenStatus(
      { expiresAtMs: 1_000, revokedAtMs: null, consumedAtMs: null },
      1_000,
    ),
    "expired",
  );
  assert.equal(
    assessBrowserCsrfTokenStatus(
      { expiresAtMs: 2_000, revokedAtMs: 1_500, consumedAtMs: null },
      1_000,
    ),
    "revoked",
  );
  assert.equal(
    assessBrowserCsrfTokenStatus(
      { expiresAtMs: 2_000, revokedAtMs: null, consumedAtMs: 1_500 },
      1_000,
    ),
    "consumed",
  );
  assert.equal(
    isBrowserCsrfTokenActive({ expiresAtMs: 2_000, revokedAtMs: null, consumedAtMs: null }, 1_000),
    true,
  );
});

test("browser csrf token verifier primitive remains inactive and not network safe", () => {
  assert.equal(BROWSER_CSRF_TOKEN_HASH_SCHEME, "sha256");
  assert.equal(BROWSER_CSRF_TOKEN_VERIFIER_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_CSRF_TOKEN_VERIFIER_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_CSRF_TOKEN_VERIFIER_WIRED_INTO_ROUTES, false);
});

test("browser csrf token verifier errors do not include raw token material", () => {
  assert.throws(
    () => hashBrowserCsrfToken({ csrfTokenId: "", tokenSecret }),
    (error) => error instanceof Error && !error.message.includes(tokenSecret),
  );
  assert.throws(
    () => hashBrowserCsrfToken({ csrfTokenId, tokenSecret: "" }),
    (error) => error instanceof Error && !error.message.includes(csrfTokenId),
  );
});
