import {
  evaluateBrowserAuthActivationGate,
  type BrowserAuthActivationGateDecision,
  type BrowserAuthActivationGateInput,
} from "./browserAuthActivationGate.js";
import {
  planBrowserAuthTestOnlyClearCookies,
  planBrowserAuthTestOnlyIssueCookies,
  type BrowserAuthCookieClearingPlan,
  type BrowserAuthCookieSerializationPlan,
} from "./browserAuthCookieSerialization.js";
import {
  planBrowserAuthRouteContracts,
  type BrowserAuthRouteContract,
  type BrowserAuthRouteContractPlan,
} from "./browserAuthRouteContracts.js";
import type { BrowserAuthLifecycleCoordinator } from "./browserAuthLifecycleCoordinator.js";
import type { PublicBrowserSessionSummary } from "./browserSessionStore.js";
import type { BrowserAuthTestOnlyActivationAllowance } from "./browserAuthTestOnlyActivation.js";

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
  testOnlyActivation?: BrowserAuthTestOnlyActivationAllowance;
  subjectId?: string;
  deviceLabel?: string;
  originHint?: string;
  pairingCodeId?: string;
  pairingCodeSecret?: string;
  sessionId?: string;
  sessionVerifierSecret?: string;
  csrfTokenId?: string;
  csrfTokenSecret?: string;
  revokeSubjectId?: string;
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

export type BrowserAuthRouteHarnessTestOnlyResult =
  BrowserAuthRouteHarnessTestOnlySuccess | BrowserAuthRouteHarnessTestOnlyFailure;

export type BrowserAuthRouteHarnessTestOnlySuccess = {
  ok: true;
  status: "test-only-active";
  httpStatus: 200;
  routeId: BrowserAuthHarnessRouteId;
  method: string;
  path: string;
  routeContractStatus: BrowserAuthRouteContract["status"];
  activationGate: BrowserAuthActivationGateDecision;
  headers: Record<string, never>;
  setCookieHeaders: readonly [];
  issuedCookies: false;
  acceptedCookies: false;
  authenticatedRequest: false;
  liveAuthorizationDecision: false;
  lifecycleCoordinatorCalled: true;
  networkExposureSafe: false;
  result:
    | {
        operation: "pairing-start";
        pairingCodeId: string;
        pairingCodeSecret: string;
        expiresAtMs: number;
      }
    | {
        operation: "pairing-complete" | "session-issue";
        sessionId: string;
        subjectId: string;
        sessionVerifierSecret: string;
        sessionExpiresAtMs: number;
        csrfTokenId: string;
        csrfTokenSecret: string;
        csrfExpiresAtMs: number;
        plannedCookieOutput: BrowserAuthCookieSerializationPlan;
      }
    | {
        operation: "csrf-issue";
        csrfTokenId: string;
        sessionId: string;
        csrfTokenSecret: string;
        expiresAtMs: number;
      }
    | {
        operation: "session-status";
        session: PublicBrowserSessionSummary | null;
      }
    | {
        operation: "logout" | "revoke-current-session";
        sessionId: string;
        revokedSession: boolean;
        revokedCsrfTokenCount: number;
        plannedCookieClearing: BrowserAuthCookieClearingPlan;
      }
    | {
        operation: "revoke-all-sessions";
        subjectId: string;
        revokedSessionCount: number;
        revokedCsrfTokenCount: number;
        plannedCookieClearing: BrowserAuthCookieClearingPlan;
      };
};

