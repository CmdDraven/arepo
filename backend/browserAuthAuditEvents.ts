import crypto from "node:crypto";

export const BROWSER_AUTH_AUDIT_EVENTS_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_AUDIT_EVENTS_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_AUDIT_EVENTS_WIRED_INTO_ROUTES = false;

export type BrowserAuthAuditCategory =
  | "pairing_code_issue_planned"
  | "pairing_code_consume_planned"
  | "pairing_code_rejected"
  | "session_issue_planned"
  | "session_logout_planned"
  | "session_revoke_planned"
  | "session_expired"
  | "csrf_issue_planned"
  | "csrf_rejected"
  | "cookie_rejected"
  | "browser_auth_inactive";

export type BrowserAuthAuditSeverity = "info" | "warning" | "error";

export type BrowserAuthAuditSafeDetails = Record<string, string | number | boolean | null>;

export type BrowserAuthAuditEvent = {
  eventId: string;
  category: BrowserAuthAuditCategory;
  createdAtMs: number;
  severity: BrowserAuthAuditSeverity;
  subjectId?: string;
  sessionId?: string;
  routeId?: string;
  reasonCode?: string;
  safeDetails?: BrowserAuthAuditSafeDetails;
};

export type BuildBrowserAuthAuditEventInput = {
  eventId?: string;
  category: BrowserAuthAuditCategory;
  severity?: BrowserAuthAuditSeverity;
  subjectId?: string;
  sessionId?: string;
  routeId?: string;
  reasonCode?: string;
  safeDetails?: Record<string, unknown>;
};

export type BrowserAuthAuditDiagnostics = {
  status: "inactive";
  implementation: "in-memory-test-primitive";
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  sanitizesSecretMaterial: true;
  eventCount: number;
  categoryCount: number;
  networkExposureSafe: false;
};

export type InMemoryBrowserAuthAuditSink = {
  append(event: BrowserAuthAuditEvent): void;
  list(): readonly BrowserAuthAuditEvent[];
  diagnostics(): BrowserAuthAuditDiagnostics;
};

const browserAuthAuditCategories: readonly BrowserAuthAuditCategory[] = [
  "pairing_code_issue_planned",
  "pairing_code_consume_planned",
  "pairing_code_rejected",
  "session_issue_planned",
  "session_logout_planned",
  "session_revoke_planned",
  "session_expired",
  "csrf_issue_planned",
  "csrf_rejected",
  "cookie_rejected",
  "browser_auth_inactive",
];

const allowedSafeDetailKeys = new Set([
  "active",
  "attemptCount",
  "category",
  "count",
  "enabled",
  "failedAttemptCount",
  "issued",
  "lifecycle",
  "localOnly",
  "maxFailedAttempts",
  "method",
  "operation",
  "planned",
  "posture",
  "reason",
  "rejected",
  "routeCategory",
  "source",
  "status",
]);

export function buildBrowserAuthAuditEvent(
  input: BuildBrowserAuthAuditEventInput,
  options: { clock?: () => number } = {},
): BrowserAuthAuditEvent {
  const safeDetails =
    input.safeDetails === undefined
      ? undefined
      : sanitizeBrowserAuthAuditDetails(input.safeDetails);
  return {
    eventId: input.eventId ?? crypto.randomUUID(),
    category: validateCategory(input.category),
    createdAtMs: options.clock?.() ?? Date.now(),
    severity: input.severity ?? defaultSeverity(input.category),
    subjectId: sanitizeOptionalIdentifier(input.subjectId),
    sessionId: sanitizeOptionalIdentifier(input.sessionId),
    routeId: sanitizeOptionalIdentifier(input.routeId),
    reasonCode: sanitizeOptionalIdentifier(input.reasonCode),
    ...(safeDetails === undefined ? {} : { safeDetails }),
  };
}

export function sanitizeBrowserAuthAuditDetails(
  details: Record<string, unknown>,
): BrowserAuthAuditSafeDetails {
  const sanitized: BrowserAuthAuditSafeDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (!allowedSafeDetailKeys.has(key) || isUnsafeDetailKey(key)) {
      throw new Error("Unsafe browser auth audit detail key.");
    }
    if (!isSafeDetailValue(value) || isUnsafeDetailValue(value)) {
      throw new Error("Unsafe browser auth audit detail value.");
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export function createInMemoryBrowserAuthAuditSink(): InMemoryBrowserAuthAuditSink {
  const events: BrowserAuthAuditEvent[] = [];
  return {
    append(event) {
      events.push(structuredClone(event));
    },
    list() {
      return events.map((event) => structuredClone(event));
    },
    diagnostics() {
      return {
        status: "inactive",
        implementation: "in-memory-test-primitive",
        wiredIntoAuthorization: false,
        wiredIntoRoutes: false,
        sanitizesSecretMaterial: true,
        eventCount: events.length,
        categoryCount: browserAuthAuditCategories.length,
        networkExposureSafe: false,
      };
    },
  };
}

export function getBrowserAuthAuditDiagnostics(eventCount = 0): BrowserAuthAuditDiagnostics {
  return {
    status: "inactive",
    implementation: "in-memory-test-primitive",
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    sanitizesSecretMaterial: true,
    eventCount,
    categoryCount: browserAuthAuditCategories.length,
    networkExposureSafe: false,
  };
}

function validateCategory(category: BrowserAuthAuditCategory): BrowserAuthAuditCategory {
  if (!browserAuthAuditCategories.includes(category)) {
    throw new Error("Unsupported browser auth audit category.");
  }
  return category;
}

function defaultSeverity(category: BrowserAuthAuditCategory): BrowserAuthAuditSeverity {
  return category.endsWith("_rejected") || category === "browser_auth_inactive"
    ? "warning"
    : "info";
}

function sanitizeOptionalIdentifier(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (isUnsafeDetailValue(trimmed)) throw new Error("Unsafe browser auth audit identifier.");
  return trimmed.slice(0, 160);
}

function isSafeDetailValue(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isUnsafeDetailValue(value: string | number | boolean | null): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return (
    normalized.includes("arepo_") ||
    normalized.includes("bearer ") ||
    normalized.includes("cookie:") ||
    normalized.includes("set-cookie") ||
    normalized.includes("authorization:") ||
    normalized.includes("bpairsec_") ||
    normalized.includes("bsver_") ||
    normalized.includes("bcsrfsec_") ||
    normalized.includes("verifierhash") ||
    normalized.includes("tokenhash") ||
    normalized.includes("sessionsecret") ||
    normalized.includes("pairingcode")
  );
}

function isUnsafeDetailKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("cookie") ||
    normalized.includes("authorization") ||
    normalized.includes("verifier") ||
    normalized.includes("hash") ||
    normalized.includes("password") ||
    normalized.includes("csrf") ||
    normalized.includes("pairingcode") ||
    normalized.includes("bearer")
  );
}
