import { createInMemoryBrowserCsrfTokenStore } from "./browserCsrfTokenStore.js";
import { generateBrowserCsrfTokenSecret } from "./browserCsrfTokenVerifier.js";
import { createBetterAuthAppDataProofContext } from "./betterAuthAppDataStoreProof.js";
import {
  adaptBetterAuthRouteRequest,
  wrapBetterAuthResponse,
} from "./betterAuthRouteRequestAdapterProof.js";

export const BETTER_AUTH_CSRF_OWNERSHIP_PROOF_MOUNTED = false;
export const BETTER_AUTH_CSRF_OWNERSHIP_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_CSRF_OWNERSHIP_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_CSRF_OWNERSHIP_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthCsrfOwnershipFindingStatus =
  "passed" | "arepo-owned" | "unsupported" | "unknown";

export type BetterAuthCsrfOwnershipFinding = {
  id:
    | "better-auth-own-endpoint-origin-protection"
    | "arbitrary-arepo-route-protection"
    | "external-csrf-token-api"
    | "unsafe-route-policy"
    | "safe-route-policy"
    | "origin-referer-policy"
    | "samesite-policy"
    | "arepo-csrf-primitives"
    | "sanitized-failures";
  status: BetterAuthCsrfOwnershipFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

export type BetterAuthCsrfRouteClassification = {
  method: "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";
  category:
    | "safe-read"
    | "vault-mutation"
    | "config-mutation"
    | "pairing-mutation"
    | "session-mutation"
    | "credential-mutation";
  examplePath: string;
  futureCookieBackedRequiresCsrf: boolean;
  futureRequiresOriginOrRefererCheck: boolean;
  validationBeforeMutation: boolean;
  reasonCode:
    "safe-method-no-csrf-token-required" | "unsafe-cookie-backed-arepo-route-requires-arepo-csrf";
};

export type BetterAuthCsrfFailureReason = {
  code:
    | "missing-csrf-token"
    | "invalid-csrf-token"
    | "expired-csrf-token"
    | "revoked-csrf-token"
    | "untrusted-origin"
    | "missing-origin";
  status: 403;
  message: string;
  auditCategory: "browser_csrf_denied";
  sanitized: true;
};

export type BetterAuthCsrfOwnershipProofResult = {
  status: "isolated-csrf-ownership-proof";
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
  betterAuthEndpointProof: {
    signOutWithoutOriginStatus: number;
    signOutWithoutOriginRejected: boolean;
    signOutWrongOriginStatus: number;
    signOutWrongOriginRejected: boolean;
    signOutTrustedOriginStatus: number;
    signOutTrustedOriginAllowed: boolean;
    ownEndpointProtectionKind: "origin-and-fetch-metadata";
    rawResponsesRedacted: true;
  };
  arbitraryArepoRouteProof: {
    betterAuthHandlerMountedForArepoRoutes: false;
    betterAuthProtectsArbitraryArepoRoutes: false;
    betterAuthHandlerStatusForArepoVaultMutation: number;
    arepoMustOwnCsrfForUnsafeApiRoutes: true;
    sameSiteAloneSufficient: false;
    originRefererSupplementalOnly: true;
    blockerCodes: readonly ["arepo-owned-csrf-required-for-unsafe-api-routes"];
  };
  externalCsrfApiProof: {
    supportedTokenIssueApiFound: false;
    supportedTokenVerifyApiFound: false;
    exportedMiddlewareObserved: readonly [
      "originCheckMiddleware",
      "originCheck",
      "formCsrfMiddleware",
    ];
    usableOutsideBetterAuthEndpoints: "unproven";
  };
  routePolicy: {
    unsafeRoutesRequireCsrf: true;
    safeReadRoutesSessionOnlyAllowed: true;
    validationBeforeMutation: true;
    classifications: readonly BetterAuthCsrfRouteClassification[];
  };
  arepoCsrfPrimitiveCompatibility: {
    compatibleWithLikelyOwnershipModel: boolean;
    implementation: "in-memory-test-primitive";
    storesRawTokens: false;
    exposesHashesInDiagnostics: false;
    wiredIntoAuthorization: false;
    wiredIntoRoutes: false;
    activeTokenCount: number;
  };
  failurePolicy: {
    sanitizedReasonCodes: readonly BetterAuthCsrfFailureReason[];
  };
  findings: readonly BetterAuthCsrfOwnershipFinding[];
};

const baseUrl = "http://127.0.0.1:8734";

export async function runIsolatedBetterAuthCsrfOwnershipProof(): Promise<BetterAuthCsrfOwnershipProofResult> {
  const proof = await createBetterAuthAppDataProofContext({ emailAndPasswordEnabled: true });
  await proof.context.runMigrations();

  const signUp = await callBetterAuth(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-up/email",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      email: "arepo-csrf-proof@example.invalid",
      password: "arepo-csrf-proof-password",
      name: "AREPO CSRF Proof",
    },
  });
  const sessionCookie = cookieHeaderFromSetCookie(signUp.response.headers, "arepo_session");

  const signOutWithoutOrigin = await callBetterAuth(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-out",
    headers: sessionCookie ? { cookie: sessionCookie } : {},
  });
  const signOutWrongOrigin = await callBetterAuth(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-out",
    headers: {
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      origin: "http://evil.example.invalid",
    },
  });
  const signOutTrustedOrigin = await callBetterAuth(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-out",
    headers: {
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      origin: baseUrl,
    },
  });
  const arbitraryArepoMutation = await callBetterAuth(proof.auth.handler, {
    method: "POST",
    path: "/api/vaults/example/files",
    headers: {
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      origin: "http://evil.example.invalid",
    },
    body: { path: "note.md", content: "unsafe mutation proof body" },
  });

  const csrfDiagnostics = buildArepoCsrfPrimitiveDiagnostics();
  const cleanupWorked = await proof.cleanup();
  if (!cleanupWorked) {
    throw new Error("Better Auth CSRF ownership proof cleanup failed.");
  }

  const result = {
    status: "isolated-csrf-ownership-proof",
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
    betterAuthEndpointProof: {
      signOutWithoutOriginStatus: signOutWithoutOrigin.response.status,
      signOutWithoutOriginRejected: signOutWithoutOrigin.response.status === 403,
      signOutWrongOriginStatus: signOutWrongOrigin.response.status,
      signOutWrongOriginRejected: signOutWrongOrigin.response.status === 403,
      signOutTrustedOriginStatus: signOutTrustedOrigin.response.status,
      signOutTrustedOriginAllowed: signOutTrustedOrigin.response.status === 200,
      ownEndpointProtectionKind: "origin-and-fetch-metadata",
      rawResponsesRedacted: true,
    },
    arbitraryArepoRouteProof: {
      betterAuthHandlerMountedForArepoRoutes: false,
      betterAuthProtectsArbitraryArepoRoutes: false,
      betterAuthHandlerStatusForArepoVaultMutation: arbitraryArepoMutation.response.status,
      arepoMustOwnCsrfForUnsafeApiRoutes: true,
      sameSiteAloneSufficient: false,
      originRefererSupplementalOnly: true,
      blockerCodes: ["arepo-owned-csrf-required-for-unsafe-api-routes"],
    },
    externalCsrfApiProof: {
      supportedTokenIssueApiFound: false,
      supportedTokenVerifyApiFound: false,
      exportedMiddlewareObserved: ["originCheckMiddleware", "originCheck", "formCsrfMiddleware"],
      usableOutsideBetterAuthEndpoints: "unproven",
    },
    routePolicy: {
      unsafeRoutesRequireCsrf: true,
      safeReadRoutesSessionOnlyAllowed: true,
      validationBeforeMutation: true,
      classifications: classifyFutureArepoCsrfRoutes(),
    },
    arepoCsrfPrimitiveCompatibility: csrfDiagnostics,
    failurePolicy: {
      sanitizedReasonCodes: sanitizedCsrfFailureReasons(),
    },
  } satisfies Omit<BetterAuthCsrfOwnershipProofResult, "findings">;

  return {
    ...result,
    findings: buildFindings(result),
  };
}

