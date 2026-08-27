import type {
  OperationResult,
  DirectoryBrowserResponse,
  VaultAvailability,
  VaultFile,
  VaultFileKind,
  VaultFileListResponse,
  VaultFileResponse,
  VaultFileWriteResponse,
  VaultIndexResponse,
  VaultInfo,
  VaultListResponse,
  VaultPermission,
} from "./contracts.js";
import type { Heading, NoteIndex, ValidationIssue, VaultIndex, WikiLink } from "./indexer.js";
import {
  isFiniteNumber,
  isNonNegativeInteger,
  isObjectRecord,
  isStringArray,
  optionalFiniteNumber,
  optionalString,
  type ApiGuard,
} from "./apiTransport.ts";
import { sourceKindForPath } from "./sourcePolicy.ts";
import {
  RELATED_NOTES_DERIVATION_VERSION,
  RELATED_NOTES_PRODUCER,
  RELATED_NOTES_PRODUCER_VERSION,
  type RelatedNoteEvidence,
  type RelatedNotesResponse,
} from "./enrichmentContracts.ts";

const SOURCE_KINDS = {
  markdown: true,
  "plain-text": true,
  "chat-json": true,
  "generic-json": true,
} as const satisfies Record<VaultFileKind, true>;

const INDEX_STATUSES = new Set(["fresh", "stale", "rebuilding", "error"]);
const LINK_STATUSES = new Set([
  "resolved",
  "missing",
  "excluded-by-index-scope",
  "ambiguous",
  "invalid",
]);
const BROKEN_LINK_STATUSES = new Set(["missing", "excluded-by-index-scope", "invalid"]);
const DRY_RUN_STATUSES = new Set(["wouldAllow", "wouldDeny", "anonymousReduced", "failed"]);
const DRY_RUN_AUDIT_STATUSES = new Set(["skipped", "written", "failed"]);
const RESPONSE_PLAN_KINDS = new Set([
  "allow",
  "reduced-anonymous",
  "unauthenticated",
  "unauthorized",
  "csrf-required",
  "origin-rejected",
  "stronger-confirmation-required",
  "not-found-or-unknown-route",
  "service-unavailable-or-not-ready",
]);
const PROTECTED_STORE_NAMES = new Set(["credentials", "tokenVerifiers", "sessions", "revocations"]);
const VALIDATION_ISSUE_KINDS = new Set<ValidationIssue["kind"]>([
  "broken-wikilink",
  "missing-anchor",
  "duplicate-id",
  "duplicate-slug",
  "duplicate-anchor",
  "ambiguous-link",
  "missing-title",
  "missing-id",
  "source-unreadable",
]);

export type HealthResponse = {
  ok: true;
  node: {
    nodeId: string;
    displayName: string;
    mode: "local" | "remote";
    apiVersion: 1;
  };
};

export type VaultRuntimeStatus = {
  vaultId: string;
  indexStatus: "fresh" | "stale" | "rebuilding" | "error";
  changedExternally: boolean;
  changedPaths: string[];
  addedPaths: string[];
  deletedPaths: string[];
  lastEventAt?: number;
  lastIndexedAt?: number;
  error?: string;
  file?: {
    path: string;
    exists: boolean;
    mtimeMs?: number;
    size?: number;
    hash?: string;
    changedExternally: boolean;
    deletedExternally: boolean;
  };
};

export type GeneratedDataAction = "keep" | "discard";

export type RemoveVaultResponse = {
  vault: VaultInfo;
  remainingVaults: VaultInfo[];
  generatedData: {
    action: GeneratedDataAction;
    deletedPaths: string[];
    diagnostics: string[];
  };
};

export type StorageBucket = { fileCount: number; bytes: number };

