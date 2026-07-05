export const BROWSER_AUTH_ACTIVATION_CONFIG_POLICY_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_ACTIVATION_CONFIG_POLICY_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_ACTIVATION_CONFIG_POLICY_WIRED_INTO_ROUTES = false;

export type BrowserAuthActivationConfigStatus = "inactive" | "blocked";

export type BrowserAuthActivationConfigBlockerCode =
  | "browser-auth-config-activation-not-requested"
  | "browser-auth-config-activation-disabled-by-runtime-policy"
  | "browser-auth-config-operator-confirmation-missing"
  | "browser-auth-config-remote-binding-requires-stronger-policy"
  | "browser-auth-config-secure-cookie-policy-missing"
  | "browser-auth-config-samesite-policy-missing"
  | "browser-auth-config-samesite-policy-unsafe"
  | "browser-auth-config-csrf-enforcement-inactive"
  | "browser-auth-config-session-persistence-strategy-unresolved"
  | "browser-auth-config-audit-readiness-missing"
  | "browser-auth-config-revocation-expiry-readiness-missing"
  | "browser-auth-config-route-contracts-not-ready"
  | "browser-auth-config-inactive-boundary-regression-required"
  | "browser-auth-config-frontend-secret-storage-not-prohibited"
  | "browser-auth-config-unknown-setting-present"
  | "browser-auth-config-live-mounting-blocked";

export type BrowserAuthActivationConfigWarningCode =
  | "browser-auth-config-cors-is-not-authentication"
  | "browser-auth-config-future-shape-only"
  | "browser-auth-config-non-local-bind-unsafe-without-stronger-policy"
  | "browser-auth-config-cookie-domain-discouraged"
  | "browser-auth-config-frontend-must-not-store-secrets";

export type BrowserAuthActivationConfigConfirmationCode =
  | "confirm-browser-auth-config-activation"
  | "confirm-browser-auth-cookie-session-csrf-policy"
  | "confirm-browser-auth-local-only-or-stronger-network-policy";

export type BrowserAuthFutureConfig = {
  activationRequested?: boolean;
  operatorConfirmation?: boolean | "confirm-browser-auth-activation" | string;
  cookiePolicy?: {
    secureCookies?: boolean;
    sameSite?: "lax" | "strict" | "none" | string;
    domain?: string | null;
  };
  csrfEnforcement?: "inactive" | "active" | string;
  sessionPersistenceStrategy?: "unresolved" | "in-memory" | "persistent" | string;
  auditEventsReady?: boolean;
  revocationAndExpiryPreserved?: boolean;
  routeContractsReady?: boolean;
  inactiveBoundaryRegressionPresent?: boolean;
  frontendNoSecretStorage?: boolean;
  strongerRemotePolicyConfigured?: boolean;
};

export type BrowserAuthActivationConfigPolicyInput = {
  browserAuth?: BrowserAuthFutureConfig & Record<string, unknown>;
  localOnlyMode?: boolean;
  buildRuntimeAllowsActivation?: boolean;
};

export type BrowserAuthActivationConfigPolicyPlan = {
  status: BrowserAuthActivationConfigStatus;
  requestedActivation: boolean;
  effectiveActivationStatus: "inactive";
  activationAllowed: false;
  buildRuntimeAllowsActivation: false;
  browserAuthEnabled: false;
  mounted: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  issuesCookies: false;
  acceptsCookies: false;
  acceptsCsrfTokens: false;
  localOnlyMode: boolean;
  unknownConfigKeys: readonly string[];
  blockerCodes: readonly BrowserAuthActivationConfigBlockerCode[];
  warningCodes: readonly BrowserAuthActivationConfigWarningCode[];
  requiredConfirmations: readonly BrowserAuthActivationConfigConfirmationCode[];
  safeNotes: readonly string[];
  networkExposureSafe: false;
};

