export const BROWSER_HEADER_SANITIZER_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_HEADER_SANITIZER_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_HEADER_SANITIZER_WIRED_INTO_ROUTES = false;

export type BrowserHeaderValue = string | readonly string[] | undefined;

export type BrowserAuthHeaderInput = Record<string, BrowserHeaderValue>;

export type SanitizedBrowserHeaders = {
  redactedHeaders: Record<string, "[redacted]">;
  safeHeaders: Record<string, string>;
  redactedHeaderCount: number;
  networkExposureSafe: false;
};

export type BrowserRequestMetadataInput = {
  method?: string;
  routeId?: string;
  origin?: string;
  host?: string;
  remoteAddress?: string;
  headers?: BrowserAuthHeaderInput;
};

export type SanitizedBrowserRequestMetadata = {
  method?: string;
  routeId?: string;
  origin?: string;
  host?: string;
  locality: "localhost" | "local-network" | "non-local" | "unknown";
  headers?: SanitizedBrowserHeaders;
  networkExposureSafe: false;
};

export type BrowserHeaderSanitizerDiagnostics = {
  status: "inactive";
  implementation: "header-redaction-test-primitive";
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  redactsCookieHeaders: true;
  redactsAuthorizationHeaders: true;
  redactsSetCookieHeaders: true;
  redactsCsrfHeaders: true;
  allowlistedOutputOnly: true;
  networkExposureSafe: false;
};

const safeHeaderNames = new Set(["origin", "host", "x-forwarded-host"]);

export function sanitizeBrowserAuthHeaders(
  headers: BrowserAuthHeaderInput,
): SanitizedBrowserHeaders {
  const redactedHeaders: Record<string, "[redacted]"> = {};
  const safeHeaders: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = normalizeHeaderName(name);
    if (isSensitiveBrowserAuthHeader(normalizedName)) {
      redactedHeaders[normalizedName] = "[redacted]";
      continue;
    }
    if (safeHeaderNames.has(normalizedName)) {
      const sanitizedValue = sanitizeSafeHeaderValue(value);
      if (sanitizedValue !== undefined) safeHeaders[normalizedName] = sanitizedValue;
    }
  }

  return {
    redactedHeaders,
    safeHeaders,
    redactedHeaderCount: Object.keys(redactedHeaders).length,
    networkExposureSafe: false,
  };
}

export function sanitizeBrowserRequestMetadata(
  input: BrowserRequestMetadataInput,
): SanitizedBrowserRequestMetadata {
  return {
    method: sanitizeIdentifier(input.method),
    routeId: sanitizeIdentifier(input.routeId),
    origin: sanitizeOrigin(input.origin),
    host: sanitizeHost(input.host),
    locality: classifyBrowserRequestLocality(input),
    ...(input.headers === undefined ? {} : { headers: sanitizeBrowserAuthHeaders(input.headers) }),
    networkExposureSafe: false,
  };
}

export function isSensitiveBrowserAuthHeader(headerName: string): boolean {
  const normalized = normalizeHeaderName(headerName);
  return (
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "set-cookie" ||
    normalized.includes("csrf") ||
    normalized.includes("xsrf")
  );
}

export function getBrowserHeaderSanitizerDiagnostics(): BrowserHeaderSanitizerDiagnostics {
  return {
    status: "inactive",
    implementation: "header-redaction-test-primitive",
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    redactsCookieHeaders: true,
    redactsAuthorizationHeaders: true,
    redactsSetCookieHeaders: true,
    redactsCsrfHeaders: true,
    allowlistedOutputOnly: true,
    networkExposureSafe: false,
  };
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function sanitizeSafeHeaderValue(value: BrowserHeaderValue): string | undefined {
  const firstValue = Array.isArray(value) ? value[0] : value;
  if (firstValue === undefined) return undefined;
  const trimmed = firstValue.trim();
  if (trimmed.length === 0 || containsSecretShapedMaterial(trimmed)) return undefined;
  return trimmed.slice(0, 240);
}

function sanitizeIdentifier(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || containsSecretShapedMaterial(trimmed)) return undefined;
  return trimmed.slice(0, 160);
}

function sanitizeOrigin(value: string | undefined): string | undefined {
  const sanitized = sanitizeIdentifier(value);
  if (sanitized === undefined) return undefined;
  try {
    const url = new URL(sanitized);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function sanitizeHost(value: string | undefined): string | undefined {
  const sanitized = sanitizeIdentifier(value);
  if (sanitized === undefined) return undefined;
  return sanitized.split("/")[0]?.slice(0, 120);
}

function classifyBrowserRequestLocality(
  input: BrowserRequestMetadataInput,
): SanitizedBrowserRequestMetadata["locality"] {
  const host = sanitizeHost(input.host);
  const origin = sanitizeOrigin(input.origin);
  const remoteAddress = sanitizeIdentifier(input.remoteAddress);
  if (isLoopback(host) || isLoopback(remoteAddress) || isLoopbackOrigin(origin)) return "localhost";
  if (isPrivateNetwork(host) || isPrivateNetwork(remoteAddress) || isPrivateNetworkOrigin(origin)) {
    return "local-network";
  }
  if (host !== undefined || origin !== undefined || remoteAddress !== undefined) return "non-local";
  return "unknown";
}

function isLoopbackOrigin(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    return isLoopback(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isPrivateNetworkOrigin(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    return isPrivateNetwork(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopback(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = normalizeHostname(value);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isPrivateNetwork(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = normalizeHostname(value);
  return (
    normalized.startsWith("10.") ||
    normalized.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  );
}

function containsSecretShapedMaterial(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("bearer ") ||
    normalized.includes("cookie:") ||
    normalized.includes("set-cookie") ||
    normalized.includes("authorization:") ||
    normalized.includes("arepo_session=") ||
    normalized.includes("bpairsec_") ||
    normalized.includes("bsver_") ||
    normalized.includes("bcsrfsec_") ||
    normalized.includes("sha256:") ||
    normalized.includes("verifierhash") ||
    normalized.includes("tokenhash")
  );
}

function normalizeHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    return trimmed.slice(1, trimmed.indexOf("]"));
  }
  if (/^[a-z0-9.-]+:\d+$/.test(trimmed)) {
    return trimmed.slice(0, trimmed.lastIndexOf(":"));
  }
  return trimmed;
}
