export const BETTER_AUTH_EXPIRED_SESSION_PRUNING_POLICY_MOUNTED = false;
export const BETTER_AUTH_EXPIRED_SESSION_PRUNING_POLICY_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_EXPIRED_SESSION_PRUNING_POLICY_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_EXPIRED_SESSION_PRUNING_POLICY_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthExpiredSessionPruningPolicyStatus = "accepted-with-conditions";

export type BetterAuthExpiredSessionPruningRemainingBlocker =
  | "internal-adapter-wrapper-implementation-needed"
  | "production-arepo-better-auth-plugin-needed"
  | "arepo-sidecar-authorization-store-needed"
  | "backup-restore-session-state-policy-needed"
  | "arepo-owned-csrf-live-integration-blocked"
  | "better-auth-output-sanitization-wrapper-needed"
  | "activation-gate-mounting-still-forbidden";

export type BetterAuthPruningAuditCategory =
  | "browser_session_pruning_started"
  | "browser_session_pruning_completed"
  | "browser_session_pruning_denied"
  | "browser_session_sidecar_marked_expired"
  | "browser_session_sidecar_marked_stale";

export type BetterAuthExpiredSessionPruningPolicy = {
  status: BetterAuthExpiredSessionPruningPolicyStatus;
  decision: "prune-arepo-sidecar-state-leave-better-auth-session-cleanup-to-better-auth";
  packageName: "better-auth";
  preferredFoundation: "better-auth";
  backupFoundation: "server-side-session-core";
  liveBrowserAuthEnabled: false;
  mountedInServer: false;
  mountedInRoutes: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsSetCookieHeaders: false;
  acceptsCookieCredentials: false;
  parsesCookiesForLiveAuthorization: false;
  validatesCsrfInLiveAuthorization: false;
  changesBearerTokenProtectedMode: false;
  ownership: {
    betterAuthOwnsSessionValidityAndExpiry: true;
    arepoOwnsSidecarAuthorizationState: true;
    expiredBetterAuthSessionsAuthorizeRequests: false;
    sidecarStateAloneAuthorizesRequests: false;
    betterAuthSessionAloneAuthorizesRequests: false;
  };
  betterAuthSessionPruning: {
    deleteBetterAuthRowsDirectly: false;
    useSupportedBetterAuthCleanupApiIfAvailableLater: true;
    leaveExpiredSessionCleanupToBetterAuthUntilSupportedApiExists: true;
    directTableMutationForbidden: true;
  };
  sidecarPruning: {
    expiredSessionSidecarAction: "mark-expired-retain-redacted-tombstone";
    missingBetterAuthSessionSidecarAction: "mark-stale-fail-closed";
    activeBetterAuthMissingSidecarAction: "fail-closed-no-authority";
    mismatchedSessionSidecarAction: "mark-stale-fail-closed";
    revokedSidecarAction: "retain-revoked-tombstone";
    deleteAuthorityBearingSidecarStateAfterTombstone: true;
    retainRedactedAuditTombstones: true;
  };
  cadence: {
    startupPruningAllowed: true;
    startupPruningBounded: true;
    manualOperatorPruningPlanned: true;
    scheduledIntervalPruningDeferred: true;
    sessionLookupClassificationAllowed: true;
    logoutRevokePruningAllowed: true;
    automaticPruningCreatesAuthority: false;
  };
  failClosedCases: {
    expiredSessionWithActiveSidecar: true;
    missingBetterAuthSessionWithActiveSidecar: true;
    activeBetterAuthSessionWithMissingSidecar: true;
    mismatchedSessionAndSidecar: true;
    restoredAuthDbSidecarMismatch: true;
    restoredSidecarAuthDbMismatch: true;
    suspiciousFutureExpiry: true;
    clockSkewBeyondTolerance: true;
  };
  clockPolicy: {
    suspiciousFutureExpiryAction: "fail-closed-and-require-operator-review";
    clockSkewAction: "fail-closed-when-outside-small-tolerance";
    smallToleranceSeconds: 300;
    pruningMustUseDeterministicClockInTests: true;
  };
  interaction: {
    revokeCurrentMarksSidecarRevokedBeforePruning: true;
    revokeAllMarksMatchingSidecarsRevokedBeforePruning: true;
    renewalCannotRevivePrunedSidecar: true;
    renewalCannotReviveExpiredBetterAuthSession: true;
    deterministicExpiryClassifiesExpiredBeforePruning: true;
    backupRestoreInconsistencyRequiresResetOrRePairing: true;
  };
  auditStatusPolicy: {
    pruningAuditRequired: true;
    auditCategories: readonly BetterAuthPruningAuditCategory[];
    auditMustUseRedactedReferencesOnly: true;
    auditMustNotRetainCredentialMaterial: true;
    reducedAnonymousStatusExposesPruningDetails: false;
    fullAuthorizedStatusMayExposeAggregateCounts: true;
  };
  activationRequirements: {
    internalAdapterWrapperImplemented: false;
    sidecarAuthorizationStoreImplemented: false;
    backupRestorePolicyAccepted: false;
    csrfIntegrationImplemented: false;
    disabledLiveMountingDesignAccepted: false;
  };
  remainingActivationBlockers: readonly BetterAuthExpiredSessionPruningRemainingBlocker[];
};

