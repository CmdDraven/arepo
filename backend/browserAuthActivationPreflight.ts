import type { AuthMode } from "./types.js";

export const BROWSER_AUTH_ACTIVATION_PREFLIGHT_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_ACTIVATION_PREFLIGHT_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_ACTIVATION_PREFLIGHT_WIRED_INTO_ROUTES = false;

export type BrowserAuthActivationPreflightStatus = "inactive" | "blocked" | "planning-only";

export type BrowserAuthActivationPreflightBlockerCode =
  | "browser-auth-activation-not-requested"
  | "browser-auth-lifecycle-coordinator-unmounted"
  | "browser-auth-session-routes-stubbed"
  | "browser-auth-pairing-routes-stubbed"
  | "browser-auth-csrf-endpoint-stubbed"
  | "browser-auth-cookie-credentials-not-accepted"
  | "browser-auth-csrf-enforcement-inactive"
  | "browser-auth-live-cookie-issuance-inactive"
  | "browser-auth-session-persistence-strategy-unresolved"
  | "browser-auth-operator-confirmation-missing"
  | "browser-auth-remote-binding-requires-stronger-policy"
  | "browser-auth-inactive-boundary-regression-required"
  | "browser-auth-route-mounting-blocked";

export type BrowserAuthActivationPreflightWarningCode =
  | "browser-auth-cors-is-not-authentication"
  | "browser-auth-frontend-storage-must-remain-secretless"
  | "browser-auth-bearer-flow-remains-live-credential-path"
  | "browser-auth-secure-cookie-policy-required"
  | "browser-auth-non-local-bind-unsafe-without-stronger-policy";

export type BrowserAuthActivationConfirmationCode =
  | "confirm-browser-auth-activation"
  | "confirm-cookie-session-csrf-enforcement"
  | "confirm-local-only-or-stronger-network-policy";

export type BrowserAuthActivationPreflightInput = {
  authMode?: AuthMode;
  activationRequested?: boolean;
  operatorConfirmationPresent?: boolean;
  localOnlyMode?: boolean;
  strongerRemotePolicyConfigured?: boolean;
  lifecycleCoordinatorMounted?: boolean;
  sessionRoutes?: "stubbed" | "mounted";
  pairingRoutes?: "stubbed" | "mounted";
  csrfEndpoint?: "stubbed" | "mounted";
  cookieIssuance?: "inactive" | "active";
  cookieCredentialsAccepted?: boolean;
  csrfEnforcement?: "inactive" | "active";
  sessionPersistenceStrategy?: "unresolved" | "in-memory" | "persistent";
  inactiveBoundaryRegressionPresent?: boolean;
  revocationAndExpiryPreserved?: boolean;
  frontendStoresBearerTokens?: boolean;
};

export type BrowserAuthActivationPreflightPlan = {
  status: BrowserAuthActivationPreflightStatus;
  activationRequested: boolean;
  readyForFutureActivation: boolean;
  liveRouteMountingAllowed: false;
  browserAuthEnabled: false;
  mounted: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  issuesCookies: false;
  acceptsCookies: false;
  acceptsCsrfTokens: false;
  lifecycleCoordinatorMounted: boolean;
  blockerCodes: readonly BrowserAuthActivationPreflightBlockerCode[];
  warningCodes: readonly BrowserAuthActivationPreflightWarningCode[];
  requiredConfirmations: readonly BrowserAuthActivationConfirmationCode[];
  safeNotes: readonly string[];
  networkExposureSafe: false;
};

export function planBrowserAuthActivationPreflight(
  input: BrowserAuthActivationPreflightInput = {},
): BrowserAuthActivationPreflightPlan {
  const normalized = normalizeInput(input);
  const blockerCodes = preflightBlockers(normalized);
  const warningCodes = preflightWarnings(normalized);
  const requiredConfirmations = preflightConfirmations(normalized);

  return {
    status: normalized.activationRequested
      ? blockerCodes.length > 0
        ? "blocked"
        : "planning-only"
      : "inactive",
    activationRequested: normalized.activationRequested,
    readyForFutureActivation: blockerCodes.length === 0,
    liveRouteMountingAllowed: false,
    browserAuthEnabled: false,
    mounted: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    issuesCookies: false,
    acceptsCookies: false,
    acceptsCsrfTokens: false,
    lifecycleCoordinatorMounted: normalized.lifecycleCoordinatorMounted,
    blockerCodes,
    warningCodes,
    requiredConfirmations,
    safeNotes: [
      "Browser auth remains inactive until every preflight gate is satisfied in a future slice.",
      "Bearer-token protected mode remains the only live credential path.",
      "CORS is not authentication.",
    ],
    networkExposureSafe: false,
  };
}

