import {
  plannedBrowserCsrfCookiePolicy,
  plannedBrowserSessionCookiePolicy,
  type BrowserCookieKind,
  type BrowserCookieSameSite,
  type PlannedBrowserCookiePolicy,
} from "./browserCookiePolicy.js";

export const BROWSER_AUTH_COOKIE_SERIALIZATION_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_COOKIE_SERIALIZATION_TEST_ONLY = true;
export const BROWSER_AUTH_COOKIE_SERIALIZATION_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_COOKIE_SERIALIZATION_WIRED_INTO_ROUTES = false;

export type BrowserAuthCookieSerializationInput = {
  sessionId: string;
  sessionVerifierSecret: string;
  csrfTokenId: string;
  csrfTokenSecret: string;
  localDevelopment?: boolean;
  sessionCookiePolicy?: PlannedBrowserCookiePolicy;
  csrfCookiePolicy?: PlannedBrowserCookiePolicy;
};

export type BrowserAuthCookieClearingInput = {
  localDevelopment?: boolean;
  sessionCookiePolicy?: PlannedBrowserCookiePolicy;
  csrfCookiePolicy?: PlannedBrowserCookiePolicy;
};

export type BrowserAuthSerializedCookieAttributes = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: BrowserCookieSameSite;
  path: string;
  domain: null;
  hostOnly: true;
  maxAgeSeconds: number;
};

export type BrowserAuthSerializedCookieSummary = {
  kind: BrowserCookieKind;
  name: string;
  attributes: BrowserAuthSerializedCookieAttributes;
  valueRedacted: true;
  serializedSetCookieRedacted: string;
  testOnly: true;
  emitsLiveSetCookieHeader: false;
};

export type BrowserAuthSerializedCookie = BrowserAuthSerializedCookieSummary & {
  serializedSetCookie: string;
};

export type BrowserAuthCookieSerializationPlan = {
  status: "test-only-planned";
  operation: "issue";
  testOnly: true;
  sessionCookie: BrowserAuthSerializedCookie;
  csrfCookie: BrowserAuthSerializedCookie;
  serializedSetCookieHeaders: readonly [string, string];
  redactedSummary: BrowserAuthCookieRedactedSummary & { operation: "issue" };
  emitsLiveSetCookieHeader: false;
  acceptsCookieCredential: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  networkExposureSafe: false;
};

type BrowserAuthCookieRedactedSummary = {
  status: "test-only-planned";
  operation: "issue" | "clear";
  cookies: readonly [BrowserAuthSerializedCookieSummary, BrowserAuthSerializedCookieSummary];
  emitsLiveSetCookieHeader: false;
  acceptsCookieCredential: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  networkExposureSafe: false;
};

export type BrowserAuthCookieClearingPlan = {
  status: "test-only-planned";
  operation: "clear";
  testOnly: true;
  sessionCookie: BrowserAuthSerializedCookie;
  csrfCookie: BrowserAuthSerializedCookie;
  serializedSetCookieHeaders: readonly [string, string];
  redactedSummary: BrowserAuthCookieRedactedSummary & { operation: "clear" };
  emitsLiveSetCookieHeader: false;
  acceptsCookieCredential: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  networkExposureSafe: false;
};

export type BrowserAuthCookieSerializationDiagnostics = {
  status: "inactive";
  implementation: "test-only-cookie-serialization-primitive";
  testOnly: true;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsLiveSetCookieHeader: false;
  acceptsCookieCredential: false;
  serializesFutureCookieHeaders: true;
  redactsCookieValues: true;
  networkExposureSafe: false;
};

export function planBrowserAuthTestOnlyIssueCookies(
  input: BrowserAuthCookieSerializationInput,
): BrowserAuthCookieSerializationPlan {
  const sessionPolicy = input.sessionCookiePolicy ?? defaultSessionPolicy(input.localDevelopment);
  const csrfPolicy = input.csrfCookiePolicy ?? defaultCsrfPolicy(input.localDevelopment);
  validatePolicyForSerialization(sessionPolicy);
  validatePolicyForSerialization(csrfPolicy);

  const sessionCookie = serializeCookie({
    policy: sessionPolicy,
    value: `${encodeCookieValue(input.sessionId)}.${encodeCookieValue(input.sessionVerifierSecret)}`,
  });
  const csrfCookie = serializeCookie({
    policy: csrfPolicy,
    value: `${encodeCookieValue(input.csrfTokenId)}.${encodeCookieValue(input.csrfTokenSecret)}`,
  });

  return issuePlan(sessionCookie, csrfCookie);
}

