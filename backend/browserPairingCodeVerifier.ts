import crypto from "node:crypto";
import { constantTimeEqual } from "./credentialVerifier.js";

export const BROWSER_PAIRING_CODE_VERIFIER_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_PAIRING_CODE_VERIFIER_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_PAIRING_CODE_VERIFIER_WIRED_INTO_ROUTES = false;
export const BROWSER_PAIRING_CODE_HASH_SCHEME = "sha256";

export type BrowserPairingCodeStatus = "active" | "expired" | "revoked" | "consumed" | "locked";

export type BrowserPairingCodeRecordState = {
  expiresAtMs: number;
  revokedAtMs: number | null;
  consumedAtMs: number | null;
  failedAttemptCount: number;
  maxFailedAttempts: number;
};

export function generateBrowserPairingCodeId(): string {
  return `bpair_${crypto.randomBytes(18).toString("base64url")}`;
}

export function generateBrowserPairingCodeSecret(): string {
  return `bpairsec_${crypto.randomBytes(24).toString("base64url")}`;
}

export function hashBrowserPairingCode(input: {
  pairingCodeId: string;
  pairingCodeSecret: string | Buffer;
}): string {
  const pairingCodeId = normalizePairingCodeId(input.pairingCodeId);
  const pairingCodeSecret = normalizePairingCodeSecret(input.pairingCodeSecret);
  const digest = crypto
    .createHash("sha256")
    .update("arepo-browser-pairing-code-v1")
    .update("\0")
    .update(pairingCodeId)
    .update("\0")
    .update(pairingCodeSecret)
    .digest("base64url");
  return `${BROWSER_PAIRING_CODE_HASH_SCHEME}:${digest}`;
}

export function verifyBrowserPairingCode(input: {
  pairingCodeId: string;
  pairingCodeSecret: string | Buffer;
  pairingCodeHash: string;
}): boolean {
  const actual = Buffer.from(
    hashBrowserPairingCode({
      pairingCodeId: input.pairingCodeId,
      pairingCodeSecret: input.pairingCodeSecret,
    }),
    "utf8",
  );
  const expected = Buffer.from(input.pairingCodeHash, "utf8");
  return constantTimeEqual(actual, expected);
}

export function assessBrowserPairingCodeStatus(
  record: BrowserPairingCodeRecordState,
  nowMs: number,
): BrowserPairingCodeStatus {
  if (record.revokedAtMs !== null) return "revoked";
  if (record.consumedAtMs !== null) return "consumed";
  if (record.failedAttemptCount >= record.maxFailedAttempts) return "locked";
  if (record.expiresAtMs <= nowMs) return "expired";
  return "active";
}

export function isBrowserPairingCodeActive(
  record: BrowserPairingCodeRecordState,
  nowMs: number,
): boolean {
  return assessBrowserPairingCodeStatus(record, nowMs) === "active";
}

function normalizePairingCodeId(pairingCodeId: string): string {
  if (typeof pairingCodeId !== "string" || pairingCodeId.trim().length === 0) {
    throw new Error("Browser pairing code id must be a non-empty string.");
  }
  return pairingCodeId;
}

function normalizePairingCodeSecret(pairingCodeSecret: string | Buffer): Buffer {
  const secret = Buffer.isBuffer(pairingCodeSecret)
    ? Buffer.from(pairingCodeSecret)
    : Buffer.from(pairingCodeSecret, "utf8");
  if (secret.length === 0) {
    throw new Error("Browser pairing code secret must be non-empty.");
  }
  return secret;
}
