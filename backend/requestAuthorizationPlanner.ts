import {
  planProtectedRouteAuthorization,
  type AuthPlanResult,
  type CredentialPlanningActor,
} from "./authPlanner.js";
import {
  classifyBrowserSecurityRequest,
  planBrowserSecurity,
  type BrowserSecurityClientPosture,
  type BrowserSecurityPlan,
} from "./browserSecurityPolicy.js";
import {
  verifyHttpCredentialInput,
  type HttpCredentialSource,
  type HttpCredentialAdapterResult,
  type HttpCredentialAdapterInput,
  type RequestShapedCredentialInput,
} from "./httpCredentialAdapter.js";
import {
  PROTECTED_ROUTE_POLICIES,
  type ProtectedRoutePolicy,
  type RoutePermission,
  type RoutePolicyMethod,
  type StrongerConfirmation,
} from "./routePermissions.js";

export const REQUEST_AUTHORIZATION_PLANNER_ENFORCEMENT_ACTIVE = false;
export const REQUEST_AUTHORIZATION_PLANNER_NETWORK_EXPOSURE_SAFE = false;

export type RequestAuthorizationReasonCode =
  | "planned-allow"
  | "planned-deny"
  | "anonymous-reduced"
  | "requires-authentication"
  | "requires-authorization"
  | "requires-stronger-confirmation"
  | "route-not-found"
  | "preflight-not-authorization"
  | "malformed-credential"
  | "browser-security-requirement";

export type RequestAuthorizationPlannerInput = {
  request: RequestShapedCredentialInput;
  stores: HttpCredentialAdapterInput["stores"];
  vaultId?: string;
  reducedAnonymousRequested?: boolean;
  clientPosture?: BrowserSecurityClientPosture;
  allowedOrigins?: readonly string[];
  csrfTokenPresent?: boolean;
  strongerConfirmationPresent?: boolean;
  allowedCredentialSource?: HttpCredentialSource | "either";
  now?: Date;
};

export type RequestAuthorizationDecision = {
  wouldAllow: boolean;
  wouldDeny: boolean;
  anonymousReduced: boolean;
  requiresAuthentication: boolean;
  requiresAuthorization: boolean;
  requiresOriginCheck: boolean;
  requiresCsrf: boolean;
  requiresStrongerConfirmation: boolean;
  reasonCodes: readonly RequestAuthorizationReasonCode[];
  routePolicyId?: string;
  routePattern?: string;
  requiredPermissions: readonly RoutePermission[];
  missingPermissions: readonly RoutePermission[];
  requiredConfirmation: readonly StrongerConfirmation[];
  credentialId?: string;
  actorKind?: string;
  auditIntent?: HttpCredentialAdapterResult["auditIntent"];
  credentialResult: HttpCredentialAdapterResult;
  authorizationPlan: AuthPlanResult;
  browserSecurityPlan: BrowserSecurityPlan;
  enforcementActive: false;
  networkExposureSafe: false;
};

