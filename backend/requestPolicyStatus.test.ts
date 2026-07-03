import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { getRequestPolicyRuntimeStatus } from "./requestPolicyStatus.js";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";

test("request policy runtime status reports inventory and inactive enforcement", () => {
  const status = getRequestPolicyRuntimeStatus({ mode: "disabled" });
  assert.equal(status.routePolicyInventoryPresent, true);
  assert.equal(status.routePolicyCount, PROTECTED_ROUTE_POLICIES.length);
  assert.ok(status.routePolicyCount > 0);
  assert.equal(status.browserSecurityPolicyPresent, true);
  assert.equal(status.authorizationPlannerPresent, true);
  assert.equal(status.dryRunMiddlewareConfigured, false);
  assert.equal(status.dryRunMiddlewareMounted, false);
  assert.equal(status.dryRunObservationOnly, true);
  assert.equal(status.dryRunAuditConfigured, false);
  assert.equal(status.dryRunAuditAppendCount, 0);
  assert.equal(status.enforcementActive, false);
  assert.equal(status.credentialVerificationActive, false);
  assert.equal(status.auditRequestLoggingActive, false);
  assert.equal(status.revocationChecksActive, false);
  assert.equal(status.csrfOriginEnforcementActive, false);
  assert.equal(status.networkExposureSafe, false);
});

test("request policy runtime status does not accept credentials sessions or tokens", () => {
  const status = getRequestPolicyRuntimeStatus({ mode: "disabled" });
  assert.equal(status.acceptsCredentials, false);
  assert.equal(status.acceptsSessions, false);
  assert.equal(status.acceptsBearerTokens, false);
});

test("request policy runtime status reports explicit dry-run observation only", () => {
  const status = getRequestPolicyRuntimeStatus({ mode: "disabled", dryRunRequestPolicy: true });
  assert.equal(status.dryRunMiddlewareConfigured, true);
  assert.equal(status.dryRunMiddlewareMounted, true);
  assert.equal(status.dryRunObservationOnly, true);
  assert.equal(status.dryRunAuditConfigured, false);
  assert.equal(status.dryRunAuditAppendCount, 0);
  assert.equal(status.lastDryRunAuditStatus, undefined);
  assert.equal(status.enforcementActive, false);
  assert.equal(status.credentialVerificationActive, false);
  assert.equal(status.auditRequestLoggingActive, false);
  assert.equal(status.revocationChecksActive, false);
  assert.equal(status.csrfOriginEnforcementActive, false);
  assert.equal(status.networkExposureSafe, false);
});

test("request policy runtime status reports dry-run audit only with both flags", () => {
  const auditWithoutDryRun = getRequestPolicyRuntimeStatus({
    mode: "disabled",
    dryRunAudit: true,
  });
  assert.equal(auditWithoutDryRun.dryRunMiddlewareConfigured, false);
  assert.equal(auditWithoutDryRun.dryRunAuditConfigured, true);
  assert.equal(auditWithoutDryRun.dryRunAuditAppendCount, 0);

  const auditWithDryRun = getRequestPolicyRuntimeStatus({
    mode: "disabled",
    dryRunRequestPolicy: true,
    dryRunAudit: true,
  });
  assert.equal(auditWithDryRun.dryRunMiddlewareConfigured, true);
  assert.equal(auditWithDryRun.dryRunAuditConfigured, true);
  assert.equal(auditWithDryRun.enforcementActive, false);
  assert.equal(auditWithDryRun.networkExposureSafe, false);
});

test("active server request handling does not import enforcement helpers directly", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("planProtectedRouteAuthorization"), false);
  assert.equal(serverSource.includes("planBrowserSecurity"), false);
  assert.equal(serverSource.includes("getRequestPolicyRuntimeStatus"), false);
});
