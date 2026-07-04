import {
  assessBrowserSessionVerifierStatus,
  generateBrowserSessionId,
  hashBrowserSessionVerifier,
  verifyBrowserSessionVerifier,
  type BrowserSessionVerifierStatus,
} from "./browserSessionVerifier.js";

export const BROWSER_SESSION_STORE_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_SESSION_STORE_WIRED_INTO_AUTHORIZATION = false;

export type BrowserSessionClock = () => number;

export type BrowserSessionRecord = {
  sessionId: string;
  subjectId: string;
  verifierHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
  lastUsedAtMs: number | null;
  userAgentHint?: string;
  originHint?: string;
};

export type PublicBrowserSessionSummary = {
  sessionId: string;
  subjectId: string;
  createdAtMs: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
  lastUsedAtMs: number | null;
  status: BrowserSessionVerifierStatus;
  userAgentHint?: string;
  originHint?: string;
};

export type BrowserSessionStoreDiagnostics = {
  implementation: "in-memory-test-primitive";
  wiredIntoAuthorization: false;
  totalSessionCount: number;
  activeSessionCount: number;
  expiredSessionCount: number;
  revokedSessionCount: number;
  sessions: readonly PublicBrowserSessionSummary[];
  networkExposureSafe: false;
};

export type CreateBrowserSessionRecordInput = {
  subjectId: string;
  verifierSecret: string | Buffer;
  ttlMs?: number;
  expiresAtMs?: number;
  sessionId?: string;
  userAgentHint?: string;
  originHint?: string;
};

export type BrowserSessionVerificationResult =
  | {
      ok: true;
      record: BrowserSessionRecord;
    }
  | {
      ok: false;
      reason: "missing-session" | "wrong-verifier" | "expired-session" | "revoked-session";
    };

export type InMemoryBrowserSessionStore = {
  createSession(input: CreateBrowserSessionRecordInput): BrowserSessionRecord;
  getSession(sessionId: string): BrowserSessionRecord | undefined;
  verifySession(
    sessionId: string,
    verifierSecret: string | Buffer,
  ): BrowserSessionVerificationResult;
  revokeSession(sessionId: string): BrowserSessionRecord | undefined;
  revokeAllForSubject(subjectId: string): number;
  pruneExpired(): number;
  listPublicSummaries(): readonly PublicBrowserSessionSummary[];
  diagnostics(): BrowserSessionStoreDiagnostics;
};

export function createInMemoryBrowserSessionStore(
  options: {
    clock?: BrowserSessionClock;
  } = {},
): InMemoryBrowserSessionStore {
  const clock = options.clock ?? Date.now;
  const sessions = new Map<string, BrowserSessionRecord>();

  function now(): number {
    return clock();
  }

  function clone(record: BrowserSessionRecord): BrowserSessionRecord {
    return { ...record };
  }

  function updateStored(record: BrowserSessionRecord): BrowserSessionRecord {
    sessions.set(record.sessionId, record);
    return clone(record);
  }

  function publicSummary(record: BrowserSessionRecord): PublicBrowserSessionSummary {
    return {
      sessionId: record.sessionId,
      subjectId: record.subjectId,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
      revokedAtMs: record.revokedAtMs,
      lastUsedAtMs: record.lastUsedAtMs,
      status: assessBrowserSessionVerifierStatus(record, now()),
      userAgentHint: record.userAgentHint,
      originHint: record.originHint,
    };
  }

  return {
    createSession(input) {
      const createdAtMs = now();
      const expiresAtMs = resolveExpiresAtMs(input, createdAtMs);
      const sessionId = input.sessionId ?? generateBrowserSessionId();
      const subjectId = normalizeSubjectId(input.subjectId);
      if (sessions.has(sessionId)) {
        throw new Error("Browser session id already exists.");
      }
      const record: BrowserSessionRecord = {
        sessionId,
        subjectId,
        verifierHash: hashBrowserSessionVerifier({
          sessionId,
          verifierSecret: input.verifierSecret,
        }),
        createdAtMs,
        expiresAtMs,
        revokedAtMs: null,
        lastUsedAtMs: null,
        userAgentHint: sanitizeHint(input.userAgentHint),
        originHint: sanitizeHint(input.originHint),
      };
      sessions.set(sessionId, record);
      return clone(record);
    },

    getSession(sessionId) {
      const record = sessions.get(sessionId);
      return record ? clone(record) : undefined;
    },

    verifySession(sessionId, verifierSecret) {
      const record = sessions.get(sessionId);
      if (!record) return { ok: false, reason: "missing-session" };
      const status = assessBrowserSessionVerifierStatus(record, now());
      if (status === "revoked") return { ok: false, reason: "revoked-session" };
      if (status === "expired") return { ok: false, reason: "expired-session" };
      if (
        !verifyBrowserSessionVerifier({
          sessionId,
          verifierSecret,
          verifierHash: record.verifierHash,
        })
      ) {
        return { ok: false, reason: "wrong-verifier" };
      }
      record.lastUsedAtMs = now();
      return { ok: true, record: clone(record) };
    },

    revokeSession(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) return undefined;
      if (record.revokedAtMs === null) record.revokedAtMs = now();
      return updateStored(record);
    },

    revokeAllForSubject(subjectId) {
      const normalizedSubjectId = normalizeSubjectId(subjectId);
      let revoked = 0;
      for (const record of sessions.values()) {
        if (record.subjectId !== normalizedSubjectId || record.revokedAtMs !== null) continue;
        record.revokedAtMs = now();
        revoked += 1;
      }
      return revoked;
    },

    pruneExpired() {
      const cutoff = now();
      let pruned = 0;
      for (const [sessionId, record] of sessions.entries()) {
        if (record.expiresAtMs > cutoff) continue;
        sessions.delete(sessionId);
        pruned += 1;
      }
      return pruned;
    },

    listPublicSummaries() {
      return Array.from(sessions.values(), publicSummary);
    },

    diagnostics() {
      const summaries = Array.from(sessions.values(), publicSummary);
      return {
        implementation: "in-memory-test-primitive",
        wiredIntoAuthorization: false,
        totalSessionCount: summaries.length,
        activeSessionCount: summaries.filter((session) => session.status === "active").length,
        expiredSessionCount: summaries.filter((session) => session.status === "expired").length,
        revokedSessionCount: summaries.filter((session) => session.status === "revoked").length,
        sessions: summaries,
        networkExposureSafe: false,
      };
    },
  };
}

function resolveExpiresAtMs(input: CreateBrowserSessionRecordInput, createdAtMs: number): number {
  if (input.expiresAtMs !== undefined) {
    if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= createdAtMs) {
      throw new Error("Browser session expiresAtMs must be after createdAtMs.");
    }
    return input.expiresAtMs;
  }
  const ttlMs = input.ttlMs ?? 30 * 60 * 1000;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("Browser session ttlMs must be positive.");
  }
  return createdAtMs + ttlMs;
}

function normalizeSubjectId(subjectId: string): string {
  if (typeof subjectId !== "string" || subjectId.trim().length === 0) {
    throw new Error("Browser session subject id must be a non-empty string.");
  }
  return subjectId;
}

function sanitizeHint(hint: string | undefined): string | undefined {
  if (hint === undefined) return undefined;
  const trimmed = hint.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, 120);
}
