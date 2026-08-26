import test from "node:test";
import assert from "node:assert/strict";

import { chatExportSearchTextFromSource } from "./chatExport.ts";
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

test("local search finds failed files by metadata and searches only loaded bodies", () => {
  const partialDocuments: LocalFileSearchDocument[] = [
    ...documents,
    {
      path: "Reference/unreadable.txt",
      title: "unreadable.txt",
      kind: "plain-text",
      tags: [],
      content: null,
    },
  ];

  assert.deepEqual(searchLocalFiles(partialDocuments, "unreadable"), [
    {
      path: "Reference/unreadable.txt",
      title: "unreadable.txt",
      kind: "plain-text",
      inName: true,
      inBody: false,
      inTags: false,
    },
  ]);
  assert.equal(searchLocalFiles(partialDocuments, "Markdown body")?.[0]?.path, "Notes/hello.md");
  assert.deepEqual(searchLocalFiles(partialDocuments, "missing body token"), []);
});

test("chat search uses structured V1 fields and raw fallback for malformed chats", () => {
  const validSource = JSON.stringify({
    format: "arepo-chat-export",
    version: 1,
    conversation: { id: "conv-search", title: "Launch Council" },
    messages: [
      {
        id: "msg-search",
        author: "Zoë",
        timestamp: "2026-08-24T10:00:00Z",
        text: "Distinctive nebula token",
        ignoredKey: "must-not-be-indexed",
      },
    ],
  });
  const chatDocuments: LocalFileSearchDocument[] = [
    {
      path: "Imports/conversation.arepo-chat.json",
      title: "conversation.arepo-chat.json",
      kind: "chat-json",
      tags: [],
      content: chatExportSearchTextFromSource(validSource),
    },
    {
      path: "Imports/malformed.arepo-chat.json",
      title: "malformed.arepo-chat.json",
      kind: "chat-json",
      tags: [],
      content: chatExportSearchTextFromSource('{"private":"raw-secret"'),
    },
  ];

  for (const query of ["Launch Council", "conv-search", "Zoë", "nebula", "msg-search"]) {
    assert.equal(searchLocalFiles(chatDocuments, query)?.[0]?.path, chatDocuments[0]?.path, query);
  }
  assert.deepEqual(searchLocalFiles(chatDocuments, "must-not-be-indexed"), []);
  assert.equal(searchLocalFiles(chatDocuments, "raw-secret")?.[0]?.path, chatDocuments[1]?.path);
  assert.equal(searchLocalFiles(chatDocuments, "malformed")?.[0]?.inName, true);
});

test("generic JSON search uses exact raw source and oversized state remains metadata-only", () => {
  const genericDocuments: LocalFileSearchDocument[] = [
    {
      path: "Imports/data.json",
      title: "data.json",
      kind: "generic-json",
      tags: [],
      content: '{\n  "mixed": [null, true, {"token":"raw-json-token"}]\n}\n',
    },
    {
      path: "Imports/oversized.json",
      title: "oversized.json",
      kind: "generic-json",
      tags: [],
      content: null,
    },
  ];

  assert.equal(
    searchLocalFiles(genericDocuments, "raw-json-token")?.[0]?.path,
    "Imports/data.json",
  );
  assert.deepEqual(searchLocalFiles(genericDocuments, "not-loaded-body"), []);
  assert.equal(searchLocalFiles(genericDocuments, "oversized")?.[0]?.inName, true);
});
