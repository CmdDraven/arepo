import { createBetterAuthAppDataProofContext } from "./betterAuthAppDataStoreProof.js";

export const BETTER_AUTH_SESSION_SCOPE_METADATA_PROOF_MOUNTED = false;
export const BETTER_AUTH_SESSION_SCOPE_METADATA_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_SESSION_SCOPE_METADATA_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_SESSION_SCOPE_METADATA_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthSessionScopeMetadataFindingStatus =
  "passed" | "accepted-design" | "needs-sidecar-state" | "blocked-for-production";

export type BetterAuthSessionScopeMetadataFinding = {
  id:
    | "stable-session-user-identifiers"
    | "local-operator-subject"
    | "device-label"
    | "vault-node-permissions"
    | "metadata-db-reopen"
    | "revoke-current"
    | "revoke-all"
    | "reduced-status"
    | "audit-references"
    | "future-route-authorization"
    | "not-live-authorization";
  status: BetterAuthSessionScopeMetadataFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

export type ArepoDeviceLabelSanitization = {
  value: string;
  changed: boolean;
  rejectedSecretLikeInput: boolean;
  maxLength: number;
};

export type BetterAuthSessionScopeMetadataProofResult = {
  status: "isolated-session-scope-metadata-proof";
  packageName: "better-auth";
  liveBrowserAuthEnabled: false;
  mountedInServer: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsLiveSetCookieHeaders: false;
  acceptsCookieCredentialsInLiveAuth: false;
  parsesCookiesForLiveAuthorization: false;
  validatesCsrfInLiveAuthorization: false;
  changesBearerTokenProtectedMode: false;
  chosenModel: "hybrid-better-auth-session-references-plus-arepo-owned-authorization";
  betterAuthOwns: readonly ["session-cookie-mechanics", "session-expiry", "session-revocation"];
  arepoOwns: readonly [
    "local-operator-subject-policy",
    "vault-node-permission-posture",
    "route-authorization-decisions",
    "device-label-policy",
    "audit-redaction-policy",
  ];
  bridgeReferences: {
    betterAuthUserIdReferenceAvailable: boolean;
    betterAuthSessionIdReferenceAvailable: boolean;
    betterAuthUserIdAcceptedAsReference: boolean;
    betterAuthSessionIdAcceptedAsReference: boolean;
    referenceValuesRedacted: true;
    preferredBridgeKey: "better-auth-user-id-and-session-id";
  };
  metadataPlacement: {
    localOperatorIdentity: "arepo-owned-app-data-state";
    deviceLabelPreferredLocation: "arepo-owned-sidecar-state";
    betterAuthSessionUserAgentMayCarrySanitizedHint: boolean;
    vaultNodePermissions: "arepo-owned-authorization-state-only";
    permissionPostureSerializedIntoCookies: false;
    permissionPostureTrustedFromFrontendInput: false;
    userControlledMetadataTrustedForAuthorization: false;
    betterAuthAdditionalFieldsStatus: "not-required-for-first-live-slice";
  };
  deviceLabelProof: {
    rawInputStored: false;
    sanitizedValue: string;
    unsafeInputRedactedTo: string;
    storedSanitizedHintRetrieved: boolean;
    controlCharactersRemoved: boolean;
    secretShapedInputRejected: boolean;
  };
  lookupProof: {
    sessionLookupExposesStableReferences: boolean;
    sessionMetadataReadableWithoutSecrets: boolean;
    metadataSurvivesAppDataDbReopen: boolean;
    safeSessionReferenceAvailableAfterReopen: boolean;
  };
  revocationProof: {
    revokeCurrentTargetsCorrectSession: boolean;
    revokeAllTargetsCorrectSubject: boolean;
    revokeAllPreservesOtherSubject: boolean;
  };
  statusAuditProof: {
    reducedAnonymousStatusShouldExposeMetadata: false;
    fullAuthorizedStatusMayExposeRedactedReferences: true;
    auditMayUseRedactedSubjectSessionDeviceRefs: true;
    auditMustNotStorePermissionSnapshotFromCookie: true;
  };
  authorizationProof: {
    futureRoutePermissionsConsumeArepoOwnedStateOnly: true;
    rawBetterAuthSessionObjectsTrustedForAuthorization: false;
    metadataChangesRequireArepoPolicyDecision: "sidecar-state-can-take-effect-immediately-session-field-changes-may-require-refresh";
  };
  backupRestoreProof: {
    metadataBackupRestoreCreatesAuthorityRisk: true;
    restoredAuthDbRequiresArepoSidecarConsistencyCheck: true;
  };
  remainingBlockers: readonly [
    "production-arepo-better-auth-plugin-needed",
    "internal-adapter-risk-decision-needed",
    "arepo-sidecar-authorization-store-needed",
    "session-scope-metadata-schema-needed",
    "renewal-update-age-policy-needed",
    "expired-session-pruning-policy-needed",
    "backup-restore-session-state-policy-needed",
    "arepo-owned-csrf-live-integration-blocked",
  ];
  findings: readonly BetterAuthSessionScopeMetadataFinding[];
};

type BetterAuthSessionScopeContextLike = Awaited<
  ReturnType<typeof createBetterAuthAppDataProofContext>
>["context"];

type FoundSessionShape = {
  session?: {
    id?: unknown;
    userId?: unknown;
    userAgent?: unknown;
  };
  user?: {
    id?: unknown;
  };
};

const safeDeviceLabelMaxLength = 64;
const redactedUnsafeDeviceLabel = "redacted-device-label";

export function sanitizeArepoBrowserDeviceLabel(input: string): ArepoDeviceLabelSanitization {
  const withoutControls = [...input]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
    .join("");
  const collapsed = withoutControls.replace(/\s+/g, " ").trim();
  const secretLike = isSecretLikeDeviceLabel(collapsed);
  const truncated = collapsed.slice(0, safeDeviceLabelMaxLength);
  const value = secretLike || truncated.length === 0 ? redactedUnsafeDeviceLabel : truncated;

  return {
    value,
    changed: value !== input,
    rejectedSecretLikeInput: secretLike,
    maxLength: safeDeviceLabelMaxLength,
  };
}

export async function runIsolatedBetterAuthSessionScopeMetadataProof(): Promise<BetterAuthSessionScopeMetadataProofResult> {
  const first = await createBetterAuthAppDataProofContext();
  await first.context.runMigrations();
  const firstContext = first.context as BetterAuthSessionScopeContextLike;
  const safeDevice = sanitizeArepoBrowserDeviceLabel("Operator Laptop\nLocal Only");
  const unsafeDevice = sanitizeArepoBrowserDeviceLabel("Authorization: Bearer secret-cookie-value");
  const user = await firstContext.internalAdapter.createUser({
    email: "arepo-session-scope-subject@example.invalid",
    name: "AREPO Local Operator Subject",
    emailVerified: true,
  });
  const otherUser = await firstContext.internalAdapter.createUser({
    email: "arepo-session-scope-other@example.invalid",
    name: "AREPO Other Local Subject",
    emailVerified: true,
  });
  const metadataSession = await firstContext.internalAdapter.createSession(user.id, false, {
    userAgent: `AREPO device ${safeDevice.value}`,
    ipAddress: "127.0.0.1",
  });
  const revokeSession = await firstContext.internalAdapter.createSession(user.id, false, {
    userAgent: "AREPO device revoke-current",
    ipAddress: "127.0.0.1",
  });
  const revokeAllSession = await firstContext.internalAdapter.createSession(user.id, false, {
    userAgent: "AREPO device revoke-all",
    ipAddress: "127.0.0.1",
  });
  const otherSubjectSession = await firstContext.internalAdapter.createSession(
    otherUser.id,
    false,
    {
      userAgent: "AREPO other subject device",
      ipAddress: "127.0.0.1",
    },
  );
  const foundBeforeReopen = await firstContext.internalAdapter.findSession(metadataSession.token);
  const beforeReopenReferences = extractSafeSessionReferences(foundBeforeReopen);
  first.database.close();

  const reopened = await createBetterAuthAppDataProofContext({ appDataDir: first.appDataDir });
  await reopened.context.runMigrations();
  const reopenedContext = reopened.context as BetterAuthSessionScopeContextLike;
  const foundAfterReopen = await reopenedContext.internalAdapter.findSession(metadataSession.token);
  const afterReopenReferences = extractSafeSessionReferences(foundAfterReopen);
  await reopenedContext.internalAdapter.deleteSession(revokeSession.token);
  const revokedCurrent = await reopenedContext.internalAdapter.findSession(revokeSession.token);
  await reopenedContext.internalAdapter.deleteUserSessions(user.id);
  const revokedAllForSubject = await reopenedContext.internalAdapter.findSession(
    revokeAllSession.token,
  );
  const otherSubjectAfterRevokeAll = await reopenedContext.internalAdapter.findSession(
    otherSubjectSession.token,
  );
  const cleanupWorked = await reopened.cleanup();
  if (!cleanupWorked) {
    throw new Error("Better Auth session-scope metadata proof cleanup failed.");
  }

  const storedSanitizedHintRetrieved =
    beforeReopenReferences.userAgent === `AREPO device ${safeDevice.value}` &&
    afterReopenReferences.userAgent === `AREPO device ${safeDevice.value}`;
  const result = {
    status: "isolated-session-scope-metadata-proof",
    packageName: "better-auth",
    liveBrowserAuthEnabled: false,
    mountedInServer: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsLiveSetCookieHeaders: false,
    acceptsCookieCredentialsInLiveAuth: false,
    parsesCookiesForLiveAuthorization: false,
    validatesCsrfInLiveAuthorization: false,
    changesBearerTokenProtectedMode: false,
    chosenModel: "hybrid-better-auth-session-references-plus-arepo-owned-authorization",
    betterAuthOwns: ["session-cookie-mechanics", "session-expiry", "session-revocation"],
    arepoOwns: [
      "local-operator-subject-policy",
      "vault-node-permission-posture",
      "route-authorization-decisions",
      "device-label-policy",
      "audit-redaction-policy",
    ],
    bridgeReferences: {
      betterAuthUserIdReferenceAvailable:
        beforeReopenReferences.userIdAvailable && beforeReopenReferences.userRecordIdAvailable,
      betterAuthSessionIdReferenceAvailable: beforeReopenReferences.sessionIdAvailable,
      betterAuthUserIdAcceptedAsReference: true,
      betterAuthSessionIdAcceptedAsReference: true,
      referenceValuesRedacted: true,
      preferredBridgeKey: "better-auth-user-id-and-session-id",
    },
    metadataPlacement: {
      localOperatorIdentity: "arepo-owned-app-data-state",
      deviceLabelPreferredLocation: "arepo-owned-sidecar-state",
      betterAuthSessionUserAgentMayCarrySanitizedHint: storedSanitizedHintRetrieved,
      vaultNodePermissions: "arepo-owned-authorization-state-only",
      permissionPostureSerializedIntoCookies: false,
      permissionPostureTrustedFromFrontendInput: false,
      userControlledMetadataTrustedForAuthorization: false,
      betterAuthAdditionalFieldsStatus: "not-required-for-first-live-slice",
    },
    deviceLabelProof: {
      rawInputStored: false,
      sanitizedValue: safeDevice.value,
      unsafeInputRedactedTo: unsafeDevice.value,
      storedSanitizedHintRetrieved,
      controlCharactersRemoved: safeDevice.changed,
      secretShapedInputRejected: unsafeDevice.rejectedSecretLikeInput,
    },
    lookupProof: {
      sessionLookupExposesStableReferences:
        beforeReopenReferences.sessionIdAvailable &&
        beforeReopenReferences.userIdAvailable &&
        beforeReopenReferences.userRecordIdAvailable,
      sessionMetadataReadableWithoutSecrets: storedSanitizedHintRetrieved,
      metadataSurvivesAppDataDbReopen: storedSanitizedHintRetrieved,
      safeSessionReferenceAvailableAfterReopen:
        afterReopenReferences.sessionIdAvailable && afterReopenReferences.userIdAvailable,
    },
    revocationProof: {
      revokeCurrentTargetsCorrectSession: revokedCurrent === null,
      revokeAllTargetsCorrectSubject: revokedAllForSubject === null,
      revokeAllPreservesOtherSubject: otherSubjectAfterRevokeAll !== null,
    },
    statusAuditProof: {
      reducedAnonymousStatusShouldExposeMetadata: false,
      fullAuthorizedStatusMayExposeRedactedReferences: true,
      auditMayUseRedactedSubjectSessionDeviceRefs: true,
      auditMustNotStorePermissionSnapshotFromCookie: true,
    },
    authorizationProof: {
      futureRoutePermissionsConsumeArepoOwnedStateOnly: true,
      rawBetterAuthSessionObjectsTrustedForAuthorization: false,
      metadataChangesRequireArepoPolicyDecision:
        "sidecar-state-can-take-effect-immediately-session-field-changes-may-require-refresh",
    },
    backupRestoreProof: {
      metadataBackupRestoreCreatesAuthorityRisk: true,
      restoredAuthDbRequiresArepoSidecarConsistencyCheck: true,
    },
    remainingBlockers: [
      "production-arepo-better-auth-plugin-needed",
      "internal-adapter-risk-decision-needed",
      "arepo-sidecar-authorization-store-needed",
      "session-scope-metadata-schema-needed",
      "renewal-update-age-policy-needed",
      "expired-session-pruning-policy-needed",
      "backup-restore-session-state-policy-needed",
      "arepo-owned-csrf-live-integration-blocked",
    ],
  } satisfies Omit<BetterAuthSessionScopeMetadataProofResult, "findings">;

  return {
    ...result,
    findings: buildFindings(result),
  };
}

function extractSafeSessionReferences(value: unknown): {
  sessionIdAvailable: boolean;
  userIdAvailable: boolean;
  userRecordIdAvailable: boolean;
  userAgent: string | null;
} {
  if (!value || typeof value !== "object") {
    return {
      sessionIdAvailable: false,
      userIdAvailable: false,
      userRecordIdAvailable: false,
      userAgent: null,
    };
  }
  const found = value as FoundSessionShape;
  return {
    sessionIdAvailable: typeof found.session?.id === "string",
    userIdAvailable: typeof found.session?.userId === "string",
    userRecordIdAvailable: typeof found.user?.id === "string",
    userAgent: typeof found.session?.userAgent === "string" ? found.session.userAgent : null,
  };
}

function isSecretLikeDeviceLabel(value: string): boolean {
  return [
    /authorization/i,
    /bearer/i,
    /cookie/i,
    /set-cookie/i,
    /csrf/i,
    /pairing/i,
    /session[._-]?token/i,
    /secret/i,
    /verifier/i,
    /sha256/i,
    /hash/i,
    /salt/i,
  ].some((pattern) => pattern.test(value));
}

function buildFindings(
  result: Omit<BetterAuthSessionScopeMetadataProofResult, "findings">,
): readonly BetterAuthSessionScopeMetadataFinding[] {
  return [
    {
      id: "stable-session-user-identifiers",
      status: result.lookupProof.sessionLookupExposesStableReferences
        ? "passed"
        : "blocked-for-production",
      summary:
        "Better Auth lookup exposes stable user/session references; proof output redacts actual values.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "local-operator-subject",
      status: "accepted-design",
      summary:
        "AREPO should store local operator subject policy in AREPO-owned app data and use Better Auth user id only as a reference.",
      blockerCodes: ["arepo-sidecar-authorization-store-needed"],
      openQuestions: ["What migration/reset flow should create the local operator sidecar record?"],
    },
    {
      id: "device-label",
      status: result.deviceLabelProof.storedSanitizedHintRetrieved
        ? "accepted-design"
        : "blocked-for-production",
      summary:
        "Sanitized operator-approved device labels may be referenced by Better Auth session metadata, but AREPO-owned sidecar state is preferred.",
      blockerCodes: ["session-scope-metadata-schema-needed"],
      openQuestions: [
        "Should live status render only AREPO sidecar labels or also Better Auth session user-agent hints?",
      ],
    },
    {
      id: "vault-node-permissions",
      status: "accepted-design",
      summary:
        "Vault and node permissions remain AREPO-owned authorization state and must not be serialized into cookies or trusted from frontend metadata.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "metadata-db-reopen",
      status: result.lookupProof.metadataSurvivesAppDataDbReopen ? "passed" : "needs-sidecar-state",
      summary:
        "Sanitized session hint metadata survives app-data database reopen in the isolated proof.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-current",
      status: result.revocationProof.revokeCurrentTargetsCorrectSession
        ? "passed"
        : "blocked-for-production",
      summary:
        "Revoke-current still targets the selected Better Auth session with metadata present.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-all",
      status:
        result.revocationProof.revokeAllTargetsCorrectSubject &&
        result.revocationProof.revokeAllPreservesOtherSubject
          ? "passed"
          : "blocked-for-production",
      summary:
        "Revoke-all targets the selected Better Auth subject and preserves another subject's session.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "reduced-status",
      status: "accepted-design",
      summary:
        "Reduced anonymous status should not expose browser-session metadata; full authorized status may expose only redacted posture.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "audit-references",
      status: "accepted-design",
      summary:
        "Audit events may use redacted subject/session/device references but must not store secrets or cookie-derived permission snapshots.",
      blockerCodes: ["browser-auth-audit-sidecar-reference-policy-needed"],
      openQuestions: [
        "Which stable redacted ids should appear in future browser-auth audit events?",
      ],
    },
    {
      id: "future-route-authorization",
      status: "accepted-design",
      summary:
        "Future route permission checks should consume AREPO-owned authorization state, not raw Better Auth session objects.",
      blockerCodes: ["arepo-sidecar-authorization-store-needed"],
      openQuestions: [],
    },
    {
      id: "not-live-authorization",
      status: "passed",
      summary:
        "The proof does not mount Better Auth, issue live cookies, or authorize live routes.",
      blockerCodes: [],
      openQuestions: [],
    },
  ];
}
