import crypto from "node:crypto";
import { validateBrowserSessionStore, type BrowserSessionMetadata } from "./credentialStore.js";
import { constantTimeEqual } from "./credentialVerifier.js";

export const SESSION_VERIFIER_NETWORK_EXPOSURE_SAFE = false;

export const SESSION_VERIFIER_SCHEME = "pbkdf2-sha256";

export type SessionVerifierHashParameters = {
  scheme: typeof SESSION_VERIFIER_SCHEME;
  iterations: number;
  digest: "sha256";
  keyLength: number;
  saltLength: number;
};

export const DEFAULT_SESSION_VERIFIER_HASH_PARAMETERS: SessionVerifierHashParameters = {
  scheme: SESSION_VERIFIER_SCHEME,
  iterations: 210_000,
  digest: "sha256",
  keyLength: 32,
  saltLength: 32,
};

export type CreateBrowserSessionVerifierInput = {
  sessionSecretMaterial: string | Buffer;
  credentialId: string;
  sessionId: string;
  verifierId: string;
  createdAt: string;
  expiresAt: string;
  sameSite: BrowserSessionMetadata["sameSite"];
  csrfBindingId?: string;
  salt?: Buffer;
  hashParameters?: Partial<SessionVerifierHashParameters>;
};

export type BrowserSessionVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "malformed-session" | "expired" | "revoked" | "logged-out" | "mismatch";
    };

export type BrowserSessionRenewalPlan =
  | {
      status: "eligible";
      sessionId: string;
      currentExpiresAt: string;
      networkExposureSafe: false;
    }
  | {
      status: "denied";
      reason: Exclude<BrowserSessionVerificationResult, { ok: true }>["reason"];
      networkExposureSafe: false;
    };

export type BrowserSessionLogoutPlan =
  | {
      status: "planned";
      sessionId: string;
      revocation: {
        targetKind: "browserSession";
        targetId: string;
        revokedAt: string;
        reason: string;
      };
      preserveAuditHistory: true;
      networkExposureSafe: false;
    }
  | {
      status: "denied";
      reason: "malformed-session" | "invalid-request-time";
      preserveAuditHistory: true;
      networkExposureSafe: false;
    };

// Browser sessions use the same built-in PBKDF2-SHA-256 verifier approach as
// token verifiers. This stores only verifier material; it does not create
// cookies, active sessions, or request authentication.
export function createBrowserSessionVerifierMetadata(
  input: CreateBrowserSessionVerifierInput,
): BrowserSessionMetadata {
  const sessionSecret = normalizeSessionSecretMaterial(input.sessionSecretMaterial);
  const parameters = normalizeHashParameters(input.hashParameters);
  const salt = input.salt ?? crypto.randomBytes(parameters.saltLength);
  if (salt.length !== parameters.saltLength) {
    throw new Error("Session verifier salt length does not match hash parameters.");
  }

  const session: BrowserSessionMetadata = {
    sessionId: input.sessionId,
    credentialId: input.credentialId,
    verifierId: input.verifierId,
    lookupId: createSessionLookupId(sessionSecret),
    displayPrefix: createSessionDisplayPrefix(sessionSecret),
    saltId: salt.toString("hex"),
    hashAlgorithm: "sha256",
    hashParameters: parameters,
    verifierHash: deriveVerifierHash(sessionSecret, salt, parameters).toString("base64"),
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    sameSite: input.sameSite,
    csrfBindingId: input.csrfBindingId,
  };

  assertSessionMetadata(session);
  return session;
}

export function verifyBrowserSessionMaterial(
  sessionSecretMaterial: string | Buffer,
  session: BrowserSessionMetadata,
  now = new Date(),
): BrowserSessionVerificationResult {
  const validation = validateSessionForCredentialCheck(session);
  if (!validation.ok) return { ok: false, reason: "malformed-session" };
  if (session.revokedAt) return { ok: false, reason: "revoked" };
  if (session.loggedOutAt) return { ok: false, reason: "logged-out" };
  if (Date.parse(session.expiresAt) <= now.getTime()) return { ok: false, reason: "expired" };

  const sessionSecret = normalizeSessionSecretMaterial(sessionSecretMaterial);
  const parameters = sessionHashParameters(session);
  if (!parameters) return { ok: false, reason: "malformed-session" };
  const salt = Buffer.from(session.saltId, "hex");
  const actual = deriveVerifierHash(sessionSecret, salt, parameters);
  const expected = Buffer.from(session.verifierHash, "base64");
  return constantTimeEqual(actual, expected) ? { ok: true } : { ok: false, reason: "mismatch" };
}

