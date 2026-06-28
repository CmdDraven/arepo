import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, resolveAppDataDir } from "./config.js";

async function writeConfig(cwd: string, config: unknown): Promise<void> {
  await fs.mkdir(path.join(cwd, ".mdatlas"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".mdatlas", "config.json"),
    typeof config === "string" ? config : JSON.stringify(config),
    "utf8",
  );
}

test("config validation rejects parse errors clearly", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-config-"));
  await writeConfig(cwd, "{bad json");
  await assert.rejects(() => loadConfig(cwd), /Invalid mdAtlas config JSON/);
});

test("config validation rejects duplicate vault ids and missing roots", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-config-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-root-"));
  const permissions = {
    readIndex: true,
    readContent: true,
    writeContent: true,
    deleteFiles: false,
  };
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    vaults: [
      { id: "same", displayName: "One", rootPath, permissions },
      { id: "same", displayName: "Two", rootPath, permissions },
    ],
  });
  await assert.rejects(() => loadConfig(cwd), /duplicate vault id/);

  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    vaults: [
      {
        id: "missing",
        displayName: "Missing",
        rootPath: path.join(rootPath, "does-not-exist"),
        permissions,
      },
    ],
  });
  await assert.rejects(() => loadConfig(cwd), /rootPath is not accessible/);
});

test("config validation rejects unsafe permission shapes", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-config-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-root-"));
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    vaults: [
      {
        id: "bad",
        displayName: "Bad",
        rootPath,
        permissions: {
          readIndex: true,
          readContent: false,
          writeContent: true,
          deleteFiles: false,
        },
      },
    ],
  });
  await assert.rejects(() => loadConfig(cwd), /must allow readContent/);
});

test("app data directory can be configured in local config", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "mdatlas-config-"));
  const appDataDir = path.join(cwd, "app-data");
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    appDataDir: "app-data",
    vaults: [],
  });

  const config = await loadConfig(cwd);
  assert.equal(config.appDataDir, "app-data");
  assert.equal(resolveAppDataDir(config, cwd), appDataDir);
});
