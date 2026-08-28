import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { buildGraph } from "../src/lib/vault/graph.js";
import {
  getMachineIndexResult,
  rebuildMachineIndex,
  type MachineIndexResult,
} from "./indexCache.js";
import {
  readStoredRelatedNotesCurationForTest,
  relatedNotesCurationPath,
  setRelatedNotesCurationDecision,
} from "./relatedNotesCuration.js";
import {
  promoteKeptRelationshipToMetadata,
  type RelationshipPromotionOwnership,
} from "./relationshipPromotion.js";
import { makeTestTempDir } from "./testTemp.js";
import type { VaultInfo } from "./types.js";
import { readVaultFile } from "./vaultFs.js";

async function fixture(t: TestContext, permissions?: Partial<VaultInfo["permissions"]>) {
  const cwd = await makeTestTempDir(t, "arepo-promotion-cwd-");
  const rootPath = await makeTestTempDir(t, "arepo-promotion-vault-");
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    JSON.stringify({
      node: { nodeId: "local", displayName: "Local", mode: "local", apiVersion: 1 },
      appDataDir: "./app-data",
      vaults: [],
    }),
  );
  const baseVault: VaultInfo = {
    id: "promotion-test",
    displayName: "Promotion",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: true,
    },
  };
  await fs.writeFile(path.join(rootPath, "a.md"), "# Alpha\nBody A\n", "utf8");
  await fs.writeFile(path.join(rootPath, "b.md"), "# Beta\nBody B\n", "utf8");
  const machine = await getMachineIndexResult(baseVault, cwd);
  await setRelatedNotesCurationDecision(
    baseVault,
    machine,
    { leftPath: "a.md", rightPath: "b.md", decision: "kept" },
    cwd,
  );
  const vault: VaultInfo = {
    ...baseVault,
    permissions: { ...baseVault.permissions, ...permissions },
  };
  return { cwd, rootPath, vault, machine };
}

async function promote(
  vault: VaultInfo,
  machine: MachineIndexResult,
  cwd: string,
  ownership: RelationshipPromotionOwnership,
) {
  const [current, related] = await Promise.all([
    readVaultFile(vault, "a.md"),
    readVaultFile(vault, "b.md"),
  ]);
  return promoteKeptRelationshipToMetadata(
    vault,
    machine.data,
    {
      ownership,
      currentPath: "a.md",
      relatedPath: "b.md",
      expectedHashes: { current: current.hash, related: related.hash },
    },
    cwd,
  );
}

async function assertCuration(vault: VaultInfo, cwd: string, expected: "kept" | "cleared") {
  const stored = await readStoredRelatedNotesCurationForTest(vault, cwd);
  assert.equal(stored.status, "ready");
  if (stored.status !== "ready") return;
  assert.equal(stored.store.decisions[0]?.decision ?? "cleared", expected);
}

async function freshMachine(vault: VaultInfo, cwd: string): Promise<MachineIndexResult> {
  await rebuildMachineIndex(vault, cwd);
  return getMachineIndexResult(vault, cwd);
}

test("current-only and related-only promotion mutate exactly the selected owner and clear kept", async (t) => {
  for (const ownership of ["current", "related"] as const) {
    const { cwd, rootPath, vault, machine } = await fixture(t);
    const owner = ownership === "current" ? "a.md" : "b.md";
    const target = ownership === "current" ? "b.md" : "a.md";
    const untouched = await fs.readFile(path.join(rootPath, target), "utf8");
    const result = await promote(vault, machine, cwd, ownership);
    assert.equal(result.status, "complete");
    assert.equal(result.ownership, ownership);
    assert.deepEqual(
      result.results.map(({ role, ownerPath, targetPath, status }) => ({
        role,
        ownerPath,
        targetPath,
        status,
      })),
      [{ role: ownership, ownerPath: owner, targetPath: target, status: "promoted" }],
    );
    assert.match(await fs.readFile(path.join(rootPath, owner), "utf8"), /related:/);
    assert.equal(await fs.readFile(path.join(rootPath, target), "utf8"), untouched);
    await assertCuration(vault, cwd, "cleared");
  }
});