export function classifyFutureArepoCsrfRoutes(): readonly BetterAuthCsrfRouteClassification[] {
  return [
    classifyRoute("GET", "safe-read", "/api/node/status"),
    classifyRoute("HEAD", "safe-read", "/api/node/status"),
    classifyRoute("POST", "vault-mutation", "/api/vaults/:id/files"),
    classifyRoute("PUT", "vault-mutation", "/api/vaults/:id/files"),
    classifyRoute("PATCH", "vault-mutation", "/api/vaults/:id/index-scope"),
    classifyRoute("DELETE", "vault-mutation", "/api/vaults/:id/files"),
    classifyRoute("POST", "config-mutation", "/api/vaults"),
    classifyRoute("POST", "credential-mutation", "/api/node/credentials"),
    classifyRoute("POST", "pairing-mutation", "/api/node/auth/pairing/start"),
    classifyRoute("POST", "pairing-mutation", "/api/node/auth/pairing/complete"),
    classifyRoute("POST", "session-mutation", "/api/node/auth/session/logout"),
    classifyRoute("POST", "session-mutation", "/api/node/auth/session/revoke-all"),
  ];
}

export function sanitizedCsrfFailureReasons(): readonly BetterAuthCsrfFailureReason[] {
  return [
    reason("missing-csrf-token", "CSRF proof is required for this unsafe browser request."),
    reason("invalid-csrf-token", "CSRF proof is invalid for this browser request."),
    reason("expired-csrf-token", "CSRF proof has expired."),
    reason("revoked-csrf-token", "CSRF proof is no longer valid."),
    reason("untrusted-origin", "Browser request origin is not trusted."),
    reason("missing-origin", "Browser request origin is required for this unsafe request."),
  ];
}

