import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_AUTH_COOKIE_SERIALIZATION_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_COOKIE_SERIALIZATION_TEST_ONLY,
  BROWSER_AUTH_COOKIE_SERIALIZATION_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_COOKIE_SERIALIZATION_WIRED_INTO_ROUTES,
  getBrowserAuthCookieSerializationDiagnostics,
  planBrowserAuthTestOnlyClearCookies,
  planBrowserAuthTestOnlyIssueCookies,
} from "./browserAuthCookieSerialization.js";
import {
  plannedBrowserSessionCookiePolicy,
  type PlannedBrowserCookiePolicy,
  type PlannedBrowserCookiePolicyInput,
} from "./browserCookiePolicy.js";

const sessionSecret = "bsver_cookie_serialization_session_secret";
const csrfSecret = "bcsrfsec_cookie_serialization_csrf_secret";
const pairingSecret = "bpairsec_cookie_serialization_pairing_secret";

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  pairingSecret,
  sessionSecret,
  csrfSecret,
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `cookie serialization exposed ${secret}`);
  }
}

function makeUnsafePlannedBrowserCookiePolicyForTests(
  input: PlannedBrowserCookiePolicyInput,
): PlannedBrowserCookiePolicy {
  return {
    kind: input.kind,
    name: input.name ?? "arepo_test_cookie",
    httpOnly: input.httpOnly ?? input.kind === "session",
    secure: input.secure ?? false,
    sameSite: input.sameSite ?? "lax",
    path: input.path ?? "/api",
    domain: input.domain === undefined ? null : (input.domain as null),
    hostOnly: true,
    maxAgeSeconds: input.maxAgeSeconds ?? 60,
    issueSetCookieHeader: false,
    acceptsCookieCredential: false,
    localDevelopment: input.localDevelopment ?? true,
    networkExposureSafe: false,
  };
}

test("cookie serialization diagnostics are inactive and test-only", () => {
  const diagnostics = getBrowserAuthCookieSerializationDiagnostics();

  assert.equal(BROWSER_AUTH_COOKIE_SERIALIZATION_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_COOKIE_SERIALIZATION_TEST_ONLY, true);
  assert.equal(BROWSER_AUTH_COOKIE_SERIALIZATION_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_COOKIE_SERIALIZATION_WIRED_INTO_ROUTES, false);
  assert.equal(diagnostics.status, "inactive");
  assert.equal(diagnostics.implementation, "test-only-cookie-serialization-primitive");
  assert.equal(diagnostics.testOnly, true);
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.emitsLiveSetCookieHeader, false);
  assert.equal(diagnostics.acceptsCookieCredential, false);
  assert.equal(diagnostics.serializesFutureCookieHeaders, true);
  assert.equal(diagnostics.redactsCookieValues, true);
  assertNoSecretMaterial(diagnostics);
});

test("test-only issue serialization validates planned session and csrf cookie attributes", () => {
  const plan = planBrowserAuthTestOnlyIssueCookies({
    sessionId: "bsess_cookie_serialization_1",
    sessionVerifierSecret: sessionSecret,
    csrfTokenId: "bcsrf_cookie_serialization_1",
    csrfTokenSecret: csrfSecret,
  });

  assert.equal(plan.status, "test-only-planned");
  assert.equal(plan.operation, "issue");
  assert.equal(plan.testOnly, true);
  assert.equal(plan.emitsLiveSetCookieHeader, false);
  assert.equal(plan.acceptsCookieCredential, false);
  assert.equal(plan.wiredIntoAuthorization, false);
  assert.equal(plan.wiredIntoRoutes, false);
  assert.equal(plan.sessionCookie.kind, "session");
  assert.equal(plan.sessionCookie.attributes.httpOnly, true);
  assert.equal(plan.sessionCookie.attributes.sameSite, "lax");
  assert.equal(plan.sessionCookie.attributes.path.startsWith("/"), true);
  assert.equal(plan.sessionCookie.attributes.domain, null);
  assert.equal(plan.sessionCookie.attributes.hostOnly, true);
  assert.equal(plan.sessionCookie.attributes.maxAgeSeconds, 60 * 30);
  assert.equal(plan.csrfCookie.kind, "csrf");
  assert.equal(plan.csrfCookie.attributes.httpOnly, false);
  assert.equal(plan.csrfCookie.attributes.sameSite, "lax");
  assert.equal(plan.csrfCookie.attributes.domain, null);
  assert.equal(plan.csrfCookie.attributes.hostOnly, true);
  assert.equal(plan.serializedSetCookieHeaders.length, 2);
  assert.match(plan.serializedSetCookieHeaders[0], /^arepo_session=/);
  assert.match(plan.serializedSetCookieHeaders[0], /HttpOnly/);
  assert.match(plan.serializedSetCookieHeaders[0], /Path=\/api/);
  assert.match(plan.serializedSetCookieHeaders[0], /SameSite=Lax/);
  assert.match(plan.serializedSetCookieHeaders[1], /^arepo_csrf=/);
  assert.doesNotMatch(plan.serializedSetCookieHeaders[1], /HttpOnly/);
  assert.equal(
    plan.serializedSetCookieHeaders.some((header) => header.includes("Domain=")),
    false,
  );
  assert.equal(plan.serializedSetCookieHeaders[0].includes(sessionSecret), true);
  assert.equal(plan.serializedSetCookieHeaders[1].includes(csrfSecret), true);
});

