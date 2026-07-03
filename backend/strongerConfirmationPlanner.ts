import {
  PROTECTED_ROUTE_POLICIES,
  type ProtectedRoutePolicy,
  type RoutePolicyMethod,
  type StrongerConfirmation,
} from "./routePermissions.js";

export type StrongerConfirmationOperation =
  | "delete-source-file"
  | "overwrite-conflict"
  | "register-vault"
  | "remove-vault"
  | "change-vault-permissions"
  | "change-auth-mode"
  | "create-credential"
  | "revoke-credential"
  | "rotate-node-secret"
  | "emergency-local-reset"
  | "register-remote-node"
  | "remove-remote-node";

export type StrongerConfirmationPlanStatus =
  "not-required" | "required" | "unsupported-operation" | "unknown-route";

export type StrongerConfirmationReasonCode =
  | "stronger-confirmation-not-required"
  | "stronger-confirmation-required"
  | "delete-source-file"
  | "overwrite-conflict"
  | "vault-registration"
  | "vault-removal"
  | "vault-permission-change"
  | "auth-mode-change"
  | "credential-creation"
  | "credential-revocation"
  | "node-secret-rotation"
  | "emergency-local-reset"
  | "remote-node-registration"
  | "remote-node-removal"
  | "route-requires-confirmation"
  | "unsupported-operation"
  | "unknown-route";

export type StrongerConfirmationRequestShape = {
  method: RoutePolicyMethod;
  routePattern?: string;
  overwriteAfterConflict?: boolean;
};

export type StrongerConfirmationPlannerInput = {
  operation?: StrongerConfirmationOperation | string;
  request?: StrongerConfirmationRequestShape;
  routePolicy?: ProtectedRoutePolicy;
};

export type StrongerConfirmationPlan = {
  status: StrongerConfirmationPlanStatus;
  confirmationRequired: boolean;
  operation?: StrongerConfirmationOperation;
  routePattern?: string;
  requiredConfirmation: readonly StrongerConfirmation[];
  reasonCodes: readonly StrongerConfirmationReasonCode[];
  enforcementActive: false;
  protectedModeOperational: false;
  networkExposureSafe: false;
};

const operationReasons: Record<
  StrongerConfirmationOperation,
  readonly StrongerConfirmationReasonCode[]
> = {
  "delete-source-file": ["stronger-confirmation-required", "delete-source-file"],
  "overwrite-conflict": ["stronger-confirmation-required", "overwrite-conflict"],
  "register-vault": ["stronger-confirmation-required", "vault-registration"],
  "remove-vault": ["stronger-confirmation-required", "vault-removal"],
  "change-vault-permissions": ["stronger-confirmation-required", "vault-permission-change"],
  "change-auth-mode": ["stronger-confirmation-required", "auth-mode-change"],
  "create-credential": ["stronger-confirmation-required", "credential-creation"],
  "revoke-credential": ["stronger-confirmation-required", "credential-revocation"],
  "rotate-node-secret": ["stronger-confirmation-required", "node-secret-rotation"],
  "emergency-local-reset": ["stronger-confirmation-required", "emergency-local-reset"],
  "register-remote-node": ["stronger-confirmation-required", "remote-node-registration"],
  "remove-remote-node": ["stronger-confirmation-required", "remote-node-removal"],
};

const operationConfirmations: Partial<
  Record<StrongerConfirmationOperation, readonly StrongerConfirmation[]>
> = {
  "delete-source-file": ["delete"],
  "overwrite-conflict": ["conflictOverwrite"],
  "register-vault": ["vaultRegistration"],
  "remove-vault": ["vaultRemoval"],
  "change-vault-permissions": ["vaultRegistration"],
  "change-auth-mode": ["authChange"],
  "create-credential": ["authChange"],
  "revoke-credential": ["tokenRevocation"],
  "rotate-node-secret": ["authChange"],
  "emergency-local-reset": ["authChange"],
  "register-remote-node": ["authChange"],
  "remove-remote-node": ["authChange"],
};

