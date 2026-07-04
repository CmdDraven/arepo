import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_PAIRING_CODE_STORE_NETWORK_EXPOSURE_SAFE,
  BROWSER_PAIRING_CODE_STORE_WIRED_INTO_AUTHORIZATION,
  BROWSER_PAIRING_CODE_STORE_WIRED_INTO_ROUTES,
  createInMemoryBrowserPairingCodeStore,
} from "./browserPairingCodeStore.js";

const pairingCodeSecret = "bpairsec_test_store_secret";
const cookieValue = `bpair_test.${pairingCodeSecret}`;
const bearerToken = "arepo_test_bearer_token";
const sessionVerifierSecret = "bsver_test_session_secret";
const csrfTokenSecret = "bcsrfsec_test_secret";

function testStore(nowMs = 1_000) {
  let currentTime = nowMs;
  return {
    setNow(next: number) {
      currentTime = next;
    },
    store: createInMemoryBrowserPairingCodeStore({ clock: () => currentTime }),
  };
}

test("in-memory browser pairing code store creates records without storing raw code material", () => {
  const { store } = testStore();
  const created = store.createPairingCode({
    pairingCodeSecret,
    expiresAtMs: 2_000,
    pairingCodeId: "bpair_test_1",
    subjectId: "subject-a",
    deviceLabel: "Operator laptop",
    originHint: "http://127.0.0.1:8733",
  });
  const serialized = JSON.stringify(created.record);

  assert.equal(created.pairingCodeSecret, pairingCodeSecret);
  assert.equal(created.record.pairingCodeId, "bpair_test_1");
  assert.match(created.record.pairingCodeHash, /^sha256:/);
  assert.equal(created.record.createdAtMs, 1_000);
  assert.equal(created.record.expiresAtMs, 2_000);
  assert.equal(created.record.consumedAtMs, null);
  assert.equal(created.record.revokedAtMs, null);
  assert.equal(created.record.failedAttemptCount, 0);
  assert.equal(created.record.maxFailedAttempts, 5);
  assert.equal(serialized.includes(pairingCodeSecret), false);
  assert.equal(serialized.includes(cookieValue), false);
  assert.equal("pairingCodeSecret" in created.record, false);
});

test("in-memory browser pairing code store verifies valid codes", () => {
  const { store } = testStore();
  store.createPairingCode({
    pairingCodeSecret,
    expiresAtMs: 2_000,
    pairingCodeId: "bpair_test_1",
  });

  const result = store.verifyPairingCode("bpair_test_1", pairingCodeSecret);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.record.pairingCodeHash.includes(pairingCodeSecret), false);
  }
});

test("pairing code verification rejects missing wrong expired revoked and consumed codes", () => {
  const { setNow, store } = testStore();
  store.createPairingCode({
    pairingCodeSecret,
    expiresAtMs: 2_000,
    pairingCodeId: "bpair_test_1",
  });

  assert.deepEqual(store.verifyPairingCode("missing-code", pairingCodeSecret), {
    ok: false,
    reason: "missing-code",
  });
  assert.deepEqual(store.verifyPairingCode("bpair_test_1", "wrong-secret"), {
    ok: false,
    reason: "wrong-code",
    failedAttemptCount: 1,
  });
  setNow(2_000);
  assert.deepEqual(store.verifyPairingCode("bpair_test_1", pairingCodeSecret), {
    ok: false,
    reason: "expired-code",
  });

  setNow(1_000);
  store.revokePairingCode("bpair_test_1");
  assert.deepEqual(store.verifyPairingCode("bpair_test_1", pairingCodeSecret), {
    ok: false,
    reason: "revoked-code",
  });

  store.createPairingCode({
    pairingCodeSecret: "one-time-secret",
    expiresAtMs: 2_000,
    pairingCodeId: "bpair_test_2",
  });
  assert.equal(store.consumePairingCode("bpair_test_2", "one-time-secret").ok, true);
  assert.deepEqual(store.verifyPairingCode("bpair_test_2", "one-time-secret"), {
    ok: false,
    reason: "consumed-code",
  });
});

test("valid pairing code can be consumed only once", () => {
  const { store } = testStore();
  store.createPairingCode({
    pairingCodeSecret,
    expiresAtMs: 2_000,
    pairingCodeId: "bpair_test_1",
  });

  const first = store.consumePairingCode("bpair_test_1", pairingCodeSecret);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.record.consumedAtMs, 1_000);
  assert.deepEqual(store.consumePairingCode("bpair_test_1", pairingCodeSecret), {
    ok: false,
    reason: "consumed-code",
  });
});

