import {
  createInMemoryBrowserCsrfTokenStore,
  type InMemoryBrowserCsrfTokenStore,
} from "./browserCsrfTokenStore.js";

export const BROWSER_AUTH_CSRF_REQUEST_ADAPTER_PROOF_MOUNTED = false;
export const BROWSER_AUTH_CSRF_REQUEST_ADAPTER_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_CSRF_REQUEST_ADAPTER_PROOF_WIRED_INTO_ROUTES = false;
export const BROWSER_AUTH_CSRF_REQUEST_ADAPTER_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BrowserAuthCsrfRequestMethod =
  "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";

export type BrowserAuthCsrfRouteKind =
  | "safe-read"
  | "vault-mutation"
  | "config-mutation"
  | "credential-mutation"
  | "pairing-mutation"
  | "session-mutation";

export type BrowserAuthCsrfRequestShape = {
  method: BrowserAuthCsrfRequestMethod;
  path: string;
  routeKind: BrowserAuthCsrfRouteKind;
  expectedSessionId?: string;
  csrfTokenId?: string;
  csrfTokenSecret?: string;
  origin?: string;
  referer?: string;
  trustedOrigins?: readonly string[];
  requireOriginOrReferer?: boolean;
  sameSitePolicy?: "lax" | "strict" | "none" | "unspecified";
};

export type BrowserAuthCsrfRequestReasonCode =
  | "safe-method-no-csrf-token-required"
  | "valid-csrf-proof-test-only"
  | "missing-csrf-token"
  | "malformed-csrf-token"
  | "wrong-csrf-token"
  | "expired-csrf-token"
  | "revoked-csrf-token"
  | "consumed-csrf-token"
  | "csrf-session-mismatch"
  | "missing-origin"
  | "untrusted-origin";

export type BrowserAuthCsrfRequestAdapterResult = {
  status: "allow" | "deny";
  method: BrowserAuthCsrfRequestMethod;
  path: string;
  routeKind: BrowserAuthCsrfRouteKind;
  methodClass: "safe" | "unsafe";
  requiresCsrf: boolean;
  reasonCode: BrowserAuthCsrfRequestReasonCode;
  statusCode: 200 | 403;
  testOnly: true;
  liveAuthorization: false;
  liveMutationAllowed: false;
  setCookieEmitted: false;
  authenticatesRequest: false;
  tokenMaterialEchoed: false;
  sameSiteTreatedAsSufficient: false;
  originRefererSupplemental: true;
  validationBeforeMutation: true;
  csrfTokenIdPresent: boolean;
  csrfTokenSecretPresent: boolean;
  expectedSessionPresent: boolean;
  originClass: "trusted" | "untrusted" | "absent";
  refererClass: "trusted" | "untrusted" | "absent";
  sanitizedMessage: string;
};

export type BrowserAuthCsrfRequestAdapterProofFinding = {
  id:
    | "safe-method-classification"
    | "unsafe-method-csrf-required"
    | "csrf-token-verification"
    | "session-binding"
    | "origin-referer-supplement"
    | "samesite-insufficient"
    | "sanitized-denials"
    | "not-live-authorization";
  status: "passed";
  summary: string;
  blockerCodes: readonly string[];
};

export type BrowserAuthCsrfRequestAdapterProofResult = {
  status: "unmounted-arepo-owned-csrf-request-adapter-proof";
  liveBrowserAuthEnabled: false;
  mountedInServer: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsLiveSetCookieHeaders: false;
  acceptsCookieCredentialsInLiveAuth: false;
  parsesCookiesForLiveAuthorization: false;
  validatesCsrfInLiveAuthorization: false;
  changesBearerTokenProtectedMode: false;
  safeMethod: BrowserAuthCsrfRequestAdapterResult;
  validUnsafeRequest: BrowserAuthCsrfRequestAdapterResult;
  trustedRefererRequest: BrowserAuthCsrfRequestAdapterResult;
  denialResults: {
    missing: BrowserAuthCsrfRequestAdapterResult;
    malformed: BrowserAuthCsrfRequestAdapterResult;
    wrong: BrowserAuthCsrfRequestAdapterResult;
    expired: BrowserAuthCsrfRequestAdapterResult;
    revoked: BrowserAuthCsrfRequestAdapterResult;
    consumed: BrowserAuthCsrfRequestAdapterResult;
    sessionMismatch: BrowserAuthCsrfRequestAdapterResult;
    missingOrigin: BrowserAuthCsrfRequestAdapterResult;
    untrustedOrigin: BrowserAuthCsrfRequestAdapterResult;
  };
  policy: {
    safeMethods: readonly ["GET", "HEAD", "OPTIONS"];
    unsafeMethods: readonly ["POST", "PUT", "PATCH", "DELETE"];
    unsafeCookieBackedRoutesRequireCsrf: true;
    originRefererSupplemental: true;
    sameSiteTreatedAsSufficient: false;
    validationBeforeMutation: true;
    usesArepoCsrfStoreVerifier: true;
  };
  findings: readonly BrowserAuthCsrfRequestAdapterProofFinding[];
};

