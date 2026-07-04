import type { VaultIndex, ValidationIssue } from "../src/lib/vault/indexer.js";

export type NodeMode = "local" | "remote";

export type VaultPermission = {
  readIndex: boolean;
  readContent: boolean;
  writeContent: boolean;
  deleteFiles: boolean;
};

export type VaultIndexScope = {
  markdown: {
    minDepth: number;
    maxDepth: number | null;
  };
};

export type AuthMode = "disabled" | "protected";
export type AuthRequestedMode = AuthMode | "protected";

export type AuthConfig = {
  mode: AuthMode;
  requestedMode?: AuthRequestedMode;
  protectedModeUnavailableReason?: string;
  dryRunRequestPolicy?: boolean;
  dryRunAudit?: boolean;
};

export type AuthPosture = {
  mode: AuthMode;
  requestedMode: AuthRequestedMode;
  enabled: boolean;
  enforcement: "none" | "protected";
  protectedModeAvailable: boolean;
  protectedModeRequested: boolean;
  warning: string;
  error?: string;
};

export type RequestPolicyRuntimeStatus = {
  routePolicyInventoryPresent: boolean;
  routePolicyCount: number;
  browserSecurityPolicyPresent: boolean;
  authorizationPlannerPresent: boolean;
  dryRunMiddlewareConfigured: boolean;
  dryRunMiddlewareMounted: boolean;
  dryRunObservationOnly: boolean;
  dryRunRunCount: number;
  dryRunAuditConfigured: boolean;
  dryRunAuditAttemptedCount: number;
  dryRunAuditAppendCount: number;
  lastDryRunAuditStatus?: ProtectedRequestDryRunAuditStatus;
  lastDryRunResult?: ProtectedRequestDryRunSummary;
  dryRun: ProtectedRequestDryRunTerminologyStatus;
  enforcementActive: boolean;
  enforced: boolean;
  credentialVerificationActive: boolean;
  auditRequestLoggingActive: boolean;
  revocationChecksActive: boolean;
  csrfOriginEnforcementActive: boolean;
  acceptsCredentials: boolean;
  acceptsSessions: boolean;
  acceptsBearerTokens: boolean;
  networkExposureSafe: false;
};

export type ProtectedRequestDryRunAuditStatus = {
  mode: "disabled" | "append";
  status: "skipped" | "written" | "failed";
  eventId?: string;
  reasonCode?: string;
  error?: string;
  enforcementActive: false;
  networkExposureSafe: false;
};

export type ProtectedRequestDryRunResponsePlanSummary = {
  kind:
    | "allow"
    | "reduced-anonymous"
    | "unauthenticated"
    | "unauthorized"
    | "csrf-required"
    | "origin-rejected"
    | "stronger-confirmation-required"
    | "not-found-or-unknown-route"
    | "service-unavailable-or-not-ready";
  httpStatus: number;
  reasonCode: string;
  authRequired: boolean;
  confirmationRequired: boolean;
  enforcementActive: false;
  networkExposureSafe: false;
};

export type ProtectedRequestDryRunSummary = {
  timestamp: string;
  method: string;
  path: string;
  routePattern?: string;
  status: "wouldAllow" | "wouldDeny" | "anonymousReduced" | "failed";
  credentialStatus?: string;
  credentialSource?: string;
  reasonCodes: readonly string[];
  plannedResponse?: ProtectedRequestDryRunResponsePlanSummary;
  enforcementActive: false;
  networkExposureSafe: false;
  error?: string;
};

export type ProtectedRequestDryRunCanaryStatus = {
  ok: true;
  diagnosticOnly: true;
  dryRunConfigured: boolean;
  dryRunMounted: boolean;
  dryRunObservationOnly: true;
  dryRunAuditConfigured: boolean;
  dryRunAuditAttemptedCount: number;
  dryRunRunCount: number;
  dryRunAuditAppendCount: number;
  lastDryRunStatus?: {
    timestamp: string;
    method: string;
    status: ProtectedRequestDryRunSummary["status"];
    reasonCodes: readonly string[];
  };
  lastResponsePlan?: ProtectedRequestDryRunResponsePlanSummary;
  lastAuditStatus?: {
    mode: ProtectedRequestDryRunAuditStatus["mode"];
    status: ProtectedRequestDryRunAuditStatus["status"];
    reasonCode?: string;
  };
  enforcementActive: false;
  enforced: false;
  protectedModeOperational: false;
  networkExposureSafe: false;
  dryRun: ProtectedRequestDryRunTerminologyStatus;
};