export type VaultStorageSummary = {
  vaultId: string;
  vaultRoot: string;
  total: StorageBucket;
  markdownText: StorageBucket;
  attachments: StorageBucket;
  appDataCache: StorageBucket & {
    machineIndexBytes: number;
    relatedNotesEnrichmentBytes: number;
    files: {
      kind: "machine-index" | "related-notes-enrichment";
      path: string;
      bytes: number;
    }[];
  };
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

export type VaultInspectIssue = {
  kind: string;
  path: string;
  message: string;
  severity: "warning" | "error";
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
  issues: VaultInspectIssue[];
};

export type LocalNodeRuntimeStatus = {
  ok: true;
  node: HealthResponse["node"];
  runtime: {
    host: string;
    port: number;
    localOnlyMode: boolean;
    allowedOrigins: string[];
    startupWarnings: string[];
  };
  auth: {
    mode: "disabled" | "protected";
    requestedMode: "disabled" | "protected";
    enabled: boolean;
    enforcement: "none" | "protected";
    protectedModeAvailable: boolean;
    warning: string;
    error?: string;
  };
  protectedModeStartup: {
    requestedAuthMode: "disabled" | "protected";
    operationalAuthMode: "disabled" | "protected";
    protectedModeMayStart: boolean;
    missingRequiredStores: { store: string }[];
    corruptStores: { store: string }[];
    unsafeStorePaths: string[];
    permissionWarnings: string[];
    networkExposureSafe: boolean;
  };
  credentialLifecycle: {
    storeAvailable: boolean;
    activeCredentialCount: number;
    revokedCredentialCount: number;
    expiredCredentialCount: number;
    bootstrapAvailable: boolean;
    error?: string;
  };
  protectedModeReadiness: {
    readyForEnforcement: boolean;
    enforcementActive: boolean;
    protectedModeOperational: boolean;
    networkExposureSafe: boolean;
    blockerCount: number;
    blockers: string[];
    routePolicy: { routePolicyCount: number; expectedMinimum: number };
    checks: {
      protectedRequestPipelineAvailable: boolean;
      protectedResponsePlannerAvailable: boolean;
      reducedAnonymousStatusPlannerAvailable: boolean;
      strongerConfirmationPlannerAvailable: boolean;
      auditRequirementPlannerAvailable: boolean;
      browserRequestGuardPlannerAvailable: boolean;
      credentialSessionLifecyclePlannerAvailable: boolean;
    };
  };
  requestPolicy: {
    routePolicyInventoryPresent: boolean;
    routePolicyCount: number;
    browserSecurityPolicyPresent: boolean;
    authorizationPlannerPresent: boolean;
    dryRunRunCount: number;
    dryRunAuditAttemptedCount: number;
    dryRunAuditAppendCount: number;
    lastDryRunAuditStatus?: { status: string };
    lastDryRunResult?: {
      method: string;
      path: string;
      routePattern?: string;
      status: string;
      plannedResponse?: { kind: string; httpStatus: number; reasonCode: string };
    };
    dryRun: {
      configured: boolean;
      mounted: boolean;
      observed: { count: number; lastStatus?: string };
      planned: {
        lastResponse?: { kind: string; httpStatus: number; reasonCode: string };
      };
      audited: {
        configured: boolean;
        attemptedCount: number;
        appendedCount: number;
        lastStatus?: string;
      };
      enforced: boolean;
      enforcementActive: boolean;
    };
    enforcementActive: boolean;
    credentialVerificationActive: boolean;
    csrfOriginEnforcementActive: boolean;
    networkExposureSafe: boolean;
  };
  vaultCount: number;
  vaults: {
    vaultId: string;
    displayName: string;
    indexStatus: "fresh" | "stale" | "rebuilding" | "error";
    watcherHealth: "ok" | "stale" | "rebuilding" | "error";
    changedPathCount: number;
    addedPathCount: number;
    deletedPathCount: number;
    lastEventAt?: number;
    lastIndexedAt?: number;
    storageSummaryAvailable: boolean;
    error?: string;
  }[];
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

export function isVaultFileKind(value: unknown): value is VaultFileKind {
  return typeof value === "string" && Object.hasOwn(SOURCE_KINDS, value);
}

export function isRelativeVaultPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/")) {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false;
  return value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

export const isHealthResponse: ApiGuard<HealthResponse> = (value): value is HealthResponse =>
  isObjectRecord(value) && value.ok === true && isNodeInfo(value.node);

export const isVaultListResponse: ApiGuard<VaultListResponse> = (
  value,
): value is VaultListResponse => {
  if (!isObjectRecord(value) || !isNodeInfo(value) || !Array.isArray(value.vaults)) return false;
  if (value.vaultView === "management") return value.vaults.every(isVaultInfo);
  if (value.vaultView !== "operational") return false;
  return value.vaults.every(
    (vault) =>
      isObjectRecord(vault) &&
      typeof vault.id === "string" &&
      typeof vault.displayName === "string" &&
      isOptionalAvailability(vault.availability) &&
      !("rootPath" in vault) &&
      !("permissions" in vault),
  );
};

export const isVaultFileListResponse: ApiGuard<VaultFileListResponse> = (
  value,
): value is VaultFileListResponse =>
  isObjectRecord(value) &&
  Array.isArray(value.files) &&
  value.files.every(isVaultFile) &&
  Array.isArray(value.folders) &&
  value.folders.every(isRelativeVaultPath);

export const isDirectoryBrowserResponse: ApiGuard<DirectoryBrowserResponse> = (
  value,
): value is DirectoryBrowserResponse =>
  isObjectRecord(value) &&
  isAbsoluteDisplayPath(value.currentPath) &&
  (value.parentPath === null || isAbsoluteDisplayPath(value.parentPath)) &&
  Array.isArray(value.directories) &&
  value.directories.every(
    (entry) =>
      isObjectRecord(entry) &&
      typeof entry.name === "string" &&
      entry.name.length > 0 &&
      isAbsoluteDisplayPath(entry.path),
  );

export const isVaultFileResponse: ApiGuard<VaultFileResponse> = (
  value,
): value is VaultFileResponse =>
  isObjectRecord(value) &&
  isVaultFile(value) &&
  typeof value.content === "string" &&
  typeof value.hash === "string";

export const isVaultFileWriteResponse: ApiGuard<VaultFileWriteResponse> = (
  value,
): value is VaultFileWriteResponse =>
  isObjectRecord(value) && isVaultFile(value) && typeof value.hash === "string";

export const isVaultFileData: ApiGuard<VaultFile> = (value): value is VaultFile =>
  isVaultFile(value);

export const isVaultIndexResponse: ApiGuard<VaultIndexResponse> = (
  value,
): value is VaultIndexResponse =>
  isObjectRecord(value) &&
  isVaultIndex(value.index) &&
  Array.isArray(value.issues) &&
  value.issues.every(isValidationIssue);

export const isVaultRuntimeStatus: ApiGuard<VaultRuntimeStatus> = (
  value,
): value is VaultRuntimeStatus => {
  if (
    !isObjectRecord(value) ||
    typeof value.vaultId !== "string" ||
    !INDEX_STATUSES.has(value.indexStatus as string) ||
    typeof value.changedExternally !== "boolean" ||
    !isRelativePathArray(value.changedPaths) ||
    !isRelativePathArray(value.addedPaths) ||
    !isRelativePathArray(value.deletedPaths) ||
    !optionalFiniteNumber(value, "lastEventAt") ||
    !optionalFiniteNumber(value, "lastIndexedAt") ||
    !optionalString(value, "error")
  ) {
    return false;
  }
  if (value.file === undefined) return true;
  return (
    isObjectRecord(value.file) &&
    isRelativeVaultPath(value.file.path) &&
    typeof value.file.exists === "boolean" &&
    optionalFiniteNumber(value.file, "mtimeMs") &&
    optionalFiniteNumber(value.file, "size") &&
    optionalString(value.file, "hash") &&
    typeof value.file.changedExternally === "boolean" &&
    typeof value.file.deletedExternally === "boolean"
  );
};

export function isOperationResult<T>(dataGuard: ApiGuard<T>): ApiGuard<OperationResult<T>> {
  return (value): value is OperationResult<T> =>
    isObjectRecord(value) &&
    ((value.ok === true && dataGuard(value.data)) ||
      (value.ok === false && typeof value.error === "string" && optionalString(value, "code")));
}

export const isPathMutationData: ApiGuard<{ path: string }> = (value): value is { path: string } =>
  isObjectRecord(value) && isRelativeVaultPath(value.path);

export const isRenameMutationData: ApiGuard<{ fromPath: string; toPath: string }> = (
  value,
): value is { fromPath: string; toPath: string } =>
  isObjectRecord(value) && isRelativeVaultPath(value.fromPath) && isRelativeVaultPath(value.toPath);

export const isAddVaultData: ApiGuard<{ vault: VaultInfo }> = (
  value,
): value is { vault: VaultInfo } => isObjectRecord(value) && isVaultInfo(value.vault);

export const isIndexScopeUpdateData: ApiGuard<{ vault: VaultInfo; index: VaultIndexResponse }> = (
  value,
): value is { vault: VaultInfo; index: VaultIndexResponse } =>
  isObjectRecord(value) && isVaultInfo(value.vault) && isVaultIndexResponse(value.index);

export const isRebindVaultData: ApiGuard<{ vault: VaultInfo; indexRebuilt: boolean }> = (
  value,
): value is { vault: VaultInfo; indexRebuilt: boolean } =>
  isObjectRecord(value) && isVaultInfo(value.vault) && typeof value.indexRebuilt === "boolean";

export const isRemoveVaultResponse: ApiGuard<RemoveVaultResponse> = (
  value,
): value is RemoveVaultResponse =>
  isObjectRecord(value) &&
  isVaultInfo(value.vault) &&
  Array.isArray(value.remainingVaults) &&
  value.remainingVaults.every(isVaultInfo) &&
  isObjectRecord(value.generatedData) &&
  (value.generatedData.action === "keep" || value.generatedData.action === "discard") &&
  isStringArray(value.generatedData.deletedPaths) &&
  isStringArray(value.generatedData.diagnostics);

export const isVaultStorageSummary: ApiGuard<VaultStorageSummary> = (
  value,
): value is VaultStorageSummary =>
  isObjectRecord(value) &&
  typeof value.vaultId === "string" &&
  typeof value.vaultRoot === "string" &&
  isStorageBucket(value.total) &&
  isStorageBucket(value.markdownText) &&
  isStorageBucket(value.attachments) &&
  isObjectRecord(value.appDataCache) &&
  isStorageBucket(value.appDataCache) &&
  isNonNegativeInteger(value.appDataCache.machineIndexBytes) &&
  isNonNegativeInteger(value.appDataCache.relatedNotesEnrichmentBytes) &&
  Array.isArray(value.appDataCache.files) &&
  value.appDataCache.files.every(
    (file) =>
      isObjectRecord(file) &&
      (file.kind === "machine-index" || file.kind === "related-notes-enrichment") &&
      typeof file.path === "string" &&
      isNonNegativeInteger(file.bytes),
  );

export const isIndexFilterResponse: ApiGuard<IndexFilterResponse> = (
  value,
): value is IndexFilterResponse =>
  isObjectRecord(value) &&
  isIndexFilterKind(value.filter) &&
  isNonNegativeInteger(value.total) &&
  value.source === "machine-index" &&
  Array.isArray(value.results) &&
  value.results.every(
    (result) =>
      isObjectRecord(result) &&
      typeof result.id === "string" &&
      result.filter === value.filter &&
      isRelativeVaultPath(result.path) &&
      typeof result.title === "string" &&
      typeof result.reason === "string" &&
      optionalStrings(result, ["target", "tag", "folder", "duplicateKey", "headingText", "anchor"]),
  );

export const isIndexSearchResponse: ApiGuard<IndexSearchResponse> = (
  value,
): value is IndexSearchResponse =>
  isObjectRecord(value) &&
  typeof value.q === "string" &&
  isNonNegativeInteger(value.total) &&
  value.source === "machine-index" &&
  Array.isArray(value.results) &&
  value.results.every(isIndexSearchResult);

export const isVaultInspectResponse: ApiGuard<VaultInspectResponse> = (
  value,
): value is VaultInspectResponse => {
  if (
    !isObjectRecord(value) ||
    value.source !== "machine-index" ||
    !isRelativeVaultPath(value.path) ||
    typeof value.title !== "string" ||
    !optionalString(value, "frontmatterId") ||
    !isStringArray(value.tags) ||
    !Array.isArray(value.headings) ||
    !value.headings.every(isHeading) ||
    !isStringArray(value.anchors) ||
    !Array.isArray(value.outgoingLinks) ||
    !value.outgoingLinks.every(isInspectLink) ||
    !Array.isArray(value.backlinks) ||
    !value.backlinks.every(isInspectBacklink) ||
    !Array.isArray(value.brokenOutgoingLinks) ||
    !value.brokenOutgoingLinks.every(isInspectLink) ||
    !Array.isArray(value.duplicateAnchors) ||
    !value.duplicateAnchors.every(isInspectDuplicateAnchor) ||
    typeof value.orphan !== "boolean" ||
    !Array.isArray(value.issues) ||
    !value.issues.every(isInspectIssue)
  ) {
    return false;
  }
  return (
    value.duplicateId === undefined ||
    (isObjectRecord(value.duplicateId) &&
      typeof value.duplicateId.id === "string" &&
      value.duplicateId.paths instanceof Array &&
      value.duplicateId.paths.every(isRelativeVaultPath))
  );
};

export const isRelatedNotesResponse: ApiGuard<RelatedNotesResponse> = (
  value,
): value is RelatedNotesResponse =>
  isObjectRecord(value) &&
  value.status === "ready" &&
  isMarkdownPath(value.sourcePath) &&
  isSha256(value.sourceHash) &&
  isSha256(value.corpusHash) &&
  value.producer === RELATED_NOTES_PRODUCER &&
  value.producerVersion === RELATED_NOTES_PRODUCER_VERSION &&
  value.derivationVersion === RELATED_NOTES_DERIVATION_VERSION &&
  typeof value.generatedAt === "string" &&
  value.generatedAt.length <= 64 &&
  !Number.isNaN(Date.parse(value.generatedAt)) &&
  Array.isArray(value.candidates) &&
  value.candidates.length <= 10 &&
  value.candidates.every(
    (candidate) =>
      isObjectRecord(candidate) &&
      isMarkdownPath(candidate.targetPath) &&
      candidate.targetPath !== value.sourcePath &&
      isSha256(candidate.targetHash) &&
      typeof candidate.title === "string" &&
      candidate.title.length <= 1_024 &&
      isUnitScore(candidate.score) &&
      Array.isArray(candidate.evidence) &&
      candidate.evidence.length > 0 &&
      candidate.evidence.length <= 5 &&
      candidate.evidence.every(isRelatedNoteEvidence),
  );

function isRelatedNoteEvidence(value: unknown): value is RelatedNoteEvidence {
  if (!isObjectRecord(value) || !isUnitScore(value.score) || typeof value.kind !== "string") {
    return false;
  }
  switch (value.kind) {
    case "tag-overlap":
      return isBoundedStrings(value.sharedTags, false);
    case "title-term-overlap":
    case "heading-term-overlap":
    case "lexical-similarity":
      return isBoundedStrings(value.sharedTerms, false);
    case "common-neighbours":
      return (
        Array.isArray(value.paths) &&
        value.paths.length > 0 &&
        value.paths.length <= 8 &&
        value.paths.every(isMarkdownPath)
      );
    default:
      return false;
  }
}

function isBoundedStrings(value: unknown, allowEmpty: boolean): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.length <= 8 &&
    value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 128)
  );
}

