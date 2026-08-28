import test from "node:test";
import assert from "node:assert/strict";

import { parseChatExportV1 } from "./chatExport.ts";
import {
  isDirectoryBrowserResponse,
  isEnrichmentPreferencesResponse,
  isIndexFilterResponse,
  isIndexSearchResponse,
  isLocalNodeRuntimeStatus,
  isOperationResult,
  isPathMutationData,
  isRelationshipPromotionData,
  isRenameMutationData,
  isRelatedNotesCurationMutationResponse,
  isRelatedNotesCurationResponse,
  isRelatedNotesResponse,
  isSemanticProviderStatusResponse,
  isSemanticRuntimeStatusResponse,
  isVaultFileListResponse,
  isVaultFileResponse,
  isVaultIndexResponse,
  isVaultInspectResponse,
  isVaultListResponse,
  isVaultRuntimeStatus,
  isVaultStorageSummary,
} from "./apiValidation.ts";

test("related-note response guard enforces versions, paths, scores, bounds, and evidence kinds", () => {
  const valid = {
    status: "ready",
    sourcePath: "nested/source.md",
    sourceHash: "a".repeat(64),
    corpusHash: "b".repeat(64),
    producer: "arepo.related-notes",
    producerVersion: 1,
    derivationVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    curation: { status: "ready", kept: [] },
    candidates: [
      {
        targetPath: "target.md",
        targetHash: "c".repeat(64),
        title: "Target",
        score: 0.42,
        evidence: [
          { kind: "tag-overlap", score: 0.5, sharedTags: ["filesystem"] },
          { kind: "common-neighbours", score: 1, paths: ["shared.md"] },
          { kind: "lexical-similarity", score: 0.3, sharedTerms: ["canonical"] },
        ],
      },
    ],
  };
  assert.equal(isRelatedNotesResponse(valid), true);
  assert.equal(isRelatedNotesResponse({ ...valid, producerVersion: 2 }), false);
  assert.equal(isRelatedNotesResponse({ ...valid, sourcePath: "/private/source.md" }), false);
  assert.equal(isRelatedNotesResponse({ ...valid, sourceHash: "not-a-hash" }), false);
  assert.equal(
    isRelatedNotesResponse({
      ...valid,
      candidates: [{ ...valid.candidates[0], targetPath: "/private/secret.md" }],
    }),
    false,
  );
  assert.equal(
    isRelatedNotesResponse({
      ...valid,
      candidates: [{ ...valid.candidates[0], score: Number.NaN }],
    }),
    false,
  );
  assert.equal(
    isRelatedNotesResponse({
      ...valid,
      candidates: [
        {
          ...valid.candidates[0],
          evidence: [{ kind: "future-model-explanation", score: 1, text: "secret" }],
        },
      ],
    }),
    false,
  );
  assert.equal(
    isRelatedNotesResponse({ ...valid, candidates: Array(11).fill(valid.candidates[0]) }),
    false,
  );
  assert.equal(
    isRelatedNotesResponse({
      status: "disabled",
      producer: "arepo.related-notes",
      candidates: [],
    }),
    true,
  );
  assert.equal(isRelatedNotesResponse({ status: "future", candidates: [] }), false);
  assert.equal(
    isRelatedNotesResponse({
      status: "disabled",
      producer: "arepo.related-notes",
      candidates: [],
      internal: true,
    }),
    false,
  );
});

test("semantic provider runtime guard accepts bounded provenance and rejects vectors", () => {
  const valid = {
    enabled: true,
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "embed",
    models: [{ name: "embed", digest: "f".repeat(64) }],
    producer: {
      name: "arepo.semantic-similarity",
      version: 1,
      textVersion: 1,
      productionCandidates: "deferred",
    },
    status: "available",
    identity: {
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "embed",
      modelDigest: "f".repeat(64),
      dimensions: 768,
    },
  };
  assert.equal(isSemanticProviderStatusResponse(valid), true);
  assert.equal(
    isSemanticRuntimeStatusResponse({
      provider: valid,
      scope: {
        mode: "selected",
        selectedCount: 3,
        eligibleCount: 2,
        unavailableCount: 1,
        pairwiseRelationshipCount: 1,
      },
    }),
    true,
  );
  assert.equal(
    isSemanticRuntimeStatusResponse({
      provider: valid,
      scope: {
        mode: "selected",
        selectedCount: 1,
        eligibleCount: 2,
        unavailableCount: 0,
        pairwiseRelationshipCount: 1,
      },
    }),
    false,
  );
  assert.equal(
    isSemanticRuntimeStatusResponse({
      provider: valid,
      scope: { mode: "all", eligibleCount: 1, pairwiseRelationshipCount: 1 },
    }),
    false,
  );
  assert.equal(isSemanticProviderStatusResponse({ ...valid, vectors: [[1, 2]] }), false);
  assert.equal(
    isSemanticProviderStatusResponse({
      ...valid,
      status: "provider-unreachable",
      identity: undefined,
      diagnostic: "/private/example/secret.txt".repeat(20),
    }),
    false,
  );
});