const knownBrowserAuthConfigKeys = new Set([
  "activationRequested",
  "operatorConfirmation",
  "cookiePolicy",
  "csrfEnforcement",
  "sessionPersistenceStrategy",
  "auditEventsReady",
  "revocationAndExpiryPreserved",
  "routeContractsReady",
  "inactiveBoundaryRegressionPresent",
  "frontendNoSecretStorage",
  "strongerRemotePolicyConfigured",
]);

export function planBrowserAuthActivationConfigPolicy(
  input: BrowserAuthActivationConfigPolicyInput = {},
): BrowserAuthActivationConfigPolicyPlan {
  const config = input.browserAuth ?? {};
  const normalized = normalizeInput(input, config);
  const blockerCodes = configPolicyBlockers(normalized);
  const warningCodes = configPolicyWarnings(normalized);
  const requiredConfirmations = configPolicyConfirmations(normalized);

  return {
    status: normalized.requestedActivation ? "blocked" : "inactive",
    requestedActivation: normalized.requestedActivation,
    effectiveActivationStatus: "inactive",
    activationAllowed: false,
    buildRuntimeAllowsActivation: false,
    browserAuthEnabled: false,
    mounted: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    issuesCookies: false,
    acceptsCookies: false,
    acceptsCsrfTokens: false,
    localOnlyMode: normalized.localOnlyMode,
    unknownConfigKeys: normalized.unknownConfigKeys,
    blockerCodes,
    warningCodes,
    requiredConfirmations,
    safeNotes: [
      "Browser auth config policy is planning-only and cannot activate browser auth today.",
      "Bearer-token protected mode remains the only live credential path.",
      "Future browser auth activation requires a deliberate mounting slice after every policy gate passes.",
    ],
    networkExposureSafe: false,
  };
}

type NormalizedBrowserAuthActivationConfigPolicyInput = {
  requestedActivation: boolean;
  operatorConfirmationPresent: boolean;
  buildRuntimeAllowsActivation: boolean;
  localOnlyMode: boolean;
  strongerRemotePolicyConfigured: boolean;
  secureCookies: boolean;
  sameSite: string | undefined;
  domainConfigured: boolean;
  csrfEnforcement: string;
  sessionPersistenceStrategy: string;
  auditEventsReady: boolean;
  revocationAndExpiryPreserved: boolean;
  routeContractsReady: boolean;
  inactiveBoundaryRegressionPresent: boolean;
  frontendNoSecretStorage: boolean;
  unknownConfigKeys: readonly string[];
};

function normalizeInput(
  input: BrowserAuthActivationConfigPolicyInput,
  config: BrowserAuthFutureConfig & Record<string, unknown>,
): NormalizedBrowserAuthActivationConfigPolicyInput {
  const cookiePolicy = config.cookiePolicy ?? {};
  return {
    requestedActivation: config.activationRequested ?? false,
    operatorConfirmationPresent:
      config.operatorConfirmation === true ||
      config.operatorConfirmation === "confirm-browser-auth-activation",
    buildRuntimeAllowsActivation: input.buildRuntimeAllowsActivation ?? false,
    localOnlyMode: input.localOnlyMode ?? true,
    strongerRemotePolicyConfigured: config.strongerRemotePolicyConfigured ?? false,
    secureCookies: cookiePolicy.secureCookies ?? false,
    sameSite: normalizeSameSite(cookiePolicy.sameSite),
    domainConfigured: cookiePolicy.domain != null && cookiePolicy.domain !== "",
    csrfEnforcement: config.csrfEnforcement ?? "inactive",
    sessionPersistenceStrategy: config.sessionPersistenceStrategy ?? "unresolved",
    auditEventsReady: config.auditEventsReady ?? false,
    revocationAndExpiryPreserved: config.revocationAndExpiryPreserved ?? false,
    routeContractsReady: config.routeContractsReady ?? false,
    inactiveBoundaryRegressionPresent: config.inactiveBoundaryRegressionPresent ?? true,
    frontendNoSecretStorage: config.frontendNoSecretStorage ?? true,
    unknownConfigKeys: Object.keys(config)
      .filter((key) => !knownBrowserAuthConfigKeys.has(key))
      .sort(),
  };
}