export function planBrowserAuthTestOnlyClearCookies(
  input: BrowserAuthCookieClearingInput = {},
): BrowserAuthCookieClearingPlan {
  const sessionPolicy = input.sessionCookiePolicy ?? defaultSessionPolicy(input.localDevelopment);
  const csrfPolicy = input.csrfCookiePolicy ?? defaultCsrfPolicy(input.localDevelopment);
  validatePolicyForSerialization(sessionPolicy);
  validatePolicyForSerialization(csrfPolicy);

  const sessionCookie = serializeCookie({ policy: sessionPolicy, value: "", maxAgeSeconds: 0 });
  const csrfCookie = serializeCookie({ policy: csrfPolicy, value: "", maxAgeSeconds: 0 });

  return clearPlan(sessionCookie, csrfCookie);
}

export function getBrowserAuthCookieSerializationDiagnostics(): BrowserAuthCookieSerializationDiagnostics {
  return {
    status: "inactive",
    implementation: "test-only-cookie-serialization-primitive",
    testOnly: true,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsLiveSetCookieHeader: false,
    acceptsCookieCredential: false,
    serializesFutureCookieHeaders: true,
    redactsCookieValues: true,
    networkExposureSafe: false,
  };
}

function issuePlan(
  sessionCookie: BrowserAuthSerializedCookie,
  csrfCookie: BrowserAuthSerializedCookie,
): BrowserAuthCookieSerializationPlan {
  return {
    status: "test-only-planned",
    operation: "issue",
    testOnly: true,
    sessionCookie,
    csrfCookie,
    serializedSetCookieHeaders: [sessionCookie.serializedSetCookie, csrfCookie.serializedSetCookie],
    redactedSummary: redactedSummary("issue", sessionCookie, csrfCookie),
    emitsLiveSetCookieHeader: false,
    acceptsCookieCredential: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    networkExposureSafe: false,
  };
}

function clearPlan(
  sessionCookie: BrowserAuthSerializedCookie,
  csrfCookie: BrowserAuthSerializedCookie,
): BrowserAuthCookieClearingPlan {
  return {
    status: "test-only-planned",
    operation: "clear",
    testOnly: true,
    sessionCookie,
    csrfCookie,
    serializedSetCookieHeaders: [sessionCookie.serializedSetCookie, csrfCookie.serializedSetCookie],
    redactedSummary: redactedSummary("clear", sessionCookie, csrfCookie),
    emitsLiveSetCookieHeader: false,
    acceptsCookieCredential: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    networkExposureSafe: false,
  };
}

function redactedSummary(
  operation: "issue",
  sessionCookie: BrowserAuthSerializedCookie,
  csrfCookie: BrowserAuthSerializedCookie,
): BrowserAuthCookieSerializationPlan["redactedSummary"];
function redactedSummary(
  operation: "clear",
  sessionCookie: BrowserAuthSerializedCookie,
  csrfCookie: BrowserAuthSerializedCookie,
): BrowserAuthCookieClearingPlan["redactedSummary"];
function redactedSummary(
  operation: "issue" | "clear",
  sessionCookie: BrowserAuthSerializedCookie,
  csrfCookie: BrowserAuthSerializedCookie,
): BrowserAuthCookieRedactedSummary {
  return {
    status: "test-only-planned",
    operation,
    cookies: [redactCookie(sessionCookie), redactCookie(csrfCookie)],
    emitsLiveSetCookieHeader: false,
    acceptsCookieCredential: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    networkExposureSafe: false,
  };
}

