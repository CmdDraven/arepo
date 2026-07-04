import test from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_PAIRING_CODE_HASH_SCHEME,
  BROWSER_PAIRING_CODE_VERIFIER_NETWORK_EXPOSURE_SAFE,
  BROWSER_PAIRING_CODE_VERIFIER_WIRED_INTO_AUTHORIZATION,
  BROWSER_PAIRING_CODE_VERIFIER_WIRED_INTO_ROUTES,
  assessBrowserPairingCodeStatus,
  generateBrowserPairingCodeId,
  generateBrowserPairingCodeSecret,
  hashBrowserPairingCode,
  isBrowserPairingCodeActive,
  verifyBrowserPairingCode,
} from "./browserPairingCodeVerifier.js";

const pairingCodeId = "bpair_test_code";
const pairingCodeSecret = "bpairsec_test_secret";

test("browser pairing code verifier hashes match only the correct code secret", () => {
  const pairingCodeHash = hashBrowserPairingCode({ pairingCodeId, pairingCodeSecret });

  assert.match(pairingCodeHash, /^sha256:/);
  assert.equal(pairingCodeHash.includes(pairingCodeSecret), false);
  assert.equal(pairingCodeHash.includes(pairingCodeId), false);
  assert.equal(
    verifyBrowserPairingCode({ pairingCodeId, pairingCodeSecret, pairingCodeHash }),
    true,
  );
  assert.equal(
    verifyBrowserPairingCode({
      pairingCodeId,
      pairingCodeSecret: "wrong-secret",
      pairingCodeHash,
    }),
    false,
  );
});

test("browser pairing code verifier generators create tagged non-empty opaque values", () => {
  const generatedCodeId = generateBrowserPairingCodeId();
  const generatedSecret = generateBrowserPairingCodeSecret();

  assert.match(generatedCodeId, /^bpair_[A-Za-z0-9_-]+$/);
  assert.match(generatedSecret, /^bpairsec_[A-Za-z0-9_-]+$/);
  assert.notEqual(generatedCodeId, generateBrowserPairingCodeId());
  assert.notEqual(generatedSecret, generateBrowserPairingCodeSecret());
});

test("browser pairing code verifier reports active expired revoked consumed and locked states", () => {
  assert.equal(
    assessBrowserPairingCodeStatus(
      {
        expiresAtMs: 2_000,
        revokedAtMs: null,
        consumedAtMs: null,
        failedAttemptCount: 0,
        maxFailedAttempts: 3,
      },
      1_000,
    ),
    "active",
  );
  assert.equal(
    assessBrowserPairingCodeStatus(
      {
        expiresAtMs: 1_000,
        revokedAtMs: null,
        consumedAtMs: null,
        failedAttemptCount: 0,
        maxFailedAttempts: 3,
      },
      1_000,
    ),
    "expired",
  );
  assert.equal(
    assessBrowserPairingCodeStatus(
      {
        expiresAtMs: 2_000,
        revokedAtMs: 1_500,
        consumedAtMs: null,
        failedAttemptCount: 0,
        maxFailedAttempts: 3,
      },
      1_000,
    ),
    "revoked",
  );
  assert.equal(
    assessBrowserPairingCodeStatus(
      {
        expiresAtMs: 2_000,
        revokedAtMs: null,
        consumedAtMs: 1_500,
        failedAttemptCount: 0,
        maxFailedAttempts: 3,
      },
      1_000,
    ),
    "consumed",
  );
  assert.equal(
    assessBrowserPairingCodeStatus(
      {
        expiresAtMs: 2_000,
        revokedAtMs: null,
        consumedAtMs: null,
        failedAttemptCount: 3,
        maxFailedAttempts: 3,
      },
      1_000,
    ),
    "locked",
  );
  assert.equal(
    isBrowserPairingCodeActive(
      {
        expiresAtMs: 2_000,
        revokedAtMs: null,
        consumedAtMs: null,
        failedAttemptCount: 0,
        maxFailedAttempts: 3,
      },
      1_000,
    ),
    true,
  );
});

test("browser pairing code verifier primitive remains inactive and not network safe", () => {
  assert.equal(BROWSER_PAIRING_CODE_HASH_SCHEME, "sha256");
  assert.equal(BROWSER_PAIRING_CODE_VERIFIER_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_PAIRING_CODE_VERIFIER_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_PAIRING_CODE_VERIFIER_WIRED_INTO_ROUTES, false);
});

test("browser pairing code verifier errors do not include raw code material", () => {
  assert.throws(
    () => hashBrowserPairingCode({ pairingCodeId: "", pairingCodeSecret }),
    (error) => error instanceof Error && !error.message.includes(pairingCodeSecret),
  );
  assert.throws(
    () => hashBrowserPairingCode({ pairingCodeId, pairingCodeSecret: "" }),
    (error) => error instanceof Error && !error.message.includes(pairingCodeId),
  );
});
