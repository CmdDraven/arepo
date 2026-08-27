import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { getMachineIndexResult } from "./indexCache.js";
import { writeRelatedNotesPreference } from "./enrichmentPreferences.js";
import {
  RELATED_NOTES_PRESETS,
  customRelatedNotesPreference,
  namedRelatedNotesPreference,
  resolveRelatedNotesSettings,
} from "../src/lib/vault/enrichmentPreferences.js";
import {
  getRelatedNotes,
  removeRelatedNotesCacheIfOwned,
  relatedNotesCachePath,
  relatedNotesCorpusHash,
  relatedNotesSettingsHash,
  updateRelatedNotesPreferencesAndCache,
} from "./relatedNotesCache.js";
import type { VaultInfo } from "./types.js";
import {
  readRelatedNotesCuration,
  setRelatedNotesCurationDecision,
} from "./relatedNotesCuration.js";

async function makeVault(
  t: TestContext,
  enabled = true,
): Promise<{ cwd: string; vault: VaultInfo }> {
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
  if (enabled) {
    await writeRelatedNotesPreference(vault, namedRelatedNotesPreference("balanced", true), cwd);
  }
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

test("default-off returns disabled without loading the index, reading bodies, or creating cache", async (t) => {
  const { cwd, vault } = await makeVault(t, false);
  let machineLoads = 0;
  const originalOpen = fs.open;
  t.after(() => {
    fs.open = originalOpen;
  });
  let vaultOpens = 0;
  fs.open = (async (file, ...args) => {
    if (typeof file === "string" && file.startsWith(vault.rootPath)) vaultOpens += 1;
    return originalOpen(file, ...args);
  }) as typeof fs.open;
  const result = await getRelatedNotes(
    vault,
    "a.md",
    async () => {
      machineLoads += 1;
      return getMachineIndexResult(vault, cwd);
    },
    cwd,
  );
  assert.deepEqual(result, {
    cacheStatus: "disabled",
    data: { status: "disabled", producer: "arepo.related-notes", candidates: [] },
  });
  assert.equal(machineLoads, 0);
  assert.equal(vaultOpens, 0);
  const file = await relatedNotesCachePath(vault, cwd);
  await assert.rejects(() => fs.access(file), { code: "ENOENT" });
});

test("curation filters cache hits without invalidation or Markdown body rereads", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const machine = await getMachineIndexResult(vault, cwd);
  const first = await getRelatedNotes(vault, "a.md", machine, cwd);
  assert.equal(first.cacheStatus, "rebuilt");
  const candidate = first.data.status === "ready" ? first.data.candidates[0] : undefined;
  assert.ok(candidate);
  const cacheFile = await relatedNotesCachePath(vault, cwd);
  const cacheBefore = await fs.readFile(cacheFile, "utf8");

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
  await setRelatedNotesCurationDecision(
    vault,
    machine,
    {
      leftPath: "a.md",
      rightPath: candidate.targetPath,
      decision: "dismissed",
    },
    cwd,
  );
  const filtered = await getRelatedNotes(vault, "a.md", machine, cwd);
  assert.equal(filtered.cacheStatus, "hit");
  assert.equal(
    filtered.data.status === "ready" &&
      filtered.data.candidates.some((item) => item.targetPath === candidate.targetPath),
    false,
  );
  assert.equal(markdownOpens, 0);
  assert.equal(await fs.readFile(cacheFile, "utf8"), cacheBefore);
});

test("disabled enrichment preserves curation and re-enable restores suppression", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const machine = await getMachineIndexResult(vault, cwd);
  const ready = await getRelatedNotes(vault, "a.md", machine, cwd);
  const candidate = ready.data.status === "ready" ? ready.data.candidates[0] : undefined;
  assert.ok(candidate);
  await setRelatedNotesCurationDecision(
    vault,
    machine,
    {
      leftPath: "a.md",
      rightPath: candidate.targetPath,
      decision: "dismissed",
    },
    cwd,
  );
  await updateRelatedNotesPreferencesAndCache(
    vault,
    namedRelatedNotesPreference("balanced", false),
    cwd,
  );
  assert.equal((await getRelatedNotes(vault, "a.md", machine, cwd)).data.status, "disabled");
  assert.equal(
    (await readRelatedNotesCuration(vault, machine, undefined, true, cwd)).summary.dismissed,
    1,
  );
  await updateRelatedNotesPreferencesAndCache(
    vault,
    namedRelatedNotesPreference("balanced", true),
    cwd,
  );
  const restored = await getRelatedNotes(vault, "a.md", machine, cwd);
  assert.equal(
    restored.data.status === "ready" &&
      restored.data.candidates.some((item) => item.targetPath === candidate.targetPath),
    false,
  );
});

