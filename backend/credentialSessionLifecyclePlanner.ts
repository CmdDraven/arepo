export type CredentialSessionLifecycleOperation =
  | "create-local-admin-credential"
  | "create-user-credential"
  | "rotate-credential-secret"
  | "verify-credential"
  | "revoke-credential"
  | "create-browser-session"
  | "renew-browser-session"
  | "revoke-browser-session"
  | "create-api-token"
  | "rotate-api-token"
  | "revoke-api-token"
  | "revoke-all-for-actor"
  | "emergency-revoke-all";

export type CredentialSessionLifecyclePlanResult =
  | "allowed-by-design"
  | "requires-stronger-confirmation"
  | "requires-audit"
  | "requires-expiry"
  | "requires-revocation-check"
  | "requires-origin-csrf-guard"
  | "unsupported-operation"
  | "not-implemented";

export type CredentialSessionLifecycleRequirementCode =
  | "planning-only"
  | "stronger-confirmation-required"
  | "audit-required"
  | "expiry-required"
  | "revocation-check-required"
  | "origin-csrf-guard-required"
  | "secure-cookie-policy-required"
  | "verifier-availability-required"
  | "sanitized-failure-handling-required"
  | "long-lived-token-classification-required"
  | "local-only-safety-required"
  | "credential-creation"
  | "credential-rotation"
  | "credential-verification"
  | "credential-revocation"
  | "browser-session-creation"
  | "browser-session-renewal"
  | "browser-session-revocation"
  | "api-token-creation"
  | "api-token-rotation"
  | "api-token-revocation"
  | "revoke-all"
  | "emergency-revoke-all"
  | "unsupported-operation";

export type CredentialSessionLifecyclePlannerInput = {
  operation: CredentialSessionLifecycleOperation | string;
};

export type CredentialSessionLifecyclePlan = {
  operation?: CredentialSessionLifecycleOperation;
  results: readonly CredentialSessionLifecyclePlanResult[];
  requirementCodes: readonly CredentialSessionLifecycleRequirementCode[];
  createsCredential: false;
  createsSession: false;
  createsToken: false;
  setsCookie: false;
  enforcementActive: false;
  protectedModeOperational: false;
  networkExposureSafe: false;
};

