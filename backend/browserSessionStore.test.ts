import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_SESSION_STORE_NETWORK_EXPOSURE_SAFE,
  BROWSER_SESSION_STORE_WIRED_INTO_AUTHORIZATION,
  createInMemoryBrowserSessionStore,
} from "./browserSessionStore.js";

const verifierSecret = "bsver_test_store_secret";
const cookieValue = `bsess_test.${verifierSecret}`;

function testStore(nowMs = 1_000) {
  let currentTime = nowMs;
  return {
    setNow(next: number) {
      currentTime = next;
    },
    store: createInMemoryBrowserSessionStore({ clock: () => currentTime }),
  };
}

test("in-memory browser session store creates records without storing raw verifier material", () => {
  const { store } = testStore();
  const record = store.createSession({
    subjectId: "subject-a",
    verifierSecret,
    expiresAtMs: 2_000,
    sessionId: "bsess_test_1",
    userAgentHint: "AREPO test browser",
    originHint: "http://127.0.0.1:8733",
  });
  const serialized = JSON.stringify(record);

  assert.equal(record.sessionId, "bsess_test_1");
  assert.equal(record.subjectId, "subject-a");
  assert.match(record.verifierHash, /^sha256:/);
  assert.equal(record.createdAtMs, 1_000);
  assert.equal(record.expiresAtMs, 2_000);
  assert.equal(record.revokedAtMs, null);
  assert.equal(serialized.includes(verifierSecret), false);
  assert.equal(serialized.includes(cookieValue), false);
  assert.equal("verifierSecret" in record, false);
  assert.equal("cookieValue" in record, false);
});

test("in-memory browser session store verifies valid sessions and updates last use", () => {
  const { store } = testStore();
  store.createSession({
    subjectId: "subject-a",
    verifierSecret,
    expiresAtMs: 2_000,
    sessionId: "bsess_test_1",
  });

  const result = store.verifySession("bsess_test_1", verifierSecret);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.record.lastUsedAtMs, 1_000);
    assert.equal(result.record.verifierHash.includes(verifierSecret), false);
  }
});

test("in-memory browser session store rejects missing wrong expired and revoked sessions", () => {
  const { setNow, store } = testStore();
  store.createSession({
    subjectId: "subject-a",
    verifierSecret,
    expiresAtMs: 2_000,
    sessionId: "bsess_test_1",
  });

  assert.deepEqual(store.verifySession("missing-session", verifierSecret), {
    ok: false,
    reason: "missing-session",
  });
  assert.deepEqual(store.verifySession("bsess_test_1", "wrong-secret"), {
    ok: false,
    reason: "wrong-verifier",
  });
  setNow(2_000);
  assert.deepEqual(store.verifySession("bsess_test_1", verifierSecret), {
    ok: false,
    reason: "expired-session",
  });

  setNow(1_000);
  store.revokeSession("bsess_test_1");
  assert.deepEqual(store.verifySession("bsess_test_1", verifierSecret), {
    ok: false,
    reason: "revoked-session",
  });
});

test("revokeAllForSubject invalidates only matching subject sessions", () => {
  const { store } = testStore();
  store.createSession({
    subjectId: "subject-a",
    verifierSecret: "secret-a-1",
    expiresAtMs: 5_000,
    sessionId: "bsess_a_1",
  });
  store.createSession({
    subjectId: "subject-a",
    verifierSecret: "secret-a-2",
    expiresAtMs: 5_000,
    sessionId: "bsess_a_2",
  });
  store.createSession({
    subjectId: "subject-b",
    verifierSecret: "secret-b-1",
    expiresAtMs: 5_000,
    sessionId: "bsess_b_1",
  });

  assert.equal(store.revokeAllForSubject("subject-a"), 2);
  assert.deepEqual(store.verifySession("bsess_a_1", "secret-a-1"), {
    ok: false,
    reason: "revoked-session",
  });
  assert.deepEqual(store.verifySession("bsess_a_2", "secret-a-2"), {
    ok: false,
    reason: "revoked-session",
  });
  assert.equal(store.verifySession("bsess_b_1", "secret-b-1").ok, true);
});

test("pruneExpired removes expired sessions and keeps live sessions", () => {
  const { setNow, store } = testStore();
  store.createSession({
    subjectId: "subject-a",
    verifierSecret: "expired-secret",
    expiresAtMs: 1_500,
    sessionId: "bsess_expired",
  });
  store.createSession({
    subjectId: "subject-a",
    verifierSecret: "live-secret",
    expiresAtMs: 3_000,
    sessionId: "bsess_live",
  });

  setNow(2_000);
  assert.equal(store.pruneExpired(), 1);
  assert.equal(store.getSession("bsess_expired"), undefined);
  assert.equal(store.getSession("bsess_live")?.sessionId, "bsess_live");
});

test("public diagnostics never expose verifier hashes raw secrets cookie values or token material", () => {
  const { setNow, store } = testStore();
  store.createSession({
    subjectId: "subject-a",
    verifierSecret,
    expiresAtMs: 2_000,
    sessionId: "bsess_test_1",
  });
  store.createSession({
    subjectId: "subject-b",
    verifierSecret: "revoked-secret",
    expiresAtMs: 5_000,
    sessionId: "bsess_test_2",
  });
  store.revokeSession("bsess_test_2");
  setNow(2_000);

  const diagnostics = store.diagnostics();
  const serialized = JSON.stringify(diagnostics);

  assert.equal(diagnostics.implementation, "in-memory-test-primitive");
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.networkExposureSafe, false);
  assert.equal(diagnostics.totalSessionCount, 2);
  assert.equal(diagnostics.expiredSessionCount, 1);
  assert.equal(diagnostics.revokedSessionCount, 1);
  assert.equal(serialized.includes(verifierSecret), false);
  assert.equal(serialized.includes("revoked-secret"), false);
  assert.equal(serialized.includes(cookieValue), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("tokenMaterial"), false);
  assert.equal(serialized.includes("authorizationHeader"), false);
  assert.equal(serialized.includes("Set-Cookie"), false);
});

test("browser session store primitive remains inactive and not wired into live request authorization", async () => {
  assert.equal(BROWSER_SESSION_STORE_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_SESSION_STORE_WIRED_INTO_AUTHORIZATION, false);

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
    assert.equal(source.includes("browserSessionVerifier"), false);
    assert.equal(source.includes("createInMemoryBrowserSessionStore"), false);
  }
});
