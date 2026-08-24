import { createBetterAuthAppDataProofContext } from "./betterAuthAppDataStoreProof.js";
import {
  adaptBetterAuthRouteRequest,
  wrapBetterAuthResponse,
  type BetterAuthCookieMetadata,
  type BetterAuthRouteRequestLike,
  type BetterAuthWrappedResponse,
} from "./betterAuthRouteRequestAdapterProof.js";

export const BETTER_AUTH_DETERMINISTIC_EXPIRY_PROOF_MOUNTED = false;
export const BETTER_AUTH_DETERMINISTIC_EXPIRY_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_DETERMINISTIC_EXPIRY_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_DETERMINISTIC_EXPIRY_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthDeterministicExpiryProofFindingStatus =
  "passed" | "proven-through-internal-adapter" | "needs-adapter-spike" | "unresolved";

export type BetterAuthDeterministicExpiryProofFinding = {
  id:
    | "bounded-session-lifetime-configured"
    | "expiry-metadata-inspection"
    | "app-data-expiry-filter"
    | "signed-cookie-expiry"
    | "no-slow-real-time-wait"
    | "renewal-update-age-recorded"
    | "logout-revoke-distinct-from-expiry"
    | "expired-session-cleanup"
    | "backup-restore-expiry-risk"
    | "not-live-authorization";
  status: BetterAuthDeterministicExpiryProofFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

export type BetterAuthDeterministicExpiryProofResult = {
  status: "isolated-deterministic-expiry-proof";
  packageName: "better-auth";
  liveBrowserAuthEnabled: false;
  mountedInServer: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsLiveSetCookieHeaders: false;
  acceptsCookieCredentialsInLiveAuth: false;
  parsesCookiesForLiveAuthorization: false;
  validatesCsrfInLiveAuthorization: false;
  changesBearerTokenProtectedMode: false;
  expiryConfig: {
    boundedSessionLifetimeConfigured: boolean;
    expirySeconds: number;
    refreshUpdateAgeSeconds: number;
    sessionRenewalMayExtendExpiry: boolean;
    disableRefreshUsedForProofLookups: true;
  };
  proofMethod: {
    slowRealTimeWaitUsed: false;
    clockInjectionSupported: false;
    databaseTimestampManipulationUsed: false;
    internalAdapterExpiryOverrideUsed: true;
    requestResponseBoundaryChecked: true;
    appDataBoundaryChecked: true;
  };
  appDataBoundary: {
    expiryMetadataPresent: boolean;
    expiredSessionExcludedFromActiveLookup: boolean;
    expiredSessionFindSessionStillReturnsRecord: boolean;
    safeExpiryClassification: "expired";
  };
  requestResponseBoundary: {
    signedCookieIssued: boolean;
    sessionLookupBeforeExpiryWorked: boolean;
    expiredSignedCookieSessionRejected: boolean;
    expiredLookupReturnedNull: boolean;
    expiredLookupClearingCookieObserved: boolean;
    cookieMetadata: {
      issued: readonly BetterAuthCookieMetadata[];
      expiredClearing: readonly BetterAuthCookieMetadata[];
      valueRedacted: true;
    };
  };
  revokeBoundary: {
    signOutStillClearsCookie: boolean;
    signOutDistinctFromExpiry: true;
  };
  cleanupPolicy: {
    betterAuthDeletesExpiredSessionOnGetSession: boolean;
    explicitPruningStillRecommended: true;
    backupRestoreCanRestoreUnexpiredSessions: true;
    restoredExpiredSessionsShouldStillFailLookup: true;
  };
  posture: {
    localhostOnly: "expiry-proof-compatible";
    futureSelfHost: "requires-current-auth-db-and-backup-restore-policy";
  };
  wrappedResponses: {
    getSessionBeforeExpiry: BetterAuthWrappedResponse;
    getSessionAfterExpiry: BetterAuthWrappedResponse;
    signOutControl: BetterAuthWrappedResponse;
  };
  findings: readonly BetterAuthDeterministicExpiryProofFinding[];
};

type ExpiryProofContextLike = Awaited<
  ReturnType<typeof createBetterAuthAppDataProofContext>
>["context"] & {
  internalAdapter: Awaited<
    ReturnType<typeof createBetterAuthAppDataProofContext>
  >["context"]["internalAdapter"] & {
    updateSession(token: string, session: Record<string, unknown>): Promise<unknown | null>;
  };
};

const baseUrl = "http://127.0.0.1:8734";
const sessionCookieName = "arepo_session";

export async function runIsolatedBetterAuthDeterministicExpiryProof(
  appDataDir: string,
): Promise<BetterAuthDeterministicExpiryProofResult> {
  const proof = await createBetterAuthAppDataProofContext({
    appDataDir,
    emailAndPasswordEnabled: true,
  });
  await proof.context.runMigrations();
  const context = proof.context as ExpiryProofContextLike;

  const signUp = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-up/email",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      email: "arepo-expiry-proof@example.invalid",
      password: "arepo-expiry-proof-password",
      name: "AREPO Expiry Proof",
    },
  });
  const issuedCookieHeader = cookieHeaderFromSetCookie(signUp.raw.headers, sessionCookieName);
  const issuedToken = stringField(signUp.rawBody, "token");

  const getSessionBeforeExpiry = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: {
      disableRefresh: "true",
      disableCookieCache: "true",
    },
    headers: issuedCookieHeader ? { cookie: issuedCookieHeader } : {},
  });

  const activeBeforeExpiry =
    issuedToken === null
      ? []
      : await context.internalAdapter.findSessions([issuedToken], { onlyActiveSessions: true });
  if (issuedToken !== null) {
    await context.internalAdapter.updateSession(issuedToken, {
      expiresAt: new Date(0),
      updatedAt: new Date(0),
    });
  }
  const expiredActiveLookup =
    issuedToken === null
      ? []
      : await context.internalAdapter.findSessions([issuedToken], { onlyActiveSessions: true });
  const expiredFindSession =
    issuedToken === null ? null : await context.internalAdapter.findSession(issuedToken);

  const getSessionAfterExpiry = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: {
      disableRefresh: "true",
      disableCookieCache: "true",
    },
    headers: issuedCookieHeader ? { cookie: issuedCookieHeader } : {},
  });
  const afterExpiryFindSession =
    issuedToken === null ? null : await context.internalAdapter.findSession(issuedToken);

  const signOutControl = await createSignOutControl(proof.auth.handler);
  const cleanupWorked = await proof.cleanup();
  if (!cleanupWorked) {
    throw new Error("Better Auth deterministic expiry proof cleanup failed.");
  }

  const beforeWrapped = wrapBetterAuthResponse(
    getSessionBeforeExpiry.raw,
    getSessionBeforeExpiry.rawBody,
  );
  const afterWrapped = wrapBetterAuthResponse(
    getSessionAfterExpiry.raw,
    getSessionAfterExpiry.rawBody,
  );
  const signOutWrapped = wrapBetterAuthResponse(signOutControl.raw, signOutControl.rawBody);
  const result = {
    status: "isolated-deterministic-expiry-proof",
    packageName: "better-auth",
    liveBrowserAuthEnabled: false,
    mountedInServer: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsLiveSetCookieHeaders: false,
    acceptsCookieCredentialsInLiveAuth: false,
    parsesCookiesForLiveAuthorization: false,
    validatesCsrfInLiveAuthorization: false,
    changesBearerTokenProtectedMode: false,
    expiryConfig: {
      boundedSessionLifetimeConfigured: context.sessionConfig.expiresIn > 0,
      expirySeconds: context.sessionConfig.expiresIn,
      refreshUpdateAgeSeconds: context.sessionConfig.updateAge,
      sessionRenewalMayExtendExpiry: context.sessionConfig.updateAge > 0,
      disableRefreshUsedForProofLookups: true,
    },
    proofMethod: {
      slowRealTimeWaitUsed: false,
      clockInjectionSupported: false,
      databaseTimestampManipulationUsed: false,
      internalAdapterExpiryOverrideUsed: true,
      requestResponseBoundaryChecked: true,
      appDataBoundaryChecked: true,
    },
    appDataBoundary: {
      expiryMetadataPresent: activeBeforeExpiry.length === 1,
      expiredSessionExcludedFromActiveLookup: expiredActiveLookup.length === 0,
      expiredSessionFindSessionStillReturnsRecord: expiredFindSession !== null,
      safeExpiryClassification: "expired",
    },
    requestResponseBoundary: {
      signedCookieIssued: issuedCookieHeader !== null,
      sessionLookupBeforeExpiryWorked: beforeWrapped.body.sessionPresent === true,
      expiredSignedCookieSessionRejected: afterWrapped.body.sessionPresent !== true,
      expiredLookupReturnedNull: getSessionAfterExpiry.rawBody === null,
      expiredLookupClearingCookieObserved: afterWrapped.setCookies.some(
        (cookie) => cookie.name === sessionCookieName && cookie.classification === "clearing",
      ),
      cookieMetadata: {
        issued: wrapBetterAuthResponse(signUp.raw, signUp.rawBody).setCookies,
        expiredClearing: afterWrapped.setCookies,
        valueRedacted: true,
      },
    },
    revokeBoundary: {
      signOutStillClearsCookie: signOutWrapped.setCookies.some(
        (cookie) => cookie.name === sessionCookieName && cookie.classification === "clearing",
      ),
      signOutDistinctFromExpiry: true,
    },
    cleanupPolicy: {
      betterAuthDeletesExpiredSessionOnGetSession: afterExpiryFindSession === null,
      explicitPruningStillRecommended: true,
      backupRestoreCanRestoreUnexpiredSessions: true,
      restoredExpiredSessionsShouldStillFailLookup: true,
    },
    posture: {
      localhostOnly: "expiry-proof-compatible",
      futureSelfHost: "requires-current-auth-db-and-backup-restore-policy",
    },
    wrappedResponses: {
      getSessionBeforeExpiry: beforeWrapped,
      getSessionAfterExpiry: afterWrapped,
      signOutControl: signOutWrapped,
    },
  } satisfies Omit<BetterAuthDeterministicExpiryProofResult, "findings">;

  return {
    ...result,
    findings: buildFindings(result),
  };
}

