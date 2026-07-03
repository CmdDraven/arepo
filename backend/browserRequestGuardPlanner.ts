import {
  PROTECTED_ROUTE_POLICIES,
  type ProtectedRoutePolicy,
  type RoutePolicyCategory,
} from "./routePermissions.js";

export type BrowserRequestSourceClassification =
  | "non-browser-or-unknown"
  | "same-origin-browser"
  | "allowed-browser-origin"
  | "disallowed-browser-origin"
  | "missing-origin"
  | "malformed-origin";

export type BrowserRequestCsrfRequirement =
  "not-required" | "required" | "missing" | "invalid" | "not-applicable" | "unsupported";

export type BrowserRequestGuardDecision =
  | "would-allow"
  | "would-require-csrf"
  | "would-reject-origin"
  | "would-reject-csrf"
  | "would-reduce-anonymous"
  | "unknown-route"
  | "unsupported-request";

export type BrowserRequestGuardReasonCode =
  | "safe-method"
  | "unsafe-method"
  | "same-origin-browser"
  | "allowed-browser-origin"
  | "disallowed-browser-origin"
  | "missing-origin"
  | "malformed-origin"
  | "non-browser-or-unknown"
  | "csrf-not-required"
  | "csrf-required"
  | "csrf-missing"
  | "csrf-invalid"
  | "csrf-valid"
  | "csrf-unsupported"
  | "reduced-anonymous-status"
  | "source-content-read"
  | "generated-index-or-status-read"
  | "source-mutation"
  | "vault-mutation"
  | "auth-management"
  | "node-management"
  | "unknown-route"
  | "unsupported-method";

export type BrowserRequestGuardMethod =
  "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE";

export type BrowserRequestGuardClientKind = "browser" | "non-browser" | "unknown";

export type BrowserRequestGuardCsrfTokenState = "valid" | "missing" | "invalid" | "unsupported";

export type BrowserRequestGuardRequestClass =
  | "preflight"
  | "reduced-anonymous-status"
  | "generated-index-or-status-read"
  | "source-content-read"
  | "source-mutation"
  | "vault-mutation"
  | "auth-management"
  | "node-management"
  | "unknown";

export type BrowserRequestGuardInput = {
  method: BrowserRequestGuardMethod | string;
  routePattern?: string;
  routePolicy?: ProtectedRoutePolicy;
  requestClass?: BrowserRequestGuardRequestClass;
  clientKind?: BrowserRequestGuardClientKind;
  origin?: string;
  appOrigin?: string;
  allowedOrigins?: readonly string[];
  csrfTokenState?: BrowserRequestGuardCsrfTokenState;
  reducedAnonymousRequested?: boolean;
};

export type BrowserRequestGuardPlan = {
  decision: BrowserRequestGuardDecision;
  requestSource: BrowserRequestSourceClassification;
  csrfRequirement: BrowserRequestCsrfRequirement;
  requestClass: BrowserRequestGuardRequestClass;
  methodSafety: "safe" | "unsafe" | "preflight" | "unsupported";
  routePattern?: string;
  originCheckRequired: boolean;
  csrfCheckRequired: boolean;
  authenticationRequired: boolean;
  authorizationRequired: boolean;
  reasonCodes: readonly BrowserRequestGuardReasonCode[];
  enforcementActive: false;
  protectedModeOperational: false;
  networkExposureSafe: false;
};

