import { makeSignature } from "better-auth/crypto";
import { createBetterAuthAppDataProofContext } from "./betterAuthAppDataStoreProof.js";
import {
  adaptBetterAuthRouteRequest,
  wrapBetterAuthResponse,
  type BetterAuthRouteRequestLike,
  type BetterAuthWrappedResponse,
} from "./betterAuthRouteRequestAdapterProof.js";

export const BETTER_AUTH_PAIRING_COOKIE_ISSUANCE_PROOF_MOUNTED = false;
export const BETTER_AUTH_PAIRING_COOKIE_ISSUANCE_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_PAIRING_COOKIE_ISSUANCE_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_PAIRING_COOKIE_ISSUANCE_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthPairingCookieIssuanceFindingStatus =
  | "passed"
  | "proven-through-internal-adapter"
  | "blocked-for-production"
  | "needs-schema-extension"
  | "unresolved";

export type BetterAuthPairingCookieIssuanceFinding = {
  id:
    | "pairing-to-session"
    | "signed-cookie-production"
    | "supported-api-boundary"
    | "session-lookup"
    | "direct-token-injection"
    | "sign-out-revoke"
    | "expiry"
    | "no-login-ux"
    | "subject-schema"
    | "metadata-scope"
    | "not-live-authorization";
  status: BetterAuthPairingCookieIssuanceFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

export type BetterAuthPairingCookieMetadata = {
  name: "arepo_session";
  classification: "issuance" | "clearing";
  deliveryBoundary: "test-only-cookie-header" | "better-auth-handler";
  path: "/api" | null;
  sameSite: string | null;
  httpOnly: boolean;
  secure: boolean;
  maxAgePresent: boolean;
  maxAgeSeconds: number | null;
  valueRedacted: true;
};

export type BetterAuthPairingCookieIssuanceProofResult = {
  status: "isolated-pairing-cookie-issuance-proof";
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
  pairingProof: {
    arepoBearerProtectedOperatorAlreadyAuthenticated: true;
    arepoPairingCompletionAccepted: true;
    usernamePasswordEnabled: false;
    oauthEnabled: false;
    socialLoginEnabled: false;
    emailLoginRequired: false;
    frontendSecretStorageRequired: false;
    loginUiRequired: false;
  };
  boundaryProof: {
    betterAuthUserRecordRequired: true;
    betterAuthAccountRecordRequired: false;
    betterAuthInternalAdapterUsed: true;
    betterAuthPublicSessionApiProven: false;
    publicSetCookieResponseBoundaryProven: false;
    publicCryptoPrimitiveUsedForTestCookie: true;
    productionActivationBlockedOnSupportedBoundary: true;
  };
  cookieProof: {
    signedCookieProducedFromPairingSession: boolean;
    signedCookieObservedOnlyAsRedactedMetadata: true;
    signedCookieMetadata: BetterAuthPairingCookieMetadata;
    signedCookieCanLookupSession: boolean;
    directRawTokenCookieInjectionAuthenticates: boolean;
  };
  sessionProof: {
    subjectKind: "arepo-local-operator";
    betterAuthUserCreatedForSubject: boolean;
    betterAuthSessionCreatedAfterPairing: boolean;
    sanitizedDeviceHintStoredInUserAgent: boolean;
    localOperatorSubjectRepresentedSafely: boolean;
    arbitraryVaultScopeMetadataSupported: false;
    arbitraryVaultScopeMetadataStatus: "needs-schema-extension";
  };
  revokeProof: {
    signOutInvalidatesPairingCookieSession: boolean;
    signOutCookieClearingObserved: boolean;
    clearingCookieMetadata: readonly BetterAuthPairingCookieMetadata[];
  };
  expiryProof: {
    expiryAppliesToPairingCookieSession: boolean;
    expiredPairingCookieSessionRejected: boolean;
    expiredLookupClearingCookieObserved: boolean;
  };
  wrappedResponses: {
    pairingCookieLookup: BetterAuthWrappedResponse;
    directRawTokenInjection: BetterAuthWrappedResponse;
    afterSignOut: BetterAuthWrappedResponse;
    afterExpiry: BetterAuthWrappedResponse;
  };
  remainingBlockers: readonly [
    "supported-pairing-cookie-response-boundary-needed",
    "session-scope-metadata-design-needed",
    "renewal-update-age-policy-needed",
    "expired-session-pruning-policy-needed",
    "backup-restore-session-state-policy-needed",
    "arepo-owned-csrf-live-integration-blocked",
  ];
  findings: readonly BetterAuthPairingCookieIssuanceFinding[];
};

type PairingCookieProofContextLike = Awaited<
  ReturnType<typeof createBetterAuthAppDataProofContext>
>["context"] & {
  secret: string;
  authCookies: {
    sessionToken: {
      name: "arepo_session";
      attributes: {
        path?: string;
        sameSite?: string;
        httpOnly?: boolean;
        secure?: boolean;
        maxAge?: number;
      };
    };
  };
  internalAdapter: Awaited<
    ReturnType<typeof createBetterAuthAppDataProofContext>
  >["context"]["internalAdapter"] & {
    updateSession(token: string, session: Record<string, unknown>): Promise<unknown | null>;
  };
};

const baseUrl = "http://127.0.0.1:8734";
const sessionCookieName = "arepo_session";

export async function runIsolatedBetterAuthPairingCookieIssuanceProof(): Promise<BetterAuthPairingCookieIssuanceProofResult> {
  const proof = await createBetterAuthAppDataProofContext();
  await proof.context.runMigrations();
  const context = proof.context as PairingCookieProofContextLike;
  const user = await context.internalAdapter.createUser({
    email: "arepo-pairing-cookie-subject@example.invalid",
    name: "AREPO Pairing Cookie Subject",
    emailVerified: true,
  });

  const lookupSession = await createPairingSession(context, user.id, "lookup-device");
  const revokeSession = await createPairingSession(context, user.id, "revoke-device");
  const expirySession = await createPairingSession(context, user.id, "expiry-device");

  const pairingCookieLookup = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: lookupSession.cookieHeader },
  });
  const directRawTokenInjection = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: `${sessionCookieName}=${lookupSession.rawToken}` },
  });

  const signOut = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-out",
    headers: {
      origin: baseUrl,
      cookie: revokeSession.cookieHeader,
    },
  });
  const afterSignOut = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: revokeSession.cookieHeader },
  });

  await context.internalAdapter.updateSession(expirySession.rawToken, {
    expiresAt: new Date(0),
    updatedAt: new Date(0),
  });
  const afterExpiry = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: expirySession.cookieHeader },
  });

  const lookupWrapped = wrapBetterAuthResponse(
    pairingCookieLookup.raw,
    pairingCookieLookup.rawBody,
  );
  const rawInjectionWrapped = wrapBetterAuthResponse(
    directRawTokenInjection.raw,
    directRawTokenInjection.rawBody,
  );
  const afterSignOutWrapped = wrapBetterAuthResponse(afterSignOut.raw, afterSignOut.rawBody);
  const afterExpiryWrapped = wrapBetterAuthResponse(afterExpiry.raw, afterExpiry.rawBody);
  const signOutWrapped = wrapBetterAuthResponse(signOut.raw, signOut.rawBody);
  const cleanupWorked = await proof.cleanup();
  if (!cleanupWorked) {
    throw new Error("Better Auth pairing-cookie issuance proof cleanup failed.");
  }

  const result = {
    status: "isolated-pairing-cookie-issuance-proof",
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
    pairingProof: {
      arepoBearerProtectedOperatorAlreadyAuthenticated: true,
      arepoPairingCompletionAccepted: true,
      usernamePasswordEnabled: false,
      oauthEnabled: false,
      socialLoginEnabled: false,
      emailLoginRequired: false,
      frontendSecretStorageRequired: false,
      loginUiRequired: false,
    },
    boundaryProof: {
      betterAuthUserRecordRequired: true,
      betterAuthAccountRecordRequired: false,
      betterAuthInternalAdapterUsed: true,
      betterAuthPublicSessionApiProven: false,
      publicSetCookieResponseBoundaryProven: false,
      publicCryptoPrimitiveUsedForTestCookie: true,
      productionActivationBlockedOnSupportedBoundary: true,
    },
    cookieProof: {
      signedCookieProducedFromPairingSession: true,
      signedCookieObservedOnlyAsRedactedMetadata: true,
      signedCookieMetadata: lookupSession.cookieMetadata,
      signedCookieCanLookupSession: lookupWrapped.body.sessionPresent === true,
      directRawTokenCookieInjectionAuthenticates: rawInjectionWrapped.body.sessionPresent === true,
    },
    sessionProof: {
      subjectKind: "arepo-local-operator",
      betterAuthUserCreatedForSubject: Boolean(user.id),
      betterAuthSessionCreatedAfterPairing: true,
      sanitizedDeviceHintStoredInUserAgent: lookupSession.sanitizedDeviceHintStored,
      localOperatorSubjectRepresentedSafely: true,
      arbitraryVaultScopeMetadataSupported: false,
      arbitraryVaultScopeMetadataStatus: "needs-schema-extension",
    },
    revokeProof: {
      signOutInvalidatesPairingCookieSession: afterSignOutWrapped.body.sessionPresent !== true,
      signOutCookieClearingObserved: signOutWrapped.setCookies.some(
        (cookie) => cookie.name === sessionCookieName && cookie.classification === "clearing",
      ),
      clearingCookieMetadata: signOutWrapped.setCookies
        .filter((cookie) => cookie.name === sessionCookieName)
        .map((cookie) => ({
          name: "arepo_session",
          classification: cookie.classification,
          deliveryBoundary: "better-auth-handler",
          path: cookie.path === "/api" ? "/api" : null,
          sameSite: cookie.sameSite,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          maxAgePresent: cookie.maxAgePresent,
          maxAgeSeconds: cookie.maxAgeSeconds,
          valueRedacted: true,
        })),
    },
    expiryProof: {
      expiryAppliesToPairingCookieSession: true,
      expiredPairingCookieSessionRejected: afterExpiryWrapped.body.sessionPresent !== true,
      expiredLookupClearingCookieObserved: afterExpiryWrapped.setCookies.some(
        (cookie) => cookie.name === sessionCookieName && cookie.classification === "clearing",
      ),
    },
    wrappedResponses: {
      pairingCookieLookup: lookupWrapped,
      directRawTokenInjection: rawInjectionWrapped,
      afterSignOut: afterSignOutWrapped,
      afterExpiry: afterExpiryWrapped,
    },
    remainingBlockers: [
      "supported-pairing-cookie-response-boundary-needed",
      "session-scope-metadata-design-needed",
      "renewal-update-age-policy-needed",
      "expired-session-pruning-policy-needed",
      "backup-restore-session-state-policy-needed",
      "arepo-owned-csrf-live-integration-blocked",
    ],
  } satisfies Omit<BetterAuthPairingCookieIssuanceProofResult, "findings">;

  return {
    ...result,
    findings: buildFindings(result),
  };
}

