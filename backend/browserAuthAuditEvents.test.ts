import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_AUTH_AUDIT_EVENTS_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_AUDIT_EVENTS_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_AUDIT_EVENTS_WIRED_INTO_ROUTES,
  buildBrowserAuthAuditEvent,
  createInMemoryBrowserAuthAuditSink,
  getBrowserAuthAuditDiagnostics,
  sanitizeBrowserAuthAuditDetails,
  type BrowserAuthAuditCategory,
} from "./browserAuthAuditEvents.js";

const categories: readonly BrowserAuthAuditCategory[] = [
  "pairing_code_issue_planned",
  "pairing_code_consume_planned",
  "pairing_code_rejected",
  "session_issue_planned",
  "session_logout_planned",
  "session_revoke_planned",
  "session_expired",
  "csrf_issue_planned",
  "csrf_rejected",
  "cookie_rejected",
  "browser_auth_inactive",
];

const secretSamples = [
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_token",
  "Cookie: arepo_session=secret",
  "Authorization: Bearer arepo_secret_token",
  "sha256:verifierHash",
  "sha256:tokenHash",
] as const;

test("browser auth audit event builder creates safe events for planned browser auth categories", () => {
  for (const category of categories) {
    const event = buildBrowserAuthAuditEvent(
      {
        eventId: `evt-${category}`,
        category,
        subjectId: "subject-a",
        sessionId: "bsess_public_id",
        routeId: "POST /api/node/auth/session",
        reasonCode: `${category}_reason`,
        safeDetails: {
          status: "planned",
          count: 1,
          enabled: false,
          localOnly: true,
        },
      },
      { clock: () => 1_234 },
    );

    assert.equal(event.category, category);
    assert.equal(event.createdAtMs, 1_234);
    assert.equal(event.eventId, `evt-${category}`);
    assert.equal(event.safeDetails?.status, "planned");
    assert.equal(event.safeDetails?.count, 1);
    assert.equal(event.safeDetails?.enabled, false);
  }
});

test("browser auth audit event timestamps are deterministic with injected clock", () => {
  const event = buildBrowserAuthAuditEvent(
    {
      eventId: "evt-deterministic",
      category: "pairing_code_issue_planned",
    },
    { clock: () => 42 },
  );

  assert.equal(event.createdAtMs, 42);
  assert.equal(event.severity, "info");
});

test("browser auth audit event defaults rejected and inactive categories to warning severity", () => {
  assert.equal(
    buildBrowserAuthAuditEvent({ category: "pairing_code_rejected" }).severity,
    "warning",
  );
  assert.equal(buildBrowserAuthAuditEvent({ category: "csrf_rejected" }).severity, "warning");
  assert.equal(buildBrowserAuthAuditEvent({ category: "cookie_rejected" }).severity, "warning");
  assert.equal(
    buildBrowserAuthAuditEvent({ category: "browser_auth_inactive" }).severity,
    "warning",
  );
});

test("browser auth audit detail sanitizer accepts only allowlisted primitive details", () => {
  assert.deepEqual(
    sanitizeBrowserAuthAuditDetails({
      status: "inactive",
      count: 2,
      enabled: false,
      planned: true,
      reason: null,
    }),
    {
      status: "inactive",
      count: 2,
      enabled: false,
      planned: true,
      reason: null,
    },
  );

  assert.throws(
    () => sanitizeBrowserAuthAuditDetails({ arbitrarySafeLookingKey: "value" }),
    /Unsafe browser auth audit detail key\./,
  );
  assert.throws(
    () => sanitizeBrowserAuthAuditDetails({ status: { nested: true } }),
    /Unsafe browser auth audit detail value\./,
  );
});

test("browser auth audit events reject unsafe secret-shaped detail keys without echoing secrets", () => {
  for (const unsafeKey of [
    "token",
    "rawToken",
    "secret",
    "cookie",
    "cookieHeader",
    "authorization",
    "authorizationHeader",
    "verifierHash",
    "tokenHash",
    "password",
    "csrfToken",
    "pairingCode",
    "bearerToken",
  ]) {
    assert.throws(
      () =>
        buildBrowserAuthAuditEvent({
          category: "browser_auth_inactive",
          safeDetails: { [unsafeKey]: "secret-material" },
        }),
      (error) =>
        error instanceof Error &&
        error.message === "Unsafe browser auth audit detail key." &&
        !error.message.includes("secret-material"),
    );
  }
});

test("browser auth audit events reject obvious raw secret values on allowed keys", () => {
  for (const secret of secretSamples) {
    assert.throws(
      () =>
        buildBrowserAuthAuditEvent({
          category: "session_issue_planned",
          safeDetails: { status: secret },
        }),
      (error) =>
        error instanceof Error &&
        error.message === "Unsafe browser auth audit detail value." &&
        !error.message.includes(secret),
    );
  }
});

test("browser auth audit sink and diagnostics do not expose raw credentials or hashes", () => {
  const sink = createInMemoryBrowserAuthAuditSink();
  sink.append(
    buildBrowserAuthAuditEvent(
      {
        eventId: "evt-safe",
        category: "browser_auth_inactive",
        safeDetails: { status: "inactive", count: 0 },
      },
      { clock: () => 10 },
    ),
  );

  const diagnostics = sink.diagnostics();
  const serialized = JSON.stringify({ diagnostics, events: sink.list() });

  assert.equal(diagnostics.status, "inactive");
  assert.equal(diagnostics.implementation, "in-memory-test-primitive");
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.sanitizesSecretMaterial, true);
  assert.equal(diagnostics.eventCount, 1);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("tokenHash"), false);
});

test("browser auth audit diagnostics remain inactive and not network safe", () => {
  const diagnostics = getBrowserAuthAuditDiagnostics(3);

  assert.equal(BROWSER_AUTH_AUDIT_EVENTS_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_AUDIT_EVENTS_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_AUDIT_EVENTS_WIRED_INTO_ROUTES, false);
  assert.equal(diagnostics.status, "inactive");
  assert.equal(diagnostics.eventCount, 3);
  assert.equal(diagnostics.categoryCount, categories.length);
  assert.equal(diagnostics.networkExposureSafe, false);
});

test("browser auth audit primitives are not wired into live request authorization", async () => {
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
    assert.equal(source.includes("browserAuthAuditEvents"), false);
    assert.equal(source.includes("buildBrowserAuthAuditEvent"), false);
    assert.equal(source.includes("createInMemoryBrowserAuthAuditSink"), false);
  }
});
