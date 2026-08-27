import crypto from "node:crypto";
import fs from "node:fs/promises";
import {
  assembleIndex,
  deriveMarkdownSource,
  type MarkdownSourceDerivation,
} from "../src/lib/vault/indexer.js";
import type { RelatedNoteCandidate } from "../src/lib/vault/enrichmentContracts.js";
import { BALANCED_RELATED_NOTES_SETTINGS } from "../src/lib/vault/enrichmentPreferences.js";
import {
  RELATED_NOTES_MAX_CANDIDATE_POOL,
  RELATED_NOTES_MAX_POSTINGS,
  deriveRelatedNotesCorpus,
  type RelatedNotesDerivationStats,
  type RelatedNotesSource,
} from "./relatedNotes.js";
import { relatedNotesCorpusHash } from "./relatedNotesCache.js";

export const RELATED_NOTES_EVALUATION_VERSION = 1;
export const RELATED_NOTES_RELEVANT_RATING = 2;
export const RELATED_NOTES_EVALUATION_K = [3, 5, 10] as const;
const FIXED_EVALUATION_GENERATED_AT = "2000-01-01T00:00:00.000Z";

export type EvaluationAnnotation = "semantic-gap" | "hard-negative";

export type EvaluationNote = {
  path: string;
  content: string;
};

export type EvaluationRating = {
  source: string;
  target: string;
  rating: 0 | 1 | 2 | 3;
  annotations: EvaluationAnnotation[];
  comment?: string;
};

export type RelatedNotesEvaluationCorpus = {
  kind: "arepo.relatedNotesEvaluation";
  version: 1;
  notes: EvaluationNote[];
  ratings: EvaluationRating[];
};

export type EvaluationCandidate = Pick<RelatedNoteCandidate, "targetPath" | "score">;

export type CandidateRankings = ReadonlyMap<string, readonly EvaluationCandidate[]>;

export type PairDiagnostic = {
  source: string;
  target: string;
  rating: number;
  annotations: EvaluationAnnotation[];
  bestRank?: number;
  category?: "ranked-below-5" | "ranked-below-10" | "no-candidate-or-below-threshold";
};

export type FalsePositiveDiagnostic = {
  source: string;
  target: string;
  rank: number;
  score: number;
  annotations: EvaluationAnnotation[];
};

export type PerSourceEvaluation = {
  sourcePath: string;
  eligibleRelevantPairs: number;
  foundAt10: number;
  recallAt10: number | null;
  candidateCount: number;
  missed: Array<{ target: string; rating: number; annotations: EvaluationAnnotation[] }>;
  falsePositives: Array<{ target: string; rank: number; score: number }>;
};

export type RelatedNotesEvaluationReport = {
  evaluationVersion: number;
  producer: string;
  corpus: {
    noteCount: number;
    ratedPairCount: number;
    exhaustive: true;
    relevantThreshold: number;
  };
  metrics: {
    precisionAt3: number;
    precisionAt5: number;
    precisionAt10: number;
    recallAt5: number;
    recallAt10: number;
    meanReciprocalRank: number;
    ndcgAt10: number;
    rating3RecallAt10: number;
  };
  coverage: {
    sourcesEvaluated: number;
    sourcesWithEligibleRelevantPairs: number;
    sourcesWithRelevantCandidateAt10: number;
    sourcesWithNoSuggestions: number;
  };
  subsets: {
    semanticGap: { total: number; recoveredAt10: number; recallAt10: number };
    hardNegative: { total: number; surfacedAt10: number; falsePositiveRateAt10: number };
  };
  directLinks: {
    relevantPairsSuppressedByPolicy: number;
    pairs: PairDiagnostic[];
  };
  diagnostics: {
    falsePositiveCountAt10: number;
    rating3Misses: PairDiagnostic[];
    falsePositivesAt10: FalsePositiveDiagnostic[];
    rankingFailures: PairDiagnostic[];
    thresholdOrNoEvidenceFailures: PairDiagnostic[];
    limits: {
      corpusCanHitPostingLimit: boolean;
      corpusCanHitCandidatePoolLimit: boolean;
      productionStats?: RelatedNotesDerivationStats;
    };
  };
  perSource: PerSourceEvaluation[];
};