export type BrowserAuthRouteHarnessTestOnlyFailure = {
  ok: false;
  status: "test-only-rejected";
  httpStatus: 400;
  routeId: BrowserAuthHarnessRouteId;
  method: string;
  path: string;
  routeContractStatus: BrowserAuthRouteContract["status"];
  activationGate: BrowserAuthActivationGateDecision;
  error: {
    code:
      | "test_only_lifecycle_unavailable"
      | "test_only_missing_pairing_code"
      | "test_only_missing_session"
      | "test_only_pairing_rejected"
      | "test_only_session_rejected"
      | "test_only_csrf_rejected";
    reason: string;
  };
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
  lifecycleCoordinatorCalled: boolean;
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
  handle(
    request: BrowserAuthRouteHarnessRequest,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult;
  pairingStart(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult;
  pairingComplete(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult;
  sessionIssue(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult;
  sessionStatus(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult;
  csrfIssue(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult;
  logout(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult;
  revokeCurrentSession(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult;
  revokeAllSessions(
    input?: Omit<BrowserAuthRouteHarnessRequest, "routeId">,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult;
};

export function createBrowserAuthRouteHarness(
  options: {
    routePlan?: BrowserAuthRouteContractPlan;
    lifecycleCoordinator?: BrowserAuthLifecycleCoordinator;
  } = {},
): BrowserAuthRouteHarness {
  const routePlan = options.routePlan ?? planBrowserAuthRouteContracts();

  function handle(
    request: BrowserAuthRouteHarnessRequest,
  ): BrowserAuthRouteHarnessResult | BrowserAuthRouteHarnessTestOnlyResult {
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
      testOnlyActivation: request.testOnlyActivation,
    });

    if (activationGate.allowed) {
      return activeTestOnlyResult({
        request,
        contract,
        activationGate,
        coordinator: options.lifecycleCoordinator,
      });
    }

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

function activeTestOnlyResult(input: {
  request: BrowserAuthRouteHarnessRequest;
  contract: BrowserAuthRouteContract;
  activationGate: BrowserAuthActivationGateDecision;
  coordinator: BrowserAuthLifecycleCoordinator | undefined;
}): BrowserAuthRouteHarnessTestOnlyResult {
  if (!input.coordinator) {
    return testOnlyFailure(input, "test_only_lifecycle_unavailable", "missing-coordinator", false);
  }
  switch (input.request.routeId) {
    case "browser-pairing-start": {
      const created = input.coordinator.createPairingCode({
        subjectId: input.request.subjectId ?? "local-operator",
        deviceLabel: input.request.deviceLabel,
        originHint: input.request.originHint,
        pairingCodeId: input.request.pairingCodeId,
        pairingCodeSecret: input.request.pairingCodeSecret,
      });
      return testOnlySuccess(input, {
        operation: "pairing-start",
        pairingCodeId: created.pairingCodeId,
        pairingCodeSecret: created.pairingCodeSecret,
        expiresAtMs: created.expiresAtMs,
      });
    }
    case "browser-pairing-complete":
    case "browser-session-issue": {
      if (!input.request.pairingCodeId || !input.request.pairingCodeSecret) {
        return testOnlyFailure(input, "test_only_missing_pairing_code", "missing-code", false);
      }
      const session = input.coordinator.createSessionFromPairingCode({
        pairingCodeId: input.request.pairingCodeId,
        pairingCodeSecret: input.request.pairingCodeSecret,
        sessionId: input.request.sessionId,
        sessionVerifierSecret: input.request.sessionVerifierSecret,
        originHint: input.request.originHint,
      });
      if (!session.ok) {
        return testOnlyFailure(input, "test_only_pairing_rejected", session.reason, true);
      }
      const csrf = input.coordinator.createCsrfTokenForSession({
        sessionId: session.sessionId,
        csrfTokenId: input.request.csrfTokenId,
        csrfTokenSecret: input.request.csrfTokenSecret,
        originHint: input.request.originHint,
      });
      if (!csrf.ok) return testOnlyFailure(input, "test_only_csrf_rejected", csrf.reason, true);
      return testOnlySuccess(input, {
        operation:
          input.request.routeId === "browser-pairing-complete"
            ? "pairing-complete"
            : "session-issue",
        sessionId: session.sessionId,
        subjectId: session.subjectId,
        sessionVerifierSecret: session.sessionVerifierSecret,
        sessionExpiresAtMs: session.expiresAtMs,
        csrfTokenId: csrf.csrfTokenId,
        csrfTokenSecret: csrf.csrfTokenSecret,
        csrfExpiresAtMs: csrf.expiresAtMs,
        plannedCookieOutput: planBrowserAuthTestOnlyIssueCookies({
          sessionId: session.sessionId,
          sessionVerifierSecret: session.sessionVerifierSecret,
          csrfTokenId: csrf.csrfTokenId,
          csrfTokenSecret: csrf.csrfTokenSecret,
          localDevelopment: input.request.localOnlyMode ?? true,
        }),
      });
    }
    case "browser-csrf-issue": {
      if (!input.request.sessionId) {
        return testOnlyFailure(input, "test_only_missing_session", "missing-session", false);
      }
      const csrf = input.coordinator.createCsrfTokenForSession({
        sessionId: input.request.sessionId,
        csrfTokenId: input.request.csrfTokenId,
        csrfTokenSecret: input.request.csrfTokenSecret,
        originHint: input.request.originHint,
      });
      if (!csrf.ok) return testOnlyFailure(input, "test_only_csrf_rejected", csrf.reason, true);
      return testOnlySuccess(input, {
        operation: "csrf-issue",
        csrfTokenId: csrf.csrfTokenId,
        sessionId: csrf.sessionId,
        csrfTokenSecret: csrf.csrfTokenSecret,
        expiresAtMs: csrf.expiresAtMs,
      });
    }
    case "browser-session-status": {
      const session = input.request.sessionId
        ? (input.coordinator.stores.sessions
            .listPublicSummaries()
            .find((candidate) => candidate.sessionId === input.request.sessionId) ?? null)
        : null;
      return testOnlySuccess(input, { operation: "session-status", session });
    }
    case "browser-session-logout":
    case "browser-session-revoke-current": {
      if (!input.request.sessionId) {
        return testOnlyFailure(input, "test_only_missing_session", "missing-session", false);
      }
      const revoked = input.coordinator.revokeSession(input.request.sessionId);
      return testOnlySuccess(input, {
        operation:
          input.request.routeId === "browser-session-logout" ? "logout" : "revoke-current-session",
        sessionId: input.request.sessionId,
        revokedSession: revoked.revokedSession,
        revokedCsrfTokenCount: revoked.revokedCsrfTokenCount,
        plannedCookieClearing: planBrowserAuthTestOnlyClearCookies({
          localDevelopment: input.request.localOnlyMode ?? true,
        }),
      });
    }
    case "browser-session-revoke-all": {
      const subjectId = input.request.revokeSubjectId ?? input.request.subjectId;
      if (!subjectId)
        return testOnlyFailure(input, "test_only_missing_session", "missing-subject", false);
      const revoked = input.coordinator.revokeAllSessionsForSubject(subjectId);
      return testOnlySuccess(input, {
        operation: "revoke-all-sessions",
        subjectId,
        revokedSessionCount: revoked.revokedSessionCount,
        revokedCsrfTokenCount: revoked.revokedCsrfTokenCount,
        plannedCookieClearing: planBrowserAuthTestOnlyClearCookies({
          localDevelopment: input.request.localOnlyMode ?? true,
        }),
      });
    }
  }
}

function testOnlySuccess(
  input: {
    request: BrowserAuthRouteHarnessRequest;
    contract: BrowserAuthRouteContract;
    activationGate: BrowserAuthActivationGateDecision;
  },
  result: BrowserAuthRouteHarnessTestOnlySuccess["result"],
): BrowserAuthRouteHarnessTestOnlySuccess {
  return {
    ok: true,
    status: "test-only-active",
    httpStatus: 200,
    routeId: input.request.routeId,
    method: input.request.method ?? input.contract.method,
    path: input.request.path ?? input.contract.path,
    routeContractStatus: input.contract.status,
    activationGate: input.activationGate,
    headers: {},
    setCookieHeaders: [],
    issuedCookies: false,
    acceptedCookies: false,
    authenticatedRequest: false,
    liveAuthorizationDecision: false,
    lifecycleCoordinatorCalled: true,
    networkExposureSafe: false,
    result,
  };
}

function testOnlyFailure(
  input: {
    request: BrowserAuthRouteHarnessRequest;
    contract: BrowserAuthRouteContract;
    activationGate: BrowserAuthActivationGateDecision;
  },
  code: BrowserAuthRouteHarnessTestOnlyFailure["error"]["code"],
  reason: string,
  lifecycleCoordinatorCalled: boolean,
): BrowserAuthRouteHarnessTestOnlyFailure {
  return {
    ok: false,
    status: "test-only-rejected",
    httpStatus: 400,
    routeId: input.request.routeId,
    method: input.request.method ?? input.contract.method,
    path: input.request.path ?? input.contract.path,
    routeContractStatus: input.contract.status,
    activationGate: input.activationGate,
    error: { code, reason },
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
    lifecycleCoordinatorCalled,
    networkExposureSafe: false,
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
