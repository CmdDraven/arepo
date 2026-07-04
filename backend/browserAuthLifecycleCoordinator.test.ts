import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_AUTH_LIFECYCLE_COORDINATOR_MOUNTED,
  BROWSER_AUTH_LIFECYCLE_COORDINATOR_NETWORK_EXPOSURE_SAFE,
  BROWSER_AUTH_LIFECYCLE_COORDINATOR_WIRED_INTO_AUTHORIZATION,
  BROWSER_AUTH_LIFECYCLE_COORDINATOR_WIRED_INTO_ROUTES,
  createInMemoryBrowserAuthLifecycleCoordinator,
} from "./browserAuthLifecycleCoordinator.js";

const pairingSecret = "bpairsec_coordinator_pairing_secret";
const sessionSecret = "bsver_coordinator_session_secret";
const csrfSecret = "bcsrfsec_coordinator_csrf_secret";
const cookieValue = `arepo_session=bsess_test.${sessionSecret}`;
const secretSamples = [
  pairingSecret,
  sessionSecret,
  csrfSecret,
  cookieValue,
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "pairingCodeHash",
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
] as const;

function testCoordinator(nowMs = 1_000) {
  let currentTime = nowMs;
  return {
    setNow(next: number) {
      currentTime = next;
    },
    coordinator: createInMemoryBrowserAuthLifecycleCoordinator({ clock: () => currentTime }),
  };
}

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `output exposed ${secret}`);
  }
}

test("lifecycle coordinator remains inactive unmounted and not network safe", () => {
  const { coordinator } = testCoordinator();
  const diagnostics = coordinator.diagnostics();

  assert.equal(BROWSER_AUTH_LIFECYCLE_COORDINATOR_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_AUTH_LIFECYCLE_COORDINATOR_MOUNTED, false);
  assert.equal(BROWSER_AUTH_LIFECYCLE_COORDINATOR_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_AUTH_LIFECYCLE_COORDINATOR_WIRED_INTO_ROUTES, false);
  assert.equal(diagnostics.status, "inactive");
  assert.equal(diagnostics.implementation, "in-memory-test-primitive");
  assert.equal(diagnostics.mounted, false);
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.issuesLiveCookies, false);
  assert.equal(diagnostics.acceptsCookies, false);
  assert.equal(diagnostics.enablesBrowserSessions, false);
  assert.equal(diagnostics.usesSanitizedAuditEvents, true);
});

test("internal pairing-code creation stores only hashed code material", () => {
  const { coordinator } = testCoordinator();
  const created = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeId: "bpair_test_1",
    pairingCodeSecret: pairingSecret,
    ttlMs: 2_000,
  });
  const record = coordinator.stores.pairingCodes.getPairingCode(created.pairingCodeId);

  assert.equal(created.ok, true);
  assert.equal(created.pairingCodeSecret, pairingSecret);
  assert.equal(record?.pairingCodeId, "bpair_test_1");
  assert.match(record?.pairingCodeHash ?? "", /^sha256:/);
  assert.equal(JSON.stringify(record).includes(pairingSecret), false);
  assert.equal("pairingCodeSecret" in (record ?? {}), false);
});

test("internal pairing-code consumption succeeds once and fails sanitized on second use", () => {
  const { coordinator } = testCoordinator();
  const created = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
  });

  const consumed = coordinator.consumePairingCode(created.pairingCodeId, pairingSecret);
  const consumedAgain = coordinator.consumePairingCode(created.pairingCodeId, pairingSecret);

  assert.equal(consumed.ok, true);
  if (consumed.ok) {
    assert.equal(consumed.subjectId, "subject-a");
  }
  assert.deepEqual(consumedAgain, { ok: false, reason: "consumed-code" });
  assertNoSecretMaterial(consumedAgain);
});

test("session creation after pairing consumption stores only hashed verifier material", () => {
  const { coordinator } = testCoordinator();
  const pairing = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
  });

  const session = coordinator.createSessionFromPairingCode({
    pairingCodeId: pairing.pairingCodeId,
    pairingCodeSecret: pairingSecret,
    sessionId: "bsess_test_1",
    sessionVerifierSecret: sessionSecret,
  });
  const record = session.ok ? coordinator.stores.sessions.getSession(session.sessionId) : undefined;

  assert.equal(session.ok, true);
  if (session.ok) {
    assert.equal(session.sessionVerifierSecret, sessionSecret);
    assert.equal(coordinator.verifySession(session.sessionId, sessionSecret).ok, true);
  }
  assert.match(record?.verifierHash ?? "", /^sha256:/);
  assert.equal(JSON.stringify(record).includes(sessionSecret), false);
  assert.equal("sessionVerifierSecret" in (record ?? {}), false);
});