test("promotion preserves existing frontmatter, comments, ordering, and body text", async (t) => {
  const { cwd, rootPath, vault } = await fixture(t);
  const source =
    "---\ntitle: Alpha\n# keep this comment\ntags:\n  - systems\n---\n\n# Alpha\nBody A\n";
  await fs.writeFile(path.join(rootPath, "a.md"), source, "utf8");
  const result = await promote(vault, await freshMachine(vault, cwd), cwd, "current");
  assert.equal(result.status, "complete");
  assert.equal(
    await fs.readFile(path.join(rootPath, "a.md"), "utf8"),
    '---\ntitle: Alpha\n# keep this comment\ntags:\n  - systems\nrelated:\n  - "[[b]]"\n---\n\n# Alpha\nBody A\n',
  );
});

test("Both writes reciprocal metadata current-first, preserves declarations, and maps one graph edge", async (t) => {
  const { cwd, rootPath, vault, machine } = await fixture(t);
  const targets = [path.join(rootPath, "a.md"), path.join(rootPath, "b.md")];
  const published: string[] = [];
  const originalRename = fs.rename;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (typeof to === "string" && targets.includes(to)) published.push(to);
    return originalRename(from, to);
  }) as typeof fs.rename;

  const result = await promote(vault, machine, cwd, "both");
  fs.rename = originalRename;
  assert.equal(result.status, "complete");
  assert.deepEqual(
    result.results.map((owner) => [owner.role, owner.status]),
    [
      ["current", "promoted"],
      ["related", "promoted"],
    ],
  );
  assert.deepEqual(published, targets);
  assert.match(await fs.readFile(targets[0], "utf8"), / {2}- "\[\[b\]\]"/);
  assert.match(await fs.readFile(targets[1], "utf8"), / {2}- "\[\[a\]\]"/);
  await assertCuration(vault, cwd, "cleared");

  const rebuilt = await freshMachine(vault, cwd);
  assert.deepEqual(rebuilt.data.index.outgoingLinks["a.md"]?.[0]?.origins, ["metadata"]);
  assert.deepEqual(rebuilt.data.index.outgoingLinks["b.md"]?.[0]?.origins, ["metadata"]);
  assert.equal(rebuilt.data.index.outgoingLinks["a.md"]?.[0]?.targetPath, "b.md");
  assert.equal(rebuilt.data.index.outgoingLinks["b.md"]?.[0]?.targetPath, "a.md");
  const graph = buildGraph(rebuilt.data.index, rebuilt.data.issues);
  assert.equal(
    graph.edges.filter(
      (edge) => edge.type === "wikilink" && edge.source === "a.md" && edge.target === "b.md",
    ).length,
    1,
  );
});

test("Both is idempotent for A-present/B-absent, A-absent/B-present, and both-present", async (t) => {
  for (const present of ["current", "related", "both"] as const) {
    const { cwd, rootPath, vault } = await fixture(t);
    if (present === "current" || present === "both") {
      await fs.writeFile(
        path.join(rootPath, "a.md"),
        '---\nrelated:\n  - "[[b]]"\n---\n# Alpha\nBody A\n',
      );
    }
    if (present === "related" || present === "both") {
      await fs.writeFile(
        path.join(rootPath, "b.md"),
        '---\nrelated:\n  - "[[a]]"\n---\n# Beta\nBody B\n',
      );
    }
    const beforeA = await fs.readFile(path.join(rootPath, "a.md"), "utf8");
    const beforeB = await fs.readFile(path.join(rootPath, "b.md"), "utf8");
    const result = await promote(vault, await freshMachine(vault, cwd), cwd, "both");
    assert.equal(result.status, "complete");
    assert.deepEqual(
      result.results.map((owner) => owner.status),
      present === "current"
        ? ["already-present", "promoted"]
        : present === "related"
          ? ["promoted", "already-present"]
          : ["already-present", "already-present"],
    );
    if (present === "current" || present === "both") {
      assert.equal(await fs.readFile(path.join(rootPath, "a.md"), "utf8"), beforeA);
    }
    if (present === "related" || present === "both") {
      assert.equal(await fs.readFile(path.join(rootPath, "b.md"), "utf8"), beforeB);
    }
    await assertCuration(vault, cwd, "cleared");
  }
});