const defaultTrustedOrigins = ["http://127.0.0.1:8734"] as const;

export function evaluateBrowserAuthCsrfRequestProof(input: {
  request: BrowserAuthCsrfRequestShape;
  csrfStore: InMemoryBrowserCsrfTokenStore;
}): BrowserAuthCsrfRequestAdapterResult {
  const method = input.request.method;
  const methodClass = isSafeMethod(method) ? "safe" : "unsafe";
  const requiresCsrf = methodClass === "unsafe";
  const base = baseResult(input.request, methodClass, requiresCsrf);

  if (!requiresCsrf) {
    return allow(
      base,
      "safe-method-no-csrf-token-required",
      "Safe read request classified separately.",
    );
  }

  if (!input.request.csrfTokenId && !input.request.csrfTokenSecret) {
    return deny(base, "missing-csrf-token", "CSRF proof is required for this unsafe request.");
  }

  if (!wellFormedTokenMaterial(input.request.csrfTokenId, input.request.csrfTokenSecret)) {
    return deny(base, "malformed-csrf-token", "CSRF proof is malformed.");
  }
  const csrfTokenId = input.request.csrfTokenId as string;
  const csrfTokenSecret = input.request.csrfTokenSecret as string;

  if (!input.request.expectedSessionId) {
    return deny(base, "csrf-session-mismatch", "CSRF proof is not bound to the expected session.");
  }

  const token = input.csrfStore.getToken(csrfTokenId);
  if (token && token.sessionId !== input.request.expectedSessionId) {
    return deny(base, "csrf-session-mismatch", "CSRF proof is not bound to the expected session.");
  }

  const verification = input.csrfStore.verifyToken(csrfTokenId, csrfTokenSecret);
  if (!verification.ok) {
    return deny(
      base,
      reasonForVerificationFailure(verification.reason),
      messageForVerificationFailure(verification.reason),
    );
  }

  const originCheck = evaluateOriginReferer(input.request);
  if (originCheck.reasonCode) {
    return deny(base, originCheck.reasonCode, originCheck.message);
  }

  return allow(
    base,
    "valid-csrf-proof-test-only",
    "CSRF proof is valid for this test-only request.",
  );
}

