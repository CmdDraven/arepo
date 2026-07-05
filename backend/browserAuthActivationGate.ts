import {
  planBrowserAuthActivationConfigPolicy,
  type BrowserAuthActivationConfigPolicyPlan,
} from "./browserAuthActivationConfigPolicy.js";
import {
  planBrowserAuthActivationPreflight,
  type BrowserAuthActivationPreflightPlan,
} from "./browserAuthActivationPreflight.js";
import type { BrowserAuthRouteContract } from "./browserAuthRouteContracts.js";

export const BROWSER_AUTH_ACTIVATION_GATE_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_ACTIVATION_GATE_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_ACTIVATION_GATE_WIRED_INTO_ROUTES = false;
export const BROWSER_AUTH_ACTIVATION_GATE_ALLOWS_BROWSER_AUTH = false;

export type BrowserAuthActivationGateReasonCode = "browser_auth_activation_blocked";

export type BrowserAuthActivationGateBlockerCode =
  | "browser-auth-activation-gate-blocked"
  | "browser-auth-activation-gate-route-contract-missing"
  | "browser-auth-activation-gate-route-contract-inactive"
  | "browser-auth-activation-gate-operator-confirmation-missing"
  | string;

export type BrowserAuthActivationGateInput = {
  routeId?: string;
  routeContract?: BrowserAuthRouteContract;
  activationConfigPolicy?: BrowserAuthActivationConfigPolicyPlan;
  activationPreflight?: BrowserAuthActivationPreflightPlan;
  localOnlyMode?: boolean;
  operatorConfirmationPresent?: boolean;
};

export type BrowserAuthActivationGateDecision = {
  status: "blocked";
  allowed: false;
  reasonCode: BrowserAuthActivationGateReasonCode;
  routeId?: string;
  browserAuthEnabled: false;
  mounted: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  issuesCookies: false;
  acceptsCookies: false;
  issuesPairingCodes: false;
  consumesPairingCodes: false;
  issuesBrowserSessions: false;
  issuesCsrfTokens: false;
  validatesCsrfTokens: false;
  authenticatesRequests: false;
  localOnlyMode: boolean;
  operatorConfirmationPresent: boolean;
  blockerCodes: readonly BrowserAuthActivationGateBlockerCode[];
  warningCodes: readonly string[];
  requiredConfirmations: readonly string[];
  networkExposureSafe: false;
};

export function evaluateBrowserAuthActivationGate(
  input: BrowserAuthActivationGateInput = {},
): BrowserAuthActivationGateDecision {
  const activationConfigPolicy =
    input.activationConfigPolicy ??
    planBrowserAuthActivationConfigPolicy({ localOnlyMode: input.localOnlyMode });
  const activationPreflight =
    input.activationPreflight ??
    planBrowserAuthActivationPreflight({ localOnlyMode: input.localOnlyMode });
  const routeId = input.routeId ?? input.routeContract?.routeId;
  const blockerCodes = activationGateBlockers({
    routeContract: input.routeContract,
    activationConfigPolicy,
    activationPreflight,
    operatorConfirmationPresent: input.operatorConfirmationPresent ?? false,
  });

  return {
    status: "blocked",
    allowed: false,
    reasonCode: "browser_auth_activation_blocked",
    ...(routeId ? { routeId } : {}),
    browserAuthEnabled: false,
    mounted: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    issuesCookies: false,
    acceptsCookies: false,
    issuesPairingCodes: false,
    consumesPairingCodes: false,
    issuesBrowserSessions: false,
    issuesCsrfTokens: false,
    validatesCsrfTokens: false,
    authenticatesRequests: false,
    localOnlyMode: input.localOnlyMode ?? activationConfigPolicy.localOnlyMode,
    operatorConfirmationPresent: input.operatorConfirmationPresent ?? false,
    blockerCodes,
    warningCodes: [...activationConfigPolicy.warningCodes, ...activationPreflight.warningCodes],
    requiredConfirmations: [
      ...activationConfigPolicy.requiredConfirmations,
      ...activationPreflight.requiredConfirmations,
    ],
    networkExposureSafe: false,
  };
}

function activationGateBlockers(input: {
  routeContract?: BrowserAuthRouteContract;
  activationConfigPolicy: BrowserAuthActivationConfigPolicyPlan;
  activationPreflight: BrowserAuthActivationPreflightPlan;
  operatorConfirmationPresent: boolean;
}): BrowserAuthActivationGateBlockerCode[] {
  return Array.from(
    new Set(
      [
        "browser-auth-activation-gate-blocked",
        input.routeContract ? undefined : "browser-auth-activation-gate-route-contract-missing",
        input.routeContract?.status === "stubbed" ||
        input.routeContract?.status === "planned-inactive"
          ? "browser-auth-activation-gate-route-contract-inactive"
          : undefined,
        input.operatorConfirmationPresent
          ? undefined
          : "browser-auth-activation-gate-operator-confirmation-missing",
        ...input.activationConfigPolicy.blockerCodes,
        ...input.activationPreflight.blockerCodes,
        ...(input.routeContract?.activationBlockerCodes ?? []),
      ].filter((code): code is BrowserAuthActivationGateBlockerCode => Boolean(code)),
    ),
  );
}
