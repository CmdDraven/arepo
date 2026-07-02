import type { AuthAuditEventKind, AuthAuditResult } from "./authAudit.js";
import {
  createTokenDisplayPrefix,
  createTokenLookupId,
  verifyTokenMaterial,
} from "./credentialVerifier.js";
import {
  createSessionDisplayPrefix,
  createSessionLookupId,
  verifyBrowserSessionMaterial,
} from "./sessionVerifier.js";
import type {
  BrowserSessionMetadata,
  BrowserSessionMetadataStore,
  CredentialActorKind,
  CredentialMetadata,
  CredentialMetadataStore,
  RevocationMetadataStore,
  TokenVerifierMetadata,
  TokenVerifierMetadataStore,
  VaultScopedGrant,
} from "./credentialStore.js";
import type { RoutePermission } from "./routePermissions.js";

export const CREDENTIAL_VERIFICATION_SERVICE_NETWORK_EXPOSURE_SAFE = false;

export type CredentialVerificationMode = "apiTokenMaterial" | "browserSessionMaterial";

export type CredentialVerificationStores = {
  credentialStore: CredentialMetadataStore;
  tokenVerifierStore: TokenVerifierMetadataStore;
  browserSessionStore: BrowserSessionMetadataStore;
  revocationStore: RevocationMetadataStore;
};

export type CredentialVerificationReasonCode =
  | "verified"
  | "token-verifier-not-found"
  | "token-verifier-malformed"
  | "token-verifier-expired"
  | "token-verifier-revoked"
  | "token-verifier-mismatch"
  | "session-not-found"
  | "session-malformed"
  | "session-expired"
  | "session-revoked"
  | "session-logged-out"
  | "session-mismatch"
  | "credential-missing"
  | "credential-expired"
  | "credential-revoked"
  | "credential-disabled"
  | "credential-unsupported"
  | "credential-verifier-unlinked"
  | "credential-session-unlinked"
  | "node-secret-generation-revoked";

export type CredentialVerificationAuditIntent = {
  kind: AuthAuditEventKind;
  result: AuthAuditResult;
  reasonCode: CredentialVerificationReasonCode;
  credentialId?: string;
  sessionId?: string;
  operation: "verifyTokenMaterial" | "verifyBrowserSessionMaterial";
  metadata: {
    mode: CredentialVerificationMode;
    verifierId?: string;
    displayPrefix?: string;
  };
};

export type VerifiedCredential = {
  status: "verified";
  mode: CredentialVerificationMode;
  reasonCode: "verified";
  credentialId: string;
  actorKind: CredentialActorKind;
  nodePermissions: readonly RoutePermission[];
  vaultGrants: readonly VaultScopedGrant[];
  auditIntent: CredentialVerificationAuditIntent;
  networkExposureSafe: false;
};

export type RejectedCredentialVerification = {
  status: "rejected" | "not-found";
  mode: CredentialVerificationMode;
  reasonCode: Exclude<CredentialVerificationReasonCode, "verified">;
  credentialId?: string;
  verifierId?: string;
  sessionId?: string;
  auditIntent: CredentialVerificationAuditIntent;
  networkExposureSafe: false;
};

export type CredentialVerificationResult = VerifiedCredential | RejectedCredentialVerification;

export type VerifySuppliedTokenInput = {
  tokenMaterial: string | Buffer;
  stores: CredentialVerificationStores;
  now?: Date;
};

export type VerifySuppliedBrowserSessionInput = {
  sessionSecretMaterial: string | Buffer;
  stores: CredentialVerificationStores;
  now?: Date;
};

export function verifySuppliedTokenCredential(
  input: VerifySuppliedTokenInput,
): CredentialVerificationResult {
  const lookupId = createTokenLookupId(input.tokenMaterial);
  const displayPrefix = createTokenDisplayPrefix(input.tokenMaterial);
  const candidates = input.stores.tokenVerifierStore.tokenVerifiers.filter(
    (verifier) => verifier.lookupId === lookupId || verifier.displayPrefix === displayPrefix,
  );

  if (candidates.length === 0) {
    return rejected("not-found", "apiTokenMaterial", "token-verifier-not-found", {
      operation: "verifyTokenMaterial",
      displayPrefix,
    });
  }

  for (const verifier of candidates) {
    if (isRevoked(input.stores.revocationStore, "tokenVerifier", verifier.verifierId)) {
      return rejected("rejected", "apiTokenMaterial", "token-verifier-revoked", {
        credentialId: verifier.credentialId,
        verifierId: verifier.verifierId,
        operation: "verifyTokenMaterial",
        displayPrefix: verifier.displayPrefix,
      });
    }

    const verified = verifyTokenMaterial(input.tokenMaterial, verifier, input.now);
    if (!verified.ok) {
      if (verified.reason === "mismatch") continue;
      return rejected("rejected", "apiTokenMaterial", tokenReason(verified.reason), {
        credentialId: verifier.credentialId,
        verifierId: verifier.verifierId,
        operation: "verifyTokenMaterial",
        displayPrefix: verifier.displayPrefix,
      });
    }

    return verifyCredentialState({
      mode: "apiTokenMaterial",
      operation: "verifyTokenMaterial",
      credentialId: verifier.credentialId,
      verifierId: verifier.verifierId,
      displayPrefix: verifier.displayPrefix,
      stores: input.stores,
      now: input.now,
      expectedCredentialUse: "token",
    });
  }

  return rejected("rejected", "apiTokenMaterial", "token-verifier-mismatch", {
    operation: "verifyTokenMaterial",
    displayPrefix,
  });
}

