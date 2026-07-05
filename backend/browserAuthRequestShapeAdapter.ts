import {
  sanitizeBrowserAuthHeaders,
  sanitizeBrowserRequestMetadata,
  type BrowserAuthHeaderInput,
} from "./browserHeaderSanitizer.js";
import {
  type BrowserAuthHarnessRouteId,
  type BrowserAuthRouteHarnessRequest,
} from "./browserAuthRouteHarness.js";
import { planBrowserAuthRouteContracts } from "./browserAuthRouteContracts.js";

export const BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_MOUNTED = false;
export const BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_REQUEST_SHAPE_ADAPTER_WIRED_INTO_ROUTES = false;

export type BrowserAuthRequestShapeReasonCode =
  | "planned-browser-auth-route"
  | "unsupported-browser-auth-route"
  | "cookie-header-ignored"
  | "authorization-header-ignored"
  | "set-cookie-header-rejected"
  | "csrf-header-ignored";

export type BrowserAuthLiveLikeRequestShape = {
  method: string;
  path: string;
  headers?: BrowserAuthHeaderInput;
  remoteAddress?: string;
};

export type BrowserAuthRequestShapeAdapterResult = {
  status: "disabled";
  routeEligible: boolean;
  routeId?: BrowserAuthHarnessRouteId;
  method: string;
  path: string;
  credentialMaterialIgnored: true;
  authenticatesRequests: false;
  validatesCsrfTokens: false;
  verifiesSessions: false;
  mutatesState: false;
  callsLifecycleCoordinator: false;
  bypassesActivationGate: false;
  cookieHeaderPresent: boolean;
  authorizationHeaderPresent: boolean;
  setCookieHeaderPresent: boolean;
  csrfHeaderPresent: boolean;
  origin?: string;
  originClass: "present" | "absent" | "invalid-or-redacted";
  refererOrigin?: string;
  refererClass: "present" | "absent" | "invalid-or-redacted";
  locality: "localhost" | "local-network" | "non-local" | "unknown";
  sanitizedHeaders: ReturnType<typeof sanitizeBrowserAuthHeaders>;
  reasonCodes: readonly BrowserAuthRequestShapeReasonCode[];
  harnessRequest?: BrowserAuthRouteHarnessRequest;
  networkExposureSafe: false;
};

export function adaptBrowserAuthRequestShape(
  request: BrowserAuthLiveLikeRequestShape,
): BrowserAuthRequestShapeAdapterResult {
  const method = request.method.toUpperCase();
  const path = pathOnly(request.path);
  const headers = request.headers ?? {};
  const routeId = routeIdFor(method, path);
  const sanitizedHeaders = sanitizeBrowserAuthHeaders(headers);
  const metadata = sanitizeBrowserRequestMetadata({
    method,
    routeId,
    origin: firstHeaderValue(headers, "origin"),
    host: firstHeaderValue(headers, "host"),
    remoteAddress: request.remoteAddress,
    headers,
  });
  const refererOrigin = sanitizeRefererOrigin(firstHeaderValue(headers, "referer"));
  const reasonCodes = reasonCodesFor({ routeId, headers });

  return {
    status: "disabled",
    routeEligible: routeId !== undefined,
    ...(routeId ? { routeId } : {}),
    method,
    path,
    credentialMaterialIgnored: true,
    authenticatesRequests: false,
    validatesCsrfTokens: false,
    verifiesSessions: false,
    mutatesState: false,
    callsLifecycleCoordinator: false,
    bypassesActivationGate: false,
    cookieHeaderPresent: headerPresent(headers, "cookie"),
    authorizationHeaderPresent: headerPresent(headers, "authorization"),
    setCookieHeaderPresent: headerPresent(headers, "set-cookie"),
    csrfHeaderPresent: csrfHeaderPresent(headers),
    ...(metadata.origin ? { origin: metadata.origin } : {}),
    originClass: classifySanitizedValue(firstHeaderValue(headers, "origin"), metadata.origin),
    ...(refererOrigin ? { refererOrigin } : {}),
    refererClass: classifySanitizedValue(firstHeaderValue(headers, "referer"), refererOrigin),
    locality: metadata.locality,
    sanitizedHeaders,
    reasonCodes,
    ...(routeId ? { harnessRequest: { routeId, method, path } } : {}),
    networkExposureSafe: false,
  };
}

function routeIdFor(method: string, path: string): BrowserAuthHarnessRouteId | undefined {
  const contract = planBrowserAuthRouteContracts().contracts.find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  return contract?.routeId as BrowserAuthHarnessRouteId | undefined;
}

function reasonCodesFor(input: {
  routeId: BrowserAuthHarnessRouteId | undefined;
  headers: BrowserAuthHeaderInput;
}): BrowserAuthRequestShapeReasonCode[] {
  const reasons: BrowserAuthRequestShapeReasonCode[] = [
    input.routeId ? "planned-browser-auth-route" : "unsupported-browser-auth-route",
  ];
  if (headerPresent(input.headers, "cookie")) reasons.push("cookie-header-ignored");
  if (headerPresent(input.headers, "authorization")) reasons.push("authorization-header-ignored");
  if (headerPresent(input.headers, "set-cookie")) reasons.push("set-cookie-header-rejected");
  if (csrfHeaderPresent(input.headers)) reasons.push("csrf-header-ignored");
  return reasons;
}

function pathOnly(path: string): string {
  try {
    return new URL(path, "http://127.0.0.1").pathname;
  } catch {
    return path.split("?")[0] ?? path;
  }
}

function headerPresent(headers: BrowserAuthHeaderInput, name: string): boolean {
  return firstHeaderValue(headers, name) !== undefined;
}

function csrfHeaderPresent(headers: BrowserAuthHeaderInput): boolean {
  return Object.keys(headers).some((name) => {
    const normalized = name.toLowerCase();
    return normalized.includes("csrf") || normalized.includes("xsrf");
  });
}

function firstHeaderValue(headers: BrowserAuthHeaderInput, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name.toLowerCase()) continue;
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function sanitizeRefererOrigin(referer: string | undefined): string | undefined {
  if (referer === undefined) return undefined;
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function classifySanitizedValue(
  rawValue: string | undefined,
  sanitizedValue: string | undefined,
): "present" | "absent" | "invalid-or-redacted" {
  if (rawValue === undefined) return "absent";
  return sanitizedValue === undefined ? "invalid-or-redacted" : "present";
}
