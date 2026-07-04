import test from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_SESSION_VERIFIER_HASH_SCHEME,
  BROWSER_SESSION_VERIFIER_NETWORK_EXPOSURE_SAFE,
  BROWSER_SESSION_VERIFIER_WIRED_INTO_AUTHORIZATION,
  assessBrowserSessionVerifierStatus,
  generateBrowserSessionId,
  generateBrowserSessionVerifierSecret,
  hashBrowserSessionVerifier,
  isBrowserSessionVerifierActive,
  verifyBrowserSessionVerifier,
} from "./browserSessionVerifier.js";

const sessionId = "bsess_test_session";
const verifierSecret = "bsver_test_secret";

test("browser session verifier hashes match only the correct verifier secret", () => {
  const verifierHash = hashBrowserSessionVerifier({ sessionId, verifierSecret });

  assert.match(verifierHash, /^sha256:/);
  assert.equal(verifierHash.includes(verifierSecret), false);
  assert.equal(verifierHash.includes(sessionId), false);
  assert.equal(verifyBrowserSessionVerifier({ sessionId, verifierSecret, verifierHash }), true);
  assert.equal(
    verifyBrowserSessionVerifier({
      sessionId,
      verifierSecret: "wrong-secret",
      verifierHash,
    }),
    false,
  );
});

test("browser session verifier generators create tagged non-empty opaque values", () => {
  const generatedSessionId = generateBrowserSessionId();
  const generatedSecret = generateBrowserSessionVerifierSecret();

  assert.match(generatedSessionId, /^bsess_[A-Za-z0-9_-]+$/);
  assert.match(generatedSecret, /^bsver_[A-Za-z0-9_-]+$/);
  assert.notEqual(generatedSessionId, generateBrowserSessionId());
  assert.notEqual(generatedSecret, generateBrowserSessionVerifierSecret());
});

test("browser session verifier reports active expired and revoked states deterministically", () => {
  assert.equal(
    assessBrowserSessionVerifierStatus({ expiresAtMs: 2_000, revokedAtMs: null }, 1_000),
    "active",
  );
  assert.equal(
    assessBrowserSessionVerifierStatus({ expiresAtMs: 1_000, revokedAtMs: null }, 1_000),
    "expired",
  );
  assert.equal(
    assessBrowserSessionVerifierStatus({ expiresAtMs: 2_000, revokedAtMs: 1_500 }, 1_000),
    "revoked",
  );
  assert.equal(
    isBrowserSessionVerifierActive({ expiresAtMs: 2_000, revokedAtMs: null }, 1_000),
    true,
  );
});

test("browser session verifier primitive remains inactive and not network safe", () => {
  assert.equal(BROWSER_SESSION_VERIFIER_HASH_SCHEME, "sha256");
  assert.equal(BROWSER_SESSION_VERIFIER_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_SESSION_VERIFIER_WIRED_INTO_AUTHORIZATION, false);
});

test("browser session verifier errors do not include raw verifier material", () => {
  assert.throws(
    () => hashBrowserSessionVerifier({ sessionId: "", verifierSecret }),
    (error) => error instanceof Error && !error.message.includes(verifierSecret),
  );
  assert.throws(
    () => hashBrowserSessionVerifier({ sessionId, verifierSecret: "" }),
    (error) => error instanceof Error && !error.message.includes(sessionId),
  );
});
