export const BETTER_AUTH_INTERNAL_ADAPTER_RISK_DECISION_MOUNTED = false;
export const BETTER_AUTH_INTERNAL_ADAPTER_RISK_DECISION_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_INTERNAL_ADAPTER_RISK_DECISION_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_INTERNAL_ADAPTER_RISK_DECISION_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthInternalAdapterDecisionStatus =
  "accepted-with-conditions" | "rejected" | "blocked" | "unresolved";

export type BetterAuthInternalAdapterApiClassification =
  | "public-documented-api"
  | "public-exported-api"
  | "official-plugin-pattern-internal-access"
  | "unsupported-internal-access"
  | "unknown";

export type BetterAuthInternalAdapterAllowedOperation =
  | "find-or-create-local-subject-user"
  | "create-session-for-accepted-arepo-pairing"
  | "return-redacted-user-session-references"
  | "lookup-session-for-wrapper-regression-tests"
  | "revoke-current-session-through-wrapper"
  | "revoke-all-subject-sessions-through-wrapper"
  | "observe-expiry-state-through-wrapper";

export type BetterAuthInternalAdapterForbiddenOperation =
  | "direct-token-signing"
  | "raw-session-token-return"
  | "raw-cookie-return"
  | "authorization-header-access"
  | "cookie-header-access"
  | "set-cookie-value-logging"
  | "arbitrary-internal-adapter-call"
  | "arbitrary-database-mutation"
  | "route-authorization-decision"
  | "frontend-provided-permission-state"
  | "vault-node-permission-cookie-storage"
  | "better-auth-session-object-as-authorization-policy"
  | "unsupported-better-auth-internal-api";

export type BetterAuthInternalAdapterMitigation =
  | "narrow-wrapper-required"
  | "wrapper-lives-only-inside-better-auth-plugin-boundary"
  | "allowlisted-operations-only"
  | "redacted-reference-output-only"
  | "sanitized-errors-and-reason-codes"
  | "focused-wrapper-regression-tests"
  | "better-auth-version-pinning-required"
  | "better-auth-upgrade-review-required"
  | "inactive-boundary-tests-required"
  | "express-session-backup-remains-open";

export type BetterAuthInternalAdapterRemainingBlocker =
  | "internal-adapter-wrapper-implementation-needed"
  | "production-arepo-better-auth-plugin-needed"
  | "arepo-sidecar-authorization-store-needed"
  | "backup-restore-session-state-policy-needed"
  | "arepo-owned-csrf-live-integration-blocked"
  | "better-auth-output-sanitization-wrapper-needed"
  | "activation-gate-mounting-still-forbidden";

export type BetterAuthInternalAdapterRiskDecision = {
  status: BetterAuthInternalAdapterDecisionStatus;
  decision: "accept-official-plugin-pattern-internal-adapter-with-conditions";
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
  apiClassification: {
    createAuthEndpoint: "public-exported-api";
    setSessionCookie: "public-exported-api";
    ctxContextInternalAdapter: "official-plugin-pattern-internal-access";
    directTokenSigning: "unsupported-internal-access";
  };
  rationale: {
    officialPluginPatternAppearsToUseInternalAdapter: true;
    productionBreakageRisk: "medium";
    likelyBreakageDuringBetterAuthUpgrade: "possible";
    riskAcceptedOnlyForPluginBoundary: true;
    generalBetterAuthInternalsAccepted: false;
    activationRemainsBlockedUntilWrapperAndRemainingGatesPass: true;
    expressSessionBackupRemainsOpenIfRiskBecomesUnacceptable: true;
  };
  wrapperPolicy: {
    required: true;
    location: "inside-better-auth-plugin-boundary-only";
    returnsOnlySafeReferences: true;
    neverReturnsRawSessionTokens: true;
    neverPerformsRoutePermissionChecks: true;
    neverAcceptsFrontendPermissionState: true;
    neverSerializesVaultNodePermissionsIntoCookies: true;
    sanitizesErrorsAndReasonCodes: true;
    coveredByFocusedTests: true;
  };
  allowedOperations: readonly BetterAuthInternalAdapterAllowedOperation[];
  forbiddenOperations: readonly BetterAuthInternalAdapterForbiddenOperation[];
  mitigations: readonly BetterAuthInternalAdapterMitigation[];
  upgradePolicy: {
    betterAuthVersionPinnedBeforeActivation: true;
    upgradeRequiresManualReview: true;
    upgradeRequiresProofSuitePass: true;
    wrapperContractChangesBlockActivation: true;
    releaseNotesMustBeReviewedForPluginContextChanges: true;
  };
  regressionTestsRequired: readonly [
    "wrapper-allows-only-named-operations",
    "wrapper-never-returns-raw-session-token",
    "wrapper-sanitizes-errors",
    "plugin-boundary-blocks-before-wrapper-when-gate-denies",
    "inactive-boundary-forbids-live-imports",
    "signed-cookie-lookup-still-works-in-isolation",
    "direct-raw-token-cookie-injection-remains-rejected",
    "revoke-current-and-revoke-all-remain-targeted",
    "csrf-still-required-before-unsafe-arepo-mutations",
  ];
  arepoOwnedResponsibilities: readonly [
    "activation-gates",
    "route-contracts",
    "pairing-ux",
    "route-permissions",
    "audit-policy",
    "inactive-boundary-tests",
    "hybrid-sidecar-authorization-state",
    "csrf-policy-for-arepo-api-routes",
  ];
  betterAuthOwnedResponsibilities: readonly [
    "session-cookie-mechanics",
    "session-records",
    "session-expiry",
    "session-revocation-primitives",
  ];
  remainingActivationBlockers: readonly BetterAuthInternalAdapterRemainingBlocker[];
};