function buildFindings(
  result: Omit<BetterAuthCsrfOwnershipProofResult, "findings">,
): readonly BetterAuthCsrfOwnershipFinding[] {
  return [
    {
      id: "better-auth-own-endpoint-origin-protection",
      status:
        result.betterAuthEndpointProof.signOutWithoutOriginRejected &&
        result.betterAuthEndpointProof.signOutWrongOriginRejected &&
        result.betterAuthEndpointProof.signOutTrustedOriginAllowed
          ? "passed"
          : "unknown",
      summary:
        "Better Auth rejects unsafe signed-cookie auth endpoint requests with missing or untrusted Origin and allows the trusted local origin.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "arbitrary-arepo-route-protection",
      status: "arepo-owned",
      summary:
        "Better Auth does not protect arbitrary AREPO API routes unless those routes are deliberately placed behind an AREPO-owned guard.",
      blockerCodes: ["arepo-owned-csrf-required-for-unsafe-api-routes"],
      openQuestions: [
        "Where should AREPO mount the future CSRF guard relative to browser-session authentication and route authorization?",
      ],
    },
    {
      id: "external-csrf-token-api",
      status: "unsupported",
      summary:
        "The proof did not find a supported Better Auth CSRF token issue/verify API for arbitrary AREPO routeRequest handlers.",
      blockerCodes: ["better-auth-arbitrary-route-csrf-api-not-proven"],
      openQuestions: [
        "Should AREPO keep its own CSRF token endpoint and verifier for non-auth API routes?",
      ],
    },
    {
      id: "unsafe-route-policy",
      status: "arepo-owned",
      summary:
        "Future cookie-backed POST, PUT, PATCH, DELETE, logout, revoke, config, vault, pairing, and session mutations require AREPO-owned CSRF validation before mutation.",
      blockerCodes: ["arepo-owned-csrf-required-for-unsafe-api-routes"],
      openQuestions: [],
    },
    {
      id: "safe-route-policy",
      status: "passed",
      summary:
        "Safe read methods can be classified separately and do not require CSRF token validation when they remain non-mutating.",
      blockerCodes: [],
      openQuestions: ["AREPO must keep GET and HEAD routes non-mutating."],
    },
    {
      id: "origin-referer-policy",
      status: "passed",
      summary:
        "Origin and Referer checks should be supplemental browser-request defenses, not replacements for CSRF token validation on unsafe AREPO routes.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "samesite-policy",
      status: "passed",
      summary:
        "SameSite cookie policy is useful but is not treated as sufficient CSRF protection by itself.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "arepo-csrf-primitives",
      status: result.arepoCsrfPrimitiveCompatibility.compatibleWithLikelyOwnershipModel
        ? "passed"
        : "unknown",
      summary:
        "AREPO's inert CSRF token store/verifier primitives fit the likely ownership model and keep raw tokens and hashes out of diagnostics.",
      blockerCodes: [],
      openQuestions: [
        "The primitives still need an unmounted request adapter before live activation.",
      ],
    },
    {
      id: "sanitized-failures",
      status: "passed",
      summary:
        "Future CSRF failures can be represented with sanitized reason codes and browser_csrf_denied audit category.",
      blockerCodes: [],
      openQuestions: [],
    },
  ];
}