export function verifySuppliedBrowserSessionCredential(
  input: VerifySuppliedBrowserSessionInput,
): CredentialVerificationResult {
  const lookupId = createSessionLookupId(input.sessionSecretMaterial);
  const displayPrefix = createSessionDisplayPrefix(input.sessionSecretMaterial);
  const candidates = input.stores.browserSessionStore.sessions.filter(
    (session) => session.lookupId === lookupId || session.displayPrefix === displayPrefix,
  );

  if (candidates.length === 0) {
    return rejected("not-found", "browserSessionMaterial", "session-not-found", {
      operation: "verifyBrowserSessionMaterial",
      displayPrefix,
    });
  }

  for (const session of candidates) {
    if (isRevoked(input.stores.revocationStore, "browserSession", session.sessionId)) {
      return rejected("rejected", "browserSessionMaterial", "session-revoked", {
        credentialId: session.credentialId,
        verifierId: session.verifierId,
        sessionId: session.sessionId,
        operation: "verifyBrowserSessionMaterial",
        displayPrefix: session.displayPrefix,
      });
    }

    const verified = verifyBrowserSessionMaterial(input.sessionSecretMaterial, session, input.now);
    if (!verified.ok) {
      if (verified.reason === "mismatch") continue;
      return rejected("rejected", "browserSessionMaterial", sessionReason(verified.reason), {
        credentialId: session.credentialId,
        verifierId: session.verifierId,
        sessionId: session.sessionId,
        operation: "verifyBrowserSessionMaterial",
        displayPrefix: session.displayPrefix,
      });
    }

    return verifyCredentialState({
      mode: "browserSessionMaterial",
      operation: "verifyBrowserSessionMaterial",
      credentialId: session.credentialId,
      verifierId: session.verifierId,
      sessionId: session.sessionId,
      displayPrefix: session.displayPrefix,
      stores: input.stores,
      now: input.now,
      expectedCredentialUse: "browserSession",
    });
  }

  return rejected("rejected", "browserSessionMaterial", "session-mismatch", {
    operation: "verifyBrowserSessionMaterial",
    displayPrefix,
  });
}

function verifyCredentialState(input: {
  mode: CredentialVerificationMode;
  operation: CredentialVerificationAuditIntent["operation"];
  credentialId: string;
  verifierId: string;
  sessionId?: string;
  displayPrefix: string;
  stores: CredentialVerificationStores;
  now?: Date;
  expectedCredentialUse: "token" | "browserSession";
}): CredentialVerificationResult {
  if (hasNodeSecretGenerationRevocation(input.stores.revocationStore)) {
    return rejected("rejected", input.mode, "node-secret-generation-revoked", input);
  }

  const credential = input.stores.credentialStore.credentials.find(
    (candidate) => candidate.credentialId === input.credentialId,
  );
  if (!credential) {
    return rejected("rejected", input.mode, "credential-missing", input);
  }
  if (isCredentialDisabled(credential)) {
    return rejected("rejected", input.mode, "credential-disabled", input);
  }
  if (
    credential.revokedAt ||
    isRevoked(input.stores.revocationStore, "credential", credential.credentialId)
  ) {
    return rejected("rejected", input.mode, "credential-revoked", input);
  }
  const now = input.now ?? new Date();
  if (credential.expiresAt && Date.parse(credential.expiresAt) <= now.getTime()) {
    return rejected("rejected", input.mode, "credential-expired", input);
  }
  if (!credentialMatchesUse(credential, input.expectedCredentialUse)) {
    return rejected("rejected", input.mode, "credential-unsupported", input);
  }
  if (
    input.expectedCredentialUse === "token" &&
    !credential.verifierIds.includes(input.verifierId)
  ) {
    return rejected("rejected", input.mode, "credential-verifier-unlinked", input);
  }
  if (
    input.expectedCredentialUse === "browserSession" &&
    (!input.sessionId || !credential.sessionIds.includes(input.sessionId))
  ) {
    return rejected("rejected", input.mode, "credential-session-unlinked", input);
  }

  return {
    status: "verified",
    mode: input.mode,
    reasonCode: "verified",
    credentialId: credential.credentialId,
    actorKind: credential.actorKind,
    nodePermissions: credential.nodePermissions,
    vaultGrants: credential.vaultGrants,
    auditIntent: auditIntent({
      kind: "auth.attempt.accepted",
      result: "accepted",
      reasonCode: "verified",
      credentialId: credential.credentialId,
      sessionId: input.sessionId,
      operation: input.operation,
      mode: input.mode,
      verifierId: input.verifierId,
      displayPrefix: input.displayPrefix,
    }),
    networkExposureSafe: false,
  };
}

