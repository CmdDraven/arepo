import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildVaultIndex } from "./vaultFs.js";
import { getVaultStorageSummary } from "./storage.js";
import { writeMachineIndex } from "./indexCache.js";
import type { VaultInfo } from "./types.js";

async function makeVault(): Promise<{ cwd: string; vault: VaultInfo }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-storage-cwd-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-storage-vault-"));
  return {
    cwd,
    vault: {
      id: "storage-test",
      displayName: "Storage Test",
      rootPath,
      permissions: {
        readIndex: true,
        readContent: true,
        writeContent: true,
        deleteFiles: false,
      },
    },
  };
}

async function writeFile(root: string, rel: string, content: string | Buffer): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

test("storage summary counts normal nested files", async () => {
  const { cwd, vault } = await makeVault();
  await writeFile(vault.rootPath, "a.md", "12345");
  await writeFile(vault.rootPath, "nested/b.txt", "123");
  await writeFile(vault.rootPath, "assets/image.bin", Buffer.alloc(7));

  const summary = await getVaultStorageSummary(vault, cwd);

  assert.equal(summary.total.fileCount, 3);
  assert.equal(summary.total.bytes, 15);
  assert.equal(summary.markdownText.fileCount, 2);
  assert.equal(summary.markdownText.bytes, 8);
  assert.equal(summary.attachments.fileCount, 1);
  assert.equal(summary.attachments.bytes, 7);
});

test("storage summary classifies Markdown/text separately from attachments", async () => {
  const { cwd, vault } = await makeVault();
  await writeFile(vault.rootPath, "note.markdown", "abcd");
  await writeFile(vault.rootPath, "readme.TXT", "xy");
  await writeFile(vault.rootPath, "pdfs/file.pdf", Buffer.alloc(6));

  const summary = await getVaultStorageSummary(vault, cwd);

  assert.equal(summary.markdownText.fileCount, 2);
  assert.equal(summary.markdownText.bytes, 6);
  assert.equal(summary.attachments.fileCount, 1);
  assert.equal(summary.attachments.bytes, 6);
});

test("storage summary skips symlinks", async (t) => {
  const { cwd, vault } = await makeVault();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-storage-outside-"));
  await writeFile(vault.rootPath, "note.md", "inside");
  await fs.writeFile(path.join(outside, "outside.md"), "outside-content");
  try {
    await fs.symlink(path.join(outside, "outside.md"), path.join(vault.rootPath, "linked.md"));
    await fs.symlink(outside, path.join(vault.rootPath, "linked-dir"), "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks unavailable");
      return;
    }
    throw error;
  }

  const summary = await getVaultStorageSummary(vault, cwd);

  assert.equal(summary.total.fileCount, 1);
  assert.equal(summary.total.bytes, 6);
  assert.equal(summary.markdownText.fileCount, 1);
});

test("storage summary reports zero for missing index cache", async () => {
  const { cwd, vault } = await makeVault();
  await writeFile(vault.rootPath, "note.md", "# Note\n");

  const summary = await getVaultStorageSummary(vault, cwd);

  assert.equal(summary.appDataCache.fileCount, 0);
  assert.equal(summary.appDataCache.bytes, 0);
  assert.equal(summary.appDataCache.machineIndexBytes, 0);
  assert.deepEqual(summary.appDataCache.files, []);
});

test("storage summary includes generated machine index cache bytes", async () => {
  const { cwd, vault } = await makeVault();
  await writeFile(vault.rootPath, "note.md", "# Note\n");
  await writeMachineIndex(vault, await buildVaultIndex(vault), cwd);

  const summary = await getVaultStorageSummary(vault, cwd);

  assert.equal(summary.appDataCache.fileCount, 1);
  assert.equal(summary.appDataCache.bytes > 0, true);
  assert.equal(summary.appDataCache.machineIndexBytes, summary.appDataCache.bytes);
  assert.equal(summary.appDataCache.files[0]?.kind, "machine-index");
});
