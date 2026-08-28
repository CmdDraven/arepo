import test from "node:test";
import assert from "node:assert/strict";
import type { EmbeddingBatchResult, EmbeddingProvider } from "./embeddingProvider.js";
import {
  embedScopedSemanticSources,
  prepareScopedSemanticBatch,
  resolveSemanticScopeFromManifest,
} from "./semanticScope.js";
import type { StructuralIndexInputManifest } from "./vaultFs.js";
import { defaultSemanticPreference } from "../src/lib/vault/semanticContracts.js";
import type { NoteIndex } from "../src/lib/vault/indexer.js";

const hash = (character: string) => character.repeat(64);
const manifest = (
  ...sources: StructuralIndexInputManifest["sources"]
): StructuralIndexInputManifest => ({
  scope: { markdown: { minDepth: 0, maxDepth: null } },
  sources,
});
const note = (notePath: string): NoteIndex => ({
  path: notePath,
  slug: notePath.replace(/\.md$/i, ""),
  title: notePath,
  frontmatter: {},
  headings: [],
  anchors: [],
  wikilinks: [],
  metadataRelationships: [],
  metadataRelationshipIssues: [],
  tags: [],
});

test("All dynamically resolves only readable Markdown sources", () => {
  const preference = {
    ...defaultSemanticPreference(),
    enabled: true,
    scope: { mode: "all" as const, selectedPaths: ["dormant.md"] },
  };
  const initial = resolveSemanticScopeFromManifest(
    preference,
    manifest(
      { path: "b.md", state: "readable", contentHash: hash("b") },
      { path: "a.md", state: "readable", contentHash: hash("a") },
      { path: "plain.txt", state: "readable", contentHash: hash("c") },
      { path: "chat.arepo-chat.json", state: "readable", contentHash: hash("d") },
      { path: "generic.json", state: "readable", contentHash: hash("e") },
      { path: "unreadable.md", state: "unavailable" },
      { path: "excluded.md", state: "excluded" },
    ),
  );
  assert.deepEqual(initial.effectivePaths, ["a.md", "b.md"]);
  assert.deepEqual(initial.authorizedPaths, ["a.md", "b.md"]);
  assert.deepEqual(initial.summary, {
    mode: "all",
    eligibleCount: 2,
    pairwiseRelationshipCount: 1,
  });
  const withNewNote = resolveSemanticScopeFromManifest(
    preference,
    manifest(
      { path: "a.md", state: "readable", contentHash: hash("a") },
      { path: "new.md", state: "readable", contentHash: hash("n") },
    ),
  );
  assert.deepEqual(withNewNote.effectivePaths, ["a.md", "new.md"]);
});

test("Selected preserves missing intent and does not expand to newly discovered notes", () => {
  const preference = {
    ...defaultSemanticPreference(),
    enabled: true,
    scope: { mode: "selected" as const, selectedPaths: ["a.md", "missing.md"] },
  };
  const missing = resolveSemanticScopeFromManifest(
    preference,
    manifest(
      { path: "a.md", state: "readable", contentHash: hash("a") },
      { path: "new.md", state: "readable", contentHash: hash("n") },
      { path: "missing.md", state: "unavailable" },
    ),
  );
  assert.deepEqual(missing.effectivePaths, ["a.md"]);
  assert.deepEqual(missing.unavailablePaths, ["missing.md"]);
  assert.deepEqual(missing.summary, {
    mode: "selected",
    selectedCount: 2,
    eligibleCount: 1,
    unavailableCount: 1,
    pairwiseRelationshipCount: 0,
  });
  const restored = resolveSemanticScopeFromManifest(
    preference,
    manifest(
      { path: "a.md", state: "readable", contentHash: hash("a") },
      { path: "missing.md", state: "readable", contentHash: hash("m") },
      { path: "new.md", state: "readable", contentHash: hash("n") },
    ),
  );
  assert.deepEqual(restored.effectivePaths, ["a.md", "missing.md"]);
});