export class RelatedNotesEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelatedNotesEvaluationError";
  }
}

export async function loadRelatedNotesEvaluationCorpus(
  file: string,
): Promise<RelatedNotesEvaluationCorpus> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new RelatedNotesEvaluationError("Evaluation corpus must contain valid JSON.");
    }
    throw error;
  }
  return validateRelatedNotesEvaluationCorpus(parsed);
}

export function validateRelatedNotesEvaluationCorpus(value: unknown): RelatedNotesEvaluationCorpus {
  if (!isRecord(value) || value.kind !== "arepo.relatedNotesEvaluation") {
    throw new RelatedNotesEvaluationError(
      'Evaluation corpus kind must be "arepo.relatedNotesEvaluation".',
    );
  }
  if (value.version !== RELATED_NOTES_EVALUATION_VERSION) {
    throw new RelatedNotesEvaluationError(
      `Unsupported related-note evaluation corpus version: ${String(value.version)}.`,
    );
  }
  if (!Array.isArray(value.notes) || value.notes.length < 2) {
    throw new RelatedNotesEvaluationError("Evaluation corpus must contain at least two notes.");
  }
  const notes = value.notes.map((rawNote, index): EvaluationNote => {
    if (
      !isRecord(rawNote) ||
      !isRelativeMarkdownPath(rawNote.path) ||
      typeof rawNote.content !== "string"
    ) {
      throw new RelatedNotesEvaluationError(`Invalid evaluation note at index ${index}.`);
    }
    return { path: rawNote.path, content: rawNote.content };
  });
  const paths = new Set<string>();
  for (const note of notes) {
    if (paths.has(note.path)) {
      throw new RelatedNotesEvaluationError(`Duplicate evaluation note path: ${note.path}.`);
    }
    paths.add(note.path);
  }
  if (!Array.isArray(value.ratings)) {
    throw new RelatedNotesEvaluationError("Evaluation corpus ratings must be an array.");
  }
  const pairKeys = new Set<string>();
  const ratings = value.ratings.map((rawRating, index): EvaluationRating => {
    if (!Array.isArray(rawRating) || rawRating.length < 3 || rawRating.length > 5) {
      throw new RelatedNotesEvaluationError(`Invalid rating tuple at index ${index}.`);
    }
    const [source, target, rating, rawAnnotations = [], comment] = rawRating;
    if (typeof source !== "string" || typeof target !== "string") {
      throw new RelatedNotesEvaluationError(`Rating ${index} must reference string paths.`);
    }
    if (!paths.has(source) || !paths.has(target)) {
      throw new RelatedNotesEvaluationError(
        `Rating ${index} references a path that is not present in the corpus.`,
      );
    }
    if (source === target) {
      throw new RelatedNotesEvaluationError(`Rating ${index} cannot rate a note against itself.`);
    }
    if (!Number.isInteger(rating) || (rating as number) < 0 || (rating as number) > 3) {
      throw new RelatedNotesEvaluationError(`Rating ${index} must be an integer from 0 to 3.`);
    }
    if (
      !Array.isArray(rawAnnotations) ||
      !rawAnnotations.every(
        (annotation) => annotation === "semantic-gap" || annotation === "hard-negative",
      ) ||
      new Set(rawAnnotations).size !== rawAnnotations.length
    ) {
      throw new RelatedNotesEvaluationError(`Rating ${index} has invalid annotations.`);
    }
    if (comment !== undefined && (typeof comment !== "string" || comment.length > 500)) {
      throw new RelatedNotesEvaluationError(`Rating ${index} has an invalid comment.`);
    }
    if (rawAnnotations.includes("semantic-gap") && (rating as number) < 2) {
      throw new RelatedNotesEvaluationError("semantic-gap annotations require rating 2 or 3.");
    }
    if (rawAnnotations.includes("hard-negative") && rating !== 0) {
      throw new RelatedNotesEvaluationError("hard-negative annotations require rating 0.");
    }
    const key = evaluationPairKey(source, target);
    if (pairKeys.has(key)) {
      throw new RelatedNotesEvaluationError(`Duplicate rating pair: ${key.replace("\0", " <> ")}.`);
    }
    pairKeys.add(key);
    return {
      source: source.localeCompare(target) < 0 ? source : target,
      target: source.localeCompare(target) < 0 ? target : source,
      rating: rating as 0 | 1 | 2 | 3,
      annotations: [...rawAnnotations].sort() as EvaluationAnnotation[],
      ...(comment === undefined ? {} : { comment }),
    };
  });
  const expectedPairs = (notes.length * (notes.length - 1)) / 2;
  if (ratings.length !== expectedPairs) {
    throw new RelatedNotesEvaluationError(
      `Evaluation corpus must exhaustively rate ${expectedPairs} unordered pairs; found ${ratings.length}.`,
    );
  }
  return {
    kind: "arepo.relatedNotesEvaluation",
    version: RELATED_NOTES_EVALUATION_VERSION,
    notes: notes.slice().sort((a, b) => a.path.localeCompare(b.path)),
    ratings: ratings.sort(
      (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    ),
  };
}

export function ratingForPair(
  corpus: RelatedNotesEvaluationCorpus,
  left: string,
  right: string,
): EvaluationRating {
  const key = evaluationPairKey(left, right);
  const rating = corpus.ratings.find(
    (candidate) => evaluationPairKey(candidate.source, candidate.target) === key,
  );
  if (!rating)
    throw new RelatedNotesEvaluationError(`No rating found for pair ${left} <> ${right}.`);
  return rating;
}

export function runDeterministicRelatedNotesEvaluation(
  corpus: RelatedNotesEvaluationCorpus,
): RelatedNotesEvaluationReport {
  const derivations: Record<string, MarkdownSourceDerivation> = {};
  const readable = corpus.notes.map((note) => {
    const contentHash = crypto.createHash("sha256").update(note.content).digest("hex");
    derivations[note.path] = deriveMarkdownSource(note.path, note.content);
    return { path: note.path, contentHash };
  });
  const index = assembleIndex(derivations);
  const sources: RelatedNotesSource[] = corpus.notes.map((note) => {
    const manifest = readable.find((entry) => entry.path === note.path);
    if (!manifest) throw new RelatedNotesEvaluationError(`Missing manifest for ${note.path}.`);
    return {
      path: note.path,
      sourceHash: manifest.contentHash,
      content: note.content,
      note: derivations[note.path],
      resolvedOutgoingPaths: (index.outgoingLinks[note.path] ?? [])
        .filter((link) => link.status === "resolved" && typeof link.targetPath === "string")
        .map((link) => link.targetPath as string)
        .sort((a, b) => a.localeCompare(b)),
    };
  });
  const production = deriveRelatedNotesCorpus(
    sources,
    relatedNotesCorpusHash(readable, BALANCED_RELATED_NOTES_SETTINGS),
    FIXED_EVALUATION_GENERATED_AT,
    BALANCED_RELATED_NOTES_SETTINGS,
  );
  const rankings = new Map<string, readonly EvaluationCandidate[]>(
    [...production.results.entries()].map(([sourcePath, result]) => [
      sourcePath,
      result.candidates,
    ]),
  );
  const directPairs = new Set<string>();
  for (const source of sources) {
    for (const target of source.resolvedOutgoingPaths) {
      if (derivations[target]) directPairs.add(evaluationPairKey(source.path, target));
    }
  }
  return evaluateRelatedCandidates({
    corpus,
    producer: "deterministic-v1",
    rankings,
    directPairs,
    productionStats: production.stats,
  });
}

export function evaluateRelatedCandidates(input: {
  corpus: RelatedNotesEvaluationCorpus;
  producer: string;
  rankings: CandidateRankings;
  directPairs?: ReadonlySet<string>;
  productionStats?: RelatedNotesDerivationStats;
}): RelatedNotesEvaluationReport {
  const { corpus, producer } = input;
  const directPairs = input.directPairs ?? new Set<string>();
  const notePaths = new Set(corpus.notes.map((note) => note.path));
  const ratings = new Map(
    corpus.ratings.map((rating) => [evaluationPairKey(rating.source, rating.target), rating]),
  );
  const rankings = new Map<string, EvaluationCandidate[]>();
  for (const source of corpus.notes.map((note) => note.path)) {
    const seen = new Set<string>();
    const normalized: EvaluationCandidate[] = [];
    for (const candidate of input.rankings.get(source) ?? []) {
      if (!notePaths.has(candidate.targetPath) || candidate.targetPath === source) {
        throw new RelatedNotesEvaluationError(
          `Invalid candidate ${source} -> ${candidate.targetPath}.`,
        );
      }
      if (seen.has(candidate.targetPath)) {
        throw new RelatedNotesEvaluationError(
          `Duplicate candidate ${source} -> ${candidate.targetPath}.`,
        );
      }
      if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) {
        throw new RelatedNotesEvaluationError(`Invalid candidate score for ${source}.`);
      }
      seen.add(candidate.targetPath);
      if (!directPairs.has(evaluationPairKey(source, candidate.targetPath)))
        normalized.push(candidate);
    }
    rankings.set(source, normalized);
  }

  const relevant = (rating: EvaluationRating) => rating.rating >= RELATED_NOTES_RELEVANT_RATING;
  const precisionAt = (k: number): number => {
    let returned = 0;
    let useful = 0;
    for (const [source, candidates] of rankings) {
      for (const candidate of candidates.slice(0, k)) {
        returned += 1;
        if (relevant(requiredRating(ratings, source, candidate.targetPath))) useful += 1;
      }
    }
    return ratio(useful, returned);
  };
  const recallAt = (k: number): number => {
    let eligible = 0;
    let found = 0;
    for (const source of notePaths) {
      for (const target of notePaths) {
        if (source === target || directPairs.has(evaluationPairKey(source, target))) continue;
        const rating = requiredRating(ratings, source, target);
        if (!relevant(rating)) continue;
        eligible += 1;
        if (rankOf(rankings, source, target, k) !== undefined) found += 1;
      }
    }
    return ratio(found, eligible);
  };

  const perSource: PerSourceEvaluation[] = [];
  let reciprocalRankTotal = 0;
  let reciprocalRankSources = 0;
  let ndcgTotal = 0;
  let ndcgSources = 0;
  let sourcesWithRelevantCandidateAt10 = 0;
  let sourcesWithEligibleRelevantPairs = 0;
  let sourcesWithNoSuggestions = 0;
  const falsePositivesAt10: FalsePositiveDiagnostic[] = [];
  for (const source of [...notePaths].sort()) {
    const candidates = rankings.get(source) ?? [];
    if (candidates.length === 0) sourcesWithNoSuggestions += 1;
    const eligibleRatings = [...notePaths]
      .filter((target) => target !== source && !directPairs.has(evaluationPairKey(source, target)))
      .map((target) => requiredRating(ratings, source, target));
    const eligibleRelevant = eligibleRatings.filter(relevant);
    if (eligibleRelevant.length > 0) sourcesWithEligibleRelevantPairs += 1;
    const top10 = candidates.slice(0, 10);
    const foundAt10 = top10.filter((candidate) =>
      relevant(requiredRating(ratings, source, candidate.targetPath)),
    ).length;
    if (foundAt10 > 0) sourcesWithRelevantCandidateAt10 += 1;
    if (eligibleRelevant.length > 0) {
      reciprocalRankSources += 1;
      const firstRelevant = top10.findIndex((candidate) =>
        relevant(requiredRating(ratings, source, candidate.targetPath)),
      );
      reciprocalRankTotal += firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1);
      const idealRatings = eligibleRatings
        .map((rating) => rating.rating)
        .sort((a, b) => b - a)
        .slice(0, 10);
      const actualRatings = top10.map(
        (candidate) => requiredRating(ratings, source, candidate.targetPath).rating,
      );
      ndcgTotal += ratio(discountedGain(actualRatings), discountedGain(idealRatings));
      ndcgSources += 1;
    }
    const missed = eligibleRelevant
      .filter((rating) => rankOf(rankings, source, otherPath(rating, source), 10) === undefined)
      .map((rating) => ({
        target: otherPath(rating, source),
        rating: rating.rating,
        annotations: rating.annotations,
      }));
    const sourceFalsePositives = top10.flatMap((candidate, index) => {
      const rating = requiredRating(ratings, source, candidate.targetPath);
      if (rating.rating !== 0) return [];
      const diagnostic: FalsePositiveDiagnostic = {
        source,
        target: candidate.targetPath,
        rank: index + 1,
        score: candidate.score,
        annotations: rating.annotations,
      };
      falsePositivesAt10.push(diagnostic);
      return [{ target: candidate.targetPath, rank: index + 1, score: candidate.score }];
    });
    perSource.push({
      sourcePath: source,
      eligibleRelevantPairs: eligibleRelevant.length,
      foundAt10,
      recallAt10: eligibleRelevant.length ? round(foundAt10 / eligibleRelevant.length) : null,
      candidateCount: candidates.length,
      missed,
      falsePositives: sourceFalsePositives,
    });
  }

  const eligiblePairRatings = corpus.ratings.filter(
    (rating) => !directPairs.has(evaluationPairKey(rating.source, rating.target)),
  );
  const directRelevant = corpus.ratings.filter(
    (rating) =>
      relevant(rating) && directPairs.has(evaluationPairKey(rating.source, rating.target)),
  );
  const semanticGap = eligiblePairRatings.filter(
    (rating) => relevant(rating) && rating.annotations.includes("semantic-gap"),
  );
  const semanticGapFound = semanticGap.filter((rating) => pairFoundAt(rankings, rating, 10));
  const hardNegative = eligiblePairRatings.filter((rating) =>
    rating.annotations.includes("hard-negative"),
  );
  const hardNegativeFound = hardNegative.filter((rating) => pairFoundAt(rankings, rating, 10));
  const rating3 = eligiblePairRatings.filter((rating) => rating.rating === 3);
  const rating3Found = rating3.filter((rating) => pairFoundAt(rankings, rating, 10));
  const rating3Misses = rating3
    .filter((rating) => !pairFoundAt(rankings, rating, 10))
    .map((rating) => {
      const fullRank = bestPairRank(rankings, rating, Number.MAX_SAFE_INTEGER);
      return pairDiagnostic(
        rating,
        rankings,
        fullRank === undefined ? "no-candidate-or-below-threshold" : "ranked-below-10",
      );
    });
  const rankingFailures = eligiblePairRatings
    .filter((rating) => relevant(rating))
    .filter((rating) => {
      const rank = bestPairRank(rankings, rating, Number.MAX_SAFE_INTEGER);
      return rank !== undefined && rank > 5;
    })
    .map((rating) => {
      const rank = bestPairRank(rankings, rating, Number.MAX_SAFE_INTEGER);
      return pairDiagnostic(
        rating,
        rankings,
        rank && rank > 10 ? "ranked-below-10" : "ranked-below-5",
      );
    });
  const thresholdOrNoEvidenceFailures = eligiblePairRatings
    .filter((rating) => relevant(rating) && !pairFoundAt(rankings, rating, Number.MAX_SAFE_INTEGER))
    .map((rating) => pairDiagnostic(rating, rankings, "no-candidate-or-below-threshold"));

  return {
    evaluationVersion: RELATED_NOTES_EVALUATION_VERSION,
    producer,
    corpus: {
      noteCount: corpus.notes.length,
      ratedPairCount: corpus.ratings.length,
      exhaustive: true,
      relevantThreshold: RELATED_NOTES_RELEVANT_RATING,
    },
    metrics: {
      precisionAt3: precisionAt(3),
      precisionAt5: precisionAt(5),
      precisionAt10: precisionAt(10),
      recallAt5: recallAt(5),
      recallAt10: recallAt(10),
      meanReciprocalRank: round(ratio(reciprocalRankTotal, reciprocalRankSources)),
      ndcgAt10: round(ratio(ndcgTotal, ndcgSources)),
      rating3RecallAt10: ratio(rating3Found.length, rating3.length),
    },
    coverage: {
      sourcesEvaluated: corpus.notes.length,
      sourcesWithEligibleRelevantPairs,
      sourcesWithRelevantCandidateAt10,
      sourcesWithNoSuggestions,
    },
    subsets: {
      semanticGap: {
        total: semanticGap.length,
        recoveredAt10: semanticGapFound.length,
        recallAt10: ratio(semanticGapFound.length, semanticGap.length),
      },
      hardNegative: {
        total: hardNegative.length,
        surfacedAt10: hardNegativeFound.length,
        falsePositiveRateAt10: ratio(hardNegativeFound.length, hardNegative.length),
      },
    },
    directLinks: {
      relevantPairsSuppressedByPolicy: directRelevant.length,
      pairs: directRelevant.map((rating) => pairDiagnostic(rating, rankings)),
    },
    diagnostics: {
      falsePositiveCountAt10: falsePositivesAt10.length,
      rating3Misses,
      falsePositivesAt10,
      rankingFailures,
      thresholdOrNoEvidenceFailures,
      limits: {
        corpusCanHitPostingLimit: corpus.notes.length > RELATED_NOTES_MAX_POSTINGS,
        corpusCanHitCandidatePoolLimit: corpus.notes.length - 1 > RELATED_NOTES_MAX_CANDIDATE_POOL,
        ...(input.productionStats ? { productionStats: input.productionStats } : {}),
      },
    },
    perSource,
  };
}

