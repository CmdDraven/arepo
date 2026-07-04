import crypto from "node:crypto";
import { constantTimeEqual } from "./credentialVerifier.js";

export const BROWSER_CSRF_TOKEN_VERIFIER_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_CSRF_TOKEN_VERIFIER_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_CSRF_TOKEN_VERIFIER_WIRED_INTO_ROUTES = false;
export const BROWSER_CSRF_TOKEN_HASH_SCHEME = "sha256";

export type BrowserCsrfTokenStatus = "active" | "expired" | "revoked" | "consumed";

export type BrowserCsrfTokenRecordState = {
  expiresAtMs: number;
  revokedAtMs: number | null;
  consumedAtMs: number | null;
};

export function generateBrowserCsrfTokenId(): string {
  return `bcsrf_${crypto.randomBytes(18).toString("base64url")}`;
}

export function generateBrowserCsrfTokenSecret(): string {
  return `bcsrfsec_${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashBrowserCsrfToken(input: {
  csrfTokenId: string;
  tokenSecret: string | Buffer;
}): string {
  const csrfTokenId = normalizeCsrfTokenId(input.csrfTokenId);
  const tokenSecret = normalizeTokenSecret(input.tokenSecret);
  const digest = crypto
    .createHash("sha256")
    .update("arepo-browser-csrf-token-v1")
    .update("\0")
    .update(csrfTokenId)
    .update("\0")
    .update(tokenSecret)
    .digest("base64url");
  return `${BROWSER_CSRF_TOKEN_HASH_SCHEME}:${digest}`;
}

export function verifyBrowserCsrfToken(input: {
  csrfTokenId: string;
  tokenSecret: string | Buffer;
  tokenHash: string;
}): boolean {
  const actual = Buffer.from(
    hashBrowserCsrfToken({
      csrfTokenId: input.csrfTokenId,
      tokenSecret: input.tokenSecret,
    }),
    "utf8",
  );
  const expected = Buffer.from(input.tokenHash, "utf8");
  return constantTimeEqual(actual, expected);
}

export function assessBrowserCsrfTokenStatus(
  record: BrowserCsrfTokenRecordState,
  nowMs: number,
): BrowserCsrfTokenStatus {
  if (record.revokedAtMs !== null) return "revoked";
  if (record.consumedAtMs !== null) return "consumed";
  if (record.expiresAtMs <= nowMs) return "expired";
  return "active";
}

export function isBrowserCsrfTokenActive(
  record: BrowserCsrfTokenRecordState,
  nowMs: number,
): boolean {
  return assessBrowserCsrfTokenStatus(record, nowMs) === "active";
}

function normalizeCsrfTokenId(csrfTokenId: string): string {
  if (typeof csrfTokenId !== "string" || csrfTokenId.trim().length === 0) {
    throw new Error("Browser CSRF token id must be a non-empty string.");
  }
  return csrfTokenId;
}

function normalizeTokenSecret(tokenSecret: string | Buffer): Buffer {
  const secret = Buffer.isBuffer(tokenSecret)
    ? Buffer.from(tokenSecret)
    : Buffer.from(tokenSecret, "utf8");
  if (secret.length === 0) {
    throw new Error("Browser CSRF token secret must be non-empty.");
  }
  return secret;
}