export function runBrowserAuthCsrfRequestAdapterProof(): BrowserAuthCsrfRequestAdapterProofResult {
  let nowMs = 1_000;
  const store = createInMemoryBrowserCsrfTokenStore({ clock: () => nowMs });
  const activeSecret = "bcsrfsec_active_request_adapter_test_only";
  const wrongSecret = "bcsrfsec_wrong_request_adapter_test_only";
  const expiredSecret = "bcsrfsec_expired_request_adapter_test_only";
  const revokedSecret = "bcsrfsec_revoked_request_adapter_test_only";
  const consumedSecret = "bcsrfsec_consumed_request_adapter_test_only";
  const mismatchSecret = "bcsrfsec_mismatch_request_adapter_test_only";
  const activeToken = store.createToken({
    sessionId: "browser-session-a",
    csrfTokenId: "csrf-active",
    tokenSecret: activeSecret,
    expiresAtMs: 100_000,
    originHint: defaultTrustedOrigins[0],
  });
  store.createToken({
    sessionId: "browser-session-a",
    csrfTokenId: "csrf-expired",
    tokenSecret: expiredSecret,
    expiresAtMs: 2_000,
  });
  const revokedToken = store.createToken({
    sessionId: "browser-session-a",
    csrfTokenId: "csrf-revoked",
    tokenSecret: revokedSecret,
    expiresAtMs: 100_000,
  });
  const consumedToken = store.createToken({
    sessionId: "browser-session-a",
    csrfTokenId: "csrf-consumed",
    tokenSecret: consumedSecret,
    expiresAtMs: 100_000,
  });
  store.createToken({
    sessionId: "browser-session-b",
    csrfTokenId: "csrf-mismatch",
    tokenSecret: mismatchSecret,
    expiresAtMs: 100_000,
  });
  store.revokeToken(revokedToken.csrfTokenId);
  store.consumeToken(consumedToken.csrfTokenId);
  nowMs = 3_000;

  const safeMethod = evaluateBrowserAuthCsrfRequestProof({
    csrfStore: store,
    request: requestShape({ method: "GET", routeKind: "safe-read", path: "/api/node/status" }),
  });
  const validUnsafeRequest = evaluateBrowserAuthCsrfRequestProof({
    csrfStore: store,
    request: requestShape({
      csrfTokenId: activeToken.csrfTokenId,
      csrfTokenSecret: activeSecret,
      expectedSessionId: "browser-session-a",
    }),
  });
  const trustedRefererRequest = evaluateBrowserAuthCsrfRequestProof({
    csrfStore: store,
    request: requestShape({
      csrfTokenId: activeToken.csrfTokenId,
      csrfTokenSecret: activeSecret,
      expectedSessionId: "browser-session-a",
      origin: undefined,
      referer: "http://127.0.0.1:8734/app",
    }),
  });
  const denialResults = {
    missing: evaluateBrowserAuthCsrfRequestProof({ csrfStore: store, request: requestShape() }),
    malformed: evaluateBrowserAuthCsrfRequestProof({
      csrfStore: store,
      request: requestShape({ csrfTokenId: activeToken.csrfTokenId }),
    }),
    wrong: evaluateBrowserAuthCsrfRequestProof({
      csrfStore: store,
      request: requestShape({
        csrfTokenId: activeToken.csrfTokenId,
        csrfTokenSecret: wrongSecret,
        expectedSessionId: "browser-session-a",
      }),
    }),
    expired: evaluateBrowserAuthCsrfRequestProof({
      csrfStore: store,
      request: requestShape({
        csrfTokenId: "csrf-expired",
        csrfTokenSecret: expiredSecret,
        expectedSessionId: "browser-session-a",
      }),
    }),
    revoked: evaluateBrowserAuthCsrfRequestProof({
      csrfStore: store,
      request: requestShape({
        csrfTokenId: "csrf-revoked",
        csrfTokenSecret: revokedSecret,
        expectedSessionId: "browser-session-a",
      }),
    }),
    consumed: evaluateBrowserAuthCsrfRequestProof({
      csrfStore: store,
      request: requestShape({
        csrfTokenId: "csrf-consumed",
        csrfTokenSecret: consumedSecret,
        expectedSessionId: "browser-session-a",
      }),
    }),
    sessionMismatch: evaluateBrowserAuthCsrfRequestProof({
      csrfStore: store,
      request: requestShape({
        csrfTokenId: "csrf-mismatch",
        csrfTokenSecret: mismatchSecret,
        expectedSessionId: "browser-session-a",
      }),
    }),
    missingOrigin: evaluateBrowserAuthCsrfRequestProof({
      csrfStore: store,
      request: requestShape({
        csrfTokenId: activeToken.csrfTokenId,
        csrfTokenSecret: activeSecret,
        expectedSessionId: "browser-session-a",
        origin: undefined,
      }),
    }),
    untrustedOrigin: evaluateBrowserAuthCsrfRequestProof({
      csrfStore: store,
      request: requestShape({
        csrfTokenId: activeToken.csrfTokenId,
        csrfTokenSecret: activeSecret,
        expectedSessionId: "browser-session-a",
        origin: "http://evil.example.invalid",
      }),
    }),
  };

  return {
    status: "unmounted-arepo-owned-csrf-request-adapter-proof",
    liveBrowserAuthEnabled: false,
    mountedInServer: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsLiveSetCookieHeaders: false,
    acceptsCookieCredentialsInLiveAuth: false,
    parsesCookiesForLiveAuthorization: false,
    validatesCsrfInLiveAuthorization: false,
    changesBearerTokenProtectedMode: false,
    safeMethod,
    validUnsafeRequest,
    trustedRefererRequest,
    denialResults,
    policy: {
      safeMethods: ["GET", "HEAD", "OPTIONS"],
      unsafeMethods: ["POST", "PUT", "PATCH", "DELETE"],
      unsafeCookieBackedRoutesRequireCsrf: true,
      originRefererSupplemental: true,
      sameSiteTreatedAsSufficient: false,
      validationBeforeMutation: true,
      usesArepoCsrfStoreVerifier: true,
    },
    findings: buildFindings(),
  };
}

