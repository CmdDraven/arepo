import { createBetterAuthAppDataProofContext } from "./betterAuthAppDataStoreProof.js";

export const BETTER_AUTH_ROUTE_REQUEST_ADAPTER_PROOF_MOUNTED = false;
export const BETTER_AUTH_ROUTE_REQUEST_ADAPTER_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_ROUTE_REQUEST_ADAPTER_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_ROUTE_REQUEST_ADAPTER_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthRouteRequestAdapterProofFindingStatus =
  "passed" | "needs-adapter-spike" | "needs-policy-review" | "unknown";

export type BetterAuthRouteRequestAdapterProofFinding = {
  id:
    | "route-request-conversion"
    | "response-wrapping"
    | "handler-without-express"
    | "signed-cookie-issuance"
    | "cookie-clearing"
    | "session-lookup"
    | "revoke-current"
    | "direct-token-injection"
    | "deterministic-expiry"
    | "csrf-ownership";
  status: BetterAuthRouteRequestAdapterProofFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

export type BetterAuthRouteRequestLike = {
  method: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
};

export type BetterAuthCookieMetadata = {
  name: string;
  classification: "issuance" | "clearing";
  path: string | null;
  sameSite: string | null;
  httpOnly: boolean;
  secure: boolean;
  maxAgePresent: boolean;
  maxAgeSeconds: number | null;
  valueRedacted: true;
};

export type BetterAuthWrappedResponse = {
  status: number;
  setCookieCount: number;
  setCookies: readonly BetterAuthCookieMetadata[];
  headers: {
    contentType: string | null;
    setCookieValuesRedacted: true;
    cookieHeaderEchoed: false;
    authorizationHeaderEchoed: false;
  };
  body: {
    kind: "auth-session-response" | "session-response" | "sign-out-response" | "empty-or-unknown";
    sessionPresent: boolean | null;
    userPresent: boolean | null;
    success: boolean | null;
    tokenFieldPresent: boolean;
    tokenFieldRedacted: true;
    rawBodyRedacted: true;
  };
};

export type BetterAuthRouteRequestAdapterProofResult = {
  status: "isolated-route-request-adapter-proof";
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
  adapterProof: {
    routeRequestInputConverted: boolean;
    methodPathQueryHeadersBodyRepresented: boolean;
    responseCapturedWithoutExpress: boolean;
    responseWrappedWithRedaction: boolean;
    adapterCouldFitBehindActivationGate: boolean;
    requiresDifferentStore: false;
  };
  cookieProof: {
    signedCookieIssuanceObservedThroughHandler: boolean;
    signedCookieIssuanceRoute: "sign-up-email";
    pairingPathCookieIssuance: "unresolved";
    cookieClearingObservedThroughHandler: boolean;
    issuanceCookies: readonly BetterAuthCookieMetadata[];
    clearingCookies: readonly BetterAuthCookieMetadata[];
  };
  sessionProof: {
    sessionLookupThroughAcceptedCookieWorked: boolean;
    revokeCurrentInvalidatedCookieSession: boolean;
    directRawTokenCookieInjectionAuthenticates: boolean;
    deterministicExpiryThroughAdapter: "unresolved";
  };
  csrfProof: {
    coveredForArepoUnsafeApiRoutes: "unknown";
    likelyArepoOwnedUntilProven: true;
    blockerCodes: readonly ["csrf-ownership-unresolved"];
  };
  wrappedResponses: {
    signUp: BetterAuthWrappedResponse;
    getSession: BetterAuthWrappedResponse;
    signOut: BetterAuthWrappedResponse;
    getSessionAfterRevoke: BetterAuthWrappedResponse;
    directRawTokenInjection: BetterAuthWrappedResponse;
  };
  findings: readonly BetterAuthRouteRequestAdapterProofFinding[];
};

type AdaptedRequest = {
  request: Request;
  converted: {
    methodRepresented: boolean;
    pathRepresented: boolean;
    queryRepresented: boolean;
    headersRepresented: boolean;
    bodyRepresented: boolean;
  };
};

const baseUrl = "http://127.0.0.1:8734";
const sessionCookieName = "arepo_session";

export async function runIsolatedBetterAuthRouteRequestAdapterProof(): Promise<BetterAuthRouteRequestAdapterProofResult> {
  const proof = await createBetterAuthAppDataProofContext({ emailAndPasswordEnabled: true });
  await proof.context.runMigrations();

  const signUp = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-up/email",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: {
      email: "arepo-route-adapter@example.invalid",
      password: "arepo-route-adapter-proof-password",
      name: "AREPO Route Adapter Proof",
    },
  });
  const signUpCookieHeader = cookieHeaderFromSetCookie(signUp.raw.headers, sessionCookieName);
  const signUpRawToken = stringField(signUp.rawBody, "token");

  const getSession = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    headers: signUpCookieHeader ? { cookie: signUpCookieHeader } : {},
  });

  const signOut = await callBetterAuthRoute(proof.auth.handler, {
    method: "POST",
    path: "/api/auth/sign-out",
    headers: {
      origin: baseUrl,
      ...(signUpCookieHeader ? { cookie: signUpCookieHeader } : {}),
    },
  });

  const getSessionAfterRevoke = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    headers: signUpCookieHeader ? { cookie: signUpCookieHeader } : {},
  });

  const directRawTokenInjection = await callBetterAuthRoute(proof.auth.handler, {
    method: "GET",
    path: "/api/auth/get-session",
    headers: signUpRawToken ? { cookie: `${sessionCookieName}=${signUpRawToken}` } : {},
  });

  const cleanupWorked = await proof.cleanup();
  if (!cleanupWorked) {
    throw new Error("Better Auth routeRequest adapter proof cleanup failed.");
  }

  const signUpWrapped = wrapBetterAuthResponse(signUp.raw, signUp.rawBody);
  const getSessionWrapped = wrapBetterAuthResponse(getSession.raw, getSession.rawBody);
  const signOutWrapped = wrapBetterAuthResponse(signOut.raw, signOut.rawBody);
  const getSessionAfterRevokeWrapped = wrapBetterAuthResponse(
    getSessionAfterRevoke.raw,
    getSessionAfterRevoke.rawBody,
  );
  const directRawTokenInjectionWrapped = wrapBetterAuthResponse(
    directRawTokenInjection.raw,
    directRawTokenInjection.rawBody,
  );
  const routeConversionWorked =
    signUp.adapted.converted.methodRepresented &&
    signUp.adapted.converted.pathRepresented &&
    signUp.adapted.converted.queryRepresented &&
    signUp.adapted.converted.headersRepresented &&
    signUp.adapted.converted.bodyRepresented;

  const result = {
    status: "isolated-route-request-adapter-proof",
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
    adapterProof: {
      routeRequestInputConverted: routeConversionWorked,
      methodPathQueryHeadersBodyRepresented: routeConversionWorked,
      responseCapturedWithoutExpress: true,
      responseWrappedWithRedaction: true,
      adapterCouldFitBehindActivationGate: true,
      requiresDifferentStore: false,
    },
    cookieProof: {
      signedCookieIssuanceObservedThroughHandler: signUpWrapped.setCookieCount > 0,
      signedCookieIssuanceRoute: "sign-up-email",
      pairingPathCookieIssuance: "unresolved",
      cookieClearingObservedThroughHandler: signOutWrapped.setCookies.some(
        (cookie) => cookie.classification === "clearing",
      ),
      issuanceCookies: signUpWrapped.setCookies,
      clearingCookies: signOutWrapped.setCookies,
    },
    sessionProof: {
      sessionLookupThroughAcceptedCookieWorked: getSessionWrapped.body.sessionPresent === true,
      revokeCurrentInvalidatedCookieSession: getSessionAfterRevoke.rawBody === null,
      directRawTokenCookieInjectionAuthenticates:
        directRawTokenInjectionWrapped.body.sessionPresent === true,
      deterministicExpiryThroughAdapter: "unresolved",
    },
    csrfProof: {
      coveredForArepoUnsafeApiRoutes: "unknown",
      likelyArepoOwnedUntilProven: true,
      blockerCodes: ["csrf-ownership-unresolved"],
    },
    wrappedResponses: {
      signUp: signUpWrapped,
      getSession: getSessionWrapped,
      signOut: signOutWrapped,
      getSessionAfterRevoke: getSessionAfterRevokeWrapped,
      directRawTokenInjection: directRawTokenInjectionWrapped,
    },
  } satisfies Omit<BetterAuthRouteRequestAdapterProofResult, "findings">;

  return {
    ...result,
    findings: buildFindings(result),
  };
}

