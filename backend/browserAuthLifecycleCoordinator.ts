import {
  buildBrowserAuthAuditEvent,
  createInMemoryBrowserAuthAuditSink,
  type BrowserAuthAuditEvent,
  type InMemoryBrowserAuthAuditSink,
} from "./browserAuthAuditEvents.js";
import {
  createInMemoryBrowserCsrfTokenStore,
  type BrowserCsrfTokenVerificationResult,
  type InMemoryBrowserCsrfTokenStore,
} from "./browserCsrfTokenStore.js";
import { generateBrowserCsrfTokenSecret } from "./browserCsrfTokenVerifier.js";
import {
  getBrowserCookiePolicyDiagnostics,
  plannedBrowserCsrfCookiePolicy,
  plannedBrowserSessionCookiePolicy,
  type PlannedBrowserCookiePolicy,
} from "./browserCookiePolicy.js";
import {
  createInMemoryBrowserPairingCodeStore,
  type BrowserPairingCodeVerificationResult,
  type InMemoryBrowserPairingCodeStore,
} from "./browserPairingCodeStore.js";
import {
  createInMemoryBrowserSessionStore,
  type BrowserSessionVerificationResult,
  type InMemoryBrowserSessionStore,
} from "./browserSessionStore.js";
import { generateBrowserSessionVerifierSecret } from "./browserSessionVerifier.js";

export const BROWSER_AUTH_LIFECYCLE_COORDINATOR_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_LIFECYCLE_COORDINATOR_MOUNTED = false;
export const BROWSER_AUTH_LIFECYCLE_COORDINATOR_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_LIFECYCLE_COORDINATOR_WIRED_INTO_ROUTES = false;

export type BrowserAuthLifecycleClock = () => number;

export type BrowserAuthLifecycleCoordinatorDiagnostics = {
  status: "inactive";
  implementation: "in-memory-test-primitive";
  mounted: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  issuesLiveCookies: false;
  acceptsCookies: false;
  enablesBrowserSessions: false;
  usesSanitizedAuditEvents: true;
  pairingCodeCount: number;
  activePairingCodeCount: number;
  sessionCount: number;
  activeSessionCount: number;
  csrfTokenCount: number;
  activeCsrfTokenCount: number;
  auditEventCount: number;
  networkExposureSafe: false;
};

export type BrowserAuthLifecycleCookieMetadata = {
  sessionCookie: PlannedBrowserCookiePolicy;
  csrfCookie: PlannedBrowserCookiePolicy;
  emitsSetCookieHeader: false;
  acceptsCookieCredential: false;
};

export type CreateLifecyclePairingCodeInput = {
  subjectId: string;
  deviceLabel?: string;
  originHint?: string;
  ttlMs?: number;
  maxFailedAttempts?: number;
  pairingCodeId?: string;
  pairingCodeSecret?: string | Buffer;
};

export type CreatedLifecyclePairingCode = {
  ok: true;
  pairingCodeId: string;
  pairingCodeSecret: string;
  expiresAtMs: number;
};

export type LifecyclePairingFailureReason =
  "missing-code" | "wrong-code" | "expired-code" | "revoked-code" | "consumed-code" | "locked-code";

export type LifecycleSessionFailureReason =
  LifecyclePairingFailureReason | "missing-session" | "expired-session" | "revoked-session";

export type LifecycleCsrfFailureReason =
  | "missing-session"
  | "expired-session"
  | "revoked-session"
  | (BrowserCsrfTokenVerificationResult extends { ok: false; reason: infer Reason }
      ? Reason
      : never);

export type ConsumedLifecyclePairingCode =
  | {
      ok: true;
      pairingCodeId: string;
      subjectId: string;
    }
  | {
      ok: false;
      reason: LifecyclePairingFailureReason;
      failedAttemptCount?: number;
    };

