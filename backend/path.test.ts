import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeVaultPath, resolveInsideVault } from "./path.js";

test("normalizes safe vault file paths", () => {
  assert.equal(normalizeVaultPath("Notes/hello.md", "file"), "Notes/hello.md");
});

test("rejects path traversal and absolute paths", () => {
  assert.throws(() => normalizeVaultPath("../secret.md", "file"), /cannot be/);
  assert.throws(() => normalizeVaultPath("/tmp/secret.md", "file"), /Absolute/);
  assert.throws(() => normalizeVaultPath("Notes//hello.md", "file"), /Duplicate/);
  assert.throws(() => normalizeVaultPath("Notes/hello.txt", "file"), /\.md/);
});

test("resolved paths must remain inside the vault root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-path-"));
  assert.equal(resolveInsideVault(root, "safe.md"), path.join(root, "safe.md"));
  assert.throws(
    () => resolveInsideVault(root, "../outside.md"),
    /escapes the configured vault root/,
  );
});