export function planBetterAuthInternalAdapterRiskDecision(): BetterAuthInternalAdapterRiskDecision {
  return {
    status: "accepted-with-conditions",
    decision: "accept-official-plugin-pattern-internal-adapter-with-conditions",
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
    apiClassification: {
      createAuthEndpoint: "public-exported-api",
      setSessionCookie: "public-exported-api",
      ctxContextInternalAdapter: "official-plugin-pattern-internal-access",
      directTokenSigning: "unsupported-internal-access",
    },
    rationale: {
      officialPluginPatternAppearsToUseInternalAdapter: true,
      productionBreakageRisk: "medium",
      likelyBreakageDuringBetterAuthUpgrade: "possible",
      riskAcceptedOnlyForPluginBoundary: true,
      generalBetterAuthInternalsAccepted: false,
      activationRemainsBlockedUntilWrapperAndRemainingGatesPass: true,
      expressSessionBackupRemainsOpenIfRiskBecomesUnacceptable: true,
    },
    wrapperPolicy: {
      required: true,
      location: "inside-better-auth-plugin-boundary-only",
      returnsOnlySafeReferences: true,
      neverReturnsRawSessionTokens: true,
      neverPerformsRoutePermissionChecks: true,
      neverAcceptsFrontendPermissionState: true,
      neverSerializesVaultNodePermissionsIntoCookies: true,
      sanitizesErrorsAndReasonCodes: true,
      coveredByFocusedTests: true,
    },
    allowedOperations: [
      "find-or-create-local-subject-user",
      "create-session-for-accepted-arepo-pairing",
      "return-redacted-user-session-references",
      "lookup-session-for-wrapper-regression-tests",
      "revoke-current-session-through-wrapper",
      "revoke-all-subject-sessions-through-wrapper",
      "observe-expiry-state-through-wrapper",
    ],
    forbiddenOperations: [
      "direct-token-signing",
      "raw-session-token-return",
      "raw-cookie-return",
      "authorization-header-access",
      "cookie-header-access",
      "set-cookie-value-logging",
      "arbitrary-internal-adapter-call",
      "arbitrary-database-mutation",
      "route-authorization-decision",
      "frontend-provided-permission-state",
      "vault-node-permission-cookie-storage",
      "better-auth-session-object-as-authorization-policy",
      "unsupported-better-auth-internal-api",
    ],
    mitigations: [
      "narrow-wrapper-required",
      "wrapper-lives-only-inside-better-auth-plugin-boundary",
      "allowlisted-operations-only",
      "redacted-reference-output-only",
      "sanitized-errors-and-reason-codes",
      "focused-wrapper-regression-tests",
      "better-auth-version-pinning-required",
      "better-auth-upgrade-review-required",
      "inactive-boundary-tests-required",
      "express-session-backup-remains-open",
    ],
    upgradePolicy: {
      betterAuthVersionPinnedBeforeActivation: true,
      upgradeRequiresManualReview: true,
      upgradeRequiresProofSuitePass: true,
      wrapperContractChangesBlockActivation: true,
      releaseNotesMustBeReviewedForPluginContextChanges: true,
    },
    regressionTestsRequired: [
      "wrapper-allows-only-named-operations",
      "wrapper-never-returns-raw-session-token",
      "wrapper-sanitizes-errors",
      "plugin-boundary-blocks-before-wrapper-when-gate-denies",
      "inactive-boundary-forbids-live-imports",
      "signed-cookie-lookup-still-works-in-isolation",
      "direct-raw-token-cookie-injection-remains-rejected",
      "revoke-current-and-revoke-all-remain-targeted",
      "csrf-still-required-before-unsafe-arepo-mutations",
    ],
    arepoOwnedResponsibilities: [
      "activation-gates",
      "route-contracts",
      "pairing-ux",
      "route-permissions",
      "audit-policy",
      "inactive-boundary-tests",
      "hybrid-sidecar-authorization-state",
      "csrf-policy-for-arepo-api-routes",
    ],
    betterAuthOwnedResponsibilities: [
      "session-cookie-mechanics",
      "session-records",
      "session-expiry",
      "session-revocation-primitives",
    ],
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
