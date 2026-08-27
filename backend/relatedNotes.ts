import { parseFrontmatter } from "../src/lib/vault/frontmatter.js";
import { stripCodeForIndexing, type NoteIndex } from "../src/lib/vault/indexer.js";
import type {
  RelatedNoteCandidate,
  RelatedNoteEvidence,
  RelatedNotesDerivedResponse,
} from "../src/lib/vault/enrichmentContracts.js";
import {
  RELATED_NOTES_DERIVATION_VERSION,
  RELATED_NOTES_PRODUCER,
  RELATED_NOTES_PRODUCER_VERSION,
} from "../src/lib/vault/enrichmentContracts.js";
import {
  BALANCED_RELATED_NOTES_SETTINGS,
  type ResolvedRelatedNotesSettings,
} from "../src/lib/vault/enrichmentPreferences.js";

export const RELATED_NOTES_TOP_K = 10;
export const RELATED_NOTES_MIN_SCORE = 0.1;
export const RELATED_NOTES_MIN_LEXICAL_ONLY_SCORE = 0.16;
export const RELATED_NOTES_MAX_EVIDENCE_ITEMS = 8;
export const RELATED_NOTES_MAX_UNIQUE_TERMS = 4_000;
export const RELATED_NOTES_MAX_POSTINGS = 128;
export const RELATED_NOTES_MAX_CANDIDATE_POOL = 512;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "no",
  "not",
  "note",
  "notes",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "will",
  "with",
  "you",
  "your",
]);

export type RelatedNotesSource = {
  path: string;
  sourceHash: string;
  content: string;
  note: NoteIndex;
  resolvedOutgoingPaths: string[];
};

export type RelatedNotesDerivationStats = {
  eligibleSources: number;
  candidatePairs: number;
  postingPairAttempts: number;
  lexicalTerms: number;
};

export type RelatedNotesCorpus = {
  results: Map<string, RelatedNotesDerivedResponse>;
  stats: RelatedNotesDerivationStats;
};

type PreparedSource = RelatedNotesSource & {
  tags: Set<string>;
  titleTerms: Set<string>;
  headingTerms: Set<string>;
  neighbours: Set<string>;
  termCounts: Map<string, number>;
  vector: Map<string, number>;
  norm: number;
};

type PairEvidence = {
  tags?: Set<string>;
  title?: Set<string>;
  headings?: Set<string>;
  neighbours?: Set<string>;
  lexicalDot: number;
  lexicalTerms: Map<string, number>;
};

