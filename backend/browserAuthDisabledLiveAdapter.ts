import {
  evaluateBrowserAuthActivationGate,
  type BrowserAuthActivationGateDecision,
} from "./browserAuthActivationGate.js";
import {
  planBrowserAuthRouteContracts,
  type BrowserAuthRouteContract,
  type BrowserAuthRouteContractPlan,
} from "./browserAuthRouteContracts.js";

export const BROWSER_AUTH_DISABLED_LIVE_ADAPTER_MOUNTED = false;
export const BROWSER_AUTH_DISABLED_LIVE_ADAPTER_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_DISABLED_LIVE_ADAPTER_WIRED_INTO_ROUTES = false;
export const BROWSER_AUTH_DISABLED_LIVE_ADAPTER_LIVE_BROWSER_AUTH_ENABLED = false;

export type BrowserAuthDisabledLiveAdapterRouteId =
  | "browser-pairing-start"
  | "browser-pairing-complete"
  | "browser-session-issue"
  | "browser-session-status"
  | "browser-csrf-issue"
  | "browser-session-logout"
  | "browser-session-revoke-current"
  | "browser-session-revoke-all";

export type BrowserAuthDisabledLiveAdapterRequest = {
  routeId: BrowserAuthDisabledLiveAdapterRouteId;
  method?: string;
  path?: string;
  localOnlyMode?: boolean;
  operatorConfirmationPresent?: boolean;
  cookieHeaderPresent?: boolean;
  authorizationHeaderPresent?: boolean;
  csrfHeaderPresent?: boolean;
};

export type BrowserAuthDisabledLiveAdapterResult = {
  ok: false;
  status: "inactive";
  httpStatus: 501;
  routeId: BrowserAuthDisabledLiveAdapterRouteId;
  method: string;
  path: string;
  routeContractStatus: BrowserAuthRouteContract["status"];
  error: {
    code: "browser_session_auth_inactive";
    reasonCode: "browser_auth_disabled_live_adapter_blocked";
    message: "Browser-session authentication is planned but not active.";
  };
  activationGate: BrowserAuthActivationGateDecision;
  headers: Record<string, never>;
  setCookieHeaders: readonly [];
  betterAuthHandlerMounted: false;
  betterAuthHandlerCalled: false;
  internalAdapterWrapperCalled: false;
  setSessionCookieCalled: false;
  issuedCookies: false;
  acceptedCookies: false;
  parsedCookiesForAuthorization: false;
  issuedPairingCode: false;
  consumedPairingCode: false;
  issuedBrowserSession: false;
  createdBetterAuthSession: false;
  issuedCsrfToken: false;
  validatedCsrfToken: false;
  authenticatedRequest: false;
  liveAuthorizationDecision: false;
  changedBearerTokenProtectedMode: false;
  frontendStorageUsed: false;
  networkExposureSafe: false;
};

export type BrowserAuthDisabledLiveAdapterDiagnostics = {
  status: "disabled-live-inert";
  implementation: "disabled-live-route-adapter-skeleton";
  browserAuthEnabled: false;
  activationGateClosed: true;
  mountedInServer: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  betterAuthHandlerMounted: false;
  internalAdapterWrapperLive: false;
  issuesCookies: false;
  acceptsCookies: false;
  parsesCookiesForAuthorization: false;
  validatesCsrf: false;
  createsBrowserSessions: false;
  consumesPairingCodes: false;
  authenticatesRequests: false;
  bearerProtectedModeUnchanged: true;
  routeCount: number;
  networkExposureSafe: false;
};

export type BrowserAuthDisabledLiveAdapter = {
  routePlan: BrowserAuthRouteContractPlan;
  diagnostics(): BrowserAuthDisabledLiveAdapterDiagnostics;
  handle(request: BrowserAuthDisabledLiveAdapterRequest): BrowserAuthDisabledLiveAdapterResult;
};

export function createBrowserAuthDisabledLiveAdapter(
  options: { routePlan?: BrowserAuthRouteContractPlan } = {},
): BrowserAuthDisabledLiveAdapter {
  const routePlan = options.routePlan ?? planBrowserAuthRouteContracts();

  return {
    routePlan,
    diagnostics() {
      return {
        status: "disabled-live-inert",
        implementation: "disabled-live-route-adapter-skeleton",
        browserAuthEnabled: false,
        activationGateClosed: true,
        mountedInServer: false,
        wiredIntoAuthorization: false,
        wiredIntoRoutes: false,
        betterAuthHandlerMounted: false,
        internalAdapterWrapperLive: false,
        issuesCookies: false,
        acceptsCookies: false,
        parsesCookiesForAuthorization: false,
        validatesCsrf: false,
        createsBrowserSessions: false,
        consumesPairingCodes: false,
        authenticatesRequests: false,
        bearerProtectedModeUnchanged: true,
        routeCount: routePlan.contracts.length,
        networkExposureSafe: false,
      };
    },
    handle(request) {
      const contract = contractForRoute(routePlan, request.routeId);
      const activationGate = evaluateBrowserAuthActivationGate({
        routeId: request.routeId,
        routeContract: contract,
        localOnlyMode: request.localOnlyMode,
        operatorConfirmationPresent: request.operatorConfirmationPresent ?? false,
      });

      return {
        ok: false,
        status: "inactive",
        httpStatus: 501,
        routeId: request.routeId,
        method: request.method ?? contract.method,
        path: request.path ?? contract.path,
        routeContractStatus: contract.status,
        error: {
          code: "browser_session_auth_inactive",
          reasonCode: "browser_auth_disabled_live_adapter_blocked",
          message: "Browser-session authentication is planned but not active.",
        },
        activationGate,
        headers: {},
        setCookieHeaders: [],
        betterAuthHandlerMounted: false,
        betterAuthHandlerCalled: false,
        internalAdapterWrapperCalled: false,
        setSessionCookieCalled: false,
        issuedCookies: false,
        acceptedCookies: false,
        parsedCookiesForAuthorization: false,
        issuedPairingCode: false,
        consumedPairingCode: false,
        issuedBrowserSession: false,
        createdBetterAuthSession: false,
        issuedCsrfToken: false,
        validatedCsrfToken: false,
        authenticatedRequest: false,
        liveAuthorizationDecision: false,
        changedBearerTokenProtectedMode: false,
        frontendStorageUsed: false,
        networkExposureSafe: false,
      };
    },
  };
}

function contractForRoute(
  routePlan: BrowserAuthRouteContractPlan,
  routeId: BrowserAuthDisabledLiveAdapterRouteId,
): BrowserAuthRouteContract {
  const contract = routePlan.contracts.find((candidate) => candidate.routeId === routeId);
  if (!contract) {
    throw new Error("Unknown browser-auth disabled-live route contract.");
  }
  return contract;
}
