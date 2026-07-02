import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planAuthRevocation } from "./authRevocation.js";
import type {
  BrowserSessionMetadata,
  CredentialMetadata,
  NodeSecretMetadata,
  TokenVerifierMetadata,
} from "./credentialStore.js";

const now = "2026-07-02T00:00:00.000Z";

const credentials: CredentialMetadata[] = [
  credential("browser-1", "browserSession", ["verifier-1"], ["session-1"]),
  credential("api-1", "apiToken", ["verifier-2"], []),
  credential("node-1", "futureNode", ["verifier-3"], ["session-2"]),
  { ...credential("revoked-1", "apiToken", ["verifier-4"], []), revokedAt: now },
];

const verifiers: TokenVerifierMetadata[] = [
  verifier("verifier-1", "browser-1"),
  verifier("verifier-2", "api-1"),
  verifier("verifier-3", "node-1"),
  { ...verifier("verifier-4", "revoked-1"), revokedAt: now },
];

const sessions: BrowserSessionMetadata[] = [
  session("session-1", "browser-1", "verifier-1"),
  session("session-2", "node-1", "verifier-3"),
  { ...session("revoked-session", "browser-1", "verifier-1"), revokedAt: now },
];

const nodeSecret: NodeSecretMetadata = {
  secretId: "node-secret-1",
  generation: 3,
  createdAt: now,
  storagePath: "auth/node-secret",
};

function credential(
  credentialId: string,
  actorKind: CredentialMetadata["actorKind"],
  verifierIds: string[],
  sessionIds: string[],
): CredentialMetadata {
  return {
    credentialId,
    actorKind,
    label: credentialId,
    nodePermissions: [],
    vaultGrants: [],
    createdAt: now,
    verifierIds,
    sessionIds,
    auditRefs: [],
  };
}

function verifier(verifierId: string, credentialId: string): TokenVerifierMetadata {
  return {
    verifierId,
    credentialId,
    lookupId: `lookup-${verifierId}`,
    displayPrefix: `prefix-${verifierId}`,
    saltId: `salt-${verifierId}`,
    hashAlgorithm: "sha256",
    hashParameters: {},
    verifierHash: `hash-${verifierId}`,
    createdAt: now,
  };
}

function session(
  sessionId: string,
  credentialId: string,
  verifierId: string,
): BrowserSessionMetadata {
  return {
    sessionId,
    credentialId,
    verifierId,
    lookupId: `lookup-${sessionId}`,
    displayPrefix: `prefix-${sessionId}`,
    saltId: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
    hashAlgorithm: "sha256",
    hashParameters: {
      scheme: "pbkdf2-sha256",
      iterations: 100_000,
      digest: "sha256",
      keyLength: 32,
      saltLength: 32,
    },
    verifierHash: `hash-${sessionId}`,
    createdAt: now,
    expiresAt: "2026-07-03T00:00:00.000Z",
    sameSite: "strict",
  };
}

function state() {
  return { credentials, tokenVerifiers: verifiers, sessions, nodeSecret };
}

test("revoke one credential includes associated verifier and session ids", () => {
  const plan = planAuthRevocation(
    { kind: "credential", credentialId: "browser-1", reason: "compromised", requestedAt: now },
    state(),
  );

  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.affectedCredentialIds, ["browser-1"]);
  assert.deepEqual(plan.affectedVerifierIds, ["verifier-1"]);
  assert.deepEqual(plan.affectedSessionIds, ["session-1"]);
  assert.equal(plan.auditEvents[0]?.kind, "credential.revoked");
});

test("revoke one token verifier leaves sibling credential and sessions active", () => {
  const plan = planAuthRevocation(
    { kind: "tokenVerifier", verifierId: "verifier-2", reason: "rotated", requestedAt: now },
    state(),
  );

  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.affectedCredentialIds, []);
  assert.deepEqual(plan.affectedVerifierIds, ["verifier-2"]);
  assert.deepEqual(plan.affectedSessionIds, []);
});

