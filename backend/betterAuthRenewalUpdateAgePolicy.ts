export const BETTER_AUTH_RENEWAL_UPDATE_AGE_POLICY_MOUNTED = false;
export const BETTER_AUTH_RENEWAL_UPDATE_AGE_POLICY_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_RENEWAL_UPDATE_AGE_POLICY_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_RENEWAL_UPDATE_AGE_POLICY_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthRenewalUpdateAgePolicyStatus = "accepted-with-conditions";

export type BetterAuthRenewalUpdateAgeRemainingBlocker =
  | "internal-adapter-wrapper-implementation-needed"
  | "production-arepo-better-auth-plugin-needed"
  | "arepo-sidecar-authorization-store-needed"
  | "expired-session-pruning-policy-needed"
  | "backup-restore-session-state-policy-needed"
  | "arepo-owned-csrf-live-integration-blocked"
  | "better-auth-output-sanitization-wrapper-needed"
  | "activation-gate-mounting-still-forbidden";

export type BetterAuthRenewalAuditCategory =
  | "browser_session_renewal_attempted"
  | "browser_session_renewal_succeeded"
  | "browser_session_renewal_denied";

export type BetterAuthRenewalUpdateAgePolicy = {
  status: BetterAuthRenewalUpdateAgePolicyStatus;
  decision: "bounded-update-age-renewal-for-freshness-only";
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
  sessionLifetime: {
    bounded: true;
    maxAgeSeconds: 1800;
    maxAgeMinutes: 30;
    localhostOnlyPosture: "acceptable-for-local-operator-session";
    futureSelfHostPosture: "requires-https-secure-cookie-and-operator-policy-review";
  };
  updateAge: {
    posture: "enabled-bounded";
    updateAgeSeconds: 300;
    updateAgeMinutes: 5;
    renewalExtendsExpiry: true;
    renewalExtendsAuthorization: false;
    renewalRotatesAuthority: false;
    renewalCreatesNewSubjectAuthority: false;
  };
  authorityPolicy: {
    betterAuthOwnsFreshnessAndCookieMechanics: true;
    arepoSidecarAuthorizationRemainsAuthoritative: true;
    routePermissionsRemainArepoOwned: true;
    renewalNeverGrantsAuthorization: true;
    renewalRequiresSidecarReference: true;
    renewalBlockedWhenSidecarMissing: true;
    renewalBlockedWhenSidecarRevoked: true;
    renewalBlockedWhenSidecarStale: true;
    renewalBlockedWhenSidecarMismatched: true;
  };
  requestSequencing: {
    safeReadOnlyRequestsMayRefreshLastSeen: true;
    unsafeRequestRenewalBeforeCsrfValidationAllowed: false;
    unsafeRequestMutationRequiresCsrfBeforeMutation: true;
    unsafeRequestRenewalRequiresCsrfSequencing: true;
    activationGateMustPassBeforeRenewalPath: true;
    routeContractMustAllowCookieBackedPath: true;
  };
  revocationExpiryInteraction: {
    revokeCurrentOverridesRenewal: true;
    revokeAllOverridesRenewal: true;
    expiryOverridesRenewal: true;
    expiredSessionsMustNotBeRevivedByRenewal: true;
    missingOrRevokedSidecarMustBlockLastSeenUpdate: true;
  };
  auditPolicy: {
    renewalAuditRequired: true;
    lastSeenUpdateAllowed: true;
    lastSeenMustBeSafeMetadataOnly: true;
    auditCategories: readonly BetterAuthRenewalAuditCategory[];
    auditMustRedactSessionReferences: true;
    auditMustNotIncludeCookieOrTokenMaterial: true;
  };
  backupRestorePolicy: {
    restoredOldAuthDbCanRestoreFreshnessState: true;
    restoredOldSidecarMismatchMustBlockRenewal: true;
    backupRestoreRequiresSessionResetOrRePairingPolicy: true;
    operatorWarningRequired: true;
  };
  activationRequirements: {
    internalAdapterWrapperImplemented: false;
    sidecarAuthorizationStoreImplemented: false;
    csrfIntegrationImplemented: false;
    expiredSessionPruningPolicyAccepted: false;
    backupRestorePolicyAccepted: false;
    disabledLiveMountingDesignAccepted: false;
  };
  remainingActivationBlockers: readonly BetterAuthRenewalUpdateAgeRemainingBlocker[];
};

export function planBetterAuthRenewalUpdateAgePolicy(): BetterAuthRenewalUpdateAgePolicy {
  return {
    status: "accepted-with-conditions",
    decision: "bounded-update-age-renewal-for-freshness-only",
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
    sessionLifetime: {
      bounded: true,
      maxAgeSeconds: 1800,
      maxAgeMinutes: 30,
      localhostOnlyPosture: "acceptable-for-local-operator-session",
      futureSelfHostPosture: "requires-https-secure-cookie-and-operator-policy-review",
    },
    updateAge: {
      posture: "enabled-bounded",
      updateAgeSeconds: 300,
      updateAgeMinutes: 5,
      renewalExtendsExpiry: true,
      renewalExtendsAuthorization: false,
      renewalRotatesAuthority: false,
      renewalCreatesNewSubjectAuthority: false,
    },
    authorityPolicy: {
      betterAuthOwnsFreshnessAndCookieMechanics: true,
      arepoSidecarAuthorizationRemainsAuthoritative: true,
      routePermissionsRemainArepoOwned: true,
      renewalNeverGrantsAuthorization: true,
      renewalRequiresSidecarReference: true,
      renewalBlockedWhenSidecarMissing: true,
      renewalBlockedWhenSidecarRevoked: true,
      renewalBlockedWhenSidecarStale: true,
      renewalBlockedWhenSidecarMismatched: true,
    },
    requestSequencing: {
      safeReadOnlyRequestsMayRefreshLastSeen: true,
      unsafeRequestRenewalBeforeCsrfValidationAllowed: false,
      unsafeRequestMutationRequiresCsrfBeforeMutation: true,
      unsafeRequestRenewalRequiresCsrfSequencing: true,
      activationGateMustPassBeforeRenewalPath: true,
      routeContractMustAllowCookieBackedPath: true,
    },
    revocationExpiryInteraction: {
      revokeCurrentOverridesRenewal: true,
      revokeAllOverridesRenewal: true,
      expiryOverridesRenewal: true,
      expiredSessionsMustNotBeRevivedByRenewal: true,
      missingOrRevokedSidecarMustBlockLastSeenUpdate: true,
    },
    auditPolicy: {
      renewalAuditRequired: true,
      lastSeenUpdateAllowed: true,
      lastSeenMustBeSafeMetadataOnly: true,
      auditCategories: [
        "browser_session_renewal_attempted",
        "browser_session_renewal_succeeded",
        "browser_session_renewal_denied",
      ],
      auditMustRedactSessionReferences: true,
      auditMustNotIncludeCookieOrTokenMaterial: true,
    },
    backupRestorePolicy: {
      restoredOldAuthDbCanRestoreFreshnessState: true,
      restoredOldSidecarMismatchMustBlockRenewal: true,
      backupRestoreRequiresSessionResetOrRePairingPolicy: true,
      operatorWarningRequired: true,
    },
    activationRequirements: {
      internalAdapterWrapperImplemented: false,
      sidecarAuthorizationStoreImplemented: false,
      csrfIntegrationImplemented: false,
      expiredSessionPruningPolicyAccepted: false,
      backupRestorePolicyAccepted: false,
      disabledLiveMountingDesignAccepted: false,
    },
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
  };
}