test("curation guards reject unsafe paths, contradictory pairs, bad timestamps, and unknown states", () => {
  const decision = {
    leftPath: "a.md",
    rightPath: "nested/b.md",
    decision: "kept",
    decidedAt: "2026-01-01T00:00:00.000Z",
    freshness: "current",
    producerAtDecision: "arepo.related-notes",
    producerVersionAtDecision: 1,
  };
  const valid = {
    status: "ready",
    vaultId: "notes",
    sourcePath: "a.md",
    canMutate: true,
    summary: { kept: 1, dismissed: 0 },
    decisions: [decision],
  };
  assert.equal(isRelatedNotesCurationResponse(valid), true);
  assert.equal(
    isRelatedNotesCurationResponse({
      ...valid,
      decisions: [{ ...decision, leftPath: "/private/a.md" }],
    }),
    false,
  );
  assert.equal(
    isRelatedNotesCurationResponse({
      ...valid,
      decisions: [{ ...decision, rightPath: "a.md" }],
    }),
    false,
  );
  assert.equal(
    isRelatedNotesCurationResponse({
      ...valid,
      decisions: [{ ...decision, decidedAt: "yesterday" }],
    }),
    false,
  );
  assert.equal(
    isRelatedNotesCurationResponse({
      ...valid,
      decisions: [{ ...decision, decision: "trained" }],
    }),
    false,
  );
  assert.equal(
    isRelatedNotesCurationResponse({
      ...valid,
      decisions: [{ ...decision, freshness: "renamed-by-magic" }],
    }),
    false,
  );
  assert.equal(
    isRelatedNotesCurationResponse({ ...valid, decisions: [decision, decision] }),
    false,
  );
  assert.equal(isRelatedNotesCurationResponse({ ...valid, status: "future" }), false);
  assert.equal(
    isRelatedNotesCurationResponse({
      status: "invalid",
      vaultId: "notes",
      canMutate: false,
      summary: { kept: 0, dismissed: 0 },
      decisions: [],
      diagnostic: "Stored curation is invalid.",
    }),
    true,
  );
  assert.equal(
    isRelatedNotesCurationResponse({
      status: "invalid",
      vaultId: "notes",
      canMutate: true,
      summary: { kept: 0, dismissed: 0 },
      decisions: [],
      diagnostic: "Stored curation is invalid.",
    }),
    false,
  );
  assert.equal(
    isRelatedNotesCurationResponse({ ...valid, diagnostic: "Unexpected ready diagnostic." }),
    false,
  );
  assert.equal(isRelatedNotesCurationMutationResponse({ status: "updated", decision }), true);
  assert.equal(isRelatedNotesCurationMutationResponse({ status: "cleared" }), true);
  assert.equal(isRelatedNotesCurationMutationResponse({ status: "cleared", decision }), false);
});