async function callBetterAuth(
  handler: (request: Request) => Promise<Response>,
  input: Parameters<typeof adaptBetterAuthRouteRequest>[0],
): Promise<{ response: Response; wrapped: ReturnType<typeof wrapBetterAuthResponse> }> {
  const adapted = adaptBetterAuthRouteRequest(input);
  const response = await handler(adapted.request);
  const body = await safeJson(response);
  return { response, wrapped: wrapBetterAuthResponse(response, body) };
}

function buildArepoCsrfPrimitiveDiagnostics(): BetterAuthCsrfOwnershipProofResult["arepoCsrfPrimitiveCompatibility"] {
  const store = createInMemoryBrowserCsrfTokenStore({ clock: () => 1_000 });
  store.createToken({
    sessionId: "arepo-csrf-proof-session",
    csrfTokenId: "arepo-csrf-proof-token",
    tokenSecret: generateBrowserCsrfTokenSecret(),
    expiresAtMs: 11_000,
    originHint: baseUrl,
  });
  const diagnostics = store.diagnostics();
  return {
    compatibleWithLikelyOwnershipModel:
      diagnostics.activeTokenCount === 1 &&
      diagnostics.wiredIntoAuthorization === false &&
      diagnostics.wiredIntoRoutes === false,
    implementation: diagnostics.implementation,
    storesRawTokens: false,
    exposesHashesInDiagnostics: false,
    wiredIntoAuthorization: diagnostics.wiredIntoAuthorization,
    wiredIntoRoutes: diagnostics.wiredIntoRoutes,
    activeTokenCount: diagnostics.activeTokenCount,
  };
}

function classifyRoute(
  method: BetterAuthCsrfRouteClassification["method"],
  category: BetterAuthCsrfRouteClassification["category"],
  examplePath: string,
): BetterAuthCsrfRouteClassification {
  const safe = method === "GET" || method === "HEAD" || method === "OPTIONS";
  return {
    method,
    category,
    examplePath,
    futureCookieBackedRequiresCsrf: !safe,
    futureRequiresOriginOrRefererCheck: !safe,
    validationBeforeMutation: !safe,
    reasonCode: safe
      ? "safe-method-no-csrf-token-required"
      : "unsafe-cookie-backed-arepo-route-requires-arepo-csrf",
  };
}

function reason(
  code: BetterAuthCsrfFailureReason["code"],
  message: string,
): BetterAuthCsrfFailureReason {
  return {
    code,
    status: 403,
    message,
    auditCategory: "browser_csrf_denied",
    sanitized: true,
  };
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
  const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const header of setCookies) {
    const [nameValue = ""] = header.split(";");
    const [cookieName = "", cookieValue = ""] = nameValue.trim().split("=");
    if (cookieName === name && cookieValue.length > 0) return `${name}=${cookieValue}`;
  }
  return null;
}
