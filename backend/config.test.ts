import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTestTempDir } from "./testTemp.js";
import { getNodeInfo, loadConfig, resolveAppDataDir } from "./config.js";

async function writeConfig(cwd: string, config: unknown): Promise<void> {
  await fs.mkdir(path.join(cwd, ".arepo"), { recursive: true });
  await fs.writeFile(
    path.join(cwd, ".arepo", "config.json"),
    typeof config === "string" ? config : JSON.stringify(config),
    "utf8",
  );
}

test("config validation rejects parse errors clearly", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  await writeConfig(cwd, "{bad json");
  await assert.rejects(() => loadConfig(cwd), /Invalid AREPO config JSON/);
});

test("config validation rejects duplicate vault ids but accepts a missing runtime root", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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
  const config = await loadConfig(cwd);
  assert.equal(config.vaults[0]?.id, "missing");
  const node = await getNodeInfo(cwd);
  assert.deepEqual(node.vaults[0]?.availability, {
    status: "unavailable",
    reason: "root-not-found",
  });
});

test("a structurally valid file root is reported as unavailable without invalidating config", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  const rootFile = path.join(cwd, "not-a-directory");
  await fs.writeFile(rootFile, "file", "utf8");
  await writeConfig(cwd, {
    node: { nodeId: "local", displayName: "Local Node", mode: "local", apiVersion: 1 },
    vaults: [
      {
        id: "file-root",
        displayName: "File root",
        rootPath: rootFile,
        permissions: {
          readIndex: true,
          readContent: true,
          writeContent: true,
          deleteFiles: false,
        },
      },
    ],
  });

  assert.equal((await loadConfig(cwd)).vaults[0]?.id, "file-root");
  assert.deepEqual((await getNodeInfo(cwd)).vaults[0]?.availability, {
    status: "unavailable",
    reason: "root-not-directory",
  });
});

test("structural config validation still rejects malformed root path values", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  const config = {
    node: { nodeId: "local", displayName: "Local Node", mode: "local", apiVersion: 1 },
    vaults: [
      {
        id: "bad-root",
        displayName: "Bad root",
        rootPath: "relative/root",
        permissions: {
          readIndex: true,
          readContent: true,
          writeContent: true,
          deleteFiles: false,
        },
      },
    ],
  };
  await writeConfig(cwd, config);
  await assert.rejects(() => loadConfig(cwd), /rootPath must be absolute/);

  config.vaults[0]!.rootPath = `/tmp/bad\0root`;
  await writeConfig(cwd, config);
  await assert.rejects(() => loadConfig(cwd), /rootPath cannot contain null bytes/);
});

test("config validation rejects unsafe permission shapes", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
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

test("vaultIndexScope defaults to unlimited Markdown depth when omitted", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    vaults: [
      {
        id: "scoped",
        displayName: "Scoped",
        rootPath,
        permissions: {
          readIndex: true,
          readContent: true,
          writeContent: true,
          deleteFiles: false,
        },
      },
    ],
  });

  const config = await loadConfig(cwd);
  assert.deepEqual(config.vaults[0]?.vaultIndexScope, {
    markdown: {
      minDepth: 0,
      maxDepth: null,
    },
  });
});

test("config validation rejects invalid vaultIndexScope values", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  const rootPath = await makeTestTempDir(t, "arepo-root-");
  const baseVault = {
    id: "bad-scope",
    displayName: "Bad Scope",
    rootPath,
    permissions: {
      readIndex: true,
      readContent: true,
      writeContent: true,
      deleteFiles: false,
    },
  };
  const baseConfig = {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
  };

  await writeConfig(cwd, {
    ...baseConfig,
    vaults: [
      {
        ...baseVault,
        vaultIndexScope: { markdown: { minDepth: -1, maxDepth: null } },
      },
    ],
  });
  await assert.rejects(() => loadConfig(cwd), /minDepth must be an integer >= 0/);

  await writeConfig(cwd, {
    ...baseConfig,
    vaults: [
      {
        ...baseVault,
        vaultIndexScope: { markdown: { minDepth: 2, maxDepth: 1 } },
      },
    ],
  });
  await assert.rejects(() => loadConfig(cwd), /maxDepth must be null or an integer >= minDepth/);

  await writeConfig(cwd, {
    ...baseConfig,
    vaults: [
      {
        ...baseVault,
        vaultIndexScope: { markdown: { maxDepth: null } },
      },
    ],
  });
  await assert.rejects(() => loadConfig(cwd), /minDepth must be an integer >= 0/);
});

test("config validation rejects unsafe local node identity", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
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

test("config validation rejects unsupported node modes", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
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

test("auth config defaults to disabled when omitted", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
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

test("disabled auth config remains the default compatibility mode", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    auth: {
      mode: "disabled",
    },
    vaults: [],
  });

  const config = await loadConfig(cwd);
  assert.deepEqual(config.auth, { mode: "disabled" });
});

test("auth dry-run request policy defaults off and can be enabled explicitly", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    auth: {
      mode: "disabled",
      dryRunRequestPolicy: true,
      dryRunAudit: true,
    },
    vaults: [],
  });

  const config = await loadConfig(cwd);
  assert.equal(config.auth.mode, "disabled");
  assert.equal(config.auth.dryRunRequestPolicy, true);
  assert.equal(config.auth.dryRunAudit, true);
});

test("protected auth config is persisted as an operational mode request", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    auth: {
      mode: "protected",
    },
    vaults: [],
  });

  const config = await loadConfig(cwd);
  assert.equal(config.auth.mode, "protected");
  assert.equal(config.auth.requestedMode, undefined);
  assert.equal(config.auth.protectedModeUnavailableReason, undefined);
});

test("config validation rejects unsupported auth modes", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
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

test("config validation rejects unsupported requested auth modes", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    auth: {
      mode: "disabled",
      requestedMode: "session",
    },
    vaults: [],
  });

  await assert.rejects(() => loadConfig(cwd), /unsupported requested auth mode "session"/);
});

test("config validation rejects non-boolean auth dry-run request policy", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    auth: {
      mode: "disabled",
      dryRunRequestPolicy: "yes",
    },
    vaults: [],
  });

  await assert.rejects(() => loadConfig(cwd), /auth\.dryRunRequestPolicy must be boolean/);
});

test("config validation rejects non-boolean auth dry-run audit flag", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    auth: {
      mode: "disabled",
      dryRunAudit: "yes",
    },
    vaults: [],
  });

  await assert.rejects(() => loadConfig(cwd), /auth\.dryRunAudit must be boolean/);
});

test("config validation rejects disabled requested mode when protected mode is active", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
  await writeConfig(cwd, {
    node: {
      nodeId: "local",
      displayName: "Local Node",
      mode: "local",
      apiVersion: 1,
    },
    auth: {
      mode: "protected",
      requestedMode: "disabled",
    },
    vaults: [],
  });

  await assert.rejects(
    () => loadConfig(cwd),
    /auth\.requestedMode cannot be disabled while auth\.mode is protected/,
  );
});

test("app data directory can be configured in local config", async (t) => {
  const cwd = await makeTestTempDir(t, "arepo-config-");
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