test("enrichment preference response guard rejects unknown producers, presets, and invalid values", () => {
  const relatedNotes = {
    enabled: false,
    preset: "balanced",
    configuration: {
      minimumScore: 0.1,
      lexicalOnlyMinimumScore: 0.16,
      maximumSuggestions: 10,
      evidence: {
        tags: { enabled: true, weight: 20 },
        title: { enabled: true, weight: 10 },
        headings: { enabled: true, weight: 10 },
        neighbours: { enabled: true, weight: 20 },
        lexical: { enabled: true, weight: 40 },
      },
    },
  };
  const semantic = {
    enabled: false,
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "",
    scope: { mode: "selected", selectedPaths: [] },
  };
  const valid = {
    status: "ready",
    storageStatus: "default",
    preferences: {
      kind: "arepo.enrichmentPreferences",
      version: 3,
      vaultId: "notes",
      producers: { relatedNotes, semantic },
    },
  };
  assert.equal(isEnrichmentPreferencesResponse(valid), true);
  assert.equal(
    isEnrichmentPreferencesResponse({
      ...valid,
      preferences: {
        ...valid.preferences,
        producers: { ...valid.preferences.producers, future: {} },
      },
    }),
    false,
  );
  assert.equal(
    isEnrichmentPreferencesResponse({
      ...valid,
      preferences: {
        ...valid.preferences,
        producers: { relatedNotes: { ...relatedNotes, preset: "future" }, semantic },
      },
    }),
    false,
  );
  assert.equal(
    isEnrichmentPreferencesResponse({
      ...valid,
      preferences: {
        ...valid.preferences,
        producers: {
          relatedNotes: {
            ...relatedNotes,
            preset: "custom",
            configuration: { ...relatedNotes.configuration, minimumScore: Number.NaN },
          },
          semantic,
        },
      },
    }),
    false,
  );
  assert.equal(
    isEnrichmentPreferencesResponse({
      ...valid,
      preferences: {
        ...valid.preferences,
        producers: {
          relatedNotes: {
            ...relatedNotes,
            preset: "custom",
            configuration: {
              ...relatedNotes.configuration,
              evidence: {
                ...relatedNotes.configuration.evidence,
                lexical: { enabled: true, weight: Number.POSITIVE_INFINITY },
              },
            },
          },
          semantic,
        },
      },
    }),
    false,
  );
});

const permissions = {
  readIndex: true,
  readContent: true,
  writeContent: true,
  deleteFiles: false,
};

test("vault-list validation distinguishes management from least-privilege operational views", () => {
  const base = { nodeId: "local", displayName: "Local node", mode: "local", apiVersion: 1 };
  const management = {
    ...base,
    vaultView: "management",
    vaults: [{ id: "notes", displayName: "Notes", rootPath: "/srv/notes", permissions }],
  };
  const operational = {
    ...base,
    vaultView: "operational",
    vaults: [{ id: "notes", displayName: "Notes", availability: { status: "available" } }],
  };

  assert.equal(isVaultListResponse(management), true);
  assert.equal(isVaultListResponse(operational), true);
  assert.equal(isVaultListResponse({ ...management, nodeId: 42 }), false);
  assert.equal(isVaultListResponse({ ...management, vaultView: "future" }), false);
  assert.equal(
    isVaultListResponse({
      ...operational,
      vaults: [{ ...operational.vaults[0], rootPath: "/private/leak" }],
    }),
    false,
  );
});

test("Tree/source validation accepts all current kinds and rejects malformed paths and future kinds", () => {
  const valid = {
    files: [
      source("note.md", "markdown"),
      source("readme.txt", "plain-text"),
      source("chat.arepo-chat.json", "chat-json"),
      source("data.json", "generic-json"),
    ],
    folders: ["nested", "nested/deeper"],
  };

  assert.equal(isVaultFileListResponse(valid), true);
  assert.equal(
    isVaultFileListResponse({ ...valid, files: [{ ...valid.files[0], size: "1" }] }),
    false,
  );
  assert.equal(
    isVaultFileListResponse({ ...valid, files: [{ ...valid.files[0], kind: "future-source" }] }),
    false,
  );
  assert.equal(
    isVaultFileListResponse({ ...valid, files: [{ ...valid.files[0], kind: "generic-json" }] }),
    false,
  );
  assert.equal(
    isVaultFileListResponse({ ...valid, files: [{ ...valid.files[0], path: "/etc/passwd" }] }),
    false,
  );
  assert.equal(isVaultFileListResponse({ ...valid, folders: ["nested", "../outside"] }), false);
});

test("file-content wire validation preserves canonical raw strings for every source kind", () => {
  const chat = JSON.stringify({
    format: "arepo-chat-export",
    version: 1,
    conversation: { id: "conv" },
    messages: [],
  });
  for (const [path, kind, content] of [
    ["note.md", "markdown", "# Note\n"],
    ["readme.txt", "plain-text", "text\n"],
    ["chat.arepo-chat.json", "chat-json", chat],
    ["data.json", "generic-json", "{ malformed raw"],
  ] as const) {
    const payload = { ...source(path, kind), content, hash: "sha256" };
    assert.equal(isVaultFileResponse(payload), true, kind);
  }

  assert.equal(
    isVaultFileResponse({
      ...source("data.json", "generic-json"),
      content: { unsafe: true },
      hash: "h",
    }),
    false,
  );
  assert.equal(
    isVaultFileResponse({ ...source("chat.arepo-chat.json", "chat-json"), content: [], hash: "h" }),
    false,
  );
});

