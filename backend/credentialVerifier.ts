import crypto from "node:crypto";
import { validateTokenVerifierStore, type TokenVerifierMetadata } from "./credentialStore.js";

export const CREDENTIAL_VERIFIER_NETWORK_EXPOSURE_SAFE = false;

export const TOKEN_VERIFIER_SCHEME = "pbkdf2-sha256";

export type TokenVerifierHashParameters = {
  scheme: typeof TOKEN_VERIFIER_SCHEME;
  iterations: number;
  digest: "sha256";
  keyLength: number;
  saltLength: number;
};

export const DEFAULT_TOKEN_VERIFIER_HASH_PARAMETERS: TokenVerifierHashParameters = {
  scheme: TOKEN_VERIFIER_SCHEME,
  iterations: 210_000,
  digest: "sha256",
  keyLength: 32,
  saltLength: 32,
};

export type CreateTokenVerifierInput = {
  tokenMaterial: string | Buffer;
  credentialId: string;
  verifierId: string;
  createdAt: string;
  expiresAt?: string;
  salt?: Buffer;
  hashParameters?: Partial<TokenVerifierHashParameters>;
};

export type TokenVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "malformed-verifier" | "expired" | "revoked" | "mismatch";
    };

// PBKDF2-SHA-256 is deliberately simple and available in Node's built-in crypto.
// This helper stores only verifier material; it does not create or expose bearer tokens.
export function createTokenVerifierMetadata(
  input: CreateTokenVerifierInput,
): TokenVerifierMetadata {
  const token = normalizeTokenMaterial(input.tokenMaterial);
  const parameters = normalizeHashParameters(input.hashParameters);
  const salt = input.salt ?? crypto.randomBytes(parameters.saltLength);
  if (salt.length !== parameters.saltLength) {
    throw new Error("Token verifier salt length does not match hash parameters.");
  }

  const verifier: TokenVerifierMetadata = {
    verifierId: input.verifierId,
    credentialId: input.credentialId,
    lookupId: createTokenLookupId(token),
    displayPrefix: createTokenDisplayPrefix(token),
    saltId: salt.toString("hex"),
    hashAlgorithm: "sha256",
    hashParameters: parameters,
    verifierHash: deriveVerifierHash(token, salt, parameters).toString("base64"),
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };

  assertVerifierMetadata(verifier);
  return verifier;
}

export function verifyTokenMaterial(
  tokenMaterial: string | Buffer,
  verifier: TokenVerifierMetadata,
  now = new Date(),
): TokenVerificationResult {
  const validation = validateVerifierForCredentialCheck(verifier);
  if (!validation.ok) return { ok: false, reason: "malformed-verifier" };
  if (verifier.revokedAt) return { ok: false, reason: "revoked" };
  if (verifier.expiresAt && Date.parse(verifier.expiresAt) <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const token = normalizeTokenMaterial(tokenMaterial);
  const parameters = verifierHashParameters(verifier);
  if (!parameters) return { ok: false, reason: "malformed-verifier" };
  const salt = Buffer.from(verifier.saltId, "hex");
  const actual = deriveVerifierHash(token, salt, parameters);
  const expected = Buffer.from(verifier.verifierHash, "base64");
  return constantTimeEqual(actual, expected) ? { ok: true } : { ok: false, reason: "mismatch" };
}

export function createTokenLookupId(tokenMaterial: string | Buffer): string {
  const digest = crypto
    .createHash("sha256")
    .update(normalizeTokenMaterial(tokenMaterial))
    .digest("hex");
  return `lookup-${digest.slice(0, 32)}`;
}

export function createTokenDisplayPrefix(tokenMaterial: string | Buffer): string {
  const digest = crypto
    .createHash("sha256")
    .update(normalizeTokenMaterial(tokenMaterial))
    .digest("hex");
  return `tok-${digest.slice(0, 12)}`;
}

export function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  const length = Math.max(left.length, right.length);
  const paddedLeft = Buffer.alloc(length);
  const paddedRight = Buffer.alloc(length);
  left.copy(paddedLeft);
  right.copy(paddedRight);
  return crypto.timingSafeEqual(paddedLeft, paddedRight) && left.length === right.length;
}

function validateVerifierForCredentialCheck(verifier: unknown): { ok: true } | { ok: false } {
  const storeValidation = validateTokenVerifierStore({ tokenVerifiers: [verifier] });
  if (!storeValidation.ok) return { ok: false };
  return verifierHashParameters(verifier as TokenVerifierMetadata) ? { ok: true } : { ok: false };
}

function assertVerifierMetadata(verifier: TokenVerifierMetadata): void {
  const validation = validateVerifierForCredentialCheck(verifier);
  if (!validation.ok) throw new Error("Created token verifier metadata failed validation.");
}

function normalizeTokenMaterial(tokenMaterial: string | Buffer): Buffer {
  const token = Buffer.isBuffer(tokenMaterial)
    ? Buffer.from(tokenMaterial)
    : Buffer.from(tokenMaterial, "utf8");
  if (token.length === 0) throw new Error("Token material must be non-empty.");
  return token;
}

function normalizeHashParameters(
  overrides: Partial<TokenVerifierHashParameters> = {},
): TokenVerifierHashParameters {
  const parameters = { ...DEFAULT_TOKEN_VERIFIER_HASH_PARAMETERS, ...overrides };
  if (
    parameters.scheme !== TOKEN_VERIFIER_SCHEME ||
    parameters.digest !== "sha256" ||
    !Number.isInteger(parameters.iterations) ||
    parameters.iterations < 100_000 ||
    !Number.isInteger(parameters.keyLength) ||
    parameters.keyLength < 32 ||
    !Number.isInteger(parameters.saltLength) ||
    parameters.saltLength < 16
  ) {
    throw new Error("Unsupported token verifier hash parameters.");
  }
  return parameters;
}

function verifierHashParameters(
  verifier: TokenVerifierMetadata,
): TokenVerifierHashParameters | null {
  if (verifier.hashAlgorithm !== "sha256") return null;
  const params = verifier.hashParameters;
  if (
    params.scheme !== TOKEN_VERIFIER_SCHEME ||
    params.digest !== "sha256" ||
    !Number.isInteger(params.iterations) ||
    typeof params.iterations !== "number" ||
    params.iterations < 100_000 ||
    !Number.isInteger(params.keyLength) ||
    typeof params.keyLength !== "number" ||
    params.keyLength < 32 ||
    !Number.isInteger(params.saltLength) ||
    typeof params.saltLength !== "number" ||
    params.saltLength < 16
  ) {
    return null;
  }
  if (!/^[a-f0-9]+$/i.test(verifier.saltId) || verifier.saltId.length !== params.saltLength * 2) {
    return null;
  }
  return {
    scheme: TOKEN_VERIFIER_SCHEME,
    iterations: params.iterations,
    digest: "sha256",
    keyLength: params.keyLength,
    saltLength: params.saltLength,
  };
}

function deriveVerifierHash(
  token: Buffer,
  salt: Buffer,
  parameters: TokenVerifierHashParameters,
): Buffer {
  return crypto.pbkdf2Sync(
    token,
    salt,
    parameters.iterations,
    parameters.keyLength,
    parameters.digest,
  );
}
