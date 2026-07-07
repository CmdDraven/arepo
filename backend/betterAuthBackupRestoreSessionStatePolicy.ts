export const BETTER_AUTH_BACKUP_RESTORE_SESSION_STATE_POLICY_MOUNTED = false;
export const BETTER_AUTH_BACKUP_RESTORE_SESSION_STATE_POLICY_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_BACKUP_RESTORE_SESSION_STATE_POLICY_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_BACKUP_RESTORE_SESSION_STATE_POLICY_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthBackupRestoreSessionStatePolicyStatus = "accepted-with-conditions";

export type BetterAuthBackupRestoreRemainingBlocker =
  | "production-arepo-better-auth-plugin-needed"
  | "arepo-sidecar-authorization-store-needed"
  | "arepo-owned-csrf-live-integration-blocked"
  | "better-auth-output-sanitization-wrapper-needed"
  | "activation-gate-mounting-still-forbidden";

export type BetterAuthBackupRestoreAuditCategory =
  | "browser_auth_state_reset"
  | "browser_auth_restore_suspected"
  | "browser_auth_epoch_mismatch"
  | "browser_auth_sidecar_mismatch"
  | "browser_auth_repairing_required";

export type BetterAuthBackupRestoreSessionStatePolicy = {
  status: BetterAuthBackupRestoreSessionStatePolicyStatus;
  decision: "require-auth-state-epoch-and-fail-closed-on-restore-mismatch";
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
  stateClassification: {
    authDbIsSensitiveGeneratedAppState: true;
    sidecarStateIsSensitiveGeneratedAppState: true;
    authDbIsVaultContent: false;
    sidecarStateIsVaultContent: false;
    vaultSyncExportMustExcludeAuthStateByDefault: true;
  };
  backupPosture: {
    operatorBackupsMayIncludeAppDataOnlyWithWarning: true;
    authDbBackupDiscouragedWithoutOperatorProtection: true;
    operatorToolEncryptionRecommended: true;
    localhostOnlyRisk: "sensitive-local-app-state";
    futureSelfHostRisk: "high-risk-without-operator-backup-and-https-policy";
  };
  restoreBehavior: {
    authDbRestoredWithoutSidecar: "fail-closed-repairing-required";
    sidecarRestoredWithoutAuthDb: "fail-closed-repairing-required";
    bothRestoredDifferentPointsInTime: "fail-closed-reset-or-repairing-required";
    bothRestoredSamePointInTime: "suspicious-until-current-epoch-accepted";
    restoredStateSilentlyReenablesBrowserSessions: false;
    restoredBrowserSessionAuthorityTrustedByDefault: false;
    resetOrRePairingRequiredByDefault: true;
  };
  epochPolicy: {
    authStateEpochRequiredBeforeLiveActivation: true;
    sidecarReferencesBindToCurrentAuthStateEpoch: true;
    backupRestoreShouldIncrementOrRotateEpoch: true;
    oldEpochStateFailsClosed: true;
    epochMismatchRequiresResetOrRePairing: true;
    epochStoredOutsideCookies: true;
    epochNotFrontendControlled: true;
  };
  resetPolicy: {
    deletingAuthDbRevokesAllBrowserSessions: true;
    deletingSidecarStateRevokesArepoRouteAuthority: true;
    authStateResetInvalidatesSidecarReferences: true;
    resetRequiresRePairing: true;
    revokeAllPreferredWhenStateIsConsistent: true;
    authDbResetPreferredWhenStateIsSuspicious: true;
    sidecarTombstoningPreferredForAudit: true;
  };
  mismatchDetectionPolicy: {
    detectMissingBetterAuthSessionForSidecar: true;
    detectMissingSidecarForBetterAuthSession: true;
    detectEpochMismatch: true;
    detectDuplicatedSidecarReference: true;
    detectSuspiciousFutureExpiry: true;
    detectionIsBestEffortUntilSidecarStoreExists: true;
    betterAuthAloneCannotDetectArepoRestoreSemantics: true;
  };
  interaction: {
    renewalBlockedOnRestoreSuspicion: true;
    pruningMarksSuspiciousStateStaleOrExpired: true;
    revokeCurrentAllowedOnlyWhenReferencesMatch: true;
    revokeAllAllowedForCurrentEpochSubject: true;
    csrfCannotOverrideRestoreSuspicion: true;
    activationGateMustBlockUntilPolicyImplemented: true;
  };
  operatorStatusPolicy: {
    operatorWarningsRequired: true;
    reducedAnonymousStatusMayReportRestoreSuspicion: true;
    reducedAnonymousStatusExposesSessionMetadata: false;
    fullAuthorizedStatusMayExposeAggregateCounts: true;
    warningsMustBeSanitized: true;
  };
  auditStatusPolicy: {
    auditRequired: true;
    auditCategories: readonly BetterAuthBackupRestoreAuditCategory[];
    auditMustUseRedactedReferencesOnly: true;
    auditMustNotRetainCredentialMaterial: true;
  };
  activationRequirements: {
    internalAdapterWrapperImplemented: false;
    sidecarAuthorizationStoreImplemented: false;
    authStateEpochImplemented: false;
    csrfIntegrationImplemented: false;
    disabledLiveMountingDesignAccepted: false;
  };
  remainingActivationBlockers: readonly BetterAuthBackupRestoreRemainingBlocker[];
};

