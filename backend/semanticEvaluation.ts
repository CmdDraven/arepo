import {
  assembleIndex,
  deriveMarkdownSource,
  type MarkdownSourceDerivation,
} from "../src/lib/vault/indexer.js";
import {
  SEMANTIC_PRODUCER,
  SEMANTIC_PRODUCER_VERSION,
  SEMANTIC_TEXT_VERSION,
  type EmbeddingProviderIdentity,
} from "../src/lib/vault/semanticContracts.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";
import {
  evaluateRelatedCandidates,
  evaluationPairKey,
  formatRelatedNotesEvaluationReport,
  type CandidateRankings,
  type RelatedNotesEvaluationCorpus,
  type RelatedNotesEvaluationReport,
} from "./relatedNotesEvaluation.js";
import { prepareSemanticText } from "./semanticText.js";

const SEMANTIC_EVALUATION_BATCH_SIZE = 16;

export type SemanticEvaluationReport = {
  experiment: "semantic-e1";
  providerIdentity: EmbeddingProviderIdentity;
  semanticProducerVersion: typeof SEMANTIC_PRODUCER_VERSION;
  semanticTextVersion: typeof SEMANTIC_TEXT_VERSION;
  evaluation: RelatedNotesEvaluationReport;
};

export async function runSemanticEvaluation(input: {
  corpus: RelatedNotesEvaluationCorpus;
  provider: EmbeddingProvider;
  model: string;
}): Promise<SemanticEvaluationReport> {
  const derivations: Record<string, MarkdownSourceDerivation> = {};
  const texts = input.corpus.notes.map((note) => {
    const derivation = deriveMarkdownSource(note.path, note.content);
    derivations[note.path] = derivation;
    return prepareSemanticText({ content: note.content, note: derivation });
  });
  const vectors: number[][] = [];
  let identity: EmbeddingProviderIdentity | undefined;
  for (let offset = 0; offset < texts.length; offset += SEMANTIC_EVALUATION_BATCH_SIZE) {
    const batch = await input.provider.embed(
      input.model,
      texts.slice(offset, offset + SEMANTIC_EVALUATION_BATCH_SIZE),
    );
    if (identity && !sameIdentity(identity, batch.identity)) {
      throw new Error("The semantic provider identity changed during evaluation.");
    }
    identity = batch.identity;
    vectors.push(...batch.vectors);
  }
  if (!identity || vectors.length !== input.corpus.notes.length) {
    throw new Error("The semantic provider did not return a complete evaluation result.");
  }

  const index = assembleIndex(derivations);
  const directPairs = new Set<string>();
  for (const note of input.corpus.notes) {
    for (const link of index.outgoingLinks[note.path] ?? []) {
      if (link.status === "resolved" && link.targetPath && derivations[link.targetPath]) {
        directPairs.add(evaluationPairKey(note.path, link.targetPath));
      }
    }
  }

  const rankings: CandidateRankings = new Map(
    input.corpus.notes.map((source, sourceIndex) => [
      source.path,
      input.corpus.notes
        .flatMap((target, targetIndex) => {
          if (
            targetIndex === sourceIndex ||
            directPairs.has(evaluationPairKey(source.path, target.path))
          ) {
            return [];
          }
          return [
            {
              targetPath: target.path,
              score: cosineScore(vectors[sourceIndex], vectors[targetIndex]),
            },
          ];
        })
        .sort(
          (left, right) =>
            right.score - left.score || compareCodeUnits(left.targetPath, right.targetPath),
        ),
    ]),
  );

  return {
    experiment: "semantic-e1",
    providerIdentity: identity,
    semanticProducerVersion: SEMANTIC_PRODUCER_VERSION,
    semanticTextVersion: SEMANTIC_TEXT_VERSION,
    evaluation: evaluateRelatedCandidates({
      corpus: input.corpus,
      producer: `${SEMANTIC_PRODUCER}-e1`,
      rankings,
      directPairs,
    }),
  };
}

export function formatSemanticEvaluationReport(report: SemanticEvaluationReport): string {
  const identity = report.providerIdentity;
  return [
    "AREPO semantic evaluation (experimental; no production semantic candidates)",
    `Provider: ${identity.provider}`,
    `Endpoint: ${identity.endpoint}`,
    `Model: ${identity.model}`,
    `Model digest: ${identity.modelDigest ?? "not reported"}`,
    `Dimensions: ${identity.dimensions}`,
    `Semantic producer version: ${report.semanticProducerVersion}`,
    `Semantic text version: ${report.semanticTextVersion}`,
    formatRelatedNotesEvaluationReport(report.evaluation).trimEnd(),
    "",
  ].join("\n");
}

function cosineScore(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error("Semantic evaluation vectors have inconsistent dimensions.");
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      throw new Error("Semantic evaluation vectors contain invalid values.");
    }
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    throw new Error("Semantic evaluation vectors must be non-zero.");
  }
  const cosine = dot / Math.sqrt(leftNorm * rightNorm);
  return Number(Math.min(1, Math.max(0, (cosine + 1) / 2)).toFixed(12));
}

function sameIdentity(left: EmbeddingProviderIdentity, right: EmbeddingProviderIdentity): boolean {
  return (
    left.provider === right.provider &&
    left.endpoint === right.endpoint &&
    left.model === right.model &&
    left.modelDigest === right.modelDigest &&
    left.dimensions === right.dimensions
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
