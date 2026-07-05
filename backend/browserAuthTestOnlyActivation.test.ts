import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_AUTH_TEST_ONLY_ACTIVATION_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_TEST_ONLY_ACTIVATION_RUNTIME_CONFIGURABLE,
  BROWSER_AUTH_TEST_ONLY_ACTIVATION_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_TEST_ONLY_ACTIVATION_WIRED_INTO_ROUTES,
  createBrowserAuthTestOnlyActivationAllowance,
} from "./browserAuthTestOnlyActivation.js";

test("browser auth test-only activation allowance is explicit and non-runtime configurable", () => {
  const allowance = createBrowserAuthTestOnlyActivationAllowance();

  assert.equal(BROWSER_AUTH_TEST_ONLY_ACTIVATION_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_TEST_ONLY_ACTIVATION_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_TEST_ONLY_ACTIVATION_WIRED_INTO_ROUTES, false);
  assert.equal(BROWSER_AUTH_TEST_ONLY_ACTIVATION_RUNTIME_CONFIGURABLE, false);
  assert.equal(allowance.kind, "browser-auth-test-only-activation");
  assert.equal(allowance.allowsDarkHarnessExecution, true);
  assert.equal(allowance.runtimeConfigurable, false);
  assert.equal(allowance.wiredIntoAuthorization, false);
  assert.equal(allowance.wiredIntoRoutes, false);
});

test("browser auth test-only activation allowance is not imported into live paths", async () => {
  const liveSourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/httpCredentialAdapter.ts",
  ];

  for (const file of liveSourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(source.includes("./browserAuthTestOnlyActivation.js"), false);
    assert.equal(source.includes("createBrowserAuthTestOnlyActivationAllowance"), false);
  }
});
