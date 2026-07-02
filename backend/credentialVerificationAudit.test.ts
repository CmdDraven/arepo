import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAuthAuditEvents, type AuthAuditEvent } from "./authAudit.js";
import {
  CREDENTIAL_VERIFICATION_AUDIT_NETWORK_EXPOSURE_SAFE,
  appendCredentialVerificationAuditEvent,
  buildCredentialVerificationAuditEvent,
  sanitizeCredentialVerificationAuditMetadata,
} from "./credentialVerificationAudit.js";
import {
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
  TokenVerifierMetadata,
} from "./credentialStore.js";

const tokenMaterial = "arepo_audit_test_api_token_material";
const sessionSecretMaterial = "arepo_audit_test_browser_session_secret";
const now = "2026-07-02T00:00:00.000Z";
const future = "2026-07-03T00:00:00.000Z";
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
    vaultGrants: [{ vaultId: "notes", permissions: ["readIndex"] }],
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

function stores(): CredentialVerificationStores {
  return {
    credentialStore: { credentials: [apiCredential(), browserCredential()] },
    tokenVerifierStore: { tokenVerifiers: [tokenVerifier()] },
    browserSessionStore: { sessions: [browserSession()] },
    revocationStore: { revocations: [] },
  };
}

function eventJson(event: AuthAuditEvent): string {
  return JSON.stringify(event);
}

test("verified token result produces an accepted credential-used audit event", () => {
  const result = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores(),
    now: new Date(now),
  });
  const event = buildCredentialVerificationAuditEvent(result, {
    eventId: "evt-token-ok",
    timestamp: now,
  });

  assert.equal(event.kind, "credential.used");
  assert.equal(event.result, "accepted");
  assert.equal(event.reasonCode, "verified");
  assert.equal(event.credentialId, "api-credential-1");
  assert.equal(event.actor?.actorKind, "api");
  assert.equal(eventJson(event).includes(tokenMaterial), false);
});

test("rejected token result produces rejected auth audit event with stable reason code", () => {
  const wrongToken = "wrong-token-material";
  const result = verifySuppliedTokenCredential({
    tokenMaterial: wrongToken,
    stores: stores(),
    now: new Date(now),
  });
  const event = buildCredentialVerificationAuditEvent(result, {
    eventId: "evt-token-reject",
    timestamp: now,
  });

  assert.equal(event.kind, "auth.attempt.rejected");
  assert.equal(event.result, "rejected");
  assert.equal(event.reasonCode, "token-verifier-not-found");
  assert.equal(eventJson(event).includes(wrongToken), false);
});

test("verified session result produces an accepted session-used audit event", () => {
  const result = verifySuppliedBrowserSessionCredential({
    sessionSecretMaterial,
    stores: stores(),
    now: new Date(now),
  });
  const event = buildCredentialVerificationAuditEvent(result, {
    eventId: "evt-session-ok",
    timestamp: now,
  });

  assert.equal(event.kind, "session.used");
  assert.equal(event.result, "accepted");
  assert.equal(event.reasonCode, "verified");
  assert.equal(event.credentialId, "browser-credential-1");
  assert.equal(event.sessionId, "session-1");
  assert.equal(event.actor?.actorKind, "session");
  assert.equal(eventJson(event).includes(sessionSecretMaterial), false);
});

test("rejected session result produces rejected auth audit event with stable reason code", () => {
  const wrongSessionSecret = "wrong-session-secret";
  const result = verifySuppliedBrowserSessionCredential({
    sessionSecretMaterial: wrongSessionSecret,
    stores: stores(),
    now: new Date(now),
  });
  const event = buildCredentialVerificationAuditEvent(result, {
    eventId: "evt-session-reject",
    timestamp: now,
  });

  assert.equal(event.kind, "auth.attempt.rejected");
  assert.equal(event.result, "rejected");
  assert.equal(event.reasonCode, "session-not-found");
  assert.equal(eventJson(event).includes(wrongSessionSecret), false);
});