function normalizeInput(
  input: BrowserAuthActivationPreflightInput,
): Required<BrowserAuthActivationPreflightInput> {
  return {
    authMode: input.authMode ?? "protected",
    activationRequested: input.activationRequested ?? false,
    operatorConfirmationPresent: input.operatorConfirmationPresent ?? false,
    localOnlyMode: input.localOnlyMode ?? true,
    strongerRemotePolicyConfigured: input.strongerRemotePolicyConfigured ?? false,
    lifecycleCoordinatorMounted: input.lifecycleCoordinatorMounted ?? false,
    sessionRoutes: input.sessionRoutes ?? "stubbed",
    pairingRoutes: input.pairingRoutes ?? "stubbed",
    csrfEndpoint: input.csrfEndpoint ?? "stubbed",
    cookieIssuance: input.cookieIssuance ?? "inactive",
    cookieCredentialsAccepted: input.cookieCredentialsAccepted ?? false,
    csrfEnforcement: input.csrfEnforcement ?? "inactive",
    sessionPersistenceStrategy: input.sessionPersistenceStrategy ?? "unresolved",
    inactiveBoundaryRegressionPresent: input.inactiveBoundaryRegressionPresent ?? true,
    revocationAndExpiryPreserved: input.revocationAndExpiryPreserved ?? true,
    frontendStoresBearerTokens: input.frontendStoresBearerTokens ?? false,
  };
}

function preflightBlockers(
  input: Required<BrowserAuthActivationPreflightInput>,
): BrowserAuthActivationPreflightBlockerCode[] {
  const blockers: BrowserAuthActivationPreflightBlockerCode[] = [];
  if (!input.activationRequested) blockers.push("browser-auth-activation-not-requested");
  if (!input.lifecycleCoordinatorMounted) {
    blockers.push("browser-auth-lifecycle-coordinator-unmounted");
  }
  if (input.sessionRoutes !== "mounted") blockers.push("browser-auth-session-routes-stubbed");
  if (input.pairingRoutes !== "mounted") blockers.push("browser-auth-pairing-routes-stubbed");
  if (input.csrfEndpoint !== "mounted") blockers.push("browser-auth-csrf-endpoint-stubbed");
  if (!input.cookieCredentialsAccepted) {
    blockers.push("browser-auth-cookie-credentials-not-accepted");
  }
  if (input.csrfEnforcement !== "active") blockers.push("browser-auth-csrf-enforcement-inactive");
  if (input.cookieIssuance !== "active") {
    blockers.push("browser-auth-live-cookie-issuance-inactive");
  }
  if (input.sessionPersistenceStrategy === "unresolved") {
    blockers.push("browser-auth-session-persistence-strategy-unresolved");
  }
  if (!input.operatorConfirmationPresent) {
    blockers.push("browser-auth-operator-confirmation-missing");
  }
  if (!input.localOnlyMode && !input.strongerRemotePolicyConfigured) {
    blockers.push("browser-auth-remote-binding-requires-stronger-policy");
  }
  if (!input.inactiveBoundaryRegressionPresent) {
    blockers.push("browser-auth-inactive-boundary-regression-required");
  }
  blockers.push("browser-auth-route-mounting-blocked");
  return blockers;
}

function preflightWarnings(
  input: Required<BrowserAuthActivationPreflightInput>,
): BrowserAuthActivationPreflightWarningCode[] {
  const warnings: BrowserAuthActivationPreflightWarningCode[] = [
    "browser-auth-cors-is-not-authentication",
    "browser-auth-frontend-storage-must-remain-secretless",
    "browser-auth-bearer-flow-remains-live-credential-path",
    "browser-auth-secure-cookie-policy-required",
  ];
  if (!input.localOnlyMode) {
    warnings.push("browser-auth-non-local-bind-unsafe-without-stronger-policy");
  }
  return warnings;
}

function preflightConfirmations(
  input: Required<BrowserAuthActivationPreflightInput>,
): BrowserAuthActivationConfirmationCode[] {
  const confirmations: BrowserAuthActivationConfirmationCode[] = [
    "confirm-browser-auth-activation",
    "confirm-cookie-session-csrf-enforcement",
  ];
  if (!input.localOnlyMode) confirmations.push("confirm-local-only-or-stronger-network-policy");
  return confirmations;
}
