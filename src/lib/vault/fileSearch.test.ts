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

test("chat search uses validated record fields and malformed chats remain filename-searchable", () => {
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
  assert.deepEqual(searchLocalFiles(chatDocuments, "raw-secret"), []);
  assert.equal(searchLocalFiles(chatDocuments, "malformed")?.[0]?.inName, true);
});
