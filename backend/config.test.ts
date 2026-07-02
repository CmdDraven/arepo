import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, resolveAppDataDir } from "./config.js";

async function writeConfig(cwd: string, config: unknown): Promise<void> {
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    typeof config === "string" ? config : JSON.stringify(config),
    "utf8",
  );
}

test("config validation rejects parse errors clearly", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-config-"));
  await writeConfig(cwd, "{bad json");
  await assert.rejects(() => loadConfig(cwd), /Invalid AREPO config JSON/);
});

test("config validation rejects duplicate vault ids and missing roots", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-config-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
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
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-config-"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-root-"));
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

test("config validation rejects unsafe local node identity", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-config-"));
  await writeConfig(cwd, {
    node: {
      nodeId: "local node",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    vaults: [],
  });
  await assert.rejects(() => loadConfig(cwd), /nodeId must contain only/);

  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "",
      mode: "local",
      apiVersion: 1,
    },
    vaults: [],
  });
  await assert.rejects(() => loadConfig(cwd), /node displayName must be a non-empty string/);
});

test("config validation rejects unsupported node modes", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-config-"));
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "remote",
      apiVersion: 1,
    },
    vaults: [],
  });
  await assert.rejects(() => loadConfig(cwd), /only local node mode is supported in V1/);
});

test("auth config defaults to disabled when omitted", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-config-"));
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    vaults: [],
  });

  const config = await loadConfig(cwd);
  assert.deepEqual(config.auth, { mode: "disabled" });
});

test("config validation rejects unsupported auth modes", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-config-"));
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    auth: {
      mode: "token",
    },
    vaults: [],
  });

  await assert.rejects(() => loadConfig(cwd), /unsupported auth mode "token"/);
});

test("app data directory can be configured in local config", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "arepo-config-"));
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
