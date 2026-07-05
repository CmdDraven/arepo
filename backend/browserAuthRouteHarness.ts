import {
  evaluateBrowserAuthActivationGate,
  type BrowserAuthActivationGateDecision,
  type BrowserAuthActivationGateInput,
} from "./browserAuthActivationGate.js";
import {
  planBrowserAuthRouteContracts,
  type BrowserAuthRouteContract,
  type BrowserAuthRouteContractPlan,
} from "./browserAuthRouteContracts.js";
import type { BrowserAuthLifecycleCoordinator } from "./browserAuthLifecycleCoordinator.js";

export const BROWSER_AUTH_ROUTE_HARNESS_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_ROUTE_HARNESS_MOUNTED = false;
export const BROWSER_AUTH_ROUTE_HARNESS_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_ROUTE_HARNESS_WIRED_INTO_ROUTES = false;

export type BrowserAuthHarnessRouteId =
  | "browser-pairing-start"
  | "browser-pairing-complete"
  | "browser-session-issue"
  | "browser-session-status"
  | "browser-csrf-issue"
  | "browser-session-logout"
  | "browser-session-revoke-current"
  | "browser-session-revoke-all";

export type BrowserAuthRouteHarnessRequest = {
  routeId: BrowserAuthHarnessRouteId;
  method?: string;
  path?: string;
  localOnlyMode?: boolean;
  operatorConfirmationPresent?: boolean;
  activationGate?: Omit<BrowserAuthActivationGateInput, "routeId" | "routeContract">;
};

export type BrowserAuthRouteHarnessResult = {
  ok: false;
  status: "inactive";
  httpStatus: 501;
  routeId: BrowserAuthHarnessRouteId;
  method: string;
  path: string;
  routeContractStatus: BrowserAuthRouteContract["status"];
  error: {
    code: "browser_session_auth_inactive";
    message: "Browser-session authentication is planned but not active.";
  };
  activationGate: BrowserAuthActivationGateDecision;
  headers: Record<string, never>;
  setCookieHeaders: readonly [];
  issuedCookies: false;
  acceptedCookies: false;
  issuedPairingCode: false;
  consumedPairingCode: false;
  issuedBrowserSession: false;
  issuedCsrfToken: false;
  validatedCsrfToken: false;
  authenticatedRequest: false;
  liveAuthorizationDecision: false;
  lifecycleCoordinatorCalled: false;
  networkExposureSafe: false;
};

export type BrowserAuthRouteHarnessDiagnostics = {
  status: "inactive";
  implementation: "dark-route-test-harness";
  mounted: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  routeCount: number;
  issuesCookies: false;
  acceptsCookies: false;
  issuesPairingCodes: false;
  consumesPairingCodes: false;
  issuesBrowserSessions: false;
  issuesCsrfTokens: false;
  validatesCsrfTokens: false;
  authenticatesRequests: false;
  networkExposureSafe: false;
};

export type BrowserAuthRouteHarness = {
  routePlan: BrowserAuthRouteContractPlan;
  diagnostics(): BrowserAuthRouteHarnessDiagnostics;
  handle(request: BrowserAuthRouteHarnessRequest): BrowserAuthRouteHarnessResult;
  pairingStart(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult;
  pairingComplete(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult;
  sessionIssue(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult;
  sessionStatus(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult;
  csrfIssue(input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">): BrowserAuthRouteHarnessResult;
  logout(input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">): BrowserAuthRouteHarnessResult;
  revokeCurrentSession(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult;
  revokeAllSessions(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult;
};

export function createBrowserAuthRouteHarness(
  options: {
    routePlan?: BrowserAuthRouteContractPlan;
    lifecycleCoordinator?: BrowserAuthLifecycleCoordinator;
  } = {},
): BrowserAuthRouteHarness {
  const routePlan = options.routePlan ?? planBrowserAuthRouteContracts();

  function handle(request: BrowserAuthRouteHarnessRequest): BrowserAuthRouteHarnessResult {
    const contract = contractForRoute(routePlan, request.routeId);
    const activationGate = evaluateBrowserAuthActivationGate({
      ...request.activationGate,
      routeId: request.routeId,
      routeContract: contract,
      localOnlyMode: request.localOnlyMode ?? request.activationGate?.localOnlyMode,
      operatorConfirmationPresent:
        request.operatorConfirmationPresent ??
        request.activationGate?.operatorConfirmationPresent ??
        false,
    });

    return inactiveResult({
      request,
      contract,
      activationGate,
    });
  }

  return {
    routePlan,
    diagnostics() {
      return {
        status: "inactive",
        implementation: "dark-route-test-harness",
        mounted: false,
        wiredIntoAuthorization: false,
        wiredIntoRoutes: false,
        routeCount: routePlan.contracts.length,
        issuesCookies: false,
        acceptsCookies: false,
        issuesPairingCodes: false,
        consumesPairingCodes: false,
        issuesBrowserSessions: false,
        issuesCsrfTokens: false,
        validatesCsrfTokens: false,
        authenticatesRequests: false,
        networkExposureSafe: false,
      };
    },
    handle,
    pairingStart(input = {}) {
      return handle({ ...input, routeId: "browser-pairing-start" });
    },
    pairingComplete(input = {}) {
      return handle({ ...input, routeId: "browser-pairing-complete" });
    },
    sessionIssue(input = {}) {
      return handle({ ...input, routeId: "browser-session-issue" });
    },
    sessionStatus(input = {}) {
      return handle({ ...input, routeId: "browser-session-status" });
    },
    csrfIssue(input = {}) {
      return handle({ ...input, routeId: "browser-csrf-issue" });
    },
    logout(input = {}) {
      return handle({ ...input, routeId: "browser-session-logout" });
    },
    revokeCurrentSession(input = {}) {
      return handle({ ...input, routeId: "browser-session-revoke-current" });
    },
    revokeAllSessions(input = {}) {
      return handle({ ...input, routeId: "browser-session-revoke-all" });
    },
  };
}

function contractForRoute(
  routePlan: BrowserAuthRouteContractPlan,
  routeId: BrowserAuthHarnessRouteId,
): BrowserAuthRouteContract {
  const contract = routePlan.contracts.find((candidate) => candidate.routeId === routeId);
  if (!contract) {
    throw new Error(`Browser auth route contract missing for ${routeId}`);
  }
  return contract;
}

function inactiveResult(input: {
  request: BrowserAuthRouteHarnessRequest;
  contract: BrowserAuthRouteContract;
  activationGate: BrowserAuthActivationGateDecision;
}): BrowserAuthRouteHarnessResult {
  return {
    ok: false,
    status: "inactive",
    httpStatus: 501,
    routeId: input.request.routeId,
    method: input.request.method ?? input.contract.method,
    path: input.request.path ?? input.contract.path,
    routeContractStatus: input.contract.status,
    error: {
      code: "browser_session_auth_inactive",
      message: "Browser-session authentication is planned but not active.",
    },
    activationGate: input.activationGate,
    headers: {},
    setCookieHeaders: [],
    issuedCookies: false,
    acceptedCookies: false,
    issuedPairingCode: false,
    consumedPairingCode: false,
    issuedBrowserSession: false,
    issuedCsrfToken: false,
    validatedCsrfToken: false,
    authenticatedRequest: false,
    liveAuthorizationDecision: false,
    lifecycleCoordinatorCalled: false,
    networkExposureSafe: false,
  };
}