test("a body wikilink does not satisfy requested metadata ownership", async (t) => {
  const { cwd, rootPath, vault } = await fixture(t);
  await fs.writeFile(path.join(rootPath, "a.md"), "# Alpha\nSee [[b]] in prose.\n");
  const result = await promote(vault, await freshMachine(vault, cwd), cwd, "both");
  assert.equal(result.status, "complete");
  assert.deepEqual(
    result.results.map((owner) => owner.status),
    ["promoted", "promoted"],
  );
  const a = await fs.readFile(path.join(rootPath, "a.md"), "utf8");
  assert.match(a, /See \[\[b\]\] in prose\./);
  assert.match(a, /related:/);
  const rebuilt = await freshMachine(vault, cwd);
  assert.deepEqual(rebuilt.data.index.outgoingLinks["a.md"]?.[0]?.origins, ["body", "metadata"]);
  assert.equal(buildGraph(rebuilt.data.index, rebuilt.data.issues).edges.length, 1);
});

test("a stale precondition for either source is rejected before either write", async (t) => {
  for (const changedRole of ["current", "related"] as const) {
    const { cwd, rootPath, vault, machine } = await fixture(t);
    const [current, related] = await Promise.all([
      readVaultFile(vault, "a.md"),
      readVaultFile(vault, "b.md"),
    ]);
    const changedPath = changedRole === "current" ? "a.md" : "b.md";
    const unchangedPath = changedRole === "current" ? "b.md" : "a.md";
    const unchanged = await fs.readFile(path.join(rootPath, unchangedPath), "utf8");
    const external = `# externally changed ${changedRole}\n`;
    await fs.writeFile(path.join(rootPath, changedPath), external);
    await assert.rejects(
      () =>
        promoteKeptRelationshipToMetadata(
          vault,
          machine.data,
          {
            ownership: "both",
            currentPath: "a.md",
            relatedPath: "b.md",
            expectedHashes: { current: current.hash, related: related.hash },
          },
          cwd,
        ),
      (error: { code?: string }) => error.code === "VAULT_FILE_CONFLICT",
    );
    assert.equal(await fs.readFile(path.join(rootPath, changedPath), "utf8"), external);
    assert.equal(await fs.readFile(path.join(rootPath, unchangedPath), "utf8"), unchanged);
    await assertCuration(vault, cwd, "kept");
  }
});

test("unsupported or malformed requested-owner metadata is refused without changing source or curation", async (t) => {
  for (const [source, code] of [
    ['---\nrelated: "[[b]]"\n---\n# Alpha\n', "related-metadata-unsupported"],
    ["---\ntitle: Alpha\n# missing closing delimiter\n", "related-metadata-malformed"],
  ] as const) {
    const { cwd, rootPath, vault } = await fixture(t);
    await fs.writeFile(path.join(rootPath, "a.md"), source, "utf8");
    const machine = await freshMachine(vault, cwd);
    await assert.rejects(
      () => promote(vault, machine, cwd, "current"),
      (error: { code?: string }) => error.code === code,
    );
    assert.equal(await fs.readFile(path.join(rootPath, "a.md"), "utf8"), source);
    await assertCuration(vault, cwd, "kept");
  }
});