test("csrf token creation for an internal session stores only hashed token material", () => {
  const { coordinator } = testCoordinator();
  const pairing = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
  });
  const session = coordinator.createSessionFromPairingCode({
    pairingCodeId: pairing.pairingCodeId,
    pairingCodeSecret: pairingSecret,
    sessionVerifierSecret: sessionSecret,
  });
  assert.equal(session.ok, true);
  if (!session.ok) throw new Error("Expected session creation to succeed.");

  const csrf = coordinator.createCsrfTokenForSession({
    sessionId: session.sessionId,
    csrfTokenId: "bcsrf_test_1",
    csrfTokenSecret: csrfSecret,
  });
  const record = csrf.ok ? coordinator.stores.csrfTokens.getToken(csrf.csrfTokenId) : undefined;

  assert.equal(csrf.ok, true);
  if (csrf.ok) {
    assert.equal(csrf.csrfTokenSecret, csrfSecret);
    assert.equal(coordinator.verifyCsrfToken(csrf.csrfTokenId, csrfSecret).ok, true);
  }
  assert.match(record?.tokenHash ?? "", /^sha256:/);
  assert.equal(JSON.stringify(record).includes(csrfSecret), false);
  assert.equal("csrfTokenSecret" in (record ?? {}), false);
});

test("wrong missing expired revoked consumed and locked pairing codes fail with sanitized reasons", () => {
  const { coordinator, setNow } = testCoordinator();
  assert.deepEqual(coordinator.consumePairingCode("missing-code", pairingSecret), {
    ok: false,
    reason: "missing-code",
  });

  const wrong = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
    maxFailedAttempts: 2,
  });
  assert.deepEqual(coordinator.consumePairingCode(wrong.pairingCodeId, "wrong"), {
    ok: false,
    reason: "wrong-code",
    failedAttemptCount: 1,
  });
  assert.deepEqual(coordinator.consumePairingCode(wrong.pairingCodeId, "wrong-again"), {
    ok: false,
    reason: "locked-code",
    failedAttemptCount: 2,
  });
  assert.deepEqual(coordinator.consumePairingCode(wrong.pairingCodeId, pairingSecret), {
    ok: false,
    reason: "locked-code",
  });

  const expired = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
    ttlMs: 500,
  });
  setNow(2_000);
  assert.deepEqual(coordinator.consumePairingCode(expired.pairingCodeId, pairingSecret), {
    ok: false,
    reason: "expired-code",
  });

  setNow(1_000);
  const revoked = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
  });
  coordinator.stores.pairingCodes.revokePairingCode(revoked.pairingCodeId);
  assert.deepEqual(coordinator.consumePairingCode(revoked.pairingCodeId, pairingSecret), {
    ok: false,
    reason: "revoked-code",
  });

  const consumed = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
  });
  assert.equal(coordinator.consumePairingCode(consumed.pairingCodeId, pairingSecret).ok, true);
  assert.deepEqual(coordinator.consumePairingCode(consumed.pairingCodeId, pairingSecret), {
    ok: false,
    reason: "consumed-code",
  });
});

test("revoking one session invalidates session verification and associated csrf tokens", () => {
  const { coordinator } = testCoordinator();
  const pairing = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
  });
  const session = coordinator.createSessionFromPairingCode({
    pairingCodeId: pairing.pairingCodeId,
    pairingCodeSecret: pairingSecret,
    sessionVerifierSecret: sessionSecret,
  });
  assert.equal(session.ok, true);
  if (!session.ok) throw new Error("Expected session creation to succeed.");
  const csrf = coordinator.createCsrfTokenForSession({
    sessionId: session.sessionId,
    csrfTokenSecret: csrfSecret,
  });
  assert.equal(csrf.ok, true);
  if (!csrf.ok) throw new Error("Expected csrf creation to succeed.");

  const revoked = coordinator.revokeSession(session.sessionId);

  assert.deepEqual(revoked, { revokedSession: true, revokedCsrfTokenCount: 1 });
  assert.deepEqual(coordinator.verifySession(session.sessionId, sessionSecret), {
    ok: false,
    reason: "revoked-session",
  });
  assert.deepEqual(coordinator.verifyCsrfToken(csrf.csrfTokenId, csrfSecret), {
    ok: false,
    reason: "revoked-token",
  });
});

