import {
  PROTECTED_ROUTE_POLICIES,
  type ProtectedRoutePolicy,
  type RoutePolicyMethod,
} from "./routePermissions.js";

export type AuditRequirementOperation =
  | "auth-attempt"
  | "credential-created"
  | "credential-revoked"
  | "session-created"
  | "session-renewed"
  | "session-revoked"
  | "token-created"
  | "token-revoked"
  | "node-secret-rotated"
  | "vault-registered"
  | "vault-rebound"
  | "vault-removed"
  | "vault-permissions-changed"
  | "file-created"
  | "file-written"
  | "source-content-read"
  | "generated-index-read"
  | "conflict-overwritten"
  | "file-renamed"
  | "file-deleted"
  | "path-rejected"
  | "origin-rejected"
  | "csrf-rejected"
  | "authorization-denied"
  | "emergency-local-reset"
  | "remote-node-registered"
  | "remote-node-removed";

export type AuditRequirementStatus =
  "required" | "recommended" | "not-required" | "unsupported-operation" | "unknown-route";

export type AuditRequirementReasonCode =
  | "audit-required"
  | "audit-recommended"
  | "audit-not-required"
  | "auth-attempt"
  | "credential-lifecycle"
  | "session-lifecycle"
  | "token-lifecycle"
  | "node-secret-rotation"
  | "vault-lifecycle"
  | "vault-permission-change"
  | "source-mutation"
  | "source-content-read"
  | "generated-index-read"
  | "conflict-overwrite"
  | "security-rejection"
  | "authorization-denied"
  | "emergency-local-reset"
  | "remote-node-lifecycle"
  | "unsupported-operation"
  | "unknown-route";

export type AuditRequirementRequestShape = {
  method: RoutePolicyMethod;
  routePattern?: string;
  conflictOverwrite?: boolean;
};

export type AuditRequirementPlannerInput = {
  operation?: AuditRequirementOperation | string;
  request?: AuditRequirementRequestShape;
  routePolicy?: ProtectedRoutePolicy;
};

export type AuditRequirementPlan = {
  status: AuditRequirementStatus;
  auditRequired: boolean;
  operation?: AuditRequirementOperation;
  routePattern?: string;
  reasonCodes: readonly AuditRequirementReasonCode[];
  enforcementActive: false;
  protectedModeOperational: false;
  networkExposureSafe: false;
};

const requiredOperationReasons: Partial<
  Record<AuditRequirementOperation, readonly AuditRequirementReasonCode[]>
> = {
  "auth-attempt": ["audit-required", "auth-attempt"],
  "credential-created": ["audit-required", "credential-lifecycle"],
  "credential-revoked": ["audit-required", "credential-lifecycle"],
  "session-created": ["audit-required", "session-lifecycle"],
  "session-renewed": ["audit-required", "session-lifecycle"],
  "session-revoked": ["audit-required", "session-lifecycle"],
  "token-created": ["audit-required", "token-lifecycle"],
  "token-revoked": ["audit-required", "token-lifecycle"],
  "node-secret-rotated": ["audit-required", "node-secret-rotation"],
  "vault-registered": ["audit-required", "vault-lifecycle"],
  "vault-rebound": ["audit-required", "vault-lifecycle"],
  "vault-removed": ["audit-required", "vault-lifecycle"],
  "vault-permissions-changed": ["audit-required", "vault-permission-change"],
  "file-created": ["audit-required", "source-mutation"],
  "file-written": ["audit-required", "source-mutation"],
  "conflict-overwritten": ["audit-required", "source-mutation", "conflict-overwrite"],
  "file-renamed": ["audit-required", "source-mutation"],
  "file-deleted": ["audit-required", "source-mutation"],
  "path-rejected": ["audit-required", "security-rejection"],
  "origin-rejected": ["audit-required", "security-rejection"],
  "csrf-rejected": ["audit-required", "security-rejection"],
  "authorization-denied": ["audit-required", "authorization-denied"],
  "emergency-local-reset": ["audit-required", "emergency-local-reset"],
  "remote-node-registered": ["audit-required", "remote-node-lifecycle"],
  "remote-node-removed": ["audit-required", "remote-node-lifecycle"],
};

const recommendedOperationReasons: Partial<
  Record<AuditRequirementOperation, readonly AuditRequirementReasonCode[]>
> = {
  "source-content-read": ["audit-recommended", "source-content-read"],
};

