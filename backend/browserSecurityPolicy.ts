import type {
  ProtectedRoutePolicy,
  RoutePolicyCategory,
  StrongerConfirmation,
} from "./routePermissions.js";

export const BROWSER_SECURITY_NETWORK_EXPOSURE_SAFE = false;

export type BrowserSecurityClientPosture =
  | "anonymous"
  | "browserCookieSession"
  | "browserHeaderToken"
  | "cliApiHeaderToken"
  | "futureNodeCredential";

export type BrowserSecurityRequestClass =
  | "preflight"
  | "reducedAnonymousStatus"
  | "safeReadMetadata"
  | "sourceContentRead"
  | "sourceMutation"
  | "delete"
  | "authManagement"
  | "vaultManagement"
  | "auditRead";

export type BrowserSecurityFailureReason =
  | "missing-origin"
  | "untrusted-origin"
  | "failed-csrf"
  | "missing-session"
  | "expired-session"
  | "revoked-session"
  | "missing-credential"
  | "failed-authorization"
  | "disabled-auth-with-non-local-bind";

export type BrowserSecurityPlanInput = {
  client: BrowserSecurityClientPosture;
  routePolicy?: ProtectedRoutePolicy;
  requestClass?: BrowserSecurityRequestClass;
  reducedAnonymousRequested?: boolean;
  origin?: string;
  allowedOrigins?: readonly string[];
  csrfTokenPresent?: boolean;
  sessionState?: "valid" | "missing" | "expired" | "revoked";
  credentialPresent?: boolean;
  authorizationSatisfied?: boolean;
  nonLocalBindWithDisabledAuth?: boolean;
};

export type BrowserSecurityPlan = {
  requestClass: BrowserSecurityRequestClass;
  authenticationRequired: boolean;
  authorizationRequired: boolean;
  originCheckRequired: boolean;
  csrfCheckRequired: boolean;
  strongerConfirmationRequired: boolean;
  requiredConfirmation: readonly StrongerConfirmation[];
  reducedAnonymousResponseAllowed: boolean;
  preflightIsAuthorization: false;
  failureReasons: readonly BrowserSecurityFailureReason[];
  networkExposureSafe: false;
};

const categoryRequestClasses: Record<RoutePolicyCategory, BrowserSecurityRequestClass> = {
  corsPreflight: "preflight",
  health: "safeReadMetadata",
  nodeDiagnostics: "safeReadMetadata",
  dryRunDiagnostics: "safeReadMetadata",
  browserSessionAuth: "authManagement",
  browserSessionLogout: "authManagement",
  browserSessionRevocation: "authManagement",
  browserSessionCsrf: "authManagement",
  browserSessionPairing: "authManagement",
  credentialBootstrap: "authManagement",
  credentialListing: "authManagement",
  credentialCreation: "authManagement",
  credentialRevocation: "authManagement",
  credentialRotation: "authManagement",
  vaultListing: "safeReadMetadata",
  vaultRegistration: "vaultManagement",
  vaultRebind: "vaultManagement",
  vaultRemoval: "vaultManagement",
  fileListing: "safeReadMetadata",
  fileRead: "sourceContentRead",
  vaultRuntimeStatus: "safeReadMetadata",
  storageSummary: "safeReadMetadata",
  fileWrite: "sourceMutation",
  fileCreate: "sourceMutation",
  folderCreate: "sourceMutation",
  rename: "sourceMutation",
  fileDelete: "delete",
  reindex: "sourceMutation",
  indexScopeUpdate: "vaultManagement",
  indexRead: "safeReadMetadata",
  indexFilters: "safeReadMetadata",
  indexSearch: "safeReadMetadata",
  indexInspect: "safeReadMetadata",
};

export function classifyBrowserSecurityRequest(
  policy: ProtectedRoutePolicy,
  reducedAnonymousRequested = false,
): BrowserSecurityRequestClass {
  if (reducedAnonymousRequested && policy.anonymousReducedStatusMayExist) {
    return "reducedAnonymousStatus";
  }
  return categoryRequestClasses[policy.category];
}

