import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_BROWSER_SESSION_COOKIE_NAME,
  HTTP_CREDENTIAL_ADAPTER_NETWORK_EXPOSURE_SAFE,
  classifyHttpCredentialExtraction,
  verifyHttpCredentialInput,
  type HttpCredentialAdapterInput,
} from "./httpCredentialAdapter.js";
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
import type { CredentialVerificationStores } from "./credentialVerificationService.js";

const tokenMaterial = "arepo_http_adapter_api_token_material";
const sessionSecretMaterial = "arepo_http_adapter_browser_session_secret";
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
    vaultGrants: [{ vaultId: "notes", permissions: ["readIndex"] }],
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

function adapterInput(
  overrides: Partial<HttpCredentialAdapterInput> = {},
): HttpCredentialAdapterInput {
  return {
    request: {
      method: "GET",
      path: "/api/vaults",
      routePattern: "/api/vaults",
      headers: {},
      cookies: {},
    },
    stores: stores(),
    options: { now: new Date(now) },
    ...overrides,
  };
}

test("extracts bearer token from explicit request-shaped input and verifies it", () => {
  const result = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/vaults",
        routePattern: "/api/vaults",
        headers: { authorization: `Bearer ${tokenMaterial}` },
      },
    }),
  );

  assert.equal(result.status, "verified");
  assert.equal(result.credentialSource, "bearerHeader");
  if (result.status === "verified") {
    assert.equal(result.credentialId, "api-credential-1");
    assert.equal(result.actorKind, "apiToken");
    assert.deepEqual(result.nodePermissions, ["manageNode"]);
    assert.deepEqual(result.vaultGrants, [
      { vaultId: "notes", permissions: ["readIndex", "readContent"] },
    ]);
  }
  assert.equal(JSON.stringify(result).includes(tokenMaterial), false);
});

test("extracts browser session cookie from explicit request-shaped input and verifies it", () => {
  const result = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/node/status",
        routePattern: "/api/node/status",
        cookies: { [DEFAULT_BROWSER_SESSION_COOKIE_NAME]: sessionSecretMaterial },
      },
    }),
  );

  assert.equal(result.status, "verified");
  assert.equal(result.credentialSource, "browserSessionCookie");
  if (result.status === "verified") {
    assert.equal(result.credentialId, "browser-credential-1");
    assert.equal(result.actorKind, "browserSession");
    assert.deepEqual(result.vaultGrants, [{ vaultId: "notes", permissions: ["readIndex"] }]);
  }
  assert.equal(JSON.stringify(result).includes(sessionSecretMaterial), false);
});

test("missing credentials returns no-credential with a stable reason code", () => {
  const result = verifyHttpCredentialInput(adapterInput());

  assert.equal(result.status, "no-credential");
  assert.equal(result.reasonCode, "no-credential");
  assert.equal(result.auditIntent.reasonCode, "no-credential");
});

test("unsupported authorization scheme is rejected", () => {
  const result = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/vaults",
        headers: { authorization: "Basic abc123" },
      },
    }),
  );

  assert.equal(result.status, "malformed");
  assert.equal(result.reasonCode, "unsupported-authorization-scheme");
});

test("empty bearer token is rejected", () => {
  const result = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/vaults",
        headers: { authorization: "Bearer " },
      },
    }),
  );

  assert.equal(result.status, "malformed");
  assert.equal(result.reasonCode, "empty-bearer-token");
});

test("ambiguous bearer plus cookie input is rejected", () => {
  const result = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/vaults",
        headers: { authorization: `Bearer ${tokenMaterial}` },
        cookies: { [DEFAULT_BROWSER_SESSION_COOKIE_NAME]: sessionSecretMaterial },
      },
    }),
  );

  assert.equal(result.status, "malformed");
  assert.equal(result.reasonCode, "ambiguous-credentials");
  assert.equal(JSON.stringify(result).includes(tokenMaterial), false);
  assert.equal(JSON.stringify(result).includes(sessionSecretMaterial), false);
});

test("multiple bearer tokens are rejected", () => {
  const result = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/vaults",
        headers: { authorization: `Bearer ${tokenMaterial}, Bearer other-token` },
      },
    }),
  );

  assert.equal(result.status, "malformed");
  assert.equal(result.reasonCode, "multiple-bearer-tokens");
});

test("incorrect bearer and session material are rejected without leaking secrets", () => {
  const wrongToken = "wrong-token-material";
  const wrongSession = "wrong-session-material";
  const tokenResult = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/vaults",
        headers: { authorization: `Bearer ${wrongToken}` },
      },
    }),
  );
  const sessionResult = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/vaults",
        cookies: { [DEFAULT_BROWSER_SESSION_COOKIE_NAME]: wrongSession },
      },
    }),
  );

  assert.equal(tokenResult.status, "not-found");
  assert.equal(tokenResult.reasonCode, "token-verifier-not-found");
  assert.equal(JSON.stringify(tokenResult).includes(wrongToken), false);
  assert.equal(sessionResult.status, "not-found");
  assert.equal(sessionResult.reasonCode, "session-not-found");
  assert.equal(JSON.stringify(sessionResult).includes(wrongSession), false);
});

test("dry-run extraction classification returns no raw credential material", () => {
  const result = classifyHttpCredentialExtraction({
    method: "GET",
    path: "/api/vaults",
    headers: { authorization: `Bearer ${tokenMaterial}` },
  });

  assert.equal(result.status, "extracted");
  assert.equal(result.credentialSource, "bearerHeader");
  assert.equal(result.reasonCode, "verification-skipped");
  assert.equal(JSON.stringify(result).includes(tokenMaterial), false);
});

test("adapter result always reports network exposure unsafe", () => {
  const verified = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/vaults",
        headers: { authorization: `Bearer ${tokenMaterial}` },
      },
    }),
  );
  const malformed = verifyHttpCredentialInput(
    adapterInput({
      request: {
        method: "GET",
        path: "/api/vaults",
        headers: { authorization: "Basic abc123" },
      },
    }),
  );

  assert.equal(HTTP_CREDENTIAL_ADAPTER_NETWORK_EXPOSURE_SAFE, false);
  assert.equal(verified.networkExposureSafe, false);
  assert.equal(malformed.networkExposureSafe, false);
});

test("adapter is not imported by request handling files", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  const nodeServiceSource = await fs.readFile(
    path.join(process.cwd(), "backend", "nodeService.ts"),
    "utf8",
  );

  assert.equal(serverSource.includes("httpCredentialAdapter"), false);
  assert.equal(serverSource.includes("verifyHttpCredentialInput"), false);
  assert.equal(nodeServiceSource.includes("httpCredentialAdapter"), false);
  assert.equal(nodeServiceSource.includes("verifyHttpCredentialInput"), false);
});