export type CreateLifecycleSessionInput = {
  pairingCodeId: string;
  pairingCodeSecret: string | Buffer;
  sessionVerifierSecret?: string | Buffer;
  sessionTtlMs?: number;
  sessionId?: string;
  userAgentHint?: string;
  originHint?: string;
};

export type CreatedLifecycleSession =
  | {
      ok: true;
      sessionId: string;
      subjectId: string;
      sessionVerifierSecret: string;
      expiresAtMs: number;
    }
  | {
      ok: false;
      reason: LifecyclePairingFailureReason;
      failedAttemptCount?: number;
    };

export type CreatedLifecycleCsrfToken =
  | {
      ok: true;
      csrfTokenId: string;
      sessionId: string;
      csrfTokenSecret: string;
      expiresAtMs: number;
    }
  | {
      ok: false;
      reason: LifecycleSessionFailureReason;
    };

export type BrowserAuthLifecycleCoordinator = {
  createPairingCode(input: CreateLifecyclePairingCodeInput): CreatedLifecyclePairingCode;
  consumePairingCode(
    pairingCodeId: string,
    pairingCodeSecret: string | Buffer,
  ): ConsumedLifecyclePairingCode;
  createSessionFromPairingCode(input: CreateLifecycleSessionInput): CreatedLifecycleSession;
  createCsrfTokenForSession(input: {
    sessionId: string;
    csrfTokenSecret?: string | Buffer;
    csrfTokenId?: string;
    ttlMs?: number;
    originHint?: string;
  }): CreatedLifecycleCsrfToken;
  verifySession(
    sessionId: string,
    sessionVerifierSecret: string | Buffer,
  ): BrowserSessionVerificationResult;
  verifyCsrfToken(
    csrfTokenId: string,
    csrfTokenSecret: string | Buffer,
  ): BrowserCsrfTokenVerificationResult;
  revokeSession(sessionId: string): { revokedSession: boolean; revokedCsrfTokenCount: number };
  revokeAllSessionsForSubject(subjectId: string): {
    revokedSessionCount: number;
    revokedCsrfTokenCount: number;
  };
  plannedCookieMetadata(): BrowserAuthLifecycleCookieMetadata;
  auditEvents(): readonly BrowserAuthAuditEvent[];
  diagnostics(): BrowserAuthLifecycleCoordinatorDiagnostics;
  stores: {
    pairingCodes: InMemoryBrowserPairingCodeStore;
    sessions: InMemoryBrowserSessionStore;
    csrfTokens: InMemoryBrowserCsrfTokenStore;
    audit: InMemoryBrowserAuthAuditSink;
  };
};

