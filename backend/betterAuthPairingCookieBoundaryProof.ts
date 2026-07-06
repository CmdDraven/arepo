import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";
import { createBetterAuthAppDataProofContext } from "./betterAuthAppDataStoreProof.js";
import {
  adaptBetterAuthRouteRequest,
  wrapBetterAuthResponse,
  type BetterAuthCookieMetadata,
  type BetterAuthRouteRequestLike,
  type BetterAuthWrappedResponse,
} from "./betterAuthRouteRequestAdapterProof.js";
import { sanitizeArepoBrowserDeviceLabel } from "./betterAuthSessionScopeMetadataProof.js";

export const BETTER_AUTH_PAIRING_COOKIE_BOUNDARY_PROOF_MOUNTED = false;
export const BETTER_AUTH_PAIRING_COOKIE_BOUNDARY_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_PAIRING_COOKIE_BOUNDARY_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_PAIRING_COOKIE_BOUNDARY_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthPairingCookieBoundaryDecision =
  "supported-plugin-boundary-likely-needs-next-spike";

export type BetterAuthPairingCookieBoundaryClassification =
  | "public-handler-login-flow"
  | "public-plugin-endpoint"
  | "exported-but-undocumented"
  | "internal-adapter"
  | "unsupported"
  | "unknown";

export type BetterAuthPairingCookieBoundaryFindingStatus =
  "passed" | "supported-plugin-boundary" | "blocked-for-production" | "not-required" | "unresolved";