const safeMethods = new Set(["GET", "HEAD"]);
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function planBrowserRequestGuard(input: BrowserRequestGuardInput): BrowserRequestGuardPlan {
  const method = normalizeMethod(input.method);
  if (!method) {
    return basePlan({
      decision: "unsupported-request",
      requestSource: classifyRequestSource(input),
      csrfRequirement: "unsupported",
      requestClass: "unknown",
      methodSafety: "unsupported",
      originCheckRequired: isBrowser(input),
      csrfCheckRequired: false,
      authenticationRequired: true,
      authorizationRequired: true,
      reasonCodes: ["unsupported-method"],
    });
  }

  const methodSafety = classifyMethod(method);
  const policy = input.routePolicy ?? policyFromInput(method, input.routePattern);
  if (!policy && !input.requestClass && method !== "OPTIONS") {
    return basePlan({
      decision: "unknown-route",
      requestSource: classifyRequestSource(input),
      csrfRequirement: csrfRequirementFor(input, methodSafety, false),
      requestClass: "unknown",
      methodSafety,
      originCheckRequired: isBrowser(input),
      csrfCheckRequired: isBrowser(input) && methodSafety === "unsafe",
      authenticationRequired: true,
      authorizationRequired: true,
      reasonCodes: ["unknown-route"],
    });
  }

  const requestClass =
    input.requestClass ?? classifyRequest(policy, input.reducedAnonymousRequested);
  const reducedAnonymous = requestClass === "reduced-anonymous-status";
  const authenticationRequired = !reducedAnonymous && requestClass !== "preflight";
  const authorizationRequired = authenticationRequired;
  const requestSource = classifyRequestSource(input);
  const originCheckRequired = isBrowser(input) && requestClass !== "preflight";
  const csrfCheckRequired = isBrowser(input) && methodSafety === "unsafe";
  const csrfRequirement = csrfRequirementFor(input, methodSafety, csrfCheckRequired);
  const reasonCodes = reasonCodesFor({
    requestSource,
    csrfRequirement,
    requestClass,
    methodSafety,
    reducedAnonymous,
  });
  const decision = decisionFor({
    requestSource,
    csrfRequirement,
    requestClass,
    originCheckRequired,
    reducedAnonymous,
  });

  return basePlan({
    decision,
    requestSource,
    csrfRequirement,
    requestClass,
    methodSafety,
    routePattern: policy?.routePattern ?? (method === "OPTIONS" ? "*" : undefined),
    originCheckRequired,
    csrfCheckRequired,
    authenticationRequired,
    authorizationRequired,
    reasonCodes,
  });
}

function policyFromInput(
  method: BrowserRequestGuardMethod,
  routePattern: string | undefined,
): ProtectedRoutePolicy | undefined {
  if (method === "OPTIONS") {
    return PROTECTED_ROUTE_POLICIES.find((policy) => policy.method === "OPTIONS");
  }
  if (!routePattern) return undefined;
  return PROTECTED_ROUTE_POLICIES.find(
    (policy) => policy.method === method && policy.routePattern === routePattern,
  );
}

function normalizeMethod(
  method: BrowserRequestGuardInput["method"],
): BrowserRequestGuardMethod | undefined {
  if (typeof method !== "string") return undefined;
  const normalized = method.toUpperCase();
  if (
    normalized === "GET" ||
    normalized === "HEAD" ||
    normalized === "OPTIONS" ||
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE"
  ) {
    return normalized;
  }
  return undefined;
}

function classifyMethod(
  method: BrowserRequestGuardMethod,
): BrowserRequestGuardPlan["methodSafety"] {
  if (method === "OPTIONS") return "preflight";
  if (safeMethods.has(method)) return "safe";
  if (unsafeMethods.has(method)) return "unsafe";
  return "unsupported";
}

function classifyRequest(
  policy: ProtectedRoutePolicy | undefined,
  reducedAnonymousRequested = false,
): BrowserRequestGuardRequestClass {
  if (!policy) return "unknown";
  if (policy.category === "corsPreflight") return "preflight";
  if (reducedAnonymousRequested && policy.anonymousReducedStatusMayExist) {
    return "reduced-anonymous-status";
  }
  return requestClassForCategory(policy.category);
}

function requestClassForCategory(category: RoutePolicyCategory): BrowserRequestGuardRequestClass {
  switch (category) {
    case "fileRead":
      return "source-content-read";
    case "fileWrite":
    case "fileCreate":
    case "folderCreate":
    case "rename":
    case "fileDelete":
    case "reindex":
      return "source-mutation";
    case "vaultRegistration":
    case "vaultRemoval":
      return "vault-mutation";
    case "health":
    case "nodeDiagnostics":
    case "dryRunDiagnostics":
      return "node-management";
    case "vaultListing":
    case "fileListing":
    case "vaultRuntimeStatus":
    case "storageSummary":
    case "indexRead":
    case "indexFilters":
    case "indexSearch":
    case "indexInspect":
      return "generated-index-or-status-read";
    case "corsPreflight":
      return "preflight";
    default:
      return "unknown";
  }
}

function classifyRequestSource(
  input: BrowserRequestGuardInput,
): BrowserRequestSourceClassification {
  if (!isBrowser(input)) return "non-browser-or-unknown";
  if (!input.origin) return "missing-origin";
  if (!isValidOrigin(input.origin)) return "malformed-origin";
  if (input.appOrigin && input.origin === input.appOrigin) return "same-origin-browser";
  if (input.allowedOrigins?.includes(input.origin)) return "allowed-browser-origin";
  return "disallowed-browser-origin";
}