export function planRouteAwareRequestAuthorization(
  input: RequestAuthorizationPlannerInput,
): RequestAuthorizationDecision {
  const policy = matchRoutePolicy(input.request);
  const credentialResult = verifyHttpCredentialInput({
    request: input.request,
    stores: input.stores,
    options: { now: input.now, allowedSource: input.allowedCredentialSource ?? "either" },
  });

  if (!policy) {
    const browserSecurityPlan = planBrowserSecurity({
      client: clientPosture(input.clientPosture, credentialResult),
      requestClass: "safeReadMetadata",
      credentialPresent: credentialResult.status === "verified",
      authorizationSatisfied: false,
    });
    const authorizationPlan = planProtectedRouteAuthorization({
      policy: null,
      actor: actorForCredentialResult(credentialResult),
      vaultId: input.vaultId,
    });
    return decision({
      policy: undefined,
      credentialResult,
      authorizationPlan,
      browserSecurityPlan,
      reasonCodes: ["route-not-found"],
      wouldAllow: false,
      anonymousReduced: false,
    });
  }

  const routePolicyId = routeKey(policy);
  if (policy.category === "corsPreflight") {
    const browserSecurityPlan = planBrowserSecurity({
      client: "anonymous",
      routePolicy: policy,
    });
    const authorizationPlan = planProtectedRouteAuthorization({
      policy,
      actor: { kind: "anonymous" },
      vaultId: input.vaultId,
    });
    return decision({
      policy,
      credentialResult,
      authorizationPlan,
      browserSecurityPlan,
      reasonCodes: ["preflight-not-authorization"],
      wouldAllow: false,
      anonymousReduced: false,
      routePolicyId,
    });
  }

  const actor =
    credentialResult.status === "verified"
      ? actorForCredentialResult(credentialResult)
      : input.reducedAnonymousRequested
        ? { kind: "anonymous" as const }
        : null;
  const authorizationPlan = planProtectedRouteAuthorization({
    policy,
    actor,
    vaultId: input.vaultId ?? vaultIdFromPath(input.request.path),
  });
  const client = clientPosture(input.clientPosture, credentialResult);
  const browserSecurityPlan = planBrowserSecurity({
    client,
    routePolicy: policy,
    requestClass: classifyBrowserSecurityRequest(policy, input.reducedAnonymousRequested),
    reducedAnonymousRequested: input.reducedAnonymousRequested,
    origin: input.request.origin ?? headerValue(input.request.headers, "origin"),
    allowedOrigins: input.allowedOrigins,
    csrfTokenPresent: input.csrfTokenPresent,
    sessionState: sessionStateFromCredentialResult(credentialResult),
    credentialPresent: credentialResult.status === "verified",
    authorizationSatisfied:
      authorizationPlan.decision === "allow" ||
      authorizationPlan.decision === "requires-confirmation",
  });
  const anonymousReduced =
    authorizationPlan.decision === "anonymous-reduced" &&
    browserSecurityPlan.reducedAnonymousResponseAllowed;
  const missingAuthentication =
    browserSecurityPlan.authenticationRequired && credentialResult.status !== "verified";
  const missingAuthorization = authorizationPlan.decision === "deny" && !anonymousReduced;
  const confirmationRequired =
    authorizationPlan.decision === "requires-confirmation" ||
    browserSecurityPlan.strongerConfirmationRequired;
  const browserBlocked = browserSecurityPlan.failureReasons.length > 0;
  const wouldAllow =
    authorizationPlan.decision === "allow" &&
    !missingAuthentication &&
    !browserBlocked &&
    !confirmationRequired;
  const reasonCodes = reasonCodesFor({
    credentialResult,
    authorizationPlan,
    browserSecurityPlan,
    anonymousReduced,
    missingAuthentication,
    missingAuthorization,
    confirmationRequired,
    wouldAllow,
  });

  return decision({
    policy,
    credentialResult,
    authorizationPlan,
    browserSecurityPlan,
    reasonCodes,
    wouldAllow,
    anonymousReduced,
    routePolicyId,
  });
}

function decision(input: {
  policy?: ProtectedRoutePolicy;
  credentialResult: HttpCredentialAdapterResult;
  authorizationPlan: AuthPlanResult;
  browserSecurityPlan: BrowserSecurityPlan;
  reasonCodes: readonly RequestAuthorizationReasonCode[];
  wouldAllow: boolean;
  anonymousReduced: boolean;
  routePolicyId?: string;
}): RequestAuthorizationDecision {
  return {
    wouldAllow: input.wouldAllow,
    wouldDeny: !input.wouldAllow && !input.anonymousReduced,
    anonymousReduced: input.anonymousReduced,
    requiresAuthentication: input.browserSecurityPlan.authenticationRequired,
    requiresAuthorization: input.browserSecurityPlan.authorizationRequired,
    requiresOriginCheck: input.browserSecurityPlan.originCheckRequired,
    requiresCsrf: input.browserSecurityPlan.csrfCheckRequired,
    requiresStrongerConfirmation:
      input.authorizationPlan.decision === "requires-confirmation" ||
      input.browserSecurityPlan.strongerConfirmationRequired,
    reasonCodes: input.reasonCodes,
    routePolicyId: input.routePolicyId,
    routePattern: input.policy?.routePattern,
    requiredPermissions: input.authorizationPlan.requiredPermissions,
    missingPermissions: input.authorizationPlan.missingPermissions,
    requiredConfirmation:
      input.authorizationPlan.requiredConfirmation.length > 0
        ? input.authorizationPlan.requiredConfirmation
        : input.browserSecurityPlan.requiredConfirmation,
    credentialId:
      input.credentialResult.status === "verified"
        ? input.credentialResult.credentialId
        : undefined,
    actorKind:
      input.credentialResult.status === "verified" ? input.credentialResult.actorKind : undefined,
    auditIntent: input.credentialResult.auditIntent,
    credentialResult: input.credentialResult,
    authorizationPlan: input.authorizationPlan,
    browserSecurityPlan: input.browserSecurityPlan,
    enforcementActive: false,
    networkExposureSafe: false,
  };
}

function reasonCodesFor(input: {
  credentialResult: HttpCredentialAdapterResult;
  authorizationPlan: AuthPlanResult;
  browserSecurityPlan: BrowserSecurityPlan;
  anonymousReduced: boolean;
  missingAuthentication: boolean;
  missingAuthorization: boolean;
  confirmationRequired: boolean;
  wouldAllow: boolean;
}): RequestAuthorizationReasonCode[] {
  const reasons: RequestAuthorizationReasonCode[] = [];
  if (input.wouldAllow) reasons.push("planned-allow");
  if (input.anonymousReduced) reasons.push("anonymous-reduced");
  if (input.missingAuthentication) reasons.push("requires-authentication");
  if (input.credentialResult.status === "malformed") reasons.push("malformed-credential");
  if (input.missingAuthorization) reasons.push("requires-authorization");
  if (input.confirmationRequired) reasons.push("requires-stronger-confirmation");
  if (input.browserSecurityPlan.failureReasons.length > 0) {
    reasons.push("browser-security-requirement");
  }
  if (reasons.length === 0) reasons.push("planned-deny");
  return Array.from(new Set(reasons));
}