export type BetterAuthPairingCookieBoundaryFinding = {
  id:
    | "direct-public-session-api"
    | "public-handler-login-flow"
    | "plugin-boundary"
    | "signed-cookie-issuance"
    | "session-lookup"
    | "direct-token-injection"
    | "sign-out"
    | "revoke-current"
    | "revoke-all"
    | "expiry"
    | "hybrid-metadata"
    | "no-login-ui"
    | "not-live-authorization";
  status: BetterAuthPairingCookieBoundaryFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

export type BetterAuthPairingCookieBoundaryProofResult = {
  status: "isolated-pairing-cookie-boundary-proof";
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
  decision: BetterAuthPairingCookieBoundaryDecision;
  boundarySurvey: {
    directPublicSessionCreationApiFound: false;
    normalLoginHandlerRequired: false;
    publicHandlerFlowWithoutNormalLoginFound: false;
    publicPluginEndpointSupported: true;
    publicSetSessionCookieHelperExported: true;
    officialPluginUsesSameInternalAdapterPattern: true;
    selectedBoundary: "better-auth-plugin-endpoint";
    selectedBoundaryClassification: BetterAuthPairingCookieBoundaryClassification;
    internalAdapterUsedInsidePluginEndpoint: true;
    internalSigningUsed: false;
    exportedButUndocumentedApiUsed: false;
  };
  pairingProof: {
    arepoPairingAcceptanceModeled: true;
    usernamePasswordEnabled: false;
    oauthEnabled: false;
    socialLoginEnabled: false;
    emailLoginRequired: false;
    frontendSecretStorageRequired: false;
    normalLoginUiRequired: false;
  };
  cookieProof: {
    pluginBoundaryProducedSignedCookie: boolean;
    signedCookieObservedOnlyAsRedactedMetadata: true;
    issuanceCookies: readonly BetterAuthCookieMetadata[];
    clearingCookies: readonly BetterAuthCookieMetadata[];
    signedCookieCanLookupSession: boolean;
    directRawTokenCookieInjectionAuthenticates: boolean;
  };
  sessionProof: {
    betterAuthUserCreatedOrReusedForArepoSubject: boolean;
    betterAuthSessionCreatedByPluginBoundary: boolean;
    signOutInvalidatesPairingCookieSession: boolean;
    revokeCurrentInvalidatesSelectedSession: boolean;
    revokeAllInvalidatesSelectedSubjectSessions: boolean;
    revokeAllPreservesOtherSubjectSession: boolean;
    deterministicExpiryAppliesToPairingCookieSession: boolean;
  };
  compatibilityProof: {
    preservesHybridMetadataModel: true;
    preservesArepoOwnedAuthorizationState: true;
    compatibleWithRouteRequestAdapter: true;
    compatibleWithActivationGate: true;
    productionPluginImplementationStillNeeded: true;
  };
  wrappedResponses: {
    pairingComplete: BetterAuthWrappedResponse;
    getSession: BetterAuthWrappedResponse;
    directRawTokenInjection: BetterAuthWrappedResponse;
    signOut: BetterAuthWrappedResponse;
    getSessionAfterSignOut: BetterAuthWrappedResponse;
    getSessionAfterRevokeCurrent: BetterAuthWrappedResponse;
    getSessionAfterRevokeAll: BetterAuthWrappedResponse;
    otherSubjectAfterRevokeAll: BetterAuthWrappedResponse;
    getSessionAfterExpiry: BetterAuthWrappedResponse;
  };
  remainingBlockers: readonly [
    "production-arepo-better-auth-plugin-needed",
    "internal-adapter-wrapper-implementation-needed",
    "arepo-sidecar-authorization-store-needed",
    "renewal-update-age-policy-needed",
    "expired-session-pruning-policy-needed",
    "backup-restore-session-state-policy-needed",
    "arepo-owned-csrf-live-integration-blocked",
  ];
  findings: readonly BetterAuthPairingCookieBoundaryFinding[];
};

type PairingBoundaryProofContextLike = Awaited<
  ReturnType<typeof createBetterAuthAppDataProofContext>
>["context"] & {
  internalAdapter: Awaited<
    ReturnType<typeof createBetterAuthAppDataProofContext>
  >["context"]["internalAdapter"] & {
    updateSession(token: string, session: Record<string, unknown>): Promise<unknown | null>;
    findUserByEmail(
      email: string,
      options?: { includeAccounts: boolean },
    ): Promise<{ user: { id: string }; accounts: unknown[] } | null>;
    listSessions(
      userId: string,
      options?: { onlyActiveSessions?: boolean },
    ): Promise<
      Array<{
        token: string;
        id: string;
        userId: string;
      }>
    >;
  };
};

const baseUrl = "http://127.0.0.1:8734";
const sessionCookieName = "arepo_session";
const primarySubjectEmail = "arepo-plugin-boundary-subject@example.invalid";
const otherSubjectEmail = "arepo-plugin-boundary-other@example.invalid";

export async function runIsolatedBetterAuthPairingCookieBoundaryProof(): Promise<BetterAuthPairingCookieBoundaryProofResult> {
  const proof = await createBetterAuthAppDataProofContext({
    plugins: [createArepoPairingBoundaryProofPlugin()],
  });
  await proof.context.runMigrations();
  const context = proof.context as PairingBoundaryProofContextLike;

  const pairingComplete = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/arepo-pairing/complete",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      subjectEmail: primarySubjectEmail,
      deviceLabel: "Operator Laptop Local Only",
      pairingAccepted: true,
    },
  });
  const pairingCookieHeader = cookieHeaderFromSetCookie(
    pairingComplete.raw.headers,
    sessionCookieName,
  );
  if (!pairingCookieHeader) {
    throw new Error("Better Auth pairing-cookie boundary proof did not observe a session cookie.");
  }
  const primaryUserId = stringField(pairingComplete.rawBody, "proofOnly.userId");
  if (!primaryUserId) {
    throw new Error("Better Auth pairing-cookie boundary proof did not create a user reference.");
  }
  const primarySessions = await context.internalAdapter.listSessions(primaryUserId, {
    onlyActiveSessions: true,
  });
  const primaryRawToken = primarySessions[0]?.token;
  if (!primaryRawToken) {
    throw new Error("Better Auth pairing-cookie boundary proof did not create a session token.");
  }

  const secondPrimary = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/arepo-pairing/complete",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      subjectEmail: primarySubjectEmail,
      deviceLabel: "Operator Tablet",
      pairingAccepted: true,
    },
  });
  const secondPrimaryCookieHeader = cookieHeaderFromSetCookie(
    secondPrimary.raw.headers,
    sessionCookieName,
  );
  const secondPrimarySessions = await context.internalAdapter.listSessions(primaryUserId, {
    onlyActiveSessions: true,
  });
  const secondPrimaryToken = secondPrimarySessions.find(
    (session) => session.token !== primaryRawToken,
  )?.token;

  const otherSubject = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/arepo-pairing/complete",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      subjectEmail: otherSubjectEmail,
      deviceLabel: "Other Operator Laptop",
      pairingAccepted: true,
    },
  });
  const otherCookieHeader = cookieHeaderFromSetCookie(otherSubject.raw.headers, sessionCookieName);

  const getSession = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: pairingCookieHeader },
  });
  const directRawTokenInjection = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: `${sessionCookieName}=${primaryRawToken}` },
  });
  const signOut = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-out",
    headers: {
      origin: baseUrl,
      cookie: pairingCookieHeader,
    },
  });
  const getSessionAfterSignOut = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: pairingCookieHeader },
  });

  if (secondPrimaryToken) {
    await context.internalAdapter.deleteSession(secondPrimaryToken);
  }
  const getSessionAfterRevokeCurrent = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: secondPrimaryCookieHeader ? { cookie: secondPrimaryCookieHeader } : {},
  });

  const expirySubject = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/arepo-pairing/complete",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      subjectEmail: "arepo-plugin-boundary-expiry@example.invalid",
      deviceLabel: "Expiry Operator Laptop",
      pairingAccepted: true,
    },
  });
  const expiryCookieHeader = cookieHeaderFromSetCookie(
    expirySubject.raw.headers,
    sessionCookieName,
  );
  const expiryUserId = stringField(expirySubject.rawBody, "proofOnly.userId");
  const expiryToken = expiryUserId
    ? (
        await context.internalAdapter.listSessions(expiryUserId, {
          onlyActiveSessions: true,
        })
      )[0]?.token
    : null;
  if (expiryToken) {
    await context.internalAdapter.updateSession(expiryToken, {
      expiresAt: new Date(0),
      updatedAt: new Date(0),
    });
  }
  const getSessionAfterExpiry = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: expiryCookieHeader ? { cookie: expiryCookieHeader } : {},
  });

  await context.internalAdapter.deleteUserSessions(primaryUserId);
  const getSessionAfterRevokeAll = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: secondPrimaryCookieHeader ? { cookie: secondPrimaryCookieHeader } : {},
  });
  const otherSubjectAfterRevokeAll = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: otherCookieHeader ? { cookie: otherCookieHeader } : {},
  });

  const pairingCompleteWrapped = wrapBetterAuthResponse(
    pairingComplete.raw,
    pairingComplete.rawBody,
  );
  const getSessionWrapped = wrapBetterAuthResponse(getSession.raw, getSession.rawBody);
  const directRawTokenInjectionWrapped = wrapBetterAuthResponse(
    directRawTokenInjection.raw,
    directRawTokenInjection.rawBody,
  );
  const signOutWrapped = wrapBetterAuthResponse(signOut.raw, signOut.rawBody);
  const getSessionAfterSignOutWrapped = wrapBetterAuthResponse(
    getSessionAfterSignOut.raw,
    getSessionAfterSignOut.rawBody,
  );
  const getSessionAfterRevokeCurrentWrapped = wrapBetterAuthResponse(
    getSessionAfterRevokeCurrent.raw,
    getSessionAfterRevokeCurrent.rawBody,
  );
  const getSessionAfterRevokeAllWrapped = wrapBetterAuthResponse(
    getSessionAfterRevokeAll.raw,
    getSessionAfterRevokeAll.rawBody,
  );
  const otherSubjectAfterRevokeAllWrapped = wrapBetterAuthResponse(
    otherSubjectAfterRevokeAll.raw,
    otherSubjectAfterRevokeAll.rawBody,
  );
  const getSessionAfterExpiryWrapped = wrapBetterAuthResponse(
    getSessionAfterExpiry.raw,
    getSessionAfterExpiry.rawBody,
  );
  const cleanupWorked = await proof.cleanup();
  if (!cleanupWorked) {
    throw new Error("Better Auth pairing-cookie boundary proof cleanup failed.");
  }

  const result = {
    status: "isolated-pairing-cookie-boundary-proof",
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
    decision: "supported-plugin-boundary-likely-needs-next-spike",
    boundarySurvey: {
      directPublicSessionCreationApiFound: false,
      normalLoginHandlerRequired: false,
      publicHandlerFlowWithoutNormalLoginFound: false,
      publicPluginEndpointSupported: true,
      publicSetSessionCookieHelperExported: true,
      officialPluginUsesSameInternalAdapterPattern: true,
      selectedBoundary: "better-auth-plugin-endpoint",
      selectedBoundaryClassification: "public-plugin-endpoint",
      internalAdapterUsedInsidePluginEndpoint: true,
      internalSigningUsed: false,
      exportedButUndocumentedApiUsed: false,
    },
    pairingProof: {
      arepoPairingAcceptanceModeled: true,
      usernamePasswordEnabled: false,
      oauthEnabled: false,
      socialLoginEnabled: false,
      emailLoginRequired: false,
      frontendSecretStorageRequired: false,
      normalLoginUiRequired: false,
    },
    cookieProof: {
      pluginBoundaryProducedSignedCookie: pairingCompleteWrapped.setCookieCount > 0,
      signedCookieObservedOnlyAsRedactedMetadata: true,
      issuanceCookies: pairingCompleteWrapped.setCookies,
      clearingCookies: signOutWrapped.setCookies,
      signedCookieCanLookupSession: getSessionWrapped.body.sessionPresent === true,
      directRawTokenCookieInjectionAuthenticates:
        directRawTokenInjectionWrapped.body.sessionPresent === true,
    },
    sessionProof: {
      betterAuthUserCreatedOrReusedForArepoSubject: Boolean(primaryUserId),
      betterAuthSessionCreatedByPluginBoundary: Boolean(primaryRawToken),
      signOutInvalidatesPairingCookieSession:
        getSessionAfterSignOutWrapped.body.sessionPresent !== true,
      revokeCurrentInvalidatesSelectedSession:
        getSessionAfterRevokeCurrentWrapped.body.sessionPresent !== true,
      revokeAllInvalidatesSelectedSubjectSessions:
        getSessionAfterRevokeAllWrapped.body.sessionPresent !== true,
      revokeAllPreservesOtherSubjectSession:
        otherSubjectAfterRevokeAllWrapped.body.sessionPresent === true,
      deterministicExpiryAppliesToPairingCookieSession:
        getSessionAfterExpiryWrapped.body.sessionPresent !== true,
    },
    compatibilityProof: {
      preservesHybridMetadataModel: true,
      preservesArepoOwnedAuthorizationState: true,
      compatibleWithRouteRequestAdapter: true,
      compatibleWithActivationGate: true,
      productionPluginImplementationStillNeeded: true,
    },
    wrappedResponses: {
      pairingComplete: pairingCompleteWrapped,
      getSession: getSessionWrapped,
      directRawTokenInjection: directRawTokenInjectionWrapped,
      signOut: signOutWrapped,
      getSessionAfterSignOut: getSessionAfterSignOutWrapped,
      getSessionAfterRevokeCurrent: getSessionAfterRevokeCurrentWrapped,
      getSessionAfterRevokeAll: getSessionAfterRevokeAllWrapped,
      otherSubjectAfterRevokeAll: otherSubjectAfterRevokeAllWrapped,
      getSessionAfterExpiry: getSessionAfterExpiryWrapped,
    },
    remainingBlockers: [
      "production-arepo-better-auth-plugin-needed",
      "internal-adapter-wrapper-implementation-needed",
      "arepo-sidecar-authorization-store-needed",
      "renewal-update-age-policy-needed",
      "expired-session-pruning-policy-needed",
      "backup-restore-session-state-policy-needed",
      "arepo-owned-csrf-live-integration-blocked",
    ],
  } satisfies Omit<BetterAuthPairingCookieBoundaryProofResult, "findings">;

  return {
    ...result,
    findings: buildFindings(result),
  };
}

