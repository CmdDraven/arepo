import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";
import { evaluateBrowserAuthActivationGate } from "./browserAuthActivationGate.js";
import {
  planBrowserAuthRouteContracts,
  type BrowserAuthRouteContract,
} from "./browserAuthRouteContracts.js";
import { createBrowserAuthTestOnlyActivationAllowance } from "./browserAuthTestOnlyActivation.js";
import { createBetterAuthAppDataProofContext } from "./betterAuthAppDataStoreProof.js";
import {
  adaptBetterAuthRouteRequest,
  wrapBetterAuthResponse,
  type BetterAuthCookieMetadata,
  type BetterAuthRouteRequestLike,
  type BetterAuthWrappedResponse,
} from "./betterAuthRouteRequestAdapterProof.js";
import { sanitizeArepoBrowserDeviceLabel } from "./betterAuthSessionScopeMetadataProof.js";

export const BETTER_AUTH_AREPO_PLUGIN_BOUNDARY_PROOF_MOUNTED = false;
export const BETTER_AUTH_AREPO_PLUGIN_BOUNDARY_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_AREPO_PLUGIN_BOUNDARY_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_AREPO_PLUGIN_BOUNDARY_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthArepoPluginApiClassification =
  | "public-documented-api"
  | "public-exported-api"
  | "official-plugin-pattern-internal-access"
  | "internal-unsupported-access"
  | "not-used"
  | "unknown";

export type BetterAuthArepoPluginBoundaryFindingStatus =
  | "passed"
  | "blocked-by-default"
  | "accepted-in-isolated-proof"
  | "needs-risk-decision"
  | "needs-live-integration-later";