test("test-only issue serialization enforces Secure outside local development", () => {
  const plan = planBrowserAuthTestOnlyIssueCookies({
    sessionId: "bsess_cookie_serialization_2",
    sessionVerifierSecret: sessionSecret,
    csrfTokenId: "bcsrf_cookie_serialization_2",
    csrfTokenSecret: csrfSecret,
    localDevelopment: false,
  });

  assert.match(plan.serializedSetCookieHeaders[0], /Secure/);
  assert.match(plan.serializedSetCookieHeaders[1], /Secure/);
  assert.equal(plan.sessionCookie.attributes.secure, true);
  assert.equal(plan.csrfCookie.attributes.secure, true);
});

test("cookie serialization rejects unsafe policy attributes", () => {
  const unsafeSession = makeUnsafePlannedBrowserCookiePolicyForTests({
    kind: "session",
    httpOnly: false,
  });
  const unsafeSameSite = makeUnsafePlannedBrowserCookiePolicyForTests({
    kind: "session",
    sameSite: "none" as never,
  });
  const unsafeDomain = makeUnsafePlannedBrowserCookiePolicyForTests({
    kind: "session",
    domain: "example.test",
  });
  const unsafePath = makeUnsafePlannedBrowserCookiePolicyForTests({
    kind: "session",
    path: "api",
  });
  const unsafeSecure = makeUnsafePlannedBrowserCookiePolicyForTests({
    kind: "session",
    localDevelopment: false,
    secure: false,
  });

  const base = {
    sessionId: "bsess_cookie_serialization_3",
    sessionVerifierSecret: sessionSecret,
    csrfTokenId: "bcsrf_cookie_serialization_3",
    csrfTokenSecret: csrfSecret,
  };

  assert.throws(
    () => planBrowserAuthTestOnlyIssueCookies({ ...base, sessionCookiePolicy: unsafeSession }),
    /HttpOnly/,
  );
  assert.throws(
    () => planBrowserAuthTestOnlyIssueCookies({ ...base, sessionCookiePolicy: unsafeSameSite }),
    /SameSite/,
  );
  assert.throws(
    () => planBrowserAuthTestOnlyIssueCookies({ ...base, sessionCookiePolicy: unsafeDomain }),
    /host-only/,
  );
  assert.throws(
    () => planBrowserAuthTestOnlyIssueCookies({ ...base, sessionCookiePolicy: unsafePath }),
    /Path/,
  );
  assert.throws(
    () => planBrowserAuthTestOnlyIssueCookies({ ...base, sessionCookiePolicy: unsafeSecure }),
    /Secure/,
  );
});

test("planned cookie summaries redact values and credential-shaped material", () => {
  const plan = planBrowserAuthTestOnlyIssueCookies({
    sessionId: "bsess_cookie_serialization_4",
    sessionVerifierSecret: sessionSecret,
    csrfTokenId: "bcsrf_cookie_serialization_4",
    csrfTokenSecret: csrfSecret,
  });

  assertNoSecretMaterial(plan.redactedSummary);
  assert.equal(plan.redactedSummary.cookies[0].valueRedacted, true);
  assert.match(
    plan.redactedSummary.cookies[0].serializedSetCookieRedacted,
    /arepo_session=\[redacted\]/,
  );
  assert.match(
    plan.redactedSummary.cookies[1].serializedSetCookieRedacted,
    /arepo_csrf=\[redacted\]/,
  );
});

test("test-only clear serialization creates redacted clearing metadata", () => {
  const plan = planBrowserAuthTestOnlyClearCookies();

  assert.equal(plan.status, "test-only-planned");
  assert.equal(plan.operation, "clear");
  assert.equal(plan.testOnly, true);
  assert.equal(plan.emitsLiveSetCookieHeader, false);
  assert.equal(plan.acceptsCookieCredential, false);
  assert.match(plan.serializedSetCookieHeaders[0], /^arepo_session=; Max-Age=0/);
  assert.match(plan.serializedSetCookieHeaders[1], /^arepo_csrf=; Max-Age=0/);
  assert.match(plan.serializedSetCookieHeaders[0], /HttpOnly/);
  assert.equal(
    plan.serializedSetCookieHeaders.some((header) => header.includes("Domain=")),
    false,
  );
  assertNoSecretMaterial(plan.redactedSummary);
});

test("cookie serialization preserves externally validated strict cookie policy", () => {
  const strictPolicy = plannedBrowserSessionCookiePolicy({
    sameSite: "strict",
    localDevelopment: false,
  });
  assert.equal(strictPolicy.ok, true);
  if (!strictPolicy.ok) throw new Error("Expected strict policy.");

  const plan = planBrowserAuthTestOnlyIssueCookies({
    sessionId: "bsess_cookie_serialization_5",
    sessionVerifierSecret: sessionSecret,
    csrfTokenId: "bcsrf_cookie_serialization_5",
    csrfTokenSecret: csrfSecret,
    sessionCookiePolicy: strictPolicy.policy,
    localDevelopment: false,
  });

  assert.equal(plan.sessionCookie.attributes.sameSite, "strict");
  assert.equal(plan.sessionCookie.attributes.secure, true);
  assert.match(plan.serializedSetCookieHeaders[0], /SameSite=Strict/);
});

test("cookie serialization is not imported into live server authorization or frontend paths", async () => {
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
    assert.equal(source.includes("./browserAuthCookieSerialization.js"), false);
    assert.equal(source.includes("planBrowserAuthTestOnlyIssueCookies"), false);
    assert.equal(source.includes("planBrowserAuthTestOnlyClearCookies"), false);
  }
});