function isMarkdownPath(value: unknown): value is string {
  return isRelativeVaultPath(value) && value.toLowerCase().endsWith(".md");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isUnitScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export const isLocalNodeRuntimeStatus: ApiGuard<LocalNodeRuntimeStatus> = (
  value,
): value is LocalNodeRuntimeStatus => {
  if (!isObjectRecord(value) || value.ok !== true || !isNodeInfo(value.node)) return false;
  const runtime = value.runtime;
  const auth = value.auth;
  const startup = value.protectedModeStartup;
  const lifecycle = value.credentialLifecycle;
  const readiness = value.protectedModeReadiness;
  const requestPolicy = value.requestPolicy;
  const capabilities = value.capabilities;
  return (
    isObjectRecord(runtime) &&
    typeof runtime.host === "string" &&
    isFiniteNumber(runtime.port) &&
    typeof runtime.localOnlyMode === "boolean" &&
    isStringArray(runtime.allowedOrigins) &&
    isStringArray(runtime.startupWarnings) &&
    isAuthStatus(auth) &&
    isStartupStatus(startup) &&
    isCredentialLifecycle(lifecycle) &&
    isReadinessStatus(readiness) &&
    isRequestPolicyStatus(requestPolicy) &&
    isNonNegativeInteger(value.vaultCount) &&
    Array.isArray(value.vaults) &&
    value.vaults.every(isNodeVaultStatus) &&
    isObjectRecord(capabilities) &&
    capabilities.storageSummary === true &&
    capabilities.remoteNodes === false &&
    capabilities.authentication === false &&
    capabilities.sync === false &&
    capabilities.ai === false &&
    capabilities.database === false &&
    capabilities.migrationSupport === false
  );
};

function isNodeInfo(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    typeof value.nodeId === "string" &&
    typeof value.displayName === "string" &&
    (value.mode === "local" || value.mode === "remote") &&
    value.apiVersion === 1
  );
}

