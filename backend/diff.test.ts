import test from "node:test";
import assert from "node:assert/strict";
import { buildContextLineDiff, buildLineDiff, numberLineDiffRows } from "../src/lib/vault/diff.js";

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

test("context diff keeps changed lines with two lines of context", () => {
  const left = ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n");
  const right = ["one", "two", "three", "FOUR", "five", "six", "seven", "eight"].join("\n");
  const fullRows = numberLineDiffRows(buildLineDiff(left, right));

  assert.deepEqual(buildContextLineDiff(fullRows, 2), [
    { kind: "equal", left: "two", right: "two", leftLine: 2, rightLine: 2 },
    { kind: "equal", left: "three", right: "three", leftLine: 3, rightLine: 3 },
    { kind: "changed", left: "four", right: "FOUR", leftLine: 4, rightLine: 4 },
    { kind: "equal", left: "five", right: "five", leftLine: 5, rightLine: 5 },
    { kind: "equal", left: "six", right: "six", leftLine: 6, rightLine: 6 },
  ]);
});

test("context diff separates distant change hunks", () => {
  const left = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"].join("\n");
  const right = ["ONE", "two", "three", "four", "five", "six", "seven", "eight", "NINE"].join("\n");
  const fullRows = numberLineDiffRows(buildLineDiff(left, right));

  const contextRows = buildContextLineDiff(fullRows, 1);
  assert.equal(
    contextRows.some((row) => row.kind === "gap"),
    true,
  );
  assert.deepEqual(
    contextRows.map((row) => row.kind),
    ["changed", "equal", "gap", "equal", "changed"],
  );
});
