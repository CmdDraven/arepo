import test from "node:test";
import assert from "node:assert/strict";
import { sourcePolicy } from "../src/lib/vault/sourcePolicy.js";

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
});