test("audit write appends JSONL without overwriting existing audit events", async () => {
  const auditFile = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "arepo-audit-")),
    "events.jsonl",
  );
  const first = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores(),
    now: new Date(now),
  });
  const second = verifySuppliedBrowserSessionCredential({
    sessionSecretMaterial,
    stores: stores(),
    now: new Date(now),
  });

  await appendCredentialVerificationAuditEvent(auditFile, first, {
    eventId: "evt-first",
    timestamp: now,
  });
  await appendCredentialVerificationAuditEvent(auditFile, second, {
    eventId: "evt-second",
    timestamp: now,
  });

  const parsed = await readAuthAuditEvents(auditFile);
  assert.deepEqual(
    parsed.events.map((event) => event.eventId),
    ["evt-first", "evt-second"],
  );
});

test("sanitization strips secret verifier and source body metadata fields", () => {
  const metadata = sanitizeCredentialVerificationAuditMetadata({
    token: "plaintext-token",
    sessionSecret: "plaintext-session",
    cookie: "cookie",
    authorization: "Bearer secret",
    verifierHash: "hash",
    saltId: "salt",
    documentBody: "markdown",
    nested: {
      privateKey: "private",
      safe: "kept",
      content: "source",
    },
  });

  assert.deepEqual(metadata, { nested: { safe: "kept" } });
});

test("audit event never includes supplied secret material from verification inputs", () => {
  const result = verifySuppliedBrowserSessionCredential({
    sessionSecretMaterial,
    stores: stores(),
    now: new Date(now),
  });
  const event = buildCredentialVerificationAuditEvent(result, {
    eventId: "evt-sanitized",
    timestamp: now,
    metadata: {
      tokenMaterial,
      sessionSecretMaterial,
      safeContext: "local-test",
    },
  });
  const serialized = eventJson(event);

  assert.equal(serialized.includes(tokenMaterial), false);
  assert.equal(serialized.includes(sessionSecretMaterial), false);
  assert.equal(serialized.includes("local-test"), true);
});

test("corrupt existing JSONL lines do not prevent appending a new audit event", async () => {
  const auditFile = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "arepo-audit-")),
    "events.jsonl",
  );
  await fs.writeFile(auditFile, "{bad json\n", "utf8");
  const result = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores(),
    now: new Date(now),
  });

  const write = await appendCredentialVerificationAuditEvent(auditFile, result, {
    eventId: "evt-after-corrupt",
    timestamp: now,
  });
  assert.equal(write.ok, true);

  const parsed = await readAuthAuditEvents(auditFile);
  assert.equal(parsed.errors.length, 1);
  assert.deepEqual(
    parsed.events.map((event) => event.eventId),
    ["evt-after-corrupt"],
  );
});

test("audit helper returns clear write errors for unavailable app-data paths", async () => {
  const auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-audit-dir-"));
  const result = verifySuppliedTokenCredential({
    tokenMaterial,
    stores: stores(),
    now: new Date(now),
  });
  const write = await appendCredentialVerificationAuditEvent(auditDir, result, {
    eventId: "evt-write-fail",
    timestamp: now,
  });

  assert.equal(write.ok, false);
  assert.match(write.error, /EISDIR|illegal operation|directory/i);
  assert.equal(write.networkExposureSafe, false);
});

test("audit integration helpers do not claim network exposure is safe", () => {
  assert.equal(CREDENTIAL_VERIFICATION_AUDIT_NETWORK_EXPOSURE_SAFE, false);
});

test("request handling does not import credential verification audit helpers", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  const nodeServiceSource = await fs.readFile(
    path.join(process.cwd(), "backend", "nodeService.ts"),
    "utf8",
  );

  assert.equal(serverSource.includes("credentialVerificationAudit"), false);
  assert.equal(serverSource.includes("appendCredentialVerificationAuditEvent"), false);
  assert.equal(nodeServiceSource.includes("credentialVerificationAudit"), false);
  assert.equal(nodeServiceSource.includes("appendCredentialVerificationAuditEvent"), false);
});