export type ProtectedRequestDryRunTerminologyStatus = {
  configured: boolean;
  mounted: boolean;
  observed: {
    count: number;
    lastStatus?: ProtectedRequestDryRunSummary["status"];
  };
  planned: {
    computed: boolean;
    lastResponse?: ProtectedRequestDryRunResponsePlanSummary;
  };
  audited: {
    configured: boolean;
    attemptedCount: number;
    appendedCount: number;
    lastStatus?: ProtectedRequestDryRunAuditStatus["status"];
    lastReasonCode?: string;
  };
  enforced: false;
  enforcementActive: false;
  protectedModeOperational: false;
  networkExposureSafe: false;
};

export type ProtectedModeStoreName = "credentials" | "tokenVerifiers" | "sessions" | "revocations";

export type ProtectedModeStoreDiagnostic = {
  store: ProtectedModeStoreName;
  path: string;
  error: string;
  quarantineCandidate?: string;
};

export type ProtectedModeStartupAssessment = {
  requestedAuthMode: AuthRequestedMode;
  operationalAuthMode: AuthMode;
  protectedModeAvailable: boolean;
  protectedModeMayStart: boolean;
  missingRequiredStores: readonly ProtectedModeStoreDiagnostic[];
  corruptStores: readonly ProtectedModeStoreDiagnostic[];
  unsafeStorePaths: readonly string[];
  permissionWarnings: readonly string[];
  nonLocalBindWithDisabledAuth: boolean;
  enforcementActive: boolean;
  credentialVerificationActive: boolean;
  auditWiringActive: boolean;
  revocationChecksActive: boolean;
  csrfOriginEnforcementActive: boolean;
  networkExposureSafe: false;
};

export type ProtectedModeReadinessBlockerCode =
  | "auth-mode-disabled"
  | "protected-mode-requested-unavailable"
  | "protected-mode-unavailable"
  | "protected-mode-not-operational"
  | "startup-gate-not-ready"
  | "auth-store-missing"
  | "auth-store-corrupt"
  | "auth-store-path-unsafe"
  | "route-policy-inventory-missing"
  | "route-policy-inventory-incomplete"
  | "credential-verification-inactive"
  | "credential-acceptance-inactive"
  | "credential-bootstrap-needed"
  | "credential-session-issuance-inactive"
  | "credential-session-lifecycle-planning-only"
  | "browser-session-auth-planning-only"
  | "browser-session-cookies-not-accepted"
  | "browser-session-issuance-inactive"
  | "browser-session-csrf-enforcement-inactive"
  | "browser-session-cookie-policy-planning-only"
  | "browser-session-pairing-login-planning-only"
  | "browser-pairing-issuance-inactive"
  | "browser-pairing-consumption-inactive"
  | "browser-session-lifecycle-inactive"
  | "browser-session-logout-inactive"
  | "browser-session-revoke-all-inactive"
  | "browser-cookie-issuance-inactive"
  | "browser-csrf-token-issuance-inactive"
  | "audit-enforcement-inactive"
  | "audit-requirement-planning-only"
  | "revocation-checks-inactive"
  | "csrf-origin-enforcement-inactive"
  | "browser-request-guard-planning-only"
  | "reduced-anonymous-status-not-enforced"
  | "stronger-confirmation-not-enforced"
  | "explicit-enforcement-flag-disabled"
  | "request-pipeline-planning-only"
  | "response-planner-planning-only"
  | "reduced-anonymous-status-planning-only"
  | "stronger-confirmation-planning-only"
  | "dry-run-observation-only"
  | "non-local-bind-without-protected-mode";

export type ProtectedModeReadinessGroup =
  | "auth"
  | "startup"
  | "routePolicy"
  | "requestPolicy"
  | "lifecycle"
  | "browserSecurity"
  | "audit"
  | "revocation"
  | "confirmation"
  | "dryRun"
  | "pipeline"
  | "responsePlanning"
  | "network";

export type ProtectedModeReadinessBlockerDetail = {
  group: ProtectedModeReadinessGroup;
  label: string;
  codes: readonly ProtectedModeReadinessBlockerCode[];
  count?: number;
  status: "blocked" | "planning-only" | "unsafe";
};