test("malformed or unsupported second-source metadata fails preflight before the current write", async (t) => {
  for (const [source, code] of [
    ['---\nrelated:\n  - "[[a]]"\n# no closing delimiter\n', "related-metadata-malformed"],
    ['---\nrelated: "[[a]]"\n---\n# B\n', "related-metadata-unsupported"],
  ] as const) {
    const { cwd, rootPath, vault } = await fixture(t);
    await fs.writeFile(path.join(rootPath, "b.md"), source);
    const beforeA = await fs.readFile(path.join(rootPath, "a.md"), "utf8");
    const machine = await freshMachine(vault, cwd);
    await assert.rejects(
      () => promote(vault, machine, cwd, "both"),
      (error: { code?: string }) => error.code === code,
    );
    assert.equal(await fs.readFile(path.join(rootPath, "a.md"), "utf8"), beforeA);
    assert.equal(await fs.readFile(path.join(rootPath, "b.md"), "utf8"), source);
    await assertCuration(vault, cwd, "kept");
  }
});

test("second-write conflict returns partial success without rollback and retry completes idempotently", async (t) => {
  const { cwd, rootPath, vault, machine } = await fixture(t);
  const aPath = path.join(rootPath, "a.md");
  const bPath = path.join(rootPath, "b.md");
  const originalRename = fs.rename;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    const result = await originalRename(from, to);
    if (to === aPath) await fs.writeFile(bPath, "# B changed between writes\n");
    return result;
  }) as typeof fs.rename;

  const partial = await promote(vault, machine, cwd, "both");
  fs.rename = originalRename;
  assert.equal(partial.status, "partial");
  assert.deepEqual(
    partial.results.map((owner) => owner.status),
    ["promoted", "failed"],
  );
  assert.equal(partial.results[1]?.status === "failed" && partial.results[1].code, "CONFLICT");
  assert.match(await fs.readFile(aPath, "utf8"), /related:/);
  assert.equal(await fs.readFile(bPath, "utf8"), "# B changed between writes\n");
  await assertCuration(vault, cwd, "kept");

  const complete = await promote(vault, await freshMachine(vault, cwd), cwd, "both");
  assert.equal(complete.status, "complete");
  assert.deepEqual(
    complete.results.map((owner) => owner.status),
    ["already-present", "promoted"],
  );
  await assertCuration(vault, cwd, "cleared");
});

test("a disappearing second source returns bounded partial success and preserves the first write", async (t) => {
  const { cwd, rootPath, vault, machine } = await fixture(t);
  const aPath = path.join(rootPath, "a.md");
  const bPath = path.join(rootPath, "b.md");
  const originalRename = fs.rename;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    const result = await originalRename(from, to);
    if (to === aPath) await fs.unlink(bPath);
    return result;
  }) as typeof fs.rename;
  const result = await promote(vault, machine, cwd, "both");
  fs.rename = originalRename;
  assert.equal(result.status, "partial");
  assert.deepEqual(
    result.results.map((owner) => owner.status),
    ["promoted", "failed"],
  );
  assert.match(await fs.readFile(aPath, "utf8"), /related:/);
  await assert.rejects(() => fs.access(bPath), { code: "ENOENT" });
  assert.equal(JSON.stringify(result).includes(rootPath), false);
  await assertCuration(vault, cwd, "kept");
});

test("an unexpected second-write failure is bounded, does not roll back, and retains kept", async (t) => {
  const { cwd, rootPath, vault, machine } = await fixture(t);
  const aPath = path.join(rootPath, "a.md");
  const bPath = path.join(rootPath, "b.md");
  const beforeB = await fs.readFile(bPath, "utf8");
  const originalRename = fs.rename;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (to === bPath) {
      throw Object.assign(new Error("EIO /private/example/secret.md"), { code: "EIO" });
    }
    return originalRename(from, to);
  }) as typeof fs.rename;
  const result = await promote(vault, machine, cwd, "both");
  fs.rename = originalRename;
  assert.equal(result.status, "partial");
  assert.match(await fs.readFile(aPath, "utf8"), /related:/);
  assert.equal(await fs.readFile(bPath, "utf8"), beforeB);
  assert.equal(JSON.stringify(result).includes("/private/example"), false);
  assert.equal(
    result.results[1]?.status === "failed" && result.results[1].error,
    "The requested note metadata could not be written.",
  );
  await assertCuration(vault, cwd, "kept");
});

