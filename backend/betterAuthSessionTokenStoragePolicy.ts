export type BetterAuthSessionTokenStoragePolicyStatus =
  "accepted-with-conditions" | "blocked" | "unresolved" | "rejected" | "needs-more-proof";

export type BetterAuthSessionTokenStorageRisk = {
  code:
    | "app-data-db-copy-risk"
    | "backup-restore-session-resurrection-risk"
    | "self-host-file-system-risk"
    | "corruption-lockout-risk";
  severity: "medium" | "high";
  summary: string;
};

export type BetterAuthSessionTokenStorageMitigation = {
  code:
    | "store-auth-db-outside-vault-roots"
    | "exclude-auth-db-from-vault-sync-export"
    | "classify-auth-db-sensitive-generated-state"
    | "owner-only-file-permissions-best-effort"
    | "reset-auth-db-revokes-browser-sessions"
    | "corruption-fails-closed"
    | "backup-restore-requires-session-reset-or-repairing"
    | "operator-warning-for-app-data-secrets"
    | "no-extra-arepo-hashing-before-library-contract-review";
  requiredBeforeLiveActivation: boolean;
  summary: string;
};

export type BetterAuthSessionTokenStorageBlockerCode =
  | "internal-adapter-wrapper-implementation-needed"
  | "production-arepo-better-auth-plugin-needed"
  | "arepo-sidecar-authorization-store-needed"
  | "expired-session-pruning-policy-needed"
  | "backup-restore-session-state-policy-needed"
  | "arepo-owned-csrf-live-integration-blocked"
  | "better-auth-output-sanitization-wrapper-needed"
  | "activation-gate-mounting-still-forbidden";

export type BetterAuthSessionTokenStoragePolicy = {
  status: BetterAuthSessionTokenStoragePolicyStatus;
  decision: "accept-better-auth-session-token-storage-with-conditions";
  preferredFoundation: "better-auth";
  backupFoundation: "server-side-session-core";
  liveBrowserAuthEnabled: false;
  mountedInServer: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsSetCookieHeaders: false;
  acceptsCookieCredentials: false;
  parsesCookiesForLiveAuthorization: false;
  validatesCsrfInLiveAuthorization: false;
  changesBearerTokenProtectedMode: false;
  appDataPathExpectation: "app-data/auth/better-auth.sqlite";
  authDatabaseClassification: "sensitive-generated-app-state";
  authDatabaseMustLiveOutsideVaultRoots: true;
  authDatabaseExcludedFromVaultSyncExport: true;
  sessionTokenClassification: "framework-owned-opaque-session-secret-treated-as-bearer-equivalent-at-rest";
  betterAuthTokenColumnAccepted: true;
  extraArepoHashingRequiredBeforeActivation: false;
  extraArepoEncryptionRequiredBeforeActivation: false;
  extraHardeningDecision:
    "accept-library-owned-session-token-model-with-app-data-protections" | "revisit-foundation";
  resetBehavior: {
    deletingAuthDatabaseRevokesAllBrowserSessions: true;
    requiresRePairingAfterReset: true;
    missingDatabaseFailsClosedForBrowserSessions: true;
  };
  corruptionBehavior: {
    failClosed: true;
    doNotSilentlyRecreateLiveSessions: true;
    operatorResetRequired: true;
  };
  backupRestoreBehavior: {
    backupsContainSensitiveGeneratedAuthState: true;
    restoredOldDatabaseCanRevalidateOldSessions: true;
    restoreRequiresSessionResetOrRePairing: true;
    revocationAndExpiryReliableOnlyWhenAuthDbStateIsCurrent: true;
  };
  posture: {
    localhostOnlyRisk: "acceptable-with-local-app-data-protection";
    futureSelfHostRisk: "requires-stronger-filesystem-backup-and-https-policy";
  };
  risks: readonly BetterAuthSessionTokenStorageRisk[];
  requiredMitigations: readonly BetterAuthSessionTokenStorageMitigation[];
  remainingActivationBlockers: readonly BetterAuthSessionTokenStorageBlockerCode[];
  operatorWarnings: readonly string[];
};