function isVaultInfo(value: unknown): value is VaultInfo {
  return (
    isObjectRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.rootPath === "string" &&
    isVaultPermissions(value.permissions) &&
    isOptionalIndexScope(value.vaultIndexScope) &&
    isOptionalAvailability(value.availability)
  );
}

function isVaultPermissions(value: unknown): value is VaultPermission {
  return (
    isObjectRecord(value) &&
    typeof value.readIndex === "boolean" &&
    typeof value.readContent === "boolean" &&
    typeof value.writeContent === "boolean" &&
    typeof value.deleteFiles === "boolean"
  );
}

function isOptionalIndexScope(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObjectRecord(value) || !isObjectRecord(value.markdown)) return false;
  return (
    isNonNegativeInteger(value.markdown.minDepth) &&
    (value.markdown.maxDepth === null || isNonNegativeInteger(value.markdown.maxDepth))
  );
}

function isOptionalAvailability(value: unknown): value is VaultAvailability | undefined {
  if (value === undefined) return true;
  if (!isObjectRecord(value)) return false;
  if (value.status === "available") return true;
  return (
    value.status === "unavailable" &&
    (value.reason === "root-not-found" ||
      value.reason === "root-not-directory" ||
      value.reason === "root-inaccessible")
  );
}

function isVaultFile(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    isRelativeVaultPath(value.path) &&
    isVaultFileKind(value.kind) &&
    sourceKindForPath(value.path) === value.kind &&
    isNonNegativeInteger(value.size) &&
    isFiniteNumber(value.mtimeMs)
  );
}

