import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_CSRF_TOKEN_STORE_NETWORK_EXPOSURE_SAFE,
  BROWSER_CSRF_TOKEN_STORE_WIRED_INTO_AUTHORIZATION,
  BROWSER_CSRF_TOKEN_STORE_WIRED_INTO_ROUTES,
  createInMemoryBrowserCsrfTokenStore,
} from "./browserCsrfTokenStore.js";

const tokenSecret = "bcsrfsec_test_store_secret";
const cookieValue = `bcsrf_test.${tokenSecret}`;
const bearerToken = "arepo_test_bearer_token";
const sessionVerifierSecret = "bsver_test_session_secret";

function testStore(nowMs = 1_000) {
  let currentTime = nowMs;
  return {
    setNow(next: number) {
      currentTime = next;
    },
    store: createInMemoryBrowserCsrfTokenStore({ clock: () => currentTime }),
  };
}

test("in-memory browser csrf token store creates records without storing raw token material", () => {
  const { store } = testStore();
  const record = store.createToken({
    sessionId: "bsess_test_1",
    tokenSecret,
    expiresAtMs: 2_000,
    csrfTokenId: "bcsrf_test_1",
    originHint: "http://127.0.0.1:8733",
  });
  const serialized = JSON.stringify(record);

  assert.equal(record.csrfTokenId, "bcsrf_test_1");
  assert.equal(record.sessionId, "bsess_test_1");
  assert.match(record.tokenHash, /^sha256:/);
  assert.equal(record.createdAtMs, 1_000);
  assert.equal(record.expiresAtMs, 2_000);
  assert.equal(record.revokedAtMs, null);
  assert.equal(record.consumedAtMs, null);
  assert.equal(serialized.includes(tokenSecret), false);
  assert.equal(serialized.includes(cookieValue), false);
  assert.equal("tokenSecret" in record, false);
  assert.equal("cookieValue" in record, false);
});

test("in-memory browser csrf token store verifies valid tokens", () => {
  const { store } = testStore();
  store.createToken({
    sessionId: "bsess_test_1",
    tokenSecret,
    expiresAtMs: 2_000,
    csrfTokenId: "bcsrf_test_1",
  });

  const result = store.verifyToken("bcsrf_test_1", tokenSecret);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.record.tokenHash.includes(tokenSecret), false);
  }
});

test("in-memory browser csrf token store rejects missing wrong expired revoked and consumed tokens", () => {
  const { setNow, store } = testStore();
  store.createToken({
    sessionId: "bsess_test_1",
    tokenSecret,
    expiresAtMs: 2_000,
    csrfTokenId: "bcsrf_test_1",
  });

  assert.deepEqual(store.verifyToken("missing-token", tokenSecret), {
    ok: false,
    reason: "missing-token",
  });
  assert.deepEqual(store.verifyToken("bcsrf_test_1", "wrong-secret"), {
    ok: false,
    reason: "wrong-token",
  });
  setNow(2_000);
  assert.deepEqual(store.verifyToken("bcsrf_test_1", tokenSecret), {
    ok: false,
    reason: "expired-token",
  });

  setNow(1_000);
  store.revokeToken("bcsrf_test_1");
  assert.deepEqual(store.verifyToken("bcsrf_test_1", tokenSecret), {
    ok: false,
    reason: "revoked-token",
  });

  store.createToken({
    sessionId: "bsess_test_1",
    tokenSecret: "one-time-secret",
    expiresAtMs: 2_000,
    csrfTokenId: "bcsrf_test_2",
  });
  store.consumeToken("bcsrf_test_2");
  assert.deepEqual(store.verifyToken("bcsrf_test_2", "one-time-secret"), {
    ok: false,
    reason: "consumed-token",
  });
});

