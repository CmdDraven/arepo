import { DEFAULT_BROWSER_SESSION_COOKIE_NAME } from "./httpCredentialAdapter.js";

export const BROWSER_COOKIE_POLICY_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_COOKIE_POLICY_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_COOKIE_POLICY_WIRED_INTO_ROUTES = false;

export const PLANNED_BROWSER_SESSION_COOKIE_NAME = DEFAULT_BROWSER_SESSION_COOKIE_NAME;
export const PLANNED_BROWSER_CSRF_COOKIE_NAME = "arepo_csrf";

export type BrowserCookieKind = "session" | "csrf";
export type BrowserCookieSameSite = "lax" | "strict";

export type PlannedBrowserCookiePolicyInput = {
  kind: BrowserCookieKind;
  name?: string;
  localDevelopment?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: BrowserCookieSameSite;
  path?: string;
  domain?: string | null;
  maxAgeSeconds?: number;
};

export type PlannedBrowserCookiePolicy = {
  kind: BrowserCookieKind;
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: BrowserCookieSameSite;
  path: string;
  domain: null;
  hostOnly: true;
  maxAgeSeconds: number;
  issueSetCookieHeader: false;
  acceptsCookieCredential: false;
  localDevelopment: boolean;
  networkExposureSafe: false;
};

export type BrowserCookiePolicyValidationResult =
  | { ok: true; policy: PlannedBrowserCookiePolicy }
  | {
      ok: false;
      errors: readonly string[];
    };

export type BrowserCookiePolicyDiagnostics = {
  status: "inactive";
  implementation: "policy-test-primitive";
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  issuesCookies: false;
  acceptsCookies: false;
  plannedSessionCookieName: typeof PLANNED_BROWSER_SESSION_COOKIE_NAME;
  plannedCsrfCookieName: typeof PLANNED_BROWSER_CSRF_COOKIE_NAME;
  sessionCookieHttpOnlyRequired: true;
  secureRequiredOutsideLocalDev: true;
  hostOnlyByDefault: true;
  domainAllowedByDefault: false;
  networkExposureSafe: false;
};

const maxCookieAgeSeconds = 60 * 60 * 24;

export function plannedBrowserSessionCookiePolicy(
  input: Omit<PlannedBrowserCookiePolicyInput, "kind"> = {},
): BrowserCookiePolicyValidationResult {
  return validateBrowserCookiePolicy({
    ...input,
    kind: "session",
    name: input.name ?? PLANNED_BROWSER_SESSION_COOKIE_NAME,
    httpOnly: input.httpOnly ?? true,
    maxAgeSeconds: input.maxAgeSeconds ?? 60 * 30,
  });
}

export function plannedBrowserCsrfCookiePolicy(
  input: Omit<PlannedBrowserCookiePolicyInput, "kind"> = {},
): BrowserCookiePolicyValidationResult {
  return validateBrowserCookiePolicy({
    ...input,
    kind: "csrf",
    name: input.name ?? PLANNED_BROWSER_CSRF_COOKIE_NAME,
    httpOnly: input.httpOnly ?? false,
    maxAgeSeconds: input.maxAgeSeconds ?? 60 * 10,
  });
}

export function validateBrowserCookiePolicy(
  input: PlannedBrowserCookiePolicyInput,
): BrowserCookiePolicyValidationResult {
  const errors: string[] = [];
  const localDevelopment = input.localDevelopment ?? true;
  const name = input.name ?? defaultCookieName(input.kind);
  const httpOnly = input.httpOnly ?? input.kind === "session";
  const secure = input.secure ?? !localDevelopment;
  const sameSite = input.sameSite ?? "lax";
  const path = input.path ?? "/api";
  const maxAgeSeconds = input.maxAgeSeconds ?? 60 * 10;

  if (input.kind !== "session" && input.kind !== "csrf") {
    errors.push("Cookie kind must be session or csrf.");
  }
  if (!isSafeCookieName(name)) {
    errors.push("Cookie name must use safe cookie-name characters.");
  }
  if (input.kind === "session" && httpOnly !== true) {
    errors.push("Session cookies must be HttpOnly.");
  }
  if (sameSite !== "lax" && sameSite !== "strict") {
    errors.push("SameSite must be lax or strict.");
  }
  if (input.domain !== undefined && input.domain !== null) {
    errors.push("Domain is omitted by default for host-only cookies.");
  }
  if (!path.startsWith("/")) {
    errors.push("Cookie path must start with /.");
  }
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    errors.push("Cookie Max-Age must be a positive integer.");
  }
  if (maxAgeSeconds > maxCookieAgeSeconds) {
    errors.push("Cookie Max-Age must be bounded to one day or less.");
  }
  if (!localDevelopment && secure !== true) {
    errors.push("Secure cookies are required outside explicit local development.");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    policy: {
      kind: input.kind,
      name,
      httpOnly,
      secure,
      sameSite,
      path,
      domain: null,
      hostOnly: true,
      maxAgeSeconds,
      issueSetCookieHeader: false,
      acceptsCookieCredential: false,
      localDevelopment,
      networkExposureSafe: false,
    },
  };
}

export function getBrowserCookiePolicyDiagnostics(): BrowserCookiePolicyDiagnostics {
  return {
    status: "inactive",
    implementation: "policy-test-primitive",
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    issuesCookies: false,
    acceptsCookies: false,
    plannedSessionCookieName: PLANNED_BROWSER_SESSION_COOKIE_NAME,
    plannedCsrfCookieName: PLANNED_BROWSER_CSRF_COOKIE_NAME,
    sessionCookieHttpOnlyRequired: true,
    secureRequiredOutsideLocalDev: true,
    hostOnlyByDefault: true,
    domainAllowedByDefault: false,
    networkExposureSafe: false,
  };
}

function defaultCookieName(kind: BrowserCookieKind): string {
  return kind === "session"
    ? PLANNED_BROWSER_SESSION_COOKIE_NAME
    : PLANNED_BROWSER_CSRF_COOKIE_NAME;
}

function isSafeCookieName(value: string): boolean {
  return /^[A-Za-z0-9_=-]+$/.test(value);
}
