import {
  assessBrowserCsrfTokenStatus,
  generateBrowserCsrfTokenId,
  hashBrowserCsrfToken,
  verifyBrowserCsrfToken,
  type BrowserCsrfTokenStatus,
} from "./browserCsrfTokenVerifier.js";

export const BROWSER_CSRF_TOKEN_STORE_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_CSRF_TOKEN_STORE_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_CSRF_TOKEN_STORE_WIRED_INTO_ROUTES = false;

export type BrowserCsrfTokenClock = () => number;

export type BrowserCsrfTokenRecord = {
  csrfTokenId: string;
  sessionId: string;
  tokenHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
  consumedAtMs: number | null;
  originHint?: string;
};

export type PublicBrowserCsrfTokenSummary = {
  csrfTokenId: string;
  sessionId: string;
  createdAtMs: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
  consumedAtMs: number | null;
  status: BrowserCsrfTokenStatus;
  originHint?: string;
};

export type BrowserCsrfTokenStoreDiagnostics = {
  implementation: "in-memory-test-primitive";
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  totalTokenCount: number;
  activeTokenCount: number;
  expiredTokenCount: number;
  revokedTokenCount: number;
  consumedTokenCount: number;
  tokens: readonly PublicBrowserCsrfTokenSummary[];
  networkExposureSafe: false;
};

export type CreateBrowserCsrfTokenRecordInput = {
  sessionId: string;
  tokenSecret: string | Buffer;
  ttlMs?: number;
  expiresAtMs?: number;
  csrfTokenId?: string;
  originHint?: string;
};

export type BrowserCsrfTokenVerificationResult =
  | {
      ok: true;
      record: BrowserCsrfTokenRecord;
    }
  | {
      ok: false;
      reason:
        "missing-token" | "wrong-token" | "expired-token" | "revoked-token" | "consumed-token";
    };

export type InMemoryBrowserCsrfTokenStore = {
  createToken(input: CreateBrowserCsrfTokenRecordInput): BrowserCsrfTokenRecord;
  getToken(csrfTokenId: string): BrowserCsrfTokenRecord | undefined;
  listTokensForSession(sessionId: string): readonly BrowserCsrfTokenRecord[];
  verifyToken(
    csrfTokenId: string,
    tokenSecret: string | Buffer,
  ): BrowserCsrfTokenVerificationResult;
  consumeToken(csrfTokenId: string): BrowserCsrfTokenRecord | undefined;
  revokeToken(csrfTokenId: string): BrowserCsrfTokenRecord | undefined;
  revokeTokensForSession(sessionId: string): number;
  pruneExpired(): number;
  listPublicSummaries(): readonly PublicBrowserCsrfTokenSummary[];
  diagnostics(): BrowserCsrfTokenStoreDiagnostics;
};

