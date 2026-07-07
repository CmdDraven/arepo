import test from "node:test";
import assert from "node:assert/strict";
import {
  createBetterAuthInternalAdapterWrapper,
  diagnostics,
  type BetterAuthInternalAdapterSessionRecord,
  type BetterAuthInternalAdapterUserRecord,
  type BetterAuthInternalAdapterWrapperAdapter,
} from "./betterAuthInternalAdapterWrapper.js";

const secretSamples = [
  "arepo_session=secret-cookie",
  "Bearer arepo_secret_token",
  "Authorization: Bearer arepo_secret_token",
  "Cookie: arepo_session=secret",
  "Set-Cookie: arepo_session=secret",
  "bpairsec_raw_pairing_code",
  "bsver_raw_session_secret",
  "bcsrfsec_raw_csrf_secret",
  "session.token=secret",
  "better-auth-secret",
  "actual-raw-session-token-value",
  "verifierHash",
  "tokenHash",
  "sha256:",
  "salt",
  "stack",
] as const;

function assertNoSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of secretSamples) {
    assert.equal(serialized.includes(secret), false, `wrapper exposed ${secret}`);
  }
}

test("Better Auth internal-adapter wrapper exposes only allowlisted operations", () => {
  const wrapper = createBetterAuthInternalAdapterWrapper(createFakeAdapter());
  const keys = Object.keys(wrapper).sort();

  assert.deepEqual(keys, [
    "createSessionForAcceptedArepoPairing",
    "diagnostics",
    "findOrCreateLocalSubjectUser",
    "lookupSessionForWrapperRegressionTests",
    "revokeAllSubjectSessionsThroughWrapper",
    "revokeCurrentSessionThroughWrapper",
  ]);
  assert.deepEqual(diagnostics().allowedOperations, [
    "find-or-create-local-subject-user",
    "create-session-for-accepted-arepo-pairing",
    "return-redacted-user-session-references",
    "lookup-session-for-wrapper-regression-tests",
    "revoke-current-session-through-wrapper",
    "revoke-all-subject-sessions-through-wrapper",
    "observe-expiry-state-through-wrapper",
  ]);
});

test("Better Auth internal-adapter wrapper records forbidden operations", () => {
  const wrapperDiagnostics = diagnostics();

  assert.equal(wrapperDiagnostics.status, "inactive");
  assert.equal(wrapperDiagnostics.mounted, false);
  assert.equal(wrapperDiagnostics.wiredIntoAuthorization, false);
  assert.equal(wrapperDiagnostics.wiredIntoRoutes, false);
  assert.equal(wrapperDiagnostics.exposesRawSessionTokens, false);
  assert.equal(wrapperDiagnostics.exposesCookies, false);
  assert.equal(wrapperDiagnostics.performsRouteAuthorization, false);
  assert.equal(wrapperDiagnostics.acceptsFrontendPermissionState, false);
  assert.equal(wrapperDiagnostics.storesVaultNodePermissionsInBetterAuth, false);
  assert.equal(wrapperDiagnostics.allowsArbitraryAdapterCalls, false);
  assert.ok(wrapperDiagnostics.forbiddenOperations.includes("direct-token-signing"));
  assert.ok(wrapperDiagnostics.forbiddenOperations.includes("raw-session-token-return"));
  assert.ok(wrapperDiagnostics.forbiddenOperations.includes("arbitrary-internal-adapter-call"));
  assert.ok(wrapperDiagnostics.forbiddenOperations.includes("route-authorization-decision"));
  assert.ok(wrapperDiagnostics.forbiddenOperations.includes("frontend-provided-permission-state"));
  assert.ok(
    wrapperDiagnostics.forbiddenOperations.includes("vault-node-permission-cookie-storage"),
  );
  assertNoSecretMaterial(wrapperDiagnostics);
});

test("Better Auth internal-adapter wrapper creates or finds local subject user with safe references", async () => {
  const adapter = createFakeAdapter();
  const wrapper = createBetterAuthInternalAdapterWrapper(adapter);

  const created = await wrapper.findOrCreateLocalSubjectUser({
    localSubjectId: "local-operator",
    displayName: "Operator token secret cookie",
  });
  const found = await wrapper.findOrCreateLocalSubjectUser({ localSubjectId: "local-operator" });

  assert.equal(created.ok, true);
  assert.equal(found.ok, true);
  assert.equal(created.ok && created.value.created, true);
  assert.equal(found.ok && found.value.created, false);
  assert.equal(created.ok && created.value.userReference.kind, "better-auth-user-reference");
  assert.equal(created.ok && created.value.userReference.redacted, true);
  assertNoSecretMaterial(created);
  assertNoSecretMaterial(found);
});

