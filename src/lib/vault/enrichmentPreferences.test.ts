import test from "node:test";
import assert from "node:assert/strict";
import {
  BALANCED_RELATED_NOTES_SETTINGS,
  RELATED_NOTES_PRESETS,
  canonicalResolvedRelatedNotesSettings,
  customRelatedNotesPreference,
  defaultEnrichmentPreferences,
  isEnrichmentPreferences,
  isRelatedNotesPreference,
  namedRelatedNotesPreference,
  resolveRelatedNotesSettings,
  type RelatedNotesPreference,
} from "./enrichmentPreferences.ts";

test("missing preferences default Related Notes off with Balanced reference values", () => {
  const preferences = defaultEnrichmentPreferences("notes");
  assert.equal(preferences.producers.relatedNotes.enabled, false);
  assert.equal(preferences.producers.relatedNotes.preset, "balanced");
  assert.deepEqual(
    resolveRelatedNotesSettings(preferences.producers.relatedNotes),
    BALANCED_RELATED_NOTES_SETTINGS,
  );
  assert.deepEqual(preferences.producers.semantic, {
    enabled: false,
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "",
    scope: { mode: "selected", selectedPaths: [] },
  });
});

test("named presets are deterministic monotonic variants and Balanced is deterministic V1", () => {
  assert.deepEqual(RELATED_NOTES_PRESETS.balanced, {
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
  });
  assert.deepEqual(namedRelatedNotesPreference("conservative", true).configuration, {
    ...RELATED_NOTES_PRESETS.conservative,
    evidence: RELATED_NOTES_PRESETS.conservative.evidence,
  });
  assert.deepEqual(namedRelatedNotesPreference("exploratory", true).configuration, {
    ...RELATED_NOTES_PRESETS.exploratory,
    evidence: RELATED_NOTES_PRESETS.exploratory.evidence,
  });
  assert.ok(RELATED_NOTES_PRESETS.conservative.minimumScore > 0.1);
  assert.ok(RELATED_NOTES_PRESETS.exploratory.minimumScore < 0.1);
});

test("advanced configuration is explicitly Custom and restoring a preset is canonical", () => {
  const edited = structuredClone(RELATED_NOTES_PRESETS.balanced);
  edited.minimumScore = 0.12;
  const custom = customRelatedNotesPreference(true, edited);
  assert.equal(custom.preset, "custom");
  assert.equal(custom.configuration.minimumScore, 0.12);
  assert.deepEqual(namedRelatedNotesPreference("balanced", true), {
    enabled: true,
    preset: "balanced",
    configuration: RELATED_NOTES_PRESETS.balanced,
  });
});

test("invalid thresholds, maximums, evidence keys, and weights are rejected", () => {
  const base = namedRelatedNotesPreference("balanced", true);
  const mutations: Array<(value: RelatedNotesPreference) => void> = [
    (value) => void (value.configuration.minimumScore = Number.NaN),
    (value) => void (value.configuration.minimumScore = 1.1),
    (value) => void (value.configuration.maximumSuggestions = 0),
    (value) => void (value.configuration.maximumSuggestions = 11),
    (value) =>
      void Object.assign(value.configuration.evidence, {
        future: { enabled: true, weight: 1 },
      }),
    (value) => void (value.configuration.evidence.tags.weight = Number.POSITIVE_INFINITY),
    (value) => void (value.configuration.evidence.tags.weight = -1),
  ];
  for (const mutate of mutations) {
    const value = structuredClone(base);
    value.preset = "custom";
    mutate(value);
    assert.equal(isRelatedNotesPreference(value), false);
  }
});

test("all evidence disabled and zero enabled relative weight are rejected", () => {
  const allOff = customRelatedNotesPreference(
    true,
    structuredClone(RELATED_NOTES_PRESETS.balanced),
  );
  Object.values(allOff.configuration.evidence).forEach((item) => (item.enabled = false));
  assert.equal(isRelatedNotesPreference(allOff), false);

  const zero = customRelatedNotesPreference(true, structuredClone(RELATED_NOTES_PRESETS.balanced));
  Object.values(zero.configuration.evidence).forEach((item) => (item.weight = 0));
  assert.equal(isRelatedNotesPreference(zero), false);
});

test("relative weights normalize deterministically and disabled evidence has zero weight", () => {
  const configuration = structuredClone(RELATED_NOTES_PRESETS.balanced);
  configuration.evidence.tags.weight = 40;
  configuration.evidence.lexical.weight = 80;
  configuration.evidence.title.enabled = false;
  configuration.evidence.headings.enabled = false;
  configuration.evidence.neighbours.enabled = false;
  const resolved = resolveRelatedNotesSettings(customRelatedNotesPreference(true, configuration));
  assert.equal(resolved.evidence.tags.effectiveWeight, 0.333333333333);
  assert.equal(resolved.evidence.lexical.effectiveWeight, 0.666666666667);
  assert.deepEqual(resolved.evidence.title, { enabled: false, effectiveWeight: 0 });
});

test("canonical effective settings ignore relative scale and object insertion concerns", () => {
  const left = structuredClone(RELATED_NOTES_PRESETS.balanced);
  const right = structuredClone(RELATED_NOTES_PRESETS.balanced);
  Object.values(right.evidence).forEach((item) => (item.weight *= 2));
  assert.equal(
    canonicalResolvedRelatedNotesSettings(
      resolveRelatedNotesSettings(customRelatedNotesPreference(true, left)),
    ),
    canonicalResolvedRelatedNotesSettings(
      resolveRelatedNotesSettings(customRelatedNotesPreference(true, right)),
    ),
  );
});

test("preference documents reject unknown versions, producers, presets, and impossible named states", () => {
  const valid = defaultEnrichmentPreferences("notes");
  assert.equal(isEnrichmentPreferences(valid, "notes"), true);
  assert.equal(isEnrichmentPreferences({ ...valid, version: 1 }, "notes"), false);
  assert.equal(
    isEnrichmentPreferences({ ...valid, producers: { ...valid.producers, future: {} } }, "notes"),
    false,
  );
  assert.equal(
    isEnrichmentPreferences(
      {
        ...valid,
        producers: {
          ...valid.producers,
          relatedNotes: { ...valid.producers.relatedNotes, preset: "future" },
        },
      },
      "notes",
    ),
    false,
  );
  const mislabeled = structuredClone(valid);
  mislabeled.producers.relatedNotes.configuration.minimumScore = 0.12;
  assert.equal(isEnrichmentPreferences(mislabeled, "notes"), false);
});