export type ProtectedModeReadinessManifest = {
  readyForEnforcement: boolean;
  enforcementActive: boolean;
  protectedModeOperational: boolean;
  networkExposureSafe: false;
  requestedAuthMode: AuthRequestedMode;
  operationalAuthMode: AuthMode;
  protectedModeAvailable: boolean;
  protectedModeMayStart: boolean;
  blockerCount: number;
  blockers: readonly ProtectedModeReadinessBlockerCode[];
  blockerDetails: readonly ProtectedModeReadinessBlockerDetail[];
  routePolicy: {
    inventoryPresent: boolean;
    routePolicyCount: number;
    expectedMinimum: number;
    complete: boolean;
  };
  dryRun: ProtectedRequestDryRunTerminologyStatus;
  checks: {
    credentialVerificationActive: boolean;
    credentialAcceptanceActive: boolean;
    credentialIssuanceActive: boolean;
    sessionIssuanceActive: boolean;
    tokenIssuanceActive: boolean;
    auditEnforcementActive: boolean;
    revocationChecksActive: boolean;
    csrfOriginEnforcementActive: boolean;
    reducedAnonymousStatusEnforced: boolean;
    strongerConfirmationEnforced: boolean;
    explicitEnforcementFlagEnabled: boolean;
    protectedRequestPipelineAvailable: boolean;
    protectedResponsePlannerAvailable: boolean;
    reducedAnonymousStatusPlannerAvailable: boolean;
    strongerConfirmationPlannerAvailable: boolean;
    auditRequirementPlannerAvailable: boolean;
    browserRequestGuardPlannerAvailable: boolean;
    credentialSessionLifecyclePlannerAvailable: boolean;
  };
  startup: {
    missingStoreCount: number;
    corruptStoreCount: number;
    unsafeStorePathCount: number;
    permissionWarningCount: number;
  };
  credentialLifecycle?: CredentialLifecycleRuntimeStatus;
  browserSessionAuth: BrowserSessionAuthRuntimeStatus;
  network: {
    localOnlyMode: boolean;
    nonLocalBindWithDisabledAuth: boolean;
  };
};

export type CredentialLifecycleRuntimeStatus = {
  storeAvailable: boolean;
  activeCredentialCount: number;
  revokedCredentialCount: number;
  expiredCredentialCount: number;
  totalCredentialCount: number;
  bootstrapAvailable: boolean;
  error?: string;
};

export type BrowserSessionAuthBlockerCode =
  | "browser-session-auth-planning-only"
  | "browser-session-cookies-not-accepted"
  | "browser-session-issuance-inactive"
  | "browser-session-csrf-enforcement-inactive"
  | "browser-session-cookie-policy-planning-only"
  | "browser-session-pairing-login-planning-only"
  | "browser-pairing-issuance-inactive"
  | "browser-pairing-consumption-inactive"
  | "browser-session-lifecycle-inactive"
  | "browser-session-logout-inactive"
  | "browser-session-revoke-all-inactive"
  | "browser-cookie-issuance-inactive"
  | "browser-csrf-token-issuance-inactive";

export type BrowserSessionAuditEventPlan =
  | "browser_pairing_issue_attempted"
  | "browser_pairing_issue_succeeded"
  | "browser_pairing_issue_denied"
  | "browser_pairing_consume_attempted"
  | "browser_pairing_consume_succeeded"
  | "browser_pairing_consume_denied"
  | "browser_session_issue_attempted"
  | "browser_session_issue_succeeded"
  | "browser_session_issue_denied"
  | "browser_session_logout_succeeded"
  | "browser_session_revoke_all_succeeded"
  | "browser_session_denied_invalid"
  | "browser_session_denied_expired"
  | "browser_session_denied_revoked"
  | "browser_csrf_denied";

