export type ReducedAnonymousEndpoint = "health" | "nodeStatus" | "dryRunCanary";

export type ReducedAnonymousWarningLabel =
  | "auth-required"
  | "protected-mode-required"
  | "protected-mode-not-operational"
  | "non-local-bind-unsafe";

export type ReducedAnonymousReasonCode =
  | "anonymous-reduced"
  | "auth-required"
  | "protected-mode-required"
  | "protected-mode-not-operational"
  | "full-status-requires-auth"
  | "dry-run-canary-reduced";

export type ReducedAnonymousStatusPlan = {
  ok: true;
  endpoint: ReducedAnonymousEndpoint;
  responseKind: "reduced-anonymous-status";
  service: "arepo-node";
  apiVersion: 1;
  live: true;
  authRequired: true;
  protectedModeOperational: false;
  enforcementActive: false;
  networkExposureSafe: false;
  reasonCodes: readonly ReducedAnonymousReasonCode[];
  publicWarnings: readonly ReducedAnonymousWarningLabel[];
};

export function planReducedAnonymousHealth(
  input: {
    publicWarnings?: readonly string[];
  } = {},
): ReducedAnonymousStatusPlan {
  return reducedPlan({
    endpoint: "health",
    reasonCodes: ["anonymous-reduced", "auth-required", "protected-mode-required"],
    publicWarnings: input.publicWarnings,
  });
}

export function planReducedAnonymousNodeStatus(
  input: {
    publicWarnings?: readonly string[];
  } = {},
): ReducedAnonymousStatusPlan {
  return reducedPlan({
    endpoint: "nodeStatus",
    reasonCodes: [
      "anonymous-reduced",
      "auth-required",
      "protected-mode-required",
      "full-status-requires-auth",
    ],
    publicWarnings: input.publicWarnings,
  });
}

export function planReducedAnonymousDryRunCanary(
  input: {
    publicWarnings?: readonly string[];
  } = {},
): ReducedAnonymousStatusPlan {
  return reducedPlan({
    endpoint: "dryRunCanary",
    reasonCodes: [
      "anonymous-reduced",
      "auth-required",
      "protected-mode-required",
      "dry-run-canary-reduced",
    ],
    publicWarnings: input.publicWarnings,
  });
}

function reducedPlan(input: {
  endpoint: ReducedAnonymousEndpoint;
  reasonCodes: readonly ReducedAnonymousReasonCode[];
  publicWarnings?: readonly string[];
}): ReducedAnonymousStatusPlan {
  return {
    ok: true,
    endpoint: input.endpoint,
    responseKind: "reduced-anonymous-status",
    service: "arepo-node",
    apiVersion: 1,
    live: true,
    authRequired: true,
    protectedModeOperational: false,
    enforcementActive: false,
    networkExposureSafe: false,
    reasonCodes: unique(input.reasonCodes),
    publicWarnings: sanitizedWarnings(input.publicWarnings ?? []),
  };
}

function sanitizedWarnings(
  rawWarnings: readonly string[],
): readonly ReducedAnonymousWarningLabel[] {
  const allowed = new Set<ReducedAnonymousWarningLabel>([
    "auth-required",
    "protected-mode-required",
    "protected-mode-not-operational",
    "non-local-bind-unsafe",
  ]);
  return unique(
    rawWarnings.filter((warning): warning is ReducedAnonymousWarningLabel =>
      allowed.has(warning as ReducedAnonymousWarningLabel),
    ),
  );
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}
