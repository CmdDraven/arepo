import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CREDENTIAL_VERIFICATION_SERVICE_NETWORK_EXPOSURE_SAFE,
  verifySuppliedBrowserSessionCredential,
  verifySuppliedTokenCredential,
  type CredentialVerificationStores,
} from "./credentialVerificationService.js";
import { TOKEN_VERIFIER_SCHEME, createTokenVerifierMetadata } from "./credentialVerifier.js";
import {
  SESSION_VERIFIER_SCHEME,
  createBrowserSessionVerifierMetadata,
} from "./sessionVerifier.js";
import type {
  BrowserSessionMetadata,
  CredentialMetadata,
  RevocationMetadata,
  TokenVerifierMetadata,
} from "./credentialStore.js";

const tokenMaterial = "arepo_test_api_token_material";
const sessionSecretMaterial = "arepo_test_browser_session_secret_material";
const now = "2026-07-02T00:00:00.000Z";
const future = "2026-07-03T00:00:00.000Z";
const past = "2026-07-01T00:00:00.000Z";
const tokenSalt = Buffer.from(
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  "hex",
);
const sessionSalt = Buffer.from(
  "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100",
  "hex",
);
const tokenHashParameters = {
  scheme: TOKEN_VERIFIER_SCHEME,
  iterations: 100_000,
  digest: "sha256" as const,
  keyLength: 32,
  saltLength: 32,
} as const;
const sessionHashParameters = {
  scheme: SESSION_VERIFIER_SCHEME,
  iterations: 100_000,
  digest: "sha256" as const,
  keyLength: 32,
  saltLength: 32,
} as const;

function apiCredential(overrides: Partial<CredentialMetadata> = {}): CredentialMetadata {
  return {
    credentialId: "api-credential-1",
    actorKind: "apiToken",
    label: "API token",
    nodePermissions: ["manageNode"],
    vaultGrants: [{ vaultId: "notes", permissions: ["readIndex", "readContent"] }],
    createdAt: now,
    expiresAt: future,
    verifierIds: ["token-verifier-1"],
    sessionIds: [],
    auditRefs: [],
    ...overrides,
  };
}

function browserCredential(overrides: Partial<CredentialMetadata> = {}): CredentialMetadata {
  return {
    credentialId: "browser-credential-1",
    actorKind: "browserSession",
    label: "Browser session",
    nodePermissions: [],
    vaultGrants: [{ vaultId: "notes", permissions: ["readIndex", "readContent"] }],
    createdAt: now,
    expiresAt: future,
    verifierIds: [],
    sessionIds: ["session-1"],
    auditRefs: [],
    ...overrides,
  };
}

function tokenVerifier(overrides: Partial<TokenVerifierMetadata> = {}): TokenVerifierMetadata {
  return {
    ...createTokenVerifierMetadata({
      tokenMaterial,
      credentialId: "api-credential-1",
      verifierId: "token-verifier-1",
      createdAt: now,
      expiresAt: future,
      salt: tokenSalt,
      hashParameters: tokenHashParameters,
    }),
    ...overrides,
  };
}

function browserSession(overrides: Partial<BrowserSessionMetadata> = {}): BrowserSessionMetadata {
  return {
    ...createBrowserSessionVerifierMetadata({
      sessionSecretMaterial,
      credentialId: "browser-credential-1",
      sessionId: "session-1",
      verifierId: "session-verifier-1",
      createdAt: now,
      expiresAt: future,
      sameSite: "strict",
      csrfBindingId: "csrf-binding-1",
      salt: sessionSalt,
      hashParameters: sessionHashParameters,
    }),
    ...overrides,
  };
}

function revocation(
  targetKind: RevocationMetadata["targetKind"],
  targetId: string,
): RevocationMetadata {
  return {
    revocationId: `revoke-${targetKind}-${targetId}`,
    targetKind,
    targetId,
    revokedAt: now,
    reason: "test",
  };
}

function stores(
  overrides: Partial<CredentialVerificationStores> = {},
): CredentialVerificationStores {
  return {
    credentialStore: { credentials: [apiCredential(), browserCredential()] },
    tokenVerifierStore: { tokenVerifiers: [tokenVerifier()] },
    browserSessionStore: { sessions: [browserSession()] },
    revocationStore: { revocations: [] },
    ...overrides,
  };
}

test("valid supplied token material verifies credential scope from persisted-style stores", () => {
  const result = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores(),
    now: new Date(now),
  });

  assert.equal(result.status, "verified");
  if (result.status === "verified") {
    assert.equal(result.credentialId, "api-credential-1");
    assert.equal(result.actorKind, "apiToken");
    assert.deepEqual(result.nodePermissions, ["manageNode"]);
    assert.deepEqual(result.vaultGrants, [
      { vaultId: "notes", permissions: ["readIndex", "readContent"] },
    ]);
    assert.equal(result.auditIntent.kind, "auth.attempt.accepted");
  }
  assert.equal(JSON.stringify(result).includes(tokenMaterial), false);
  assert.equal(result.networkExposureSafe, false);
});

test("incorrect supplied token material is rejected without leaking material", () => {
  const wrongToken = "wrong-token-material";
  const result = verifySuppliedTokenCredential({
    tokenMaterial: wrongToken,
    stores: stores(),
    now: new Date(now),
  });

  assert.equal(result.status, "not-found");
  assert.equal(result.reasonCode, "token-verifier-not-found");
  assert.equal(result.auditIntent.kind, "auth.attempt.rejected");
  assert.equal(JSON.stringify(result).includes(wrongToken), false);
});