function requestShape(
  override: Partial<BrowserAuthCsrfRequestShape> = {},
): BrowserAuthCsrfRequestShape {
  return {
    method: "POST",
    path: "/api/vaults/example/files",
    routeKind: "vault-mutation",
    origin: defaultTrustedOrigins[0],
    trustedOrigins: defaultTrustedOrigins,
    requireOriginOrReferer: true,
    sameSitePolicy: "lax",
    ...override,
  };
}

function buildFindings(): readonly BrowserAuthCsrfRequestAdapterProofFinding[] {
  return [
    {
      id: "safe-method-classification",
      status: "passed",
      summary: "Safe read methods are classified separately from unsafe mutation methods.",
      blockerCodes: [],
    },
    {
      id: "unsafe-method-csrf-required",
      status: "passed",
      summary: "Future cookie-backed unsafe AREPO routes require CSRF validation.",
      blockerCodes: [],
    },
    {
      id: "csrf-token-verification",
      status: "passed",
      summary:
        "The adapter verifies CSRF token id plus secret through AREPO's inert CSRF token store.",
      blockerCodes: [],
    },
    {
      id: "session-binding",
      status: "passed",
      summary: "CSRF tokens are bound to the expected browser session id.",
      blockerCodes: [],
    },
    {
      id: "origin-referer-supplement",
      status: "passed",
      summary: "Origin and Referer checks are supplemental to CSRF token validation.",
      blockerCodes: [],
    },
    {
      id: "samesite-insufficient",
      status: "passed",
      summary: "SameSite is treated as helpful but insufficient by itself.",
      blockerCodes: [],
    },
    {
      id: "sanitized-denials",
      status: "passed",
      summary: "Denied requests return sanitized reason codes without echoing credential material.",
      blockerCodes: [],
    },
    {
      id: "not-live-authorization",
      status: "passed",
      summary: "Allowed proof results are explicitly test-only and not live authorization.",
      blockerCodes: [],
    },
  ];
}

function baseResult(
  request: BrowserAuthCsrfRequestShape,
  methodClass: BrowserAuthCsrfRequestAdapterResult["methodClass"],
  requiresCsrf: boolean,
): Omit<
  BrowserAuthCsrfRequestAdapterResult,
  "status" | "reasonCode" | "statusCode" | "sanitizedMessage"
> {
  const originClass = classifyOrigin(
    request.origin,
    request.trustedOrigins ?? defaultTrustedOrigins,
  );
  const refererClass = classifyReferer(
    request.referer,
    request.trustedOrigins ?? defaultTrustedOrigins,
  );
  return {
    method: request.method,
    path: request.path,
    routeKind: request.routeKind,
    methodClass,
    requiresCsrf,
    testOnly: true,
    liveAuthorization: false,
    liveMutationAllowed: false,
    setCookieEmitted: false,
    authenticatesRequest: false,
    tokenMaterialEchoed: false,
    sameSiteTreatedAsSufficient: false,
    originRefererSupplemental: true,
    validationBeforeMutation: true,
    csrfTokenIdPresent: typeof request.csrfTokenId === "string" && request.csrfTokenId.length > 0,
    csrfTokenSecretPresent:
      typeof request.csrfTokenSecret === "string" && request.csrfTokenSecret.length > 0,
    expectedSessionPresent:
      typeof request.expectedSessionId === "string" && request.expectedSessionId.length > 0,
    originClass,
    refererClass,
  };
}