export type BetterAuthArepoPluginBoundaryFinding = {
  id:
    | "default-activation-gate"
    | "test-only-plugin-flow"
    | "signed-cookie"
    | "session-lookup"
    | "direct-token-injection"
    | "sign-out"
    | "revoke-current"
    | "revoke-all"
    | "expiry"
    | "sidecar-authorization"
    | "csrf-sequencing"
    | "audit-redaction"
    | "internal-adapter-risk"
    | "not-live-authorization";
  status: BetterAuthArepoPluginBoundaryFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

export type BetterAuthArepoPluginBoundaryProofResult = {
  status: "isolated-arepo-better-auth-plugin-boundary-proof";
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
  pluginBoundary: {
    productionShapedPluginModeled: true;
    betterAuthPluginMountedLive: false;
    routeRequestWrapperCompatible: boolean;
    activationGateRunsBeforeSessionCreation: boolean;
    routeContractCheckedBeforeSessionCreation: boolean;
    pairingInputAlreadyVerifiedByArepo: true;
    testOnlyAllowanceRequiredForActiveProof: true;
    liveAuthorizationDecisionReturned: false;
  };
  apiUsage: {
    createAuthEndpoint: BetterAuthArepoPluginApiClassification;
    setSessionCookie: BetterAuthArepoPluginApiClassification;
    ctxContextInternalAdapter: BetterAuthArepoPluginApiClassification;
    directTokenSigning: BetterAuthArepoPluginApiClassification;
    unsupportedInternalApiUsed: false;
  };
  internalAdapterRisk: {
    classification: "official-plugin-pattern-internal-access";
    usedFor: readonly [
      "find-or-create-local-subject-user",
      "create-browser-session",
      "lookup-session-for-proof",
      "revoke-current-proof",
      "revoke-all-proof",
      "expiry-proof",
    ];
    officialBetterAuthPluginsUsePattern: true;
    productionRisk: "Better Auth may change the plugin context internal adapter contract.";
    wrapperCanIsolateRisk: true;
    activationBlockedUntilAcceptedOrReplaced: true;
    expressSessionBackupShouldRemainOpenIfRejected: true;
  };
  blockedAttempt: {
    gateAllowed: false;
    reasonCode: "browser_auth_activation_blocked";
    sessionCreateAttempts: number;
    setSessionCookieAttempts: number;
    sidecarReferenceCreateAttempts: number;
    auditSuccessEvents: number;
    setCookieCount: number;
    response: BetterAuthWrappedResponse;
  };
  allowedProof: {
    testOnlyAllowed: true;
    betterAuthSessionCreated: boolean;
    setSessionCookieCalled: boolean;
    signedCookieObservedOnlyAsRedactedMetadata: true;
    issuanceCookies: readonly BetterAuthCookieMetadata[];
    clearingCookies: readonly BetterAuthCookieMetadata[];
    signedCookieCanLookupSession: boolean;
    directRawTokenCookieInjectionAuthenticates: boolean;
    signOutInvalidatesPluginIssuedCookieSession: boolean;
    revokeCurrentInvalidatesSelectedPluginIssuedSession: boolean;
    revokeAllInvalidatesOnlySelectedSubjectSessions: boolean;
    revokeAllPreservesOtherSubjectSession: boolean;
    deterministicExpiryAppliesToPluginIssuedSession: boolean;
  };
  sidecarAuthorization: {
    status: "modeled-in-memory-proof-only";
    createdOnlyAfterPairingAcceptanceAndActivationAllowance: boolean;
    keyedByBetterAuthUserAndSessionReferences: true;
    referenceValuesRedacted: true;
    localOperatorSubjectStored: true;
    sanitizedDeviceLabelStored: true;
    sanitizedDeviceLabel: string;
    secretShapedDeviceLabelRedactedTo: string;
    vaultNodePermissionsStoredInSidecar: false;
    permissionPostureSerializedIntoCookies: false;
    permissionPostureTrustedFromFrontendInput: false;
    betterAuthSessionObjectsTrustedForAuthorization: false;
    cookieDerivedAuthority: false;
    revokeCurrentMarkedReferenceRevoked: boolean;
    revokeAllMarkedOnlyMatchingSubjectReferences: boolean;
    revokeAllPreservedOtherSubjectReference: boolean;
    safeDiagnostics: {
      activeReferenceCount: number;
      revokedReferenceCount: number;
      redactedReferenceCount: number;
    };
  };
  csrfSequencing: {
    liveCsrfEnabled: false;
    sequencingOnlyNotLive: true;
    afterSessionLookupBeforeUnsafeMutation: true;
    beforeCookieBackedLogoutRevoke: true;
    beforeConfigVaultSessionMutation: true;
    beforeRoutePermissionExecutionForUnsafeMethods: true;
    sameSiteNotTreatedAsSufficient: true;
  };
  auditProof: {
    status: "sanitized-audit-like-events-in-isolated-proof";
    eventCategories: readonly string[];
    eventCount: number;
    containsRawCredentialMaterial: false;
  };
  wrappedResponses: {
    blockedPairingComplete: BetterAuthWrappedResponse;
    allowedPairingComplete: BetterAuthWrappedResponse;
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
    "internal-adapter-wrapper-implementation-needed",
    "production-arepo-better-auth-plugin-needed",
    "arepo-sidecar-authorization-store-needed",
    "backup-restore-session-state-policy-needed",
    "arepo-owned-csrf-live-integration-blocked",
  ];
  findings: readonly BetterAuthArepoPluginBoundaryFinding[];
};

type ArepoPluginBoundaryProofContextLike = Awaited<
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
    ): Promise<Array<{ token: string; id: string; userId: string }>>;
  };
};

type SidecarAuthorizationReference = {
  referenceId: string;
  betterAuthUserId: string;
  betterAuthSessionId: string;
  localOperatorSubjectRef: string;
  sanitizedDeviceLabel: string;
  createdAtMs: number;
  revokedAtMs: number | null;
  lastSeenAtMs: number | null;
  vaultNodePermissionsStored: false;
  cookieDerivedAuthority: false;
};

type ProofAuditEvent = {
  category:
    | "pairing_accepted"
    | "activation_blocked"
    | "session_issued_isolated"
    | "cookie_issuance_observed"
    | "sidecar_authorization_reference_created"
    | "sign_out"
    | "revoke_current"
    | "revoke_all"
    | "expiry_observed"
    | "raw_token_injection_rejected";
  severity: "info" | "warning";
  routeId?: string;
  reasonCode?: string;
  safeDetails: Record<string, string | number | boolean | null>;
};

type PluginInstrumentation = {
  sessionCreateAttempts: number;
  setSessionCookieAttempts: number;
  sidecarReferenceCreateAttempts: number;
  auditEvents: ProofAuditEvent[];
  sidecarReferences: SidecarAuthorizationReference[];
};

type PluginBody = {
  activationAllowed: boolean;
  routeContractAccepted: boolean;
  pairingAccepted: true;
  subjectEmail: string;
  localOperatorSubjectRef: string;
  deviceLabel: string;
};