test("Better Auth internal-adapter wrapper creates pairing session without returning token material", async () => {
  const wrapper = createBetterAuthInternalAdapterWrapper(createFakeAdapter());
  const user = await wrapper.findOrCreateLocalSubjectUser({ localSubjectId: "local-operator" });
  assert.equal(user.ok, true);
  if (!user.ok) return;

  const session = await wrapper.createSessionForAcceptedArepoPairing({
    userId: user.value.userId,
    localSubjectId: "local-operator",
    deviceLabel: "Laptop with token cookie secret",
    expiresAt: new Date(Date.now() + 60_000),
  });

  assert.equal(session.ok, true);
  assert.equal(session.ok && session.value.sessionReference.kind, "better-auth-session-reference");
  assert.equal(session.ok && session.value.sessionReference.redacted, true);
  assertNoSecretMaterial(session);
});

test("Better Auth internal-adapter wrapper supports lookup revoke and revoke-all with safe output", async () => {
  const wrapper = createBetterAuthInternalAdapterWrapper(createFakeAdapter());
  const user = await wrapper.findOrCreateLocalSubjectUser({ localSubjectId: "local-operator" });
  assert.equal(user.ok, true);
  if (!user.ok) return;
  const session = await wrapper.createSessionForAcceptedArepoPairing({
    userId: user.value.userId,
    localSubjectId: "local-operator",
  });
  assert.equal(session.ok, true);
  if (!session.ok) return;

  const lookup = await wrapper.lookupSessionForWrapperRegressionTests({
    sessionId: session.value.sessionId,
  });
  const revoke = await wrapper.revokeCurrentSessionThroughWrapper({
    sessionId: session.value.sessionId,
  });
  const revokeAll = await wrapper.revokeAllSubjectSessionsThroughWrapper({
    userId: user.value.userId,
  });

  assert.equal(lookup.ok, true);
  assert.equal(revoke.ok, true);
  assert.equal(revoke.ok && revoke.value.revoked, true);
  assert.equal(revokeAll.ok, true);
  assertNoSecretMaterial({ lookup, revoke, revokeAll });
});

test("Better Auth internal-adapter wrapper sanitizes rejected results", async () => {
  const wrapper = createBetterAuthInternalAdapterWrapper(createFakeAdapter());

  const missingUser = await wrapper.findOrCreateLocalSubjectUser({
    localSubjectId: "token cookie secret",
  });
  const missingSession = await wrapper.lookupSessionForWrapperRegressionTests({
    sessionId: "cookie token secret",
  });

  assert.equal(missingUser.ok, true);
  assert.equal(missingSession.ok, true);
  assertNoSecretMaterial({ missingUser, missingSession });
});

function createFakeAdapter(): BetterAuthInternalAdapterWrapperAdapter {
  const users = new Map<string, BetterAuthInternalAdapterUserRecord>();
  const sessions = new Map<string, BetterAuthInternalAdapterSessionRecord>();
  let userCounter = 0;
  let sessionCounter = 0;

  return {
    async findUserByEmail(email) {
      const user = users.get(email);
      return user ? { user, accounts: [] } : null;
    },
    async createUser(input) {
      userCounter += 1;
      const user = {
        id: `ba-user-${userCounter}`,
        email: input.email,
        name: input.name,
      };
      users.set(input.email, user);
      return { user };
    },
    async createSession(userId, input) {
      sessionCounter += 1;
      const session = {
        id: `ba-session-${sessionCounter}`,
        userId,
        expiresAt: input.expiresAt,
      };
      sessions.set(session.id, session);
      return session;
    },
    async findSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },
    async revokeSession(sessionId) {
      return sessions.delete(sessionId);
    },
    async listSessions(userId) {
      return [...sessions.values()].filter((session) => session.userId === userId);
    },
    async revokeSessions(userId) {
      let count = 0;
      for (const session of [...sessions.values()]) {
        if (session.userId === userId) {
          sessions.delete(session.id);
          count += 1;
        }
      }
      return count;
    },
  };
}