export function planStrongerConfirmation(
  input: StrongerConfirmationPlannerInput,
): StrongerConfirmationPlan {
  const operationPlan = planOperation(input.operation);
  if (operationPlan) return operationPlan;

  if (input.operation !== undefined) {
    return basePlan({
      status: "unsupported-operation",
      confirmationRequired: false,
      requiredConfirmation: [],
      reasonCodes: ["unsupported-operation"],
    });
  }

  const policy = input.routePolicy ?? policyFromRequest(input.request);
  if (!policy && input.request) {
    return basePlan({
      status: "unknown-route",
      confirmationRequired: false,
      requiredConfirmation: [],
      reasonCodes: ["unknown-route"],
    });
  }

  if (input.request?.overwriteAfterConflict) {
    return basePlan({
      status: "required",
      confirmationRequired: true,
      operation: "overwrite-conflict",
      routePattern: policy?.routePattern ?? input.request.routePattern,
      requiredConfirmation: ["conflictOverwrite"],
      reasonCodes: operationReasons["overwrite-conflict"],
    });
  }

  if (policy?.strongerConfirmation.length) {
    return basePlan({
      status: "required",
      confirmationRequired: true,
      operation: operationFromPolicy(policy),
      routePattern: policy.routePattern,
      requiredConfirmation: policy.strongerConfirmation,
      reasonCodes: unique(["stronger-confirmation-required", "route-requires-confirmation"]),
    });
  }

  return basePlan({
    status: "not-required",
    confirmationRequired: false,
    routePattern: policy?.routePattern ?? input.request?.routePattern,
    requiredConfirmation: [],
    reasonCodes: ["stronger-confirmation-not-required"],
  });
}

function planOperation(operation: StrongerConfirmationPlannerInput["operation"]) {
  if (!isKnownOperation(operation)) return undefined;
  return basePlan({
    status: "required",
    confirmationRequired: true,
    operation,
    requiredConfirmation: operationConfirmations[operation] ?? ["authChange"],
    reasonCodes: operationReasons[operation],
  });
}

function policyFromRequest(
  request: StrongerConfirmationRequestShape | undefined,
): ProtectedRoutePolicy | undefined {
  if (!request?.routePattern) return undefined;
  return PROTECTED_ROUTE_POLICIES.find(
    (policy) => policy.method === request.method && policy.routePattern === request.routePattern,
  );
}

function operationFromPolicy(
  policy: ProtectedRoutePolicy,
): StrongerConfirmationOperation | undefined {
  if (policy.routePattern === "/api/vaults" && policy.method === "POST") return "register-vault";
  if (policy.routePattern === "/api/vaults/:vaultId" && policy.method === "DELETE") {
    return "remove-vault";
  }
  if (policy.routePattern === "/api/vaults/:vaultId/file?path=..." && policy.method === "DELETE") {
    return "delete-source-file";
  }
  if (policy.routePattern === "/api/vaults/:vaultId/file?path=..." && policy.method === "PUT") {
    return "overwrite-conflict";
  }
  return undefined;
}

function basePlan(input: {
  status: StrongerConfirmationPlanStatus;
  confirmationRequired: boolean;
  operation?: StrongerConfirmationOperation;
  routePattern?: string;
  requiredConfirmation: readonly StrongerConfirmation[];
  reasonCodes: readonly StrongerConfirmationReasonCode[];
}): StrongerConfirmationPlan {
  return {
    status: input.status,
    confirmationRequired: input.confirmationRequired,
    operation: input.operation,
    routePattern: input.routePattern,
    requiredConfirmation: input.requiredConfirmation,
    reasonCodes: unique(input.reasonCodes),
    enforcementActive: false,
    protectedModeOperational: false,
    networkExposureSafe: false,
  };
}

function isKnownOperation(
  operation: StrongerConfirmationPlannerInput["operation"],
): operation is StrongerConfirmationOperation {
  return typeof operation === "string" && operation in operationReasons;
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}