export function createInMemoryBrowserCsrfTokenStore(
  options: {
    clock?: BrowserCsrfTokenClock;
  } = {},
): InMemoryBrowserCsrfTokenStore {
  const clock = options.clock ?? Date.now;
  const tokens = new Map<string, BrowserCsrfTokenRecord>();

  function now(): number {
    return clock();
  }

  function clone(record: BrowserCsrfTokenRecord): BrowserCsrfTokenRecord {
    return { ...record };
  }

  function updateStored(record: BrowserCsrfTokenRecord): BrowserCsrfTokenRecord {
    tokens.set(record.csrfTokenId, record);
    return clone(record);
  }

  function publicSummary(record: BrowserCsrfTokenRecord): PublicBrowserCsrfTokenSummary {
    return {
      csrfTokenId: record.csrfTokenId,
      sessionId: record.sessionId,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
      revokedAtMs: record.revokedAtMs,
      consumedAtMs: record.consumedAtMs,
      status: assessBrowserCsrfTokenStatus(record, now()),
      originHint: record.originHint,
    };
  }

  return {
    createToken(input) {
      const createdAtMs = now();
      const expiresAtMs = resolveExpiresAtMs(input, createdAtMs);
      const csrfTokenId = input.csrfTokenId ?? generateBrowserCsrfTokenId();
      const sessionId = normalizeSessionId(input.sessionId);
      if (tokens.has(csrfTokenId)) {
        throw new Error("Browser CSRF token id already exists.");
      }
      const record: BrowserCsrfTokenRecord = {
        csrfTokenId,
        sessionId,
        tokenHash: hashBrowserCsrfToken({
          csrfTokenId,
          tokenSecret: input.tokenSecret,
        }),
        createdAtMs,
        expiresAtMs,
        revokedAtMs: null,
        consumedAtMs: null,
        originHint: sanitizeHint(input.originHint),
      };
      tokens.set(csrfTokenId, record);
      return clone(record);
    },

    getToken(csrfTokenId) {
      const record = tokens.get(csrfTokenId);
      return record ? clone(record) : undefined;
    },

    listTokensForSession(sessionId) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      return Array.from(tokens.values())
        .filter((record) => record.sessionId === normalizedSessionId)
        .map(clone);
    },

    verifyToken(csrfTokenId, tokenSecret) {
      const record = tokens.get(csrfTokenId);
      if (!record) return { ok: false, reason: "missing-token" };
      const status = assessBrowserCsrfTokenStatus(record, now());
      if (status === "revoked") return { ok: false, reason: "revoked-token" };
      if (status === "consumed") return { ok: false, reason: "consumed-token" };
      if (status === "expired") return { ok: false, reason: "expired-token" };
      if (
        !verifyBrowserCsrfToken({
          csrfTokenId,
          tokenSecret,
          tokenHash: record.tokenHash,
        })
      ) {
        return { ok: false, reason: "wrong-token" };
      }
      return { ok: true, record: clone(record) };
    },

    consumeToken(csrfTokenId) {
      const record = tokens.get(csrfTokenId);
      if (!record) return undefined;
      if (record.consumedAtMs === null) record.consumedAtMs = now();
      return updateStored(record);
    },

    revokeToken(csrfTokenId) {
      const record = tokens.get(csrfTokenId);
      if (!record) return undefined;
      if (record.revokedAtMs === null) record.revokedAtMs = now();
      return updateStored(record);
    },

    revokeTokensForSession(sessionId) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      let revoked = 0;
      for (const record of tokens.values()) {
        if (record.sessionId !== normalizedSessionId || record.revokedAtMs !== null) continue;
        record.revokedAtMs = now();
        revoked += 1;
      }
      return revoked;
    },

    pruneExpired() {
      const cutoff = now();
      let pruned = 0;
      for (const [csrfTokenId, record] of tokens.entries()) {
        if (record.expiresAtMs > cutoff) continue;
        tokens.delete(csrfTokenId);
        pruned += 1;
      }
      return pruned;
    },

    listPublicSummaries() {
      return Array.from(tokens.values(), publicSummary);
    },

    diagnostics() {
      const summaries = Array.from(tokens.values(), publicSummary);
      return {
        implementation: "in-memory-test-primitive",
        wiredIntoAuthorization: false,
        wiredIntoRoutes: false,
        totalTokenCount: summaries.length,
        activeTokenCount: summaries.filter((token) => token.status === "active").length,
        expiredTokenCount: summaries.filter((token) => token.status === "expired").length,
        revokedTokenCount: summaries.filter((token) => token.status === "revoked").length,
        consumedTokenCount: summaries.filter((token) => token.status === "consumed").length,
        tokens: summaries,
        networkExposureSafe: false,
      };
    },
  };
}

function resolveExpiresAtMs(input: CreateBrowserCsrfTokenRecordInput, createdAtMs: number): number {
  if (input.expiresAtMs !== undefined) {
    if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= createdAtMs) {
      throw new Error("Browser CSRF token expiresAtMs must be after createdAtMs.");
    }
    return input.expiresAtMs;
  }
  const ttlMs = input.ttlMs ?? 10 * 60 * 1000;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("Browser CSRF token ttlMs must be positive.");
  }
  return createdAtMs + ttlMs;
}

function normalizeSessionId(sessionId: string): string {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new Error("Browser CSRF token session id must be a non-empty string.");
  }
  return sessionId;
}

function sanitizeHint(hint: string | undefined): string | undefined {
  if (hint === undefined) return undefined;
  const trimmed = hint.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, 120);
}
