import test from "node:test";
import assert from "node:assert/strict";
import {
  ENRICHMENT_ADVANCED_DEFAULT_OPEN,
  RELATED_NOTES_DISABLED_EXPLANATION,
  relatedNotesInspectMode,
  showEnrichmentManageAction,
  sourceSupportsRelatedNotes,
} from "./enrichmentUi.ts";

const disabled = {
  status: "disabled" as const,
  producer: "arepo.related-notes" as const,
  candidates: [] as [],
};

const ready = {
  status: "ready" as const,
  sourcePath: "a.md",
  sourceHash: "a".repeat(64),
  corpusHash: "b".repeat(64),
  producer: "arepo.related-notes" as const,
  producerVersion: 1,
  derivationVersion: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  candidates: [
    {
      targetPath: "b.md",
      targetHash: "c".repeat(64),
      title: "B",
      score: 0.2,
      evidence: [{ kind: "tag-overlap" as const, score: 1, sharedTags: ["test"] }],
    },
  ],
};

test("default-off inspect state is explanatory without loading or results", () => {
  assert.equal(relatedNotesInspectMode(disabled, false, null), "disabled");
  assert.match(RELATED_NOTES_DISABLED_EXPLANATION, /off for this vault/);
  assert.equal(ENRICHMENT_ADVANCED_DEFAULT_OPEN, false);
});

test("management action is permission-aware", () => {
  assert.equal(showEnrichmentManageAction("disabled", true), true);
  assert.equal(showEnrichmentManageAction("disabled", false), false);
  assert.equal(showEnrichmentManageAction("ready", true), false);
});

test("enabled candidates preserve ready state and failures remain distinguishable", () => {
  assert.equal(relatedNotesInspectMode(ready, false, null), "ready");
  assert.equal(relatedNotesInspectMode(null, true, null), "loading");
  assert.equal(relatedNotesInspectMode(null, false, "bounded"), "error");
  assert.equal(relatedNotesInspectMode({ ...ready, candidates: [] }, false, null), "empty");
});

test("Related Notes remains a Markdown-only inspection feature", () => {
  assert.equal(sourceSupportsRelatedNotes("markdown"), true);
  assert.equal(sourceSupportsRelatedNotes("plain-text"), false);
  assert.equal(sourceSupportsRelatedNotes("chat-json"), false);
  assert.equal(sourceSupportsRelatedNotes("generic-json"), false);
});
