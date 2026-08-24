import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import {
  planBrowserRequestGuard,
  type BrowserRequestGuardMethod,
} from "./browserRequestGuardPlanner.js";
import { routeRequest, type RequestLike } from "./server.js";

const appOrigin = "http://localhost:8733";
const allowedOrigin = "http://127.0.0.1:8733";

const sensitiveValues = [
  appOrigin,
  allowedOrigin,
  "http://evil.example",
  "not a url",
  "localhost:8733",
  "Authorization",
  "Bearer secret-token",
  "secret-token",
  "cookie=session-secret",
  "session-secret",
  "csrf-secret",
  "credential-123",
  "session-123",
  "token-123",
  "event-123",
  "verifierHash",
  "salt",
  "/home/user/vault",
  "/tmp/arepo-vault/Notes/private.md",
  "Notes/private.md",
  "source document body",
];

function request(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): RequestLike {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      yield* payload;
    },
  };
}

test("safe same-origin browser GET is classified without requiring CSRF", () => {
  const plan = planBrowserRequestGuard({
    method: "GET",
    routePattern: "/api/vaults/:vaultId/index",
    clientKind: "browser",
    origin: appOrigin,
    appOrigin,
    allowedOrigins: [appOrigin, allowedOrigin],
  });

  assert.equal(plan.decision, "would-allow");
  assert.equal(plan.requestSource, "same-origin-browser");
  assert.equal(plan.methodSafety, "safe");
  assert.equal(plan.csrfCheckRequired, false);
  assert.equal(plan.csrfRequirement, "not-required");
  assert.ok(plan.reasonCodes.includes("safe-method"));
});

test("unsafe same-origin browser methods require CSRF", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    const plan = planBrowserRequestGuard({
      method,
      routePattern:
        method === "POST" ? "/api/vaults/:vaultId/file" : "/api/vaults/:vaultId/file?path=...",
      requestClass: method === "PATCH" ? "source-mutation" : undefined,
      clientKind: "browser",
      origin: appOrigin,
      appOrigin,
      allowedOrigins: [appOrigin],
      csrfTokenState: "valid",
    });

    assert.equal(plan.methodSafety, "unsafe");
    assert.equal(plan.csrfCheckRequired, true);
    assert.equal(plan.csrfRequirement, "required");
    assert.ok(plan.reasonCodes.includes("csrf-required"));
  }
});

test("missing CSRF on unsafe browser mutation returns stable CSRF requirement", () => {
  const plan = planBrowserRequestGuard({
    method: "POST",
    routePattern: "/api/vaults/:vaultId/file",
    clientKind: "browser",
    origin: appOrigin,
    appOrigin,
    allowedOrigins: [appOrigin],
  });

  assert.equal(plan.decision, "would-require-csrf");
  assert.equal(plan.csrfRequirement, "missing");
  assert.ok(plan.reasonCodes.includes("csrf-missing"));
});

test("invalid CSRF on unsafe browser mutation returns stable CSRF rejection", () => {
  const plan = planBrowserRequestGuard({
    method: "DELETE",
    routePattern: "/api/vaults/:vaultId/file?path=...",
    clientKind: "browser",
    origin: appOrigin,
    appOrigin,
    allowedOrigins: [appOrigin],
    csrfTokenState: "invalid",
  });

  assert.equal(plan.decision, "would-reject-csrf");
  assert.equal(plan.csrfRequirement, "invalid");
  assert.ok(plan.reasonCodes.includes("csrf-invalid"));
});

test("disallowed browser origin returns stable origin rejection", () => {
  const plan = planBrowserRequestGuard({
    method: "GET",
    routePattern: "/api/vaults/:vaultId/index",
    clientKind: "browser",
    origin: "http://evil.example",
    appOrigin,
    allowedOrigins: [appOrigin],
  });

  assert.equal(plan.decision, "would-reject-origin");
  assert.equal(plan.requestSource, "disallowed-browser-origin");
  assert.ok(plan.reasonCodes.includes("disallowed-browser-origin"));
});

test("missing or malformed browser origin is fail-closed when origin checks are needed", () => {
  for (const origin of [undefined, "not a url"]) {
    const plan = planBrowserRequestGuard({
      method: "GET",
      routePattern: "/api/vaults/:vaultId/index",
      clientKind: "browser",
      origin,
      appOrigin,
      allowedOrigins: [appOrigin],
    });

    assert.equal(plan.decision, "would-reject-origin");
    assert.ok(plan.reasonCodes.includes(origin ? "malformed-origin" : "missing-origin"));
  }
});

test("non-browser or unknown clients are classified separately", () => {
  for (const clientKind of ["non-browser", "unknown"] as const) {
    const plan = planBrowserRequestGuard({
      method: "GET",
      routePattern: "/api/vaults/:vaultId/index",
      clientKind,
    });

    assert.equal(plan.requestSource, "non-browser-or-unknown");
    assert.equal(plan.originCheckRequired, false);
    assert.equal(plan.csrfCheckRequired, false);
    assert.equal(plan.csrfRequirement, "not-applicable");
  }
});