export function createInMemoryBrowserAuthLifecycleCoordinator(
  options: { clock?: BrowserAuthLifecycleClock } = {},
): BrowserAuthLifecycleCoordinator {
  const clock = options.clock ?? Date.now;
  const pairingCodes = createInMemoryBrowserPairingCodeStore({ clock });
  const sessions = createInMemoryBrowserSessionStore({ clock });
  const csrfTokens = createInMemoryBrowserCsrfTokenStore({ clock });
  const audit = createInMemoryBrowserAuthAuditSink();

  function appendAudit(
    input: Omit<Parameters<typeof buildBrowserAuthAuditEvent>[0], "eventId">,
  ): void {
    audit.append(buildBrowserAuthAuditEvent(input, { clock }));
  }

  function consumePairing(
    pairingCodeId: string,
    pairingCodeSecret: string | Buffer,
  ): ConsumedLifecyclePairingCode {
    const result = pairingCodes.consumePairingCode(pairingCodeId, pairingCodeSecret);
    if (!result.ok) {
      appendAudit({
        category: "pairing_code_rejected",
        reasonCode: result.reason,
        safeDetails: {
          operation: "consume-pairing-code",
          status: "rejected",
          reason: result.reason,
          failedAttemptCount: result.failedAttemptCount ?? null,
        },
      });
      return {
        ok: false,
        reason: result.reason,
        ...(result.failedAttemptCount === undefined
          ? {}
          : { failedAttemptCount: result.failedAttemptCount }),
      };
    }
    appendAudit({
      category: "pairing_code_consume_planned",
      subjectId: result.record.subjectId,
      reasonCode: "planned-consume",
      safeDetails: { operation: "consume-pairing-code", status: "planned" },
    });
    return {
      ok: true,
      pairingCodeId: result.record.pairingCodeId,
      subjectId: result.record.subjectId ?? "local-operator",
    };
  }

  return {
    createPairingCode(input) {
      const created = pairingCodes.createPairingCode(input);
      appendAudit({
        category: "pairing_code_issue_planned",
        subjectId: input.subjectId,
        reasonCode: "planned-issue",
        safeDetails: { operation: "issue-pairing-code", status: "planned" },
      });
      return {
        ok: true,
        pairingCodeId: created.record.pairingCodeId,
        pairingCodeSecret: created.pairingCodeSecret,
        expiresAtMs: created.record.expiresAtMs,
      };
    },

    consumePairingCode(pairingCodeId, pairingCodeSecret) {
      return consumePairing(pairingCodeId, pairingCodeSecret);
    },

    createSessionFromPairingCode(input) {
      const consumed = consumePairing(input.pairingCodeId, input.pairingCodeSecret);
      if (!consumed.ok) return consumed;
      const sessionVerifierSecret = normalizeSecretForReturn(
        input.sessionVerifierSecret ?? generateBrowserSessionVerifierSecret(),
      );
      const session = sessions.createSession({
        subjectId: consumed.subjectId,
        verifierSecret: sessionVerifierSecret,
        ttlMs: input.sessionTtlMs,
        sessionId: input.sessionId,
        userAgentHint: input.userAgentHint,
        originHint: input.originHint,
      });
      appendAudit({
        category: "session_issue_planned",
        subjectId: consumed.subjectId,
        sessionId: session.sessionId,
        reasonCode: "planned-issue",
        safeDetails: { operation: "issue-session", status: "planned" },
      });
      return {
        ok: true,
        sessionId: session.sessionId,
        subjectId: session.subjectId,
        sessionVerifierSecret,
        expiresAtMs: session.expiresAtMs,
      };
    },

    createCsrfTokenForSession(input) {
      const session = sessions.getSession(input.sessionId);
      const sessionStatus = sessionStatusReason(session, clock());
      if (sessionStatus !== null) {
        appendAudit({
          category: "csrf_rejected",
          sessionId: input.sessionId,
          reasonCode: sessionStatus,
          safeDetails: { operation: "issue-csrf-token", status: "rejected", reason: sessionStatus },
        });
        return { ok: false, reason: sessionStatus };
      }
      const csrfTokenSecret = normalizeSecretForReturn(
        input.csrfTokenSecret ?? generateBrowserCsrfTokenSecret(),
      );
      const token = csrfTokens.createToken({
        sessionId: input.sessionId,
        tokenSecret: csrfTokenSecret,
        ttlMs: input.ttlMs,
        csrfTokenId: input.csrfTokenId,
        originHint: input.originHint,
      });
      appendAudit({
        category: "csrf_issue_planned",
        sessionId: input.sessionId,
        reasonCode: "planned-issue",
        safeDetails: { operation: "issue-csrf-token", status: "planned" },
      });
      return {
        ok: true,
        csrfTokenId: token.csrfTokenId,
        sessionId: token.sessionId,
        csrfTokenSecret,
        expiresAtMs: token.expiresAtMs,
      };
    },

    verifySession(sessionId, sessionVerifierSecret) {
      return sessions.verifySession(sessionId, sessionVerifierSecret);
    },

    verifyCsrfToken(csrfTokenId, csrfTokenSecret) {
      return csrfTokens.verifyToken(csrfTokenId, csrfTokenSecret);
    },

    revokeSession(sessionId) {
      const revokedSession = sessions.revokeSession(sessionId);
      const revokedCsrfTokenCount = csrfTokens.revokeTokensForSession(sessionId);
      appendAudit({
        category: "session_revoke_planned",
        sessionId,
        reasonCode: revokedSession ? "planned-revoke" : "missing-session",
        safeDetails: {
          operation: "revoke-session",
          status: revokedSession ? "planned" : "rejected",
          count: revokedCsrfTokenCount,
        },
      });
      return { revokedSession: Boolean(revokedSession), revokedCsrfTokenCount };
    },

    revokeAllSessionsForSubject(subjectId) {
      const matchingSessions = sessions
        .listPublicSummaries()
        .filter((session) => session.subjectId === subjectId);
      const revokedSessionCount = sessions.revokeAllForSubject(subjectId);
      let revokedCsrfTokenCount = 0;
      for (const session of matchingSessions) {
        revokedCsrfTokenCount += csrfTokens.revokeTokensForSession(session.sessionId);
      }
      appendAudit({
        category: "session_revoke_planned",
        subjectId,
        reasonCode: "planned-revoke-all",
        safeDetails: {
          operation: "revoke-all-sessions",
          status: "planned",
          count: revokedSessionCount,
        },
      });
      return { revokedSessionCount, revokedCsrfTokenCount };
    },

    plannedCookieMetadata() {
      const sessionCookie = plannedBrowserSessionCookiePolicy();
      const csrfCookie = plannedBrowserCsrfCookiePolicy();
      if (!sessionCookie.ok || !csrfCookie.ok) {
        throw new Error("Planned browser cookie metadata failed validation.");
      }
      return {
        sessionCookie: sessionCookie.policy,
        csrfCookie: csrfCookie.policy,
        emitsSetCookieHeader: false,
        acceptsCookieCredential: false,
      };
    },

    auditEvents() {
      return audit.list();
    },

    diagnostics() {
      const pairingDiagnostics = pairingCodes.diagnostics();
      const sessionDiagnostics = sessions.diagnostics();
      const csrfDiagnostics = csrfTokens.diagnostics();
      const auditDiagnostics = audit.diagnostics();
      const cookieDiagnostics = getBrowserCookiePolicyDiagnostics();
      return {
        status: "inactive",
        implementation: "in-memory-test-primitive",
        mounted: false,
        wiredIntoAuthorization: false,
        wiredIntoRoutes: false,
        issuesLiveCookies: cookieDiagnostics.issuesCookies,
        acceptsCookies: cookieDiagnostics.acceptsCookies,
        enablesBrowserSessions: false,
        usesSanitizedAuditEvents: true,
        pairingCodeCount: pairingDiagnostics.totalCodeCount,
        activePairingCodeCount: pairingDiagnostics.activeCodeCount,
        sessionCount: sessionDiagnostics.totalSessionCount,
        activeSessionCount: sessionDiagnostics.activeSessionCount,
        csrfTokenCount: csrfDiagnostics.totalTokenCount,
        activeCsrfTokenCount: csrfDiagnostics.activeTokenCount,
        auditEventCount: auditDiagnostics.eventCount,
        networkExposureSafe: false,
      };
    },

    stores: {
      pairingCodes,
      sessions,
      csrfTokens,
      audit,
    },
  };
}

function sessionStatusReason(
  session: ReturnType<InMemoryBrowserSessionStore["getSession"]>,
  nowMs: number,
): "missing-session" | "expired-session" | "revoked-session" | null {
  if (!session) return "missing-session";
  if (session.revokedAtMs !== null) return "revoked-session";
  if (session.expiresAtMs <= nowMs) return "expired-session";
  return null;
}

function normalizeSecretForReturn(secret: string | Buffer): string {
  const value = Buffer.isBuffer(secret) ? secret.toString("utf8") : secret;
  if (value.length === 0) throw new Error("Browser auth lifecycle secret must be non-empty.");
  return value;
}
