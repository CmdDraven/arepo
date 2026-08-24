import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildVaultIndex } from "./vaultFs.js";
import { machineIndexPath, rebuildMachineIndex, writeMachineIndex } from "./indexCache.js";
import type { VaultInfo } from "./types.js";

async function makeVault(): Promise<{ cwd: string; vault: VaultInfo }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-index-cache-cwd-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-index-cache-vault-"));
  await writeFile(rootPath, "note.md", "# Note\n\nbody-only-cache-secret\n\n[[other]]\n");
  await writeFile(rootPath, "other.md", "# Other\n");
  return {
    cwd,
    vault: {
      id: "index-cache-test",
      displayName: "Index Cache Test",
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

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

test("machine index cache writes tolerate concurrent writes to the same vault", async () => {
  const { cwd, vault } = await makeVault();
  const data = await buildVaultIndex(vault);

  await Promise.all(Array.from({ length: 40 }, () => writeMachineIndex(vault, data, cwd)));

  const cacheFile = await machineIndexPath(vault, cwd);
  const raw = await fs.readFile(cacheFile, "utf8");
  const stored = JSON.parse(raw) as {
    kind: string;
    version: number;
    data: { index: { notes: Record<string, Record<string, unknown>> } };
  };
  const cacheDirFiles = await fs.readdir(path.dirname(cacheFile));

  assert.equal(stored.kind, "arepo.machineIndex");
  assert.equal(stored.version, 2);
  assert.equal(raw.includes("body-only-cache-secret"), false);
  assert.equal(
    Object.values(stored.data.index.notes).some((note) => Object.hasOwn(note, "body")),
    false,
  );
  assert.equal(cacheDirFiles.filter((file) => file.endsWith(".tmp")).length, 0);
});

test("concurrent machine index rebuilds do not leave a broken cache file", async () => {
  const { cwd, vault } = await makeVault();

  const results = await Promise.all(
    Array.from({ length: 20 }, () => rebuildMachineIndex(vault, cwd)),
  );

  const cacheFile = await machineIndexPath(vault, cwd);
  const stored = JSON.parse(await fs.readFile(cacheFile, "utf8")) as {
    kind: string;
    data: { index: { notes: Record<string, unknown> } };
  };
  const cacheDirFiles = await fs.readdir(path.dirname(cacheFile));

  assert.equal(
    results.every((result) => Object.keys(result.index.notes).length === 2),
    true,
  );
  assert.equal(stored.kind, "arepo.machineIndex");
  assert.equal(Object.keys(stored.data.index.notes).length, 2);
  assert.equal(cacheDirFiles.filter((file) => file.endsWith(".tmp")).length, 0);
});
