import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { getMachineIndexResult } from "./indexCache.js";
import {
  getRelatedNotes,
  removeRelatedNotesCacheIfOwned,
  relatedNotesCachePath,
  relatedNotesCorpusHash,
} from "./relatedNotesCache.js";
import type { VaultInfo } from "./types.js";

async function makeVault(t: TestContext): Promise<{ cwd: string; vault: VaultInfo }> {
  const cwd = await makeTestTempDir(t, "arepo-related-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-related-vault-");
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: { nodeId: "local", displayName: "Local", mode: "local", apiVersion: 1 },
      appDataDir: "./app-data",
      vaults: [],
    }),
  );
  const vault: VaultInfo = {
    id: "related-test",
    displayName: "Related Test",
    rootPath,
    permissions: { readIndex: true, readContent: true, writeContent: true, deleteFiles: false },
  };
  await write(rootPath, "a.md", "# Alpha\ncanonical stale version conflict resolution");
  await write(rootPath, "b.md", "# Beta\ncanonical stale version conflict handling");
  await write(rootPath, "plain.txt", "canonical stale version conflict handling");
  await write(rootPath, "chat.arepo-chat.json", "{}\n");
  await write(rootPath, "data.json", "{}\n");
  return { cwd, vault };
}

async function write(root: string, relative: string, content: string): Promise<void> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

test("identical corpus reuses a body-free cache and non-Markdown changes do not invalidate it", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const machine = await getMachineIndexResult(vault, cwd);
  const first = await getRelatedNotes(vault, "a.md", machine, cwd);
  assert.equal(first.cacheStatus, "rebuilt");
  assert.equal(first.data.candidates[0]?.targetPath, "b.md");
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });
  let markdownOpens = 0;
  fs.open = (async (file, ...args) => {
    if (typeof file === "string" && file.startsWith(vault.rootPath) && file.endsWith(".md")) {
      markdownOpens += 1;
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;
  const cached = await getRelatedNotes(vault, "a.md", machine, cwd);
  fs.open = originalOpen;
  assert.equal(cached.cacheStatus, "hit");
  assert.equal(markdownOpens, 0);

  await write(vault.rootPath, "plain.txt", "changed non-Markdown body");
  const afterPlainText = await getRelatedNotes(
    vault,
    "a.md",
    await getMachineIndexResult(vault, cwd),
    cwd,
  );
  assert.equal(afterPlainText.cacheStatus, "hit");
  assert.equal(afterPlainText.data.corpusHash, first.data.corpusHash);

  const serialized = await fs.readFile(await relatedNotesCachePath(vault, cwd), "utf8");
  assert.equal(serialized.includes("canonical stale version conflict"), false);
  assert.equal(serialized.includes("plain.txt"), false);
  assert.equal(serialized.includes("chat.arepo-chat.json"), false);
  assert.equal(serialized.includes("data.json"), false);
});

test("body, inventory, removal, and rename transitions change corpus validity and candidates", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const initial = await getRelatedNotes(
    vault,
    "a.md",
    await getMachineIndexResult(vault, cwd),
    cwd,
  );
  assert.equal(
    initial.data.candidates.some((entry) => entry.targetPath === "b.md"),
    true,
  );

  await write(vault.rootPath, "b.md", "# Beta\nrosemary cuttings sandy soil propagation");
  const unrelated = await getRelatedNotes(
    vault,
    "a.md",
    await getMachineIndexResult(vault, cwd),
    cwd,
  );
  assert.notEqual(unrelated.data.corpusHash, initial.data.corpusHash);
  assert.equal(
    unrelated.data.candidates.some((entry) => entry.targetPath === "b.md"),
    false,
  );

  await write(vault.rootPath, "c.md", "# Gamma\ncanonical stale version conflict recovery");
  const added = await getRelatedNotes(vault, "a.md", await getMachineIndexResult(vault, cwd), cwd);
  assert.equal(
    added.data.candidates.some((entry) => entry.targetPath === "c.md"),
    true,
  );

  await fs.rename(path.join(vault.rootPath, "c.md"), path.join(vault.rootPath, "nested-c.md"));
  const renamed = await getRelatedNotes(
    vault,
    "a.md",
    await getMachineIndexResult(vault, cwd),
    cwd,
  );
  assert.equal(
    renamed.data.candidates.some((entry) => entry.targetPath === "c.md"),
    false,
  );
  assert.equal(
    renamed.data.candidates.some((entry) => entry.targetPath === "nested-c.md"),
    true,
  );

  await fs.unlink(path.join(vault.rootPath, "nested-c.md"));
  const removed = await getRelatedNotes(
    vault,
    "a.md",
    await getMachineIndexResult(vault, cwd),
    cwd,
  );
  assert.equal(
    removed.data.candidates.some((entry) => entry.targetPath === "nested-c.md"),
    false,
  );
});