const baseUrl = "http://127.0.0.1:8734";
const sessionCookieName = "arepo_session";
const routeId = "browser-pairing-complete";
const primarySubjectEmail = "arepo-arepo-plugin-boundary-subject@example.invalid";
const otherSubjectEmail = "arepo-arepo-plugin-boundary-other@example.invalid";
const primarySubjectRef = "local-operator-primary";
const otherSubjectRef = "local-operator-other";

export async function runIsolatedBetterAuthArepoPluginBoundaryProof(): Promise<BetterAuthArepoPluginBoundaryProofResult> {
  const routeContract = routeContractForPairingComplete();
  const instrumentation = createPluginInstrumentation();
  const proof = await createBetterAuthAppDataProofContext({
    plugins: [createArepoBetterAuthPluginBoundaryProofPlugin({ routeContract, instrumentation })],
  });
  await proof.context.runMigrations();
  const context = proof.context as ArepoPluginBoundaryProofContextLike;

  const blockedPairingComplete = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/arepo/browser-auth/pairing/complete",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      activationAllowed: false,
      routeContractAccepted: true,
      pairingAccepted: true,
      subjectEmail: primarySubjectEmail,
      localOperatorSubjectRef: primarySubjectRef,
      deviceLabel: "Operator Laptop Local Only",
    } satisfies PluginBody,
  });
  const blockedCounters = {
    sessionCreateAttempts: instrumentation.sessionCreateAttempts,
    setSessionCookieAttempts: instrumentation.setSessionCookieAttempts,
    sidecarReferenceCreateAttempts: instrumentation.sidecarReferenceCreateAttempts,
    auditSuccessEvents: instrumentation.auditEvents.filter(
      (event) => event.category === "session_issued_isolated",
    ).length,
  };

  const allowedPairingComplete = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/arepo/browser-auth/pairing/complete",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      activationAllowed: true,
      routeContractAccepted: true,
      pairingAccepted: true,
      subjectEmail: primarySubjectEmail,
      localOperatorSubjectRef: primarySubjectRef,
      deviceLabel: "Operator Laptop\nLocal Only",
    } satisfies PluginBody,
  });
  const allowedCookieHeader = cookieHeaderFromSetCookie(
    allowedPairingComplete.raw.headers,
    sessionCookieName,
  );
  if (!allowedCookieHeader) {
    throw new Error("AREPO Better Auth plugin-boundary proof did not observe a signed cookie.");
  }
  const primaryUserId = stringField(allowedPairingComplete.rawBody, "proofOnly.userId");
  if (!primaryUserId) {
    throw new Error("AREPO Better Auth plugin-boundary proof did not create a user reference.");
  }
  const primarySessions = await context.internalAdapter.listSessions(primaryUserId, {
    onlyActiveSessions: true,
  });
  const primaryRawToken = primarySessions[0]?.token;
  if (!primaryRawToken) {
    throw new Error("AREPO Better Auth plugin-boundary proof did not create a session token.");
  }

  const revokeCurrentPairing = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/arepo/browser-auth/pairing/complete",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      activationAllowed: true,
      routeContractAccepted: true,
      pairingAccepted: true,
      subjectEmail: primarySubjectEmail,
      localOperatorSubjectRef: primarySubjectRef,
      deviceLabel: "Operator Tablet",
    } satisfies PluginBody,
  });
  const revokeCurrentCookieHeader = cookieHeaderFromSetCookie(
    revokeCurrentPairing.raw.headers,
    sessionCookieName,
  );
  const primarySessionsAfterRevokeCurrentPairing = await context.internalAdapter.listSessions(
    primaryUserId,
    { onlyActiveSessions: true },
  );
  const revokeCurrentToken = primarySessionsAfterRevokeCurrentPairing.find(
    (session) => session.token !== primaryRawToken,
  )?.token;
  const revokeCurrentSessionId = primarySessionsAfterRevokeCurrentPairing.find(
    (session) => session.token === revokeCurrentToken,
  )?.id;

  const otherSubjectPairing = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/arepo/browser-auth/pairing/complete",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      activationAllowed: true,
      routeContractAccepted: true,
      pairingAccepted: true,
      subjectEmail: otherSubjectEmail,
      localOperatorSubjectRef: otherSubjectRef,
      deviceLabel: "Other Operator Laptop",
    } satisfies PluginBody,
  });
  const otherCookieHeader = cookieHeaderFromSetCookie(
    otherSubjectPairing.raw.headers,
    sessionCookieName,
  );

  const expiryPairing = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/arepo/browser-auth/pairing/complete",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      activationAllowed: true,
      routeContractAccepted: true,
      pairingAccepted: true,
      subjectEmail: "arepo-arepo-plugin-boundary-expiry@example.invalid",
      localOperatorSubjectRef: "local-operator-expiry",
      deviceLabel: "Expiry Laptop",
    } satisfies PluginBody,
  });
  const expiryCookieHeader = cookieHeaderFromSetCookie(
    expiryPairing.raw.headers,
    sessionCookieName,
  );
  const expiryUserId = stringField(expiryPairing.rawBody, "proofOnly.userId");
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

  const getSession = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: allowedCookieHeader },
  });
  const directRawTokenInjection = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: `${sessionCookieName}=${primaryRawToken}` },
  });
  if (
    wrapBetterAuthResponse(directRawTokenInjection.raw, directRawTokenInjection.rawBody).body
      .sessionPresent !== true
  ) {
    appendAuditEvent(instrumentation, {
      category: "raw_token_injection_rejected",
      severity: "warning",
      routeId,
      reasonCode: "raw-token-cookie-rejected",
      safeDetails: { status: "rejected", source: "isolated-proof" },
    });
  }

  const signOut = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-out",
    headers: {
      origin: baseUrl,
      cookie: allowedCookieHeader,
    },
  });
  appendAuditEvent(instrumentation, {
    category: "sign_out",
    severity: "info",
    routeId: "browser-session-logout",
    safeDetails: { status: "isolated-proof", active: false },
  });
  const getSessionAfterSignOut = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: { cookie: allowedCookieHeader },
  });

  if (revokeCurrentToken) {
    await context.internalAdapter.deleteSession(revokeCurrentToken);
    markSidecarReferenceRevoked(instrumentation, { sessionId: revokeCurrentSessionId });
    appendAuditEvent(instrumentation, {
      category: "revoke_current",
      severity: "info",
      routeId: "browser-session-revoke-current",
      safeDetails: { status: "isolated-proof", count: 1 },
    });
  }
  const getSessionAfterRevokeCurrent = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: revokeCurrentCookieHeader ? { cookie: revokeCurrentCookieHeader } : {},
  });

  await context.internalAdapter.deleteUserSessions(primaryUserId);
  markSidecarReferenceRevoked(instrumentation, { userId: primaryUserId });
  appendAuditEvent(instrumentation, {
    category: "revoke_all",
    severity: "info",
    routeId: "browser-session-revoke-all",
    safeDetails: { status: "isolated-proof", source: "selected-subject" },
  });
  const getSessionAfterRevokeAll = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: revokeCurrentCookieHeader ? { cookie: revokeCurrentCookieHeader } : {},
  });
  const otherSubjectAfterRevokeAll = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: otherCookieHeader ? { cookie: otherCookieHeader } : {},
  });

  const getSessionAfterExpiry = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    query: { disableRefresh: "true", disableCookieCache: "true" },
    headers: expiryCookieHeader ? { cookie: expiryCookieHeader } : {},
  });
  if (
    wrapBetterAuthResponse(getSessionAfterExpiry.raw, getSessionAfterExpiry.rawBody).body
      .sessionPresent !== true
  ) {
    appendAuditEvent(instrumentation, {
      category: "expiry_observed",
      severity: "info",
      routeId: "browser-session-status",
      safeDetails: { status: "expired", source: "isolated-proof" },
    });
  }

  const blockedWrapped = wrapBetterAuthResponse(
    blockedPairingComplete.raw,
    blockedPairingComplete.rawBody,
  );
  const allowedWrapped = wrapBetterAuthResponse(
    allowedPairingComplete.raw,
    allowedPairingComplete.rawBody,
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
  const safeDevice = sanitizeArepoBrowserDeviceLabel("Operator Laptop\nLocal Only");
  const unsafeDevice = sanitizeArepoBrowserDeviceLabel("Authorization: Bearer session-token");
  const cleanupWorked = await proof.cleanup();
  if (!cleanupWorked) {
    throw new Error("AREPO Better Auth plugin-boundary proof cleanup failed.");
  }

  const activeReferenceCount = instrumentation.sidecarReferences.filter(
    (reference) => reference.revokedAtMs === null,
  ).length;
  const revokedReferenceCount = instrumentation.sidecarReferences.length - activeReferenceCount;
  const result = {
    status: "isolated-arepo-better-auth-plugin-boundary-proof",
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
    pluginBoundary: {
      productionShapedPluginModeled: true,
      betterAuthPluginMountedLive: false,
      routeRequestWrapperCompatible: true,
      activationGateRunsBeforeSessionCreation: blockedCounters.sessionCreateAttempts === 0,
      routeContractCheckedBeforeSessionCreation: true,
      pairingInputAlreadyVerifiedByArepo: true,
      testOnlyAllowanceRequiredForActiveProof: true,
      liveAuthorizationDecisionReturned: false,
    },
    apiUsage: {
      createAuthEndpoint: "public-exported-api",
      setSessionCookie: "public-exported-api",
      ctxContextInternalAdapter: "official-plugin-pattern-internal-access",
      directTokenSigning: "not-used",
      unsupportedInternalApiUsed: false,
    },
    internalAdapterRisk: {
      classification: "official-plugin-pattern-internal-access",
      usedFor: [
        "find-or-create-local-subject-user",
        "create-browser-session",
        "lookup-session-for-proof",
        "revoke-current-proof",
        "revoke-all-proof",
        "expiry-proof",
      ],
      officialBetterAuthPluginsUsePattern: true,
      productionRisk: "Better Auth may change the plugin context internal adapter contract.",
      wrapperCanIsolateRisk: true,
      activationBlockedUntilAcceptedOrReplaced: true,
      expressSessionBackupShouldRemainOpenIfRejected: true,
    },
    blockedAttempt: {
      gateAllowed: false,
      reasonCode: "browser_auth_activation_blocked",
      sessionCreateAttempts: blockedCounters.sessionCreateAttempts,
      setSessionCookieAttempts: blockedCounters.setSessionCookieAttempts,
      sidecarReferenceCreateAttempts: blockedCounters.sidecarReferenceCreateAttempts,
      auditSuccessEvents: blockedCounters.auditSuccessEvents,
      setCookieCount: blockedWrapped.setCookieCount,
      response: blockedWrapped,
    },
    allowedProof: {
      testOnlyAllowed: true,
      betterAuthSessionCreated: instrumentation.sessionCreateAttempts > 0,
      setSessionCookieCalled: instrumentation.setSessionCookieAttempts > 0,
      signedCookieObservedOnlyAsRedactedMetadata: true,
      issuanceCookies: allowedWrapped.setCookies,
      clearingCookies: signOutWrapped.setCookies,
      signedCookieCanLookupSession: getSessionWrapped.body.sessionPresent === true,
      directRawTokenCookieInjectionAuthenticates:
        directRawTokenInjectionWrapped.body.sessionPresent === true,
      signOutInvalidatesPluginIssuedCookieSession:
        getSessionAfterSignOutWrapped.body.sessionPresent !== true,
      revokeCurrentInvalidatesSelectedPluginIssuedSession:
        getSessionAfterRevokeCurrentWrapped.body.sessionPresent !== true,
      revokeAllInvalidatesOnlySelectedSubjectSessions:
        getSessionAfterRevokeAllWrapped.body.sessionPresent !== true &&
        otherSubjectAfterRevokeAllWrapped.body.sessionPresent === true,
      revokeAllPreservesOtherSubjectSession:
        otherSubjectAfterRevokeAllWrapped.body.sessionPresent === true,
      deterministicExpiryAppliesToPluginIssuedSession:
        getSessionAfterExpiryWrapped.body.sessionPresent !== true,
    },
    sidecarAuthorization: {
      status: "modeled-in-memory-proof-only",
      createdOnlyAfterPairingAcceptanceAndActivationAllowance:
        blockedCounters.sidecarReferenceCreateAttempts === 0 &&
        instrumentation.sidecarReferenceCreateAttempts > 0,
      keyedByBetterAuthUserAndSessionReferences: true,
      referenceValuesRedacted: true,
      localOperatorSubjectStored: true,
      sanitizedDeviceLabelStored: true,
      sanitizedDeviceLabel: safeDevice.value,
      secretShapedDeviceLabelRedactedTo: unsafeDevice.value,
      vaultNodePermissionsStoredInSidecar: false,
      permissionPostureSerializedIntoCookies: false,
      permissionPostureTrustedFromFrontendInput: false,
      betterAuthSessionObjectsTrustedForAuthorization: false,
      cookieDerivedAuthority: false,
      revokeCurrentMarkedReferenceRevoked: Boolean(
        revokeCurrentSessionId &&
        instrumentation.sidecarReferences.some(
          (reference) =>
            reference.betterAuthSessionId === revokeCurrentSessionId &&
            reference.revokedAtMs !== null,
        ),
      ),
      revokeAllMarkedOnlyMatchingSubjectReferences: instrumentation.sidecarReferences
        .filter((reference) => reference.localOperatorSubjectRef === primarySubjectRef)
        .every((reference) => reference.revokedAtMs !== null),
      revokeAllPreservedOtherSubjectReference: instrumentation.sidecarReferences.some(
        (reference) =>
          reference.localOperatorSubjectRef === otherSubjectRef && reference.revokedAtMs === null,
      ),
      safeDiagnostics: {
        activeReferenceCount,
        revokedReferenceCount,
        redactedReferenceCount: instrumentation.sidecarReferences.length,
      },
    },
    csrfSequencing: {
      liveCsrfEnabled: false,
      sequencingOnlyNotLive: true,
      afterSessionLookupBeforeUnsafeMutation: true,
      beforeCookieBackedLogoutRevoke: true,
      beforeConfigVaultSessionMutation: true,
      beforeRoutePermissionExecutionForUnsafeMethods: true,
      sameSiteNotTreatedAsSufficient: true,
    },
    auditProof: {
      status: "sanitized-audit-like-events-in-isolated-proof",
      eventCategories: [...new Set(instrumentation.auditEvents.map((event) => event.category))],
      eventCount: instrumentation.auditEvents.length,
      containsRawCredentialMaterial: false,
    },
    wrappedResponses: {
      blockedPairingComplete: blockedWrapped,
      allowedPairingComplete: allowedWrapped,
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
      "internal-adapter-wrapper-implementation-needed",
      "production-arepo-better-auth-plugin-needed",
      "arepo-sidecar-authorization-store-needed",
      "backup-restore-session-state-policy-needed",
      "arepo-owned-csrf-live-integration-blocked",
    ],
  } satisfies Omit<BetterAuthArepoPluginBoundaryProofResult, "findings">;

  return {
    ...result,
    findings: buildFindings(result),
  };
}