function rejected(
  status: RejectedCredentialVerification["status"],
  mode: CredentialVerificationMode,
  reasonCode: RejectedCredentialVerification["reasonCode"],
  context: {
    credentialId?: string;
    verifierId?: string;
    sessionId?: string;
    operation: CredentialVerificationAuditIntent["operation"];
    displayPrefix?: string;
  },
): RejectedCredentialVerification {
  return {
    status,
    mode,
    reasonCode,
    credentialId: context.credentialId,
    verifierId: context.verifierId,
    sessionId: context.sessionId,
    auditIntent: auditIntent({
      kind: "auth.attempt.rejected",
      result: "rejected",
      reasonCode,
      credentialId: context.credentialId,
      sessionId: context.sessionId,
      operation: context.operation,
      mode,
      verifierId: context.verifierId,
      displayPrefix: context.displayPrefix,
    }),
    networkExposureSafe: false,
  };
}

function auditIntent(input: {
  kind: AuthAuditEventKind;
  result: AuthAuditResult;
  reasonCode: CredentialVerificationReasonCode;
  credentialId?: string;
  sessionId?: string;
  operation: CredentialVerificationAuditIntent["operation"];
  mode: CredentialVerificationMode;
  verifierId?: string;
  displayPrefix?: string;
}): CredentialVerificationAuditIntent {
  return {
    kind: input.kind,
    result: input.result,
    reasonCode: input.reasonCode,
    credentialId: input.credentialId,
    sessionId: input.sessionId,
    operation: input.operation,
    metadata: {
      mode: input.mode,
      verifierId: input.verifierId,
      displayPrefix: input.displayPrefix,
    },
  };
}

function tokenReason(
  reason: Exclude<ReturnType<typeof verifyTokenMaterial>, { ok: true }>["reason"],
): RejectedCredentialVerification["reasonCode"] {
  switch (reason) {
    case "malformed-verifier":
      return "token-verifier-malformed";
    case "expired":
      return "token-verifier-expired";
    case "revoked":
      return "token-verifier-revoked";
    case "mismatch":
      return "token-verifier-mismatch";
  }
}

function sessionReason(
  reason: Exclude<ReturnType<typeof verifyBrowserSessionMaterial>, { ok: true }>["reason"],
): RejectedCredentialVerification["reasonCode"] {
  switch (reason) {
    case "malformed-session":
      return "session-malformed";
    case "expired":
      return "session-expired";
    case "revoked":
      return "session-revoked";
    case "logged-out":
      return "session-logged-out";
    case "mismatch":
      return "session-mismatch";
  }
}

function credentialMatchesUse(
  credential: CredentialMetadata,
  expectedUse: "token" | "browserSession",
): boolean {
  if (expectedUse === "browserSession") return credential.actorKind === "browserSession";
  return credential.actorKind !== "browserSession";
}

function isCredentialDisabled(credential: CredentialMetadata): boolean {
  return (credential as CredentialMetadata & { disabled?: unknown }).disabled === true;
}

function isRevoked(
  revocationStore: RevocationMetadataStore,
  targetKind: "credential" | "tokenVerifier" | "browserSession",
  targetId: string,
): boolean {
  return revocationStore.revocations.some(
    (revocation) => revocation.targetKind === targetKind && revocation.targetId === targetId,
  );
}

function hasNodeSecretGenerationRevocation(revocationStore: RevocationMetadataStore): boolean {
  return revocationStore.revocations.some(
    (revocation) => revocation.targetKind === "nodeSecretGeneration",
  );
}