test("revoke one browser session leaves sibling token credentials active", () => {
  const plan = planAuthRevocation(
    { kind: "browserSession", sessionId: "session-1", reason: "logout", requestedAt: now },
    state(),
  );

  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.affectedCredentialIds, []);
  assert.deepEqual(plan.affectedVerifierIds, []);
  assert.deepEqual(plan.affectedSessionIds, ["session-1"]);
});

test("revoke all affects all active credentials verifiers sessions and preserves audit intent", () => {
  const plan = planAuthRevocation(
    { kind: "allCredentials", reason: "incident", requestedAt: now },
    state(),
  );

  assert.equal(plan.status, "planned");
  assert.deepEqual([...plan.affectedCredentialIds].sort(), ["api-1", "browser-1", "node-1"]);
  assert.deepEqual([...plan.affectedVerifierIds].sort(), [
    "verifier-1",
    "verifier-2",
    "verifier-3",
  ]);
  assert.deepEqual([...plan.affectedSessionIds].sort(), ["session-1", "session-2"]);
  assert.equal(plan.preserveAuditHistory, true);
  assert.equal(plan.auditEvents[0]?.kind, "credential.revoked");
});

test("rotate node secret invalidates dependent records and records audit intent", () => {
  const plan = planAuthRevocation(
    { kind: "rotateNodeSecret", reason: "rotation", requestedAt: now },
    state(),
  );

  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.affectedNodeSecretGenerationIds, ["generation:3", "generation:4"]);
  assert.deepEqual([...plan.affectedCredentialIds].sort(), ["api-1", "browser-1", "node-1"]);
  assert.equal(plan.auditEvents[0]?.kind, "nodeSecret.rotated");
});

test("emergency local-only reset plans protected-mode revocation without deleting data", () => {
  const plan = planAuthRevocation(
    { kind: "emergencyLocalOnlyReset", reason: "emergency", requestedAt: now },
    state(),
  );

  assert.equal(plan.status, "planned");
  assert.equal(plan.protectedPostureDisabled, true);
  assert.equal(plan.preserveAuditHistory, true);
  assert.equal(plan.deleteMarkdownFiles, false);
  assert.ok(plan.warnings.some((warning) => /Audit evidence/.test(warning)));
  assert.equal(plan.auditEvents[0]?.kind, "emergency.localOnlyReset");
});

test("future node credential removal requires fresh registration later", () => {
  const plan = planAuthRevocation(
    {
      kind: "futureNodeCredential",
      credentialId: "node-1",
      reason: "remove-node",
      requestedAt: now,
    },
    state(),
  );

  assert.equal(plan.status, "planned");
  assert.equal(plan.freshRegistrationRequired, true);
  assert.deepEqual(plan.affectedCredentialIds, ["node-1"]);
});

test("already revoked records are handled idempotently", () => {
  const plan = planAuthRevocation(
    { kind: "credential", credentialId: "revoked-1", reason: "again", requestedAt: now },
    state(),
  );

  assert.equal(plan.status, "already-revoked");
  assert.deepEqual(plan.affectedCredentialIds, ["revoked-1"]);
  assert.deepEqual(plan.auditEvents, []);
  assert.ok(plan.warnings.some((warning) => /already revoked/.test(warning)));
});

test("missing ids return not-found with clear warnings", () => {
  const plan = planAuthRevocation(
    { kind: "tokenVerifier", verifierId: "missing", reason: "missing", requestedAt: now },
    state(),
  );

  assert.equal(plan.status, "not-found");
  assert.deepEqual(plan.affectedVerifierIds, []);
  assert.ok(plan.warnings.some((warning) => /not found/.test(warning)));
});

test("revocation helpers do not claim network exposure is safe", () => {
  const plan = planAuthRevocation(
    { kind: "allCredentials", reason: "incident", requestedAt: now },
    state(),
  );
  assert.equal(plan.networkExposureSafe, false);
});

test("request handling does not import auth revocation helpers", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("authRevocation"), false);
});