function csrfRequirementFor(
  input: BrowserRequestGuardInput,
  methodSafety: BrowserRequestGuardPlan["methodSafety"],
  csrfCheckRequired: boolean,
): BrowserRequestCsrfRequirement {
  if (!isBrowser(input)) return "not-applicable";
  if (methodSafety === "unsupported") return "unsupported";
  if (!csrfCheckRequired) return "not-required";
  if (input.csrfTokenState === "valid") return "required";
  if (input.csrfTokenState === "invalid") return "invalid";
  if (input.csrfTokenState === "unsupported") return "unsupported";
  return "missing";
}

function decisionFor(input: {
  requestSource: BrowserRequestSourceClassification;
  csrfRequirement: BrowserRequestCsrfRequirement;
  requestClass: BrowserRequestGuardRequestClass;
  originCheckRequired: boolean;
  reducedAnonymous: boolean;
}): BrowserRequestGuardDecision {
  if (input.requestClass === "unknown") return "unknown-route";
  if (
    input.originCheckRequired &&
    ["disallowed-browser-origin", "missing-origin", "malformed-origin"].includes(
      input.requestSource,
    )
  ) {
    return "would-reject-origin";
  }
  if (input.csrfRequirement === "invalid") return "would-reject-csrf";
  if (input.csrfRequirement === "missing") return "would-require-csrf";
  if (input.csrfRequirement === "unsupported") return "unsupported-request";
  if (input.reducedAnonymous) return "would-reduce-anonymous";
  return "would-allow";
}

function reasonCodesFor(input: {
  requestSource: BrowserRequestSourceClassification;
  csrfRequirement: BrowserRequestCsrfRequirement;
  requestClass: BrowserRequestGuardRequestClass;
  methodSafety: BrowserRequestGuardPlan["methodSafety"];
  reducedAnonymous: boolean;
}): readonly BrowserRequestGuardReasonCode[] {
  const codes: BrowserRequestGuardReasonCode[] = [];
  if (input.methodSafety === "safe") codes.push("safe-method");
  if (input.methodSafety === "unsafe") codes.push("unsafe-method");
  if (input.methodSafety === "unsupported") codes.push("unsupported-method");
  codes.push(input.requestSource);

  if (input.csrfRequirement === "not-required") codes.push("csrf-not-required");
  if (input.csrfRequirement === "required") codes.push("csrf-required", "csrf-valid");
  if (input.csrfRequirement === "missing") codes.push("csrf-required", "csrf-missing");
  if (input.csrfRequirement === "invalid") codes.push("csrf-required", "csrf-invalid");
  if (input.csrfRequirement === "unsupported") codes.push("csrf-unsupported");

  if (input.reducedAnonymous) codes.push("reduced-anonymous-status");
  if (input.requestClass === "source-content-read") codes.push("source-content-read");
  if (input.requestClass === "generated-index-or-status-read") {
    codes.push("generated-index-or-status-read");
  }
  if (input.requestClass === "source-mutation") codes.push("source-mutation");
  if (input.requestClass === "vault-mutation") codes.push("vault-mutation");
  if (input.requestClass === "auth-management") codes.push("auth-management");
  if (input.requestClass === "node-management") codes.push("node-management");
  if (input.requestClass === "unknown") codes.push("unknown-route");

  return Array.from(new Set(codes));
}

function basePlan(input: {
  decision: BrowserRequestGuardDecision;
  requestSource: BrowserRequestSourceClassification;
  csrfRequirement: BrowserRequestCsrfRequirement;
  requestClass: BrowserRequestGuardRequestClass;
  methodSafety: BrowserRequestGuardPlan["methodSafety"];
  routePattern?: string;
  originCheckRequired: boolean;
  csrfCheckRequired: boolean;
  authenticationRequired: boolean;
  authorizationRequired: boolean;
  reasonCodes: readonly BrowserRequestGuardReasonCode[];
}): BrowserRequestGuardPlan {
  return {
    decision: input.decision,
    requestSource: input.requestSource,
    csrfRequirement: input.csrfRequirement,
    requestClass: input.requestClass,
    methodSafety: input.methodSafety,
    routePattern: input.routePattern,
    originCheckRequired: input.originCheckRequired,
    csrfCheckRequired: input.csrfCheckRequired,
    authenticationRequired: input.authenticationRequired,
    authorizationRequired: input.authorizationRequired,
    reasonCodes: input.reasonCodes,
    enforcementActive: false,
    protectedModeOperational: false,
    networkExposureSafe: false,
  };
}

function isBrowser(input: BrowserRequestGuardInput): boolean {
  return input.clientKind === "browser";
}

function isValidOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && Boolean(parsed.protocol) && Boolean(parsed.host);
  } catch {
    return false;
  }
}