test("expired and revoked token verifiers are rejected", () => {
  const expired = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores({
      tokenVerifierStore: { tokenVerifiers: [tokenVerifier({ expiresAt: past })] },
    }),
    now: new Date(now),
  });
  assert.equal(expired.status, "rejected");
  assert.equal(expired.reasonCode, "token-verifier-expired");

  const revoked = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores({
      tokenVerifierStore: { tokenVerifiers: [tokenVerifier({ revokedAt: now })] },
    }),
    now: new Date(now),
  });
  assert.equal(revoked.status, "rejected");
  assert.equal(revoked.reasonCode, "token-verifier-revoked");

  const revokedStore = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores({
      revocationStore: { revocations: [revocation("tokenVerifier", "token-verifier-1")] },
    }),
    now: new Date(now),
  });
  assert.equal(revokedStore.status, "rejected");
  assert.equal(revokedStore.reasonCode, "token-verifier-revoked");
});

test("missing revoked and revocation-store credential state rejects token verification", () => {
  const missing = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores({ credentialStore: { credentials: [browserCredential()] } }),
    now: new Date(now),
  });
  assert.equal(missing.status, "rejected");
  assert.equal(missing.reasonCode, "credential-missing");

  const revokedMetadata = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores({
      credentialStore: { credentials: [apiCredential({ revokedAt: now }), browserCredential()] },
    }),
    now: new Date(now),
  });
  assert.equal(revokedMetadata.status, "rejected");
  assert.equal(revokedMetadata.reasonCode, "credential-revoked");

  const revokedStore = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores({
      revocationStore: { revocations: [revocation("credential", "api-credential-1")] },
    }),
    now: new Date(now),
  });
  assert.equal(revokedStore.status, "rejected");
  assert.equal(revokedStore.reasonCode, "credential-revoked");
});

test("valid supplied browser session secret verifies session credential scope", () => {
  const result = verifySuppliedBrowserSessionCredential({
    sessionSecretMaterial,
    stores: stores(),
    now: new Date(now),
  });

  assert.equal(result.status, "verified");
  if (result.status === "verified") {
    assert.equal(result.credentialId, "browser-credential-1");
    assert.equal(result.actorKind, "browserSession");
    assert.deepEqual(result.nodePermissions, []);
    assert.deepEqual(result.vaultGrants, [
      { vaultId: "notes", permissions: ["readIndex", "readContent"] },
    ]);
    assert.equal(result.auditIntent.kind, "auth.attempt.accepted");
    assert.equal(result.auditIntent.sessionId, "session-1");
  }
  assert.equal(JSON.stringify(result).includes(sessionSecretMaterial), false);
  assert.equal(result.networkExposureSafe, false);
});

test("incorrect supplied browser session secret is rejected without leaking material", () => {
  const wrongSessionSecret = "wrong-session-secret";
  const result = verifySuppliedBrowserSessionCredential({
    sessionSecretMaterial: wrongSessionSecret,
    stores: stores(),
    now: new Date(now),
  });

  assert.equal(result.status, "not-found");
  assert.equal(result.reasonCode, "session-not-found");
  assert.equal(result.auditIntent.kind, "auth.attempt.rejected");
  assert.equal(JSON.stringify(result).includes(wrongSessionSecret), false);
});

test("expired and revoked browser sessions are rejected", () => {
  const expired = verifySuppliedBrowserSessionCredential({
    sessionSecretMaterial,
    stores: stores({
      browserSessionStore: { sessions: [browserSession({ expiresAt: past })] },
    }),
    now: new Date(now),
  });
  assert.equal(expired.status, "rejected");
  assert.equal(expired.reasonCode, "session-expired");

  const revoked = verifySuppliedBrowserSessionCredential({
    sessionSecretMaterial,
    stores: stores({
      browserSessionStore: { sessions: [browserSession({ revokedAt: now })] },
    }),
    now: new Date(now),
  });
  assert.equal(revoked.status, "rejected");
  assert.equal(revoked.reasonCode, "session-revoked");
});

test("session revocation store rejects browser session verification", () => {
  const result = verifySuppliedBrowserSessionCredential({
    sessionSecretMaterial,
    stores: stores({
      revocationStore: { revocations: [revocation("browserSession", "session-1")] },
    }),
    now: new Date(now),
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.reasonCode, "session-revoked");
});

test("verified and rejected results never claim network exposure is safe", () => {
  const verified = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores(),
    now: new Date(now),
  });
  const rejected = verifySuppliedTokenCredential({
    tokenMaterial: "wrong-token-material",
    stores: stores(),
    now: new Date(now),
  });

  assert.equal(CREDENTIAL_VERIFICATION_SERVICE_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(verified.networkExposureSafe, false);
  assert.equal(rejected.networkExposureSafe, false);
});

test("request handling does not import credential verification service", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  const nodeServiceSource = await fs.readFile(
    path.join(process.cwd(), "backend", "nodeService.ts"),
    "utf8",
  );
  assert.equal(serverSource.includes("credentialVerificationService"), false);
  assert.equal(serverSource.includes("verifySuppliedTokenCredential"), false);
  assert.equal(serverSource.includes("verifySuppliedBrowserSessionCredential"), false);
  assert.equal(nodeServiceSource.includes("credentialVerificationService"), false);
  assert.equal(nodeServiceSource.includes("verifySuppliedTokenCredential"), false);
  assert.equal(nodeServiceSource.includes("verifySuppliedBrowserSessionCredential"), false);
});