test("malformed, legacy-version, and deleted caches rebuild safely", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const machine = await getMachineIndexResult(vault, cwd);
  await getRelatedNotes(vault, "a.md", machine, cwd);
  const file = await relatedNotesCachePath(vault, cwd);

  await fs.writeFile(file, "not json", "utf8");
  assert.equal((await getRelatedNotes(vault, "a.md", machine, cwd)).cacheStatus, "rebuilt");

  const legacy = JSON.parse(await fs.readFile(file, "utf8")) as { version: number };
  legacy.version = 0;
  await fs.writeFile(file, JSON.stringify(legacy), "utf8");
  assert.equal((await getRelatedNotes(vault, "a.md", machine, cwd)).cacheStatus, "rebuilt");

  const wrongProducer = JSON.parse(await fs.readFile(file, "utf8")) as {
    producerVersion: number;
  };
  wrongProducer.producerVersion = 999;
  await fs.writeFile(file, JSON.stringify(wrongProducer), "utf8");
  assert.equal((await getRelatedNotes(vault, "a.md", machine, cwd)).cacheStatus, "rebuilt");

  const malformedEvidence = JSON.parse(await fs.readFile(file, "utf8")) as {
    results: Array<{ candidates: Array<{ evidence: unknown[] }> }>;
  };
  malformedEvidence.results[0].candidates[0].evidence = [
    { kind: "future-unknown", score: 1, rawBody: "must-not-survive" },
  ];
  await fs.writeFile(file, JSON.stringify(malformedEvidence), "utf8");
  assert.equal((await getRelatedNotes(vault, "a.md", machine, cwd)).cacheStatus, "rebuilt");

  await fs.unlink(file);
  assert.equal((await getRelatedNotes(vault, "a.md", machine, cwd)).cacheStatus, "rebuilt");
});

test("corpus hash is sorted and includes producer and structural semantics", () => {
  const left = relatedNotesCorpusHash([
    { path: "b.md", contentHash: "b".repeat(64) },
    { path: "a.md", contentHash: "a".repeat(64) },
  ]);
  const right = relatedNotesCorpusHash([
    { path: "a.md", contentHash: "a".repeat(64) },
    { path: "b.md", contentHash: "b".repeat(64) },
  ]);
  assert.equal(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
});

test("non-Markdown and unavailable source paths are rejected with bounded errors", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const machine = await getMachineIndexResult(vault, cwd);
  await assert.rejects(
    () => getRelatedNotes(vault, "plain.txt", machine, cwd),
    (error: { code?: string; message?: string }) =>
      error.code === "invalid-related-notes-path" && !error.message?.includes(vault.rootPath),
  );
  await assert.rejects(
    () => getRelatedNotes(vault, "missing.md", machine, cwd),
    (error: { code?: string; message?: string }) =>
      error.code === "related-notes-source-unavailable" && !error.message?.includes(vault.rootPath),
  );
});

test("owned enrichment cache can be discarded without touching source files", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getRelatedNotes(vault, "a.md", await getMachineIndexResult(vault, cwd), cwd);
  const file = await relatedNotesCachePath(vault, cwd);
  const removed = await removeRelatedNotesCacheIfOwned(vault, cwd);
  assert.deepEqual(removed.deletedPaths, [file]);
  await assert.rejects(() => fs.stat(file), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(vault.rootPath, "a.md"), "utf8").then(Boolean), true);
});

test("an unreadable Markdown source is excluded without leaking its raw read error", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const initial = await getRelatedNotes(
    vault,
    "a.md",
    await getMachineIndexResult(vault, cwd),
    cwd,
  );
  assert.equal(
    initial.data.candidates.some((entry) => entry.targetPath === "b.md"),
    true,
  );

  const failedPath = path.join(vault.rootPath, "b.md");
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });
  fs.open = (async (file, ...args) => {
    if (file === failedPath) {
      throw Object.assign(new Error("EACCES: open '/private/example/secret.md'"), {
        code: "EACCES",
        syscall: "open",
        path: "/private/example/secret.md",
      });
    }
    return originalOpen(file, ...args);
  }) as typeof fs.open;

  const machine = await getMachineIndexResult(vault, cwd);
  assert.equal(machine.data.index.notes["b.md"], undefined);
  const result = await getRelatedNotes(vault, "a.md", machine, cwd);
  assert.equal(
    result.data.candidates.some((entry) => entry.targetPath === "b.md"),
    false,
  );
  assert.equal(JSON.stringify(result.data).includes("/private/example"), false);
  assert.equal(JSON.stringify(result.data).includes("EACCES"), false);
});
