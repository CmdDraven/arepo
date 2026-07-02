import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAuthAuditEvents, serializeAuthAuditEventJsonl } from "./authAudit.js";
import {
  planProtectedRequestPipeline,
  PROTECTED_REQUEST_PIPELINE_ENFORCEMENT_ACTIVE,
  PROTECTED_REQUEST_PIPELINE_NETWORK_EXPOSURE_SAFE,
} from "./protectedRequestPipeline.js";
import {
  readBrowserSessionStore,
  readCredentialStore,
  readRevocationStore,
  readTokenVerifierStore,
  resolveAuthStoragePaths,
  writeBrowserSessionStore,
  writeCredentialStore,
  writeRevocationStore,
  writeTokenVerifierStore,
  type BrowserSessionMetadata,
  type CredentialMetadata,
  type RevocationMetadata,
  type TokenVerifierMetadata,
} from "./credentialStore.js";
import { TOKEN_VERIFIER_SCHEME, createTokenVerifierMetadata } from "./credentialVerifier.js";
import {
  SESSION_VERIFIER_SCHEME,
  createBrowserSessionVerifierMetadata,
} from "./sessionVerifier.js";
import { DEFAULT_BROWSER_SESSION_COOKIE_NAME } from "./httpCredentialAdapter.js";
import type { RoutePermission } from "./routePermissions.js";

const tokenMaterial = "arepo_pipeline_api_token_material";
const sessionSecretMaterial = "arepo_pipeline_browser_session_secret";
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

function apiCredential(
  permissions: readonly RoutePermission[],
  nodePermissions: readonly RoutePermission[] = [],
  overrides: Partial<CredentialMetadata> = {},
): CredentialMetadata {
  return {
    credentialId: "api-credential-1",
    actorKind: "apiToken",
    label: "API token",
    nodePermissions,
    vaultGrants: [{ vaultId: "notes", permissions }],
    createdAt: now,
    expiresAt: future,
    verifierIds: ["token-verifier-1"],
    sessionIds: [],
    auditRefs: [],
    ...overrides,
  };
}

function browserCredential(
  permissions: readonly RoutePermission[],
  overrides: Partial<CredentialMetadata> = {},
): CredentialMetadata {
  return {
    credentialId: "browser-credential-1",
    actorKind: "browserSession",
    label: "Browser session",
    nodePermissions: [],
    vaultGrants: [{ vaultId: "notes", permissions }],
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

async function makeAppData(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "arepo-pipeline-"));
}

async function writeStores(
  appDataDir: string,
  options: {
    credential?: CredentialMetadata;
    browserCredential?: CredentialMetadata;
    verifier?: TokenVerifierMetadata;
    session?: BrowserSessionMetadata;
    revocations?: readonly RevocationMetadata[];
  } = {},
): Promise<void> {
  await writeCredentialStore(appDataDir, {
    credentials: [
      options.credential ?? apiCredential(["readIndex"]),
      options.browserCredential ?? browserCredential(["readContent", "writeContent"]),
    ],
  });
  await writeTokenVerifierStore(appDataDir, {
    tokenVerifiers: [options.verifier ?? tokenVerifier()],
  });
  await writeBrowserSessionStore(appDataDir, {
    sessions: [options.session ?? browserSession()],
  });
  await writeRevocationStore(appDataDir, {
    revocations: options.revocations ?? [],
  });
}

test("valid bearer token with stores produces would-allow for generated-index route", async () => {
  const appDataDir = await makeAppData();
  await writeStores(appDataDir, { credential: apiCredential(["readIndex"]) });

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index/search?q=test",
      headers: { authorization: `Bearer ${tokenMaterial}` },
    },
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(result.storeLoad.status, "loaded");
  assert.equal(result.decision.wouldAllow, true);
  assert.equal(result.credential.status, "verified");
  assert.equal(result.decision.routePattern, "/api/vaults/:vaultId/index/search?q=...");
});

test("valid bearer token lacking readContent denies source file read", async () => {
  const appDataDir = await makeAppData();
  await writeStores(appDataDir, { credential: apiCredential(["readIndex"]) });

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "GET",
      path: "/api/vaults/notes/file?path=Notes/note.md",
      headers: { authorization: `Bearer ${tokenMaterial}` },
    },
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(result.decision.wouldDeny, true);
  assert.deepEqual(result.decision.missingPermissions, ["readContent"]);
});