export type BrowserSessionAuthRuntimeStatus = {
  status: "planning-only";
  liveSessionAuth: false;
  acceptsSessionCookies: false;
  sessionIssuance: "inactive";
  csrfEnforcement: "inactive";
  sessionRoutes: "stubbed";
  pairingRoutes: "stubbed";
  csrfEndpoint: "stubbed";
  frontendTokenStorage: false;
  networkExposureSafe: false;
  cookiePolicy: {
    issuance: "inactive";
    httpOnly: "required";
    sameSite: "planned";
    secure: "required-outside-local-dev";
    devHttpException: "planned-localhost-only";
    path: "planned";
    domain: "omitted";
    setsCookiesToday: false;
    nonLocalHttp: "unsafe";
  };
  pairing: {
    enabled: false;
    status: "planning-only";
    issueCode: "inactive";
    consumeCode: "inactive";
    preferredFlow: "local-pairing-code-from-authorized-bearer";
    requiresExistingBearerCredential: true;
    requiresLocalOrigin: true;
    requiresStrongerConfirmation: true;
    codesAreShortLived: true;
    codesAreOneTimeUse: true;
    storesRawCodes: false;
    auditRecordsSanitized: true;
    blockers: readonly BrowserSessionAuthBlockerCode[];
  };
  sessionLifecycle: {
    issuance: "inactive";
    sessionStore: "planned";
    sessionVerifier: "planned";
    sessionRevocation: "planned";
    expiry: "planned";
    logout: "inactive";
    revokeAll: "inactive";
    currentSessionRevocation: "planned";
    allSessionRevocation: "planned";
    derivedSessionInvalidation: "planned";
    acceptsSessionCookies: false;
    storesRawSessionSecrets: false;
    returnsSessionSecretsInJson: false;
  };
  sessionStore: {
    verifierMetadataPlanned: true;
    storesRawSessionSecrets: false;
    revocationRequired: true;
  };
  csrf: {
    endpoint: "stubbed";
    tokenIssuance: "inactive";
    validation: "inactive";
    enforcement: "inactive";
    unsafeMethodsRequireCsrfWhenSessionAuthLive: true;
    bearerTokenRequiresBrowserCsrf: false;
    originRefererDefenseInDepth: true;
    storesRawTokens: false;
    logsRawTokens: false;
  };
  frontend: {
    tokenStorage: false;
    sessionSecretReadableByJs: false;
    loginUi: "inactive";
  };
  audit: {
    status: "planned";
    events: readonly BrowserSessionAuditEventPlan[];
    excludesRawBearerTokens: true;
    excludesRawSessionSecrets: true;
    excludesRawPairingCodes: true;
    excludesRawCsrfTokens: true;
    excludesAuthorizationHeaders: true;
    excludesCookies: true;
    excludesVerifierHashes: true;
    excludesSalts: true;
    excludesUnsafeBrowserFingerprints: true;
  };
  readiness: {
    ready: false;
    blockers: readonly BrowserSessionAuthBlockerCode[];
  };
};

export type VaultInfo = {
  id: string;
  displayName: string;
  rootPath: string;
  permissions: VaultPermission;
  vaultIndexScope?: VaultIndexScope;
};

export type NodeInfo = {
  nodeId: string;
  displayName: string;
  mode: NodeMode;
  apiVersion: 1;
  vaults: VaultInfo[];
};

export type LocalNodeHealth = {
  ok: true;
  node: Omit<NodeInfo, "vaults">;
};

export type LocalNodeRuntimeStatus = {
  ok: true;
  node: Omit<NodeInfo, "vaults">;
  runtime: {
    host: string;
    port: number;
    localOnlyMode: boolean;
    allowedOrigins: string[];
    startupWarnings: string[];
  };
  auth: AuthPosture;
  requestPolicy: RequestPolicyRuntimeStatus;
  protectedModeStartup: ProtectedModeStartupAssessment;
  protectedModeReadiness: ProtectedModeReadinessManifest;
  credentialLifecycle: CredentialLifecycleRuntimeStatus;
  browserSessionAuth: BrowserSessionAuthRuntimeStatus;
  vaultCount: number;
  vaults: LocalNodeVaultRuntimeSummary[];
  capabilities: {
    storageSummary: true;
    remoteNodes: false;
    authentication: false;
    sync: false;
    ai: false;
    database: false;
    migrationSupport: false;
  };
};

export type LocalNodeVaultRuntimeSummary = {
  vaultId: string;
  displayName: string;
  indexStatus: IndexFreshness;
  changedExternally: boolean;
  watcherHealth: "ok" | "stale" | "rebuilding" | "error";
  changedPathCount: number;
  addedPathCount: number;
  deletedPathCount: number;
  lastEventAt?: number;
  lastIndexedAt?: number;
  storageSummaryAvailable: boolean;
  error?: string;
};

