import test from "node:test";
import assert from "node:assert/strict";
import {
  ENRICHMENT_ADVANCED_DEFAULT_OPEN,
  RELATED_NOTES_DISABLED_EXPLANATION,
  RELATED_NOTES_DISMISS_EXPLANATION,
  RELATED_NOTES_KEEP_EXPLANATION,
  curationFreshnessLabel,
  relatedNotesInspectMode,
  showEnrichmentManageAction,
  showCurationActions,
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
  curation: { status: "ready" as const, kept: [] },
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
  assert.equal(
    relatedNotesInspectMode(
      {
        ...ready,
        candidates: [],
        curation: {
          status: "ready",
          kept: [
            {
              targetPath: "b.md",
              decidedAt: "2026-01-01T00:00:00.000Z",
              freshness: "current",
              explicitInSource: false,
            },
          ],
        },
      },
      false,
      null,
    ),
    "ready",
  );
});

test("Related Notes remains a Markdown-only inspection feature", () => {
  assert.equal(sourceSupportsRelatedNotes("markdown"), true);
  assert.equal(sourceSupportsRelatedNotes("plain-text"), false);
  assert.equal(sourceSupportsRelatedNotes("chat-json"), false);
  assert.equal(sourceSupportsRelatedNotes("generic-json"), false);
});

test("curation actions are opt-in and authorization-aware with non-source wording", () => {
  assert.equal(showCurationActions(true, true), true);
  assert.equal(showCurationActions(false, true), false);
  assert.equal(showCurationActions(true, false), false);
  assert.match(RELATED_NOTES_KEEP_EXPLANATION, /Keep this relationship in AREPO/);
  assert.match(RELATED_NOTES_DISMISS_EXPLANATION, /Hide this relationship/);
  for (const copy of [RELATED_NOTES_KEEP_EXPLANATION, RELATED_NOTES_DISMISS_EXPLANATION]) {
    assert.doesNotMatch(copy, /Markdown link|train|graph edge/i);
  }
});

test("changed and missing curation states stay understandable", () => {
  assert.match(curationFreshnessLabel("left-changed"), /first note changed/);
  assert.match(curationFreshnessLabel("right-missing"), /second note is currently missing/);
  assert.match(curationFreshnessLabel("both-missing"), /Both notes/);
});