test("Chat V1 nested validation remains the bounded source parser's responsibility", () => {
  const malformedNested = JSON.stringify({
    format: "arepo-chat-export",
    version: 1,
    conversation: { id: "conv" },
    messages: [{ id: "message", author: "A", timestamp: 17, text: "hello" }],
  });
  const wire = {
    ...source("chat.arepo-chat.json", "chat-json"),
    content: malformedNested,
    hash: "h",
  };

  assert.equal(isVaultFileResponse(wire), true);
  assert.equal(parseChatExportV1(wire.content).ok, false);
});

test("machine-index public validation inspects nested data in place", () => {
  const payload = {
    index: publicIndex(),
    issues: [],
  };
  const originalIndex = payload.index;
  assert.equal(isVaultIndexResponse(payload), true);
  assert.equal(payload.index, originalIndex);

  const missing = structuredClone(payload) as Record<string, unknown>;
  delete (missing.index as Record<string, unknown>).backlinks;
  assert.equal(isVaultIndexResponse(missing), false);

  const wrongNested = structuredClone(payload);
  wrongNested.index.notes["note.md"]!.headings[0]!.level = Number.NaN;
  assert.equal(isVaultIndexResponse(wrongNested), false);
});

test("filter, search, and inspect validators reject unknown variants and malformed nested records", () => {
  const filter = {
    filter: "tags",
    total: 1,
    source: "machine-index",
    results: [
      {
        id: "tag:notes:note.md",
        filter: "tags",
        path: "note.md",
        title: "Note",
        reason: "Tagged #notes",
        tag: "notes",
      },
    ],
  };
  const search = {
    q: "note",
    total: 1,
    source: "machine-index",
    results: [
      {
        id: "file:note.md",
        matchType: "file",
        path: "note.md",
        title: "Note",
        matchedField: "path",
        matchedValue: "note.md",
      },
    ],
  };
  const inspect = {
    source: "machine-index",
    path: "note.md",
    title: "Note",
    tags: [],
    headings: [{ level: 1, text: "Note", anchor: "note", explicit: false }],
    anchors: ["note"],
    outgoingLinks: [],
    backlinks: [],
    brokenOutgoingLinks: [],
    duplicateAnchors: [],
    orphan: true,
    issues: [],
  };

  assert.equal(isIndexFilterResponse(filter), true);
  assert.equal(isIndexSearchResponse(search), true);
  assert.equal(isVaultInspectResponse(inspect), true);
  assert.equal(isIndexFilterResponse({ ...filter, filter: "future-filter" }), false);
  assert.equal(
    isIndexSearchResponse({ ...search, results: [{ ...search.results[0], matchType: "body" }] }),
    false,
  );
  assert.equal(
    isVaultInspectResponse({ ...inspect, headings: [{ ...inspect.headings[0], text: 3 }] }),
    false,
  );
});

