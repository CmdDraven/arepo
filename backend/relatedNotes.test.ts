import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { deriveMarkdownSource } from "../src/lib/vault/indexer.js";
import {
  deriveRelatedNotesCorpus,
  RELATED_NOTES_TOP_K,
  type RelatedNotesSource,
} from "./relatedNotes.js";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function source(
  path: string,
  content: string,
  resolvedOutgoingPaths: string[] = [],
): RelatedNotesSource {
  return {
    path,
    sourceHash: hash(content),
    content,
    note: deriveMarkdownSource(path, content),
    resolvedOutgoingPaths,
  };
}

function candidates(sources: RelatedNotesSource[], sourcePath: string) {
  return (
    deriveRelatedNotesCorpus(sources, hash("corpus"), "2026-01-01T00:00:00.000Z").results.get(
      sourcePath,
    )?.candidates ?? []
  );
}

test("related notes combine structural and lexical evidence with bounded scores", () => {
  const sources = [
    source(
      "a.md",
      "---\ntitle: Filesystem races\ntags: [filesystem]\n---\n# Race conditions\nCanonical path replacement and file identity checks.",
      ["c.md", "d.md"],
    ),
    source(
      "deep/b.md",
      "---\ntitle: Filesystem replacement\ntags: [filesystem]\n---\n# Race conditions and safe paths\nPath replacement needs canonical file identity checks.",
      ["c.md", "d.md"],
    ),
    source("c.md", "# Transactions\nDurable journal."),
    source("d.md", "# Handles\nOpen descriptor lifecycle."),
  ];
  const candidate = candidates(sources, "a.md").find((entry) => entry.targetPath === "deep/b.md");
  assert.ok(candidate);
  assert.equal(candidate.score > 0 && candidate.score <= 1, true);
  assert.deepEqual(
    candidate.evidence.map((entry) => entry.kind),
    [
      "tag-overlap",
      "title-term-overlap",
      "heading-term-overlap",
      "common-neighbours",
      "lexical-similarity",
    ],
  );
  assert.equal(
    candidate.evidence.every((entry) => Number.isFinite(entry.score)),
    true,
  );
});

test("lexical similarity can find an unlinked relation without structural evidence", () => {
  const sources = [
    source(
      "optimistic.md",
      "# Alpha\nOptimistic writes reject a stale version before concurrent updates.",
    ),
    source(
      "updates.md",
      "# Beta\nA stale version check protects concurrent updates and rejects lost writes.",
    ),
    source("garden.md", "# Gamma\nRosemary cuttings prefer sandy soil and careful propagation."),
  ];
  const result = candidates(sources, "optimistic.md");
  assert.equal(result[0]?.targetPath, "updates.md");
  assert.deepEqual(
    result[0]?.evidence.map((entry) => entry.kind),
    ["lexical-similarity"],
  );
  assert.equal(
    result.some((entry) => entry.targetPath === "garden.md"),
    false,
  );
});

test("stop words and generic Notes titles do not create candidates", () => {
  const sources = [
    source("one.md", "---\ntitle: Notes\n---\n# First\nThe and this is with those."),
    source("two.md", "---\ntitle: Notes\n---\n# Second\nThis and the is with those."),
  ];
  assert.deepEqual(candidates(sources, "one.md"), []);
});

test("any direct link direction suppresses inferred suggestions", () => {
  const a = source("a.md", "# Shared system\ncanonical conflict version", ["b.md"]);
  const b = source("b.md", "# Shared system\ncanonical conflict version");
  assert.deepEqual(candidates([a, b], "a.md"), []);
  assert.deepEqual(candidates([a, b], "b.md"), []);
  assert.deepEqual(
    candidates(
      [
        { ...a, resolvedOutgoingPaths: [] },
        { ...b, resolvedOutgoingPaths: ["a.md"] },
      ],
      "a.md",
    ),
    [],
  );
  assert.deepEqual(candidates([a, { ...b, resolvedOutgoingPaths: ["a.md"] }], "b.md"), []);
});

test("shared tag and common neighbour each provide explainable evidence", () => {
  const tags = candidates(
    [
      source("a.md", "---\ntags: [filesystem]\n---\n# A\nalpha"),
      source("b.md", "---\ntags: [filesystem]\n---\n# B\nbeta"),
    ],
    "a.md",
  );
  assert.equal(tags[0]?.evidence[0]?.kind, "tag-overlap");

  const neighbours = candidates(
    [
      source("x/a.md", "# A\nalpha", ["target.md"]),
      source("y/a.md", "# B\nbeta", ["target.md"]),
      source("target.md", "# Target\nunique"),
    ],
    "x/a.md",
  );
  assert.equal(neighbours[0]?.targetPath, "y/a.md");
  assert.equal(neighbours[0]?.evidence[0]?.kind, "common-neighbours");
});

test("nested paths and duplicate basenames remain distinct identities", () => {
  const result = candidates(
    [
      source("project-a/index.md", "# Alpha\ncanonical transaction journal"),
      source("project-b/index.md", "# Beta\ncanonical transaction journal"),
    ],
    "project-a/index.md",
  );
  assert.equal(result[0]?.targetPath, "project-b/index.md");
});

test("ordering and serialized evidence are deterministic with path tie-breaking", () => {
  const sources = [
    source("source.md", "---\ntags: [shared]\n---\n# Source\nalpha"),
    source("z.md", "---\ntags: [shared]\n---\n# Zed\nbeta"),
    source("a.md", "---\ntags: [shared]\n---\n# Aye\ngamma"),
  ];
  const first = candidates(sources, "source.md");
  const second = candidates(sources.slice().reverse(), "source.md");
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((entry) => entry.targetPath),
    ["a.md", "z.md"],
  );
});

test("top K, self exclusion, evidence bounds, and sparse complexity remain bounded", () => {
  const sources = Array.from({ length: 40 }, (_, index) =>
    source(
      `folder-${index}/note.md`,
      `---\ntitle: item${index}\ntags: [cluster-${index % 4}]\n---\n# h${index}\nterm-${index % 4} unique-${index}`,
    ),
  );
  const derived = deriveRelatedNotesCorpus(sources, hash("medium"), "2026-01-01T00:00:00.000Z");
  for (const [sourcePath, result] of derived.results) {
    assert.equal(result.candidates.length <= RELATED_NOTES_TOP_K, true);
    assert.equal(
      result.candidates.some((entry) => entry.targetPath === sourcePath),
      false,
    );
    assert.equal(
      result.candidates.every((entry) =>
        entry.evidence.every((item) => {
          const values =
            "sharedTags" in item
              ? item.sharedTags
              : "sharedTerms" in item
                ? item.sharedTerms
                : item.paths;
          return values.length <= 8;
        }),
      ),
      true,
    );
  }
  const allPairs = (sources.length * (sources.length - 1)) / 2;
  assert.equal(derived.stats.candidatePairs < allPairs, true);
});