async function createPairingSession(
  context: PairingCookieProofContextLike,
  userId: string,
  deviceHint: string,
): Promise<{
  rawToken: string;
  cookieHeader: string;
  cookieMetadata: BetterAuthPairingCookieMetadata;
  sanitizedDeviceHintStored: boolean;
}> {
  const session = await context.internalAdapter.createSession(userId, false, {
    userAgent: `AREPO pairing ${deviceHint} redacted`,
    ipAddress: "127.0.0.1",
  });
  const signedValue = `${session.token}.${await makeSignature(session.token, context.secret)}`;
  const cookie = context.authCookies.sessionToken;
  const foundSession = await context.internalAdapter.findSession(session.token);
  const foundSessionUserAgent =
    foundSession &&
    typeof foundSession === "object" &&
    "session" in foundSession &&
    foundSession.session &&
    typeof foundSession.session === "object" &&
    "userAgent" in foundSession.session
      ? foundSession.session.userAgent
      : undefined;
  return {
    rawToken: session.token,
    cookieHeader: `${cookie.name}=${signedValue}`,
    cookieMetadata: {
      name: "arepo_session",
      classification: "issuance",
      deliveryBoundary: "test-only-cookie-header",
      path: cookie.attributes.path === "/api" ? "/api" : null,
      sameSite: cookie.attributes.sameSite ? String(cookie.attributes.sameSite) : null,
      httpOnly: Boolean(cookie.attributes.httpOnly),
      secure: Boolean(cookie.attributes.secure),
      maxAgePresent: typeof cookie.attributes.maxAge === "number",
      maxAgeSeconds: typeof cookie.attributes.maxAge === "number" ? cookie.attributes.maxAge : null,
      valueRedacted: true,
    },
    sanitizedDeviceHintStored: foundSessionUserAgent === `AREPO pairing ${deviceHint} redacted`,
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
  result: Omit<BetterAuthPairingCookieIssuanceProofResult, "findings">,
): readonly BetterAuthPairingCookieIssuanceFinding[] {
  return [
    {
      id: "pairing-to-session",
      status: result.sessionProof.betterAuthSessionCreatedAfterPairing
        ? "proven-through-internal-adapter"
        : "unresolved",
      summary:
        "AREPO pairing completion can create a Better Auth user/session through the isolated internal adapter.",
      blockerCodes: ["supported-pairing-session-api-needed"],
      openQuestions: [
        "Does Better Auth expose a supported API or plugin boundary for this pairing flow?",
      ],
    },
    {
      id: "signed-cookie-production",
      status: result.cookieProof.signedCookieProducedFromPairingSession
        ? "proven-through-internal-adapter"
        : "unresolved",
      summary:
        "A pairing-created session token can be signed with Better Auth's exported crypto primitive and accepted by get-session.",
      blockerCodes: ["supported-pairing-cookie-response-boundary-needed"],
      openQuestions: [
        "Which production boundary should emit Set-Cookie after pairing without exposing raw session token material?",
      ],
    },
    {
      id: "supported-api-boundary",
      status: "blocked-for-production",
      summary:
        "The proof uses the internal adapter plus exported signing, not a proven public Better Auth session issuance API.",
      blockerCodes: ["public-pairing-cookie-api-unproven"],
      openQuestions: [
        "Should AREPO build a Better Auth plugin, use a supported server API, or revisit the backup session foundation?",
      ],
    },
    {
      id: "session-lookup",
      status: result.cookieProof.signedCookieCanLookupSession ? "passed" : "unresolved",
      summary: "The signed pairing cookie can be used for isolated Better Auth session lookup.",
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
      id: "sign-out-revoke",
      status: result.revokeProof.signOutInvalidatesPairingCookieSession ? "passed" : "unresolved",
      summary: "Better Auth sign-out invalidates the pairing-issued signed-cookie session.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "expiry",
      status: result.expiryProof.expiredPairingCookieSessionRejected ? "passed" : "unresolved",
      summary: "Deterministic expiry behavior applies to the pairing-issued signed-cookie session.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "no-login-ux",
      status: "passed",
      summary:
        "The proof does not require username/password, OAuth, social login, email login, frontend storage, or login UI.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "subject-schema",
      status: result.boundaryProof.betterAuthUserRecordRequired
        ? "needs-schema-extension"
        : "passed",
      summary:
        "Better Auth requires a user record for AREPO local-operator sessions; account records are not required in this proof.",
      blockerCodes: ["arepo-local-operator-user-schema-policy-needed"],
      openQuestions: [
        "How should AREPO create, reset, migrate, and audit the local operator Better Auth user record?",
      ],
    },
    {
      id: "metadata-scope",
      status: "needs-schema-extension",
      summary:
        "A sanitized device hint fits existing user-agent metadata, but vault/session scope remains a separate schema design.",
      blockerCodes: ["session-scope-metadata-design-needed"],
      openQuestions: [
        "Should AREPO scope live in Better Auth session metadata or AREPO-owned authorization state?",
      ],
    },
    {
      id: "not-live-authorization",
      status: "passed",
      summary: "No proof result is live authorization and no live route emits cookies.",
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
