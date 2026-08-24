import test from "node:test";
import assert from "node:assert/strict";

import { foldersFromFilePaths, indexedFoldersFromNotePaths } from "./tree.ts";

const fullFixturePaths = [
  "README.md",
  "Notes/note.md",
  "Reference/reference-note.md",
  "Notes/Nestest/note.md",
];

test("indexed tree folders include parents for all indexed fixture notes", () => {
  assert.deepEqual(indexedFoldersFromNotePaths(fullFixturePaths), [
    "Notes",
    "Notes/Nestest",
    "Reference",
  ]);
});

test("indexed tree folders exclude parents that only contain scoped-out notes", () => {
  const maxDepthOnePaths = ["README.md", "Notes/note.md", "Reference/reference-note.md"];
  assert.deepEqual(indexedFoldersFromNotePaths(maxDepthOnePaths), ["Notes", "Reference"]);
});

test("indexed tree folders preserve nested parents for minDepth two scope", () => {
  assert.deepEqual(indexedFoldersFromNotePaths(["Notes/Nestest/note.md"]), [
    "Notes",
    "Notes/Nestest",
  ]);
});

test("file tree folders include parents that contain plain-text files", () => {
  assert.deepEqual(foldersFromFilePaths(["Reference/raw/terms.txt", "README.md"]), [
    "Reference",
    "Reference/raw",
  ]);
});
