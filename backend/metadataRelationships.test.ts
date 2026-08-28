import assert from "node:assert/strict";
import test from "node:test";

import { buildVaultInspectResponse } from "./indexInspect.js";
import { deriveRelatedNotesCorpus } from "./relatedNotes.js";
import { buildGraph } from "../src/lib/vault/graph.js";
import {
  buildIndex,
  countExplicitOutgoingRelationships,
  countIncomingExplicitRelationships,
  validate,
} from "../src/lib/vault/indexer.js";

const targetBody = "# Target\ncanonical transactions filesystem consistency recovery\n";

test("manually authored metadata is structural, incoming, deduplicated with body links, and provenance-aware", () => {
  const index = buildIndex({
    "Source.md":
      '---\ntitle: Source\nrelated:\n  - "[[folder/Target]]"\n---\n# Source\nSee [[folder/Target]] in prose.\n',
    "folder/Target.md": targetBody,
  });
  const outgoing = index.outgoingLinks["Source.md"] ?? [];
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0]?.targetPath, "folder/Target.md");
  assert.deepEqual(outgoing[0]?.origins, ["body", "metadata"]);
  assert.equal(index.backlinks["folder/Target.md"]?.[0]?.fromPath, "Source.md");
  assert.deepEqual(index.backlinks["folder/Target.md"]?.[0]?.origins, ["body", "metadata"]);
  assert.equal(index.orphanNotes.includes("Source.md"), false);
  assert.equal(index.orphanNotes.includes("folder/Target.md"), false);

  const graph = buildGraph(index, validate(index));
  assert.equal(
    graph.edges.filter((edge) => edge.source === "Source.md" && edge.target === "folder/Target.md")
      .length,
    1,
  );
  assert.deepEqual(graph.edges.find((edge) => edge.source === "Source.md")?.origins, [
    "body",
    "metadata",
  ]);

  const inspect = buildVaultInspectResponse({ index, issues: validate(index) }, "Source.md");
  assert.deepEqual(inspect.outgoingLinks[0]?.origins, ["body", "metadata"]);
  const incoming = buildVaultInspectResponse(
    { index, issues: validate(index) },
    "folder/Target.md",
  );
  assert.deepEqual(incoming.backlinks[0]?.origins, ["body", "metadata"]);
});

test("explicit relationship summaries count unique structural pairs across body and metadata origins", () => {
  const bodyOnly = buildIndex({ "A.md": "# A\n[[B]]\n", "B.md": "# B\n" });
  assert.equal(countExplicitOutgoingRelationships(bodyOnly, "A.md"), 1);
  assert.equal(countIncomingExplicitRelationships(bodyOnly, "B.md"), 1);

  const metadataOnly = buildIndex({
    "A.md": '---\nrelated:\n  - "[[B]]"\n---\n# A\n',
    "B.md": "# B\n",
  });
  assert.equal(countExplicitOutgoingRelationships(metadataOnly, "A.md"), 1);
  assert.equal(countIncomingExplicitRelationships(metadataOnly, "B.md"), 1);

  const duplicateOrigins = buildIndex({
    "A.md": '---\nrelated:\n  - "[[B]]"\n---\n# A\n[[B]] and [[B#heading]]\n',
    "B.md": "# B\n## Heading\n",
  });
  assert.equal(countExplicitOutgoingRelationships(duplicateOrigins, "A.md"), 1);
  assert.equal(countIncomingExplicitRelationships(duplicateOrigins, "B.md"), 1);

  const multipleTargets = buildIndex({
    "A.md": '---\nrelated:\n  - "[[B]]"\n  - "[[C]]"\n---\n# A\n[[B]]\n',
    "B.md": "# B\n",
    "C.md": "# C\n",
  });
  assert.equal(countExplicitOutgoingRelationships(multipleTargets, "A.md"), 2);
  assert.equal(countIncomingExplicitRelationships(multipleTargets, "B.md"), 1);
  assert.equal(countIncomingExplicitRelationships(multipleTargets, "C.md"), 1);

  const reciprocal = buildIndex({
    "A.md": '---\nrelated:\n  - "[[B]]"\n---\n# A\n',
    "B.md": '---\nrelated:\n  - "[[A]]"\n---\n# B\n',
  });
  assert.equal(countExplicitOutgoingRelationships(reciprocal, "A.md"), 1);
  assert.equal(countExplicitOutgoingRelationships(reciprocal, "B.md"), 1);
  assert.equal(countIncomingExplicitRelationships(reciprocal, "A.md"), 1);
  assert.equal(countIncomingExplicitRelationships(reciprocal, "B.md"), 1);
  const reciprocalGraph = buildGraph(reciprocal, validate(reciprocal));
  assert.equal(reciprocalGraph.edges.length, 1);
  assert.equal(reciprocalGraph.nodeById["A.md"]?.outgoingCount, 1);
  assert.equal(reciprocalGraph.nodeById["B.md"]?.outgoingCount, 1);

  const reciprocalBody = buildIndex({
    "A.md": "# A\n[[B]]\n",
    "B.md": "# B\n[[A]]\n",
  });
  assert.equal(buildGraph(reciprocalBody, validate(reciprocalBody)).edges.length, 2);

  const broken = buildIndex({
    "A.md": '---\nrelated:\n  - "[[missing]]"\n  - "[[missing]]"\n---\n# A\n',
  });
  assert.equal(countExplicitOutgoingRelationships(broken, "A.md"), 1);
  assert.equal(countIncomingExplicitRelationships(broken, "missing.md"), 0);
});