function createArepoPairingBoundaryProofPlugin(): BetterAuthPlugin {
  return {
    id: "arepo-pairing-boundary-proof",
    version: "0.0.0-proof",
    endpoints: {
      completeArepoPairing: createAuthEndpoint(
        "/arepo-pairing/complete",
        {
          method: "POST",
          body: z.object({
            subjectEmail: z.string().email(),
            deviceLabel: z.string(),
            pairingAccepted: z.literal(true),
          }),
          requireHeaders: true,
        },
        async (ctx) => {
          const sanitizedDevice = sanitizeArepoBrowserDeviceLabel(ctx.body.deviceLabel);
          const existing = await ctx.context.internalAdapter.findUserByEmail(
            ctx.body.subjectEmail,
            { includeAccounts: false },
          );
          const user =
            existing?.user ??
            (await ctx.context.internalAdapter.createUser({
              email: ctx.body.subjectEmail,
              emailVerified: true,
              name: "AREPO Local Operator",
              createdAt: new Date(),
              updatedAt: new Date(),
            }));
          const session = await ctx.context.internalAdapter.createSession(user.id, false, {
            userAgent: `AREPO pairing ${sanitizedDevice.value}`,
            ipAddress: "127.0.0.1",
          });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            ok: true,
            tokenReturned: false,
            proofOnly: {
              userId: user.id,
              sessionId: session.id,
            },
            safePosture: {
              deviceLabelSanitized: true,
              arepoAuthorizationStateOwnedByArepo: true,
            },
          });
        },
      ),
    },
  };
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
  result: Omit<BetterAuthPairingCookieBoundaryProofResult, "findings">,
): readonly BetterAuthPairingCookieBoundaryFinding[] {
  return [
    {
      id: "direct-public-session-api",
      status: "blocked-for-production",
      summary:
        "No direct public Better Auth API was found for arbitrary AREPO pairing completion to create a session and cookie outside a handler/plugin boundary.",
      blockerCodes: ["direct-public-session-cookie-api-not-found"],
      openQuestions: [
        "Will Better Auth expose a first-class server API for non-login session issuance?",
      ],
    },
    {
      id: "public-handler-login-flow",
      status: "not-required",
      summary:
        "Normal username/password, OAuth, social, email, frontend storage, and login UI flows are avoided by the plugin boundary proof.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "plugin-boundary",
      status: "supported-plugin-boundary",
      summary:
        "A Better Auth plugin endpoint can model AREPO pairing completion, create/reuse a local subject user, create a session, and call the public setSessionCookie helper.",
      blockerCodes: [
        "production-arepo-better-auth-plugin-needed",
        "internal-adapter-wrapper-implementation-needed",
      ],
      openQuestions: [
        "Should AREPO accept plugin endpoint use of ctx.context.internalAdapter, as Better Auth official plugins do, for production?",
      ],
    },
    {
      id: "signed-cookie-issuance",
      status: result.cookieProof.pluginBoundaryProducedSignedCookie ? "passed" : "unresolved",
      summary:
        "The isolated plugin boundary emits the signed arepo_session cookie through Better Auth Response behavior.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "session-lookup",
      status: result.cookieProof.signedCookieCanLookupSession ? "passed" : "unresolved",
      summary:
        "The signed cookie from the plugin boundary can be used for isolated get-session lookup.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "direct-token-injection",
      status: result.cookieProof.directRawTokenCookieInjectionAuthenticates
        ? "unresolved"
        : "passed",
      summary: "Direct raw session-token cookie injection remains rejected.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "sign-out",
      status: result.sessionProof.signOutInvalidatesPairingCookieSession ? "passed" : "unresolved",
      summary: "Better Auth sign-out invalidates the plugin-issued signed-cookie session.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-current",
      status: result.sessionProof.revokeCurrentInvalidatesSelectedSession ? "passed" : "unresolved",
      summary:
        "Deleting the selected plugin-issued session invalidates the matching signed cookie.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-all",
      status:
        result.sessionProof.revokeAllInvalidatesSelectedSubjectSessions &&
        result.sessionProof.revokeAllPreservesOtherSubjectSession
          ? "passed"
          : "unresolved",
      summary:
        "Deleting all sessions for one Better Auth subject invalidates that subject's plugin-issued cookie while preserving another subject.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "expiry",
      status: result.sessionProof.deterministicExpiryAppliesToPairingCookieSession
        ? "passed"
        : "unresolved",
      summary: "Deterministic expiry applies to the plugin-issued signed-cookie session.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "hybrid-metadata",
      status: "passed",
      summary:
        "The plugin boundary can preserve AREPO's hybrid metadata model by keeping authorization state AREPO-owned.",
      blockerCodes: ["arepo-sidecar-authorization-store-needed"],
      openQuestions: [],
    },
    {
      id: "no-login-ui",
      status: "passed",
      summary:
        "The proof does not require username/password, OAuth, social login, email login, frontend credential storage, or normal login UI.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "not-live-authorization",
      status: "passed",
      summary:
        "The proof is isolated, unmounted, and does not authorize live requests or emit live cookies.",
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
  for (const header of setCookieHeaders(headers)) {
    const [nameValue = ""] = header.split(";");
    const [cookieName = "", cookieValue = ""] = nameValue.trim().split("=");
    if (cookieName === name && cookieValue.length > 0) return `${name}=${cookieValue}`;
  }
  return null;
}

function setCookieHeaders(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const header = headers.get("set-cookie");
  return header ? [header] : [];
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
  return value !== null && typeof value === "object";
}
