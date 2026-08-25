import test from "node:test";
import assert from "node:assert/strict";

import {
  assembleIndex,
  buildIndex,
  deriveMarkdownSource,
  validate,
} from "../src/lib/vault/indexer.js";

test("source-local derivation plus global assembly preserves buildIndex semantics", () => {
  const files = {
    "Alpha.md": "---\nid: alpha\ntitle: Alpha\ntags: [one]\n---\n# Alpha\n\n[[Beta#target]]\n",
    "folder/Beta.md": "---\nid: beta\ntitle: Beta\n---\n# Beta\n\n## Target {#target}\n",
    "Duplicate.md": "---\nid: alpha\n---\n# Duplicate\n",
  };
  const excludedPaths = ["outside/Hidden.md"];
  const direct = buildIndex(files, { excludedPaths });
  const derivations = Object.fromEntries(
    Object.entries(files).map(([path, body]) => [path, deriveMarkdownSource(path, body)]),
  );
  const assembled = assembleIndex(derivations, { excludedPaths });

  assert.deepEqual(assembled, direct);
  assert.deepEqual(validate(assembled), validate(direct));
});

test("source-local derivation contains only body-local structural facts", () => {
  const derivative = deriveMarkdownSource(
    "folder/Note.md",
    "---\nid: note\ntitle: Note\ntags: [local]\n---\n# Note\n\n[[Target|Alias]]\n",
  );

  assert.equal(derivative.path, "folder/Note.md");
  assert.equal(derivative.frontmatter.id, "note");
  assert.deepEqual(derivative.tags, ["local"]);
  assert.equal(derivative.wikilinks[0]?.target, "Target");
  assert.equal(Object.hasOwn(derivative, "backlinks"), false);
  assert.equal(Object.hasOwn(derivative, "brokenLinks"), false);
  assert.equal(Object.hasOwn(derivative, "body"), false);
});
