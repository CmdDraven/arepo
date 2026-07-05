import type { BrowserAuthAuditCategory } from "./browserAuthAuditEvents.js";
import type { BrowserAuthActivationPreflightBlockerCode } from "./browserAuthActivationPreflight.js";
import type { RoutePolicyMethod } from "./routePermissions.js";

export const BROWSER_AUTH_ROUTE_CONTRACTS_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_ROUTE_CONTRACTS_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_ROUTE_CONTRACTS_WIRED_INTO_ROUTES = false;

export type BrowserAuthRouteContractStatus = "stubbed" | "planned-inactive";

export type BrowserAuthRouteContract = {
  routeId: string;
  method: RoutePolicyMethod;
  path: string;
  status: BrowserAuthRouteContractStatus;
  mountedLive: false;
  issuesCookies: false;
  acceptsCookies: false;
  futureRequiresBrowserSessionAuth: boolean;
  futureRequiresCsrf: boolean;
  futureRequiresPairingCodeVerification: boolean;
  bearerTokenAuthorizationCurrent: true;
  sanitizedFailureBehavior: "browser_session_auth_inactive" | "not_mounted";
  futureAuditCategory?: BrowserAuthAuditCategory;
  activationBlockerCodes: readonly BrowserAuthActivationPreflightBlockerCode[];
  networkExposureSafe: false;
};

export type BrowserAuthRouteContractSummary = {
  status: "planning-only";
  totalPlannedRouteCount: number;
  stubbedRouteCount: number;
  plannedInactiveRouteCount: number;
  mountedLiveRouteCount: 0;
  issuingCookieRouteCount: 0;
  acceptingCookieRouteCount: 0;
  futureCsrfRequiredRouteCount: number;
  futureBrowserSessionAuthRequiredRouteCount: number;
  futurePairingCodeVerificationRouteCount: number;
  bearerTokenAuthorizationCurrent: true;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  networkExposureSafe: false;
};

export type BrowserAuthRouteContractPlan = {
  status: "planning-only";
  contracts: readonly BrowserAuthRouteContract[];
  summary: BrowserAuthRouteContractSummary;
  networkExposureSafe: false;
};

const commonBlockers: readonly BrowserAuthActivationPreflightBlockerCode[] = [
  "browser-auth-route-mounting-blocked",
  "browser-auth-cookie-credentials-not-accepted",
  "browser-auth-csrf-enforcement-inactive",
  "browser-auth-live-cookie-issuance-inactive",
];

