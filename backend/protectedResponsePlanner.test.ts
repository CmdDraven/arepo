import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_BROWSER_SESSION_COOKIE_NAME,
  type RequestShapedCredentialInput,
} from "./httpCredentialAdapter.js";
import { planProtectedResponse } from "./protectedResponsePlanner.js";
import { planRouteAwareRequestAuthorization } from "./requestAuthorizationPlanner.js";
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
import type { RoutePermission } from "./routePermissions.js";

const tokenMaterial = "arepo_response_planner_api_token_material";
const badTokenMaterial = "arepo_response_planner_bad_token_material";
const sessionSecretMaterial = "arepo_response_planner_browser_session_secret";
const sourceBodyMaterial = "arepo_response_planner_source_document_body";
const vaultRoot = "/tmp/arepo-response-planner-vault";
const sourcePath = "/api/vaults/notes/file?path=Notes/secret.md";
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

function credential(
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

function storesForCredential(
  credentialMetadata: CredentialMetadata,
  sessionCredential?: CredentialMetadata,
): CredentialVerificationStores {
  return {
    credentialStore: {
      credentials: sessionCredential
        ? [credentialMetadata, sessionCredential]
        : [credentialMetadata],
    },
    tokenVerifierStore: { tokenVerifiers: [tokenVerifier()] },
    browserSessionStore: { sessions: [browserSession()] },
    revocationStore: { revocations: [] },
  };
}

function bearerRequest(method: string, pathValue: string, material = tokenMaterial) {
  return {
    method,
    path: pathValue,
    headers: { authorization: `Bearer ${material}`, "x-source-body": sourceBodyMaterial },
  };
}

function sessionRequest(
  method: string,
  pathValue: string,
  origin = "http://localhost:8733",
): RequestShapedCredentialInput {
  return {
    method,
    path: pathValue,
    cookies: { [DEFAULT_BROWSER_SESSION_COOKIE_NAME]: sessionSecretMaterial },
    origin,
    headers: { "x-vault-root": vaultRoot },
  };
}

function emptyStores(): CredentialVerificationStores {
  return {
    credentialStore: { credentials: [] },
    tokenVerifierStore: { tokenVerifiers: [] },
    browserSessionStore: { sessions: [] },
    revocationStore: { revocations: [] },
  };
}

function serializedPlan(input: ReturnType<typeof planProtectedResponse>): string {
  return JSON.stringify(input);
}

function assertSanitized(serialized: string): void {
  for (const forbidden of [
    tokenMaterial,
    badTokenMaterial,
    sessionSecretMaterial,
    `Bearer ${tokenMaterial}`,
    `Bearer ${badTokenMaterial}`,
    sourceBodyMaterial,
    vaultRoot,
    sourcePath,
    "Notes/secret.md",
    "api-credential-1",
    "browser-credential-1",
    "token-verifier-1",
    "session-1",
    "verifierHash",
    "salt",
    `"authorization":"Bearer ${tokenMaterial}"`,
    `"authorization":"Bearer ${badTokenMaterial}"`,
    "arepo_session",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into response plan`);
  }
}

test("missing credential maps to a 401-style unauthenticated response plan", () => {
  const decision = planRouteAwareRequestAuthorization({
    request: { method: "GET", path: "/api/vaults/notes/index" },
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });
  const plan = planProtectedResponse({ decision });

  assert.equal(plan.kind, "unauthenticated");
  assert.equal(plan.httpStatus, 401);
  assert.equal(plan.body.authRequired, true);
  assert.equal(plan.body.enforcementActive, false);
  assert.equal(plan.body.networkExposureSafe, false);
});

test("malformed credential maps to a 401-style unauthenticated response plan", () => {
  const decision = planRouteAwareRequestAuthorization({
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: "Basic x" },
    },
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });
  const plan = planProtectedResponse({ decision });

  assert.equal(plan.kind, "unauthenticated");
  assert.equal(plan.httpStatus, 401);
  assert.equal(plan.body.reasonCodes.includes("malformed-credential"), true);
  assertSanitized(serializedPlan(plan));
});

test("valid credential lacking route permission maps to a 403-style unauthorized plan", () => {
  const decision = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", sourcePath),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });
  const plan = planProtectedResponse({ decision });

  assert.equal(plan.kind, "unauthorized");
  assert.equal(plan.httpStatus, 403);
  assert.equal(plan.body.authorizationRequired, true);
  assert.equal(plan.body.reasonCodes.includes("requires-authorization"), true);
  assertSanitized(serializedPlan(plan));
});

test("browser mutation missing CSRF maps to a CSRF-required rejection plan", () => {
  const decision = planRouteAwareRequestAuthorization({
    request: sessionRequest("POST", "/api/vaults/notes/file"),
    stores: storesForCredential(
      credential(["readIndex"]),
      browserCredential(["readContent", "writeContent"]),
    ),
    vaultId: "notes",
    clientPosture: "browserCookieSession",
    allowedOrigins: ["http://localhost:8733"],
    csrfTokenPresent: false,
    now: new Date(now),
  });
  const plan = planProtectedResponse({ decision });

  assert.equal(plan.kind, "csrf-required");
  assert.equal(plan.httpStatus, 403);
  assert.equal(plan.body.csrfRequired, true);
  assertSanitized(serializedPlan(plan));
});

test("browser mutation with untrusted origin maps to an origin-rejected plan", () => {
  const decision = planRouteAwareRequestAuthorization({
    request: sessionRequest("POST", "/api/vaults/notes/file", "http://evil.test"),
    stores: storesForCredential(
      credential(["readIndex"]),
      browserCredential(["readContent", "writeContent"]),
    ),
    vaultId: "notes",
    clientPosture: "browserCookieSession",
    allowedOrigins: ["http://localhost:8733"],
    csrfTokenPresent: true,
    now: new Date(now),
  });
  const plan = planProtectedResponse({ decision });

  assert.equal(plan.kind, "origin-rejected");
  assert.equal(plan.httpStatus, 403);
  assert.equal(plan.body.originRejected, true);
  assert.equal(plan.body.reasonCodes.includes("untrusted-origin"), true);
  assertSanitized(serializedPlan(plan));
});

test("delete or conflict overwrite maps to stronger-confirmation-required when appropriate", () => {
  const deleteDecision = planRouteAwareRequestAuthorization({
    request: bearerRequest("DELETE", sourcePath),
    stores: storesForCredential(credential(["readContent", "writeContent", "deleteFiles"])),
    vaultId: "notes",
    now: new Date(now),
  });
  const deletePlan = planProtectedResponse({ decision: deleteDecision });
  assert.equal(deletePlan.kind, "stronger-confirmation-required");
  assert.equal(deletePlan.httpStatus, 428);
  assert.deepEqual(deletePlan.body.requiredConfirmation, ["delete"]);

  const overwriteDecision = planRouteAwareRequestAuthorization({
    request: bearerRequest("PUT", sourcePath),
    stores: storesForCredential(credential(["readContent", "writeContent"])),
    vaultId: "notes",
    now: new Date(now),
  });
  const overwritePlan = planProtectedResponse({ decision: overwriteDecision });
  assert.equal(overwritePlan.kind, "stronger-confirmation-required");
  assert.deepEqual(overwritePlan.body.requiredConfirmation, ["conflictOverwrite"]);
  assertSanitized(serializedPlan(overwritePlan));
});

test("unknown route maps to fail-closed response plan", () => {
  const decision = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/unknown/Notes/secret.md"),
    stores: storesForCredential(credential(["readIndex"])),
    now: new Date(now),
  });
  const plan = planProtectedResponse({ decision });

  assert.equal(plan.kind, "not-found-or-unknown-route");
  assert.equal(plan.httpStatus, 404);
  assert.equal(plan.body.reasonCode, "route-not-found");
  assertSanitized(serializedPlan(plan));
});

test("protected-mode startup or store-not-ready maps to service-unavailable response plan", () => {
  const plan = planProtectedResponse({ protectedModeReady: false });

  assert.equal(plan.kind, "service-unavailable-or-not-ready");
  assert.equal(plan.httpStatus, 503);
  assert.equal(plan.body.reasonCode, "protected-mode-not-ready");
  assert.equal(plan.body.protectedModeOperational, false);
  assert.equal(plan.body.enforcementActive, false);
  assert.equal(plan.body.networkExposureSafe, false);
});

test("reduced anonymous health/status plans omit details", () => {
  const decision = planRouteAwareRequestAuthorization({
    request: {
      method: "GET",
      path: "/api/health",
      headers: { authorization: `Bearer ${badTokenMaterial}` },
    },
    stores: emptyStores(),
    reducedAnonymousRequested: true,
    now: new Date(now),
  });
  const plan = planProtectedResponse({ decision });
  const serialized = serializedPlan(plan);

  assert.equal(plan.kind, "reduced-anonymous");
  assert.equal(plan.httpStatus, 200);
  assert.equal(serialized.includes("vault"), false);
  assert.equal(serialized.includes("root"), false);
  assert.equal(serialized.includes("127.0.0.1"), false);
  assertSanitized(serialized);
});

test("all response plans remain non-enforcing and not network-safe", () => {
  const decisions = [
    planRouteAwareRequestAuthorization({
      request: bearerRequest("GET", "/api/vaults/notes/index"),
      stores: storesForCredential(credential(["readIndex"])),
      vaultId: "notes",
      now: new Date(now),
    }),
    planRouteAwareRequestAuthorization({
      request: { method: "GET", path: "/api/vaults/notes/index" },
      stores: storesForCredential(credential(["readIndex"])),
      vaultId: "notes",
      now: new Date(now),
    }),
  ];

  for (const plan of [
    ...decisions.map((decision) => planProtectedResponse({ decision })),
    planProtectedResponse({ protectedModeReady: false }),
  ]) {
    assert.equal(plan.enforcementActive, false);
    assert.equal(plan.networkExposureSafe, false);
    assert.equal(plan.body.enforcementActive, false);
    assert.equal(plan.body.networkExposureSafe, false);
  }
});

test("protected response planner is not imported by active request handling", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("protectedResponsePlanner"), false);
});
