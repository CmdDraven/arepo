import crypto from "node:crypto";
import { constantTimeEqual } from "./credentialVerifier.js";

export const BROWSER_SESSION_VERIFIER_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_SESSION_VERIFIER_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_SESSION_VERIFIER_HASH_SCHEME = "sha256";

export type BrowserSessionVerifierStatus = "active" | "expired" | "revoked";

export type BrowserSessionVerifierRecordState = {
  expiresAtMs: number;
  revokedAtMs: number | null;
};

export function generateBrowserSessionId(): string {
  return `bsess_${crypto.randomBytes(18).toString("base64url")}`;
}

export function generateBrowserSessionVerifierSecret(): string {
  return `bsver_${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashBrowserSessionVerifier(input: {
  sessionId: string;
  verifierSecret: string | Buffer;
}): string {
  const sessionId = normalizeSessionId(input.sessionId);
  const verifierSecret = normalizeVerifierSecret(input.verifierSecret);
  const digest = crypto
    .createHash("sha256")
    .update("arepo-browser-session-verifier-v1")
    .update("\0")
    .update(sessionId)
    .update("\0")
    .update(verifierSecret)
    .digest("base64url");
  return `${BROWSER_SESSION_VERIFIER_HASH_SCHEME}:${digest}`;
}

export function verifyBrowserSessionVerifier(input: {
  sessionId: string;
  verifierSecret: string | Buffer;
  verifierHash: string;
}): boolean {
  const actual = Buffer.from(
    hashBrowserSessionVerifier({
      sessionId: input.sessionId,
      verifierSecret: input.verifierSecret,
    }),
    "utf8",
  );
  const expected = Buffer.from(input.verifierHash, "utf8");
  return constantTimeEqual(actual, expected);
}

export function assessBrowserSessionVerifierStatus(
  record: BrowserSessionVerifierRecordState,
  nowMs: number,
): BrowserSessionVerifierStatus {
  if (record.revokedAtMs !== null) return "revoked";
  if (record.expiresAtMs <= nowMs) return "expired";
  return "active";
}

export function isBrowserSessionVerifierActive(
  record: BrowserSessionVerifierRecordState,
  nowMs: number,
): boolean {
  return assessBrowserSessionVerifierStatus(record, nowMs) === "active";
}

function normalizeSessionId(sessionId: string): string {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new Error("Browser session id must be a non-empty string.");
  }
  return sessionId;
}

function normalizeVerifierSecret(verifierSecret: string | Buffer): Buffer {
  const secret = Buffer.isBuffer(verifierSecret)
    ? Buffer.from(verifierSecret)
    : Buffer.from(verifierSecret, "utf8");
  if (secret.length === 0) {
    throw new Error("Browser session verifier secret must be non-empty.");
  }
  return secret;
}