export function planBetterAuthBackupRestoreSessionStatePolicy(): BetterAuthBackupRestoreSessionStatePolicy {
  return {
    status: "accepted-with-conditions",
    decision: "require-auth-state-epoch-and-fail-closed-on-restore-mismatch",
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
    stateClassification: {
      authDbIsSensitiveGeneratedAppState: true,
      sidecarStateIsSensitiveGeneratedAppState: true,
      authDbIsVaultContent: false,
      sidecarStateIsVaultContent: false,
      vaultSyncExportMustExcludeAuthStateByDefault: true,
    },
    backupPosture: {
      operatorBackupsMayIncludeAppDataOnlyWithWarning: true,
      authDbBackupDiscouragedWithoutOperatorProtection: true,
      operatorToolEncryptionRecommended: true,
      localhostOnlyRisk: "sensitive-local-app-state",
      futureSelfHostRisk: "high-risk-without-operator-backup-and-https-policy",
    },
    restoreBehavior: {
      authDbRestoredWithoutSidecar: "fail-closed-repairing-required",
      sidecarRestoredWithoutAuthDb: "fail-closed-repairing-required",
      bothRestoredDifferentPointsInTime: "fail-closed-reset-or-repairing-required",
      bothRestoredSamePointInTime: "suspicious-until-current-epoch-accepted",
      restoredStateSilentlyReenablesBrowserSessions: false,
      restoredBrowserSessionAuthorityTrustedByDefault: false,
      resetOrRePairingRequiredByDefault: true,
    },
    epochPolicy: {
      authStateEpochRequiredBeforeLiveActivation: true,
      sidecarReferencesBindToCurrentAuthStateEpoch: true,
      backupRestoreShouldIncrementOrRotateEpoch: true,
      oldEpochStateFailsClosed: true,
      epochMismatchRequiresResetOrRePairing: true,
      epochStoredOutsideCookies: true,
      epochNotFrontendControlled: true,
    },
    resetPolicy: {
      deletingAuthDbRevokesAllBrowserSessions: true,
      deletingSidecarStateRevokesArepoRouteAuthority: true,
      authStateResetInvalidatesSidecarReferences: true,
      resetRequiresRePairing: true,
      revokeAllPreferredWhenStateIsConsistent: true,
      authDbResetPreferredWhenStateIsSuspicious: true,
      sidecarTombstoningPreferredForAudit: true,
    },
    mismatchDetectionPolicy: {
      detectMissingBetterAuthSessionForSidecar: true,
      detectMissingSidecarForBetterAuthSession: true,
      detectEpochMismatch: true,
      detectDuplicatedSidecarReference: true,
      detectSuspiciousFutureExpiry: true,
      detectionIsBestEffortUntilSidecarStoreExists: true,
      betterAuthAloneCannotDetectArepoRestoreSemantics: true,
    },
    interaction: {
      renewalBlockedOnRestoreSuspicion: true,
      pruningMarksSuspiciousStateStaleOrExpired: true,
      revokeCurrentAllowedOnlyWhenReferencesMatch: true,
      revokeAllAllowedForCurrentEpochSubject: true,
      csrfCannotOverrideRestoreSuspicion: true,
      activationGateMustBlockUntilPolicyImplemented: true,
    },
    operatorStatusPolicy: {
      operatorWarningsRequired: true,
      reducedAnonymousStatusMayReportRestoreSuspicion: true,
      reducedAnonymousStatusExposesSessionMetadata: false,
      fullAuthorizedStatusMayExposeAggregateCounts: true,
      warningsMustBeSanitized: true,
    },
    auditStatusPolicy: {
      auditRequired: true,
      auditCategories: [
        "browser_auth_state_reset",
        "browser_auth_restore_suspected",
        "browser_auth_epoch_mismatch",
        "browser_auth_sidecar_mismatch",
        "browser_auth_repairing_required",
      ],
      auditMustUseRedactedReferencesOnly: true,
      auditMustNotRetainCredentialMaterial: true,
    },
    activationRequirements: {
      internalAdapterWrapperImplemented: false,
      sidecarAuthorizationStoreImplemented: false,
      authStateEpochImplemented: false,
      csrfIntegrationImplemented: false,
      disabledLiveMountingDesignAccepted: false,
    },
    remainingActivationBlockers: [
      "production-arepo-better-auth-plugin-needed",
      "arepo-sidecar-authorization-store-needed",
      "arepo-owned-csrf-live-integration-blocked",
      "better-auth-output-sanitization-wrapper-needed",
      "activation-gate-mounting-still-forbidden",
    ],
  };
}
