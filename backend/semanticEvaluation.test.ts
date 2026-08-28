import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { EmbeddingProvider } from "./embeddingProvider.js";
import {
  loadRelatedNotesEvaluationCorpus,
  validateRelatedNotesEvaluationCorpus,
} from "./relatedNotesEvaluation.js";
import { runSemanticEvaluation } from "./semanticEvaluation.js";

const corpus = validateRelatedNotesEvaluationCorpus({
  kind: "arepo.relatedNotesEvaluation",
  version: 1,
  notes: [
    { path: "z.md", content: "# Alpha\ntransaction conflict" },
    { path: "ä.md", content: "# Beta\nstale update" },
    { path: "a.md", content: "# Garden\nrosemary soil" },
  ],
  ratings: [
    ["z.md", "ä.md", 3, ["semantic-gap"]],
    ["z.md", "a.md", 0, ["hard-negative"]],
    ["ä.md", "a.md", 0],
  ],
});

test("semantic evaluator batches prepared text, ranks cosine scores, and reports provenance", async () => {
  const seen: string[] = [];
  const vectors = new Map([
    ["Alpha", [1, 0]],
    ["Beta", [0.9, 0.1]],
    ["Garden", [0, 1]],
  ]);
  const provider: EmbeddingProvider = {
    async listModels() {
      return [];
    },
    async getIdentity() {
      throw new Error("unused");
    },
    async embed(model, texts) {
      seen.push(...texts);
      return {
        identity: {
          provider: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model,
          modelDigest: "e".repeat(64),
          dimensions: 2,
        },
        vectors: texts.map((text) => {
          const key = [...vectors.keys()].find((candidate) => text.includes(candidate));
          if (!key) throw new Error("missing fixture vector");
          return vectors.get(key) as number[];
        }),
      };
    },
  };
  const report = await runSemanticEvaluation({ corpus, provider, model: "embed" });
  assert.equal(seen.length, 3);
  assert.equal(report.providerIdentity.modelDigest, "e".repeat(64));
  assert.equal(report.semanticTextVersion, 1);
  assert.equal(report.semanticProducerVersion, 1);
  assert.equal(report.evaluation.metrics.recallAt10, 1);
  assert.equal(report.evaluation.subsets.semanticGap.recoveredAt10, 1);
  assert.equal(JSON.stringify(report).includes("vectors"), false);
});

test("semantic evaluator uses code-unit path order for equal-score tie breaking", async () => {
  const provider: EmbeddingProvider = {
    async listModels() {
      return [];
    },
    async getIdentity() {
      throw new Error("unused");
    },
    async embed(model, texts) {
      return {
        identity: {
          provider: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model,
          dimensions: 2,
        },
        vectors: texts.map(() => [1, 0]),
      };
    },
  };
  const report = await runSemanticEvaluation({ corpus, provider, model: "embed" });
  const source = report.evaluation.perSource.find((entry) => entry.sourcePath === "z.md");
  assert.deepEqual(
    source?.falsePositives.map((item) => item.target),
    ["a.md"],
  );
  assert.equal(source?.missed.length, 0);
});

test("semantic evaluator batches the locked corpus without persisting or exposing vectors", async () => {
  const locked = await loadRelatedNotesEvaluationCorpus(
    path.resolve(process.cwd(), "evaluation", "related-notes-v1.json"),
  );
  const batches: number[] = [];
  const before = JSON.stringify(locked);
  const provider: EmbeddingProvider = {
    async listModels() {
      return [];
    },
    async getIdentity() {
      throw new Error("unused");
    },
    async embed(model, texts) {
      batches.push(texts.length);
      return {
        identity: {
          provider: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model,
          dimensions: 2,
        },
        vectors: texts.map((_text, index) => [1, index / 100 + 0.01]),
      };
    },
  };
  const report = await runSemanticEvaluation({ corpus: locked, provider, model: "embed" });
  assert.deepEqual(batches, [16, 1]);
  assert.equal(report.evaluation.corpus.noteCount, 17);
  assert.equal(JSON.stringify(report).includes("vectors"), false);
  assert.equal(JSON.stringify(locked), before);
});

test("semantic evaluator excludes resolved direct links under the locked policy", async () => {
  const linked = validateRelatedNotesEvaluationCorpus({
    kind: "arepo.relatedNotesEvaluation",
    version: 1,
    notes: [
      { path: "a.md", content: "# Alpha\n[[b]]" },
      { path: "b.md", content: "# Beta\nrelated" },
    ],
    ratings: [["a.md", "b.md", 3]],
  });
  const provider: EmbeddingProvider = {
    async listModels() {
      return [];
    },
    async getIdentity() {
      throw new Error("unused");
    },
    async embed(model, texts) {
      return {
        identity: {
          provider: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model,
          dimensions: 2,
        },
        vectors: texts.map(() => [1, 0]),
      };
    },
  };
  const report = await runSemanticEvaluation({ corpus: linked, provider, model: "embed" });
  assert.equal(report.evaluation.directLinks.relevantPairsSuppressedByPolicy, 1);
  assert.equal(report.evaluation.metrics.recallAt10, 0);
  assert.equal(
    report.evaluation.perSource.every((source) => source.candidateCount === 0),
    true,
  );
});

test("semantic evaluator rejects an incomplete vector batch", async () => {
  let calls = 0;
  const provider: EmbeddingProvider = {
    async listModels() {
      return [];
    },
    async getIdentity() {
      throw new Error("unused");
    },
    async embed(model, texts) {
      calls += 1;
      return {
        identity: {
          provider: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model,
          dimensions: 2,
        },
        vectors: texts.slice(1).map(() => [1, 0]),
      };
    },
  };
  await assert.rejects(
    () => runSemanticEvaluation({ corpus, provider, model: "embed" }),
    /complete evaluation result/,
  );
  assert.equal(calls, 1);
});
