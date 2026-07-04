import type { BrowserSecurityFailureReason } from "./browserSecurityPolicy.js";
import type { ProtectedRequestPipelineResult } from "./protectedRequestPipeline.js";
import type {
  RequestAuthorizationDecision,
  RequestAuthorizationReasonCode,
} from "./requestAuthorizationPlanner.js";
import type { StrongerConfirmation } from "./routePermissions.js";

export type ProtectedResponsePlanKind =
  | "allow"
  | "reduced-anonymous"
  | "unauthenticated"
  | "unauthorized"
  | "csrf-required"
  | "origin-rejected"
  | "stronger-confirmation-required"
  | "not-found-or-unknown-route"
  | "service-unavailable-or-not-ready";

export type ProtectedResponseStatusHint = 200 | 401 | 403 | 404 | 428 | 503;

export type ProtectedResponsePlannerInput = {
  pipelineResult?: ProtectedRequestPipelineResult;
  decision?: RequestAuthorizationDecision;
  protectedModeReady?: boolean;
};

export type ProtectedResponsePlanBody = {
  ok: boolean;
  reasonCode: string;
  reasonCodes: readonly string[];
  authRequired: boolean;
  authorizationRequired: boolean;
  csrfRequired: boolean;
  originRejected: boolean;
  confirmationRequired: boolean;
  requiredConfirmation: readonly StrongerConfirmation[];
  protectedModeOperational: false;
  enforcementActive: false;
  networkExposureSafe: false;
};

export type ProtectedResponsePlan = {
  kind: ProtectedResponsePlanKind;
  httpStatus: ProtectedResponseStatusHint;
  body: ProtectedResponsePlanBody;
  enforcementActive: false;
  networkExposureSafe: false;
};

export function planProtectedResponse(input: ProtectedResponsePlannerInput): ProtectedResponsePlan {
  const decision = input.pipelineResult?.decision ?? input.decision;
  const storeNotReady = input.pipelineResult?.storeLoad.status === "failed";

  if (input.protectedModeReady === false || storeNotReady || !decision) {
    return responsePlan({
      kind: "service-unavailable-or-not-ready",
      httpStatus: 503,
      reasonCode: "protected-mode-not-ready",
      reasonCodes: ["protected-mode-not-ready"],
    });
  }

  const browserFailures = decision.browserSecurityPlan.failureReasons;
  const reasonCodes = sanitizedReasonCodes(decision.reasonCodes, browserFailures);

  if (decision.reasonCodes.includes("route-not-found")) {
    return responsePlan({
      kind: "not-found-or-unknown-route",
      httpStatus: 404,
      reasonCode: "route-not-found",
      reasonCodes,
      decision,
    });
  }

  if (decision.anonymousReduced) {
    return responsePlan({
      kind: "reduced-anonymous",
      httpStatus: 200,
      reasonCode: "anonymous-reduced",
      reasonCodes,
      decision,
    });
  }

  if (browserFailures.includes("missing-origin") || browserFailures.includes("untrusted-origin")) {
    return responsePlan({
      kind: "origin-rejected",
      httpStatus: 403,
      reasonCode: browserFailures.includes("untrusted-origin")
        ? "untrusted-origin"
        : "missing-origin",
      reasonCodes,
      decision,
    });
  }

  if (browserFailures.includes("failed-csrf")) {
    return responsePlan({
      kind: "csrf-required",
      httpStatus: 403,
      reasonCode: "failed-csrf",
      reasonCodes,
      decision,
    });
  }

  const credentialNotVerified = decision.credentialResult.status !== "verified";
  if (credentialNotVerified) {
    return responsePlan({
      kind: "unauthenticated",
      httpStatus: 401,
      reasonCode:
        decision.reasonCodes.find((reason) =>
          ["malformed-credential", "requires-authentication"].includes(reason),
        ) ?? decision.credentialResult.reasonCode,
      reasonCodes,
      decision,
    });
  }

  if (decision.requiresStrongerConfirmation) {
    return responsePlan({
      kind: "stronger-confirmation-required",
      httpStatus: 428,
      reasonCode: "requires-stronger-confirmation",
      reasonCodes,
      decision,
    });
  }

  if (decision.reasonCodes.includes("requires-authorization")) {
    return responsePlan({
      kind: "unauthorized",
      httpStatus: 403,
      reasonCode: "requires-authorization",
      reasonCodes,
      decision,
    });
  }

  if (decision.wouldAllow) {
    return responsePlan({
      kind: "allow",
      httpStatus: 200,
      reasonCode: "planned-allow",
      reasonCodes,
      decision,
    });
  }

  return responsePlan({
    kind: "unauthorized",
    httpStatus: 403,
    reasonCode: reasonCodes[0] ?? "planned-deny",
    reasonCodes,
    decision,
  });
}

function responsePlan(input: {
  kind: ProtectedResponsePlanKind;
  httpStatus: ProtectedResponseStatusHint;
  reasonCode: string;
  reasonCodes: readonly string[];
  decision?: RequestAuthorizationDecision;
}): ProtectedResponsePlan {
  return {
    kind: input.kind,
    httpStatus: input.httpStatus,
    body: {
      ok: input.kind === "allow" || input.kind === "reduced-anonymous",
      reasonCode: input.reasonCode,
      reasonCodes: input.reasonCodes,
      authRequired: input.decision?.requiresAuthentication ?? input.kind === "unauthenticated",
      authorizationRequired: input.decision?.requiresAuthorization ?? input.kind === "unauthorized",
      csrfRequired: input.decision?.requiresCsrf ?? input.kind === "csrf-required",
      originRejected: input.kind === "origin-rejected",
      confirmationRequired:
        input.decision?.requiresStrongerConfirmation ??
        input.kind === "stronger-confirmation-required",
      requiredConfirmation: input.decision?.requiredConfirmation ?? [],
      protectedModeOperational: false,
      enforcementActive: false,
      networkExposureSafe: false,
    },
    enforcementActive: false,
    networkExposureSafe: false,
  };
}

function sanitizedReasonCodes(
  reasonCodes: readonly RequestAuthorizationReasonCode[],
  browserFailures: readonly BrowserSecurityFailureReason[],
): readonly string[] {
  return Array.from(new Set([...reasonCodes, ...browserFailures]));
}
