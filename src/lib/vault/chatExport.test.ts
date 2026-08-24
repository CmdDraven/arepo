import test from "node:test";
import assert from "node:assert/strict";

import {
  chatExportSearchText,
  chatExportSearchTextFromSource,
  parseChatExportV1,
} from "./chatExport.ts";

test("parses minimal, titled, empty, ordered, Unicode V1 conversations", () => {
  const minimal = parseChatExportV1(
    JSON.stringify({
      format: "arepo-chat-export",
      version: 1,
      conversation: { id: "conv-min" },
      messages: [],
    }),
  );
  assert.deepEqual(minimal, {
    ok: true,
    data: {
      format: "arepo-chat-export",
      version: 1,
      conversation: { id: "conv-min" },
      messages: [],
    },
  });

  const titled = parseChatExportV1(
    JSON.stringify({
      format: "arepo-chat-export",
      version: 1,
      conversation: { id: "conv-1", title: "Launch discussion" },
      messages: [
        {
          id: "msg-2",
          author: "Zoë",
          timestamp: "2026-08-24T10:01:00+01:00",
          text: "Second — こんにちは",
        },
        {
          id: "msg-1",
          author: "Alice",
          timestamp: "2026-08-24T09:00:00Z",
          text: "First",
        },
      ],
    }),
  );
  assert.equal(titled.ok, true);
  if (!titled.ok) return;
  assert.equal(titled.data.conversation.title, "Launch discussion");
  assert.deepEqual(
    titled.data.messages.map((message) => message.id),
    ["msg-2", "msg-1"],
  );
  assert.equal(titled.data.messages[0]?.text, "Second — こんにちは");
  assert.match(chatExportSearchText(titled.data), /Launch discussion/);
  assert.match(chatExportSearchText(titled.data), /Zoë/);
  assert.match(chatExportSearchText(titled.data), /msg-1/);
});

test("accepts UTC and explicit numeric-offset timestamps", () => {
  for (const timestamp of ["2026-08-24T10:00:00Z", "2026-08-24T10:00:00.123-04:30"]) {
    const result = parseChatExportV1(validSource({ timestamp }));
    assert.equal(result.ok, true, timestamp);
    if (result.ok) assert.equal(result.data.messages[0]?.timestamp, timestamp);
  }
});

test("rejects malformed roots, format, version, and conversation fields", () => {
  const cases: Array<[string, string, string]> = [
    ["invalid JSON", "{private-body", "invalid-json"],
    ["array root", "[]", "invalid-root"],
    ["unsupported format", validSource({ format: "other" }), "unsupported-format"],
    ["unsupported version", validSource({ version: 2 }), "unsupported-version"],
    ["missing conversation id", validSource({ conversation: {} }), "missing-conversation-id"],
    [
      "blank conversation id",
      validSource({ conversation: { id: "   " } }),
      "missing-conversation-id",
    ],
    [
      "invalid conversation title",
      validSource({ conversation: { id: "conv", title: 42 } }),
      "invalid-conversation-title",
    ],
    ["messages not an array", validSource({ messages: {} }), "invalid-messages"],
  ];
  for (const [label, source, code] of cases) {
    const result = parseChatExportV1(source);
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.equal(result.error.code, code, label);
  }
});

test("rejects malformed records, empty and duplicate IDs, and invalid timestamps", () => {
  const cases: Array<[string, string]> = [
    [validSource({ messages: [null] }), "invalid-message"],
    [validSource({ id: "" }), "invalid-message"],
    [validSource({ id: "   " }), "invalid-message"],
    [validSource({ author: 42 }), "invalid-message"],
    [validSource({ text: null }), "invalid-message"],
    [
      validSource({
        messages: [message({ id: "same" }), message({ id: "same", text: "duplicate" })],
      }),
      "duplicate-message-id",
    ],
    [validSource({ timestamp: "not-a-date" }), "invalid-timestamp"],
    [validSource({ timestamp: "2026-08-24T10:00:00" }), "invalid-timestamp"],
    [validSource({ timestamp: "2026-02-30T10:00:00Z" }), "invalid-timestamp"],
  ];
  for (const [source, code] of cases) {
    const result = parseChatExportV1(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, code);
  }
});

test("ignores unknown fields without echoing or rewriting canonical source text", () => {
  const secret = "RAW-DOCUMENT-SECRET-DO-NOT-ECHO";
  const source = validSource({
    rootExtra: secret,
    conversation: { id: "conv", title: "Title", extra: { secret } },
    messages: [message({ extra: secret })],
  });
  const result = parseChatExportV1(source);

  assert.equal(result.ok, true);
  assert.equal(source.includes(secret), true);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("bounded parser failures never echo the source body", () => {
  const secret = "PRIVATE-BODY-TOKEN";
  const result = parseChatExportV1(`{${secret}`);

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  if (!result.ok) assert.ok(result.error.message.length < 160);
  assert.equal(chatExportSearchTextFromSource(`{${secret}`), null);
});

test("reparsing externally reloaded chat content transitions valid, invalid, and valid again", () => {
  const before = parseChatExportV1(validSource({ conversation: { id: "before" } }));
  const malformed = parseChatExportV1('{"format":"arepo-chat-export"');
  const recovered = parseChatExportV1(validSource({ conversation: { id: "after" } }));

  assert.equal(before.ok, true);
  assert.equal(malformed.ok, false);
  assert.equal(recovered.ok, true);
  if (recovered.ok) assert.equal(recovered.data.conversation.id, "after");
});

function validSource(overrides: Record<string, unknown> = {}): string {
  const base = {
    format: "arepo-chat-export",
    version: 1,
    conversation: { id: "conv-1" },
    messages: [message()],
  };
  const value = { ...base, ...overrides } as Record<string, unknown>;
  if (
    "id" in overrides ||
    "author" in overrides ||
    "timestamp" in overrides ||
    "text" in overrides
  ) {
    value.messages = [message(overrides)];
    delete value.id;
    delete value.author;
    delete value.timestamp;
    delete value.text;
  }
  return JSON.stringify(value);
}

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg-1",
    author: "Alice",
    timestamp: "2026-08-24T10:00:00Z",
    text: "Hello.",
    ...overrides,
  };
}