test("failed attempt counting and max attempt lockout work without exposing secrets", () => {
  const { store } = testStore();
  store.createPairingCode({
    pairingCodeSecret,
    expiresAtMs: 2_000,
    pairingCodeId: "bpair_test_1",
    maxFailedAttempts: 2,
  });

  assert.deepEqual(store.verifyPairingCode("bpair_test_1", "wrong-1"), {
    ok: false,
    reason: "wrong-code",
    failedAttemptCount: 1,
  });
  assert.deepEqual(store.verifyPairingCode("bpair_test_1", "wrong-2"), {
    ok: false,
    reason: "locked-code",
    failedAttemptCount: 2,
  });
  assert.deepEqual(store.verifyPairingCode("bpair_test_1", pairingCodeSecret), {
    ok: false,
    reason: "locked-code",
  });
  const record = store.getPairingCode("bpair_test_1");
  assert.equal(record?.failedAttemptCount, 2);
  assert.equal(JSON.stringify(record).includes("wrong-1"), false);
  assert.equal(JSON.stringify(record).includes("wrong-2"), false);
});

test("revokePairingCodesForSubject invalidates only matching subject codes", () => {
  const { store } = testStore();
  store.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: "secret-a-1",
    expiresAtMs: 5_000,
    pairingCodeId: "bpair_a_1",
  });
  store.createPairingCode({
    subjectId: "subject-a",
    pairingCodeSecret: "secret-a-2",
    expiresAtMs: 5_000,
    pairingCodeId: "bpair_a_2",
  });
  store.createPairingCode({
    subjectId: "subject-b",
    pairingCodeSecret: "secret-b-1",
    expiresAtMs: 5_000,
    pairingCodeId: "bpair_b_1",
  });

  assert.equal(store.revokePairingCodesForSubject("subject-a"), 2);
  assert.deepEqual(store.verifyPairingCode("bpair_a_1", "secret-a-1"), {
    ok: false,
    reason: "revoked-code",
  });
  assert.deepEqual(store.verifyPairingCode("bpair_a_2", "secret-a-2"), {
    ok: false,
    reason: "revoked-code",
  });
  assert.equal(store.verifyPairingCode("bpair_b_1", "secret-b-1").ok, true);
});

test("pruneInactive removes expired and consumed codes and keeps live codes", () => {
  const { setNow, store } = testStore();
  store.createPairingCode({
    pairingCodeSecret: "expired-secret",
    expiresAtMs: 1_500,
    pairingCodeId: "bpair_expired",
  });
  store.createPairingCode({
    pairingCodeSecret: "consumed-secret",
    expiresAtMs: 3_000,
    pairingCodeId: "bpair_consumed",
  });
  store.createPairingCode({
    pairingCodeSecret: "live-secret",
    expiresAtMs: 3_000,
    pairingCodeId: "bpair_live",
  });
  store.consumePairingCode("bpair_consumed", "consumed-secret");

  setNow(2_000);
  assert.equal(store.pruneInactive(), 2);
  assert.equal(store.getPairingCode("bpair_expired"), undefined);
  assert.equal(store.getPairingCode("bpair_consumed"), undefined);
  assert.equal(store.getPairingCode("bpair_live")?.pairingCodeId, "bpair_live");
});

test("public diagnostics never expose pairing codes cookies bearer tokens session csrf secrets or hashes", () => {
  const { setNow, store } = testStore();
  store.createPairingCode({
    pairingCodeSecret,
    expiresAtMs: 2_000,
    pairingCodeId: "bpair_test_1",
  });
  store.createPairingCode({
    pairingCodeSecret: "revoked-secret",
    expiresAtMs: 5_000,
    pairingCodeId: "bpair_test_2",
  });
  store.revokePairingCode("bpair_test_2");
  setNow(2_000);

  const diagnostics = store.diagnostics();
  const serialized = JSON.stringify(diagnostics);

  assert.equal(diagnostics.implementation, "in-memory-test-primitive");
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.networkExposureSafe, false);
  assert.equal(diagnostics.totalCodeCount, 2);
  assert.equal(diagnostics.expiredCodeCount, 1);
  assert.equal(diagnostics.revokedCodeCount, 1);
  assert.equal(serialized.includes(pairingCodeSecret), false);
  assert.equal(serialized.includes("revoked-secret"), false);
  assert.equal(serialized.includes(cookieValue), false);
  assert.equal(serialized.includes(bearerToken), false);
  assert.equal(serialized.includes(sessionVerifierSecret), false);
  assert.equal(serialized.includes(csrfTokenSecret), false);
  assert.equal(serialized.includes("pairingCodeHash"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("tokenHash"), false);
  assert.equal(serialized.includes("authorizationHeader"), false);
  assert.equal(serialized.includes("Set-Cookie"), false);
});

test("browser pairing code store primitive remains inactive and not wired into live request authorization", async () => {
  assert.equal(BROWSER_PAIRING_CODE_STORE_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_PAIRING_CODE_STORE_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_PAIRING_CODE_STORE_WIRED_INTO_ROUTES, false);

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
    assert.equal(source.includes("browserPairingCodeStore"), false);
    assert.equal(source.includes("browserPairingCodeVerifier"), false);
    assert.equal(source.includes("createInMemoryBrowserPairingCodeStore"), false);
  }
});
