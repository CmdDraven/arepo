import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import {
  AUTH_AUDIT_NETWORK_EXPOSURE_SAFE,
  appendAuthAuditEvent,
  parseAuthAuditJsonl,
  readAuthAuditEvents,
  resolveAuthAuditEventsPath,
  serializeAuthAuditEventJsonl,
  validateAuthAuditEvent,
  type AuthAuditEvent,
} from "./authAudit.js";

const baseEvent: AuthAuditEvent = {
  eventId: "evt-1",
  timestamp: "2026-07-02T00:00:00.000Z",
  kind: "credential.created",
  result: "accepted",
  reasonCode: "credential_created",
  actor: {
    actorId: "operator",
    actorKind: "localOperator",
    displayName: "Local Operator",
  },
  credentialId: "credential-1",
  vaultId: "notes",
  route: {
    method: "POST",
    pathPattern: "/api/vaults",
  },
  operation: "createCredential",
  metadata: {
    permissionCount: 2,
    authMode: "disabled",
    vaultIds: ["notes"],
  },
};

test("audit event validation accepts non-secret auth vault node and mutation metadata", () => {
  const validation = validateAuthAuditEvent({
    ...baseEvent,
    kind: "file.written",
    result: "planned",
    nodeId: "local",
    sessionId: "session-1",
    metadata: {
      changedPathCount: 1,
      pathHash: "path-hash-only",
      nodeMode: "local",
      mutation: "write",
    },
  });

  assert.equal(validation.ok, true);
});

test("audit event validation rejects secret cookie verifier and source content fields", () => {
  for (const forbiddenKey of [
    "token",
    "bearerToken",
    "authorization",
    "cookie",
    "sessionSecret",
    "pairingSecret",
    "privateKey",
    "passwordHash",
    "tokenVerifier",
    "fileContent",
    "documentBody",
    "markdownBody",
    "body",
    "content",
  ]) {
    const validation = validateAuthAuditEvent({
      ...baseEvent,
      metadata: {
        nested: {
          [forbiddenKey]: "secret-or-source-body",
        },
      },
    });
    assert.equal(validation.ok, false, forbiddenKey);
  }
});

test("serialization writes one audit event per JSONL line", () => {
  const line = serializeAuthAuditEventJsonl(baseEvent);
  assert.equal(line.endsWith("\n"), true);
  assert.equal(line.trim().split("\n").length, 1);
  assert.deepEqual(JSON.parse(line), baseEvent);
});

test("parsing valid JSONL returns valid events", () => {
  const raw = serializeAuthAuditEventJsonl(baseEvent);
  const parsed = parseAuthAuditJsonl(raw);
  assert.deepEqual(parsed.events, [baseEvent]);
  assert.deepEqual(parsed.errors, []);
});

test("parsing mixed valid and corrupt JSONL returns valid events and recoverable line errors", () => {
  const secondEvent: AuthAuditEvent = {
    ...baseEvent,
    eventId: "evt-2",
    kind: "credential.used",
    result: "accepted",
  };
  const raw = `${serializeAuthAuditEventJsonl(baseEvent)}{bad json\n${serializeAuthAuditEventJsonl(
    secondEvent,
  )}`;
  const parsed = parseAuthAuditJsonl(raw);

  assert.deepEqual(
    parsed.events.map((event) => event.eventId),
    ["evt-1", "evt-2"],
  );
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0]?.lineNumber, 2);
});

test("append helper appends without overwriting existing events", async (t) => {
  const dir = await makeTestTempDir(t, "arepo-audit-");
  const file = path.join(dir, "auth", "audit", "events.jsonl");
  const secondEvent: AuthAuditEvent = { ...baseEvent, eventId: "evt-2", kind: "session.used" };

  await appendAuthAuditEvent(file, baseEvent);
  await appendAuthAuditEvent(file, secondEvent);

  const raw = await fs.readFile(file, "utf8");
  assert.equal(raw.trim().split("\n").length, 2);
});

test("read helper returns events in append order", async (t) => {
  const dir = await makeTestTempDir(t, "arepo-audit-");
  const file = path.join(dir, "auth", "audit", "events.jsonl");
  const secondEvent: AuthAuditEvent = { ...baseEvent, eventId: "evt-2", kind: "token.used" };

  await appendAuthAuditEvent(file, baseEvent);
  await appendAuthAuditEvent(file, secondEvent);

  const parsed = await readAuthAuditEvents(file);
  assert.deepEqual(
    parsed.events.map((event) => event.eventId),
    ["evt-1", "evt-2"],
  );
});

test("audit event helpers use the auth audit path under app data", () => {
  const auditPath = resolveAuthAuditEventsPath("/tmp/arepo-data");
  assert.equal(auditPath, path.join("/tmp", "arepo-data", "auth", "audit", "events.jsonl"));
});

test("no audit event contains source document body content", () => {
  const validation = validateAuthAuditEvent({
    ...baseEvent,
    kind: "file.written",
    metadata: {
      markdownBody: "# Secret note body\n",
    },
  });
  assert.equal(validation.ok, false);
});

test("audit helpers do not claim network exposure is safe", () => {
  assert.equal(AUTH_AUDIT_NETWORK_EXPOSURE_SAFE, false);
});

test("request handling does not import auth audit helpers", async (t) => {
  const serverSource = await fs.readFile(path.join(process.cwd(), "backend", "server.ts"), "utf8");
  assert.equal(serverSource.includes("authAudit"), false);
});
