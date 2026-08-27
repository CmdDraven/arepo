import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { getMachineIndexResult, rebuildMachineIndex } from "./indexCache.js";
import {
  applyRelatedNotesCuration,
  clearRelatedNotesCurationDecision,
  readRelatedNotesCuration,
  readStoredRelatedNotesCurationForTest,
  relatedNotesCurationPath,
  renameRelatedNotesCurationPaths,
  setRelatedNotesCurationDecision,
} from "./relatedNotesCuration.js";
import { makeTestTempDir } from "./testTemp.js";
import type { VaultInfo } from "./types.js";
import type { RelatedNotesDerivedResponse } from "../src/lib/vault/enrichmentContracts.js";

async function fixture(t: TestContext, id = "curation-test") {
  const cwd = await makeTestTempDir(t, "arepo-curation-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-curation-vault-");
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
    id,
    displayName: "Curation",
    rootPath,
    permissions: { readIndex: true, readContent: true, writeContent: true, deleteFiles: true },
  };
  await write(rootPath, "a.md", "# Alpha\ncanonical stale conflict version");
  await write(rootPath, "b.md", "# Beta\ncanonical stale conflict version");
  await write(rootPath, "nested/c.md", "# Gamma\ncanonical conflict recovery");
  return { cwd, vault, machine: await getMachineIndexResult(vault, cwd) };
}

async function write(root: string, relative: string, content: string): Promise<void> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

function pair(leftPath = "a.md", rightPath = "b.md", decision = "kept") {
  return { leftPath, rightPath, decision };
}

function derived(): RelatedNotesDerivedResponse {
  return {
    status: "ready",
    sourcePath: "a.md",
    sourceHash: "a".repeat(64),
    corpusHash: "c".repeat(64),
    producer: "arepo.related-notes",
    producerVersion: 1,
    derivationVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    candidates: [
      {
        targetPath: "b.md",
        targetHash: "b".repeat(64),
        title: "Beta",
        score: 0.5,
        evidence: [{ kind: "lexical-similarity", score: 0.5, sharedTerms: ["canonical"] }],
      },
      {
        targetPath: "nested/c.md",
        targetHash: "d".repeat(64),
        title: "Gamma",
        score: 0.3,
        evidence: [{ kind: "lexical-similarity", score: 0.3, sharedTerms: ["conflict"] }],
      },
    ],
  };
}

test("missing curation is empty and does not create durable state", async (t) => {
  const { cwd, vault, machine } = await fixture(t);
  const response = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
  assert.deepEqual(response.summary, { kept: 0, dismissed: 0 });
  assert.deepEqual(response.decisions, []);
  const file = await relatedNotesCurationPath(vault, cwd);
  await assert.rejects(() => fs.access(file), { code: "ENOENT" });
});

test("set, reverse replacement, clear, persistence, and per-vault isolation are deterministic", async (t) => {
  const { cwd, vault, machine } = await fixture(t);
  await setRelatedNotesCurationDecision(
    vault,
    machine,
    pair("b.md", "a.md", "kept"),
    cwd,
    new Date("2026-01-01T00:00:00.000Z"),
  );
  let response = await readRelatedNotesCuration(vault, machine, "a.md", true, cwd);
  assert.equal(response.decisions.length, 1);
  assert.deepEqual(
    response.decisions.map(({ leftPath, rightPath, decision }) => ({
      leftPath,
      rightPath,
      decision,
    })),
    [pair()],
  );
  await setRelatedNotesCurationDecision(
    vault,
    machine,
    pair("a.md", "b.md", "dismissed"),
    cwd,
    new Date("2026-01-02T00:00:00.000Z"),
  );
  response = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
  assert.deepEqual(response.summary, { kept: 0, dismissed: 1 });
  assert.equal(response.decisions[0]?.decision, "dismissed");
  assert.equal(response.decisions[0]?.decidedAt, "2026-01-02T00:00:00.000Z");

  const other = { ...vault, id: "other-curation" };
  const isolated = await readRelatedNotesCuration(other, machine, undefined, true, cwd);
  assert.deepEqual(isolated.decisions, []);

  await clearRelatedNotesCurationDecision(vault, { leftPath: "b.md", rightPath: "a.md" }, cwd);
  response = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
  assert.deepEqual(response.decisions, []);
});

test("canonical pair identity and serialization use locale-independent code-unit ordering", async (t) => {
  const { cwd, vault } = await fixture(t);
  await write(vault.rootPath, "Z.md", "# Uppercase\ncanonical stale conflict version");
  await rebuildMachineIndex(vault, cwd);
  const machine = await getMachineIndexResult(vault, cwd);
  await setRelatedNotesCurationDecision(vault, machine, pair("a.md", "Z.md", "kept"), cwd);
  await setRelatedNotesCurationDecision(vault, machine, pair("a.md", "b.md", "dismissed"), cwd);

  const response = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
  assert.deepEqual(
    response.decisions.map(({ leftPath, rightPath }) => [leftPath, rightPath]),
    [
      ["Z.md", "a.md"],
      ["a.md", "b.md"],
    ],
  );
  const stored = await fs.readFile(await relatedNotesCurationPath(vault, cwd), "utf8");
  assert.ok(stored.indexOf('"leftPath": "Z.md"') < stored.indexOf('"leftPath": "a.md"'));
});

