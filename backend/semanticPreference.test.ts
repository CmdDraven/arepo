import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeLegacyV2SemanticPreference,
  canonicalizeSemanticPreference,
  canonicalizeSemanticScope,
  renameSemanticScopePaths,
} from "./semanticPreference.js";

test("semantic preferences pin localhost and canonicalize selected Markdown paths", () => {
  const preference = canonicalizeSemanticPreference({
    enabled: true,
    provider: "ollama",
    endpoint: "http://localhost:11434/",
    model: "embed",
    scope: {
      mode: "selected",
      selectedPaths: ["ä.md", "z.md", "a.md", "a.md", "folder/B.md"],
    },
  });
  assert.deepEqual(preference, {
    enabled: true,
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "embed",
    scope: {
      mode: "selected",
      selectedPaths: ["a.md", "folder/B.md", "z.md", "ä.md"],
    },
  });
});

test("semantic scope rejects unsafe, non-Markdown, and over-bound selected paths", () => {
  for (const selectedPath of ["/absolute.md", "../escape.md", "note.txt", "C:\\note.md"]) {
    assert.equal(
      canonicalizeSemanticScope({ mode: "selected", selectedPaths: [selectedPath] }),
      null,
      selectedPath,
    );
  }
  assert.equal(
    canonicalizeSemanticScope({
      mode: "selected",
      selectedPaths: [`${"x".repeat(1022)}.md`],
    }),
    null,
  );
  assert.equal(
    canonicalizeSemanticScope({
      mode: "selected",
      selectedPaths: Array.from({ length: 10_001 }, (_, index) => `${index}.md`),
    }),
    null,
  );
});

test("legacy v2 semantic consent migrates to an empty Selected scope, never All", () => {
  assert.deepEqual(
    canonicalizeLegacyV2SemanticPreference({
      enabled: true,
      provider: "ollama",
      endpoint: "http://localhost:11434",
      model: "embed",
    }),
    {
      enabled: true,
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "embed",
      scope: { mode: "selected", selectedPaths: [] },
    },
  );
});

test("managed file and folder renames rewrite durable selections deterministically", () => {
  const source = {
    mode: "selected" as const,
    selectedPaths: ["docs/a.md", "docs/sub/b.md", "other.md"],
  };
  assert.deepEqual(renameSemanticScopePaths(source, "docs/a.md", "archive/a.md", "file"), {
    changed: true,
    scope: {
      mode: "selected",
      selectedPaths: ["archive/a.md", "docs/sub/b.md", "other.md"],
    },
  });
  assert.deepEqual(renameSemanticScopePaths(source, "docs", "archive", "folder"), {
    changed: true,
    scope: {
      mode: "selected",
      selectedPaths: ["archive/a.md", "archive/sub/b.md", "other.md"],
    },
  });
  assert.deepEqual(renameSemanticScopePaths(source, "unselected.md", "new.md", "file"), {
    changed: false,
    scope: source,
  });
  const all = {
    mode: "all" as const,
    selectedPaths: ["docs/a.md", "docs/sub/b.md", "other.md"],
  };
  assert.deepEqual(renameSemanticScopePaths(all, "docs/a.md", "archive/a.md", "file"), {
    changed: true,
    scope: {
      mode: "all",
      selectedPaths: ["archive/a.md", "docs/sub/b.md", "other.md"],
    },
  });
  assert.deepEqual(renameSemanticScopePaths(all, "docs", "archive", "folder"), {
    changed: true,
    scope: {
      mode: "all",
      selectedPaths: ["archive/a.md", "archive/sub/b.md", "other.md"],
    },
  });
  assert.deepEqual(renameSemanticScopePaths(all, "unselected.md", "new.md", "file"), {
    changed: false,
    scope: all,
  });
});
