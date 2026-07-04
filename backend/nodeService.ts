import { getNodeInfo, getVault, loadConfig, resolveAppDataDir } from "./config.js";
import { getCredentialLifecycleStatus } from "./credentialLifecycle.js";
import { resolveAuthPosture, resolveBackendRuntimeOptions } from "./nodeRuntime.js";
import { buildProtectedModeReadinessManifest } from "./protectedModeReadiness.js";
import { assessProtectedModeStartup } from "./protectedModeStartup.js";
import { getRequestPolicyRuntimeStatus } from "./requestPolicyStatus.js";
import { getVaultRuntimeStatus, startConfiguredVaultWatchers } from "./vaultWatch.js";
import type {
  LocalNodeHealth,
  LocalNodeRuntimeStatus,
  LocalNodeVaultRuntimeSummary,
  NodeInfo,
  VaultConfigFile,
  VaultInfo,
  VaultRuntimeStatus,
} from "./types.js";

export type LocalNodeContext = {
  config: VaultConfigFile;
  node: NodeInfo;
};

export async function loadLocalNode(cwd = process.cwd()): Promise<LocalNodeContext> {
  const config = await loadConfig(cwd);
  return { config, node: { ...config.node, vaults: config.vaults } };
}

export async function startLocalNode(cwd = process.cwd()): Promise<LocalNodeContext> {
  const context = await loadLocalNode(cwd);
  await startConfiguredVaultWatchers(context.node.vaults, cwd);
  return context;
}

export async function getLocalNodeInfo(cwd = process.cwd()): Promise<NodeInfo> {
  return getNodeInfo(cwd);
}

export async function getLocalNodeHealth(cwd = process.cwd()): Promise<LocalNodeHealth> {
  const node = await getNodeInfo(cwd);
  return {
    ok: true,
    node: {
      nodeId: node.nodeId,
      displayName: node.displayName,
      mode: node.mode,
      apiVersion: node.apiVersion,
    },
  };
}

export async function getLocalNodeRuntimeStatus(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalNodeRuntimeStatus> {
  const { config, node } = await startLocalNode(cwd);
  const runtime = resolveBackendRuntimeOptions(env);
  const appDataDir = resolveAppDataDir(config, cwd);
  const localOnlyMode = node.mode === "local" && runtime.nonLocalWarning === undefined;
  const auth = resolveAuthPosture(config.auth, runtime);
  const requestPolicy = getRequestPolicyRuntimeStatus(config.auth);
  const protectedModeStartup = await assessProtectedModeStartup({
    auth: config.auth,
    appDataDir,
    vaultRoots: node.vaults.map((vault) => vault.rootPath),
    runtime,
  });
  const credentialLifecycle = await getCredentialLifecycleStatus(
    appDataDir,
    node.vaults.map((vault) => vault.rootPath),
  );
  const vaultStatuses = await Promise.all(
    node.vaults.map(async (vault) => summarizeVaultRuntime(vault, cwd)),
  );
  return {
    ok: true,
    node: {
      nodeId: node.nodeId,
      displayName: node.displayName,
      mode: node.mode,
      apiVersion: node.apiVersion,
    },
    runtime: {
      host: runtime.host,
      port: runtime.port,
      localOnlyMode,
      allowedOrigins: runtime.allowedOrigins,
      startupWarnings: runtime.nonLocalWarning ? [runtime.nonLocalWarning] : [],
    },
    auth,
    requestPolicy,
    protectedModeStartup,
    protectedModeReadiness: buildProtectedModeReadinessManifest({
      auth,
      startup: protectedModeStartup,
      requestPolicy,
      credentialLifecycle,
      localOnlyMode,
    }),
    credentialLifecycle,
    vaultCount: node.vaults.length,
    vaults: vaultStatuses,
    capabilities: {
      storageSummary: true,
      remoteNodes: false,
      authentication: false,
      sync: false,
      ai: false,
      database: false,
      migrationSupport: false,
    },
  };
}

export async function getLocalVault(vaultId: string, cwd = process.cwd()): Promise<VaultInfo> {
  return getVault(vaultId, cwd);
}

async function summarizeVaultRuntime(
  vault: VaultInfo,
  cwd: string,
): Promise<LocalNodeVaultRuntimeSummary> {
  try {
    const status = await getVaultRuntimeStatus(vault, cwd);
    return toVaultRuntimeSummary(vault, status);
  } catch (error) {
    return {
      vaultId: vault.id,
      displayName: vault.displayName,
      indexStatus: "error",
      changedExternally: false,
      watcherHealth: "error",
      changedPathCount: 0,
      addedPathCount: 0,
      deletedPathCount: 0,
      storageSummaryAvailable: false,
      error: error instanceof Error ? error.message : "Vault runtime status failed",
    };
  }
}

function toVaultRuntimeSummary(
  vault: VaultInfo,
  status: VaultRuntimeStatus,
): LocalNodeVaultRuntimeSummary {
  return {
    vaultId: vault.id,
    displayName: vault.displayName,
    indexStatus: status.indexStatus,
    changedExternally: status.changedExternally,
    watcherHealth: status.indexStatus === "fresh" ? "ok" : status.indexStatus,
    changedPathCount: status.changedPaths.length,
    addedPathCount: status.addedPaths.length,
    deletedPathCount: status.deletedPaths.length,
    lastEventAt: status.lastEventAt,
    lastIndexedAt: status.lastIndexedAt,
    storageSummaryAvailable: true,
    error: status.error,
  };
}