test("malformed, unknown-version, duplicate, and body-bearing stores fail closed without overwrite", async (t) => {
  const { cwd, vault, machine } = await fixture(t);
  const file = await relatedNotesCurationPath(vault, cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (const stored of [
    "not json",
    JSON.stringify({
      kind: "arepo.relatedNotesCuration",
      version: 999,
      vaultId: vault.id,
      decisions: [],
    }),
    JSON.stringify({
      kind: "arepo.relatedNotesCuration",
      version: 1,
      vaultId: vault.id,
      decisions: [
        {
          leftPath: "a.md",
          rightPath: "b.md",
          decision: "kept",
          decidedAt: "2026-01-01T00:00:00.000Z",
          leftHashAtDecision: "a".repeat(64),
          rightHashAtDecision: "b".repeat(64),
        },
        {
          leftPath: "a.md",
          rightPath: "b.md",
          decision: "dismissed",
          decidedAt: "2026-01-02T00:00:00.000Z",
          leftHashAtDecision: "a".repeat(64),
          rightHashAtDecision: "b".repeat(64),
        },
      ],
    }),
    JSON.stringify({
      kind: "arepo.relatedNotesCuration",
      version: 1,
      vaultId: vault.id,
      decisions: [],
      sourceBody: "private note body",
    }),
  ]) {
    await fs.writeFile(file, stored, "utf8");
    const response = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
    assert.equal(response.status, "invalid");
    assert.equal(response.canMutate, false);
    assert.deepEqual(response.decisions, []);
    await assert.rejects(
      () => setRelatedNotesCurationDecision(vault, machine, pair(), cwd),
      (error: { code?: string }) => error.code === "related-notes-curation-store-invalid",
    );
    assert.equal(await fs.readFile(file, "utf8"), stored);
  }
});

test("atomic write failure preserves the previous valid decision and stores no source bodies", async (t) => {
  const { cwd, vault, machine } = await fixture(t);
  await setRelatedNotesCurationDecision(vault, machine, pair(), cwd);
  const file = await relatedNotesCurationPath(vault, cwd);
  const original = await fs.readFile(file, "utf8");
  assert.equal(original.includes("canonical stale conflict"), false);
  assert.equal(original.includes("score"), false);

  const originalRename = fs.rename;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (to === file)
      throw Object.assign(new Error("simulated publication failure"), { code: "EIO" });
    return originalRename(from, to);
  }) as typeof fs.rename;
  await assert.rejects(
    () =>
      setRelatedNotesCurationDecision(
        vault,
        machine,
        pair("a.md", "nested/c.md", "dismissed"),
        cwd,
      ),
    { code: "EIO" },
  );
  fs.rename = originalRename;
  assert.equal(await fs.readFile(file, "utf8"), original);
});

test("all hash-drift and missing-path states annotate but never erase user intent", async (t) => {
  const { cwd, vault, machine } = await fixture(t);
  await setRelatedNotesCurationDecision(vault, machine, pair(), cwd);

  await write(vault.rootPath, "b.md", "# Beta changed\nnew target body");
  await rebuildMachineIndex(vault, cwd);
  let current = await getMachineIndexResult(vault, cwd);
  let response = await readRelatedNotesCuration(vault, current, undefined, true, cwd);
  assert.equal(response.decisions[0]?.freshness, "right-changed");

  await write(vault.rootPath, "b.md", "# Beta\ncanonical stale conflict version");
  await rebuildMachineIndex(vault, cwd);
  current = await getMachineIndexResult(vault, cwd);
  response = await readRelatedNotesCuration(vault, current, undefined, true, cwd);
  assert.equal(response.decisions[0]?.freshness, "current");

  await write(vault.rootPath, "a.md", "# Alpha changed\nnew body");
  await rebuildMachineIndex(vault, cwd);
  current = await getMachineIndexResult(vault, cwd);
  response = await readRelatedNotesCuration(vault, current, undefined, true, cwd);
  assert.equal(response.decisions[0]?.freshness, "left-changed");

  await write(vault.rootPath, "b.md", "# Beta changed\nnew target body");
  await rebuildMachineIndex(vault, cwd);
  current = await getMachineIndexResult(vault, cwd);
  response = await readRelatedNotesCuration(vault, current, undefined, true, cwd);
  assert.equal(response.decisions[0]?.freshness, "both-changed");

  await fs.unlink(path.join(vault.rootPath, "a.md"));
  await write(vault.rootPath, "copy.md", "# Alpha changed\nnew body");
  await rebuildMachineIndex(vault, cwd);
  current = await getMachineIndexResult(vault, cwd);
  response = await readRelatedNotesCuration(vault, current, undefined, true, cwd);
  assert.equal(response.decisions[0]?.freshness, "left-missing");
  assert.equal(
    response.decisions.some(
      (decision) => decision.leftPath === "copy.md" || decision.rightPath === "copy.md",
    ),
    false,
  );

  await write(vault.rootPath, "a.md", "# Alpha changed\nnew body");
  await fs.unlink(path.join(vault.rootPath, "b.md"));
  await rebuildMachineIndex(vault, cwd);
  current = await getMachineIndexResult(vault, cwd);
  response = await readRelatedNotesCuration(vault, current, undefined, true, cwd);
  assert.equal(response.decisions[0]?.freshness, "right-missing");

  await fs.unlink(path.join(vault.rootPath, "a.md"));
  await rebuildMachineIndex(vault, cwd);
  current = await getMachineIndexResult(vault, cwd);
  response = await readRelatedNotesCuration(vault, current, undefined, true, cwd);
  assert.equal(response.decisions[0]?.freshness, "both-missing");

  await write(vault.rootPath, "a.md", "# Alpha\ncanonical stale conflict version");
  await write(vault.rootPath, "b.md", "# Beta\ncanonical stale conflict version");
  await rebuildMachineIndex(vault, cwd);
  current = await getMachineIndexResult(vault, cwd);
  response = await readRelatedNotesCuration(vault, current, undefined, true, cwd);
  assert.equal(response.decisions[0]?.freshness, "current");
  assert.equal(response.decisions.length, 1);
});

