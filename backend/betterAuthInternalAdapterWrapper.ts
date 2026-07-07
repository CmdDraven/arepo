export const BETTER_AUTH_INTERNAL_ADAPTER_WRAPPER_MOUNTED = false;
export const BETTER_AUTH_INTERNAL_ADAPTER_WRAPPER_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_INTERNAL_ADAPTER_WRAPPER_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_INTERNAL_ADAPTER_WRAPPER_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthInternalAdapterWrapperAllowedOperation =
  | "find-or-create-local-subject-user"
  | "create-session-for-accepted-arepo-pairing"
  | "return-redacted-user-session-references"
  | "lookup-session-for-wrapper-regression-tests"
  | "revoke-current-session-through-wrapper"
  | "revoke-all-subject-sessions-through-wrapper"
  | "observe-expiry-state-through-wrapper";

export type BetterAuthInternalAdapterWrapperForbiddenOperation =
  | "direct-token-signing"
  | "raw-session-token-return"
  | "raw-cookie-return"
  | "authorization-header-access"
  | "cookie-header-access"
  | "set-cookie-value-logging"
  | "arbitrary-internal-adapter-call"
  | "arbitrary-database-mutation"
  | "route-authorization-decision"
  | "frontend-provided-permission-state"
  | "vault-node-permission-cookie-storage"
  | "better-auth-session-object-as-authorization-policy"
  | "unsupported-better-auth-internal-api";

export type BetterAuthInternalAdapterUserRecord = {
  id: string;
  email?: string;
  name?: string;
};

export type BetterAuthInternalAdapterSessionRecord = {
  id: string;
  userId: string;
  expiresAt?: Date;
};

export type BetterAuthInternalAdapterWrapperAdapter = {
  findUserByEmail(
    email: string,
    options?: { includeAccounts?: boolean },
  ): Promise<{ user: BetterAuthInternalAdapterUserRecord; accounts?: unknown[] } | null>;
  createUser(input: {
    email: string;
    name: string;
  }): Promise<{ user: BetterAuthInternalAdapterUserRecord }>;
  createSession(
    userId: string,
    input: {
      expiresAt?: Date;
      metadata?: Record<string, string | number | boolean | null>;
    },
  ): Promise<BetterAuthInternalAdapterSessionRecord>;
  findSession(sessionId: string): Promise<BetterAuthInternalAdapterSessionRecord | null>;
  revokeSession(sessionId: string): Promise<boolean>;
  listSessions(userId: string): Promise<BetterAuthInternalAdapterSessionRecord[]>;
  revokeSessions(userId: string): Promise<number>;
};

export type BetterAuthSafeReference = {
  kind: "better-auth-user-reference" | "better-auth-session-reference";
  id: string;
  redacted: true;
};

export type BetterAuthInternalAdapterWrapperResult<T> =
  | {
      ok: true;
      status: "ok";
      value: T;
    }
  | {
      ok: false;
      status: "rejected";
      error: {
        code:
          | "better_auth_wrapper_missing_local_subject"
          | "better_auth_wrapper_invalid_reference"
          | "better_auth_wrapper_internal_failure";
        reason: string;
      };
    };

export type BetterAuthInternalAdapterWrapperDiagnostics = {
  status: "inactive";
  implementation: "narrow-better-auth-internal-adapter-wrapper";
  mounted: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  exposesRawSessionTokens: false;
  exposesCookies: false;
  performsRouteAuthorization: false;
  acceptsFrontendPermissionState: false;
  storesVaultNodePermissionsInBetterAuth: false;
  allowsArbitraryAdapterCalls: false;
  liveBrowserAuthEnabled: false;
  allowedOperations: readonly BetterAuthInternalAdapterWrapperAllowedOperation[];
  forbiddenOperations: readonly BetterAuthInternalAdapterWrapperForbiddenOperation[];
};

