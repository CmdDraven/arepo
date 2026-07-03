import test from "node:test";
import assert from "node:assert/strict";
import { buildProtectedModeReadinessManifest } from "./protectedModeReadiness.js";
import { getRequestPolicyRuntimeStatus } from "./requestPolicyStatus.js";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";
import type {
  AuthPosture,
  ProtectedModeStartupAssessment,
  ProtectedRequestDryRunSummary,
  RequestPolicyRuntimeStatus,
} from "./types.js";

const disabledAuth: AuthPosture = {
  mode: "disabled",
  requestedMode: "disabled",
  enabled: false,
  enforcement: "none",
  protectedModeAvailable: false,
  protectedModeRequested: false,
  warning: "Authentication is disabled.",
};

const requestedProtectedAuth: AuthPosture = {
  ...disabledAuth,
  requestedMode: "protected",
  protectedModeRequested: true,
  warning: "Protected mode was requested but is not implemented.",
  error: "Protected mode unavailable.",
};

const startup: ProtectedModeStartupAssessment = {
  requestedAuthMode: "disabled",
  operationalAuthMode: "disabled",
  protectedModeAvailable: false,
  protectedModeMayStart: false,
  missingRequiredStores: [],
  corruptStores: [],
  unsafeStorePaths: [],
  permissionWarnings: [],
  nonLocalBindWithDisabledAuth: false,
  enforcementActive: false,
  credentialVerificationActive: false,
  auditWiringActive: false,
  revocationChecksActive: false,
  csrfOriginEnforcementActive: false,
  networkExposureSafe: false,
};

function manifest(input?: {
  auth?: AuthPosture;
  startup?: ProtectedModeStartupAssessment;
  requestPolicy?: RequestPolicyRuntimeStatus;
  localOnlyMode?: boolean;
  routePolicyExpectedMinimum?: number;
}) {
  return buildProtectedModeReadinessManifest({
    auth: input?.auth ?? disabledAuth,
    startup: input?.startup ?? startup,
    requestPolicy: input?.requestPolicy ?? getRequestPolicyRuntimeStatus({ mode: "disabled" }),
    localOnlyMode: input?.localOnlyMode ?? true,
    routePolicyExpectedMinimum: input?.routePolicyExpectedMinimum,
  });
}

test("default disabled auth reports not ready for enforcement without store failure blockers", () => {
  const readiness = manifest();

  assert.equal(readiness.readyForEnforcement, false);
  assert.equal(readiness.enforcementActive, false);
  assert.equal(readiness.protectedModeOperational, false);
  assert.equal(readiness.networkExposureSafe, false);
  assert.equal(readiness.requestedAuthMode, "disabled");
  assert.equal(readiness.operationalAuthMode, "disabled");
  assert.ok(readiness.blockers.includes("auth-mode-disabled"));
  assert.ok(readiness.blockers.includes("protected-mode-unavailable"));
  assert.ok(readiness.blockers.includes("credential-verification-inactive"));
  assert.ok(readiness.blockers.includes("revocation-checks-inactive"));
  assert.ok(readiness.blockers.includes("audit-enforcement-inactive"));
  assert.ok(readiness.blockers.includes("csrf-origin-enforcement-inactive"));
  assert.ok(readiness.blockers.includes("reduced-anonymous-status-not-enforced"));
  assert.ok(readiness.blockers.includes("explicit-enforcement-flag-disabled"));
  assert.equal(readiness.blockers.includes("auth-store-missing"), false);
  assert.equal(readiness.startup.missingStoreCount, 0);
  assert.equal(readiness.routePolicy.complete, true);
});

test("requested protected mode reports unavailable with missing store blocker codes", () => {
  const readiness = manifest({
    auth: requestedProtectedAuth,
    startup: {
      ...startup,
      requestedAuthMode: "protected",
      missingRequiredStores: [
        {
          store: "credentials",
          path: "/tmp/secret-app-data/auth/credentials.json",
          error: "missing",
        },
      ],
    },
  });

  assert.equal(readiness.readyForEnforcement, false);
  assert.equal(readiness.requestedAuthMode, "protected");
  assert.ok(readiness.blockers.includes("protected-mode-requested-unavailable"));
  assert.ok(readiness.blockers.includes("auth-store-missing"));
  assert.equal(readiness.startup.missingStoreCount, 1);
  assert.equal(JSON.stringify(readiness).includes("/tmp/secret-app-data"), false);
});

