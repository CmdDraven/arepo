import fs from "node:fs/promises";
import path from "node:path";
import {
  AUTH_STORAGE_NETWORK_EXPOSURE_SAFE,
  AUTH_STORAGE_OWNER_ONLY_DIRECTORY_MODE,
  resolveAuthStoragePaths,
} from "./credentialStore.js";

export const AUTH_AUDIT_NETWORK_EXPOSURE_SAFE = AUTH_STORAGE_NETWORK_EXPOSURE_SAFE;

export const AUTH_AUDIT_FORBIDDEN_METADATA_KEYS = [
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
] as const;

export type AuthAuditForbiddenMetadataKey = (typeof AUTH_AUDIT_FORBIDDEN_METADATA_KEYS)[number];

export type AuthAuditEventKind =
  | "auth.attempt.accepted"
  | "auth.attempt.rejected"
  | "pairing.started"
  | "pairing.completed"
  | "pairing.expired"
  | "pairing.cancelled"
  | "credential.created"
  | "credential.used"
  | "credential.revoked"
  | "token.created"
  | "token.used"
  | "token.revoked"
  | "session.created"
  | "session.used"
  | "session.revoked"
  | "nodeSecret.rotated"
  | "vault.registration.added"
  | "vault.registration.changed"
  | "vault.registration.removed"
  | "vault.permission.changed"
  | "file.created"
  | "file.written"
  | "file.renamed"
  | "file.deleted"
  | "delete.accepted"
  | "delete.rejected"
  | "path.traversal.rejected"
  | "path.symlinkEscape.rejected"
  | "path.unsafe.rejected"
  | "runtime.nonLocalBind.detected"
  | "remoteNode.registration.attempted"
  | "remoteNode.registration.accepted"
  | "remoteNode.registration.rejected"
  | "cors.origin.rejected"
  | "auth.config.changed"
  | "credential.bootstrap.attempted"
  | "credential.bootstrap.succeeded"
  | "credential.bootstrap.denied"
  | "credential.rotated"
  | "enrichmentPolicy.changed"
  | "emergency.localOnlyReset";

export type AuthAuditResult = "accepted" | "rejected" | "failed" | "planned" | "revoked";

export type AuthAuditActor = {
  actorId?: string;
  actorKind?: "anonymous" | "session" | "device" | "node" | "api" | "localOperator";
  displayName?: string;
};

export type AuthAuditEvent = {
  eventId: string;
  timestamp: string;
  kind: AuthAuditEventKind;
  result: AuthAuditResult;
  reasonCode: string;
  actor?: AuthAuditActor;
  credentialId?: string;
  sessionId?: string;
  nodeId?: string;
  vaultId?: string;
  route?: {
    method: string;
    pathPattern: string;
  };
  operation?: string;
  metadata?: Record<string, unknown>;
};

export type AuthAuditValidation =
  { ok: true; event: AuthAuditEvent } | { ok: false; errors: string[] };

export type AuthAuditJsonlParseError = {
  lineNumber: number;
  line: string;
  error: string;
};

export type AuthAuditJsonlParseResult = {
  events: AuthAuditEvent[];
  errors: AuthAuditJsonlParseError[];
};

export function resolveAuthAuditEventsPath(
  appDataDir: string,
  vaultRoots: readonly string[] = [],
): string {
  return resolveAuthStoragePaths(appDataDir, vaultRoots).auditEvents;
}

export function validateAuthAuditEvent(event: unknown): AuthAuditValidation {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return { ok: false, errors: ["event must be an object"] };
  }

  const candidate = event as Partial<AuthAuditEvent>;
  const errors: string[] = [];
  if (!isNonEmptyString(candidate.eventId)) errors.push("eventId must be a non-empty string");
  if (!isNonEmptyString(candidate.timestamp)) errors.push("timestamp must be a non-empty string");
  if (!isNonEmptyString(candidate.kind)) errors.push("kind must be a non-empty string");
  if (!isNonEmptyString(candidate.result)) errors.push("result must be a non-empty string");
  if (!isNonEmptyString(candidate.reasonCode)) {
    errors.push("reasonCode must be a non-empty string");
  }
  if (candidate.metadata !== undefined) {
    errors.push(...findForbiddenMetadataPaths(candidate.metadata));
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, event: candidate as AuthAuditEvent };
}

export function serializeAuthAuditEventJsonl(event: AuthAuditEvent): string {
  const validation = validateAuthAuditEvent(event);
  if (!validation.ok) {
    throw new Error(`Invalid auth audit event: ${validation.errors.join(", ")}`);
  }
  return `${JSON.stringify(validation.event)}\n`;
}

export function parseAuthAuditJsonl(input: string): AuthAuditJsonlParseResult {
  const events: AuthAuditEvent[] = [];
  const errors: AuthAuditJsonlParseError[] = [];
  const lines = input.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as unknown;
      const validation = validateAuthAuditEvent(parsed);
      if (validation.ok) {
        events.push(validation.event);
      } else {
        errors.push({
          lineNumber: index + 1,
          line,
          error: validation.errors.join(", "),
        });
      }
    } catch (error) {
      errors.push({
        lineNumber: index + 1,
        line,
        error: error instanceof Error ? error.message : "JSON parse failed",
      });
    }
  });

  return { events, errors };
}

export async function appendAuthAuditEvent(
  auditEventsPath: string,
  event: AuthAuditEvent,
): Promise<void> {
  await fs.mkdir(path.dirname(auditEventsPath), {
    recursive: true,
    mode: AUTH_STORAGE_OWNER_ONLY_DIRECTORY_MODE,
  });
  await fs.appendFile(auditEventsPath, serializeAuthAuditEventJsonl(event), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function readAuthAuditEvents(
  auditEventsPath: string,
): Promise<AuthAuditJsonlParseResult> {
  const raw = await fs.readFile(auditEventsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return parseAuthAuditJsonl(raw);
}

function findForbiddenMetadataPaths(value: unknown): string[] {
  const errors: string[] = [];
  visitMetadata(value, [], errors);
  return errors;
}

function visitMetadata(value: unknown, pathParts: string[], errors: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitMetadata(item, [...pathParts, String(index)], errors));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (isForbiddenMetadataKey(key)) {
      errors.push(`metadata.${childPath.join(".")} must not contain secret or source body data`);
    }
    visitMetadata(child, childPath, errors);
  }
}

function isForbiddenMetadataKey(key: string): key is AuthAuditForbiddenMetadataKey {
  return (AUTH_AUDIT_FORBIDDEN_METADATA_KEYS as readonly string[]).includes(key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
