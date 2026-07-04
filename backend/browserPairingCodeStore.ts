import {
  assessBrowserPairingCodeStatus,
  generateBrowserPairingCodeId,
  generateBrowserPairingCodeSecret,
  hashBrowserPairingCode,
  verifyBrowserPairingCode,
  type BrowserPairingCodeStatus,
} from "./browserPairingCodeVerifier.js";

export const BROWSER_PAIRING_CODE_STORE_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_PAIRING_CODE_STORE_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_PAIRING_CODE_STORE_WIRED_INTO_ROUTES = false;

export type BrowserPairingCodeClock = () => number;

export type BrowserPairingCodeRecord = {
  pairingCodeId: string;
  pairingCodeHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  consumedAtMs: number | null;
  revokedAtMs: number | null;
  failedAttemptCount: number;
  maxFailedAttempts: number;
  subjectId?: string;
  deviceLabel?: string;
  originHint?: string;
};

export type PublicBrowserPairingCodeSummary = {
  pairingCodeId: string;
  createdAtMs: number;
  expiresAtMs: number;
  consumedAtMs: number | null;
  revokedAtMs: number | null;
  failedAttemptCount: number;
  maxFailedAttempts: number;
  status: BrowserPairingCodeStatus;
  subjectId?: string;
  deviceLabel?: string;
  originHint?: string;
};

export type BrowserPairingCodeStoreDiagnostics = {
  implementation: "in-memory-test-primitive";
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  totalCodeCount: number;
  activeCodeCount: number;
  expiredCodeCount: number;
  revokedCodeCount: number;
  consumedCodeCount: number;
  lockedCodeCount: number;
  codes: readonly PublicBrowserPairingCodeSummary[];
  networkExposureSafe: false;
};

export type CreateBrowserPairingCodeRecordInput = {
  pairingCodeSecret?: string | Buffer;
  ttlMs?: number;
  expiresAtMs?: number;
  pairingCodeId?: string;
  maxFailedAttempts?: number;
  subjectId?: string;
  deviceLabel?: string;
  originHint?: string;
};

export type CreatedBrowserPairingCode = {
  record: BrowserPairingCodeRecord;
  pairingCodeSecret: string;
};

export type BrowserPairingCodeVerificationResult =
  | {
      ok: true;
      record: BrowserPairingCodeRecord;
    }
  | {
      ok: false;
      reason:
        | "missing-code"
        | "wrong-code"
        | "expired-code"
        | "revoked-code"
        | "consumed-code"
        | "locked-code";
      failedAttemptCount?: number;
    };

export type InMemoryBrowserPairingCodeStore = {
  createPairingCode(input?: CreateBrowserPairingCodeRecordInput): CreatedBrowserPairingCode;
  getPairingCode(pairingCodeId: string): BrowserPairingCodeRecord | undefined;
  verifyPairingCode(
    pairingCodeId: string,
    pairingCodeSecret: string | Buffer,
  ): BrowserPairingCodeVerificationResult;
  consumePairingCode(
    pairingCodeId: string,
    pairingCodeSecret: string | Buffer,
  ): BrowserPairingCodeVerificationResult;
  revokePairingCode(pairingCodeId: string): BrowserPairingCodeRecord | undefined;
  revokePairingCodesForSubject(subjectId: string): number;
  pruneInactive(): number;
  listPublicSummaries(): readonly PublicBrowserPairingCodeSummary[];
  diagnostics(): BrowserPairingCodeStoreDiagnostics;
};