function isVaultIndex(value: unknown): value is VaultIndex {
  if (!isObjectRecord(value)) return false;
  return (
    recordValuesEvery(value.notes, isNoteIndex) &&
    isStringRecord(value.bySlug) &&
    isStringArrayRecord(value.duplicateSlugs) &&
    isStringRecord(value.byId) &&
    isStringArrayRecord(value.duplicateIds) &&
    isStringRecord(value.excludedBySlug) &&
    isStringArrayRecord(value.duplicateExcludedSlugs) &&
    isRelativePathArray(value.excludedPaths) &&
    recordValuesEvery(
      value.outgoingLinks,
      (links) => Array.isArray(links) && links.every(isOutgoingLink),
    ) &&
    recordValuesEvery(
      value.backlinks,
      (links) => Array.isArray(links) && links.every(isBacklink),
    ) &&
    Array.isArray(value.brokenLinks) &&
    value.brokenLinks.every(isBrokenLink) &&
    isRelativePathArray(value.orphanNotes)
  );
}

function isNoteIndex(value: unknown): value is NoteIndex {
  return (
    isObjectRecord(value) &&
    isRelativeVaultPath(value.path) &&
    typeof value.slug === "string" &&
    typeof value.title === "string" &&
    isObjectRecord(value.frontmatter) &&
    Array.isArray(value.headings) &&
    value.headings.every(isHeading) &&
    isStringArray(value.anchors) &&
    Array.isArray(value.wikilinks) &&
    value.wikilinks.every(isWikiLink) &&
    isStringArray(value.tags)
  );
}

