import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { planStrongerConfirmation } from "./strongerConfirmationPlanner.js";
import { routeRequest, type RequestLike } from "./server.js";

const sensitiveValues = [
  "/home/user/vault",
  "/tmp/arepo-vault/Notes/private.md",
  "Notes/private.md",
  "source document body",
  "markdownBody",
  "Bearer secret-token",
  "secret-token",
  "arepo_session=session-secret",
  "session-secret",
  "credential-123",
  "session-123",
  "token-123",
  "event-123",
  "verifierHash",
  "salt",
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

test("delete source file plans stronger confirmation required", () => {
  const plan = planStrongerConfirmation({
    request: {
      method: "DELETE",
      routePattern: "/api/vaults/:vaultId/file?path=...",
    },
  });

  assert.equal(plan.status, "required");
  assert.equal(plan.confirmationRequired, true);
  assert.equal(plan.operation, "delete-source-file");
  assert.deepEqual(plan.requiredConfirmation, ["delete"]);
  assert.ok(plan.reasonCodes.includes("route-requires-confirmation"));
});

test("conflict overwrite plans stronger confirmation required", () => {
  const plan = planStrongerConfirmation({
    request: {
      method: "PUT",
      routePattern: "/api/vaults/:vaultId/file?path=...",
      overwriteAfterConflict: true,
    },
  });

  assert.equal(plan.status, "required");
  assert.equal(plan.confirmationRequired, true);
  assert.equal(plan.operation, "overwrite-conflict");
  assert.deepEqual(plan.requiredConfirmation, ["conflictOverwrite"]);
  assert.ok(plan.reasonCodes.includes("overwrite-conflict"));
});

test("vault registration and removal plan stronger confirmation required", () => {
  const registration = planStrongerConfirmation({
    request: { method: "POST", routePattern: "/api/vaults" },
  });
  const removal = planStrongerConfirmation({
    request: { method: "DELETE", routePattern: "/api/vaults/:vaultId" },
  });

  assert.equal(registration.status, "required");
  assert.equal(registration.operation, "register-vault");
  assert.deepEqual(registration.requiredConfirmation, ["vaultRegistration"]);
  assert.equal(removal.status, "required");
  assert.equal(removal.operation, "remove-vault");
  assert.deepEqual(removal.requiredConfirmation, ["vaultRemoval"]);
});

test("vault rebind plans registration-level stronger confirmation", () => {
  const plan = planStrongerConfirmation({
    request: { method: "POST", routePattern: "/api/vaults/:vaultId/rebind" },
  });
  assert.equal(plan.status, "required");
  assert.equal(plan.operation, "rebind-vault");
  assert.deepEqual(plan.requiredConfirmation, ["vaultRegistration"]);
  assert.ok(plan.reasonCodes.includes("vault-rebind"));
});

test("vault permission changes plan stronger confirmation required", () => {
  const plan = planStrongerConfirmation({ operation: "change-vault-permissions" });

  assert.equal(plan.status, "required");
  assert.equal(plan.confirmationRequired, true);
  assert.deepEqual(plan.requiredConfirmation, ["vaultRegistration"]);
  assert.ok(plan.reasonCodes.includes("vault-permission-change"));
});

test("future auth management operations plan stronger confirmation required", () => {
  for (const operation of ["change-auth-mode", "create-credential", "revoke-credential"] as const) {
    const plan = planStrongerConfirmation({ operation });
    assert.equal(plan.status, "required");
    assert.equal(plan.confirmationRequired, true);
    assert.ok(plan.reasonCodes.includes("stronger-confirmation-required"));
  }
});

test("future node and remote-node operations plan stronger confirmation required", () => {
  for (const operation of [
    "rotate-node-secret",
    "emergency-local-reset",
    "register-remote-node",
    "remove-remote-node",
  ] as const) {
    const plan = planStrongerConfirmation({ operation });
    assert.equal(plan.status, "required");
    assert.equal(plan.confirmationRequired, true);
    assert.ok(plan.reasonCodes.includes("stronger-confirmation-required"));
  }
});

test("safe read and generated-index operations do not require stronger confirmation", () => {
  for (const requestShape of [
    { method: "GET" as const, routePattern: "/api/vaults/:vaultId/files" },
    { method: "GET" as const, routePattern: "/api/vaults/:vaultId/index" },
    { method: "GET" as const, routePattern: "/api/vaults/:vaultId/index/search?q=..." },
  ]) {
    const plan = planStrongerConfirmation({ request: requestShape });
    assert.equal(plan.status, "not-required");
    assert.equal(plan.confirmationRequired, false);
    assert.deepEqual(plan.requiredConfirmation, []);
    assert.ok(plan.reasonCodes.includes("stronger-confirmation-not-required"));
  }
});

test("unknown routes and unsupported operations return stable fail-closed style reasons", () => {
  const unknown = planStrongerConfirmation({
    request: { method: "POST", routePattern: "/api/unknown/private/path" },
  });
  const unsupported = planStrongerConfirmation({ operation: "delete-everything" });

  assert.equal(unknown.status, "unknown-route");
  assert.equal(unknown.confirmationRequired, false);
  assert.deepEqual(unknown.reasonCodes, ["unknown-route"]);
  assert.equal(unsupported.status, "unsupported-operation");
  assert.equal(unsupported.confirmationRequired, false);
  assert.deepEqual(unsupported.reasonCodes, ["unsupported-operation"]);
});

test("planner output is sanitized", () => {
  const plan = planStrongerConfirmation({
    operation: "delete-source-file",
    request: {
      method: "DELETE",
      routePattern: "/api/vaults/:vaultId/file?path=...",
      overwriteAfterConflict: true,
    },
  });
  const serialized = JSON.stringify(plan);

  for (const value of sensitiveValues) {
    assert.equal(serialized.includes(value), false, `unexpected sensitive value: ${value}`);
  }
  assert.equal(plan.enforcementActive, false);
  assert.equal(plan.protectedModeOperational, false);
  assert.equal(plan.networkExposureSafe, false);
});

test("stronger confirmation planner is not imported by active server handlers", async (t) => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("strongerConfirmationPlanner"), false);
  assert.equal(serverSource.includes("planStrongerConfirmation"), false);
});

test("current V1 source delete route behavior remains unchanged", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-confirmation-");
  const rootPath = await makeTestTempDir(t, "arepo-confirmation-vault-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");

  const created = await routeRequest(request("POST", "/api/vaults", { rootPath }), cwd);
  assert.equal(created.status, 201);
  const vaultId = (created.body as { data: { vault: { id: string } } }).data.vault.id;

  const deleted = await routeRequest(
    request("DELETE", `/api/vaults/${vaultId}/file?path=note.md`),
    cwd,
  );
  assert.equal(deleted.status, 400);
  assert.match((deleted.body as { error?: string }).error ?? "", /not configured for deletes/);
  assert.equal(await fileExists(path.join(rootPath, "note.md")), true);
});

async function fileExists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}