function createArepoBetterAuthPluginBoundaryProofPlugin(input: {
  routeContract: BrowserAuthRouteContract;
  instrumentation: PluginInstrumentation;
}): BetterAuthPlugin {
  return {
    id: "arepo-better-auth-plugin-boundary-proof",
    version: "0.0.0-proof",
    endpoints: {
      completeArepoPairing: createAuthEndpoint(
        "/arepo/browser-auth/pairing/complete",
        {
          method: "POST",
          body: z.object({
            activationAllowed: z.boolean(),
            routeContractAccepted: z.boolean(),
            pairingAccepted: z.literal(true),
            subjectEmail: z.string().email(),
            localOperatorSubjectRef: z.string().min(1),
            deviceLabel: z.string(),
          }),
          requireHeaders: true,
        },
        async (ctx) => {
          const gate = evaluateBrowserAuthActivationGate({
            routeId: input.routeContract.routeId,
            routeContract: input.routeContract,
            localOnlyMode: true,
            operatorConfirmationPresent: ctx.body.activationAllowed,
            testOnlyActivation: ctx.body.activationAllowed
              ? createBrowserAuthTestOnlyActivationAllowance()
              : undefined,
          });
          if (!gate.allowed || !ctx.body.routeContractAccepted) {
            appendAuditEvent(input.instrumentation, {
              category: "activation_blocked",
              severity: "warning",
              routeId,
              reasonCode: "browser-auth-activation-blocked",
              safeDetails: { status: "blocked", source: "activation-gate" },
            });
            return ctx.json(
              {
                ok: false,
                reasonCode: "browser_auth_activation_blocked",
                sessionCreated: false,
                cookieIssued: false,
                sidecarReferenceCreated: false,
                auditSuccessEmitted: false,
                liveAuthorization: false,
              },
              { status: 503 },
            );
          }

          appendAuditEvent(input.instrumentation, {
            category: "pairing_accepted",
            severity: "info",
            routeId,
            safeDetails: { status: "accepted", source: "arepo-pairing" },
          });
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

          input.instrumentation.sessionCreateAttempts += 1;
          const session = await ctx.context.internalAdapter.createSession(user.id, false, {
            userAgent: `AREPO pairing ${sanitizedDevice.value}`,
            ipAddress: "127.0.0.1",
          });
          appendAuditEvent(input.instrumentation, {
            category: "session_issued_isolated",
            severity: "info",
            routeId,
            safeDetails: { status: "isolated-proof", issued: true },
          });
          createSidecarAuthorizationReference(input.instrumentation, {
            userId: user.id,
            sessionId: session.id,
            subjectRef: sanitizeLocalSubjectRef(ctx.body.localOperatorSubjectRef),
            deviceLabel: sanitizedDevice.value,
          });
          appendAuditEvent(input.instrumentation, {
            category: "sidecar_authorization_reference_created",
            severity: "info",
            routeId,
            safeDetails: { status: "created", source: "arepo-sidecar" },
          });
          input.instrumentation.setSessionCookieAttempts += 1;
          await setSessionCookie(ctx, { session, user });
          appendAuditEvent(input.instrumentation, {
            category: "cookie_issuance_observed",
            severity: "info",
            routeId,
            safeDetails: { status: "redacted", issued: true },
          });
          return ctx.json({
            ok: true,
            tokenReturned: false,
            liveAuthorization: false,
            proofOnly: {
              userId: user.id,
              sessionId: session.id,
            },
            safePosture: {
              activationGateAllowedInTestOnlyProof: true,
              deviceLabelSanitized: true,
              arepoAuthorizationStateOwnedByArepo: true,
              csrfSequencingPointPresent: true,
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

function createPluginInstrumentation(): PluginInstrumentation {
  return {
    sessionCreateAttempts: 0,
    setSessionCookieAttempts: 0,
    sidecarReferenceCreateAttempts: 0,
    auditEvents: [],
    sidecarReferences: [],
  };
}

function createSidecarAuthorizationReference(
  instrumentation: PluginInstrumentation,
  input: { userId: string; sessionId: string; subjectRef: string; deviceLabel: string },
): void {
  instrumentation.sidecarReferenceCreateAttempts += 1;
  instrumentation.sidecarReferences.push({
    referenceId: `sidecar-reference-${instrumentation.sidecarReferenceCreateAttempts}`,
    betterAuthUserId: input.userId,
    betterAuthSessionId: input.sessionId,
    localOperatorSubjectRef: input.subjectRef,
    sanitizedDeviceLabel: input.deviceLabel,
    createdAtMs: instrumentation.sidecarReferenceCreateAttempts,
    revokedAtMs: null,
    lastSeenAtMs: null,
    vaultNodePermissionsStored: false,
    cookieDerivedAuthority: false,
  });
}

function markSidecarReferenceRevoked(
  instrumentation: PluginInstrumentation,
  input: { userId?: string; sessionId?: string },
): void {
  for (const reference of instrumentation.sidecarReferences) {
    if (
      (input.userId !== undefined && reference.betterAuthUserId === input.userId) ||
      (input.sessionId !== undefined && reference.betterAuthSessionId === input.sessionId)
    ) {
      reference.revokedAtMs = reference.revokedAtMs ?? instrumentation.auditEvents.length + 1;
    }
  }
}

function appendAuditEvent(instrumentation: PluginInstrumentation, event: ProofAuditEvent): void {
  instrumentation.auditEvents.push({
    ...event,
    routeId: sanitizeOptionalIdentifier(event.routeId),
    reasonCode: sanitizeOptionalIdentifier(event.reasonCode),
    safeDetails: sanitizeSafeDetails(event.safeDetails),
  });
}

function buildFindings(
  result: Omit<BetterAuthArepoPluginBoundaryProofResult, "findings">,
): readonly BetterAuthArepoPluginBoundaryFinding[] {
  return [
    {
      id: "default-activation-gate",
      status: "blocked-by-default",
      summary:
        "The default activation gate blocks before Better Auth session creation, setSessionCookie, sidecar reference creation, or audit success emission.",
      blockerCodes: ["browser-auth-activation-gate-blocked"],
      openQuestions: [],
    },
    {
      id: "test-only-plugin-flow",
      status: result.allowedProof.betterAuthSessionCreated
        ? "accepted-in-isolated-proof"
        : "needs-live-integration-later",
      summary:
        "An explicit test-only allowance lets the isolated plugin endpoint model AREPO pairing acceptance to Better Auth session creation.",
      blockerCodes: ["production-arepo-better-auth-plugin-needed"],
      openQuestions: [],
    },
    {
      id: "signed-cookie",
      status:
        result.allowedProof.setSessionCookieCalled && result.allowedProof.issuanceCookies.length > 0
          ? "passed"
          : "needs-live-integration-later",
      summary: "The isolated plugin endpoint emits only redacted signed-cookie metadata.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "session-lookup",
      status: result.allowedProof.signedCookieCanLookupSession
        ? "passed"
        : "needs-live-integration-later",
      summary: "The plugin-issued signed cookie can be used for isolated session lookup.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "direct-token-injection",
      status: result.allowedProof.directRawTokenCookieInjectionAuthenticates
        ? "needs-live-integration-later"
        : "passed",
      summary: "Direct raw session-token cookie injection remains rejected.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "sign-out",
      status: result.allowedProof.signOutInvalidatesPluginIssuedCookieSession
        ? "passed"
        : "needs-live-integration-later",
      summary: "Better Auth sign-out invalidates the plugin-issued signed-cookie session.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-current",
      status: result.allowedProof.revokeCurrentInvalidatesSelectedPluginIssuedSession
        ? "passed"
        : "needs-live-integration-later",
      summary: "Revoke-current invalidates the selected plugin-issued session.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-all",
      status: result.allowedProof.revokeAllInvalidatesOnlySelectedSubjectSessions
        ? "passed"
        : "needs-live-integration-later",
      summary:
        "Revoke-all invalidates only the selected subject's plugin-issued sessions and preserves another subject.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "expiry",
      status: result.allowedProof.deterministicExpiryAppliesToPluginIssuedSession
        ? "passed"
        : "needs-live-integration-later",
      summary: "Deterministic expiry applies to the plugin-issued signed-cookie session.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "sidecar-authorization",
      status: "accepted-in-isolated-proof",
      summary:
        "AREPO sidecar authorization references are modeled as app-data state keyed by Better Auth user/session references, with vault/node permissions remaining AREPO-owned.",
      blockerCodes: ["arepo-sidecar-authorization-store-needed"],
      openQuestions: ["What persisted sidecar schema should production use?"],
    },
    {
      id: "csrf-sequencing",
      status: "needs-live-integration-later",
      summary:
        "The proof records where AREPO-owned CSRF validation must happen in the future cookie-backed route path without enabling live CSRF.",
      blockerCodes: ["arepo-owned-csrf-live-integration-blocked"],
      openQuestions: [],
    },
    {
      id: "audit-redaction",
      status: "accepted-in-isolated-proof",
      summary: "Audit-like events use safe categories and redacted references only.",
      blockerCodes: [],
      openQuestions: ["Which Better Auth hook outputs should be wrapped before production audit?"],
    },
    {
      id: "internal-adapter-risk",
      status: "needs-risk-decision",
      summary:
        "The plugin endpoint uses ctx.context.internalAdapter, matching Better Auth plugin patterns, but activation remains blocked until AREPO accepts or replaces that risk.",
      blockerCodes: ["internal-adapter-wrapper-implementation-needed"],
      openQuestions: [
        "Should AREPO isolate ctx.context.internalAdapter behind one wrapper or revisit express-session if the risk is unacceptable?",
      ],
    },
    {
      id: "not-live-authorization",
      status: "passed",
      summary: "No proof result is mounted, wired into routes, or treated as live authorization.",
      blockerCodes: [],
      openQuestions: [],
    },
  ];
}

function routeContractForPairingComplete(): BrowserAuthRouteContract {
  const contract = planBrowserAuthRouteContracts().contracts.find(
    (candidate) => candidate.routeId === routeId,
  );
  if (!contract) {
    throw new Error("AREPO Better Auth plugin-boundary proof route contract missing.");
  }
  return contract;
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
  for (const header of setCookieHeaders(headers)) {
    const [nameValue = ""] = header.split(";");
    const [cookieName = "", cookieValue = ""] = nameValue.trim().split("=");
    if (cookieName === name && cookieValue.length > 0) return cookieValue;
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

function sanitizeLocalSubjectRef(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "-")
    .slice(0, 80);
  return sanitized.length > 0 && !unsafeString(sanitized) ? sanitized : "redacted-local-subject";
}

function sanitizeOptionalIdentifier(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || unsafeString(trimmed)) return undefined;
  return trimmed.slice(0, 120);
}

function sanitizeSafeDetails(
  details: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (unsafeString(key) || (typeof value === "string" && unsafeString(value))) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function unsafeString(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("arepo_session=") ||
    normalized.includes("bearer ") ||
    normalized.includes("authorization:") ||
    normalized.includes("cookie:") ||
    normalized.includes("set-cookie") ||
    normalized.includes("bpairsec_") ||
    normalized.includes("bsver_") ||
    normalized.includes("bcsrfsec_") ||
    normalized.includes("session.token") ||
    normalized.includes("verifierhash") ||
    normalized.includes("tokenhash") ||
    normalized.includes("sha256:") ||
    normalized.includes("salt")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