export function planBrowserSessionRenewal(
  session: BrowserSessionMetadata,
  now = new Date(),
): BrowserSessionRenewalPlan {
  const validation = validateSessionForCredentialCheck(session);
  if (!validation.ok) {
    return { status: "denied", reason: "malformed-session", networkExposureSafe: false };
  }
  if (session.revokedAt) {
    return { status: "denied", reason: "revoked", networkExposureSafe: false };
  }
  if (session.loggedOutAt) {
    return { status: "denied", reason: "logged-out", networkExposureSafe: false };
  }
  if (Date.parse(session.expiresAt) <= now.getTime()) {
    return { status: "denied", reason: "expired", networkExposureSafe: false };
  }
  return {
    status: "eligible",
    sessionId: session.sessionId,
    currentExpiresAt: session.expiresAt,
    networkExposureSafe: false,
  };
}

export function planBrowserSessionLogout(
  session: BrowserSessionMetadata,
  requestedAt: string,
  reason = "logout",
): BrowserSessionLogoutPlan {
  const validation = validateSessionForCredentialCheck(session);
  if (!validation.ok) {
    return {
      status: "denied",
      reason: "malformed-session",
      preserveAuditHistory: true,
      networkExposureSafe: false,
    };
  }
  if (Number.isNaN(Date.parse(requestedAt))) {
    return {
      status: "denied",
      reason: "invalid-request-time",
      preserveAuditHistory: true,
      networkExposureSafe: false,
    };
  }
  return {
    status: "planned",
    sessionId: session.sessionId,
    revocation: {
      targetKind: "browserSession",
      targetId: session.sessionId,
      revokedAt: requestedAt,
      reason,
    },
    preserveAuditHistory: true,
    networkExposureSafe: false,
  };
}

export function createSessionLookupId(sessionSecretMaterial: string | Buffer): string {
  const digest = crypto
    .createHash("sha256")
    .update(normalizeSessionSecretMaterial(sessionSecretMaterial))
    .digest("hex");
  return `session-lookup-${digest.slice(0, 32)}`;
}

export function createSessionDisplayPrefix(sessionSecretMaterial: string | Buffer): string {
  const digest = crypto
    .createHash("sha256")
    .update(normalizeSessionSecretMaterial(sessionSecretMaterial))
    .digest("hex");
  return `sess-${digest.slice(0, 12)}`;
}

function validateSessionForCredentialCheck(session: unknown): { ok: true } | { ok: false } {
  const storeValidation = validateBrowserSessionStore({ sessions: [session] });
  if (!storeValidation.ok) return { ok: false };
  return sessionHashParameters(session as BrowserSessionMetadata) ? { ok: true } : { ok: false };
}

function assertSessionMetadata(session: BrowserSessionMetadata): void {
  const validation = validateSessionForCredentialCheck(session);
  if (!validation.ok) throw new Error("Created browser session metadata failed validation.");
}

function normalizeSessionSecretMaterial(sessionSecretMaterial: string | Buffer): Buffer {
  const sessionSecret = Buffer.isBuffer(sessionSecretMaterial)
    ? Buffer.from(sessionSecretMaterial)
    : Buffer.from(sessionSecretMaterial, "utf8");
  if (sessionSecret.length === 0) throw new Error("Session secret material must be non-empty.");
  return sessionSecret;
}

function normalizeHashParameters(
  overrides: Partial<SessionVerifierHashParameters> = {},
): SessionVerifierHashParameters {
  const parameters = { ...DEFAULT_SESSION_VERIFIER_HASH_PARAMETERS, ...overrides };
  if (
    parameters.scheme !== SESSION_VERIFIER_SCHEME ||
    parameters.digest !== "sha256" ||
    !Number.isInteger(parameters.iterations) ||
    parameters.iterations < 100_000 ||
    !Number.isInteger(parameters.keyLength) ||
    parameters.keyLength < 32 ||
    !Number.isInteger(parameters.saltLength) ||
    parameters.saltLength < 16
  ) {
    throw new Error("Unsupported session verifier hash parameters.");
  }
  return parameters;
}

function sessionHashParameters(
  session: BrowserSessionMetadata,
): SessionVerifierHashParameters | null {
  if (session.hashAlgorithm !== "sha256") return null;
  const params = session.hashParameters;
  if (
    params.scheme !== SESSION_VERIFIER_SCHEME ||
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
  if (!/^[a-f0-9]+$/i.test(session.saltId) || session.saltId.length !== params.saltLength * 2) {
    return null;
  }
  return {
    scheme: SESSION_VERIFIER_SCHEME,
    iterations: params.iterations,
    digest: "sha256",
    keyLength: params.keyLength,
    saltLength: params.saltLength,
  };
}

function deriveVerifierHash(
  sessionSecret: Buffer,
  salt: Buffer,
  parameters: SessionVerifierHashParameters,
): Buffer {
  return crypto.pbkdf2Sync(
    sessionSecret,
    salt,
    parameters.iterations,
    parameters.keyLength,
    parameters.digest,
  );
}
