import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { getMachineIndexResult, rebuildMachineIndex } from "./indexCache.js";
import {
  readRelatedNotesCuration,
  relatedNotesCurationPath,
  setRelatedNotesCurationDecision,
} from "./relatedNotesCuration.js";
import { promoteKeptRelationshipToMetadata } from "./relationshipPromotion.js";
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
  machine: Awaited<ReturnType<typeof getMachineIndexResult>>,
  cwd: string,
  ownerPath = "a.md",
  targetPath = "b.md",
) {
  const owner = await readVaultFile(vault, ownerPath);
  return promoteKeptRelationshipToMetadata(
    vault,
    machine.data,
    { ownerPath, targetPath, expectedHash: owner.hash },
    cwd,
  );
}

test("a kept pair can be promoted into either chosen owner without reciprocal mutation", async (t) => {
  for (const ownerPath of ["a.md", "b.md"] as const) {
    const { cwd, rootPath, vault, machine } = await fixture(t);
    const targetPath = ownerPath === "a.md" ? "b.md" : "a.md";
    const untouchedBefore = await fs.readFile(path.join(rootPath, targetPath), "utf8");
    const result = await promote(vault, machine, cwd, ownerPath, targetPath);
    assert.equal(result.status, "promoted");
    assert.equal(result.ownerPath, ownerPath);
    assert.match(
      await fs.readFile(path.join(rootPath, ownerPath), "utf8"),
      /related:\n {2}- "\[\[[ab]\]\]"/,
    );
    assert.equal(await fs.readFile(path.join(rootPath, targetPath), "utf8"), untouchedBefore);
    const current = await getMachineIndexResult(vault, cwd);
    const curation = await readRelatedNotesCuration(vault, current, undefined, true, cwd);
    assert.deepEqual(curation.decisions, []);
  }
});

test("promotion preserves existing frontmatter, comments, ordering, and body text", async (t) => {
  const { cwd, rootPath, vault } = await fixture(t);
  const source =
    "---\ntitle: Alpha\n# keep this comment\ntags:\n  - systems\n---\n\n# Alpha\nBody A\n";
  await fs.writeFile(path.join(rootPath, "a.md"), source, "utf8");
  await rebuildMachineIndex(vault, cwd);
  const machine = await getMachineIndexResult(vault, cwd);
  const result = await promote(vault, machine, cwd);
  assert.equal(result.status, "promoted");
  assert.equal(
    await fs.readFile(path.join(rootPath, "a.md"), "utf8"),
    '---\ntitle: Alpha\n# keep this comment\ntags:\n  - systems\nrelated:\n  - "[[b]]"\n---\n\n# Alpha\nBody A\n',
  );
});

test("already-explicit metadata and body relationships are idempotent and clear kept state", async (t) => {
  for (const source of ['---\nrelated:\n  - "[[b]]"\n---\n# Alpha\n', "# Alpha\nSee [[b]].\n"]) {
    const { cwd, rootPath, vault } = await fixture(t);
    await fs.writeFile(path.join(rootPath, "a.md"), source, "utf8");
    await rebuildMachineIndex(vault, cwd);
    const machine = await getMachineIndexResult(vault, cwd);
    const before = await fs.readFile(path.join(rootPath, "a.md"), "utf8");
    const result = await promote(vault, machine, cwd);
    assert.equal(result.status, "already-present");
    assert.equal(await fs.readFile(path.join(rootPath, "a.md"), "utf8"), before);
    const curation = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
    assert.deepEqual(curation.decisions, []);
  }
});

test("unsupported or malformed related metadata is refused without changing source or curation", async (t) => {
  for (const source of [
    '---\nrelated: "[[b]]"\n---\n# Alpha\n',
    "---\ntitle: Alpha\n# missing closing delimiter\n",
  ]) {
    const { cwd, rootPath, vault } = await fixture(t);
    await fs.writeFile(path.join(rootPath, "a.md"), source, "utf8");
    await rebuildMachineIndex(vault, cwd);
    const machine = await getMachineIndexResult(vault, cwd);
    await assert.rejects(
      () => promote(vault, machine, cwd),
      (error: { code?: string }) =>
        error.code === "related-metadata-unsupported" ||
        error.code === "related-metadata-malformed",
    );
    assert.equal(await fs.readFile(path.join(rootPath, "a.md"), "utf8"), source);
    const curation = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
    assert.equal(curation.decisions[0]?.decision, "kept");
  }
});

test("optimistic conflict leaves source and kept curation unchanged", async (t) => {
  const { cwd, rootPath, vault, machine } = await fixture(t);
  const before = await readVaultFile(vault, "a.md");
  await fs.writeFile(path.join(rootPath, "a.md"), "# External edit\n", "utf8");
  await assert.rejects(
    () =>
      promoteKeptRelationshipToMetadata(
        vault,
        machine.data,
        { ownerPath: "a.md", targetPath: "b.md", expectedHash: before.hash },
        cwd,
      ),
    (error: { code?: string }) => error.code === "VAULT_FILE_CONFLICT",
  );
  assert.equal(await fs.readFile(path.join(rootPath, "a.md"), "utf8"), "# External edit\n");
  const curation = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
  assert.equal(curation.decisions[0]?.decision, "kept");
});

test("source publication failure preserves both the original source and kept decision", async (t) => {
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
  await assert.rejects(() => promote(vault, machine, cwd), { code: "EIO" });
  fs.rename = originalRename;
  assert.equal(await fs.readFile(target, "utf8"), original);
  const curation = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
  assert.equal(curation.decisions[0]?.decision, "kept");
  assert.equal(
    (await fs.readdir(rootPath)).some((entry) => entry.includes(".tmp")),
    false,
  );
});

test("curation-clear failure after publication returns bounded success and never rolls back source", async (t) => {
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
  const result = await promote(vault, machine, cwd);
  fs.rename = originalRename;
  assert.equal(result.status, "promoted");
  assert.equal(
    result.curationDiagnostic,
    "The canonical relationship is present, but its AREPO curation decision could not be cleared.",
  );
  assert.equal(JSON.stringify(result).includes("/private/example"), false);
  assert.match(await fs.readFile(path.join(rootPath, "a.md"), "utf8"), /related:/);
  const curation = await readRelatedNotesCuration(vault, machine, undefined, true, cwd);
  assert.equal(curation.decisions[0]?.decision, "kept");
});

test("promotion requires readIndex, readContent, and writeContent and Markdown paths", async (t) => {
  for (const deniedPermission of ["readIndex", "readContent", "writeContent"] as const) {
    const { cwd, vault, machine } = await fixture(t, { [deniedPermission]: false });
    await assert.rejects(
      () =>
        promoteKeptRelationshipToMetadata(
          vault,
          machine.data,
          { ownerPath: "a.md", targetPath: "b.md", expectedHash: "a".repeat(64) },
          cwd,
        ),
      (error: { code?: string }) => error.code === "relationship-promotion-not-permitted",
    );
  }
  const { cwd, vault, machine } = await fixture(t);
  await assert.rejects(
    () =>
      promoteKeptRelationshipToMetadata(
        vault,
        machine.data,
        { ownerPath: "a.txt", targetPath: "b.md", expectedHash: "a".repeat(64) },
        cwd,
      ),
    (error: { code?: string }) => error.code === "invalid-relationship-promotion",
  );
});
