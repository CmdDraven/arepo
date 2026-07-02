import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  AUTH_STORAGE_NETWORK_EXPOSURE_SAFE,
  AUTH_STORAGE_OWNER_ONLY_DIRECTORY_MODE,
  AUTH_STORAGE_OWNER_ONLY_FILE_MODE,
  AUTH_STORAGE_REQUIRES_ATOMIC_WRITES,
  assertConfigShapeContainsNoAuthSecrets,
  resolveAuthStoragePaths,
  validateAuthMaterialPathOutsideVaults,
  validateConfigShapeContainsNoAuthSecrets,
  type BrowserSessionMetadata,
  type CredentialActorKind,
  type CredentialMetadata,
  type RevocationMetadata,
  type RevocationTargetKind,
  type TokenVerifierMetadata,
} from "./credentialStore.js";

const createdAt = "2026-07-02T00:00:00.000Z";

test("credential metadata represents supported future credential kinds without plaintext tokens", () => {
  const kinds: CredentialActorKind[] = [
    "browserSession",
    "apiToken",
    "localPairing",
    "futureNode",
    "readOnlyArchive",
  ];

  for (const actorKind of kinds) {
    const credential: CredentialMetadata = {
      credentialId: `${actorKind}-credential`,
      actorKind,
      label: `${actorKind} label`,
      nodePermissions: actorKind === "readOnlyArchive" ? [] : ["manageNode"],
      vaultGrants: [
        {
          vaultId: "notes",
          permissions:
            actorKind === "readOnlyArchive" ? ["readIndex"] : ["readIndex", "readContent"],
        },
      ],
      createdAt,
      verifierIds: [`${actorKind}-verifier`],
      sessionIds: actorKind === "browserSession" ? [`${actorKind}-session`] : [],
      auditRefs: [{ eventId: "evt-1", eventAt: createdAt, eventType: "credential.created" }],
    };

    assert.equal("token" in credential, false);
    assert.equal("bearerToken" in credential, false);
    assert.equal("pairingSecret" in credential, false);
    assert.equal("privateKey" in credential, false);
  }
});

test("token verifier metadata stores lookup and verifier fields without plaintext token", () => {
  const verifier: TokenVerifierMetadata = {
    verifierId: "verifier-1",
    credentialId: "credential-1",
    lookupId: "tok_lookup_123",
    displayPrefix: "arepo_tok_abc",
    saltId: "salt-1",
    hashAlgorithm: "sha256",
    hashParameters: { iterations: 1 },
    verifierHash: "hashed-verifier",
    createdAt,
    expiresAt: "2026-07-03T00:00:00.000Z",
  };

  assert.equal(verifier.lookupId, "tok_lookup_123");
  assert.equal(verifier.verifierHash, "hashed-verifier");
  assert.equal("token" in verifier, false);
  assert.equal("bearerToken" in verifier, false);
});

test("browser session metadata is distinct from API token metadata", () => {
  const session: BrowserSessionMetadata = {
    sessionId: "session-1",
    credentialId: "credential-1",
    verifierId: "session-verifier-1",
    createdAt,
    expiresAt: "2026-07-02T01:00:00.000Z",
    sameSite: "strict",
    csrfBindingId: "csrf-binding-1",
  };

  assert.equal(session.sameSite, "strict");
  assert.equal("displayPrefix" in session, false);
  assert.equal("lookupId" in session, false);
});

test("revocation metadata represents credential, token, session, node secret, and reset targets", () => {
  const targets: RevocationTargetKind[] = [
    "credential",
    "tokenVerifier",
    "browserSession",
    "nodeSecretGeneration",
    "emergencyLocalOnlyReset",
  ];

  for (const targetKind of targets) {
    const revocation: RevocationMetadata = {
      revocationId: `revoke-${targetKind}`,
      targetKind,
      targetId: `target-${targetKind}`,
      revokedAt: createdAt,
      reason: "test",
    };
    assert.equal(revocation.targetKind, targetKind);
  }
});

test("auth app-data path helpers resolve under the auth directory", () => {
  const appDataDir = path.join("/tmp", "arepo-data");
  const paths = resolveAuthStoragePaths(appDataDir);
  assert.equal(paths.authDir, path.join(appDataDir, "auth"));
  assert.equal(paths.credentials, path.join(appDataDir, "auth", "credentials.json"));
  assert.equal(paths.tokenVerifiers, path.join(appDataDir, "auth", "token-verifiers.json"));
  assert.equal(paths.sessions, path.join(appDataDir, "auth", "sessions.json"));
  assert.equal(paths.revocations, path.join(appDataDir, "auth", "revocations.json"));
  assert.equal(paths.nodeSecret, path.join(appDataDir, "auth", "node-secret"));
  assert.equal(paths.auditEvents, path.join(appDataDir, "auth", "audit", "events.jsonl"));
});

test("path helpers reject Markdown vault locations for auth material", () => {
  assert.throws(
    () => resolveAuthStoragePaths("/vault/.arepo-data", ["/vault"]),
    /must not be placed inside a Markdown vault root/,
  );

  const result = validateAuthMaterialPathOutsideVaults("/vault/auth/token-verifiers.json", [
    "/vault",
  ]);
  assert.equal(result.ok, false);
});

test("config-shaped validation rejects auth secret looking fields", () => {
  for (const secretKey of [
    "token",
    "bearerToken",
    "pairingSecret",
    "privateKey",
    "sessionSecret",
    "passwordHash",
    "tokenVerifier",
  ]) {
    const result = validateConfigShapeContainsNoAuthSecrets({
      auth: {
        mode: "disabled",
        [secretKey]: "secret-value",
      },
    });
    assert.equal(result.ok, false, secretKey);
  }
});

test("config-shaped validation allows non-secret auth posture", () => {
  const result = validateConfigShapeContainsNoAuthSecrets({
    auth: {
      mode: "disabled",
      protectedModeAvailable: false,
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.doesNotThrow(() => assertConfigShapeContainsNoAuthSecrets({ auth: { mode: "disabled" } }));
});

test("credential storage helpers do not claim network exposure is safe", () => {
  assert.equal(AUTH_STORAGE_NETWORK_EXPOSURE_SAFE, false);
});

test("credential storage constants document owner-only and atomic-write requirements", () => {
  assert.equal(AUTH_STORAGE_OWNER_ONLY_FILE_MODE, 0o600);
  assert.equal(AUTH_STORAGE_OWNER_ONLY_DIRECTORY_MODE, 0o700);
  assert.equal(AUTH_STORAGE_REQUIRES_ATOMIC_WRITES, true);
});

test("request handling does not import credential-store helpers", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("credentialStore"), false);
});
