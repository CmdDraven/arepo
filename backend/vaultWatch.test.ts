import test from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { getVaultRuntimeStatus, stopVaultWatcher } from "./vaultWatch.js";
import type { VaultInfo } from "./types.js";

test("vault runtime status bounds watcher filesystem failures", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-watch-status-");
  const rootPath = await makeTestTempDir(t, "arepo-watch-root-");
  await fs.writeFile(path.join(rootPath, "note.md"), "# Note\n", "utf8");
  const vault: VaultInfo = {
    id: "watcher-error-vault",
    displayName: "Watcher error vault",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
    vaultIndexScope: { markdown: { minDepth: 0, maxDepth: null } },
  };
  const originalWatch = fsSync.watch;
  const sensitivePath = "/private/example/watcher-secret.md";
  t.after(() => {
    fsSync.watch = originalWatch;
    stopVaultWatcher(cwd, vault.id);
  });
  fsSync.watch = (() => {
    throw Object.assign(new Error(`EACCES: permission denied, watch '${sensitivePath}'`), {
      code: "EACCES",
      syscall: "watch",
      path: sensitivePath,
    });
  }) as typeof fsSync.watch;

  const status = await getVaultRuntimeStatus(vault, cwd);
  assert.equal(status.indexStatus, "error");
  assert.equal(status.error, "Unable to watch vault directory.");
  const serialized = JSON.stringify(status);
  for (const hidden of [sensitivePath, "EACCES", "permission denied", "syscall"]) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});
