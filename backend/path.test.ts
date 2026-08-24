import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeMarkdownFilePath,
  normalizeReadableTextFilePath,
  normalizeVaultFolderPath,
  resolveInsideVault,
} from "./path.js";

test("normalizes safe vault file paths", () => {
  assert.equal(normalizeMarkdownFilePath("Notes/hello.md"), "Notes/hello.md");
  assert.equal(normalizeReadableTextFilePath("Notes/hello.txt"), "Notes/hello.txt");
  assert.equal(normalizeReadableTextFilePath("Notes/HELLO.TXT"), "Notes/HELLO.TXT");
  assert.equal(normalizeVaultFolderPath("Notes"), "Notes");
});

test("rejects path traversal and absolute paths", () => {
  assert.throws(() => normalizeReadableTextFilePath("../secret.md"), /cannot be/);
  assert.throws(() => normalizeReadableTextFilePath("/tmp/secret.md"), /Absolute/);
  assert.throws(() => normalizeReadableTextFilePath("Notes//hello.md"), /Duplicate/);
  assert.throws(() => normalizeReadableTextFilePath("Notes/hello.json"), /\.md or \.txt/);
  assert.throws(() => normalizeMarkdownFilePath("Notes/hello.txt"), /\.md/);
});

test("resolved paths must remain inside the vault root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-path-"));
  assert.equal(resolveInsideVault(root, "safe.md"), path.join(root, "safe.md"));
  assert.throws(
    () => resolveInsideVault(root, "../outside.md"),
    /escapes the configured vault root/,
  );
});