export function formatRelatedNotesEvaluationReport(report: RelatedNotesEvaluationReport): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    `AREPO related-note evaluation (${report.producer})`,
    `Corpus: ${report.corpus.noteCount} notes, ${report.corpus.ratedPairCount} exhaustive unordered ratings`,
    `P@3 ${percent(report.metrics.precisionAt3)}  P@5 ${percent(report.metrics.precisionAt5)}  P@10 ${percent(report.metrics.precisionAt10)}`,
    `R@5 ${percent(report.metrics.recallAt5)}  R@10 ${percent(report.metrics.recallAt10)}  MRR ${report.metrics.meanReciprocalRank.toFixed(3)}  NDCG@10 ${report.metrics.ndcgAt10.toFixed(3)}`,
    `Rating-3 recall@10: ${percent(report.metrics.rating3RecallAt10)}`,
    `Semantic gap: ${report.subsets.semanticGap.recoveredAt10}/${report.subsets.semanticGap.total} recovered (${percent(report.subsets.semanticGap.recallAt10)})`,
    `Hard negatives: ${report.subsets.hardNegative.surfacedAt10}/${report.subsets.hardNegative.total} surfaced (${percent(report.subsets.hardNegative.falsePositiveRateAt10)})`,
    `Direct relevant pairs suppressed by policy: ${report.directLinks.relevantPairsSuppressedByPolicy}`,
    `Coverage: ${report.coverage.sourcesWithRelevantCandidateAt10}/${report.coverage.sourcesWithEligibleRelevantPairs} sources with eligible relevance recovered; ${report.coverage.sourcesWithNoSuggestions} sources with no suggestions`,
    `Top-10 rating-0 false positives: ${report.diagnostics.falsePositiveCountAt10}`,
    `Important rating-3 misses: ${report.diagnostics.rating3Misses.length}`,
    `Ranking failures below top 5: ${report.diagnostics.rankingFailures.length}`,
    `No-candidate/below-threshold relevant misses: ${report.diagnostics.thresholdOrNoEvidenceFailures.length}`,
    `Posting/pool caps applicable: ${report.diagnostics.limits.corpusCanHitPostingLimit || report.diagnostics.limits.corpusCanHitCandidatePoolLimit ? "yes" : "no"}`,
  ];
  if (report.diagnostics.rating3Misses.length) {
    lines.push("Rating-3 misses:");
    for (const miss of report.diagnostics.rating3Misses) {
      lines.push(`  ${miss.source} <> ${miss.target}`);
    }
  }
  if (report.diagnostics.falsePositivesAt10.length) {
    lines.push("Top rating-0 false positives:");
    for (const failure of report.diagnostics.falsePositivesAt10.slice(0, 10)) {
      lines.push(
        `  ${failure.source} -> ${failure.target} (rank ${failure.rank}, score ${failure.score.toFixed(3)})`,
      );
    }
  }
  lines.push("Per-source diagnostics:");
  for (const source of report.perSource) {
    lines.push(
      `  ${source.sourcePath}: relevant ${source.eligibleRelevantPairs}, found@10 ${source.foundAt10}, candidates ${source.candidateCount}`,
    );
    for (const miss of source.missed) {
      lines.push(`    miss: ${miss.target} (rating ${miss.rating})`);
    }
    for (const failure of source.falsePositives) {
      lines.push(
        `    false positive: ${failure.target} (rank ${failure.rank}, score ${failure.score.toFixed(3)})`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function evaluationPairKey(left: string, right: string): string {
  return left.localeCompare(right) < 0 ? `${left}\0${right}` : `${right}\0${left}`;
}

function requiredRating(
  ratings: ReadonlyMap<string, EvaluationRating>,
  source: string,
  target: string,
): EvaluationRating {
  const rating = ratings.get(evaluationPairKey(source, target));
  if (!rating) throw new RelatedNotesEvaluationError(`Missing rating for ${source} <> ${target}.`);
  return rating;
}

function otherPath(rating: EvaluationRating, source: string): string {
  return rating.source === source ? rating.target : rating.source;
}

function rankOf(
  rankings: ReadonlyMap<string, readonly EvaluationCandidate[]>,
  source: string,
  target: string,
  k: number,
): number | undefined {
  const index = (rankings.get(source) ?? [])
    .slice(0, k)
    .findIndex((item) => item.targetPath === target);
  return index < 0 ? undefined : index + 1;
}

function bestPairRank(
  rankings: ReadonlyMap<string, readonly EvaluationCandidate[]>,
  rating: EvaluationRating,
  k: number,
): number | undefined {
  const forward = rankOf(rankings, rating.source, rating.target, k);
  const reverse = rankOf(rankings, rating.target, rating.source, k);
  if (forward === undefined) return reverse;
  if (reverse === undefined) return forward;
  return Math.min(forward, reverse);
}

function pairFoundAt(
  rankings: ReadonlyMap<string, readonly EvaluationCandidate[]>,
  rating: EvaluationRating,
  k: number,
): boolean {
  return bestPairRank(rankings, rating, k) !== undefined;
}

function pairDiagnostic(
  rating: EvaluationRating,
  rankings: ReadonlyMap<string, readonly EvaluationCandidate[]>,
  category?: PairDiagnostic["category"],
): PairDiagnostic {
  const bestRank = bestPairRank(rankings, rating, Number.MAX_SAFE_INTEGER);
  return {
    source: rating.source,
    target: rating.target,
    rating: rating.rating,
    annotations: rating.annotations,
    ...(bestRank === undefined ? {} : { bestRank }),
    ...(category ? { category } : {}),
  };
}

function discountedGain(ratings: number[]): number {
  return ratings.reduce(
    (total, rating, index) => total + (2 ** rating - 1) / Math.log2(index + 2),
    0,
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function isRelativeMarkdownPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.toLowerCase().endsWith(".md") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