export function planBrowserAuthRouteContracts(): BrowserAuthRouteContractPlan {
  const contracts: readonly BrowserAuthRouteContract[] = [
    contract({
      routeId: "browser-pairing-start",
      method: "POST",
      path: "/api/node/auth/pairing/start",
      status: "stubbed",
      futureRequiresCsrf: true,
      futureRequiresPairingCodeVerification: false,
      futureAuditCategory: "pairing_code_issue_planned",
      blockers: ["browser-auth-pairing-routes-stubbed"],
    }),
    contract({
      routeId: "browser-pairing-complete",
      method: "POST",
      path: "/api/node/auth/pairing/complete",
      status: "stubbed",
      futureRequiresCsrf: true,
      futureRequiresPairingCodeVerification: true,
      futureAuditCategory: "pairing_code_consume_planned",
      blockers: ["browser-auth-pairing-routes-stubbed"],
    }),
    contract({
      routeId: "browser-session-issue",
      method: "POST",
      path: "/api/node/auth/session",
      status: "stubbed",
      futureRequiresCsrf: true,
      futureRequiresPairingCodeVerification: true,
      futureAuditCategory: "session_issue_planned",
      blockers: ["browser-auth-session-routes-stubbed"],
    }),
    contract({
      routeId: "browser-session-status",
      method: "GET",
      path: "/api/node/auth/session",
      status: "planned-inactive",
      futureRequiresBrowserSessionAuth: true,
      futureRequiresCsrf: false,
      futureAuditCategory: "browser_auth_inactive",
      blockers: ["browser-auth-session-routes-stubbed"],
      sanitizedFailureBehavior: "not_mounted",
    }),
    contract({
      routeId: "browser-csrf-issue",
      method: "GET",
      path: "/api/node/auth/csrf",
      status: "stubbed",
      futureRequiresBrowserSessionAuth: true,
      futureRequiresCsrf: false,
      futureAuditCategory: "csrf_issue_planned",
      blockers: ["browser-auth-csrf-endpoint-stubbed"],
    }),
    contract({
      routeId: "browser-session-logout",
      method: "POST",
      path: "/api/node/auth/session/logout",
      status: "stubbed",
      futureRequiresBrowserSessionAuth: true,
      futureRequiresCsrf: true,
      futureAuditCategory: "session_logout_planned",
      blockers: ["browser-auth-session-routes-stubbed"],
    }),
    contract({
      routeId: "browser-session-revoke-current",
      method: "POST",
      path: "/api/node/auth/session/revoke-current",
      status: "planned-inactive",
      futureRequiresBrowserSessionAuth: true,
      futureRequiresCsrf: true,
      futureAuditCategory: "session_revoke_planned",
      blockers: ["browser-auth-session-routes-stubbed"],
      sanitizedFailureBehavior: "not_mounted",
    }),
    contract({
      routeId: "browser-session-revoke-all",
      method: "POST",
      path: "/api/node/auth/session/revoke-all",
      status: "stubbed",
      futureRequiresBrowserSessionAuth: true,
      futureRequiresCsrf: true,
      futureAuditCategory: "session_revoke_planned",
      blockers: ["browser-auth-session-routes-stubbed"],
    }),
  ];
  return {
    status: "planning-only",
    contracts,
    summary: summarizeBrowserAuthRouteContracts(contracts),
    networkExposureSafe: false,
  };
}

export function summarizeBrowserAuthRouteContracts(
  contracts: readonly BrowserAuthRouteContract[],
): BrowserAuthRouteContractSummary {
  return {
    status: "planning-only",
    totalPlannedRouteCount: contracts.length,
    stubbedRouteCount: contracts.filter((route) => route.status === "stubbed").length,
    plannedInactiveRouteCount: contracts.filter((route) => route.status === "planned-inactive")
      .length,
    mountedLiveRouteCount: 0,
    issuingCookieRouteCount: 0,
    acceptingCookieRouteCount: 0,
    futureCsrfRequiredRouteCount: contracts.filter((route) => route.futureRequiresCsrf).length,
    futureBrowserSessionAuthRequiredRouteCount: contracts.filter(
      (route) => route.futureRequiresBrowserSessionAuth,
    ).length,
    futurePairingCodeVerificationRouteCount: contracts.filter(
      (route) => route.futureRequiresPairingCodeVerification,
    ).length,
    bearerTokenAuthorizationCurrent: true,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    networkExposureSafe: false,
  };
}

function contract(input: {
  routeId: string;
  method: RoutePolicyMethod;
  path: string;
  status: BrowserAuthRouteContractStatus;
  futureRequiresBrowserSessionAuth?: boolean;
  futureRequiresCsrf: boolean;
  futureRequiresPairingCodeVerification?: boolean;
  futureAuditCategory?: BrowserAuthAuditCategory;
  blockers: readonly BrowserAuthActivationPreflightBlockerCode[];
  sanitizedFailureBehavior?: BrowserAuthRouteContract["sanitizedFailureBehavior"];
}): BrowserAuthRouteContract {
  return {
    routeId: input.routeId,
    method: input.method,
    path: input.path,
    status: input.status,
    mountedLive: false,
    issuesCookies: false,
    acceptsCookies: false,
    futureRequiresBrowserSessionAuth: input.futureRequiresBrowserSessionAuth ?? false,
    futureRequiresCsrf: input.futureRequiresCsrf,
    futureRequiresPairingCodeVerification: input.futureRequiresPairingCodeVerification ?? false,
    bearerTokenAuthorizationCurrent: true,
    sanitizedFailureBehavior: input.sanitizedFailureBehavior ?? "browser_session_auth_inactive",
    futureAuditCategory: input.futureAuditCategory,
    activationBlockerCodes: [...commonBlockers, ...input.blockers],
    networkExposureSafe: false,
  };
}