export type VaultFile = {
  path: string;
  size: number;
  mtimeMs: number;
};

export type IndexFreshness = "fresh" | "stale" | "rebuilding" | "error";

export type WatchedFileStatus = {
  path: string;
  exists: boolean;
  mtimeMs?: number;
  size?: number;
  hash?: string;
  changedExternally: boolean;
  deletedExternally: boolean;
};

export type VaultRuntimeStatus = {
  vaultId: string;
  indexStatus: IndexFreshness;
  changedExternally: boolean;
  changedPaths: string[];
  addedPaths: string[];
  deletedPaths: string[];
  lastEventAt?: number;
  lastIndexedAt?: number;
  error?: string;
  file?: WatchedFileStatus;
};

export type StorageBucket = {
  fileCount: number;
  bytes: number;
};

export type VaultStorageSummary = {
  vaultId: string;
  vaultRoot: string;
  total: StorageBucket;
  markdownText: StorageBucket;
  attachments: StorageBucket;
  appDataCache: StorageBucket & {
    machineIndexBytes: number;
    files: { kind: "machine-index"; path: string; bytes: number }[];
  };
};

export type OperationResult<T = unknown> =
  { ok: true; data?: T } | { ok: false; error: string; code?: string };

export type VaultConfigFile = {
  node: Omit<NodeInfo, "vaults">;
  auth: AuthConfig;
  appDataDir?: string;
  vaults: VaultInfo[];
};

export type VaultIndexResponse = {
  index: VaultIndex;
  issues: ValidationIssue[];
};

export type IndexFilterKind =
  "broken-links" | "orphan-notes" | "tags" | "folders" | "duplicate-ids" | "duplicate-anchors";

export type IndexFilterResult = {
  id: string;
  filter: IndexFilterKind;
  path: string;
  title: string;
  reason: string;
  target?: string;
  tag?: string;
  folder?: string;
  duplicateKey?: string;
  headingText?: string;
  anchor?: string;
};

export type IndexFilterResponse = {
  filter: IndexFilterKind;
  total: number;
  source: "machine-index";
  results: IndexFilterResult[];
};

export type IndexSearchMatchType =
  "file" | "frontmatter-id" | "tag" | "heading" | "anchor" | "link-target" | "backlink";

export type IndexSearchResult = {
  id: string;
  matchType: IndexSearchMatchType;
  path: string;
  title: string;
  matchedField: string;
  matchedValue: string;
  headingText?: string;
  anchor?: string;
  tag?: string;
  linkTarget?: string;
  targetPath?: string;
  fromPath?: string;
  fromTitle?: string;
};

export type IndexSearchResponse = {
  q: string;
  total: number;
  source: "machine-index";
  results: IndexSearchResult[];
};

export type VaultInspectLink = {
  target: string;
  targetPath?: string;
  targetTitle?: string;
  anchor?: string;
  alias?: string;
  raw: string;
  status: string;
  broken: boolean;
  targetPaths?: string[];
};

export type VaultInspectBacklink = {
  fromPath: string;
  fromTitle: string;
  anchor?: string;
  alias?: string;
};

export type VaultInspectDuplicateAnchor = {
  anchor: string;
  headings: { text: string; level: number; explicit: boolean }[];
};

export type VaultInspectResponse = {
  source: "machine-index";
  path: string;
  title: string;
  frontmatterId?: string;
  tags: string[];
  headings: { level: number; text: string; anchor: string; explicit: boolean }[];
  anchors: string[];
  outgoingLinks: VaultInspectLink[];
  backlinks: VaultInspectBacklink[];
  brokenOutgoingLinks: VaultInspectLink[];
  duplicateId?: { id: string; paths: string[] };
  duplicateAnchors: VaultInspectDuplicateAnchor[];
  orphan: boolean;
  issues: ValidationIssue[];
};

export const DEFAULT_PERMISSIONS: VaultPermission = {
  readIndex: true,
  readContent: true,
  writeContent: true,
  deleteFiles: false,
};

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  mode: "disabled",
};

export const PROTECTED_MODE_UNAVAILABLE_REASON =
  "Protected mode was requested, but auth.mode remains disabled; set auth.mode to protected for local bearer-token enforcement";