test("first-source publication failure remains a whole-operation failure and preserves kept", async (t) => {
  const { cwd, rootPath, vault, machine } = await fixture(t);
  const target = path.join(rootPath, "a.md");
  const original = await fs.readFile(target, "utf8");
  const originalRename = fs.rename;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (to === target) throw Object.assign(new Error("simulated source failure"), { code: "EIO" });
    return originalRename(from, to);
  }) as typeof fs.rename;
  await assert.rejects(() => promote(vault, machine, cwd, "both"), { code: "EIO" });
  fs.rename = originalRename;
  assert.equal(await fs.readFile(target, "utf8"), original);
  await assertCuration(vault, cwd, "kept");
});

test("curation-clear failure after complete Both is bounded and never rolls back either source", async (t) => {
  const { cwd, rootPath, vault, machine } = await fixture(t);
  const curationFile = await relatedNotesCurationPath(vault, cwd);
  const originalRename = fs.rename;
  t.after(() => {
    fs.rename = originalRename;
  });
  fs.rename = (async (from, to) => {
    if (to === curationFile) {
      throw Object.assign(new Error("EIO /private/example/secret-curation.json"), { code: "EIO" });
    }
    return originalRename(from, to);
  }) as typeof fs.rename;
  const result = await promote(vault, machine, cwd, "both");
  fs.rename = originalRename;
  assert.equal(result.status, "complete");
  assert.equal(
    result.curationDiagnostic,
    "The requested canonical relationship metadata is present, but its AREPO curation decision could not be cleared.",
  );
  assert.equal(JSON.stringify(result).includes("/private/example"), false);
  assert.match(await fs.readFile(path.join(rootPath, "a.md"), "utf8"), /related:/);
  assert.match(await fs.readFile(path.join(rootPath, "b.md"), "utf8"), /related:/);
  await assertCuration(vault, cwd, "kept");
});

test("promotion requires permissions and the exact ownership/precondition request shape", async (t) => {
  for (const deniedPermission of ["readIndex", "readContent", "writeContent"] as const) {
    const { cwd, vault, machine } = await fixture(t, { [deniedPermission]: false });
    await assert.rejects(
      () =>
        promoteKeptRelationshipToMetadata(
          vault,
          machine.data,
          {
            ownership: "current",
            currentPath: "a.md",
            relatedPath: "b.md",
            expectedHashes: { current: "a".repeat(64), related: "b".repeat(64) },
          },
          cwd,
        ),
      (error: { code?: string }) => error.code === "relationship-promotion-not-permitted",
    );
  }
  const { cwd, vault, machine } = await fixture(t);
  for (const invalid of [
    {
      ownership: "future",
      currentPath: "a.md",
      relatedPath: "b.md",
      expectedHashes: { current: "a".repeat(64), related: "b".repeat(64) },
    },
    {
      ownership: "both",
      currentPath: "a.txt",
      relatedPath: "b.md",
      expectedHashes: { current: "a".repeat(64), related: "b".repeat(64) },
    },
    {
      ownership: "both",
      currentPath: "a.md",
      relatedPath: "b.md",
      expectedHashes: { current: "not-a-hash", related: "b".repeat(64) },
    },
  ]) {
    await assert.rejects(
      () => promoteKeptRelationshipToMetadata(vault, machine.data, invalid, cwd),
      (error: { code?: string }) => error.code === "invalid-relationship-promotion",
    );
  }
});