test("disabled and empty Selected scopes authorize no vault-content work", async () => {
  const disabled = resolveSemanticScopeFromManifest(
    defaultSemanticPreference(),
    manifest({ path: "a.md", state: "readable", contentHash: hash("a") }),
  );
  assert.deepEqual(disabled.authorizedPaths, []);
  const enabledEmpty = resolveSemanticScopeFromManifest(
    { ...defaultSemanticPreference(), enabled: true },
    manifest({ path: "a.md", state: "readable", contentHash: hash("a") }),
  );
  let providerCalls = 0;
  const provider: EmbeddingProvider = {
    async listModels() {
      return [];
    },
    async getIdentity() {
      throw new Error("unused");
    },
    async embed(): Promise<EmbeddingBatchResult> {
      providerCalls += 1;
      throw new Error("must not be called");
    },
  };
  assert.equal(await embedScopedSemanticSources(provider, "embed", enabledEmpty, []), null);
  await assert.rejects(() =>
    embedScopedSemanticSources(provider, "embed", enabledEmpty, [
      { path: "a.md", content: "must not leave", note: note("a.md") },
    ]),
  );
  const disabledAll = resolveSemanticScopeFromManifest(
    {
      ...defaultSemanticPreference(),
      scope: { mode: "all", selectedPaths: [] },
    },
    manifest({ path: "a.md", state: "readable", contentHash: hash("a") }),
  );
  assert.deepEqual(disabledAll.effectivePaths, ["a.md"]);
  assert.deepEqual(disabledAll.authorizedPaths, []);
  await assert.rejects(() =>
    embedScopedSemanticSources(provider, "embed", disabledAll, [
      { path: "a.md", content: "must not leave", note: note("a.md") },
    ]),
  );
  assert.equal(providerCalls, 0);
});

test("unselected content cannot reach semantic text preparation or provider construction", async () => {
  const scope = resolveSemanticScopeFromManifest(
    {
      ...defaultSemanticPreference(),
      enabled: true,
      scope: { mode: "selected", selectedPaths: ["A.md", "B.md"] },
    },
    manifest(
      { path: "A.md", state: "readable", contentHash: hash("a") },
      { path: "B.md", state: "readable", contentHash: hash("b") },
      { path: "C.md", state: "readable", contentHash: hash("c") },
      { path: "SECRET.md", state: "readable", contentHash: hash("s") },
    ),
  );
  const prepared: string[] = [];
  const providerInputs: string[][] = [];
  const prepare = ({ content }: { content: string; note: NoteIndex }) => {
    prepared.push(content);
    return content;
  };
  assert.deepEqual(
    prepareScopedSemanticBatch(
      scope,
      [
        { path: "A.md", content: "A allowed", note: note("A.md") },
        { path: "B.md", content: "B allowed", note: note("B.md") },
      ],
      prepare,
    ).map(({ path }) => path),
    ["A.md", "B.md"],
  );
  assert.deepEqual(prepared, ["A allowed", "B allowed"]);
  const provider: EmbeddingProvider = {
    async listModels() {
      return [];
    },
    async getIdentity() {
      throw new Error("unused");
    },
    async embed(model, texts) {
      providerInputs.push(texts);
      return {
        identity: {
          provider: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model,
          dimensions: 1,
        },
        vectors: texts.map(() => [1]),
      };
    },
  };
  await embedScopedSemanticSources(
    provider,
    "embed",
    scope,
    [
      { path: "A.md", content: "A allowed", note: note("A.md") },
      { path: "B.md", content: "B allowed", note: note("B.md") },
    ],
    prepare,
  );
  assert.deepEqual(providerInputs, [["A allowed", "B allowed"]]);
  await assert.rejects(() =>
    embedScopedSemanticSources(
      provider,
      "embed",
      scope,
      [{ path: "SECRET.md", content: "private secret", note: note("SECRET.md") }],
      prepare,
    ),
  );
  assert.equal(prepared.includes("private secret"), false);
  assert.equal(providerInputs.flat().includes("private secret"), false);
  assert.equal(providerInputs.length, 1);
});

test("scope identity changes with authorized corpus but ignores dormant All selections", () => {
  const baseManifest = manifest({ path: "a.md", state: "readable", contentHash: hash("a") });
  const allA = resolveSemanticScopeFromManifest(
    { ...defaultSemanticPreference(), enabled: true, scope: { mode: "all", selectedPaths: [] } },
    baseManifest,
  );
  const allDormant = resolveSemanticScopeFromManifest(
    {
      ...defaultSemanticPreference(),
      enabled: true,
      scope: { mode: "all", selectedPaths: ["dormant.md"] },
    },
    baseManifest,
  );
  const selected = resolveSemanticScopeFromManifest(
    {
      ...defaultSemanticPreference(),
      enabled: true,
      scope: { mode: "selected", selectedPaths: ["a.md"] },
    },
    baseManifest,
  );
  assert.equal(allA.scopeIdentity, allDormant.scopeIdentity);
  assert.notEqual(allA.scopeIdentity, selected.scopeIdentity);
});
