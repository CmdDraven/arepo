import { planAuditRequirement } from "./auditRequirementPlanner.js";
import { planProtectedRequestPipeline } from "./protectedRequestPipeline.js";
import { planProtectedResponse } from "./protectedResponsePlanner.js";
import { planReducedAnonymousNodeStatus } from "./reducedAnonymousStatusPlanner.js";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";
import { planStrongerConfirmation } from "./strongerConfirmationPlanner.js";
import type {
  AuthPosture,
  ProtectedModeReadinessBlockerCode,
  ProtectedModeReadinessBlockerDetail,
  ProtectedModeReadinessManifest,
  ProtectedModeStartupAssessment,
  RequestPolicyRuntimeStatus,
} from "./types.js";

export type ProtectedModeReadinessInput = {
  auth: AuthPosture;
  startup: ProtectedModeStartupAssessment;
  requestPolicy: RequestPolicyRuntimeStatus;
  localOnlyMode: boolean;
  routePolicyExpectedMinimum?: number;
};

export function buildProtectedModeReadinessManifest(
  input: ProtectedModeReadinessInput,
): ProtectedModeReadinessManifest {
  const expectedMinimum = input.routePolicyExpectedMinimum ?? PROTECTED_ROUTE_POLICIES.length;
  const routePolicyComplete =
    input.requestPolicy.routePolicyInventoryPresent &&
    input.requestPolicy.routePolicyCount >= expectedMinimum;
  const credentialAcceptanceActive =
    input.requestPolicy.acceptsCredentials ||
    input.requestPolicy.acceptsSessions ||
    input.requestPolicy.acceptsBearerTokens;

  const details: ProtectedModeReadinessBlockerDetail[] = [];

  addDetail(details, {
    group: "auth",
    label: "Protected mode is not operational.",
    status: "blocked",
    codes: [
      ...(input.auth.mode === "disabled" ? (["auth-mode-disabled"] as const) : []),
      ...(input.auth.requestedMode === "protected"
        ? (["protected-mode-requested-unavailable"] as const)
        : []),
      "protected-mode-unavailable",
      "protected-mode-not-operational",
    ],
  });

  addDetail(details, {
    group: "startup",
    label: "Protected-mode startup gate is not ready.",
    status: "blocked",
    codes: [
      "startup-gate-not-ready",
      ...(input.startup.missingRequiredStores.length > 0 ? (["auth-store-missing"] as const) : []),
      ...(input.startup.corruptStores.length > 0 ? (["auth-store-corrupt"] as const) : []),
      ...(input.startup.unsafeStorePaths.length > 0 ? (["auth-store-path-unsafe"] as const) : []),
    ],
    count:
      input.startup.missingRequiredStores.length +
      input.startup.corruptStores.length +
      input.startup.unsafeStorePaths.length,
  });

  if (!input.requestPolicy.routePolicyInventoryPresent || !routePolicyComplete) {
    addDetail(details, {
      group: "routePolicy",
      label: "Route policy coverage is missing or incomplete.",
      status: "blocked",
      codes: [
        ...(!input.requestPolicy.routePolicyInventoryPresent
          ? (["route-policy-inventory-missing"] as const)
          : []),
        ...(!routePolicyComplete ? (["route-policy-inventory-incomplete"] as const) : []),
      ],
      count: input.requestPolicy.routePolicyCount,
    });
  }

  addDetail(details, {
    group: "requestPolicy",
    label: "Credential verification and acceptance are not active.",
    status: "blocked",
    codes: [
      ...(!input.requestPolicy.credentialVerificationActive
        ? (["credential-verification-inactive"] as const)
        : []),
      ...(!credentialAcceptanceActive ? (["credential-acceptance-inactive"] as const) : []),
      ...(!input.requestPolicy.enforcementActive
        ? (["explicit-enforcement-flag-disabled"] as const)
        : []),
    ],
  });

  addDetail(details, {
    group: "audit",
    label: "Audit enforcement is not active.",
    status: "blocked",
    codes: !input.requestPolicy.auditRequestLoggingActive ? ["audit-enforcement-inactive"] : [],
  });

  addDetail(details, {
    group: "audit",
    label: "Audit requirement planner is available for planning only.",
    status: "planning-only",
    codes: ["audit-requirement-planning-only"],
  });

  addDetail(details, {
    group: "revocation",
    label: "Revocation checks are not active.",
    status: "blocked",
    codes: !input.requestPolicy.revocationChecksActive ? ["revocation-checks-inactive"] : [],
  });

  addDetail(details, {
    group: "browserSecurity",
    label: "CSRF/origin enforcement and reduced anonymous status are not active.",
    status: "blocked",
    codes: [
      ...(!input.requestPolicy.csrfOriginEnforcementActive
        ? (["csrf-origin-enforcement-inactive"] as const)
        : []),
      "reduced-anonymous-status-not-enforced",
    ],
  });

  addDetail(details, {
    group: "confirmation",
    label: "Stronger confirmation enforcement is not active.",
    status: "blocked",
    codes: ["stronger-confirmation-not-enforced"],
  });

  addDetail(details, {
    group: "confirmation",
    label: "Stronger confirmation planner is available for planning only.",
    status: "planning-only",
    codes: ["stronger-confirmation-planning-only"],
  });

  addDetail(details, {
    group: "pipeline",
    label: "Protected request pipeline is available for planning only.",
    status: "planning-only",
    codes: ["request-pipeline-planning-only"],
  });

  addDetail(details, {
    group: "responsePlanning",
    label: "Protected response planner is available for planning only.",
    status: "planning-only",
    codes: ["response-planner-planning-only"],
  });

  addDetail(details, {
    group: "responsePlanning",
    label: "Reduced anonymous status planner is available for planning only.",
    status: "planning-only",
    codes: ["reduced-anonymous-status-planning-only"],
  });

  if (input.requestPolicy.dryRun.configured || input.requestPolicy.dryRun.observed.count > 0) {
    addDetail(details, {
      group: "dryRun",
      label: "Dry-run observation is not enforcement.",
      status: "planning-only",
      codes: ["dry-run-observation-only"],
      count: input.requestPolicy.dryRun.observed.count,
    });
  }

  if (!input.localOnlyMode || input.startup.nonLocalBindWithDisabledAuth) {
    addDetail(details, {
      group: "network",
      label: "Non-local exposure is unsafe without active protected mode.",
      status: "unsafe",
      codes: ["non-local-bind-without-protected-mode"],
    });
  }

  const blockers = unique(details.flatMap((detail) => detail.codes));

  return {
    readyForEnforcement: false,
    enforcementActive: false,
    protectedModeOperational: false,
    networkExposureSafe: false,
    requestedAuthMode: input.auth.requestedMode,
    operationalAuthMode: input.auth.mode,
    protectedModeAvailable: false,
    protectedModeMayStart: false,
    blockerCount: blockers.length,
    blockers,
    blockerDetails: details,
    routePolicy: {
      inventoryPresent: input.requestPolicy.routePolicyInventoryPresent,
      routePolicyCount: input.requestPolicy.routePolicyCount,
      expectedMinimum,
      complete: routePolicyComplete,
    },
    dryRun: input.requestPolicy.dryRun,
    checks: {
      credentialVerificationActive: false,
      credentialAcceptanceActive: false,
      auditEnforcementActive: false,
      revocationChecksActive: false,
      csrfOriginEnforcementActive: false,
      reducedAnonymousStatusEnforced: false,
      strongerConfirmationEnforced: false,
      explicitEnforcementFlagEnabled: false,
      protectedRequestPipelineAvailable: typeof planProtectedRequestPipeline === "function",
      protectedResponsePlannerAvailable: typeof planProtectedResponse === "function",
      reducedAnonymousStatusPlannerAvailable: typeof planReducedAnonymousNodeStatus === "function",
      strongerConfirmationPlannerAvailable: typeof planStrongerConfirmation === "function",
      auditRequirementPlannerAvailable: typeof planAuditRequirement === "function",
    },
    startup: {
      missingStoreCount: input.startup.missingRequiredStores.length,
      corruptStoreCount: input.startup.corruptStores.length,
      unsafeStorePathCount: input.startup.unsafeStorePaths.length,
      permissionWarningCount: input.startup.permissionWarnings.length,
    },
    network: {
      localOnlyMode: input.localOnlyMode,
      nonLocalBindWithDisabledAuth: input.startup.nonLocalBindWithDisabledAuth,
    },
  };
}

function addDetail(
  details: ProtectedModeReadinessBlockerDetail[],
  detail: ProtectedModeReadinessBlockerDetail,
): void {
  if (detail.codes.length === 0) return;
  details.push(detail);
}

function unique(
  codes: readonly ProtectedModeReadinessBlockerCode[],
): readonly ProtectedModeReadinessBlockerCode[] {
  return Array.from(new Set(codes));
}