test("revoking all sessions for a subject affects only that subject", () => {
  const { coordinator } = testCoordinator();
  const subjectA = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: "pairing-a",
  });
  const sessionA = coordinator.createSessionFromPairingCode({
    pairingCodeId: subjectA.pairingCodeId,
    pairingCodeSecret: "pairing-a",
    sessionVerifierSecret: "session-a",
  });
  const subjectB = coordinator.createPairingCode({
    subjectId: "subject-b",
    pairingCodeSecret: "pairing-b",
  });
  const sessionB = coordinator.createSessionFromPairingCode({
    pairingCodeId: subjectB.pairingCodeId,
    pairingCodeSecret: "pairing-b",
    sessionVerifierSecret: "session-b",
  });
  assert.equal(sessionA.ok, true);
  assert.equal(sessionB.ok, true);
  if (!sessionA.ok || !sessionB.ok) throw new Error("Expected session creation to succeed.");
  coordinator.createCsrfTokenForSession({
    sessionId: sessionA.sessionId,
    csrfTokenSecret: "csrf-a",
  });
  coordinator.createCsrfTokenForSession({
    sessionId: sessionB.sessionId,
    csrfTokenSecret: "csrf-b",
  });

  const revoked = coordinator.revokeAllSessionsForSubject("subject-a");

  assert.deepEqual(revoked, { revokedSessionCount: 1, revokedCsrfTokenCount: 1 });
  assert.deepEqual(coordinator.verifySession(sessionA.sessionId, "session-a"), {
    ok: false,
    reason: "revoked-session",
  });
  assert.equal(coordinator.verifySession(sessionB.sessionId, "session-b").ok, true);
});

test("coordinator diagnostics audit events and cookie metadata expose no secrets or hashes", () => {
  const { coordinator } = testCoordinator();
  const pairing = coordinator.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: pairingSecret,
  });
  const session = coordinator.createSessionFromPairingCode({
    pairingCodeId: pairing.pairingCodeId,
    pairingCodeSecret: pairingSecret,
    sessionVerifierSecret: sessionSecret,
  });
  assert.equal(session.ok, true);
  if (!session.ok) throw new Error("Expected session creation to succeed.");
  coordinator.createCsrfTokenForSession({
    sessionId: session.sessionId,
    csrfTokenSecret: csrfSecret,
  });

  const diagnostics = coordinator.diagnostics();
  const auditEvents = coordinator.auditEvents();
  const cookieMetadata = coordinator.plannedCookieMetadata();

  assert.equal(diagnostics.pairingCodeCount, 1);
  assert.equal(diagnostics.sessionCount, 1);
  assert.equal(diagnostics.csrfTokenCount, 1);
  assert.equal(diagnostics.auditEventCount, auditEvents.length);
  assert.equal(cookieMetadata.emitsSetCookieHeader, false);
  assert.equal(cookieMetadata.acceptsCookieCredential, false);
  assert.equal(cookieMetadata.sessionCookie.issueSetCookieHeader, false);
  assert.equal(cookieMetadata.sessionCookie.acceptsCookieCredential, false);
  assertNoSecretMaterial({ diagnostics, auditEvents, cookieMetadata });
});

test("lifecycle coordinator is not imported into live server or authorization paths", async () => {
  const liveSourceFiles = [
    "backend/server.ts",
    "backend/protectedModeEnforcement.ts",
    "backend/protectedRequestPipeline.ts",
    "backend/requestAuthorizationPlanner.ts",
    "backend/httpCredentialAdapter.ts",
  ];

  for (const file of liveSourceFiles) {
    const source = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(source.includes("./browserAuthLifecycleCoordinator.js"), false);
    assert.equal(source.includes("createInMemoryBrowserAuthLifecycleCoordinator"), false);
  }
});