function redactCookie(cookie: BrowserAuthSerializedCookie): BrowserAuthSerializedCookieSummary {
  return {
    kind: cookie.kind,
    name: cookie.name,
    attributes: cookie.attributes,
    valueRedacted: true,
    serializedSetCookieRedacted: cookie.serializedSetCookieRedacted,
    testOnly: true,
    emitsLiveSetCookieHeader: false,
  };
}

function serializeCookie(input: {
  policy: PlannedBrowserCookiePolicy;
  value: string;
  maxAgeSeconds?: number;
}): BrowserAuthSerializedCookie {
  const maxAgeSeconds = input.maxAgeSeconds ?? input.policy.maxAgeSeconds;
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new Error("Planned browser cookie Max-Age must be a non-negative integer.");
  }
  const attributes = [
    `Max-Age=${maxAgeSeconds}`,
    `Path=${input.policy.path}`,
    `SameSite=${formatSameSite(input.policy.sameSite)}`,
    input.policy.secure ? "Secure" : null,
    input.policy.httpOnly ? "HttpOnly" : null,
  ].filter((attribute): attribute is string => attribute !== null);
  const serializedSetCookie = `${input.policy.name}=${input.value}; ${attributes.join("; ")}`;
  const serializedSetCookieRedacted = `${input.policy.name}=[redacted]; ${attributes.join("; ")}`;

  return {
    kind: input.policy.kind,
    name: input.policy.name,
    attributes: {
      httpOnly: input.policy.httpOnly,
      secure: input.policy.secure,
      sameSite: input.policy.sameSite,
      path: input.policy.path,
      domain: input.policy.domain,
      hostOnly: input.policy.hostOnly,
      maxAgeSeconds,
    },
    valueRedacted: true,
    serializedSetCookieRedacted,
    testOnly: true,
    emitsLiveSetCookieHeader: false,
    serializedSetCookie,
  };
}

function validatePolicyForSerialization(policy: PlannedBrowserCookiePolicy): void {
  const errors: string[] = [];
  if (policy.issueSetCookieHeader !== false) {
    errors.push("Cookie serialization policy must not be live route emission policy.");
  }
  if (policy.acceptsCookieCredential !== false) {
    errors.push("Cookie serialization policy must not accept cookie credentials.");
  }
  if (policy.kind === "session" && policy.httpOnly !== true) {
    errors.push("Session cookie serialization requires HttpOnly.");
  }
  if (policy.sameSite !== "lax" && policy.sameSite !== "strict") {
    errors.push("Cookie serialization requires SameSite lax or strict.");
  }
  if (!policy.path.startsWith("/")) {
    errors.push("Cookie serialization requires an explicit absolute Path.");
  }
  if (policy.domain !== null || policy.hostOnly !== true) {
    errors.push("Cookie serialization keeps cookies host-only by default.");
  }
  if (!Number.isInteger(policy.maxAgeSeconds) || policy.maxAgeSeconds <= 0) {
    errors.push("Cookie serialization requires a positive issue Max-Age.");
  }
  if (!policy.localDevelopment && policy.secure !== true) {
    errors.push("Cookie serialization requires Secure outside local development.");
  }
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
}

function defaultSessionPolicy(localDevelopment = true): PlannedBrowserCookiePolicy {
  return validatedDefaultPolicy(plannedBrowserSessionCookiePolicy({ localDevelopment }), "session");
}

function defaultCsrfPolicy(localDevelopment = true): PlannedBrowserCookiePolicy {
  return validatedDefaultPolicy(plannedBrowserCsrfCookiePolicy({ localDevelopment }), "csrf");
}

function validatedDefaultPolicy(
  result: ReturnType<typeof plannedBrowserSessionCookiePolicy>,
  kind: BrowserCookieKind,
): PlannedBrowserCookiePolicy {
  if (!result.ok) {
    throw new Error(`Default planned ${kind} cookie policy failed validation.`);
  }
  return result.policy;
}

function encodeCookieValue(value: string): string {
  if (value.length === 0) throw new Error("Browser auth cookie material must be non-empty.");
  return encodeURIComponent(value);
}

function formatSameSite(value: BrowserCookieSameSite): "Lax" | "Strict" {
  return value === "strict" ? "Strict" : "Lax";
}