function isHeading(value: unknown): value is Heading {
  return (
    isObjectRecord(value) &&
    isFiniteNumber(value.level) &&
    typeof value.text === "string" &&
    typeof value.anchor === "string" &&
    typeof value.explicit === "boolean"
  );
}

function isWikiLink(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    typeof value.target === "string" &&
    optionalString(value, "anchor") &&
    optionalString(value, "alias") &&
    typeof value.raw === "string"
  );
}

function isOutgoingLink(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    isWikiLink(value) &&
    optionalRelativePath(value, "targetPath") &&
    LINK_STATUSES.has(value.status as string) &&
    typeof value.broken === "boolean" &&
    (value.targetPaths === undefined ||
      (Array.isArray(value.targetPaths) && value.targetPaths.every(isRelativeVaultPath)))
  );
}

function isBacklink(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    isRelativeVaultPath(value.fromPath) &&
    optionalString(value, "anchor") &&
    optionalString(value, "alias")
  );
}

function isBrokenLink(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    isRelativeVaultPath(value.fromPath) &&
    typeof value.target === "string" &&
    optionalString(value, "anchor") &&
    typeof value.raw === "string" &&
    BROKEN_LINK_STATUSES.has(value.status as string) &&
    optionalRelativePath(value, "targetPath")
  );
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  return (
    isObjectRecord(value) &&
    typeof value.kind === "string" &&
    VALIDATION_ISSUE_KINDS.has(value.kind as ValidationIssue["kind"]) &&
    isRelativeVaultPath(value.path) &&
    typeof value.message === "string" &&
    (value.severity === "warning" || value.severity === "error")
  );
}

function isStorageBucket(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    isNonNegativeInteger(value.fileCount) &&
    isNonNegativeInteger(value.bytes)
  );
}

function isIndexFilterKind(value: unknown): value is IndexFilterKind {
  return (
    value === "broken-links" ||
    value === "orphan-notes" ||
    value === "tags" ||
    value === "folders" ||
    value === "duplicate-ids" ||
    value === "duplicate-anchors"
  );
}

function isIndexSearchResult(value: unknown): value is IndexSearchResult {
  return (
    isObjectRecord(value) &&
    typeof value.id === "string" &&
    (value.matchType === "file" ||
      value.matchType === "frontmatter-id" ||
      value.matchType === "tag" ||
      value.matchType === "heading" ||
      value.matchType === "anchor" ||
      value.matchType === "link-target" ||
      value.matchType === "backlink") &&
    isRelativeVaultPath(value.path) &&
    typeof value.title === "string" &&
    typeof value.matchedField === "string" &&
    typeof value.matchedValue === "string" &&
    optionalStrings(value, ["headingText", "anchor", "tag", "linkTarget", "fromTitle"]) &&
    optionalRelativePath(value, "targetPath") &&
    optionalRelativePath(value, "fromPath")
  );
}