export function planBetterAuthExpiredSessionPruningPolicy(): BetterAuthExpiredSessionPruningPolicy {
  return {
    status: "accepted-with-conditions",
    decision: "prune-arepo-sidecar-state-leave-better-auth-session-cleanup-to-better-auth",
    packageName: "better-auth",
    preferredFoundation: "better-auth",
    backupFoundation: "server-side-session-core",
    liveBrowserAuthEnabled: false,
    mountedInServer: false,
    mountedInRoutes: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsSetCookieHeaders: false,
    acceptsCookieCredentials: false,
    parsesCookiesForLiveAuthorization: false,
    validatesCsrfInLiveAuthorization: false,
    changesBearerTokenProtectedMode: false,
    ownership: {
      betterAuthOwnsSessionValidityAndExpiry: true,
      arepoOwnsSidecarAuthorizationState: true,
      expiredBetterAuthSessionsAuthorizeRequests: false,
      sidecarStateAloneAuthorizesRequests: false,
      betterAuthSessionAloneAuthorizesRequests: false,
    },
    betterAuthSessionPruning: {
      deleteBetterAuthRowsDirectly: false,
      useSupportedBetterAuthCleanupApiIfAvailableLater: true,
      leaveExpiredSessionCleanupToBetterAuthUntilSupportedApiExists: true,
      directTableMutationForbidden: true,
    },
    sidecarPruning: {
      expiredSessionSidecarAction: "mark-expired-retain-redacted-tombstone",
      missingBetterAuthSessionSidecarAction: "mark-stale-fail-closed",
      activeBetterAuthMissingSidecarAction: "fail-closed-no-authority",
      mismatchedSessionSidecarAction: "mark-stale-fail-closed",
      revokedSidecarAction: "retain-revoked-tombstone",
      deleteAuthorityBearingSidecarStateAfterTombstone: true,
      retainRedactedAuditTombstones: true,
    },
    cadence: {
      startupPruningAllowed: true,
      startupPruningBounded: true,
      manualOperatorPruningPlanned: true,
      scheduledIntervalPruningDeferred: true,
      sessionLookupClassificationAllowed: true,
      logoutRevokePruningAllowed: true,
      automaticPruningCreatesAuthority: false,
    },
    failClosedCases: {
      expiredSessionWithActiveSidecar: true,
      missingBetterAuthSessionWithActiveSidecar: true,
      activeBetterAuthSessionWithMissingSidecar: true,
      mismatchedSessionAndSidecar: true,
      restoredAuthDbSidecarMismatch: true,
      restoredSidecarAuthDbMismatch: true,
      suspiciousFutureExpiry: true,
      clockSkewBeyondTolerance: true,
    },
    clockPolicy: {
      suspiciousFutureExpiryAction: "fail-closed-and-require-operator-review",
      clockSkewAction: "fail-closed-when-outside-small-tolerance",
      smallToleranceSeconds: 300,
      pruningMustUseDeterministicClockInTests: true,
    },
    interaction: {
      revokeCurrentMarksSidecarRevokedBeforePruning: true,
      revokeAllMarksMatchingSidecarsRevokedBeforePruning: true,
      renewalCannotRevivePrunedSidecar: true,
      renewalCannotReviveExpiredBetterAuthSession: true,
      deterministicExpiryClassifiesExpiredBeforePruning: true,
      backupRestoreInconsistencyRequiresResetOrRePairing: true,
    },
    auditStatusPolicy: {
      pruningAuditRequired: true,
      auditCategories: [
        "browser_session_pruning_started",
        "browser_session_pruning_completed",
        "browser_session_pruning_denied",
        "browser_session_sidecar_marked_expired",
        "browser_session_sidecar_marked_stale",
      ],
      auditMustUseRedactedReferencesOnly: true,
      auditMustNotRetainCredentialMaterial: true,
      reducedAnonymousStatusExposesPruningDetails: false,
      fullAuthorizedStatusMayExposeAggregateCounts: true,
    },
    activationRequirements: {
      internalAdapterWrapperImplemented: false,
      sidecarAuthorizationStoreImplemented: false,
      backupRestorePolicyAccepted: false,
      csrfIntegrationImplemented: false,
      disabledLiveMountingDesignAccepted: false,
    },
    remainingActivationBlockers: [
      "internal-adapter-wrapper-implementation-needed",
      "production-arepo-better-auth-plugin-needed",
      "arepo-sidecar-authorization-store-needed",
      "backup-restore-session-state-policy-needed",
      "arepo-owned-csrf-live-integration-blocked",
      "better-auth-output-sanitization-wrapper-needed",
      "activation-gate-mounting-still-forbidden",
    ],
  };
}