test("revokeTokensForSession invalidates only matching session tokens", () => {
  const { store } = testStore();
  store.createToken({
    sessionId: "bsess_a",
    tokenSecret: "secret-a-1",
    expiresAtMs: 5_000,
    csrfTokenId: "bcsrf_a_1",
  });
  store.createToken({
    sessionId: "bsess_a",
    tokenSecret: "secret-a-2",
    expiresAtMs: 5_000,
    csrfTokenId: "bcsrf_a_2",
  });
  store.createToken({
    sessionId: "bsess_b",
    tokenSecret: "secret-b-1",
    expiresAtMs: 5_000,
    csrfTokenId: "bcsrf_b_1",
  });

  assert.equal(store.revokeTokensForSession("bsess_a"), 2);
  assert.deepEqual(store.verifyToken("bcsrf_a_1", "secret-a-1"), {
    ok: false,
    reason: "revoked-token",
  });
  assert.deepEqual(store.verifyToken("bcsrf_a_2", "secret-a-2"), {
    ok: false,
    reason: "revoked-token",
  });
  assert.equal(store.verifyToken("bcsrf_b_1", "secret-b-1").ok, true);
});

test("pruneExpired removes expired csrf tokens and keeps live tokens", () => {
  const { setNow, store } = testStore();
  store.createToken({
    sessionId: "bsess_test_1",
    tokenSecret: "expired-secret",
    expiresAtMs: 1_500,
    csrfTokenId: "bcsrf_expired",
  });
  store.createToken({
    sessionId: "bsess_test_1",
    tokenSecret: "live-secret",
    expiresAtMs: 3_000,
    csrfTokenId: "bcsrf_live",
  });

  setNow(2_000);
  assert.equal(store.pruneExpired(), 1);
  assert.equal(store.getToken("bcsrf_expired"), undefined);
  assert.equal(store.getToken("bcsrf_live")?.csrfTokenId, "bcsrf_live");
});

test("public diagnostics never expose csrf secrets cookies bearer tokens session secrets or hashes", () => {
  const { setNow, store } = testStore();
  store.createToken({
    sessionId: "bsess_test_1",
    tokenSecret,
    expiresAtMs: 2_000,
    csrfTokenId: "bcsrf_test_1",
  });
  store.createToken({
    sessionId: "bsess_test_2",
    tokenSecret: "revoked-secret",
    expiresAtMs: 5_000,
    csrfTokenId: "bcsrf_test_2",
  });
  store.revokeToken("bcsrf_test_2");
  setNow(2_000);

  const diagnostics = store.diagnostics();
  const serialized = JSON.stringify(diagnostics);

  assert.equal(diagnostics.implementation, "in-memory-test-primitive");
  assert.equal(diagnostics.wiredIntoAuthorization, false);
  assert.equal(diagnostics.wiredIntoRoutes, false);
  assert.equal(diagnostics.networkExposureSafe, false);
  assert.equal(diagnostics.totalTokenCount, 2);
  assert.equal(diagnostics.expiredTokenCount, 1);
  assert.equal(diagnostics.revokedTokenCount, 1);
  assert.equal(serialized.includes(tokenSecret), false);
  assert.equal(serialized.includes("revoked-secret"), false);
  assert.equal(serialized.includes(cookieValue), false);
  assert.equal(serialized.includes(bearerToken), false);
  assert.equal(serialized.includes(sessionVerifierSecret), false);
  assert.equal(serialized.includes("tokenHash"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes("authorizationHeader"), false);
  assert.equal(serialized.includes("Set-Cookie"), false);
});

test("browser csrf token store primitive remains inactive and not wired into live request authorization", async () => {
  assert.equal(BROWSER_CSRF_TOKEN_STORE_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(BROWSER_CSRF_TOKEN_STORE_WIRED_INTO_AUTHORIZATION, false);
  assert.equal(BROWSER_CSRF_TOKEN_STORE_WIRED_INTO_ROUTES, false);

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
    assert.equal(source.includes("browserCsrfTokenStore"), false);
    assert.equal(source.includes("browserCsrfTokenVerifier"), false);
    assert.equal(source.includes("createInMemoryBrowserCsrfTokenStore"), false);
  }
});
