import crypto from "node:crypto";
import {
  appendAuthAuditEvent,
  validateAuthAuditEvent,
  type AuthAuditActor,
  type AuthAuditEvent,
} from "./authAudit.js";
import type {
  CredentialVerificationAuditIntent,
  CredentialVerificationResult,
} from "./credentialVerificationService.js";

export const CREDENTIAL_VERIFICATION_AUDIT_NETWORK_EXPOSURE_SAFE = false;

export type CredentialVerificationAuditContext = {
  eventId?: string;
  timestamp?: string;
  route?: AuthAuditEvent["route"];
  metadata?: Record<string, unknown>;
};

export type CredentialVerificationAuditWriteResult =
  | { ok: true; event: AuthAuditEvent; networkExposureSafe: false }
  | { ok: false; event?: AuthAuditEvent; error: string; networkExposureSafe: false };

const FORBIDDEN_AUDIT_METADATA_KEYS = new Set([
  "authorization",
  "bearerToken",
  "body",
  "content",
  "cookie",
  "documentBody",
  "fileContent",
  "hash",
  "markdownBody",
  "pairingSecret",
  "passwordHash",
  "privateKey",
  "recoverySecret",
  "salt",
  "saltId",
  "sessionSecret",
  "sessionSecretMaterial",
  "sourceBody",
  "token",
  "tokenMaterial",
  "tokenVerifier",
  "verifierHash",
]);

export function buildCredentialVerificationAuditEvent(
  result: CredentialVerificationResult,
  context: CredentialVerificationAuditContext = {},
): AuthAuditEvent {
  const intent = result.auditIntent;
  const event: AuthAuditEvent = {
    eventId: context.eventId ?? crypto.randomUUID(),
    timestamp: context.timestamp ?? new Date().toISOString(),
    kind: eventKindForVerification(result),
    result: result.status === "verified" ? "accepted" : "rejected",
    reasonCode: intent.reasonCode,
    actor: actorForVerification(result),
    credentialId: result.credentialId ?? intent.credentialId,
    sessionId: "sessionId" in result ? result.sessionId : intent.sessionId,
    route: context.route,
    operation: intent.operation,
    metadata: sanitizeAuditMetadata({
      mode: result.mode,
      status: result.status,
      verifierId: "verifierId" in result ? result.verifierId : intent.metadata.verifierId,
      displayPrefix: intent.metadata.displayPrefix,
      ...context.metadata,
    }),
  };

  const validation = validateAuthAuditEvent(event);
  if (!validation.ok) {
    throw new Error(`Invalid credential verification audit event: ${validation.errors.join(", ")}`);
  }
  return validation.event;
}

export async function appendCredentialVerificationAuditEvent(
  auditEventsPath: string,
  result: CredentialVerificationResult,
  context: CredentialVerificationAuditContext = {},
): Promise<CredentialVerificationAuditWriteResult> {
  let event: AuthAuditEvent;
  try {
    event = buildCredentialVerificationAuditEvent(result, context);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to build audit event.",
      networkExposureSafe: false,
    };
  }

  try {
    await appendAuthAuditEvent(auditEventsPath, event);
    return { ok: true, event, networkExposureSafe: false };
  } catch (error) {
    return {
      ok: false,
      event,
      error: error instanceof Error ? error.message : "Failed to append audit event.",
      networkExposureSafe: false,
    };
  }
}

export function sanitizeCredentialVerificationAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeAuditMetadata(metadata);
}

function eventKindForVerification(result: CredentialVerificationResult): AuthAuditEvent["kind"] {
  if (result.status !== "verified") return "auth.attempt.rejected";
  return result.mode === "browserSessionMaterial" ? "session.used" : "credential.used";
}

function actorForVerification(result: CredentialVerificationResult): AuthAuditActor | undefined {
  if (result.status !== "verified") return undefined;
  return {
    actorId: result.credentialId,
    actorKind: result.actorKind === "browserSession" ? "session" : "api",
  };
}

function sanitizeAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeValue(metadata);
  return isPlainRecord(sanitized) ? sanitized : {};
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (!isPlainRecord(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenAuditMetadataKey(key)) continue;
    output[key] = sanitizeValue(child);
  }
  return output;
}

function isForbiddenAuditMetadataKey(key: string): boolean {
  return FORBIDDEN_AUDIT_METADATA_KEYS.has(key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