test("valid browser session input plans CSRF and origin requirements for mutation routes", async () => {
  const appDataDir = await makeAppData();
  await writeStores(appDataDir, {
    browserCredential: browserCredential(["readContent", "writeContent"]),
  });

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "POST",
      path: "/api/vaults/notes/file",
      cookies: { [DEFAULT_BROWSER_SESSION_COOKIE_NAME]: sessionSecretMaterial },
      origin: "http://localhost:8733",
    },
    vaultId: "notes",
    allowedOrigins: ["http://localhost:8733"],
    csrfTokenPresent: false,
    now: new Date(now),
  });

  assert.equal(result.decision.requiresOriginCheck, true);
  assert.equal(result.decision.requiresCsrf, true);
  assert.ok(result.decision.browserSecurityPlan.failureReasons.includes("failed-csrf"));
});

test("missing credentials produce requires-authentication and no-credential diagnostics", async () => {
  const appDataDir = await makeAppData();
  await writeStores(appDataDir);

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: { method: "GET", path: "/api/vaults/notes/index" },
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(result.credential.status, "no-credential");
  assert.equal(result.decision.requiresAuthentication, true);
  assert.ok(result.decision.reasonCodes.includes("requires-authentication"));
});

test("missing stores do not grant access", async () => {
  const appDataDir = await makeAppData();

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: `Bearer ${tokenMaterial}` },
    },
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(result.storeLoad.status, "loaded");
  assert.equal(result.storeLoad.missingStoresTolerated, true);
  assert.notEqual(result.decision.wouldAllow, true);
  assert.equal(result.credential.status, "not-found");
});

test("corrupt credential token session or revocation store data fails closed", async () => {
  for (const storeName of ["credentials", "tokenVerifiers", "sessions", "revocations"] as const) {
    const appDataDir = await makeAppData();
    await writeStores(appDataDir);
    const paths = resolveAuthStoragePaths(appDataDir);
    const target =
      storeName === "credentials"
        ? paths.credentials
        : storeName === "tokenVerifiers"
          ? paths.tokenVerifiers
          : storeName === "sessions"
            ? paths.sessions
            : paths.revocations;
    await fs.writeFile(target, "{bad json", "utf8");

    const result = await planProtectedRequestPipeline({
      appDataDir,
      request: {
        method: "GET",
        path: "/api/vaults/notes/index",
        headers: { authorization: `Bearer ${tokenMaterial}` },
      },
      vaultId: "notes",
      now: new Date(now),
    });

    assert.equal(result.storeLoad.status, "failed", storeName);
    assert.equal(result.decision.wouldDeny, true, storeName);
    assert.notEqual(result.credential.status, "verified", storeName);
  }
});

test("revoked credential token and session fail closed", async () => {
  const credentialRevoked = await makeAppData();
  await writeStores(credentialRevoked, {
    revocations: [revocation("credential", "api-credential-1")],
  });
  const tokenRevoked = await makeAppData();
  await writeStores(tokenRevoked, {
    revocations: [revocation("tokenVerifier", "token-verifier-1")],
  });
  const sessionRevoked = await makeAppData();
  await writeStores(sessionRevoked, {
    revocations: [revocation("browserSession", "session-1")],
  });

  const credentialResult = await planProtectedRequestPipeline({
    appDataDir: credentialRevoked,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: `Bearer ${tokenMaterial}` },
    },
    vaultId: "notes",
    now: new Date(now),
  });
  const tokenResult = await planProtectedRequestPipeline({
    appDataDir: tokenRevoked,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: `Bearer ${tokenMaterial}` },
    },
    vaultId: "notes",
    now: new Date(now),
  });
  const sessionResult = await planProtectedRequestPipeline({
    appDataDir: sessionRevoked,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      cookies: { [DEFAULT_BROWSER_SESSION_COOKIE_NAME]: sessionSecretMaterial },
    },
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(credentialResult.credential.reasonCode, "credential-revoked");
  assert.equal(tokenResult.credential.reasonCode, "token-verifier-revoked");
  assert.equal(sessionResult.credential.reasonCode, "session-revoked");
});