export function planBetterAuthSessionTokenStoragePolicy(): BetterAuthSessionTokenStoragePolicy {
  return {
    status: "accepted-with-conditions",
    decision: "accept-better-auth-session-token-storage-with-conditions",
    preferredFoundation: "better-auth",
    backupFoundation: "server-side-session-core",
    liveBrowserAuthEnabled: false,
    mountedInServer: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsSetCookieHeaders: false,
    acceptsCookieCredentials: false,
    parsesCookiesForLiveAuthorization: false,
    validatesCsrfInLiveAuthorization: false,
    changesBearerTokenProtectedMode: false,
    appDataPathExpectation: "app-data/auth/better-auth.sqlite",
    authDatabaseClassification: "sensitive-generated-app-state",
    authDatabaseMustLiveOutsideVaultRoots: true,
    authDatabaseExcludedFromVaultSyncExport: true,
    sessionTokenClassification:
      "framework-owned-opaque-session-secret-treated-as-bearer-equivalent-at-rest",
    betterAuthTokenColumnAccepted: true,
    extraArepoHashingRequiredBeforeActivation: false,
    extraArepoEncryptionRequiredBeforeActivation: false,
    extraHardeningDecision: "accept-library-owned-session-token-model-with-app-data-protections",
    resetBehavior: {
      deletingAuthDatabaseRevokesAllBrowserSessions: true,
      requiresRePairingAfterReset: true,
      missingDatabaseFailsClosedForBrowserSessions: true,
    },
    corruptionBehavior: {
      failClosed: true,
      doNotSilentlyRecreateLiveSessions: true,
      operatorResetRequired: true,
    },
    backupRestoreBehavior: {
      backupsContainSensitiveGeneratedAuthState: true,
      restoredOldDatabaseCanRevalidateOldSessions: true,
      restoreRequiresSessionResetOrRePairing: true,
      revocationAndExpiryReliableOnlyWhenAuthDbStateIsCurrent: true,
    },
    posture: {
      localhostOnlyRisk: "acceptable-with-local-app-data-protection",
      futureSelfHostRisk: "requires-stronger-filesystem-backup-and-https-policy",
    },
    risks: [
      {
        code: "app-data-db-copy-risk",
        severity: "high",
        summary:
          "A copied auth database may contain framework-owned session secret material and must be treated as sensitive.",
      },
      {
        code: "backup-restore-session-resurrection-risk",
        severity: "high",
        summary:
          "Restoring an older auth database may restore sessions or revocation state unless AREPO forces reset or re-pairing.",
      },
      {
        code: "self-host-file-system-risk",
        severity: "high",
        summary:
          "Self-host deployments require stronger filesystem, backup, HTTPS, and operator controls than localhost testing.",
      },
      {
        code: "corruption-lockout-risk",
        severity: "medium",
        summary:
          "Auth database corruption should fail closed for browser sessions and require explicit operator reset.",
      },
    ],
    requiredMitigations: [
      {
        code: "store-auth-db-outside-vault-roots",
        requiredBeforeLiveActivation: true,
        summary: "The Better Auth database must live under AREPO app data, not in user vaults.",
      },
      {
        code: "exclude-auth-db-from-vault-sync-export",
        requiredBeforeLiveActivation: true,
        summary:
          "The auth database must be excluded from vault sync, export, and source content flows.",
      },
      {
        code: "classify-auth-db-sensitive-generated-state",
        requiredBeforeLiveActivation: true,
        summary: "The auth database is generated app state containing sensitive session material.",
      },
      {
        code: "owner-only-file-permissions-best-effort",
        requiredBeforeLiveActivation: true,
        summary:
          "AREPO should attempt or document owner-only local file permissions for auth app data.",
      },
      {
        code: "reset-auth-db-revokes-browser-sessions",
        requiredBeforeLiveActivation: true,
        summary: "Deleting or resetting the auth database revokes all browser sessions.",
      },
      {
        code: "corruption-fails-closed",
        requiredBeforeLiveActivation: true,
        summary: "Corrupt auth storage must fail closed and require operator reset or repair.",
      },
      {
        code: "backup-restore-requires-session-reset-or-repairing",
        requiredBeforeLiveActivation: true,
        summary:
          "Restored auth database backups should require session reset or re-pairing unless state freshness is proven.",
      },
      {
        code: "operator-warning-for-app-data-secrets",
        requiredBeforeLiveActivation: true,
        summary:
          "Operators must be warned that app-data auth storage contains sensitive generated secrets.",
      },
      {
        code: "no-extra-arepo-hashing-before-library-contract-review",
        requiredBeforeLiveActivation: false,
        summary:
          "Additional AREPO-side hashing/encryption is deferred unless Better Auth's storage contract proves insufficient.",
      },
    ],
    remainingActivationBlockers: [
      "internal-adapter-wrapper-implementation-needed",
      "production-arepo-better-auth-plugin-needed",
      "arepo-sidecar-authorization-store-needed",
      "expired-session-pruning-policy-needed",
      "backup-restore-session-state-policy-needed",
      "arepo-owned-csrf-live-integration-blocked",
      "better-auth-output-sanitization-wrapper-needed",
      "activation-gate-mounting-still-forbidden",
    ],
    operatorWarnings: [
      "Better Auth session storage is sensitive generated app data, not user-authored vault content.",
      "Copying or syncing the auth database can expose or restore browser-session authority.",
      "Deleting the auth database should revoke all browser sessions and require re-pairing.",
      "Browser sessions remain blocked until internal-adapter wrapper, production plugin, sidecar state, pruning, backup, CSRF, and mounting decisions are complete.",
    ],
  };
}
