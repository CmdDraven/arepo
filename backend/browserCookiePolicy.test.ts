import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_COOKIE_POLICY_NETWORK_EXPOSURE_SAFE,
  BROWSER_COOKIE_POLICY_WIRED_INTO_AUTHORIZATION,
  BROWSER_COOKIE_POLICY_WIRED_INTO_ROUTES,
  getBrowserCookiePolicyDiagnostics,
  plannedBrowserCsrfCookiePolicy,
  plannedBrowserSessionCookiePolicy,
  validateBrowserCookiePolicy,
} from "./browserCookiePolicy.js";

test("planned session cookie policy requires HttpOnly", () => {
  const result = plannedBrowserSessionCookiePolicy({ httpOnly: false });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.includes("Session cookies must be HttpOnly."));
  }
});

test("planned cookie policy rejects unsafe SameSite values", () => {
  const result = plannedBrowserSessionCookiePolicy({ sameSite: "none" as never });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.includes("SameSite must be lax or strict."));
  }
});

test("planned cookie policy rejects Domain by default for host-only cookies", () => {
  const result = plannedBrowserSessionCookiePolicy({ domain: "example.test" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.includes("Domain is omitted by default for host-only cookies."));
  }
});

test("planned cookie policy distinguishes local development from non-local secure requirements", () => {
  const local = plannedBrowserSessionCookiePolicy({
    localDevelopment: true,
    secure: false,
  });
  const nonLocal = plannedBrowserSessionCookiePolicy({
    localDevelopment: false,
    secure: false,
  });

  assert.equal(local.ok, true);
  if (local.ok) {
    assert.equal(local.policy.secure, false);
    assert.equal(local.policy.localDevelopment, true);
    assert.equal(local.policy.issueSetCookieHeader, false);
    assert.equal(local.policy.acceptsCookieCredential, false);
  }
  assert.equal(nonLocal.ok, false);
  if (!nonLocal.ok) {
    assert.ok(
      nonLocal.errors.includes("Secure cookies are required outside explicit local development."),
    );
  }
});

test("planned csrf cookie policy is separate and still inert", () => {
  const result = plannedBrowserCsrfCookiePolicy({ localDevelopment: true });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.policy.kind, "csrf");
    assert.equal(result.policy.name, "arepo_csrf");
    assert.equal(result.policy.httpOnly, false);
    assert.equal(result.policy.issueSetCookieHeader, false);
    assert.equal(result.policy.acceptsCookieCredential, false);
    assert.equal(result.policy.networkExposureSafe, false);
  }
});

test("planned cookie validation rejects unbounded or malformed policy metadata", () => {
  assert.equal(validateBrowserCookiePolicy({ kind: "session", path: "api" }).ok, false);
  assert.equal(validateBrowserCookiePolicy({ kind: "session", maxAgeSeconds: 0 }).ok, false);
  assert.equal(
    validateBrowserCookiePolicy({ kind: "session", maxAgeSeconds: 60 * 60 * 25 }).ok,
    false,
  );
  assert.equal(validateBrowserCookiePolicy({ kind: "session", name: "bad;name" }).ok, false);
});

test("cookie policy diagnostics are inactive and never include cookie values", () => {
  const diagnostics = getBrowserCookiePolicyDiagnostics();
  const serialized = JSON.stringify(diagnostics);

  assert.equal(BROWSER_COOKIE_POLICY_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_COOKIE_POLICY_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_COOKIE_POLICY_WIRED_INTO_ROUTES, false);
  assert.equal(diagnostics.status, "inactive");
  assert.equal(diagnostics.implementation, "policy-test-primitive");
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.issuesCookies, false);
  assert.equal(diagnostics.acceptsCookies, false);
  assert.equal(diagnostics.sessionCookieHttpOnlyRequired, true);
  assert.equal(diagnostics.secureRequiredOutsideLocalDev, true);
  assert.equal(diagnostics.hostOnlyByDefault, true);
  assert.equal(diagnostics.domainAllowedByDefault, false);
  assert.equal(serialized.includes("arepo_session="), false);
  assert.equal(serialized.includes("Set-Cookie"), false);
  assert.equal(serialized.includes("Cookie:"), false);
});

test("cookie policy primitives are not wired into live request authorization", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  const enforcementSource = await fs.readFile(
    path.join(process.cwd(), "backend", "protectedModeEnforcement.ts"),
    "utf8",
  );
  const authorizationSource = await fs.readFile(
    path.join(process.cwd(), "backend", "requestAuthorizationPlanner.ts"),
    "utf8",
  );

  for (const source of [serverSource, enforcementSource, authorizationSource]) {
    assert.equal(source.includes("browserCookiePolicy"), false);
    assert.equal(source.includes("plannedBrowserSessionCookiePolicy"), false);
    assert.equal(source.includes("plannedBrowserCsrfCookiePolicy"), false);
  }
});