function matchRoutePolicy(request: RequestShapedCredentialInput): ProtectedRoutePolicy | undefined {
  const method = request.method.toUpperCase() as RoutePolicyMethod;
  if (method === "OPTIONS") return policyFor("OPTIONS", "*");
  const pathname = pathOnly(request.path);
  if (request.routePattern) {
    const direct = policyFor(method, request.routePattern);
    if (direct) return direct;
  }
  if (pathname === "/api/health") return policyFor(method, "/api/health");
  if (pathname === "/api/node/status") return policyFor(method, "/api/node/status");
  if (pathname === "/api/node/auth/dry-run") {
    return policyFor(method, "/api/node/auth/dry-run");
  }
  if (pathname === "/api/vaults") return policyFor(method, "/api/vaults");

  const vaultRoute = /^\/api\/vaults\/([^/]+)(?:\/(.+))?$/.exec(pathname);
  const tail = vaultRoute?.[2] ?? "";
  if (!vaultRoute) return undefined;
  switch (tail) {
    case "":
      return policyFor(method, "/api/vaults/:vaultId");
    case "files":
      return policyFor(method, "/api/vaults/:vaultId/files");
    case "file":
      return policyFor(
        method,
        method === "POST" ? "/api/vaults/:vaultId/file" : "/api/vaults/:vaultId/file?path=...",
      );
    case "status":
      return policyFor(method, "/api/vaults/:vaultId/status");
    case "storage":
      return policyFor(method, "/api/vaults/:vaultId/storage");
    case "folder":
      return policyFor(method, "/api/vaults/:vaultId/folder");
    case "rename":
      return policyFor(method, "/api/vaults/:vaultId/rename");
    case "reindex":
      return policyFor(method, "/api/vaults/:vaultId/reindex");
    case "index-scope":
      return policyFor(method, "/api/vaults/:vaultId/index-scope");
    case "index":
      return policyFor(method, "/api/vaults/:vaultId/index");
    case "index/filters":
      return policyFor(method, "/api/vaults/:vaultId/index/filters?filter=...");
    case "index/search":
      return policyFor(method, "/api/vaults/:vaultId/index/search?q=...");
    case "index/inspect":
      return policyFor(method, "/api/vaults/:vaultId/index/inspect?path=...");
    default:
      return undefined;
  }
}

function policyFor(
  method: RoutePolicyMethod,
  routePattern: string,
): ProtectedRoutePolicy | undefined {
  return PROTECTED_ROUTE_POLICIES.find(
    (policy) => policy.method === method && policy.routePattern === routePattern,
  );
}

function actorForCredentialResult(
  result: HttpCredentialAdapterResult,
): CredentialPlanningActor | null {
  if (result.status !== "verified") return null;
  return {
    kind: "credential",
    credentialId: result.credentialId,
    displayName: result.credentialId,
    actorKind:
      result.actorKind === "browserSession"
        ? "session"
        : result.actorKind === "futureNode"
          ? "node"
          : "api",
    nodePermissions: result.nodePermissions,
    vaultGrants: result.vaultGrants,
  };
}

function clientPosture(
  explicit: BrowserSecurityClientPosture | undefined,
  result: HttpCredentialAdapterResult,
): BrowserSecurityClientPosture {
  if (explicit) return explicit;
  if (result.status === "verified" && result.credentialSource === "browserSessionCookie") {
    return "browserCookieSession";
  }
  if (result.status === "verified" && result.credentialSource === "bearerHeader") {
    return "cliApiHeaderToken";
  }
  return "anonymous";
}

function sessionStateFromCredentialResult(
  result: HttpCredentialAdapterResult,
): "valid" | "missing" | "expired" | "revoked" | undefined {
  if (result.credentialSource !== "browserSessionCookie") return undefined;
  if (result.status === "verified") return "valid";
  if (result.reasonCode === "session-expired") return "expired";
  if (result.reasonCode === "session-revoked") return "revoked";
  return "missing";
}

function routeKey(policy: ProtectedRoutePolicy): string {
  return `${policy.method} ${policy.routePattern}`;
}

function pathOnly(path: string): string {
  return path.split("?")[0] || path;
}

function vaultIdFromPath(path: string): string | undefined {
  return /^\/api\/vaults\/([^/]+)/.exec(pathOnly(path))?.[1];
}

function headerValue(
  headers: RequestShapedCredentialInput["headers"],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value[0];
  }
  return undefined;
}