const notRequiredOperationReasons: Partial<
  Record<AuditRequirementOperation, readonly AuditRequirementReasonCode[]>
> = {
  "generated-index-read": ["audit-not-required", "generated-index-read"],
};

export function planAuditRequirement(input: AuditRequirementPlannerInput): AuditRequirementPlan {
  const operationPlan = planOperation(input.operation);
  if (operationPlan) return operationPlan;

  if (input.operation !== undefined) {
    return basePlan({
      status: "unsupported-operation",
      auditRequired: false,
      reasonCodes: ["unsupported-operation"],
    });
  }

  const policy = input.routePolicy ?? policyFromRequest(input.request);
  if (!policy && input.request) {
    return basePlan({
      status: "unknown-route",
      auditRequired: false,
      reasonCodes: ["unknown-route"],
    });
  }

  if (input.request?.conflictOverwrite) {
    return basePlan({
      status: "required",
      auditRequired: true,
      operation: "conflict-overwritten",
      routePattern: policy?.routePattern ?? input.request.routePattern,
      reasonCodes: requiredOperationReasons["conflict-overwritten"] ?? ["audit-required"],
    });
  }

  const operation = policy ? operationFromPolicy(policy) : undefined;
  if (operation) return planOperation(operation, policy?.routePattern) ?? notRequired(policy);

  return policy ? notRequired(policy) : notRequired();
}

function planOperation(
  operation: AuditRequirementPlannerInput["operation"],
  routePattern?: string,
): AuditRequirementPlan | undefined {
  if (!isKnownOperation(operation)) return undefined;
  const requiredReasons = requiredOperationReasons[operation];
  if (requiredReasons) {
    return basePlan({
      status: "required",
      auditRequired: true,
      operation,
      routePattern,
      reasonCodes: requiredReasons,
    });
  }
  const recommendedReasons = recommendedOperationReasons[operation];
  if (recommendedReasons) {
    return basePlan({
      status: "recommended",
      auditRequired: false,
      operation,
      routePattern,
      reasonCodes: recommendedReasons,
    });
  }
  return basePlan({
    status: "not-required",
    auditRequired: false,
    operation,
    routePattern,
    reasonCodes: notRequiredOperationReasons[operation] ?? ["audit-not-required"],
  });
}

function policyFromRequest(
  request: AuditRequirementRequestShape | undefined,
): ProtectedRoutePolicy | undefined {
  if (!request?.routePattern) return undefined;
  return PROTECTED_ROUTE_POLICIES.find(
    (policy) => policy.method === request.method && policy.routePattern === request.routePattern,
  );
}

function operationFromPolicy(policy: ProtectedRoutePolicy): AuditRequirementOperation | undefined {
  switch (policy.category) {
    case "vaultRegistration":
      return "vault-registered";
    case "vaultRebind":
      return "vault-rebound";
    case "vaultRemoval":
      return "vault-removed";
    case "fileCreate":
      return "file-created";
    case "fileWrite":
      return "file-written";
    case "rename":
      return "file-renamed";
    case "fileDelete":
      return "file-deleted";
    case "fileRead":
      return "source-content-read";
    case "indexRead":
    case "indexFilters":
    case "indexSearch":
    case "indexInspect":
    case "fileListing":
    case "storageSummary":
    case "vaultRuntimeStatus":
    case "vaultListing":
      return "generated-index-read";
    default:
      return undefined;
  }
}

function notRequired(policy?: ProtectedRoutePolicy): AuditRequirementPlan {
  return basePlan({
    status: "not-required",
    auditRequired: false,
    routePattern: policy?.routePattern,
    reasonCodes: ["audit-not-required"],
  });
}

function basePlan(input: {
  status: AuditRequirementStatus;
  auditRequired: boolean;
  operation?: AuditRequirementOperation;
  routePattern?: string;
  reasonCodes: readonly AuditRequirementReasonCode[];
}): AuditRequirementPlan {
  return {
    status: input.status,
    auditRequired: input.auditRequired,
    operation: input.operation,
    routePattern: input.routePattern,
    reasonCodes: unique(input.reasonCodes),
    enforcementActive: false,
    protectedModeOperational: false,
    networkExposureSafe: false,
  };
}

function isKnownOperation(
  operation: AuditRequirementPlannerInput["operation"],
): operation is AuditRequirementOperation {
  return (
    typeof operation === "string" &&
    (operation in requiredOperationReasons ||
      operation in recommendedOperationReasons ||
      operation in notRequiredOperationReasons)
  );
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}
