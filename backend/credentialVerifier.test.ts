import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CREDENTIAL_VERIFIER_NETWORK_EXPOSURE_SAFE,
  TOKEN_VERIFIER_SCHEME,
  constantTimeEqual,
  createTokenDisplayPrefix,
  createTokenLookupId,
  createTokenVerifierMetadata,
  verifyTokenMaterial,
} from "./credentialVerifier.js";
import type { TokenVerifierMetadata } from "./credentialStore.js";

const tokenMaterial = "arepo_test_token_material_123";
const createdAt = "2026-07-02T00:00:00.000Z";
const salt = Buffer.from("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", "hex");
const hashParameters = {
  scheme: TOKEN_VERIFIER_SCHEME,
  iterations: 100_000,
  digest: "sha256" as const,
  keyLength: 32,
  saltLength: 32,
} as const;

function verifier(overrides: Partial<TokenVerifierMetadata> = {}): TokenVerifierMetadata {
  return {
    ...createTokenVerifierMetadata({
      tokenMaterial,
      credentialId: "credential-1",
      verifierId: "verifier-1",
      createdAt,
      salt,
      hashParameters,
    }),
    ...overrides,
  };
}

test("creating verifier metadata stores lookup prefix salt and hash without plaintext token", () => {
  const metadata = verifier();
  const serialized = JSON.stringify(metadata);

  assert.equal(metadata.credentialId, "credential-1");
  assert.equal(metadata.verifierId, "verifier-1");
  assert.equal(metadata.lookupId, createTokenLookupId(tokenMaterial));
  assert.equal(metadata.displayPrefix, createTokenDisplayPrefix(tokenMaterial));
  assert.equal(metadata.saltId, salt.toString("hex"));
  assert.equal(metadata.hashAlgorithm, "sha256");
  assert.equal(metadata.hashParameters.scheme, TOKEN_VERIFIER_SCHEME);
  assert.equal(typeof metadata.verifierHash, "string");
  assert.equal(serialized.includes(tokenMaterial), false);
  assert.equal("token" in metadata, false);
  assert.equal("bearerToken" in metadata, false);
});

test("correct supplied token material verifies successfully", () => {
  assert.deepEqual(verifyTokenMaterial(tokenMaterial, verifier()), { ok: true });
});

test("incorrect supplied token material fails verification", () => {
  assert.deepEqual(verifyTokenMaterial("wrong-token-material", verifier()), {
    ok: false,
    reason: "mismatch",
  });
});

test("expired verifier metadata fails verification", () => {
  const result = verifyTokenMaterial(
    tokenMaterial,
    verifier({ expiresAt: "2026-07-01T00:00:00.000Z" }),
    new Date("2026-07-02T00:00:00.000Z"),
  );
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

test("revoked verifier metadata fails verification", () => {
  assert.deepEqual(verifyTokenMaterial(tokenMaterial, verifier({ revokedAt: createdAt })), {
    ok: false,
    reason: "revoked",
  });
});

test("constant-time comparison helper handles equal and unequal buffers", () => {
  assert.equal(constantTimeEqual(Buffer.from("abc"), Buffer.from("abc")), true);
  assert.equal(constantTimeEqual(Buffer.from("abc"), Buffer.from("abd")), false);
  assert.equal(constantTimeEqual(Buffer.from("abc"), Buffer.from("abcd")), false);
});

test("lookup and display prefix are stable non-secret identifiers", () => {
  assert.equal(createTokenLookupId(tokenMaterial), createTokenLookupId(tokenMaterial));
  assert.equal(createTokenDisplayPrefix(tokenMaterial), createTokenDisplayPrefix(tokenMaterial));
  assert.notEqual(createTokenLookupId(tokenMaterial), createTokenLookupId("other-token-material"));
  assert.notEqual(createTokenDisplayPrefix(tokenMaterial), tokenMaterial.slice(0, 16));
});

test("verifier helper rejects malformed verifier metadata", () => {
  const malformed = verifier({
    hashParameters: {
      scheme: "sha256",
      iterations: 1,
      digest: "sha256",
      keyLength: 16,
      saltLength: 4,
    },
  });
  assert.deepEqual(verifyTokenMaterial(tokenMaterial, malformed), {
    ok: false,
    reason: "malformed-verifier",
  });
});

test("verifier helper errors do not include token material", () => {
  assert.throws(
    () =>
      createTokenVerifierMetadata({
        tokenMaterial,
        credentialId: "credential-1",
        verifierId: "verifier-1",
        createdAt,
        salt: Buffer.from("short"),
        hashParameters,
      }),
    (error) => error instanceof Error && !error.message.includes(tokenMaterial),
  );
});

test("credential verifier helpers do not claim network exposure is safe", () => {
  assert.equal(CREDENTIAL_VERIFIER_NETWORK_EXPOSURE_SAFE, false);
});

test("request handling does not import credential verifier helpers", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("credentialVerifier"), false);
  assert.equal(serverSource.includes("verifyTokenMaterial"), false);
});