export function planBrowserSecurity(input: BrowserSecurityPlanInput): BrowserSecurityPlan {
  const requestClass =
    input.requestClass ??
    (input.routePolicy
      ? classifyBrowserSecurityRequest(input.routePolicy, input.reducedAnonymousRequested)
      : "safeReadMetadata");
  const reducedAnonymousResponseAllowed =
    requestClass === "reducedAnonymousStatus" &&
    input.client === "anonymous" &&
    Boolean(input.routePolicy?.anonymousReducedStatusMayExist);
  const preflight = requestClass === "preflight";
  const authenticationRequired = !preflight && !reducedAnonymousResponseAllowed;
  const authorizationRequired = authenticationRequired;
  const originCheckRequired = requiresOriginCheck(input.client, authenticationRequired);
  const csrfCheckRequired = requiresCsrfCheck(input.client, requestClass);
  const requiredConfirmation =
    input.routePolicy?.strongerConfirmation ?? confirmationsForClass(requestClass);
  const strongerConfirmationRequired = requiredConfirmation.length > 0;
  const failureReasons = plannedFailureReasons(input, {
    authenticationRequired,
    authorizationRequired,
    originCheckRequired,
    csrfCheckRequired,
  });

  return {
    requestClass,
    authenticationRequired,
    authorizationRequired,
    originCheckRequired,
    csrfCheckRequired,
    strongerConfirmationRequired,
    requiredConfirmation,
    reducedAnonymousResponseAllowed,
    preflightIsAuthorization: false,
    failureReasons,
    networkExposureSafe: false,
  };
}

function requiresOriginCheck(
  client: BrowserSecurityClientPosture,
  authenticationRequired: boolean,
): boolean {
  return (
    authenticationRequired && (client === "browserCookieSession" || client === "browserHeaderToken")
  );
}

function requiresCsrfCheck(
  client: BrowserSecurityClientPosture,
  requestClass: BrowserSecurityRequestClass,
): boolean {
  if (client !== "browserCookieSession") return false;
  return ["sourceMutation", "delete", "authManagement", "vaultManagement"].includes(requestClass);
}

function confirmationsForClass(
  requestClass: BrowserSecurityRequestClass,
): readonly StrongerConfirmation[] {
  if (requestClass === "delete") return ["delete"];
  if (requestClass === "authManagement") return ["authChange"];
  if (requestClass === "vaultManagement") return ["vaultRegistration"];
  return [];
}

function plannedFailureReasons(
  input: BrowserSecurityPlanInput,
  checks: Pick<
    BrowserSecurityPlan,
    "authenticationRequired" | "authorizationRequired" | "originCheckRequired" | "csrfCheckRequired"
  >,
): BrowserSecurityFailureReason[] {
  const reasons: BrowserSecurityFailureReason[] = [];
  if (input.nonLocalBindWithDisabledAuth) reasons.push("disabled-auth-with-non-local-bind");

  if (checks.originCheckRequired) {
    if (!input.origin) {
      reasons.push("missing-origin");
    } else if (input.allowedOrigins && !input.allowedOrigins.includes(input.origin)) {
      reasons.push("untrusted-origin");
    }
  }

  if (checks.csrfCheckRequired && input.csrfTokenPresent === false) {
    reasons.push("failed-csrf");
  }

  if (checks.authenticationRequired) {
    if (input.client === "anonymous") reasons.push("missing-credential");
    if (input.client === "browserCookieSession") {
      if (input.sessionState === "missing") reasons.push("missing-session");
      if (input.sessionState === "expired") reasons.push("expired-session");
      if (input.sessionState === "revoked") reasons.push("revoked-session");
    }
    if (
      (input.client === "browserHeaderToken" ||
        input.client === "cliApiHeaderToken" ||
        input.client === "futureNodeCredential") &&
      input.credentialPresent === false
    ) {
      reasons.push("missing-credential");
    }
  }

  if (checks.authorizationRequired && input.authorizationSatisfied === false) {
    reasons.push("failed-authorization");
  }

  return Array.from(new Set(reasons));
}