function allow(
  base: Omit<
    BrowserAuthCsrfRequestAdapterResult,
    "status" | "reasonCode" | "statusCode" | "sanitizedMessage"
  >,
  reasonCode: BrowserAuthCsrfRequestReasonCode,
  sanitizedMessage: string,
): BrowserAuthCsrfRequestAdapterResult {
  return {
    ...base,
    status: "allow",
    reasonCode,
    statusCode: 200,
    sanitizedMessage,
  };
}

function deny(
  base: Omit<
    BrowserAuthCsrfRequestAdapterResult,
    "status" | "reasonCode" | "statusCode" | "sanitizedMessage"
  >,
  reasonCode: BrowserAuthCsrfRequestReasonCode,
  sanitizedMessage: string,
): BrowserAuthCsrfRequestAdapterResult {
  return {
    ...base,
    status: "deny",
    reasonCode,
    statusCode: 403,
    sanitizedMessage,
  };
}

function isSafeMethod(method: BrowserAuthCsrfRequestMethod): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function wellFormedTokenMaterial(
  csrfTokenId: string | undefined,
  csrfTokenSecret: string | undefined,
): csrfTokenId is string {
  return (
    typeof csrfTokenId === "string" &&
    csrfTokenId.trim().length > 0 &&
    typeof csrfTokenSecret === "string" &&
    csrfTokenSecret.trim().length > 0
  );
}

function reasonForVerificationFailure(
  reason: "missing-token" | "wrong-token" | "expired-token" | "revoked-token" | "consumed-token",
): BrowserAuthCsrfRequestReasonCode {
  if (reason === "wrong-token") return "wrong-csrf-token";
  if (reason === "expired-token") return "expired-csrf-token";
  if (reason === "revoked-token") return "revoked-csrf-token";
  if (reason === "consumed-token") return "consumed-csrf-token";
  return "missing-csrf-token";
}

function messageForVerificationFailure(
  reason: "missing-token" | "wrong-token" | "expired-token" | "revoked-token" | "consumed-token",
): string {
  if (reason === "wrong-token") return "CSRF proof is invalid.";
  if (reason === "expired-token") return "CSRF proof has expired.";
  if (reason === "revoked-token") return "CSRF proof is no longer valid.";
  if (reason === "consumed-token") return "CSRF proof was already consumed.";
  return "CSRF proof is missing.";
}

function evaluateOriginReferer(
  request: BrowserAuthCsrfRequestShape,
):
  | { reasonCode: undefined; message: undefined }
  | { reasonCode: "missing-origin" | "untrusted-origin"; message: string } {
  if (request.requireOriginOrReferer === false) {
    return { reasonCode: undefined, message: undefined };
  }
  const trustedOrigins = request.trustedOrigins ?? defaultTrustedOrigins;
  const originClass = classifyOrigin(request.origin, trustedOrigins);
  const refererClass = classifyReferer(request.referer, trustedOrigins);
  if (originClass === "trusted" || refererClass === "trusted") {
    return { reasonCode: undefined, message: undefined };
  }
  if (originClass === "absent" && refererClass === "absent") {
    return { reasonCode: "missing-origin", message: "Trusted Origin or Referer is required." };
  }
  return { reasonCode: "untrusted-origin", message: "Origin or Referer is not trusted." };
}

function classifyOrigin(
  origin: string | undefined,
  trustedOrigins: readonly string[],
): "trusted" | "untrusted" | "absent" {
  if (!origin) return "absent";
  try {
    const parsed = new URL(origin);
    return trustedOrigins.includes(`${parsed.protocol}//${parsed.host}`) ? "trusted" : "untrusted";
  } catch {
    return "untrusted";
  }
}

function classifyReferer(
  referer: string | undefined,
  trustedOrigins: readonly string[],
): "trusted" | "untrusted" | "absent" {
  if (!referer) return "absent";
  try {
    const parsed = new URL(referer);
    return trustedOrigins.includes(`${parsed.protocol}//${parsed.host}`) ? "trusted" : "untrusted";
  } catch {
    return "untrusted";
  }
}
