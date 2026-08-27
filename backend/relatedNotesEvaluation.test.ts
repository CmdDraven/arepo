import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  RELATED_NOTES_RELEVANT_RATING,
  RelatedNotesEvaluationError,
  evaluateRelatedCandidates,
  evaluationPairKey,
  loadRelatedNotesEvaluationCorpus,
  ratingForPair,
  runDeterministicRelatedNotesEvaluation,
  validateRelatedNotesEvaluationCorpus,
  type CandidateRankings,
  type RelatedNotesEvaluationCorpus,
} from "./relatedNotesEvaluation.js";

function rawThreeNoteCorpus() {
  return {
    kind: "arepo.relatedNotesEvaluation",
    version: 1,
    notes: [
      { path: "a.md", content: "# Alpha\nshared canonical conflict" },
      { path: "b.md", content: "# Beta\nshared canonical conflict" },
      { path: "c.md", content: "# Garden\nrosemary soil cuttings" },
    ],
    ratings: [
      ["a.md", "b.md", 2, ["semantic-gap"]],
      ["a.md", "c.md", 0, ["hard-negative"]],
      ["b.md", "c.md", 0],
    ],
  };
}

function threeNoteCorpus(): RelatedNotesEvaluationCorpus {
  return validateRelatedNotesEvaluationCorpus(rawThreeNoteCorpus());
}

function candidate(targetPath: string, score = 0.5) {
  return { targetPath, score };
}

test("evaluation corpus v1 is accepted and pair lookup is symmetric", () => {
  const corpus = threeNoteCorpus();
  assert.equal(corpus.version, 1);
  assert.equal(corpus.ratings.length, 3);
  assert.equal(ratingForPair(corpus, "a.md", "b.md").rating, 2);
  assert.equal(ratingForPair(corpus, "b.md", "a.md").rating, 2);
});

test("evaluation corpus rejects unsupported versions", () => {
  assert.throws(
    () => validateRelatedNotesEvaluationCorpus({ ...rawThreeNoteCorpus(), version: 2 }),
    /Unsupported related-note evaluation corpus version/,
  );
});

test("evaluation corpus rejects ratings for nonexistent paths", () => {
  const raw = rawThreeNoteCorpus();
  raw.ratings[0] = ["a.md", "missing.md", 2];
  assert.throws(() => validateRelatedNotesEvaluationCorpus(raw), /not present in the corpus/);
});

test("evaluation corpus rejects self-pairs", () => {
  const raw = rawThreeNoteCorpus();
  raw.ratings[0] = ["a.md", "a.md", 2];
  assert.throws(
    () => validateRelatedNotesEvaluationCorpus(raw),
    /cannot rate a note against itself/,
  );
});

test("evaluation corpus rejects duplicate unordered pairs in either direction", () => {
  const raw = rawThreeNoteCorpus();
  raw.ratings[2] = ["b.md", "a.md", 2];
  assert.throws(() => validateRelatedNotesEvaluationCorpus(raw), /Duplicate rating pair/);
});

test("evaluation corpus rejects ratings outside the 0-3 rubric", () => {
  const raw = rawThreeNoteCorpus();
  raw.ratings[0] = ["a.md", "b.md", 4];
  assert.throws(() => validateRelatedNotesEvaluationCorpus(raw), /integer from 0 to 3/);
});

test("rating 2 is relevant while rating 1 is not", () => {
  assert.equal(RELATED_NOTES_RELEVANT_RATING, 2);
  const raw = rawThreeNoteCorpus();
  raw.ratings[0] = ["a.md", "b.md", 1];
  const report = evaluateRelatedCandidates({
    corpus: validateRelatedNotesEvaluationCorpus(raw),
    producer: "test",
    rankings: new Map([["a.md", [candidate("b.md")]]]),
  });
  assert.equal(report.metrics.precisionAt3, 0);
  assert.equal(report.metrics.recallAt10, 0);
});

test("precision, recall, MRR, NDCG, semantic-gap, and hard-negative formulas are bounded", () => {
  const rankings: CandidateRankings = new Map([
    ["a.md", [candidate("b.md", 0.9), candidate("c.md", 0.8)]],
    ["b.md", [candidate("a.md", 0.9)]],
    ["c.md", [candidate("a.md", 0.8)]],
  ]);
  const report = evaluateRelatedCandidates({
    corpus: threeNoteCorpus(),
    producer: "test",
    rankings,
  });
  assert.equal(report.metrics.precisionAt3, 0.5);
  assert.equal(report.metrics.precisionAt5, 0.5);
  assert.equal(report.metrics.recallAt5, 1);
  assert.equal(report.metrics.recallAt10, 1);
  assert.equal(report.metrics.meanReciprocalRank, 1);
  assert.equal(report.metrics.ndcgAt10, 1);
  assert.deepEqual(report.subsets.semanticGap, { total: 1, recoveredAt10: 1, recallAt10: 1 });
  assert.deepEqual(report.subsets.hardNegative, {
    total: 1,
    surfacedAt10: 1,
    falsePositiveRateAt10: 1,
  });
  assert.equal(report.diagnostics.falsePositiveCountAt10, 2);
});

