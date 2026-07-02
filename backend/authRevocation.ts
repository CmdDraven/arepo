import { AUTH_STORAGE_NETWORK_EXPOSURE_SAFE } from "./credentialStore.js";
import type {
  BrowserSessionMetadata,
  CredentialMetadata,
  NodeSecretMetadata,
  TokenVerifierMetadata,
} from "./credentialStore.js";
import type { AuthAuditEvent } from "./authAudit.js";

export const AUTH_REVOCATION_NETWORK_EXPOSURE_SAFE = AUTH_STORAGE_NETWORK_EXPOSURE_SAFE;

export type AuthRevocationRequest =
  | { kind: "credential"; credentialId: string; reason: string; requestedAt: string }
  | { kind: "tokenVerifier"; verifierId: string; reason: string; requestedAt: string }
  | { kind: "browserSession"; sessionId: string; reason: string; requestedAt: string }
  | { kind: "allCredentials"; reason: string; requestedAt: string }
  | { kind: "rotateNodeSecret"; reason: string; requestedAt: string }
  | { kind: "emergencyLocalOnlyReset"; reason: string; requestedAt: string }
  | { kind: "futureNodeCredential"; credentialId: string; reason: string; requestedAt: string };

export type AuthRevocationPlanStatus = "planned" | "not-found" | "already-revoked";

export type AuthRevocationPlanningState = {
  credentials: readonly CredentialMetadata[];
  tokenVerifiers: readonly TokenVerifierMetadata[];
  sessions: readonly BrowserSessionMetadata[];
  nodeSecret?: NodeSecretMetadata;
};

export type AuthRevocationPlan = {
  status: AuthRevocationPlanStatus;
  requestKind: AuthRevocationRequest["kind"];
  affectedCredentialIds: readonly string[];
  affectedVerifierIds: readonly string[];
  affectedSessionIds: readonly string[];
  affectedNodeSecretGenerationIds: readonly string[];
  auditEvents: readonly AuthAuditEvent[];
  warnings: readonly string[];
  preserveAuditHistory: true;
  deleteMarkdownFiles: false;
  protectedPostureDisabled: boolean;
  freshRegistrationRequired: boolean;
  networkExposureSafe: false;
};

export function planAuthRevocation(
  request: AuthRevocationRequest,
  state: AuthRevocationPlanningState,
): AuthRevocationPlan {
  switch (request.kind) {
    case "credential":
      return planCredentialRevocation(request, state, false);
    case "futureNodeCredential":
      return planCredentialRevocation(request, state, true);
    case "tokenVerifier":
      return planTokenVerifierRevocation(request, state);
    case "browserSession":
      return planBrowserSessionRevocation(request, state);
    case "allCredentials":
      return planRevokeAll(request, state);
    case "rotateNodeSecret":
      return planNodeSecretRotation(request, state);
    case "emergencyLocalOnlyReset":
      return planEmergencyLocalOnlyReset(request, state);
  }
}

function planCredentialRevocation(
  request: Extract<AuthRevocationRequest, { kind: "credential" | "futureNodeCredential" }>,
  state: AuthRevocationPlanningState,
  freshRegistrationRequired: boolean,
): AuthRevocationPlan {
  const credential = state.credentials.find((item) => item.credentialId === request.credentialId);
  if (!credential)
    return emptyPlan(request, "not-found", [`Credential ${request.credentialId} was not found.`]);

  const verifierIds = credential.verifierIds.filter((id) =>
    state.tokenVerifiers.some((verifier) => verifier.verifierId === id),
  );
  const sessionIds = credential.sessionIds.filter((id) =>
    state.sessions.some((session) => session.sessionId === id),
  );
  const alreadyRevoked = Boolean(credential.revokedAt);
  return makePlan({
    request,
    status: alreadyRevoked ? "already-revoked" : "planned",
    affectedCredentialIds: [credential.credentialId],
    affectedVerifierIds: verifierIds,
    affectedSessionIds: sessionIds,
    freshRegistrationRequired,
    warnings: alreadyRevoked ? [`Credential ${credential.credentialId} was already revoked.`] : [],
    eventKind: "credential.revoked",
    credentialId: credential.credentialId,
  });
}

function planTokenVerifierRevocation(
  request: Extract<AuthRevocationRequest, { kind: "tokenVerifier" }>,
  state: AuthRevocationPlanningState,
): AuthRevocationPlan {
  const verifier = state.tokenVerifiers.find((item) => item.verifierId === request.verifierId);
  if (!verifier)
    return emptyPlan(request, "not-found", [`Token verifier ${request.verifierId} was not found.`]);

  const alreadyRevoked = Boolean(verifier.revokedAt);
  return makePlan({
    request,
    status: alreadyRevoked ? "already-revoked" : "planned",
    affectedVerifierIds: [verifier.verifierId],
    warnings: alreadyRevoked ? [`Token verifier ${verifier.verifierId} was already revoked.`] : [],
    eventKind: "token.revoked",
    credentialId: verifier.credentialId,
  });
}

function planBrowserSessionRevocation(
  request: Extract<AuthRevocationRequest, { kind: "browserSession" }>,
  state: AuthRevocationPlanningState,
): AuthRevocationPlan {
  const session = state.sessions.find((item) => item.sessionId === request.sessionId);
  if (!session)
    return emptyPlan(request, "not-found", [`Browser session ${request.sessionId} was not found.`]);

  const alreadyRevoked = Boolean(session.revokedAt || session.loggedOutAt);
  return makePlan({
    request,
    status: alreadyRevoked ? "already-revoked" : "planned",
    affectedSessionIds: [session.sessionId],
    warnings: alreadyRevoked ? [`Browser session ${session.sessionId} was already revoked.`] : [],
    eventKind: "session.revoked",
    credentialId: session.credentialId,
    sessionId: session.sessionId,
  });
}