test("source-content reads are deliberately classified", () => {
  const plan = planBrowserRequestGuard({
    method: "GET",
    routePattern: "/api/vaults/:vaultId/file?path=...",
    clientKind: "browser",
    origin: allowedOrigin,
    appOrigin,
    allowedOrigins: [appOrigin, allowedOrigin],
  });

  assert.equal(plan.requestClass, "source-content-read");
  assert.equal(plan.csrfRequirement, "not-required");
  assert.ok(plan.reasonCodes.includes("source-content-read"));
});

test("generated-index and status reads are deliberately classified", () => {
  for (const shape of [
    { method: "GET" as const, routePattern: "/api/vaults/:vaultId/index" },
    { method: "GET" as const, routePattern: "/api/vaults/:vaultId/status" },
  ]) {
    const plan = planBrowserRequestGuard({
      ...shape,
      clientKind: "browser",
      origin: appOrigin,
      appOrigin,
      allowedOrigins: [appOrigin],
    });

    assert.equal(plan.requestClass, "generated-index-or-status-read");
    assert.ok(plan.reasonCodes.includes("generated-index-or-status-read"));
  }
});

test("vault mutation file mutation auth and node management routes require guard planning", () => {
  const plans = [
    planBrowserRequestGuard({
      method: "POST",
      routePattern: "/api/vaults",
      clientKind: "browser",
      origin: appOrigin,
      appOrigin,
      allowedOrigins: [appOrigin],
      csrfTokenState: "valid",
    }),
    planBrowserRequestGuard({
      method: "PUT",
      routePattern: "/api/vaults/:vaultId/file?path=...",
      clientKind: "browser",
      origin: appOrigin,
      appOrigin,
      allowedOrigins: [appOrigin],
      csrfTokenState: "valid",
    }),
    planBrowserRequestGuard({
      method: "POST",
      requestClass: "auth-management",
      clientKind: "browser",
      origin: appOrigin,
      appOrigin,
      allowedOrigins: [appOrigin],
      csrfTokenState: "valid",
    }),
    planBrowserRequestGuard({
      method: "GET",
      routePattern: "/api/node/status",
      clientKind: "browser",
      origin: appOrigin,
      appOrigin,
      allowedOrigins: [appOrigin],
    }),
  ];

  assert.equal(plans[0]?.requestClass, "vault-mutation");
  assert.equal(plans[1]?.requestClass, "source-mutation");
  assert.equal(plans[2]?.requestClass, "auth-management");
  assert.equal(plans[3]?.requestClass, "node-management");
  for (const plan of plans) {
    assert.equal(plan.originCheckRequired, true);
    assert.equal(plan.authenticationRequired, true);
    assert.equal(plan.authorizationRequired, true);
  }
});

test("reduced anonymous status is planned explicitly", () => {
  const plan = planBrowserRequestGuard({
    method: "GET",
    routePattern: "/api/node/status",
    clientKind: "browser",
    origin: appOrigin,
    appOrigin,
    allowedOrigins: [appOrigin],
    reducedAnonymousRequested: true,
  });

  assert.equal(plan.decision, "would-reduce-anonymous");
  assert.equal(plan.requestClass, "reduced-anonymous-status");
  assert.equal(plan.authenticationRequired, false);
  assert.equal(plan.authorizationRequired, false);
});

test("unknown routes and unsupported methods return stable reason codes", () => {
  const unknown = planBrowserRequestGuard({
    method: "GET",
    routePattern: "/api/unknown/private",
    clientKind: "browser",
    origin: appOrigin,
    appOrigin,
    allowedOrigins: [appOrigin],
  });
  const unsupported = planBrowserRequestGuard({
    method: "TRACE",
    routePattern: "/api/vaults/:vaultId/index",
    clientKind: "browser",
    origin: appOrigin,
    appOrigin,
    allowedOrigins: [appOrigin],
  });

  assert.equal(unknown.decision, "unknown-route");
  assert.deepEqual(unknown.reasonCodes, ["unknown-route"]);
  assert.equal(unsupported.decision, "unsupported-request");
  assert.ok(unsupported.reasonCodes.includes("unsupported-method"));
});

test("planner output is sanitized and invariant flags remain false", () => {
  const plan = planBrowserRequestGuard({
    method: "POST",
    routePattern: "/api/vaults/:vaultId/file",
    clientKind: "browser",
    origin: appOrigin,
    appOrigin,
    allowedOrigins: [appOrigin, allowedOrigin],
    csrfTokenState: "invalid",
  });
  const serialized = JSON.stringify(plan);

  for (const value of sensitiveValues) {
    assert.equal(serialized.includes(value), false, `unexpected sensitive value: ${value}`);
  }
  assert.equal(plan.enforcementActive, false);
  assert.equal(plan.protectedModeOperational, false);
  assert.equal(plan.networkExposureSafe, false);
});

test("browser request guard planner is not imported by active server handlers", async (t) => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("browserRequestGuardPlanner"), false);
  assert.equal(serverSource.includes("planBrowserRequestGuard"), false);
});

test("current V1 endpoint behavior is unchanged by the browser request guard planner", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-browser-guard-");
  const appDataDir = await makeTestTempDir(t, "arepo-browser-guard-data-");
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: { nodeId: "local", displayName: "Local Node", mode: "local", apiVersion: 1 },
      appDataDir,
      vaults: [],
    }),
    "utf8",
  );

  const response = await routeRequest(request("GET", "/api/vaults"), cwd);
  assert.equal(response.status, 200);
});