test("direct relevant links are excluded from inferred recall", () => {
  const corpus = threeNoteCorpus();
  const report = evaluateRelatedCandidates({
    corpus,
    producer: "test",
    rankings: new Map([
      ["a.md", [candidate("b.md")]],
      ["b.md", [candidate("a.md")]],
    ]),
    directPairs: new Set([evaluationPairKey("a.md", "b.md")]),
  });
  assert.equal(report.directLinks.relevantPairsSuppressedByPolicy, 1);
  assert.equal(report.metrics.recallAt10, 0);
  assert.equal(report.coverage.sourcesWithEligibleRelevantPairs, 0);
});

test("sources with no relevance and sources with missed relevance are represented explicitly", () => {
  const report = evaluateRelatedCandidates({
    corpus: threeNoteCorpus(),
    producer: "test",
    rankings: new Map(),
  });
  assert.equal(report.perSource.find((source) => source.sourcePath === "c.md")?.recallAt10, null);
  assert.equal(report.perSource.find((source) => source.sourcePath === "a.md")?.recallAt10, 0);
  assert.equal(report.diagnostics.thresholdOrNoEvidenceFailures.length, 1);
});

test("a relevant candidate below K is a ranking miss at K and not a threshold failure", () => {
  const paths = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"];
  const ratings: unknown[] = [];
  for (let left = 0; left < paths.length; left += 1) {
    for (let right = left + 1; right < paths.length; right += 1) {
      ratings.push([
        paths[left],
        paths[right],
        paths[left] === "a.md" && paths[right] === "g.md" ? 3 : 0,
      ]);
    }
  }
  const corpus = validateRelatedNotesEvaluationCorpus({
    kind: "arepo.relatedNotesEvaluation",
    version: 1,
    notes: paths.map((notePath) => ({ path: notePath, content: `# ${notePath}` })),
    ratings,
  });
  const report = evaluateRelatedCandidates({
    corpus,
    producer: "test",
    rankings: new Map([
      ["a.md", ["b.md", "c.md", "d.md", "e.md", "f.md", "g.md"].map((target) => candidate(target))],
    ]),
  });
  assert.equal(report.metrics.recallAt5, 0);
  assert.equal(report.metrics.recallAt10, 0.5);
  assert.equal(report.diagnostics.rankingFailures[0]?.bestRank, 6);
  assert.equal(report.diagnostics.thresholdOrNoEvidenceFailures.length, 0);
});

test("production evaluation calls the real derivation and returns production work statistics", () => {
  const report = runDeterministicRelatedNotesEvaluation(threeNoteCorpus());
  assert.equal(report.producer, "deterministic-v1");
  assert.equal(report.diagnostics.limits.productionStats?.eligibleSources, 3);
  assert.equal(report.perSource.find((source) => source.sourcePath === "a.md")?.foundAt10, 1);
});

test("checked-in deterministic V1 baseline is reproducible and protects stable headline metrics", async () => {
  const corpus = await loadRelatedNotesEvaluationCorpus(
    path.resolve(process.cwd(), "evaluation", "related-notes-v1.json"),
  );
  const first = runDeterministicRelatedNotesEvaluation(corpus);
  const second = runDeterministicRelatedNotesEvaluation(corpus);
  assert.deepEqual(first, second);
  assert.deepEqual(first.corpus, {
    noteCount: 17,
    ratedPairCount: 136,
    exhaustive: true,
    relevantThreshold: 2,
  });
  assert.deepEqual(first.metrics, {
    precisionAt3: 0.805556,
    precisionAt5: 0.789474,
    precisionAt10: 0.789474,
    recallAt5: 0.681818,
    recallAt10: 0.681818,
    meanReciprocalRank: 0.9,
    ndcgAt10: 0.709614,
    rating3RecallAt10: 1,
  });
  assert.deepEqual(first.subsets.semanticGap, {
    total: 5,
    recoveredAt10: 3,
    recallAt10: 0.6,
  });
  assert.deepEqual(first.subsets.hardNegative, {
    total: 7,
    surfacedAt10: 2,
    falsePositiveRateAt10: 0.285714,
  });
  assert.deepEqual(
    first.diagnostics.falsePositivesAt10.map(({ source, target }) => [source, target]),
    [
      ["concurrency/transactions.md", "filesystem/canonical-paths.md"],
      ["concurrency/version-checks.md", "knowledge/wikilinks.md"],
      ["filesystem/canonical-paths.md", "concurrency/transactions.md"],
      ["knowledge/wikilinks.md", "concurrency/version-checks.md"],
    ],
  );
});

test("evaluation errors have a narrow recognizable type", () => {
  assert.throws(
    () => validateRelatedNotesEvaluationCorpus(null),
    (error) => error instanceof RelatedNotesEvaluationError,
  );
});
