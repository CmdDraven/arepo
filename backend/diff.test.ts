import test from "node:test";
import assert from "node:assert/strict";
import { buildLineDiff } from "../src/lib/vault/diff.js";

test("line diff reports unchanged lines", () => {
  assert.deepEqual(buildLineDiff("same", "same"), [{ kind: "equal", left: "same", right: "same" }]);
});

test("line diff reports added lines", () => {
  assert.deepEqual(buildLineDiff("one", "one\ntwo"), [
    { kind: "equal", left: "one", right: "one" },
    { kind: "added", right: "two" },
  ]);
});

test("line diff reports removed lines", () => {
  assert.deepEqual(buildLineDiff("one\ntwo", "one"), [
    { kind: "equal", left: "one", right: "one" },
    { kind: "removed", left: "two" },
  ]);
});

test("line diff reports changed lines", () => {
  assert.deepEqual(buildLineDiff("one\nold\nthree", "one\nnew\nthree"), [
    { kind: "equal", left: "one", right: "one" },
    { kind: "changed", left: "old", right: "new" },
    { kind: "equal", left: "three", right: "three" },
  ]);
});
