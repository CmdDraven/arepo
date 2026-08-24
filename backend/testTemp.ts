import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { stopVaultWatchersForDirectory } from "./vaultWatch.js";

export async function makeTestTempDir(t: TestContext, prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await stopVaultWatchersForDirectory(directory);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