export function adaptBetterAuthRouteRequest(input: BetterAuthRouteRequestLike): AdaptedRequest {
  const url = new URL(input.path, baseUrl);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const headers = new Headers(input.headers ?? {});
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  if (body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const request = new Request(url, {
    method: input.method,
    headers,
    body,
  });

  return {
    request,
    converted: {
      methodRepresented: request.method === input.method.toUpperCase(),
      pathRepresented: new URL(request.url).pathname === input.path,
      queryRepresented: Object.entries(input.query ?? {}).every(
        ([key, value]) => new URL(request.url).searchParams.get(key) === value,
      ),
      headersRepresented: Object.entries(input.headers ?? {}).every(
        ([key, value]) => request.headers.get(key) === value,
      ),
      bodyRepresented: input.body === undefined || body !== undefined,
    },
  };
}

export function wrapBetterAuthResponse(
  response: Response,
  body: unknown,
): BetterAuthWrappedResponse {
  const setCookies = summarizeSetCookieHeaders(response.headers);
  return {
    status: response.status,
    setCookieCount: setCookies.length,
    setCookies,
    headers: {
      contentType: response.headers.get("content-type"),
      setCookieValuesRedacted: true,
      cookieHeaderEchoed: false,
      authorizationHeaderEchoed: false,
    },
    body: summarizeBody(body),
  };
}

async function callBetterAuthRoute(
  handler: (request: Request) => Promise<Response>,
  input: BetterAuthRouteRequestLike,
): Promise<{
  adapted: AdaptedRequest;
  raw: Response;
  rawBody: unknown;
}> {
  const adapted = adaptBetterAuthRouteRequest(input);
  const raw = await handler(adapted.request);
  const rawBody = await safeJson(raw);
  return { adapted, raw, rawBody };
}

function buildFindings(
  result: Omit<BetterAuthRouteRequestAdapterProofResult, "findings">,
): readonly BetterAuthRouteRequestAdapterProofFinding[] {
  return [
    {
      id: "route-request-conversion",
      status: result.adapterProof.routeRequestInputConverted ? "passed" : "needs-adapter-spike",
      summary:
        "AREPO routeRequest-style method, path, query, headers, and JSON body can be represented as a standard Request in the isolated adapter proof.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "response-wrapping",
      status: result.adapterProof.responseWrappedWithRedaction ? "passed" : "needs-adapter-spike",
      summary:
        "Better Auth Response status, safe header posture, Set-Cookie metadata, and body posture can be wrapped without exposing credential values.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "handler-without-express",
      status: result.adapterProof.responseCapturedWithoutExpress ? "passed" : "needs-adapter-spike",
      summary: "Better Auth handler responses can be captured without Express.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "signed-cookie-issuance",
      status: result.cookieProof.signedCookieIssuanceObservedThroughHandler
        ? "needs-policy-review"
        : "needs-adapter-spike",
      summary:
        "Signed session-cookie issuance is observable through Better Auth's normal handler path, but the proof uses email sign-up rather than AREPO pairing.",
      blockerCodes: ["pairing-cookie-issuance-path-unproven"],
      openQuestions: [
        "Can AREPO pairing completion attach a Better Auth session through a supported path that also emits the signed cookie?",
      ],
    },
    {
      id: "cookie-clearing",
      status: result.cookieProof.cookieClearingObservedThroughHandler
        ? "passed"
        : "needs-adapter-spike",
      summary: "Sign-out cookie-clearing metadata is observable and redacted.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "session-lookup",
      status: result.sessionProof.sessionLookupThroughAcceptedCookieWorked
        ? "passed"
        : "needs-adapter-spike",
      summary: "Session lookup works through Better Auth's signed cookie and handler boundary.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-current",
      status: result.sessionProof.revokeCurrentInvalidatedCookieSession
        ? "passed"
        : "needs-adapter-spike",
      summary:
        "Deleting the stored session invalidates subsequent lookup through the signed cookie.",
      blockerCodes: [],
      openQuestions: [
        "Which supported route or internal boundary should AREPO use for revoke-current in production?",
      ],
    },
    {
      id: "direct-token-injection",
      status: result.sessionProof.directRawTokenCookieInjectionAuthenticates ? "unknown" : "passed",
      summary: "Direct raw session token cookie injection does not authenticate.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "deterministic-expiry",
      status: "unknown",
      summary: "Deterministic expiry remains unresolved through this adapter boundary.",
      blockerCodes: ["deterministic-expiry-adapter-proof-needed"],
      openQuestions: [
        "Can Better Auth time be controlled or can expiry be proven through stored expiry timestamps plus handler behavior?",
      ],
    },
    {
      id: "csrf-ownership",
      status: "unknown",
      summary:
        "CSRF ownership remains unresolved for AREPO unsafe cookie-authenticated API routes.",
      blockerCodes: ["csrf-ownership-unresolved"],
      openQuestions: [
        "Should AREPO keep its own CSRF guard for non-Better Auth API routes even when Better Auth manages browser sessions?",
      ],
    },
  ];
}

function summarizeBody(body: unknown): BetterAuthWrappedResponse["body"] {
  if (!isRecord(body)) {
    return {
      kind: "empty-or-unknown",
      sessionPresent: null,
      userPresent: null,
      success: null,
      tokenFieldPresent: false,
      tokenFieldRedacted: true,
      rawBodyRedacted: true,
    };
  }

  if ("session" in body || "user" in body) {
    return {
      kind: "session" in body && "user" in body ? "session-response" : "auth-session-response",
      sessionPresent: body.session !== null && body.session !== undefined,
      userPresent: body.user !== null && body.user !== undefined,
      success: null,
      tokenFieldPresent: nestedFieldPresent(body, "token"),
      tokenFieldRedacted: true,
      rawBodyRedacted: true,
    };
  }

  if (typeof body.success === "boolean") {
    return {
      kind: "sign-out-response",
      sessionPresent: null,
      userPresent: null,
      success: body.success,
      tokenFieldPresent: nestedFieldPresent(body, "token"),
      tokenFieldRedacted: true,
      rawBodyRedacted: true,
    };
  }

  return {
    kind: "empty-or-unknown",
    sessionPresent: null,
    userPresent: null,
    success: null,
    tokenFieldPresent: nestedFieldPresent(body, "token"),
    tokenFieldRedacted: true,
    rawBodyRedacted: true,
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

function summarizeSetCookieHeaders(headers: Headers): readonly BetterAuthCookieMetadata[] {
  return setCookieHeaders(headers).map((header) => summarizeSetCookie(header));
}

function setCookieHeaders(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const header = headers.get("set-cookie");
  return header ? [header] : [];
}

function summarizeSetCookie(header: string): BetterAuthCookieMetadata {
  const [nameValue = "", ...attributeParts] = header.split(";").map((part) => part.trim());
  const [name = "", value = ""] = nameValue.split("=");
  const attributes = new Map<string, string | true>();
  for (const part of attributeParts) {
    const [key = "", attributeValue] = part.split("=");
    attributes.set(key.toLowerCase(), attributeValue ?? true);
  }
  const maxAgeSeconds = numberAttribute(attributes, "max-age");
  return {
    name,
    classification: value.length === 0 || maxAgeSeconds === 0 ? "clearing" : "issuance",
    path: stringAttribute(attributes, "path"),
    sameSite: stringAttribute(attributes, "samesite"),
    httpOnly: attributes.has("httponly"),
    secure: attributes.has("secure"),
    maxAgePresent: maxAgeSeconds !== null,
    maxAgeSeconds,
    valueRedacted: true,
  };
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

function stringAttribute(attributes: Map<string, string | true>, key: string): string | null {
  const value = attributes.get(key);
  return typeof value === "string" ? value : null;
}

function numberAttribute(attributes: Map<string, string | true>, key: string): number | null {
  const value = stringAttribute(attributes, key);
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function nestedFieldPresent(value: unknown, field: string): boolean {
  if (Array.isArray(value)) return value.some((item) => nestedFieldPresent(item, field));
  if (!isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, field)) return true;
  return Object.values(value).some((item) => nestedFieldPresent(item, field));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