test("disabling purges a valid disposable cache and never serves it", async (t) => {
  const { cwd, vault } = await makeVault(t);
  await getRelatedNotes(vault, "a.md", await getMachineIndexResult(vault, cwd), cwd);
  const file = await relatedNotesCachePath(vault, cwd);
  await fs.access(file);
  await updateRelatedNotesPreferencesAndCache(
    vault,
    namedRelatedNotesPreference("balanced", false),
    cwd,
  );
  await assert.rejects(() => fs.access(file), { code: "ENOENT" });
  const disabled = await getRelatedNotes(
    vault,
    "a.md",
    await getMachineIndexResult(vault, cwd),
    cwd,
  );
  assert.equal(disabled.cacheStatus, "disabled");
  assert.equal(disabled.data.status, "disabled");
});

test("effective configuration changes cache identity while equivalent relative scales do not", () => {
  const readable = [
    { path: "a.md", contentHash: "a".repeat(64) },
    { path: "b.md", contentHash: "b".repeat(64) },
  ];
  const balanced = resolveRelatedNotesSettings(namedRelatedNotesPreference("balanced", true));
  const conservative = resolveRelatedNotesSettings(
    namedRelatedNotesPreference("conservative", true),
  );
  assert.notEqual(
    relatedNotesCorpusHash(readable, balanced),
    relatedNotesCorpusHash(readable, conservative),
  );
  const doubled = structuredClone(RELATED_NOTES_PRESETS.balanced);
  Object.values(doubled.evidence).forEach((item) => (item.weight *= 2));
  const equivalent = resolveRelatedNotesSettings(customRelatedNotesPreference(true, doubled));
  assert.equal(relatedNotesSettingsHash(equivalent), relatedNotesSettingsHash(balanced));
  assert.equal(
    relatedNotesCorpusHash(readable, equivalent),
    relatedNotesCorpusHash(readable, balanced),
  );
});

test("changing an enabled preset rebuilds rather than serving prior cache output", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const machine = await getMachineIndexResult(vault, cwd);
  assert.equal((await getRelatedNotes(vault, "a.md", machine, cwd)).cacheStatus, "rebuilt");
  assert.equal((await getRelatedNotes(vault, "a.md", machine, cwd)).cacheStatus, "hit");
  await updateRelatedNotesPreferencesAndCache(
    vault,
    namedRelatedNotesPreference("conservative", true),
    cwd,
  );
  const changed = await getRelatedNotes(vault, "a.md", machine, cwd);
  assert.equal(changed.cacheStatus, "rebuilt");
  assert.equal(changed.data.candidates.length <= 5, true);
});

test("disabling similar-text evidence avoids enrichment body rereads", async (t) => {
  const { cwd, vault } = await makeVault(t);
  const machine = await getMachineIndexResult(vault, cwd);
  const configuration = structuredClone(RELATED_NOTES_PRESETS.balanced);
  for (const [key, evidence] of Object.entries(configuration.evidence)) {
    evidence.enabled = key === "tags";
  }
  await updateRelatedNotesPreferencesAndCache(
    vault,
    customRelatedNotesPreference(true, configuration),
    cwd,
  );
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
  const result = await getRelatedNotes(vault, "a.md", machine, cwd);
  assert.equal(result.cacheStatus, "rebuilt");
  assert.equal(markdownOpens, 0);
});

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
  assert.equal(initial.data.status, "ready");
  assert.equal(unrelated.data.status, "ready");
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
