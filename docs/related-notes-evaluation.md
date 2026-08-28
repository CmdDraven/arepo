# Related-note evaluation

AREPO's related-note evaluation is a small offline engineering benchmark for
the deterministic Markdown enrichment producer. It asks whether suggestions
match human-reviewed synthetic usefulness judgments and provides a fixed
baseline for comparing a future optional semantic producer.

The labels are evaluation data, not training data. They never enter production
weights, thresholds, caches, user vaults, or ranking. The harness does not tune
the current producer.

Durable user Keep/Dismiss decisions are also excluded from this harness. The
locked baseline measures raw Balanced V1 producer output before presentation
filtering, so personal curation can neither improve nor degrade benchmark
metrics. The semantic experiment now runs only through a separately installed
loopback Ollama provider; no model dependency, runtime, vector, or asset is
bundled or retained by AREPO.

## Corpus and ratings

[`evaluation/related-notes-v1.json`](../evaluation/related-notes-v1.json) is a
versioned, synthetic, human-reviewed corpus. Version 1 contains 17 Markdown
notes and exhaustively rates all 136 unordered note pairs. Contents cover concurrency,
filesystem/path security, knowledge management, gardening, and publishing,
including semantic gaps and hard negatives.

Each rating is a compact tuple:

```json
["source/path.md", "target/path.md", 3, ["semantic-gap"], "Optional evaluator rationale"]
```

Annotations and rationale are optional. Paths are symmetric: reversing a pair
does not create a second judgment. The loader rejects unknown versions,
absolute or missing paths, self-pairs, duplicates, non-exhaustive matrices,
ratings outside 0–3, and invalid annotations.

The rubric is:

- **0 — unrelated:** no useful conceptual relationship; a suggestion is noise.
- **1 — weakly related:** some context or overlap, but not important enough to
  expect prominently.
- **2 — meaningfully related:** a clearly useful connection that AREPO should
  reasonably surface.
- **3 — strongly related:** a close, high-value relationship.

Ratings are human-reviewed synthetic judgments rather than objective truth. Ratings 2 and 3 are
treated as relevant for retrieval metrics. `semantic-gap` marks deliberately
low-vocabulary relevant pairs; `hard-negative` marks rating-0 pairs with
misleading shared vocabulary, generic titles, weak tags, or boilerplate.

V1 is now locked for future producer comparisons. A deliberate future human
review may create a new corpus version, but production scores must never rewrite
labels. Contents must remain synthetic or intentionally public test material;
never copy a private vault into the corpus.

## Running the baseline

```bash
npm run eval:related
npm run eval:related -- --json
```

The command builds the backend, loads and validates the corpus, assembles the
normal structural Markdown facts, resolves the explicit Balanced preset, and calls the same
`deriveRelatedNotesCorpus()` function used by production. It performs no
network or model calls and needs no temporary vault. Invalid corpus/harness
state exits nonzero; metric values are diagnostic and do not control the exit
status.

The text report contains aggregate and per-source diagnostics. `--json` emits
the same deterministic report shape for machine-readable comparison. Neither
form includes wall-clock timestamps.

## Metrics

- Precision@3, @5, and @10 are micro-precision over suggestions actually
  returned at each depth.
- Recall@5 and @10 use directional per-source retrieval opportunities.
- MRR averages the reciprocal rank of the first relevant suggestion across
  sources with eligible relevant pairs.
- NDCG@10 uses the original 0–3 grades with gain `2^rating - 1`.
- Coverage reports evaluated sources, sources with eligible relevance, sources
  recovering relevance, and sources receiving no suggestions.
- Rating-3 recall, semantic-gap recall, hard-negative surfacing, rating-0 false
  positives, and important misses expose specific failure modes.

Production deliberately omits any pair connected by a resolved direct link in
either direction. Relevant direct-link pairs are reported separately and are
excluded from inferred-recall denominators; their absence is not a retrieval
failure.

## Running the semantic experiment

The semantic experiment is intentionally separate from the deterministic
baseline and ordinary CI:

```bash
AREPO_OLLAMA_MODEL=<installed-embedding-model> npm run eval:semantic
```

`AREPO_OLLAMA_URL` may optionally select a normalized HTTP loopback origin; it
defaults to `http://127.0.0.1:11434`. The model must already exist in Ollama.
Exact `localhost` input is pinned to literal `127.0.0.1` before a request is
constructed; arbitrary hostname resolution is never used to establish
loopback equivalence.
AREPO does not install Ollama, pull models, invoke a CLI, or choose a model. A
missing model configuration or unreachable provider produces a bounded
unavailable/skipped result and modifies no files.

The evaluator uses versioned Markdown-only semantic text, requests bounded
embeddings through AREPO's provider abstraction, calculates cosine similarity
inside AREPO, excludes direct links under the same evaluation policy, and uses
code-unit path ordering for ties. It reports the same retrieval metrics plus
provider/model/digest/dimension and semantic producer/text provenance. It never
prints or persists vectors. The locked labels remain evaluation data only and
do not tune either producer.

The evaluator reports relevant pairs that rank below a requested cutoff
separately from pairs absent from the thresholded production rankings. Because
the production boundary returns only retained candidates, the latter category
is conservatively named `no-candidate-or-below-threshold`. The corpus is far
smaller than current posting-list and candidate-pool caps, so those bounds do
not affect this baseline.

## Current deterministic V1 baseline

The locked human-reviewed synthetic V1 baseline is:

| Metric                     | Deterministic V1 |
| -------------------------- | ---------------: |
| Precision@3                |            80.6% |
| Precision@5                |            78.9% |
| Precision@10               |            78.9% |
| Recall@5                   |            68.2% |
| Recall@10                  |            68.2% |
| MRR                        |            0.900 |
| NDCG@10                    |            0.710 |
| Rating-3 recall@10         |           100.0% |
| Semantic-gap recall@10     |            60.0% |
| Hard negatives surfaced@10 |              2/7 |

These figures are directional engineering evidence from a tiny synthetic
corpus, not statistically significant accuracy claims. They should not be used
to tune V1 against the benchmark.

The locked baseline has four directional rating-0 false positives. They are the
two unordered pairs `concurrency/transactions.md` ↔
`filesystem/canonical-paths.md` and `concurrency/version-checks.md` ↔
`knowledge/wikilinks.md`, each appearing from both source directions. Seven
relevant directional opportunities have no retained candidate or fall below
threshold:

- `concurrency/locking.md` → `filesystem/toctou.md`
- `concurrency/transactions.md` → `concurrency/version-checks.md`
- `concurrency/transactions.md` → `filesystem/atomic-rename.md`
- `filesystem/atomic-rename.md` → `filesystem/file-identity.md`
- `filesystem/atomic-rename.md` → `filesystem/toctou.md`
- `filesystem/canonical-paths.md` → `filesystem/toctou.md`
- `knowledge/note-discovery.md` → `knowledge/tags.md`

There are no rating-3 misses. These identities are evaluation evidence, not an
invitation to tune weights or labels against this small corpus.

## Future comparison

`evaluateRelatedCandidates()` accepts a producer name and a map of ranked
candidate identities. A future semantic producer can therefore be evaluated
against the same corpus without a registry or copied scoring implementation.
It should materially improve semantic-gap or strongly-related ranking while
preserving useful Precision@5 and hard-negative behavior. Any comparison must
report both producers honestly; evaluation labels must remain outside training
and runtime state. Production preferences are separate per-vault user choices
and never alter these checked-in judgments.
