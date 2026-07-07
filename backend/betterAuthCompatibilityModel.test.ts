import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getBrowserAuthFoundationRequirementsDiagnostics,
  listBrowserAuthFoundationRequirements,
} from "./browserAuthFoundationRequirements.js";
import { planBetterAuthCompatibility } from "./betterAuthCompatibilityModel.js";

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_secret",
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `compatibility model exposed ${secret}`);
  }
}

test("browser auth foundation requirements are complete unique and inactive", () => {
  const requirements = listBrowserAuthFoundationRequirements();
  const diagnostics = getBrowserAuthFoundationRequirementsDiagnostics();
  const ids = requirements.map((requirement) => requirement.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(requirements.length >= 20);
  assert.equal(
    requirements.every((requirement) => requirement.mustProveBeforeLiveActivation),
    true,
  );
  assert.equal(diagnostics.status, "planning-only");
  assert.equal(diagnostics.requirementCount, requirements.length);
  assert.equal(diagnostics.liveBrowserAuthEnabled, false);
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.installsRuntimeDependency, false);
  assert.equal(diagnostics.emitsSetCookieHeaders, false);
  assert.equal(diagnostics.acceptsCookieCredentials, false);
  assertNoSecretMaterial({ requirements, diagnostics });
});

test("Better Auth compatibility covers every AREPO browser-auth requirement", () => {
  const requirements = listBrowserAuthFoundationRequirements();
  const plan = planBetterAuthCompatibility();

  assert.equal(plan.status, "preferred-isolated-spike-target");
  assert.equal(plan.preferredFoundation, "better-auth");
  assert.equal(plan.backupFoundation, "server-side-session-core");
  assert.equal(plan.requirementCount, requirements.length);
  assert.deepEqual(
    plan.findings.map((finding) => finding.requirementId).sort(),
    requirements.map((requirement) => requirement.id).sort(),
  );
  assert.equal(plan.liveBrowserAuthEnabled, false);
  assert.equal(plan.installsRuntimeDependency, false);
  assert.equal(plan.mountedInServer, false);
  assert.equal(plan.wiredIntoAuthorization, false);
  assert.equal(plan.wiredIntoRoutes, false);
  assert.equal(plan.emitsSetCookieHeaders, false);
  assert.equal(plan.acceptsCookieCredentials, false);
  assert.equal(plan.parsesCookiesForLiveAuthorization, false);
  assert.equal(plan.validatesCsrfInLiveAuthorization, false);
  assert.equal(plan.changesBearerTokenProtectedMode, false);
  assert.equal(plan.nextSlice, "backup-restore-session-state-policy");
  assertNoSecretMaterial(plan);
});

test("Better Auth compatibility makes unknowns blockers and proof work explicit", () => {
  const plan = planBetterAuthCompatibility();
  const unknownOrSpike = plan.findings.filter(
    (finding) => finding.status === "unknown" || finding.status === "needs-spike",
  );

  assert.ok(unknownOrSpike.length > 0);
  for (const finding of unknownOrSpike) {
    assert.ok(finding.blockerCodes.length > 0, `${finding.requirementId} lacks blockers`);
    assert.ok(finding.openQuestions.length > 0, `${finding.requirementId} lacks questions`);
    assert.equal(finding.proofRequiredBeforeLiveActivation, true);
  }
  assert.ok(plan.summary.blockerCodes.includes("arepo-owned-csrf-live-integration-blocked"));
  assert.ok(plan.summary.blockerCodes.includes("production-arepo-better-auth-plugin-needed"));
  assert.ok(plan.summary.blockerCodes.includes("internal-adapter-wrapper-implementation-needed"));
  assert.ok(plan.summary.blockerCodes.includes("arepo-sidecar-authorization-store-needed"));
  assert.equal(plan.summary.incompatibleCount, 0);
  assert.equal(plan.summary.unknownCount, 0);
  assert.equal(plan.summary.needsSpikeCount > 0, true);
});

test("Better Auth compatibility keeps AREPO-owned controls custom", () => {
  const plan = planBetterAuthCompatibility();
  const customRequirementIds = [
    "explicit-pairing-flow",
    "route-contract-model",
    "activation-gate-preflight-model",
    "audit-without-secrets",
    "inactive-boundary-regression",
  ];

  for (const requirementId of customRequirementIds) {
    const finding = plan.findings.find((candidate) => candidate.requirementId === requirementId);
    assert.ok(finding, `Missing ${requirementId}`);
    assert.equal(finding.delegatedTo, "arepo");
  }
});

test("Better Auth compatibility model is not imported into live server authorization or frontend paths", async () => {
  const sourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/httpCredentialAdapter.ts",
    "src/routes/index.tsx",
  ];

  for (const file of sourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(source.includes("./browserAuthFoundationRequirements.js"), false);
    assert.equal(source.includes("./betterAuthCompatibilityModel.js"), false);
    assert.equal(source.includes("listBrowserAuthFoundationRequirements"), false);
    assert.equal(source.includes("planBetterAuthCompatibility"), false);
  }
});