function planRevokeAll(
  request: Extract<AuthRevocationRequest, { kind: "allCredentials" }>,
  state: AuthRevocationPlanningState,
): AuthRevocationPlan {
  const credentials = activeCredentials(state.credentials);
  const verifiers = activeVerifiers(state.tokenVerifiers);
  const sessions = activeSessions(state.sessions);
  const status =
    credentials.length || verifiers.length || sessions.length ? "planned" : "already-revoked";
  return makePlan({
    request,
    status,
    affectedCredentialIds: credentials.map((credential) => credential.credentialId),
    affectedVerifierIds: verifiers.map((verifier) => verifier.verifierId),
    affectedSessionIds: sessions.map((session) => session.sessionId),
    warnings:
      status === "already-revoked" ? ["No active credentials, verifiers, or sessions remain."] : [],
    eventKind: "credential.revoked",
  });
}

function planNodeSecretRotation(
  request: Extract<AuthRevocationRequest, { kind: "rotateNodeSecret" }>,
  state: AuthRevocationPlanningState,
): AuthRevocationPlan {
  const currentGeneration = state.nodeSecret?.generation ?? 0;
  const nextGeneration = currentGeneration + 1;
  return makePlan({
    request,
    status: "planned",
    affectedCredentialIds: activeCredentials(state.credentials).map(
      (credential) => credential.credentialId,
    ),
    affectedVerifierIds: activeVerifiers(state.tokenVerifiers).map(
      (verifier) => verifier.verifierId,
    ),
    affectedSessionIds: activeSessions(state.sessions).map((session) => session.sessionId),
    affectedNodeSecretGenerationIds: [
      `generation:${currentGeneration}`,
      `generation:${nextGeneration}`,
    ],
    eventKind: "nodeSecret.rotated",
  });
}

function planEmergencyLocalOnlyReset(
  request: Extract<AuthRevocationRequest, { kind: "emergencyLocalOnlyReset" }>,
  state: AuthRevocationPlanningState,
): AuthRevocationPlan {
  return {
    ...planRevokeAll(
      { kind: "allCredentials", reason: request.reason, requestedAt: request.requestedAt },
      state,
    ),
    requestKind: request.kind,
    protectedPostureDisabled: true,
    warnings: [
      "Protected posture should be disabled conceptually.",
      "Vault config should be preserved where practical.",
      "Audit evidence must be preserved.",
      "Markdown vault source files must not be deleted.",
    ],
    auditEvents: [
      auditEvent(request, "emergency.localOnlyReset", {
        protectedPostureDisabled: true,
        deleteMarkdownFiles: false,
        preserveAuditHistory: true,
      }),
    ],
  };
}

function activeCredentials(credentials: readonly CredentialMetadata[]): CredentialMetadata[] {
  return credentials.filter((credential) => !credential.revokedAt);
}

function activeVerifiers(verifiers: readonly TokenVerifierMetadata[]): TokenVerifierMetadata[] {
  return verifiers.filter((verifier) => !verifier.revokedAt);
}

function activeSessions(sessions: readonly BrowserSessionMetadata[]): BrowserSessionMetadata[] {
  return sessions.filter((session) => !session.revokedAt && !session.loggedOutAt);
}

function emptyPlan(
  request: AuthRevocationRequest,
  status: AuthRevocationPlanStatus,
  warnings: readonly string[],
): AuthRevocationPlan {
  return {
    status,
    requestKind: request.kind,
    affectedCredentialIds: [],
    affectedVerifierIds: [],
    affectedSessionIds: [],
    affectedNodeSecretGenerationIds: [],
    auditEvents: [],
    warnings,
    preserveAuditHistory: true,
    deleteMarkdownFiles: false,
    protectedPostureDisabled: false,
    freshRegistrationRequired: false,
    networkExposureSafe: false,
  };
}

function makePlan(input: {
  request: AuthRevocationRequest;
  status: AuthRevocationPlanStatus;
  affectedCredentialIds?: readonly string[];
  affectedVerifierIds?: readonly string[];
  affectedSessionIds?: readonly string[];
  affectedNodeSecretGenerationIds?: readonly string[];
  warnings?: readonly string[];
  eventKind: AuthAuditEvent["kind"];
  credentialId?: string;
  sessionId?: string;
  freshRegistrationRequired?: boolean;
}): AuthRevocationPlan {
  return {
    status: input.status,
    requestKind: input.request.kind,
    affectedCredentialIds: input.affectedCredentialIds ?? [],
    affectedVerifierIds: input.affectedVerifierIds ?? [],
    affectedSessionIds: input.affectedSessionIds ?? [],
    affectedNodeSecretGenerationIds: input.affectedNodeSecretGenerationIds ?? [],
    auditEvents:
      input.status === "planned"
        ? [auditEvent(input.request, input.eventKind, {}, input.credentialId, input.sessionId)]
        : [],
    warnings: input.warnings ?? [],
    preserveAuditHistory: true,
    deleteMarkdownFiles: false,
    protectedPostureDisabled: false,
    freshRegistrationRequired: input.freshRegistrationRequired ?? false,
    networkExposureSafe: false,
  };
}

function auditEvent(
  request: AuthRevocationRequest,
  kind: AuthAuditEvent["kind"],
  metadata: Record<string, unknown> = {},
  credentialId?: string,
  sessionId?: string,
): AuthAuditEvent {
  return {
    eventId: `planned-${request.kind}-${request.requestedAt}`,
    timestamp: request.requestedAt,
    kind,
    result: "planned",
    reasonCode: request.reason,
    credentialId,
    sessionId,
    operation: request.kind,
    metadata,
  };
}