export function createInMemoryBrowserPairingCodeStore(
  options: {
    clock?: BrowserPairingCodeClock;
  } = {},
): InMemoryBrowserPairingCodeStore {
  const clock = options.clock ?? Date.now;
  const codes = new Map<string, BrowserPairingCodeRecord>();

  function now(): number {
    return clock();
  }

  function clone(record: BrowserPairingCodeRecord): BrowserPairingCodeRecord {
    return { ...record };
  }

  function updateStored(record: BrowserPairingCodeRecord): BrowserPairingCodeRecord {
    codes.set(record.pairingCodeId, record);
    return clone(record);
  }

  function publicSummary(record: BrowserPairingCodeRecord): PublicBrowserPairingCodeSummary {
    return {
      pairingCodeId: record.pairingCodeId,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
      consumedAtMs: record.consumedAtMs,
      revokedAtMs: record.revokedAtMs,
      failedAttemptCount: record.failedAttemptCount,
      maxFailedAttempts: record.maxFailedAttempts,
      status: assessBrowserPairingCodeStatus(record, now()),
      subjectId: record.subjectId,
      deviceLabel: record.deviceLabel,
      originHint: record.originHint,
    };
  }

  function verifyExistingRecord(
    record: BrowserPairingCodeRecord,
    pairingCodeSecret: string | Buffer,
  ): BrowserPairingCodeVerificationResult {
    const status = assessBrowserPairingCodeStatus(record, now());
    if (status === "revoked") return { ok: false, reason: "revoked-code" };
    if (status === "consumed") return { ok: false, reason: "consumed-code" };
    if (status === "locked") return { ok: false, reason: "locked-code" };
    if (status === "expired") return { ok: false, reason: "expired-code" };
    if (
      !verifyBrowserPairingCode({
        pairingCodeId: record.pairingCodeId,
        pairingCodeSecret,
        pairingCodeHash: record.pairingCodeHash,
      })
    ) {
      record.failedAttemptCount += 1;
      return {
        ok: false,
        reason:
          record.failedAttemptCount >= record.maxFailedAttempts ? "locked-code" : "wrong-code",
        failedAttemptCount: record.failedAttemptCount,
      };
    }
    return { ok: true, record: clone(record) };
  }

  return {
    createPairingCode(input = {}) {
      const createdAtMs = now();
      const expiresAtMs = resolveExpiresAtMs(input, createdAtMs);
      const pairingCodeId = input.pairingCodeId ?? generateBrowserPairingCodeId();
      const pairingCodeSecret =
        input.pairingCodeSecret === undefined
          ? generateBrowserPairingCodeSecret()
          : normalizePairingCodeSecretForReturn(input.pairingCodeSecret);
      if (codes.has(pairingCodeId)) {
        throw new Error("Browser pairing code id already exists.");
      }
      const record: BrowserPairingCodeRecord = {
        pairingCodeId,
        pairingCodeHash: hashBrowserPairingCode({
          pairingCodeId,
          pairingCodeSecret,
        }),
        createdAtMs,
        expiresAtMs,
        consumedAtMs: null,
        revokedAtMs: null,
        failedAttemptCount: 0,
        maxFailedAttempts: normalizeMaxFailedAttempts(input.maxFailedAttempts),
        subjectId: sanitizeHint(input.subjectId),
        deviceLabel: sanitizeHint(input.deviceLabel),
        originHint: sanitizeHint(input.originHint),
      };
      codes.set(pairingCodeId, record);
      return { record: clone(record), pairingCodeSecret };
    },

    getPairingCode(pairingCodeId) {
      const record = codes.get(pairingCodeId);
      return record ? clone(record) : undefined;
    },

    verifyPairingCode(pairingCodeId, pairingCodeSecret) {
      const record = codes.get(pairingCodeId);
      if (!record) return { ok: false, reason: "missing-code" };
      const result = verifyExistingRecord(record, pairingCodeSecret);
      if (!result.ok && (result.reason === "wrong-code" || result.reason === "locked-code")) {
        updateStored(record);
      }
      return result;
    },

    consumePairingCode(pairingCodeId, pairingCodeSecret) {
      const record = codes.get(pairingCodeId);
      if (!record) return { ok: false, reason: "missing-code" };
      const result = verifyExistingRecord(record, pairingCodeSecret);
      if (!result.ok) {
        if (result.reason === "wrong-code" || result.reason === "locked-code") updateStored(record);
        return result;
      }
      record.consumedAtMs = now();
      return { ok: true, record: updateStored(record) };
    },

    revokePairingCode(pairingCodeId) {
      const record = codes.get(pairingCodeId);
      if (!record) return undefined;
      if (record.revokedAtMs === null) record.revokedAtMs = now();
      return updateStored(record);
    },

    revokePairingCodesForSubject(subjectId) {
      const normalizedSubjectId = normalizeSubjectId(subjectId);
      let revoked = 0;
      for (const record of codes.values()) {
        if (record.subjectId !== normalizedSubjectId || record.revokedAtMs !== null) continue;
        record.revokedAtMs = now();
        revoked += 1;
      }
      return revoked;
    },

    pruneInactive() {
      const cutoff = now();
      let pruned = 0;
      for (const [pairingCodeId, record] of codes.entries()) {
        if (record.expiresAtMs > cutoff && record.consumedAtMs === null) continue;
        codes.delete(pairingCodeId);
        pruned += 1;
      }
      return pruned;
    },

    listPublicSummaries() {
      return Array.from(codes.values(), publicSummary);
    },

    diagnostics() {
      const summaries = Array.from(codes.values(), publicSummary);
      return {
        implementation: "in-memory-test-primitive",
        wiredIntoAuthorization: false,
        wiredIntoRoutes: false,
        totalCodeCount: summaries.length,
        activeCodeCount: summaries.filter((code) => code.status === "active").length,
        expiredCodeCount: summaries.filter((code) => code.status === "expired").length,
        revokedCodeCount: summaries.filter((code) => code.status === "revoked").length,
        consumedCodeCount: summaries.filter((code) => code.status === "consumed").length,
        lockedCodeCount: summaries.filter((code) => code.status === "locked").length,
        codes: summaries,
        networkExposureSafe: false,
      };
    },
  };
}

function resolveExpiresAtMs(
  input: CreateBrowserPairingCodeRecordInput,
  createdAtMs: number,
): number {
  if (input.expiresAtMs !== undefined) {
    if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= createdAtMs) {
      throw new Error("Browser pairing code expiresAtMs must be after createdAtMs.");
    }
    return input.expiresAtMs;
  }
  const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("Browser pairing code ttlMs must be positive.");
  }
  return createdAtMs + ttlMs;
}

function normalizeMaxFailedAttempts(maxFailedAttempts: number | undefined): number {
  const value = maxFailedAttempts ?? 5;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Browser pairing code maxFailedAttempts must be a positive integer.");
  }
  return value;
}

function normalizeSubjectId(subjectId: string): string {
  if (typeof subjectId !== "string" || subjectId.trim().length === 0) {
    throw new Error("Browser pairing code subject id must be a non-empty string.");
  }
  return subjectId;
}

function normalizePairingCodeSecretForReturn(pairingCodeSecret: string | Buffer): string {
  const secret = Buffer.isBuffer(pairingCodeSecret)
    ? pairingCodeSecret.toString("utf8")
    : pairingCodeSecret;
  if (secret.length === 0) {
    throw new Error("Browser pairing code secret must be non-empty.");
  }
  return secret;
}

function sanitizeHint(hint: string | undefined): string | undefined {
  if (hint === undefined) return undefined;
  const trimmed = hint.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, 120);
}
