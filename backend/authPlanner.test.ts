import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  planProtectedRouteAuthorization,
  type AuthPlanningActor,
  type CredentialPlanningActor,
} from "./authPlanner.js";
import { PROTECTED_ROUTE_POLICIES, type ProtectedRoutePolicy } from "./routePermissions.js";

const anonymous: AuthPlanningActor = { kind: "anonymous" };

const indexReader = credential({
  vaultGrants: [{ vaultId: "notes", permissions: ["readIndex"] }],
});

const contentReader = credential({
  vaultGrants: [{ vaultId: "notes", permissions: ["readContent"] }],
});

const writer = credential({
  vaultGrants: [{ vaultId: "notes", permissions: ["readContent", "writeContent"] }],
});

const deleter = credential({
  vaultGrants: [{ vaultId: "notes", permissions: ["readContent", "writeContent", "deleteFiles"] }],
});

function credential(overrides: Partial<CredentialPlanningActor> = {}): CredentialPlanningActor {
  return {
    kind: "credential",
    credentialId: "cred-1",
    displayName: "Test Credential",
    actorKind: "session",
    nodePermissions: [],
    vaultGrants: [],
    ...overrides,
  };
}

function policyFor(route: string): ProtectedRoutePolicy {
  const policy = PROTECTED_ROUTE_POLICIES.find(
    (item) => `${item.method} ${item.routePattern}` === route,
  );
  assert.ok(policy, `Missing route policy for ${route}`);
  return policy;
}

test("anonymous full node status plans only reduced anonymous status", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("GET /api/node/status"),
    actor: anonymous,
  });
  assert.equal(result.decision, "anonymous-reduced");
  assert.deepEqual(result.missingPermissions, ["manageNode"]);
  assert.equal(result.networkExposureSafe, false);
});

test("anonymous vault routes are denied", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("GET /api/vaults/:vaultId/index"),
    actor: anonymous,
    vaultId: "notes",
  });
  assert.equal(result.decision, "deny");
  assert.equal(result.networkExposureSafe, false);
});

test("authenticated vault collection discovery defers visibility to response shaping", () => {
  const policy = policyFor("GET /api/vaults");
  const zeroGrant = planProtectedRouteAuthorization({ policy, actor: credential() });
  const manager = planProtectedRouteAuthorization({
    policy,
    actor: credential({ nodePermissions: ["manageVaults"] }),
  });
  assert.equal(zeroGrant.decision, "allow");
  assert.deepEqual(zeroGrant.requiredPermissions, []);
  assert.equal(manager.decision, "allow");
});

test("readIndex credential can access generated index routes for an authorized vault", () => {
  for (const route of [
    "GET /api/vaults/:vaultId/index",
    "GET /api/vaults/:vaultId/index/filters?filter=...",
    "GET /api/vaults/:vaultId/index/search?q=...",
    "GET /api/vaults/:vaultId/index/inspect?path=...",
  ]) {
    const result = planProtectedRouteAuthorization({
      policy: policyFor(route),
      actor: indexReader,
      vaultId: "notes",
    });
    assert.equal(result.decision, "allow", route);
    assert.deepEqual(result.missingPermissions, []);
    assert.equal(result.networkExposureSafe, false);
  }
});

test("readIndex credential cannot read source Markdown content", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("GET /api/vaults/:vaultId/file?path=..."),
    actor: indexReader,
    vaultId: "notes",
  });
  assert.equal(result.decision, "deny");
  assert.deepEqual(result.missingPermissions, ["readContent"]);
});

test("related-note enrichment requires readIndex and readContent on the same vault", () => {
  const policy = policyFor("GET /api/vaults/:vaultId/enrichment/related?path=...");
  const denied = planProtectedRouteAuthorization({ policy, actor: indexReader, vaultId: "notes" });
  assert.equal(denied.decision, "deny");
  assert.deepEqual(denied.missingPermissions, ["readContent"]);
  const allowed = planProtectedRouteAuthorization({
    policy,
    actor: credential({
      vaultGrants: [{ vaultId: "notes", permissions: ["readIndex", "readContent"] }],
    }),
    vaultId: "notes",
  });
  assert.equal(allowed.decision, "allow");
});