test("dismissed and kept decisions filter after derivation while clear restores cached candidates", async (t) => {
  const { cwd, vault, machine } = await fixture(t);
  await setRelatedNotesCurationDecision(vault, machine, pair("a.md", "b.md", "dismissed"), cwd);
  let response = await applyRelatedNotesCuration(vault, machine, derived(), cwd);
  assert.deepEqual(
    response.candidates.map((candidate) => candidate.targetPath),
    ["nested/c.md"],
  );
  assert.deepEqual(response.curation.kept, []);

  await setRelatedNotesCurationDecision(vault, machine, pair("a.md", "b.md", "kept"), cwd);
  response = await applyRelatedNotesCuration(vault, machine, derived(), cwd);
  assert.deepEqual(
    response.candidates.map((candidate) => candidate.targetPath),
    ["nested/c.md"],
  );
  assert.equal(response.curation.kept[0]?.targetPath, "b.md");

  await clearRelatedNotesCurationDecision(vault, { leftPath: "a.md", rightPath: "b.md" }, cwd);
  response = await applyRelatedNotesCuration(vault, machine, derived(), cwd);
  assert.deepEqual(
    response.candidates.map((candidate) => candidate.targetPath),
    ["b.md", "nested/c.md"],
  );
});

test("managed file and folder renames update paths; unrelated identical content is never inferred", async (t) => {
  const { cwd, vault, machine } = await fixture(t);
  await setRelatedNotesCurationDecision(vault, machine, pair("a.md", "b.md", "kept"), cwd);
  await setRelatedNotesCurationDecision(
    vault,
    machine,
    pair("a.md", "nested/c.md", "dismissed"),
    cwd,
  );
  assert.equal(
    (await renameRelatedNotesCurationPaths(vault, "a.md", "renamed.md", "file", cwd)).changed,
    true,
  );
  assert.equal(
    (await renameRelatedNotesCurationPaths(vault, "nested", "moved", "folder", cwd)).changed,
    true,
  );
  const stored = await readStoredRelatedNotesCurationForTest(vault, cwd);
  assert.notEqual(stored.status, "invalid");
  if (stored.status === "invalid") return;
  assert.deepEqual(
    stored.store.decisions.map(({ leftPath, rightPath }) => [leftPath, rightPath]),
    [
      ["b.md", "renamed.md"],
      ["moved/c.md", "renamed.md"],
    ],
  );
  await write(
    vault.rootPath,
    "copy.md",
    await fs.readFile(path.join(vault.rootPath, "a.md"), "utf8"),
  );
  assert.equal(
    stored.store.decisions.some(
      (record) => record.leftPath === "copy.md" || record.rightPath === "copy.md",
    ),
    false,
  );
});

test("non-Markdown, self-pair, unavailable sources, and read-only mutation are rejected boundedly", async (t) => {
  const { cwd, vault, machine } = await fixture(t);
  for (const input of [
    pair("a.md", "a.md"),
    pair("a.md", "plain.txt"),
    pair("/private/a.md", "b.md"),
  ]) {
    await assert.rejects(
      () => setRelatedNotesCurationDecision(vault, machine, input, cwd),
      (error: { code?: string; message?: string }) =>
        error.code === "invalid-related-notes-curation" && !error.message?.includes("/private"),
    );
  }
  await assert.rejects(
    () => setRelatedNotesCurationDecision(vault, machine, pair("a.md", "missing.md"), cwd),
    (error: { code?: string }) => error.code === "related-notes-curation-source-unavailable",
  );
  const readOnly = { ...vault, permissions: { ...vault.permissions, writeContent: false } };
  await assert.rejects(
    () => setRelatedNotesCurationDecision(readOnly, machine, pair(), cwd),
    (error: { code?: string }) => error.code === "related-notes-curation-not-writable",
  );
});
