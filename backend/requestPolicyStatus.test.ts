import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { getRequestPolicyRuntimeStatus } from "./requestPolicyStatus.js";
import { PROTECTED_ROUTE_POLICIES } from "./routePermissions.js";

test("request policy runtime status reports inventory and inactive enforcement", () => {
  const status = getRequestPolicyRuntimeStatus();
  assert.equal(status.routePolicyInventoryPresent, true);
  assert.equal(status.routePolicyCount, PROTECTED_ROUTE_POLICIES.length);
  assert.ok(status.routePolicyCount > 0);
  assert.equal(status.browserSecurityPolicyPresent, true);
  assert.equal(status.authorizationPlannerPresent, true);
  assert.equal(status.enforcementActive, false);
  assert.equal(status.credentialVerificationActive, false);
  assert.equal(status.auditRequestLoggingActive, false);
  assert.equal(status.revocationChecksActive, false);
  assert.equal(status.csrfOriginEnforcementActive, false);
  assert.equal(status.networkExposureSafe, false);
});

test("request policy runtime status does not accept credentials sessions or tokens", () => {
  const status = getRequestPolicyRuntimeStatus();
  assert.equal(status.acceptsCredentials, false);
  assert.equal(status.acceptsSessions, false);
  assert.equal(status.acceptsBearerTokens, false);
});

test("active server request handling does not import enforcement helpers directly", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("planProtectedRouteAuthorization"), false);
  assert.equal(serverSource.includes("planBrowserSecurity"), false);
  assert.equal(serverSource.includes("getRequestPolicyRuntimeStatus"), false);
});