test("dry-run audit mode returns sanitized audit event without writing JSONL", async () => {
  const appDataDir = await makeAppData();
  await writeStores(appDataDir, { credential: apiCredential(["readIndex"]) });

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: `Bearer ${tokenMaterial}` },
    },
    vaultId: "notes",
    audit: { mode: "dry-run", eventId: "evt-dry-run", timestamp: now },
    now: new Date(now),
  });
  const paths = resolveAuthStoragePaths(appDataDir);

  assert.equal(result.audit.status, "planned");
  assert.equal(result.audit.event.eventId, "evt-dry-run");
  await assert.rejects(() => fs.readFile(paths.auditEvents, "utf8"), /ENOENT/);
  assert.equal(JSON.stringify(result.audit.event).includes(tokenMaterial), false);
});

test("append audit mode writes one sanitized JSONL event without overwriting existing entries", async () => {
  const appDataDir = await makeAppData();
  await writeStores(appDataDir, { credential: apiCredential(["readIndex"]) });
  const paths = resolveAuthStoragePaths(appDataDir);
  await fs.mkdir(path.dirname(paths.auditEvents), { recursive: true });
  await fs.writeFile(
    paths.auditEvents,
    serializeAuthAuditEventJsonl({
      eventId: "evt-existing",
      timestamp: now,
      kind: "auth.attempt.accepted",
      result: "accepted",
      reasonCode: "seed",
    }),
    "utf8",
  );

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: `Bearer ${tokenMaterial}` },
    },
    vaultId: "notes",
    audit: { mode: "append", eventId: "evt-pipeline", timestamp: now },
    now: new Date(now),
  });

  assert.equal(result.audit.status, "written");
  const parsed = await readAuthAuditEvents(paths.auditEvents);
  assert.deepEqual(
    parsed.events.map((event) => event.eventId),
    ["evt-existing", "evt-pipeline"],
  );
  assert.equal(JSON.stringify(parsed.events).includes(tokenMaterial), false);
});

test("disabled audit mode writes nothing", async () => {
  const appDataDir = await makeAppData();
  await writeStores(appDataDir, { credential: apiCredential(["readIndex"]) });
  const paths = resolveAuthStoragePaths(appDataDir);

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: `Bearer ${tokenMaterial}` },
    },
    vaultId: "notes",
    audit: { mode: "disabled" },
    now: new Date(now),
  });

  assert.equal(result.audit.status, "skipped");
  await assert.rejects(() => fs.readFile(paths.auditEvents, "utf8"), /ENOENT/);
});

test("pipeline result never includes raw secret or source body material", async () => {
  const appDataDir = await makeAppData();
  await writeStores(appDataDir, { credential: apiCredential(["readIndex"]) });

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: `Bearer ${tokenMaterial}` },
      cookies: { [DEFAULT_BROWSER_SESSION_COOKIE_NAME]: sessionSecretMaterial },
      origin: "http://localhost:8733",
      referer: "http://localhost:8733/doc",
    },
    vaultId: "notes",
    audit: { mode: "dry-run", eventId: "evt-secret-check", timestamp: now },
    now: new Date(now),
  });
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes(tokenMaterial), false);
  assert.equal(serialized.includes(sessionSecretMaterial), false);
  assert.equal(serialized.includes("Bearer"), false);
  assert.equal(serialized.includes("verifierHash"), false);
  assert.equal(serialized.includes(tokenSalt.toString("hex")), false);
});

test("pipeline always reports inactive enforcement and unsafe network exposure", async () => {
  const appDataDir = await makeAppData();
  await writeStores(appDataDir, { credential: apiCredential(["readIndex"]) });

  const result = await planProtectedRequestPipeline({
    appDataDir,
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: `Bearer ${tokenMaterial}` },
    },
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(PROTECTED_REQUEST_PIPELINE_ENFORCEMENT_ACTIVE, false);
  assert.equal(PROTECTED_REQUEST_PIPELINE_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(result.enforcementActive, false);
  assert.equal(result.networkExposureSafe, false);
});

test("pipeline is not imported by request handling files", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  const nodeServiceSource = await fs.readFile(
    path.join(process.cwd(), "backend", "nodeService.ts"),
    "utf8",
  );

  assert.equal(serverSource.includes("protectedRequestPipeline"), false);
  assert.equal(serverSource.includes("planProtectedRequestPipeline"), false);
  assert.equal(nodeServiceSource.includes("protectedRequestPipeline"), false);
  assert.equal(nodeServiceSource.includes("planProtectedRequestPipeline"), false);
});
