import test from "node:test";
import assert from "node:assert/strict";

import { searchLocalFiles, type LocalFileSearchDocument } from "./fileSearch.ts";

const documents: LocalFileSearchDocument[] = [
  {
    path: "Notes/hello.md",
    title: "Hello note",
    kind: "markdown",
    tags: ["project"],
    content: "Markdown body",
  },
  {
    path: "Reference/phrases.txt",
    title: "phrases.txt",
    kind: "plain-text",
    tags: [],
    content: "Zażółć gęślą jaźń — こんにちは",
  },
];

test("local content search returns plain-text files with their kind", () => {
  assert.deepEqual(searchLocalFiles(documents, "こんにちは"), [
    {
      path: "Reference/phrases.txt",
      title: "phrases.txt",
      kind: "plain-text",
      inName: false,
      inBody: true,
      inTags: false,
    },
  ]);
});

test("local search retains Markdown title, path, body, and tag matching", () => {
  assert.equal(searchLocalFiles(documents, "project")?.[0]?.kind, "markdown");
  assert.equal(searchLocalFiles(documents, "hello")?.[0]?.inName, true);
  assert.equal(searchLocalFiles(documents, "body")?.[0]?.inBody, true);
  assert.equal(searchLocalFiles(documents, "   "), null);
});