export type BetterAuthInternalAdapterWrapper = {
  diagnostics(): BetterAuthInternalAdapterWrapperDiagnostics;
  findOrCreateLocalSubjectUser(input: { localSubjectId: string; displayName?: string }): Promise<
    BetterAuthInternalAdapterWrapperResult<{
      userId: string;
      userReference: BetterAuthSafeReference;
      created: boolean;
    }>
  >;
  createSessionForAcceptedArepoPairing(input: {
    userId: string;
    localSubjectId: string;
    deviceLabel?: string;
    expiresAt?: Date;
  }): Promise<
    BetterAuthInternalAdapterWrapperResult<{
      sessionId: string;
      sessionReference: BetterAuthSafeReference;
      userReference: BetterAuthSafeReference;
    }>
  >;
  lookupSessionForWrapperRegressionTests(input: { sessionId: string }): Promise<
    BetterAuthInternalAdapterWrapperResult<{
      sessionReference: BetterAuthSafeReference | null;
      userReference: BetterAuthSafeReference | null;
      expired: boolean;
    }>
  >;
  revokeCurrentSessionThroughWrapper(input: { sessionId: string }): Promise<
    BetterAuthInternalAdapterWrapperResult<{
      sessionReference: BetterAuthSafeReference;
      revoked: boolean;
    }>
  >;
  revokeAllSubjectSessionsThroughWrapper(input: { userId: string }): Promise<
    BetterAuthInternalAdapterWrapperResult<{
      userReference: BetterAuthSafeReference;
      revokedSessionCount: number;
    }>
  >;
};

const allowedOperations: readonly BetterAuthInternalAdapterWrapperAllowedOperation[] = [
  "find-or-create-local-subject-user",
  "create-session-for-accepted-arepo-pairing",
  "return-redacted-user-session-references",
  "lookup-session-for-wrapper-regression-tests",
  "revoke-current-session-through-wrapper",
  "revoke-all-subject-sessions-through-wrapper",
  "observe-expiry-state-through-wrapper",
];

const forbiddenOperations: readonly BetterAuthInternalAdapterWrapperForbiddenOperation[] = [
  "direct-token-signing",
  "raw-session-token-return",
  "raw-cookie-return",
  "authorization-header-access",
  "cookie-header-access",
  "set-cookie-value-logging",
  "arbitrary-internal-adapter-call",
  "arbitrary-database-mutation",
  "route-authorization-decision",
  "frontend-provided-permission-state",
  "vault-node-permission-cookie-storage",
  "better-auth-session-object-as-authorization-policy",
  "unsupported-better-auth-internal-api",
];