async function createSignOutControl(
  handler: (request: Request) => Promise<Response>,
): Promise<{ raw: Response; rawBody: unknown }> {
  const signUp = await callBetterAuthRoute(handler, {
    method: "POST",
    path: "/api/auth/sign-up/email",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      email: "arepo-expiry-signout-control@example.invalid",
      password: "arepo-expiry-signout-control-password",
      name: "AREPO Expiry Signout Control",
    },
  });
  const cookieHeader = cookieHeaderFromSetCookie(signUp.raw.headers, sessionCookieName);
  return callBetterAuthRoute(handler, {
    method: "POST",
    path: "/api/auth/sign-out",
    headers: {
      origin: baseUrl,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });
}

async function callBetterAuthRoute(
  handler: (request: Request) => Promise<Response>,
  input: BetterAuthRouteRequestLike,
): Promise<{ raw: Response; rawBody: unknown }> {
  const adapted = adaptBetterAuthRouteRequest(input);
  const raw = await handler(adapted.request);
  const rawBody = await safeJson(raw);
  return { raw, rawBody };
}

function buildFindings(
  result: Omit<BetterAuthDeterministicExpiryProofResult, "findings">,
): readonly BetterAuthDeterministicExpiryProofFinding[] {
  return [
    {
      id: "bounded-session-lifetime-configured",
      status: result.expiryConfig.boundedSessionLifetimeConfigured ? "passed" : "unresolved",
      summary: "Better Auth session lifetime is configured as a bounded value.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "expiry-metadata-inspection",
      status: result.appDataBoundary.expiryMetadataPresent ? "passed" : "unresolved",
      summary: "The app-data session boundary exposes expiry metadata without exposing tokens.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "app-data-expiry-filter",
      status: result.appDataBoundary.expiredSessionExcludedFromActiveLookup
        ? "passed"
        : "unresolved",
      summary: "Expired sessions are excluded from active app-data session lookup.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "signed-cookie-expiry",
      status: result.requestResponseBoundary.expiredSignedCookieSessionRejected
        ? "proven-through-internal-adapter"
        : "needs-adapter-spike",
      summary:
        "An expired stored session makes the signed-cookie get-session handler return null and clear the session cookie.",
      blockerCodes: [],
      openQuestions: [
        "Can the same expiry override be reached through a fully public Better Auth test boundary?",
      ],
    },
    {
      id: "no-slow-real-time-wait",
      status: result.proofMethod.slowRealTimeWaitUsed ? "unresolved" : "passed",
      summary: "The proof does not rely on slow wall-clock sleeps.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "renewal-update-age-recorded",
      status: "passed",
      summary:
        "Session updateAge is recorded; proof lookups disable refresh so renewal does not mask expiry.",
      blockerCodes: [],
      openQuestions: ["AREPO still needs a live renewal policy before activation."],
    },
    {
      id: "logout-revoke-distinct-from-expiry",
      status: result.revokeBoundary.signOutStillClearsCookie ? "passed" : "unresolved",
      summary: "Sign-out cookie clearing remains distinct from expiry rejection.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "expired-session-cleanup",
      status: result.cleanupPolicy.betterAuthDeletesExpiredSessionOnGetSession
        ? "passed"
        : "needs-adapter-spike",
      summary:
        "Better Auth deletes the expired stored session when get-session observes expiry; AREPO now keeps AREPO-owned sidecar pruning separate from Better Auth table cleanup.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "backup-restore-expiry-risk",
      status: "passed",
      summary:
        "Backup/restore risk remains a policy issue: stale auth DB state can restore non-expired sessions.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "not-live-authorization",
      status: "passed",
      summary: "The expiry proof is isolated and no result is live authorization.",
      blockerCodes: [],
      openQuestions: [],
    },
  ];
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.clone().text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function cookieHeaderFromSetCookie(headers: Headers, name: string): string | null {
  const value = cookieValueFromSetCookie(headers, name);
  return value ? `${name}=${value}` : null;
}

function cookieValueFromSetCookie(headers: Headers, name: string): string | null {
  const getSetCookie = headers.getSetCookie();
  const fallback = headers.get("set-cookie");
  const setCookies = getSetCookie.length > 0 ? getSetCookie : fallback ? [fallback] : [];
  for (const header of setCookies) {
    const [nameValue = ""] = header.split(";");
    const [cookieName = "", cookieValue = ""] = nameValue.trim().split("=");
    if (cookieName === name && cookieValue.length > 0) return cookieValue;
  }
  return null;
}

function stringField(body: unknown, path: string): string | null {
  const parts = path.split(".");
  let current: unknown = body;
  for (const part of parts) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return typeof current === "string" ? current : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