function normalizeSameSite(sameSite: unknown): string | undefined {
  return typeof sameSite === "string" ? sameSite.toLowerCase() : undefined;
}

function configPolicyBlockers(
  input: NormalizedBrowserAuthActivationConfigPolicyInput,
): BrowserAuthActivationConfigBlockerCode[] {
  const blockers: BrowserAuthActivationConfigBlockerCode[] = [];
  if (!input.requestedActivation) blockers.push("browser-auth-config-activation-not-requested");
  if (!input.buildRuntimeAllowsActivation) {
    blockers.push("browser-auth-config-activation-disabled-by-runtime-policy");
  }
  if (!input.operatorConfirmationPresent) {
    blockers.push("browser-auth-config-operator-confirmation-missing");
  }
  if (!input.localOnlyMode && !input.strongerRemotePolicyConfigured) {
    blockers.push("browser-auth-config-remote-binding-requires-stronger-policy");
  }
  if (!input.localOnlyMode && !input.secureCookies) {
    blockers.push("browser-auth-config-secure-cookie-policy-missing");
  }
  if (input.sameSite == null) {
    blockers.push("browser-auth-config-samesite-policy-missing");
  } else if (input.sameSite !== "lax" && input.sameSite !== "strict") {
    blockers.push("browser-auth-config-samesite-policy-unsafe");
  }
  if (input.csrfEnforcement !== "active") {
    blockers.push("browser-auth-config-csrf-enforcement-inactive");
  }
  if (input.sessionPersistenceStrategy === "unresolved") {
    blockers.push("browser-auth-config-session-persistence-strategy-unresolved");
  }
  if (!input.auditEventsReady) blockers.push("browser-auth-config-audit-readiness-missing");
  if (!input.revocationAndExpiryPreserved) {
    blockers.push("browser-auth-config-revocation-expiry-readiness-missing");
  }
  if (!input.routeContractsReady) blockers.push("browser-auth-config-route-contracts-not-ready");
  if (!input.inactiveBoundaryRegressionPresent) {
    blockers.push("browser-auth-config-inactive-boundary-regression-required");
  }
  if (!input.frontendNoSecretStorage) {
    blockers.push("browser-auth-config-frontend-secret-storage-not-prohibited");
  }
  if (input.unknownConfigKeys.length > 0) {
    blockers.push("browser-auth-config-unknown-setting-present");
  }
  blockers.push("browser-auth-config-live-mounting-blocked");
  return blockers;
}

function configPolicyWarnings(
  input: NormalizedBrowserAuthActivationConfigPolicyInput,
): BrowserAuthActivationConfigWarningCode[] {
  const warnings: BrowserAuthActivationConfigWarningCode[] = [
    "browser-auth-config-cors-is-not-authentication",
    "browser-auth-config-future-shape-only",
    "browser-auth-config-frontend-must-not-store-secrets",
  ];
  if (!input.localOnlyMode) {
    warnings.push("browser-auth-config-non-local-bind-unsafe-without-stronger-policy");
  }
  if (input.domainConfigured) warnings.push("browser-auth-config-cookie-domain-discouraged");
  return warnings;
}

function configPolicyConfirmations(
  input: NormalizedBrowserAuthActivationConfigPolicyInput,
): BrowserAuthActivationConfigConfirmationCode[] {
  const confirmations: BrowserAuthActivationConfigConfirmationCode[] = [
    "confirm-browser-auth-config-activation",
    "confirm-browser-auth-cookie-session-csrf-policy",
  ];
  if (!input.localOnlyMode) {
    confirmations.push("confirm-browser-auth-local-only-or-stronger-network-policy");
  }
  return confirmations;
}