export function createBetterAuthInternalAdapterWrapper(
  adapter: BetterAuthInternalAdapterWrapperAdapter,
): BetterAuthInternalAdapterWrapper {
  return {
    diagnostics,
    async findOrCreateLocalSubjectUser(input) {
      const localSubjectId = sanitizeIdentifier(input.localSubjectId);
      if (!localSubjectId) {
        return rejected("better_auth_wrapper_missing_local_subject", "missing-local-subject");
      }
      try {
        const email = localSubjectEmail(localSubjectId);
        const existing = await adapter.findUserByEmail(email, { includeAccounts: false });
        if (existing) {
          return {
            ok: true,
            status: "ok",
            value: {
              userId: existing.user.id,
              userReference: safeUserReference(existing.user.id),
              created: false,
            },
          };
        }
        const created = await adapter.createUser({
          email,
          name: sanitizeDisplayName(input.displayName) ?? "AREPO local operator",
        });
        return {
          ok: true,
          status: "ok",
          value: {
            userId: created.user.id,
            userReference: safeUserReference(created.user.id),
            created: true,
          },
        };
      } catch {
        return rejected(
          "better_auth_wrapper_internal_failure",
          "internal-adapter-operation-failed",
        );
      }
    },
    async createSessionForAcceptedArepoPairing(input) {
      const userId = sanitizeIdentifier(input.userId);
      const localSubjectId = sanitizeIdentifier(input.localSubjectId);
      if (!userId || !localSubjectId) {
        return rejected(
          "better_auth_wrapper_invalid_reference",
          "invalid-user-or-subject-reference",
        );
      }
      try {
        const session = await adapter.createSession(userId, {
          expiresAt: input.expiresAt,
          metadata: {
            localSubjectId,
            deviceLabel: sanitizeDisplayName(input.deviceLabel) ?? "unlabeled-browser",
            acceptedArepoPairing: true,
          },
        });
        return {
          ok: true,
          status: "ok",
          value: {
            sessionId: session.id,
            sessionReference: safeSessionReference(session.id),
            userReference: safeUserReference(session.userId),
          },
        };
      } catch {
        return rejected(
          "better_auth_wrapper_internal_failure",
          "internal-adapter-operation-failed",
        );
      }
    },
    async lookupSessionForWrapperRegressionTests(input) {
      const sessionId = sanitizeIdentifier(input.sessionId);
      if (!sessionId) {
        return rejected("better_auth_wrapper_invalid_reference", "invalid-session-reference");
      }
      try {
        const session = await adapter.findSession(sessionId);
        return {
          ok: true,
          status: "ok",
          value: {
            sessionReference: session ? safeSessionReference(session.id) : null,
            userReference: session ? safeUserReference(session.userId) : null,
            expired: session?.expiresAt ? session.expiresAt.getTime() <= Date.now() : false,
          },
        };
      } catch {
        return rejected(
          "better_auth_wrapper_internal_failure",
          "internal-adapter-operation-failed",
        );
      }
    },
    async revokeCurrentSessionThroughWrapper(input) {
      const sessionId = sanitizeIdentifier(input.sessionId);
      if (!sessionId) {
        return rejected("better_auth_wrapper_invalid_reference", "invalid-session-reference");
      }
      try {
        const revoked = await adapter.revokeSession(sessionId);
        return {
          ok: true,
          status: "ok",
          value: {
            sessionReference: safeSessionReference(sessionId),
            revoked,
          },
        };
      } catch {
        return rejected(
          "better_auth_wrapper_internal_failure",
          "internal-adapter-operation-failed",
        );
      }
    },
    async revokeAllSubjectSessionsThroughWrapper(input) {
      const userId = sanitizeIdentifier(input.userId);
      if (!userId) {
        return rejected("better_auth_wrapper_invalid_reference", "invalid-user-reference");
      }
      try {
        const revokedSessionCount = await adapter.revokeSessions(userId);
        return {
          ok: true,
          status: "ok",
          value: {
            userReference: safeUserReference(userId),
            revokedSessionCount,
          },
        };
      } catch {
        return rejected(
          "better_auth_wrapper_internal_failure",
          "internal-adapter-operation-failed",
        );
      }
    },
  };
}

export function diagnostics(): BetterAuthInternalAdapterWrapperDiagnostics {
  return {
    status: "inactive",
    implementation: "narrow-better-auth-internal-adapter-wrapper",
    mounted: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    exposesRawSessionTokens: false,
    exposesCookies: false,
    performsRouteAuthorization: false,
    acceptsFrontendPermissionState: false,
    storesVaultNodePermissionsInBetterAuth: false,
    allowsArbitraryAdapterCalls: false,
    liveBrowserAuthEnabled: false,
    allowedOperations,
    forbiddenOperations,
  };
}

function localSubjectEmail(localSubjectId: string): string {
  return `arepo-local-${localSubjectId}@local.arepo.invalid`;
}

function safeUserReference(userId: string): BetterAuthSafeReference {
  return {
    kind: "better-auth-user-reference",
    id: `user:${redactedIdentifier(userId)}`,
    redacted: true,
  };
}

function safeSessionReference(sessionId: string): BetterAuthSafeReference {
  return {
    kind: "better-auth-session-reference",
    id: `session:${redactedIdentifier(sessionId)}`,
    redacted: true,
  };
}

function redactedIdentifier(value: string): string {
  const clean = sanitizeIdentifier(value) ?? "unknown";
  return clean.length <= 8 ? clean : `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

function sanitizeIdentifier(value: string | undefined): string | null {
  if (!value) return null;
  const clean = value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 96);
  return clean.length > 0 ? clean : null;
}

function sanitizeDisplayName(value: string | undefined): string | null {
  if (!value) return null;
  const clean = value
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .replace(/token|secret|cookie|authorization|csrf|pairing|verifier|hash|salt/gi, "redacted")
    .trim()
    .slice(0, 80);
  return clean.length > 0 ? clean : null;
}

function rejected(
  code: BetterAuthInternalAdapterWrapperResult<never> extends infer Result
    ? Result extends { ok: false; error: { code: infer Code } }
      ? Code
      : never
    : never,
  reason: string,
): BetterAuthInternalAdapterWrapperResult<never> {
  return {
    ok: false,
    status: "rejected",
    error: { code, reason },
  };
}