test("mutation success and watcher-status payloads require their consumed fields", () => {
  const mutationGuard = isOperationResult(isPathMutationData);
  assert.equal(mutationGuard({ ok: true, data: { path: "note.md" } }), true);
  assert.equal(mutationGuard({ ok: true, data: { path: "/absolute.md" } }), false);
  assert.equal(mutationGuard({ ok: true }), false);

  const renameGuard = isOperationResult(isRenameMutationData);
  assert.equal(
    renameGuard({
      ok: true,
      data: {
        fromPath: "old.md",
        toPath: "new.md",
        curationDiagnostic: "Curation bookkeeping could not be updated.",
        semanticScopeDiagnostic: "Semantic selections could not be updated.",
      },
    }),
    true,
  );
  assert.equal(
    renameGuard({
      ok: true,
      data: {
        fromPath: "old.md",
        toPath: "new.md",
        curationDiagnostic: "x".repeat(513),
      },
    }),
    false,
  );
  assert.equal(
    renameGuard({
      ok: true,
      data: {
        fromPath: "old.md",
        toPath: "new.md",
        semanticScopeDiagnostic: "x".repeat(513),
      },
    }),
    false,
  );

  const promotionGuard = isOperationResult(isRelationshipPromotionData);
  const file = (filePath: string) => ({
    path: filePath,
    kind: "markdown",
    size: 32,
    mtimeMs: 100,
    hash: "a".repeat(64),
  });
  const currentResult = {
    role: "current",
    ownerPath: "note.md",
    targetPath: "nested/target.md",
    status: "promoted",
    file: file("note.md"),
  };
  const relatedResult = {
    role: "related",
    ownerPath: "nested/target.md",
    targetPath: "note.md",
    status: "already-present",
    file: file("nested/target.md"),
  };
  const promotion = {
    ok: true,
    data: {
      status: "complete",
      ownership: "current",
      currentPath: "note.md",
      relatedPath: "nested/target.md",
      results: [currentResult],
      curationDiagnostic: "Curation could not be cleared.",
    },
  };
  assert.equal(promotionGuard(promotion), true);
  assert.equal(
    promotionGuard({
      ok: true,
      data: {
        status: "complete",
        ownership: "related",
        currentPath: "note.md",
        relatedPath: "nested/target.md",
        results: [relatedResult],
      },
    }),
    true,
  );
  assert.equal(
    promotionGuard({
      ok: true,
      data: {
        status: "complete",
        ownership: "both",
        currentPath: "note.md",
        relatedPath: "nested/target.md",
        results: [currentResult, relatedResult],
      },
    }),
    true,
  );
  const partial = {
    ok: true,
    data: {
      status: "partial",
      ownership: "both",
      currentPath: "note.md",
      relatedPath: "nested/target.md",
      results: [
        currentResult,
        {
          role: "related",
          ownerPath: "nested/target.md",
          targetPath: "note.md",
          status: "failed",
          error: "Source changed on disk.",
          code: "CONFLICT",
        },
      ],
      diagnostic: "One note was updated; the other note was not changed.",
    },
  };
  assert.equal(promotionGuard(partial), true);
  assert.equal(
    promotionGuard({
      ok: false,
      error: "Source changed on disk. Reload before adding relationship metadata.",
      code: "VAULT_FILE_CONFLICT",
    }),
    true,
  );
  assert.equal(
    promotionGuard({ ...promotion, data: { ...promotion.data, ownership: "future" } }),
    false,
  );
  assert.equal(
    promotionGuard({ ...promotion, data: { ...promotion.data, currentPath: "/private/note.md" } }),
    false,
  );
  assert.equal(
    promotionGuard({
      ...promotion,
      data: { ...promotion.data, results: [{ ...currentResult, ownerPath: "other.md" }] },
    }),
    false,
  );
  assert.equal(
    promotionGuard({
      ...partial,
      data: { ...partial.data, results: [...partial.data.results].reverse() },
    }),
    false,
  );
  assert.equal(
    promotionGuard({ ...partial, data: { ...partial.data, diagnostic: undefined } }),
    false,
  );
  assert.equal(
    promotionGuard({ ...partial, data: { ...partial.data, diagnostic: "x".repeat(513) } }),
    false,
  );
  assert.equal(
    promotionGuard({
      ...partial,
      data: {
        ...partial.data,
        results: [currentResult, { ...partial.data.results[1], error: "x".repeat(513) }],
      },
    }),
    false,
  );
  assert.equal(
    promotionGuard({
      ...promotion,
      data: { ...promotion.data, status: "partial", diagnostic: "Partial." },
    }),
    false,
  );

  const status = {
    vaultId: "notes",
    indexStatus: "fresh",
    changedExternally: false,
    changedPaths: [],
    addedPaths: [],
    deletedPaths: [],
  };
  assert.equal(isVaultRuntimeStatus(status), true);
  assert.equal(isVaultRuntimeStatus({ ...status, indexStatus: "future" }), false);
  assert.equal(isVaultRuntimeStatus({ ...status, changedPaths: ["../outside"] }), false);
});

test("directory and storage response validators cover settings API payloads", () => {
  assert.equal(
    isDirectoryBrowserResponse({
      currentPath: "/srv/notes",
      parentPath: "/srv",
      directories: [{ name: "nested", path: "/srv/notes/nested" }],
    }),
    true,
  );
  assert.equal(
    isDirectoryBrowserResponse({
      currentPath: "relative",
      parentPath: null,
      directories: [],
    }),
    false,
  );

  const storage = {
    vaultId: "notes",
    vaultRoot: "/srv/notes",
    total: { fileCount: 3, bytes: 100 },
    markdownText: { fileCount: 1, bytes: 20 },
    attachments: { fileCount: 1, bytes: 30 },
    appDataCache: {
      fileCount: 1,
      bytes: 50,
      machineIndexBytes: 50,
      relatedNotesEnrichmentBytes: 0,
      files: [{ kind: "machine-index", path: "/app/cache/index.json", bytes: 50 }],
    },
  };
  assert.equal(isVaultStorageSummary(storage), true);
  assert.equal(
    isVaultStorageSummary({ ...storage, appDataCache: { ...storage.appDataCache, bytes: -1 } }),
    false,
  );
});