test("readContent credential can read source Markdown content", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("GET /api/vaults/:vaultId/file?path=..."),
    actor: contentReader,
    vaultId: "notes",
  });
  assert.equal(result.decision, "allow");
});

test("writeContent and readContent credential can plan normal source creation", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("POST /api/vaults/:vaultId/file"),
    actor: writer,
    vaultId: "notes",
  });
  assert.equal(result.decision, "allow");
});

test("writeContent and readContent credential gets confirmation plan for conflict overwrite", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("PUT /api/vaults/:vaultId/file?path=..."),
    actor: writer,
    vaultId: "notes",
  });
  assert.equal(result.decision, "requires-confirmation");
  assert.deepEqual(result.requiredConfirmation, ["conflictOverwrite"]);
});

test("delete with deleteFiles still requires confirmation", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("DELETE /api/vaults/:vaultId/file?path=..."),
    actor: deleter,
    vaultId: "notes",
  });
  assert.equal(result.decision, "requires-confirmation");
  assert.deepEqual(result.requiredConfirmation, ["delete"]);
});

test("vault registration with manageVaults requires admin confirmation", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("POST /api/vaults"),
    actor: credential({ nodePermissions: ["manageVaults"] }),
  });
  assert.equal(result.decision, "requires-confirmation");
  assert.deepEqual(result.requiredConfirmation, ["vaultRegistration"]);
});

test("vault rebind with manageVaults requires registration-level confirmation", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("POST /api/vaults/:vaultId/rebind"),
    actor: credential({ nodePermissions: ["manageVaults"] }),
    vaultId: "notes",
  });
  assert.equal(result.decision, "requires-confirmation");
  assert.deepEqual(result.requiredConfirmation, ["vaultRegistration"]);
});

test("full node diagnostics require manageNode", () => {
  const denied = planProtectedRouteAuthorization({
    policy: policyFor("GET /api/node/status"),
    actor: credential(),
  });
  assert.equal(denied.decision, "deny");
  assert.deepEqual(denied.missingPermissions, ["manageNode"]);

  const allowed = planProtectedRouteAuthorization({
    policy: policyFor("GET /api/node/status"),
    actor: credential({ nodePermissions: ["manageNode"] }),
  });
  assert.equal(allowed.decision, "allow");
});

test("missing vault grant denies even when another vault is authorized", () => {
  const result = planProtectedRouteAuthorization({
    policy: policyFor("GET /api/vaults/:vaultId/index"),
    actor: credential({
      vaultGrants: [
        { vaultId: "other", permissions: ["readIndex", "readContent", "writeContent"] },
      ],
    }),
    vaultId: "notes",
  });
  assert.equal(result.decision, "deny");
  assert.deepEqual(result.missingPermissions, ["readIndex"]);
});

test("planner denies unknown or malformed planning input by default", () => {
  assert.equal(planProtectedRouteAuthorization({}).decision, "deny");
  assert.equal(
    planProtectedRouteAuthorization({
      policy: policyFor("GET /api/vaults/:vaultId/index"),
      actor: credential({ credentialId: "" }),
      vaultId: "notes",
    }).decision,
    "deny",
  );
});

test("planner results never mark network exposure as safe", () => {
  for (const policy of PROTECTED_ROUTE_POLICIES) {
    const result = planProtectedRouteAuthorization({
      policy,
      actor: credential({
        nodePermissions: ["manageNode", "manageVaults", "manageAuth", "readAudit"],
        vaultGrants: [
          {
            vaultId: "notes",
            permissions: ["readIndex", "readContent", "writeContent", "deleteFiles"],
          },
        ],
      }),
      vaultId: "notes",
    });
    assert.equal(result.networkExposureSafe, false, `${policy.method} ${policy.routePattern}`);
  }
});

test("request handling does not import authorization planner", async () => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("authPlanner"), false);
});