test("nested paths resolve exactly while duplicate basenames remain ambiguous", () => {
  const index = buildIndex({
    "Source.md": '---\nrelated:\n  - "[[one/duplicate]]"\n  - "[[duplicate]]"\n---\n# Source\n',
    "one/duplicate.md": "# One\n",
    "two/duplicate.md": "# Two\n",
  });
  assert.equal(index.outgoingLinks["Source.md"]?.[0]?.targetPath, "one/duplicate.md");
  assert.equal(index.outgoingLinks["Source.md"]?.[0]?.origins[0], "metadata");
  assert.equal(index.outgoingLinks["Source.md"]?.[1]?.status, "ambiguous");
  assert.ok(validate(index).some((issue) => issue.kind === "ambiguous-related-metadata"));
});

test("broken and unsupported metadata produce bounded metadata-specific issues", () => {
  const files = {
    "Broken.md": '---\nrelated:\n  - "[[missing/note]]"\n---\n# Broken\n',
    "Scalar.md": '---\nrelated: "[[Target]]"\n---\n# Scalar\n',
    "Object.md": "---\nrelated:\n  target: Target\n---\n# Object\n",
    "NonString.md": "---\nrelated:\n  - 42\n---\n# Non-string\n",
    "Alias.md": '---\nrelated:\n  - "[[Target|alias]]"\n---\n# Alias\n',
    "Anchor.md": '---\nrelated:\n  - "[[Target#heading]]"\n---\n# Anchor\n',
    "Text.md": '---\nrelated:\n  - "[[file.txt]]"\n---\n# Text\n',
    "External.md": '---\nrelated:\n  - "[[https://example.com]]"\n---\n# External\n',
    "Malformed.md": '---\nrelated:\n  - "[[Target]]"\n# no closing delimiter\n',
    "Target.md": "# Target\n",
  };
  const index = buildIndex(files);
  const issues = validate(index);
  assert.ok(
    issues.some((issue) => issue.path === "Broken.md" && issue.kind === "broken-related-metadata"),
  );
  for (const path of [
    "Scalar.md",
    "Object.md",
    "NonString.md",
    "Alias.md",
    "Anchor.md",
    "Text.md",
    "External.md",
    "Malformed.md",
  ]) {
    assert.ok(
      issues.some((issue) => issue.path === path && issue.kind === "invalid-related-metadata"),
      path,
    );
  }
  assert.equal(JSON.stringify(issues).includes("https://example.com"), false);
});

test("removing or changing manually authored metadata changes structural targets on rebuild", () => {
  const targets = { "A.md": "# A\n", "B.md": "# B\n", "C.md": "# C\n" };
  const withB = buildIndex({
    ...targets,
    "A.md": '---\nrelated:\n  - "[[B]]"\n---\n# A\n',
  });
  assert.equal(withB.outgoingLinks["A.md"]?.[0]?.targetPath, "B.md");
  const withC = buildIndex({
    ...targets,
    "A.md": '---\nrelated:\n  - "[[C]]"\n---\n# A\n',
  });
  assert.equal(withC.outgoingLinks["A.md"]?.[0]?.targetPath, "C.md");
  const removed = buildIndex(targets);
  assert.deepEqual(removed.outgoingLinks["A.md"], []);
});

test("metadata relationships suppress Related Notes symmetrically without entering scoring", () => {
  for (const declarationOwner of ["A.md", "B.md"] as const) {
    const files = {
      "A.md": `${declarationOwner === "A.md" ? '---\nrelated:\n  - "[[B]]"\n---\n' : ""}# A\ncanonical transactions filesystem consistency recovery\n`,
      "B.md": `${declarationOwner === "B.md" ? '---\nrelated:\n  - "[[A]]"\n---\n' : ""}${targetBody}`,
    };
    const index = buildIndex(files);
    const sources = Object.values(index.notes).map((note) => ({
      path: note.path,
      sourceHash: note.path === "A.md" ? "a".repeat(64) : "b".repeat(64),
      content: files[note.path as keyof typeof files],
      note,
      resolvedOutgoingPaths: (index.outgoingLinks[note.path] ?? []).flatMap((link) =>
        link.targetPath ? [link.targetPath] : [],
      ),
    }));
    const derived = deriveRelatedNotesCorpus(sources, "c".repeat(64));
    assert.deepEqual(derived.results.get("A.md")?.candidates, []);
    assert.deepEqual(derived.results.get("B.md")?.candidates, []);
  }
});