const credentialCreationCodes = [
  "planning-only",
  "credential-creation",
  "stronger-confirmation-required",
  "audit-required",
  "revocation-check-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

const credentialRotationCodes = [
  "planning-only",
  "credential-rotation",
  "stronger-confirmation-required",
  "audit-required",
  "revocation-check-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

const credentialVerificationCodes = [
  "planning-only",
  "credential-verification",
  "verifier-availability-required",
  "revocation-check-required",
  "sanitized-failure-handling-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

const credentialRevocationCodes = [
  "planning-only",
  "credential-revocation",
  "stronger-confirmation-required",
  "audit-required",
  "revocation-check-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

const browserSessionCreationCodes = [
  "planning-only",
  "browser-session-creation",
  "secure-cookie-policy-required",
  "expiry-required",
  "revocation-check-required",
  "origin-csrf-guard-required",
  "audit-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

const browserSessionRenewalCodes = [
  "planning-only",
  "browser-session-renewal",
  "expiry-required",
  "revocation-check-required",
  "sanitized-failure-handling-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

const browserSessionRevocationCodes = [
  "planning-only",
  "browser-session-revocation",
  "audit-required",
  "revocation-check-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

const apiTokenLifecycleCodes = [
  "planning-only",
  "stronger-confirmation-required",
  "audit-required",
  "expiry-required",
  "long-lived-token-classification-required",
  "revocation-check-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

const revokeAllCodes = [
  "planning-only",
  "revoke-all",
  "stronger-confirmation-required",
  "audit-required",
  "revocation-check-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

const emergencyRevokeAllCodes = [
  "planning-only",
  "emergency-revoke-all",
  "stronger-confirmation-required",
  "audit-required",
  "revocation-check-required",
  "local-only-safety-required",
] as const satisfies readonly CredentialSessionLifecycleRequirementCode[];

export function planCredentialSessionLifecycle(
  input: CredentialSessionLifecyclePlannerInput,
): CredentialSessionLifecyclePlan {
  if (!isKnownLifecycleOperation(input.operation)) {
    return basePlan({
      results: ["unsupported-operation", "not-implemented"],
      requirementCodes: ["planning-only", "unsupported-operation"],
    });
  }

  switch (input.operation) {
    case "create-local-admin-credential":
    case "create-user-credential":
      return plan(input.operation, credentialCreationCodes);
    case "rotate-credential-secret":
      return plan(input.operation, credentialRotationCodes);
    case "verify-credential":
      return plan(input.operation, credentialVerificationCodes);
    case "revoke-credential":
      return plan(input.operation, credentialRevocationCodes);
    case "create-browser-session":
      return plan(input.operation, browserSessionCreationCodes);
    case "renew-browser-session":
      return plan(input.operation, browserSessionRenewalCodes);
    case "revoke-browser-session":
      return plan(input.operation, browserSessionRevocationCodes);
    case "create-api-token":
      return plan(input.operation, ["api-token-creation", ...apiTokenLifecycleCodes]);
    case "rotate-api-token":
      return plan(input.operation, ["api-token-rotation", ...apiTokenLifecycleCodes]);
    case "revoke-api-token":
      return plan(input.operation, ["api-token-revocation", ...apiTokenLifecycleCodes]);
    case "revoke-all-for-actor":
      return plan(input.operation, revokeAllCodes);
    case "emergency-revoke-all":
      return plan(input.operation, emergencyRevokeAllCodes);
  }
}

function plan(
  operation: CredentialSessionLifecycleOperation,
  requirementCodes: readonly CredentialSessionLifecycleRequirementCode[],
): CredentialSessionLifecyclePlan {
  return basePlan({
    operation,
    results: resultsFromRequirementCodes(requirementCodes),
    requirementCodes,
  });
}

function resultsFromRequirementCodes(
  requirementCodes: readonly CredentialSessionLifecycleRequirementCode[],
): readonly CredentialSessionLifecyclePlanResult[] {
  const results: CredentialSessionLifecyclePlanResult[] = ["allowed-by-design"];
  if (requirementCodes.includes("stronger-confirmation-required")) {
    results.push("requires-stronger-confirmation");
  }
  if (requirementCodes.includes("audit-required")) results.push("requires-audit");
  if (
    requirementCodes.includes("expiry-required") ||
    requirementCodes.includes("long-lived-token-classification-required")
  ) {
    results.push("requires-expiry");
  }
  if (requirementCodes.includes("revocation-check-required")) {
    results.push("requires-revocation-check");
  }
  if (requirementCodes.includes("origin-csrf-guard-required")) {
    results.push("requires-origin-csrf-guard");
  }
  return unique(results);
}

function basePlan(input: {
  operation?: CredentialSessionLifecycleOperation;
  results: readonly CredentialSessionLifecyclePlanResult[];
  requirementCodes: readonly CredentialSessionLifecycleRequirementCode[];
}): CredentialSessionLifecyclePlan {
  return {
    operation: input.operation,
    results: unique(input.results),
    requirementCodes: unique(input.requirementCodes),
    createsCredential: false,
    createsSession: false,
    createsToken: false,
    setsCookie: false,
    enforcementActive: false,
    protectedModeOperational: false,
    networkExposureSafe: false,
  };
}

function isKnownLifecycleOperation(
  operation: CredentialSessionLifecyclePlannerInput["operation"],
): operation is CredentialSessionLifecycleOperation {
  return (
    operation === "create-local-admin-credential" ||
    operation === "create-user-credential" ||
    operation === "rotate-credential-secret" ||
    operation === "verify-credential" ||
    operation === "revoke-credential" ||
    operation === "create-browser-session" ||
    operation === "renew-browser-session" ||
    operation === "revoke-browser-session" ||
    operation === "create-api-token" ||
    operation === "rotate-api-token" ||
    operation === "revoke-api-token" ||
    operation === "revoke-all-for-actor" ||
    operation === "emergency-revoke-all"
  );
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}