function isInspectLink(value: unknown): value is VaultInspectLink {
  return (
    isObjectRecord(value) &&
    typeof value.target === "string" &&
    optionalRelativePath(value, "targetPath") &&
    optionalString(value, "targetTitle") &&
    optionalString(value, "anchor") &&
    optionalString(value, "alias") &&
    typeof value.raw === "string" &&
    LINK_STATUSES.has(value.status as string) &&
    typeof value.broken === "boolean" &&
    (value.targetPaths === undefined ||
      (Array.isArray(value.targetPaths) && value.targetPaths.every(isRelativeVaultPath)))
  );
}

function isInspectBacklink(value: unknown): value is VaultInspectBacklink {
  return (
    isObjectRecord(value) &&
    isRelativeVaultPath(value.fromPath) &&
    typeof value.fromTitle === "string" &&
    optionalString(value, "anchor") &&
    optionalString(value, "alias")
  );
}

function isInspectDuplicateAnchor(value: unknown): value is VaultInspectDuplicateAnchor {
  return (
    isObjectRecord(value) &&
    typeof value.anchor === "string" &&
    Array.isArray(value.headings) &&
    value.headings.every(
      (heading) =>
        isObjectRecord(heading) &&
        typeof heading.text === "string" &&
        isFiniteNumber(heading.level) &&
        typeof heading.explicit === "boolean",
    )
  );
}

function isInspectIssue(value: unknown): value is VaultInspectIssue {
  return (
    isObjectRecord(value) &&
    typeof value.kind === "string" &&
    VALIDATION_ISSUE_KINDS.has(value.kind as ValidationIssue["kind"]) &&
    isRelativeVaultPath(value.path) &&
    typeof value.message === "string" &&
    (value.severity === "warning" || value.severity === "error")
  );
}

function isAuthStatus(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    (value.mode === "disabled" || value.mode === "protected") &&
    (value.requestedMode === "disabled" || value.requestedMode === "protected") &&
    typeof value.enabled === "boolean" &&
    (value.enforcement === "none" || value.enforcement === "protected") &&
    typeof value.protectedModeAvailable === "boolean" &&
    typeof value.warning === "string" &&
    optionalString(value, "error")
  );
}

function isStartupStatus(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    (value.requestedAuthMode === "disabled" || value.requestedAuthMode === "protected") &&
    (value.operationalAuthMode === "disabled" || value.operationalAuthMode === "protected") &&
    typeof value.protectedModeMayStart === "boolean" &&
    isStoreStatusArray(value.missingRequiredStores) &&
    isStoreStatusArray(value.corruptStores) &&
    isStringArray(value.unsafeStorePaths) &&
    isStringArray(value.permissionWarnings) &&
    typeof value.networkExposureSafe === "boolean"
  );
}

function isCredentialLifecycle(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    typeof value.storeAvailable === "boolean" &&
    isNonNegativeInteger(value.activeCredentialCount) &&
    isNonNegativeInteger(value.revokedCredentialCount) &&
    isNonNegativeInteger(value.expiredCredentialCount) &&
    typeof value.bootstrapAvailable === "boolean" &&
    optionalString(value, "error")
  );
}

function isReadinessStatus(value: unknown): boolean {
  if (
    !isObjectRecord(value) ||
    !isObjectRecord(value.routePolicy) ||
    !isObjectRecord(value.checks)
  ) {
    return false;
  }
  const checks = value.checks;
  return (
    typeof value.readyForEnforcement === "boolean" &&
    typeof value.enforcementActive === "boolean" &&
    typeof value.protectedModeOperational === "boolean" &&
    typeof value.networkExposureSafe === "boolean" &&
    isNonNegativeInteger(value.blockerCount) &&
    isStringArray(value.blockers) &&
    isNonNegativeInteger(value.routePolicy.routePolicyCount) &&
    isNonNegativeInteger(value.routePolicy.expectedMinimum) &&
    [
      "protectedRequestPipelineAvailable",
      "protectedResponsePlannerAvailable",
      "reducedAnonymousStatusPlannerAvailable",
      "strongerConfirmationPlannerAvailable",
      "auditRequirementPlannerAvailable",
      "browserRequestGuardPlannerAvailable",
      "credentialSessionLifecyclePlannerAvailable",
    ].every((key) => typeof checks[key] === "boolean")
  );
}