test("dry-run configured mounted observed planned and audited states remain non-enforcing", () => {
  const requestPolicy = getRequestPolicyRuntimeStatus({
    mode: "disabled",
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });
  const plannedResponse = {
    kind: "unauthenticated" as const,
    httpStatus: 401 as const,
    reasonCode: "requires-authentication",
    authRequired: true,
    confirmationRequired: false,
    enforcementActive: false as const,
    networkExposureSafe: false as const,
  };
  const observed: ProtectedRequestDryRunSummary = {
    timestamp: "2026-07-03T00:00:00.000Z",
    method: "GET",
    path: "/api/vaults/secret-vault/file?path=Notes/private.md",
    routePattern: "/api/vaults/:vaultId/file?path=...",
    status: "wouldDeny",
    reasonCodes: ["requires-authentication"],
    plannedResponse,
    enforcementActive: false,
    networkExposureSafe: false,
  };
  const readiness = manifest({
    requestPolicy: {
      ...requestPolicy,
      dryRunRunCount: 1,
      dryRunAuditAttemptedCount: 1,
      dryRunAuditAppendCount: 1,
      lastDryRunResult: observed,
      dryRun: {
        ...requestPolicy.dryRun,
        configured: true,
        mounted: true,
        observed: { count: 1, lastStatus: "wouldDeny" },
        planned: { computed: true, lastResponse: plannedResponse },
        audited: {
          configured: true,
          attemptedCount: 1,
          appendedCount: 1,
          lastStatus: "written",
          lastReasonCode: "requires-authentication",
        },
      },
    },
  });
  const serialized = JSON.stringify(readiness);

  assert.equal(readiness.readyForEnforcement, false);
  assert.equal(readiness.dryRun.configured, true);
  assert.equal(readiness.dryRun.mounted, true);
  assert.equal(readiness.dryRun.observed.count, 1);
  assert.equal(readiness.dryRun.planned.computed, true);
  assert.equal(readiness.dryRun.audited.attemptedCount, 1);
  assert.equal(readiness.dryRun.audited.appendedCount, 1);
  assert.equal(readiness.dryRun.enforced, false);
  assert.ok(readiness.blockers.includes("dry-run-observation-only"));
  assert.equal(readiness.enforcementActive, false);
  assert.equal(readiness.protectedModeOperational, false);
  assert.equal(readiness.networkExposureSafe, false);
  assert.equal(serialized.includes("secret-vault"), false);
  assert.equal(serialized.includes("Notes/private.md"), false);
});

test("non-local bind remains unsafe in readiness manifest", () => {
  const readiness = manifest({
    localOnlyMode: false,
    startup: { ...startup, nonLocalBindWithDisabledAuth: true },
  });

  assert.equal(readiness.network.localOnlyMode, false);
  assert.equal(readiness.network.nonLocalBindWithDisabledAuth, true);
  assert.ok(readiness.blockers.includes("non-local-bind-without-protected-mode"));
  assert.equal(readiness.networkExposureSafe, false);
});

test("response planner and pipeline presence are planning-only not enforcement", () => {
  const readiness = manifest();

  assert.equal(readiness.checks.protectedRequestPipelineAvailable, true);
  assert.equal(readiness.checks.protectedResponsePlannerAvailable, true);
  assert.ok(readiness.blockers.includes("request-pipeline-planning-only"));
  assert.ok(readiness.blockers.includes("response-planner-planning-only"));
  assert.equal(readiness.enforcementActive, false);
});

test("unknown or incomplete route coverage is not ready", () => {
  const missingInventory = manifest({
    requestPolicy: {
      ...getRequestPolicyRuntimeStatus({ mode: "disabled" }),
      routePolicyInventoryPresent: false,
      routePolicyCount: 0,
    },
  });
  assert.ok(missingInventory.blockers.includes("route-policy-inventory-missing"));
  assert.ok(missingInventory.blockers.includes("route-policy-inventory-incomplete"));
  assert.equal(missingInventory.routePolicy.complete, false);

  const incomplete = manifest({
    routePolicyExpectedMinimum: PROTECTED_ROUTE_POLICIES.length + 1,
  });
  assert.ok(incomplete.blockers.includes("route-policy-inventory-incomplete"));
  assert.equal(incomplete.routePolicy.complete, false);
});

test("manifest never includes sensitive upstream diagnostic material", () => {
  const readiness = manifest({
    startup: {
      ...startup,
      missingRequiredStores: [
        {
          store: "credentials",
          path: "/home/user/vault/.arepo/auth/credentials.json",
          error: "missing bearer-token-secret cookie-value verifierHash salt sourceBody",
        },
      ],
      corruptStores: [
        {
          store: "sessions",
          path: "/home/user/vault/.arepo/auth/sessions.json",
          error: "sessionSecret private",
          quarantineCandidate: "/home/user/vault/.arepo/auth/sessions.json.corrupt",
        },
      ],
      unsafeStorePaths: ["/home/user/vault/unsafe-auth-path"],
      permissionWarnings: ["Auth store path /home/user/vault/auth is too broad"],
    },
  });
  const serialized = JSON.stringify(readiness);

  assert.equal(serialized.includes("/home/user"), false);
  assert.equal(serialized.includes("bearer-token-secret"), false);
  assert.equal(serialized.includes("cookie-value"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("salt"), false);
  assert.equal(serialized.includes("sourceBody"), false);
  assert.equal(serialized.includes("sessionSecret"), false);
  assert.equal(readiness.startup.missingStoreCount, 1);
  assert.equal(readiness.startup.corruptStoreCount, 1);
  assert.equal(readiness.startup.unsafeStorePathCount, 1);
  assert.equal(readiness.startup.permissionWarningCount, 1);
});