test("local node status validates every settings field that rendering consumes", () => {
  const status = localNodeStatus();
  assert.equal(isLocalNodeRuntimeStatus(status), true);
  assert.equal(isLocalNodeRuntimeStatus({ ...status, vaultCount: "1" }), false);
  assert.equal(
    isLocalNodeRuntimeStatus({
      ...status,
      protectedModeReadiness: {
        ...status.protectedModeReadiness,
        checks: {
          ...status.protectedModeReadiness.checks,
          protectedRequestPipelineAvailable: "yes",
        },
      },
    }),
    false,
  );
});

function source(path: string, kind: "markdown" | "plain-text" | "chat-json" | "generic-json") {
  return { path, kind, size: 1, mtimeMs: 100 };
}

function publicIndex() {
  return {
    notes: {
      "note.md": {
        path: "note.md",
        slug: "note",
        title: "Note",
        frontmatter: {},
        headings: [{ level: 1, text: "Note", anchor: "note", explicit: false }],
        anchors: ["note"],
        wikilinks: [],
        metadataRelationships: [],
        metadataRelationshipIssues: [],
        tags: [],
      },
    },
    bySlug: { note: "note.md" },
    duplicateSlugs: {},
    byId: {},
    duplicateIds: {},
    excludedBySlug: {},
    duplicateExcludedSlugs: {},
    excludedPaths: [],
    outgoingLinks: { "note.md": [] },
    backlinks: { "note.md": [] },
    brokenLinks: [],
    orphanNotes: ["note.md"],
  };
}

function localNodeStatus() {
  return {
    ok: true,
    node: { nodeId: "local", displayName: "Local", mode: "local", apiVersion: 1 },
    runtime: {
      host: "127.0.0.1",
      port: 8733,
      localOnlyMode: true,
      allowedOrigins: [],
      startupWarnings: [],
    },
    auth: {
      mode: "disabled",
      requestedMode: "disabled",
      enabled: false,
      enforcement: "none",
      protectedModeAvailable: false,
      warning: "Local only",
    },
    protectedModeStartup: {
      requestedAuthMode: "disabled",
      operationalAuthMode: "disabled",
      protectedModeMayStart: false,
      missingRequiredStores: [],
      corruptStores: [],
      unsafeStorePaths: [],
      permissionWarnings: [],
      networkExposureSafe: false,
    },
    credentialLifecycle: {
      storeAvailable: false,
      activeCredentialCount: 0,
      revokedCredentialCount: 0,
      expiredCredentialCount: 0,
      bootstrapAvailable: false,
    },
    protectedModeReadiness: {
      readyForEnforcement: false,
      enforcementActive: false,
      protectedModeOperational: false,
      networkExposureSafe: false,
      blockerCount: 1,
      blockers: ["Disabled"],
      routePolicy: { routePolicyCount: 20, expectedMinimum: 20 },
      checks: {
        protectedRequestPipelineAvailable: true,
        protectedResponsePlannerAvailable: true,
        reducedAnonymousStatusPlannerAvailable: true,
        strongerConfirmationPlannerAvailable: true,
        auditRequirementPlannerAvailable: true,
        browserRequestGuardPlannerAvailable: true,
        credentialSessionLifecyclePlannerAvailable: true,
      },
    },
    requestPolicy: {
      routePolicyInventoryPresent: true,
      routePolicyCount: 20,
      browserSecurityPolicyPresent: true,
      authorizationPlannerPresent: true,
      dryRunRunCount: 0,
      dryRunAuditAttemptedCount: 0,
      dryRunAuditAppendCount: 0,
      dryRun: {
        configured: false,
        mounted: false,
        observed: { count: 0 },
        planned: {},
        audited: { configured: false, attemptedCount: 0, appendedCount: 0 },
        enforced: false,
        enforcementActive: false,
      },
      enforcementActive: false,
      credentialVerificationActive: false,
      csrfOriginEnforcementActive: false,
      networkExposureSafe: false,
    },
    vaultCount: 1,
    vaults: [
      {
        vaultId: "notes",
        displayName: "Notes",
        indexStatus: "fresh",
        watcherHealth: "ok",
        changedPathCount: 0,
        addedPathCount: 0,
        deletedPathCount: 0,
        storageSummaryAvailable: true,
      },
    ],
    capabilities: {
      storageSummary: true,
      remoteNodes: false,
      authentication: false,
      sync: false,
      ai: false,
      database: false,
      migrationSupport: false,
    },
  } as const;
}