export function deriveRelatedNotesCorpus(
  rawSources: RelatedNotesSource[],
  corpusHash: string,
  generatedAt = new Date().toISOString(),
  settings: ResolvedRelatedNotesSettings = BALANCED_RELATED_NOTES_SETTINGS,
): RelatedNotesCorpus {
  const sources = rawSources.slice().sort((a, b) => a.path.localeCompare(b.path));
  const documentFrequency = new Map<string, number>();
  const prepared: PreparedSource[] = sources.map((source) => {
    const termCounts = countTerms(normalizeLexicalBody(source.content));
    for (const term of termCounts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    return {
      ...source,
      tags: new Set(source.note.tags.flatMap(tokenize)),
      titleTerms: new Set(tokenize(source.note.title)),
      headingTerms: new Set(source.note.headings.flatMap((heading) => tokenize(heading.text))),
      neighbours: new Set(source.resolvedOutgoingPaths),
      termCounts,
      vector: new Map(),
      norm: 0,
    };
  });

  const maximumDocumentFrequency = Math.max(2, Math.floor(sources.length * 0.5));
  for (const source of prepared) {
    const weighted = [...source.termCounts.entries()]
      .filter(([, count]) => count > 0)
      .map(([term, count]) => {
        const df = documentFrequency.get(term) ?? 1;
        const idf = Math.log((sources.length + 1) / (df + 1)) + 1;
        return [term, (1 + Math.log(count)) * idf, df] as const;
      })
      .filter(([, , df]) => df <= maximumDocumentFrequency)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, RELATED_NOTES_MAX_UNIQUE_TERMS);
    source.vector = new Map(weighted.map(([term, weight]) => [term, weight]));
    source.norm = Math.sqrt(weighted.reduce((sum, [, weight]) => sum + weight * weight, 0));
  }

  const byPath = new Map(prepared.map((source) => [source.path, source]));
  const pairs = new Map<string, PairEvidence>();
  const pairCounts = new Map<string, number>();
  const getBoundedPair = (left: string, right: string): PairEvidence | undefined => {
    const key = pairKey(left, right);
    const existing = pairs.get(key);
    if (existing) return existing;
    if (
      (pairCounts.get(left) ?? 0) >= RELATED_NOTES_MAX_CANDIDATE_POOL ||
      (pairCounts.get(right) ?? 0) >= RELATED_NOTES_MAX_CANDIDATE_POOL
    )
      return undefined;
    const created = { lexicalDot: 0, lexicalTerms: new Map<string, number>() };
    pairs.set(key, created);
    pairCounts.set(left, (pairCounts.get(left) ?? 0) + 1);
    pairCounts.set(right, (pairCounts.get(right) ?? 0) + 1);
    return created;
  };
  let postingPairAttempts = 0;
  const directPairs = new Set<string>();
  for (const source of prepared) {
    for (const target of source.neighbours) {
      if (byPath.has(target)) directPairs.add(pairKey(source.path, target));
    }
  }

  const accumulateSetEvidence = (
    select: (source: PreparedSource) => Set<string>,
    field: "tags" | "title" | "headings" | "neighbours",
  ) => {
    const postings = invertedSets(prepared, select);
    for (const [value, indexes] of postings) {
      if (indexes.length > RELATED_NOTES_MAX_POSTINGS) continue;
      for (let left = 0; left < indexes.length; left += 1) {
        for (let right = left + 1; right < indexes.length; right += 1) {
          postingPairAttempts += 1;
          const a = prepared[indexes[left]];
          const b = prepared[indexes[right]];
          if (directPairs.has(pairKey(a.path, b.path))) continue;
          const evidence = getBoundedPair(a.path, b.path);
          if (!evidence) continue;
          (evidence[field] ??= new Set()).add(value);
        }
      }
    }
  };

  if (settings.evidence.tags.enabled) accumulateSetEvidence((source) => source.tags, "tags");
  if (settings.evidence.title.enabled)
    accumulateSetEvidence((source) => source.titleTerms, "title");
  if (settings.evidence.headings.enabled) {
    accumulateSetEvidence((source) => source.headingTerms, "headings");
  }
  if (settings.evidence.neighbours.enabled) {
    accumulateSetEvidence((source) => source.neighbours, "neighbours");
  }

  const lexicalPostings = new Map<string, Array<{ index: number; weight: number }>>();
  if (settings.evidence.lexical.enabled) {
    prepared.forEach((source, index) => {
      for (const [term, weight] of source.vector) {
        const entries = lexicalPostings.get(term) ?? [];
        entries.push({ index, weight });
        lexicalPostings.set(term, entries);
      }
    });
  }
  for (const [term, postings] of [...lexicalPostings.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (postings.length > RELATED_NOTES_MAX_POSTINGS) continue;
    for (let left = 0; left < postings.length; left += 1) {
      for (let right = left + 1; right < postings.length; right += 1) {
        postingPairAttempts += 1;
        const a = prepared[postings[left].index];
        const b = prepared[postings[right].index];
        if (directPairs.has(pairKey(a.path, b.path))) continue;
        const contribution = postings[left].weight * postings[right].weight;
        const evidence = getBoundedPair(a.path, b.path);
        if (!evidence) continue;
        evidence.lexicalDot += contribution;
        evidence.lexicalTerms.set(term, (evidence.lexicalTerms.get(term) ?? 0) + contribution);
      }
    }
  }

  const candidates = new Map<string, RelatedNoteCandidate[]>();
  for (const source of prepared) candidates.set(source.path, []);
  const entries = [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [key, evidence] of entries) {
    const [leftPath, rightPath] = splitPairKey(key);
    const left = byPath.get(leftPath);
    const right = byPath.get(rightPath);
    if (!left || !right) continue;
    const leftCandidate = materializeCandidate(left, right, evidence, settings);
    const rightCandidate = materializeCandidate(right, left, evidence, settings);
    if (leftCandidate) candidates.get(left.path)?.push(leftCandidate);
    if (rightCandidate) candidates.get(right.path)?.push(rightCandidate);
  }

  const results = new Map<string, RelatedNotesDerivedResponse>();
  for (const source of prepared) {
    const ranked = (candidates.get(source.path) ?? [])
      .sort((a, b) => b.score - a.score || a.targetPath.localeCompare(b.targetPath))
      .slice(0, settings.maximumSuggestions);
    results.set(source.path, {
      status: "ready",
      sourcePath: source.path,
      sourceHash: source.sourceHash,
      corpusHash,
      producer: RELATED_NOTES_PRODUCER,
      producerVersion: RELATED_NOTES_PRODUCER_VERSION,
      derivationVersion: RELATED_NOTES_DERIVATION_VERSION,
      generatedAt,
      candidates: ranked,
    });
  }
  return {
    results,
    stats: {
      eligibleSources: sources.length,
      candidatePairs: pairs.size,
      postingPairAttempts,
      lexicalTerms: lexicalPostings.size,
    },
  };
}

function materializeCandidate(
  source: PreparedSource,
  target: PreparedSource,
  pair: PairEvidence,
  settings: ResolvedRelatedNotesSettings,
): RelatedNoteCandidate | undefined {
  const evidence: RelatedNoteEvidence[] = [];
  let total = 0;
  const addSet = (
    values: Set<string> | undefined,
    sourceValues: Set<string>,
    targetValues: Set<string>,
    weight: number,
    create: (score: number, shared: string[]) => RelatedNoteEvidence,
  ) => {
    if (!values?.size) return;
    const score = jaccardFromIntersection(values.size, sourceValues.size, targetValues.size);
    total += score * weight;
    evidence.push(create(score, [...values].sort().slice(0, RELATED_NOTES_MAX_EVIDENCE_ITEMS)));
  };
  addSet(
    pair.tags,
    source.tags,
    target.tags,
    settings.evidence.tags.effectiveWeight,
    (score, sharedTags) => ({
      kind: "tag-overlap",
      score,
      sharedTags,
    }),
  );
  addSet(
    pair.title,
    source.titleTerms,
    target.titleTerms,
    settings.evidence.title.effectiveWeight,
    (score, sharedTerms) => ({
      kind: "title-term-overlap",
      score,
      sharedTerms,
    }),
  );
  addSet(
    pair.headings,
    source.headingTerms,
    target.headingTerms,
    settings.evidence.headings.effectiveWeight,
    (score, sharedTerms) => ({
      kind: "heading-term-overlap",
      score,
      sharedTerms,
    }),
  );
  addSet(
    pair.neighbours,
    source.neighbours,
    target.neighbours,
    settings.evidence.neighbours.effectiveWeight,
    (score, paths) => ({
      kind: "common-neighbours",
      score,
      paths,
    }),
  );
  const lexicalScore =
    source.norm > 0 && target.norm > 0
      ? Math.min(1, pair.lexicalDot / (source.norm * target.norm))
      : 0;
  if (lexicalScore > 0 && settings.evidence.lexical.enabled) {
    total += lexicalScore * settings.evidence.lexical.effectiveWeight;
    const sharedTerms = [...pair.lexicalTerms.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, RELATED_NOTES_MAX_EVIDENCE_ITEMS)
      .map(([term]) => term);
    evidence.push({ kind: "lexical-similarity", score: round(lexicalScore), sharedTerms });
  }
  const lexicalOnly = evidence.length === 1 && evidence[0]?.kind === "lexical-similarity";
  if (total < settings.minimumScore) return undefined;
  if (lexicalOnly && lexicalScore < settings.lexicalOnlyMinimumScore) return undefined;
  return {
    targetPath: target.path,
    targetHash: target.sourceHash,
    title: target.note.title,
    score: round(Math.min(1, total)),
    evidence: evidence.map((item) => ({ ...item, score: round(item.score) })),
  };
}

export function tokenize(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("en-US");
  return (normalized.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [])
    .map((token) => token.replace(/^[-_]+|[-_]+$/g, ""))
    .filter((token) => token.length >= 2 && token.length <= 48)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !/^[0-9a-f]{24,}$/i.test(token));
}

function normalizeLexicalBody(content: string): string {
  const { body } = parseFrontmatter(content);
  return stripCodeForIndexing(body)
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, "$2 $1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\p{P}\p{S}]+/gu, " ");
}

function countTerms(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of tokenize(value)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

function invertedSets(
  sources: PreparedSource[],
  select: (source: PreparedSource) => Set<string>,
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  sources.forEach((source, index) => {
    for (const value of [...select(source)].sort()) {
      const entries = result.get(value) ?? [];
      entries.push(index);
      result.set(value, entries);
    }
  });
  return new Map([...result.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function pairKey(left: string, right: string): string {
  return left.localeCompare(right) < 0 ? `${left}\0${right}` : `${right}\0${left}`;
}

function splitPairKey(key: string): [string, string] {
  const index = key.indexOf("\0");
  return [key.slice(0, index), key.slice(index + 1)];
}

function jaccardFromIntersection(intersection: number, left: number, right: number): number {
  const union = left + right - intersection;
  return union > 0 ? intersection / union : 0;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