function isRequestPolicyStatus(value: unknown): boolean {
  if (!isObjectRecord(value) || !isObjectRecord(value.dryRun)) return false;
  const dryRun = value.dryRun;
  return (
    typeof value.routePolicyInventoryPresent === "boolean" &&
    isNonNegativeInteger(value.routePolicyCount) &&
    typeof value.browserSecurityPolicyPresent === "boolean" &&
    typeof value.authorizationPlannerPresent === "boolean" &&
    isNonNegativeInteger(value.dryRunRunCount) &&
    isNonNegativeInteger(value.dryRunAuditAttemptedCount) &&
    isNonNegativeInteger(value.dryRunAuditAppendCount) &&
    isOptionalStatusObject(value.lastDryRunAuditStatus) &&
    isOptionalDryRunResult(value.lastDryRunResult) &&
    typeof dryRun.configured === "boolean" &&
    typeof dryRun.mounted === "boolean" &&
    isObjectRecord(dryRun.observed) &&
    isNonNegativeInteger(dryRun.observed.count) &&
    optionalSetMember(dryRun.observed, "lastStatus", DRY_RUN_STATUSES) &&
    isObjectRecord(dryRun.planned) &&
    isOptionalPlannedResponse(dryRun.planned.lastResponse) &&
    isObjectRecord(dryRun.audited) &&
    typeof dryRun.audited.configured === "boolean" &&
    isNonNegativeInteger(dryRun.audited.attemptedCount) &&
    isNonNegativeInteger(dryRun.audited.appendedCount) &&
    optionalSetMember(dryRun.audited, "lastStatus", DRY_RUN_AUDIT_STATUSES) &&
    typeof dryRun.enforced === "boolean" &&
    typeof dryRun.enforcementActive === "boolean" &&
    typeof value.enforcementActive === "boolean" &&
    typeof value.credentialVerificationActive === "boolean" &&
    typeof value.csrfOriginEnforcementActive === "boolean" &&
    typeof value.networkExposureSafe === "boolean"
  );
}

function isNodeVaultStatus(value: unknown): boolean {
  return (
    isObjectRecord(value) &&
    typeof value.vaultId === "string" &&
    typeof value.displayName === "string" &&
    INDEX_STATUSES.has(value.indexStatus as string) &&
    (value.watcherHealth === "ok" ||
      value.watcherHealth === "stale" ||
      value.watcherHealth === "rebuilding" ||
      value.watcherHealth === "error") &&
    isNonNegativeInteger(value.changedPathCount) &&
    isNonNegativeInteger(value.addedPathCount) &&
    isNonNegativeInteger(value.deletedPathCount) &&
    optionalFiniteNumber(value, "lastEventAt") &&
    optionalFiniteNumber(value, "lastIndexedAt") &&
    typeof value.storageSummaryAvailable === "boolean" &&
    optionalString(value, "error")
  );
}

function isStoreStatusArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => isObjectRecord(entry) && PROTECTED_STORE_NAMES.has(entry.store as string),
    )
  );
}

function isOptionalStatusObject(value: unknown): boolean {
  return (
    value === undefined ||
    (isObjectRecord(value) && DRY_RUN_AUDIT_STATUSES.has(value.status as string))
  );
}

function isOptionalDryRunResult(value: unknown): boolean {
  return (
    value === undefined ||
    (isObjectRecord(value) &&
      typeof value.method === "string" &&
      typeof value.path === "string" &&
      optionalString(value, "routePattern") &&
      DRY_RUN_STATUSES.has(value.status as string) &&
      isOptionalPlannedResponse(value.plannedResponse))
  );
}

function isOptionalPlannedResponse(value: unknown): boolean {
  return (
    value === undefined ||
    (isObjectRecord(value) &&
      RESPONSE_PLAN_KINDS.has(value.kind as string) &&
      isFiniteNumber(value.httpStatus) &&
      typeof value.reasonCode === "string")
  );
}

function recordValuesEvery(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): value is Record<string, unknown> {
  return isObjectRecord(value) && Object.values(value).every(predicate);
}

function isStringRecord(value: unknown): boolean {
  return recordValuesEvery(value, (entry) => typeof entry === "string");
}

function isStringArrayRecord(value: unknown): boolean {
  return recordValuesEvery(value, isStringArray);
}

function isRelativePathArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isRelativeVaultPath);
}

function isAbsoluteDisplayPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\"))
  );
}

function optionalRelativePath(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || isRelativeVaultPath(record[key]);
}

function optionalStrings(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => optionalString(record, key));
}

function optionalSetMember(
  record: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
): boolean {
  return record[key] === undefined || allowed.has(record[key] as string);
}
