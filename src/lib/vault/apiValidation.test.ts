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
  isRenameMutationData,
  isRelatedNotesCurationMutationResponse,
  isRelatedNotesCurationResponse,
  isRelatedNotesResponse,
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
  const valid = {
    status: "ready",
    storageStatus: "default",
    preferences: {
      kind: "arepo.enrichmentPreferences",
      version: 1,
      vaultId: "notes",
      producers: { relatedNotes },
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
        producers: { relatedNotes: { ...relatedNotes, preset: "future" } },
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
