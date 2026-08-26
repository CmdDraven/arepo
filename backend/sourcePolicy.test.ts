import test from "node:test";
import assert from "node:assert/strict";
import { sourceKindForPath, sourcePolicy } from "../src/lib/vault/sourcePolicy.js";

test("source policy is explicit for every supported source kind", () => {
  assert.deepEqual(sourcePolicy("markdown"), {
    mutable: true,
    contributesToMarkdownIndex: true,
  });
  assert.deepEqual(sourcePolicy("plain-text"), {
    mutable: false,
    contributesToMarkdownIndex: false,
  });
  assert.deepEqual(sourcePolicy("chat-json"), {
    mutable: false,
    contributesToMarkdownIndex: false,
  });
  assert.deepEqual(sourcePolicy("generic-json"), {
    mutable: false,
    contributesToMarkdownIndex: false,
  });
});

test("source classification preserves exact chat suffix precedence and extension policy", () => {
  const cases = [
    ["note.md", "markdown"],
    ["notes.txt", "plain-text"],
    ["chat.arepo-chat.json", "chat-json"],
    ["CHAT.AREPO-CHAT.JSON", "chat-json"],
    ["generic.json", "generic-json"],
    ["nested/mixed/data.JSON", "generic-json"],
    [".arepo-chat.json", "chat-json"],
    ["foo.arepo-chat.json.backup", null],
  ] as const;

  for (const [filePath, expected] of cases) {
    assert.equal(sourceKindForPath(filePath), expected, filePath);
  }
});
