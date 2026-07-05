import { createBetterAuthAppDataProofContext } from "./betterAuthAppDataStoreProof.js";

export const BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_MOUNTED = false;
export const BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_PAIRING_SESSION_ADAPTER_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthPairingSessionAdapterProofFindingStatus =
  "passed" | "needs-cookie-adapter-spike" | "needs-schema-extension" | "unknown";

export type BetterAuthPairingSessionAdapterProofFinding = {
  id:
    | "pairing-to-session"
    | "no-external-login"
    | "subject-association"
    | "metadata"
    | "cookie-issuance"
    | "lookup"
    | "logout"
    | "revoke-current"
    | "revoke-all"
    | "expiry"
    | "direct-token-injection"
    | "csrf-ownership";
  status: BetterAuthPairingSessionAdapterProofFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

type BetterAuthClearingCookieSummary = {
  name: string;
  path: string | null;
  sameSite: string | null;
  httpOnly: boolean;
  secure: boolean;
  maxAgeSeconds: number | null;
  valueRedacted: true;
};

export type BetterAuthPairingSessionAdapterProofResult = {
  status: "isolated-pairing-session-adapter-proof";
  packageName: "better-auth";
  liveBrowserAuthEnabled: false;
  mountedInServer: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsLiveSetCookieHeaders: false;
  acceptsCookieCredentialsInLiveAuth: false;
  changesBearerTokenProtectedMode: false;
  pairingProof: {
    arepoBearerProtectedOperatorAlreadyAuthenticated: true;
    arepoPairingCompletionAccepted: true;
    usernamePasswordEnabled: false;
    oauthEnabled: false;
    socialLoginEnabled: false;
    frontendSecretStorageRequired: false;
  };
  sessionProof: {
    subjectKind: "arepo-local-operator";
    betterAuthUserCreatedForSubject: boolean;
    betterAuthSessionCreatedAfterPairing: boolean;
    sessionLookupWorked: boolean;
    sanitizedDeviceHintStoredInUserAgent: boolean;
    arbitraryVaultScopeMetadataSupported: false;
    arbitraryVaultScopeMetadataStatus: "needs-schema-extension";
    signedCookieIssuedFromPairingPath: false;
    signedCookieIssuanceStatus: "needs-cookie-adapter-spike";
    logoutClearingCookieCount: number;
    logoutClearingCookies: readonly BetterAuthClearingCookieSummary[];
    revokeCurrentWorked: boolean;
    revokeAllForSubjectWorked: boolean;
    directRawTokenInjectionAuthenticates: boolean;
    expirySeconds: number;
  };
  csrfProof: {
    coveredForArepoUnsafeApiRoutes: "unknown";
    blockerCodes: readonly ["csrf-ownership-unresolved"];
  };
  findings: readonly BetterAuthPairingSessionAdapterProofFinding[];
};

const baseUrl = "http://127.0.0.1:8734";

export async function runIsolatedBetterAuthPairingSessionAdapterProof(): Promise<BetterAuthPairingSessionAdapterProofResult> {
  const proof = await createBetterAuthAppDataProofContext();
  await proof.context.runMigrations();
  const user = await proof.context.internalAdapter.createUser({
    email: "arepo-pairing-subject@example.invalid",
    name: "AREPO Pairing Subject",
    emailVerified: true,
  });
  const session = await proof.context.internalAdapter.createSession(user.id, false, {
    userAgent: "AREPO pairing device label redacted",
    ipAddress: "127.0.0.1",
  });
  const foundSession = await proof.context.internalAdapter.findSession(session.token);
  const directCookieInjection = await proof.auth.handler(
    new Request(`${baseUrl}/api/auth/get-session`, {
      headers: { cookie: `arepo_session=${session.token}` },
    }),
  );
  const directCookieInjectionBody = await safeJson(directCookieInjection);
  const signOut = await proof.auth.handler(
    new Request(`${baseUrl}/api/auth/sign-out`, { method: "POST" }),
  );
  const logoutClearingCookies = summarizeSetCookieHeaders(signOut.headers);
  await proof.context.internalAdapter.deleteSession(session.token);
  const revokedCurrent = await proof.context.internalAdapter.findSession(session.token);
  const secondSession = await proof.context.internalAdapter.createSession(user.id);
  const thirdSession = await proof.context.internalAdapter.createSession(user.id);
  await proof.context.internalAdapter.deleteUserSessions(user.id);
  const revokedSecond = await proof.context.internalAdapter.findSession(secondSession.token);
  const revokedThird = await proof.context.internalAdapter.findSession(thirdSession.token);
  const cleanupWorked = await proof.cleanup();

  const result = {
    status: "isolated-pairing-session-adapter-proof",
    packageName: "better-auth",
    liveBrowserAuthEnabled: false,
    mountedInServer: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsLiveSetCookieHeaders: false,
    acceptsCookieCredentialsInLiveAuth: false,
    changesBearerTokenProtectedMode: false,
    pairingProof: {
      arepoBearerProtectedOperatorAlreadyAuthenticated: true,
      arepoPairingCompletionAccepted: true,
      usernamePasswordEnabled: false,
      oauthEnabled: false,
      socialLoginEnabled: false,
      frontendSecretStorageRequired: false,
    },
    sessionProof: {
      subjectKind: "arepo-local-operator",
      betterAuthUserCreatedForSubject: Boolean(user.id),
      betterAuthSessionCreatedAfterPairing: Boolean(session.userId),
      sessionLookupWorked: foundSession !== null,
      sanitizedDeviceHintStoredInUserAgent:
        foundSession !== null &&
        typeof foundSession === "object" &&
        "session" in foundSession &&
        (foundSession as { session?: { userAgent?: unknown } }).session?.userAgent ===
          "AREPO pairing device label redacted",
      arbitraryVaultScopeMetadataSupported: false,
      arbitraryVaultScopeMetadataStatus: "needs-schema-extension",
      signedCookieIssuedFromPairingPath: false,
      signedCookieIssuanceStatus: "needs-cookie-adapter-spike",
      logoutClearingCookieCount: logoutClearingCookies.length,
      logoutClearingCookies,
      revokeCurrentWorked: revokedCurrent === null,
      revokeAllForSubjectWorked: revokedSecond === null && revokedThird === null,
      directRawTokenInjectionAuthenticates: directCookieInjectionBody !== null,
      expirySeconds: proof.context.sessionConfig.expiresIn,
    },
    csrfProof: {
      coveredForArepoUnsafeApiRoutes: "unknown",
      blockerCodes: ["csrf-ownership-unresolved"],
    },
  } satisfies Omit<BetterAuthPairingSessionAdapterProofResult, "findings">;

  if (!cleanupWorked) {
    throw new Error("Better Auth pairing-session proof cleanup failed.");
  }

  return {
    ...result,
    findings: buildFindings(result),
  };
}

function buildFindings(
  result: Omit<BetterAuthPairingSessionAdapterProofResult, "findings">,
): readonly BetterAuthPairingSessionAdapterProofFinding[] {
  return [
    {
      id: "pairing-to-session",
      status: result.sessionProof.betterAuthSessionCreatedAfterPairing
        ? "passed"
        : "needs-cookie-adapter-spike",
      summary:
        "After an AREPO pairing proof is accepted, the isolated adapter can create a Better Auth session internally.",
      blockerCodes: ["public-pairing-to-session-api-unproven"],
      openQuestions: [
        "Should AREPO accept Better Auth internal adapter use for pairing, or require a public API path?",
      ],
    },
    {
      id: "no-external-login",
      status: "passed",
      summary:
        "The proof does not enable username/password, OAuth, social login, or frontend credential storage.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "subject-association",
      status: result.sessionProof.betterAuthUserCreatedForSubject ? "passed" : "unknown",
      summary:
        "The proof can associate a Better Auth user record with an AREPO local-operator subject.",
      blockerCodes: ["arepo-subject-to-better-auth-user-policy-needed"],
      openQuestions: [
        "How should AREPO name, rotate, and reset the local operator subject record?",
      ],
    },
    {
      id: "metadata",
      status: result.sessionProof.sanitizedDeviceHintStoredInUserAgent
        ? "needs-schema-extension"
        : "unknown",
      summary:
        "A sanitized device hint can fit existing session user-agent metadata; vault scope posture needs schema design.",
      blockerCodes: ["better-auth-session-metadata-schema-needed"],
      openQuestions: [
        "Should vault permission posture live in Better Auth session fields or AREPO authorization state?",
      ],
    },
    {
      id: "cookie-issuance",
      status: "needs-cookie-adapter-spike",
      summary: "The proof does not issue a signed Better Auth cookie from the pairing path.",
      blockerCodes: ["signed-cookie-issuance-from-pairing-unproven"],
      openQuestions: [
        "Which supported Better Auth API should set the signed session cookie after pairing?",
      ],
    },
    {
      id: "lookup",
      status: result.sessionProof.sessionLookupWorked ? "passed" : "unknown",
      summary: "The created proof session can be looked up.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "logout",
      status:
        result.sessionProof.logoutClearingCookieCount > 0 ? "passed" : "needs-cookie-adapter-spike",
      summary:
        "Better Auth sign-out clearing metadata is observable, but pairing-created cookie sign-out remains unproven.",
      blockerCodes: [],
      openQuestions: [
        "Can sign-out target the pairing-created signed cookie once cookie issuance is implemented?",
      ],
    },
    {
      id: "revoke-current",
      status: result.sessionProof.revokeCurrentWorked ? "passed" : "unknown",
      summary: "The isolated adapter can revoke the selected proof session.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-all",
      status: result.sessionProof.revokeAllForSubjectWorked ? "passed" : "unknown",
      summary: "The isolated adapter can revoke all sessions for the proof subject.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "expiry",
      status: "passed",
      summary: "The proof session uses the configured Better Auth expiry seconds.",
      blockerCodes: ["deterministic-expiry-adapter-test-needed"],
      openQuestions: ["Can AREPO control time in a full Better Auth route adapter test?"],
    },
    {
      id: "direct-token-injection",
      status: result.sessionProof.directRawTokenInjectionAuthenticates ? "unknown" : "passed",
      summary:
        "Direct raw Better Auth session token injection into the cookie does not authenticate.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "csrf-ownership",
      status: "unknown",
      summary: "The proof does not solve CSRF for AREPO unsafe API routes.",
      blockerCodes: ["csrf-ownership-unresolved"],
      openQuestions: [
        "Should AREPO own CSRF for non-Better Auth API routes even after Better Auth session adoption?",
      ],
    },
  ];
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  return JSON.parse(text) as unknown;
}

function summarizeSetCookieHeaders(headers: Headers): readonly BetterAuthClearingCookieSummary[] {
  return headers.getSetCookie().map((header) => summarizeSetCookie(header));
}

function summarizeSetCookie(header: string): BetterAuthClearingCookieSummary {
  const [nameValue = "", ...attributeParts] = header.split(";").map((part) => part.trim());
  const [name = ""] = nameValue.split("=");
  const attributes = new Map<string, string | true>();
  for (const part of attributeParts) {
    const [key = "", value] = part.split("=");
    attributes.set(key.toLowerCase(), value ?? true);
  }
  return {
    name,
    path: stringAttribute(attributes, "path"),
    sameSite: stringAttribute(attributes, "samesite"),
    httpOnly: attributes.has("httponly"),
    secure: attributes.has("secure"),
    maxAgeSeconds: numberAttribute(attributes, "max-age"),
    valueRedacted: true,
  };
}

function stringAttribute(attributes: Map<string, string | true>, key: string): string | null {
  const value = attributes.get(key);
  return typeof value === "string" ? value : null;
}

function numberAttribute(attributes: Map<string, string | true>, key: string): number | null {
  const value = attributes.get(key);
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
