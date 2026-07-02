import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  SESSION_VERIFIER_NETWORK_EXPOSURE_SAFE,
  SESSION_VERIFIER_SCHEME,
  createBrowserSessionVerifierMetadata,
  createSessionDisplayPrefix,
  createSessionLookupId,
  planBrowserSessionLogout,
  planBrowserSessionRenewal,
  verifyBrowserSessionMaterial,
} from "./sessionVerifier.js";
import type { BrowserSessionMetadata } from "./credentialStore.js";

const sessionSecretMaterial = "arepo_test_browser_session_secret_123";
const createdAt = "2026-07-02T00:00:00.000Z";
const expiresAt = "2026-07-02T01:00:00.000Z";
const salt = Buffer.from("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", "hex");
const hashParameters = {
  scheme: SESSION_VERIFIER_SCHEME,
  iterations: 100_000,
  digest: "sha256" as const,
  keyLength: 32,
  saltLength: 32,
} as const;

function session(overrides: Partial<BrowserSessionMetadata> = {}): BrowserSessionMetadata {
  return {
    ...createBrowserSessionVerifierMetadata({
      sessionSecretMaterial,
      credentialId: "credential-1",
      sessionId: "session-1",
      verifierId: "session-verifier-1",
      createdAt,
      expiresAt,
      sameSite: "strict",
      csrfBindingId: "csrf-binding-1",
      salt,
      hashParameters,
    }),
    ...overrides,
  };
}

test("creating browser session verifier metadata stores lookup prefix salt and hash without plaintext secret", () => {
  const metadata = session();
  const serialized = JSON.stringify(metadata);

  assert.equal(metadata.credentialId, "credential-1");
  assert.equal(metadata.sessionId, "session-1");
  assert.equal(metadata.verifierId, "session-verifier-1");
  assert.equal(metadata.lookupId, createSessionLookupId(sessionSecretMaterial));
  assert.equal(metadata.displayPrefix, createSessionDisplayPrefix(sessionSecretMaterial));
  assert.equal(metadata.saltId, salt.toString("hex"));
  assert.equal(metadata.hashAlgorithm, "sha256");
  assert.equal(metadata.hashParameters.scheme, SESSION_VERIFIER_SCHEME);
  assert.equal(typeof metadata.verifierHash, "string");
  assert.equal(metadata.csrfBindingId, "csrf-binding-1");
  assert.equal(serialized.includes(sessionSecretMaterial), false);
  assert.equal("sessionSecret" in metadata, false);
  assert.equal("cookie" in metadata, false);
});

test("correct supplied session secret verifies successfully", () => {
  assert.deepEqual(
    verifyBrowserSessionMaterial(sessionSecretMaterial, session(), new Date(createdAt)),
    {
      ok: true,
    },
  );
});

test("incorrect supplied session secret fails verification", () => {
  assert.deepEqual(
    verifyBrowserSessionMaterial("wrong-session-secret", session(), new Date(createdAt)),
    {
      ok: false,
      reason: "mismatch",
    },
  );
});

test("expired session metadata fails verification", () => {
  const result = verifyBrowserSessionMaterial(
    sessionSecretMaterial,
    session({ expiresAt: "2026-07-01T00:00:00.000Z" }),
    new Date("2026-07-02T00:00:00.000Z"),
  );
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

test("revoked session metadata fails verification", () => {
  assert.deepEqual(
    verifyBrowserSessionMaterial(sessionSecretMaterial, session({ revokedAt: createdAt })),
    {
      ok: false,
      reason: "revoked",
    },
  );
});

test("logged out session metadata fails verification", () => {
  assert.deepEqual(
    verifyBrowserSessionMaterial(sessionSecretMaterial, session({ loggedOutAt: createdAt })),
    {
      ok: false,
      reason: "logged-out",
    },
  );
});

test("renewal planning allows only valid non-expired non-revoked sessions", () => {
  assert.deepEqual(planBrowserSessionRenewal(session(), new Date(createdAt)), {
    status: "eligible",
    sessionId: "session-1",
    currentExpiresAt: expiresAt,
    networkExposureSafe: false,
  });
  assert.deepEqual(
    planBrowserSessionRenewal(
      session({ expiresAt: "2026-07-01T00:00:00.000Z" }),
      new Date(createdAt),
    ),
    { status: "denied", reason: "expired", networkExposureSafe: false },
  );
  assert.deepEqual(planBrowserSessionRenewal(session({ revokedAt: createdAt })), {
    status: "denied",
    reason: "revoked",
    networkExposureSafe: false,
  });
});

test("logout planning marks intended session id without deleting audit history", () => {
  const plan = planBrowserSessionLogout(session(), createdAt, "user logout");

  assert.equal(plan.status, "planned");
  if (plan.status === "planned") {
    assert.equal(plan.sessionId, "session-1");
    assert.deepEqual(plan.revocation, {
      targetKind: "browserSession",
      targetId: "session-1",
      revokedAt: createdAt,
      reason: "user logout",
    });
  }
  assert.equal(plan.preserveAuditHistory, true);
  assert.equal(plan.networkExposureSafe, false);
});

test("session verifier helper rejects malformed session metadata", () => {
  const malformed = session({
    hashParameters: {
      scheme: "sha256",
      iterations: 1,
      digest: "sha256",
      keyLength: 16,
      saltLength: 4,
    },
  });
  assert.deepEqual(verifyBrowserSessionMaterial(sessionSecretMaterial, malformed), {
    ok: false,
    reason: "malformed-session",
  });
});

test("session verifier helper errors do not include session secret material", () => {
  assert.throws(
    () =>
      createBrowserSessionVerifierMetadata({
        sessionSecretMaterial,
        credentialId: "credential-1",
        sessionId: "session-1",
        verifierId: "session-verifier-1",
        createdAt,
        expiresAt,
        sameSite: "strict",
        salt: Buffer.from("short"),
        hashParameters,
      }),
    (error) => error instanceof Error && !error.message.includes(sessionSecretMaterial),
  );
});

test("session verifier helpers do not claim network exposure is safe", () => {
  assert.equal(SESSION_VERIFIER_NETWORK_EXPOSURE_SAFE, false);
});

test("request handling does not import session verifier helpers", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  const nodeServiceSource = await fs.readFile(
    path.join(process.cwd(), "backend", "nodeService.ts"),
    "utf8",
  );
  assert.equal(serverSource.includes("sessionVerifier"), false);
  assert.equal(serverSource.includes("verifyBrowserSessionMaterial"), false);
  assert.equal(nodeServiceSource.includes("sessionVerifier"), false);
  assert.equal(nodeServiceSource.includes("verifyBrowserSessionMaterial"), false);
});
