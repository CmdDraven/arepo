import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { planRouteAwareRequestAuthorization } from "./requestAuthorizationPlanner.js";
import {
  DEFAULT_BROWSER_SESSION_COOKIE_NAME,
  type RequestShapedCredentialInput,
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
import type { RoutePermission } from "./routePermissions.js";

const tokenMaterial = "arepo_request_planner_api_token_material";
const sessionSecretMaterial = "arepo_request_planner_browser_session_secret";
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

function bearerRequest(method: string, pathValue: string): RequestShapedCredentialInput {
  return {
    method,
    path: pathValue,
    headers: { authorization: `Bearer ${tokenMaterial}` },
  };
}

test("generated-index route with valid readIndex credential produces wouldAllow", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/vaults/notes/index/search?q=test"),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(plan.wouldAllow, true);
  assert.equal(plan.routePattern, "/api/vaults/:vaultId/index/search?q=...");
  assert.deepEqual(plan.requiredPermissions, ["readIndex"]);
  assert.equal(plan.credentialId, "api-credential-1");
});

test("related-note enrichment requires readIndex and readContent", () => {
  const denied = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/vaults/notes/enrichment/related?path=note.md"),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(denied.wouldDeny, true);
  assert.deepEqual(denied.missingPermissions, ["readContent"]);

  const allowed = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/vaults/notes/enrichment/related?path=note.md"),
    stores: storesForCredential(credential(["readIndex", "readContent"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(allowed.wouldAllow, true);
  assert.equal(allowed.routePattern, "/api/vaults/:vaultId/enrichment/related?path=...");
});

test("curation reads require readIndex while writes require writeContent too", () => {
  const read = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/vaults/notes/enrichment/related/curation?path=note.md"),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(read.wouldAllow, true);
  assert.equal(read.routePattern, "/api/vaults/:vaultId/enrichment/related/curation?path=...");

  const denied = planRouteAwareRequestAuthorization({
    request: bearerRequest("PUT", "/api/vaults/notes/enrichment/related/curation"),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(denied.wouldDeny, true);
  assert.deepEqual(denied.missingPermissions, ["writeContent"]);

  const allowed = planRouteAwareRequestAuthorization({
    request: bearerRequest("DELETE", "/api/vaults/notes/enrichment/related/curation"),
    stores: storesForCredential(credential(["readIndex", "writeContent"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(allowed.wouldAllow, true);
});

test("relationship promotion requires index, content-read, and content-write grants", () => {
  const denied = planRouteAwareRequestAuthorization({
    request: bearerRequest("POST", "/api/vaults/notes/relationships/promote"),
    stores: storesForCredential(credential(["readIndex", "writeContent"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(denied.wouldDeny, true);
  assert.deepEqual(denied.missingPermissions, ["readContent"]);

  const allowed = planRouteAwareRequestAuthorization({
    request: bearerRequest("POST", "/api/vaults/notes/relationships/promote"),
    stores: storesForCredential(credential(["readIndex", "readContent", "writeContent"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(allowed.wouldAllow, true);
  assert.equal(allowed.routePattern, "/api/vaults/:vaultId/relationships/promote");
});

test("enrichment settings separate readIndex visibility from manageVaults mutation", () => {
  const read = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/vaults/notes/enrichment/settings"),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(read.wouldAllow, true);
  assert.deepEqual(read.requiredPermissions, ["readIndex"]);

  const denied = planRouteAwareRequestAuthorization({
    request: bearerRequest("PUT", "/api/vaults/notes/enrichment/settings"),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(denied.wouldDeny, true);
  assert.deepEqual(denied.missingPermissions, ["manageVaults"]);

  const managed = planRouteAwareRequestAuthorization({
    request: bearerRequest("PUT", "/api/vaults/notes/enrichment/settings"),
    stores: storesForCredential(credential([], ["manageVaults"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(managed.wouldAllow, true);
});

test("source file read with only readIndex produces wouldDeny requiring readContent", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/vaults/notes/file?path=Notes/note.md"),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(plan.wouldDeny, true);
  assert.deepEqual(plan.missingPermissions, ["readContent"]);
  assert.ok(plan.reasonCodes.includes("requires-authorization"));
});

test("valid zero-grant credentials may invoke vault discovery without gaining vault access", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/vaults"),
    stores: storesForCredential(
      credential([], [], {
        vaultGrants: [],
      }),
    ),
    now: new Date(now),
  });
  assert.equal(plan.wouldAllow, true);
  assert.deepEqual(plan.requiredPermissions, []);
});

test("directory browsing requires manageVaults rather than vault-scoped grants", () => {
  const scoped = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/node/directories?path=/srv"),
    stores: storesForCredential(credential(["readIndex", "readContent"])),
    now: new Date(now),
  });
  assert.equal(scoped.wouldDeny, true);
  assert.deepEqual(scoped.missingPermissions, ["manageVaults"]);

  const managed = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/node/directories?path=/srv"),
    stores: storesForCredential(credential([], ["manageVaults"])),
    now: new Date(now),
  });
  assert.equal(managed.wouldAllow, true);
  assert.deepEqual(managed.requiredPermissions, ["manageVaults"]);
});

test("source write requires writeContent plus readContent", () => {
  const denied = planRouteAwareRequestAuthorization({
    request: bearerRequest("PUT", "/api/vaults/notes/file?path=Notes/note.md"),
    stores: storesForCredential(credential(["writeContent"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(denied.wouldDeny, true);
  assert.deepEqual(denied.missingPermissions, ["readContent"]);

  const confirmedNeeded = planRouteAwareRequestAuthorization({
    request: bearerRequest("PUT", "/api/vaults/notes/file?path=Notes/note.md"),
    stores: storesForCredential(credential(["readContent", "writeContent"])),
    vaultId: "notes",
    now: new Date(now),
  });
  assert.equal(confirmedNeeded.requiresStrongerConfirmation, true);
  assert.deepEqual(confirmedNeeded.requiredConfirmation, ["conflictOverwrite"]);
});

test("delete requires deleteFiles plus stronger confirmation", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: bearerRequest("DELETE", "/api/vaults/notes/file?path=Notes/note.md"),
    stores: storesForCredential(credential(["readContent", "writeContent", "deleteFiles"])),
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(plan.wouldDeny, true);
  assert.equal(plan.requiresStrongerConfirmation, true);
  assert.deepEqual(plan.requiredConfirmation, ["delete"]);
});

test("vault registration requires manageVaults and stronger admin confirmation", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: bearerRequest("POST", "/api/vaults"),
    stores: storesForCredential(credential([], ["manageVaults"])),
    now: new Date(now),
  });

  assert.equal(plan.wouldDeny, true);
  assert.equal(plan.requiresStrongerConfirmation, true);
  assert.deepEqual(plan.requiredPermissions, ["manageVaults"]);
  assert.deepEqual(plan.requiredConfirmation, ["vaultRegistration"]);
});

test("credential creation requires manageAuth and explicit stronger confirmation", () => {
  const confirmationRequired = planRouteAwareRequestAuthorization({
    request: bearerRequest("POST", "/api/node/credentials"),
    stores: storesForCredential(credential([], ["manageAuth"])),
    now: new Date(now),
  });
  assert.equal(confirmationRequired.wouldDeny, true);
  assert.equal(confirmationRequired.requiresStrongerConfirmation, true);
  assert.deepEqual(confirmationRequired.requiredPermissions, ["manageAuth"]);
  assert.deepEqual(confirmationRequired.requiredConfirmation, ["authChange"]);

  const confirmed = planRouteAwareRequestAuthorization({
    request: bearerRequest("POST", "/api/node/credentials"),
    stores: storesForCredential(credential([], ["manageAuth"])),
    strongerConfirmationPresent: true,
    now: new Date(now),
  });
  assert.equal(confirmed.wouldAllow, true);
  assert.equal(confirmed.requiresStrongerConfirmation, false);
  assert.ok(confirmed.reasonCodes.includes("planned-allow"));
});

test("full node status requires manageNode", () => {
  const denied = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/node/status"),
    stores: storesForCredential(credential(["readIndex"])),
    now: new Date(now),
  });
  assert.equal(denied.wouldDeny, true);
  assert.deepEqual(denied.missingPermissions, ["manageNode"]);

  const allowed = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/node/status"),
    stores: storesForCredential(credential([], ["manageNode"])),
    now: new Date(now),
  });
  assert.equal(allowed.wouldAllow, true);
});

test("missing credential produces requiresAuthentication", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: { method: "GET", path: "/api/vaults/notes/index" },
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(plan.wouldDeny, true);
  assert.equal(plan.requiresAuthentication, true);
  assert.ok(plan.reasonCodes.includes("requires-authentication"));
});

test("malformed credential produces wouldDeny with stable reason code", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: {
      method: "GET",
      path: "/api/vaults/notes/index",
      headers: { authorization: "Basic x" },
    },
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(plan.wouldDeny, true);
  assert.ok(plan.reasonCodes.includes("malformed-credential"));
  assert.equal(plan.credentialResult.reasonCode, "unsupported-authorization-scheme");
});

test("browser cookie mutation request plans origin and CSRF requirements", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: {
      method: "POST",
      path: "/api/vaults/notes/file",
      cookies: { [DEFAULT_BROWSER_SESSION_COOKIE_NAME]: sessionSecretMaterial },
      origin: "http://localhost:8733",
    },
    stores: storesForCredential(
      credential(["readIndex"]),
      browserCredential(["readContent", "writeContent"]),
    ),
    vaultId: "notes",
    allowedOrigins: ["http://localhost:8733"],
    csrfTokenPresent: false,
    now: new Date(now),
  });

  assert.equal(plan.requiresOriginCheck, true);
  assert.equal(plan.requiresCsrf, true);
  assert.ok(plan.browserSecurityPlan.failureReasons.includes("failed-csrf"));
});

test("header-token CLI-style request does not require CSRF but still requires auth and authorization", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: bearerRequest("POST", "/api/vaults/notes/file"),
    stores: storesForCredential(credential(["readContent", "writeContent"])),
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(plan.requiresAuthentication, true);
  assert.equal(plan.requiresAuthorization, true);
  assert.equal(plan.requiresCsrf, false);
  assert.equal(plan.wouldAllow, true);
});

test("OPTIONS preflight does not authorize the following request", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: { method: "OPTIONS", path: "/api/vaults/notes/file" },
    stores: storesForCredential(credential(["readContent", "writeContent"])),
    now: new Date(now),
  });

  assert.equal(plan.wouldAllow, false);
  assert.equal(plan.wouldDeny, true);
  assert.ok(plan.reasonCodes.includes("preflight-not-authorization"));
  assert.equal(plan.browserSecurityPlan.preflightIsAuthorization, false);
});

test("reduced anonymous health status is explicit", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: { method: "GET", path: "/api/health" },
    stores: storesForCredential(credential(["readIndex"])),
    reducedAnonymousRequested: true,
    now: new Date(now),
  });

  assert.equal(plan.anonymousReduced, true);
  assert.equal(plan.wouldAllow, false);
  assert.deepEqual(plan.requiredPermissions, ["manageNode"]);
  assert.equal(plan.credentialId, undefined);
});

test("unknown route fails closed in planner output", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/unknown"),
    stores: storesForCredential(credential(["readIndex"])),
    now: new Date(now),
  });

  assert.equal(plan.wouldDeny, true);
  assert.ok(plan.reasonCodes.includes("route-not-found"));
  assert.equal(plan.routePattern, undefined);
});

test("planner results do not include raw token session cookie or header material", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/vaults/notes/index"),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });
  const serialized = JSON.stringify(plan);

  assert.equal(serialized.includes(tokenMaterial), false);
  assert.equal(serialized.includes(sessionSecretMaterial), false);
  assert.equal(serialized.includes("Bearer"), false);
});

test("planner results always report inactive enforcement and unsafe network exposure", () => {
  const plan = planRouteAwareRequestAuthorization({
    request: bearerRequest("GET", "/api/vaults/notes/index"),
    stores: storesForCredential(credential(["readIndex"])),
    vaultId: "notes",
    now: new Date(now),
  });

  assert.equal(plan.enforcementActive, false);
  assert.equal(plan.networkExposureSafe, false);
});

test("planner is not imported by request handling files", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  const nodeServiceSource = await fs.readFile(
    path.join(process.cwd(), "backend", "nodeService.ts"),
    "utf8",
  );

  assert.equal(serverSource.includes("requestAuthorizationPlanner"), false);
  assert.equal(serverSource.includes("planRouteAwareRequestAuthorization"), false);
  assert.equal(nodeServiceSource.includes("requestAuthorizationPlanner"), false);
  assert.equal(nodeServiceSource.includes("planRouteAwareRequestAuthorization"), false);
});
