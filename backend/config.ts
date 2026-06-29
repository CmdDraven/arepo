import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import {
  DEFAULT_PERMISSIONS,
  type NodeInfo,
  type VaultConfigFile,
  type VaultInfo,
} from "./types.js";

const DEFAULT_CONFIG: VaultConfigFile = {
  node: {
    nodeId: "local",
    displayName: "Local Node",
    mode: "local",
    apiVersion: 1,
  },
  vaults: [],
};

const APP_DATA_ENV = "AREPO_APP_DATA_DIR";

export function configPath(cwd = process.cwd()): string {
  return path.join(cwd, ".arepo", "config.json");
}

export async function loadConfig(cwd = process.cwd()): Promise<VaultConfigFile> {
  const file = configPath(cwd);
  try {
    const raw = await fs.readFile(file, "utf8");
    let parsed: Partial<VaultConfigFile>;
    try {
      parsed = JSON.parse(raw) as Partial<VaultConfigFile>;
    } catch (error) {
      throw new Error(
        `Invalid AREPO config JSON at ${file}: ${
          error instanceof Error ? error.message : "parse failed"
        }`,
      );
    }
    const config = {
      node: { ...DEFAULT_CONFIG.node, ...parsed.node },
      appDataDir:
        typeof parsed.appDataDir === "string" && parsed.appDataDir.trim()
          ? parsed.appDataDir.trim()
          : undefined,
      vaults: Array.isArray(parsed.vaults)
        ? parsed.vaults.map((vault) => ({
            ...vault,
            permissions: {
              ...DEFAULT_PERMISSIONS,
              ...vault.permissions,
            },
          }))
        : [],
    };
    await validateConfig(config, file);
    return config;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
    await saveConfig(DEFAULT_CONFIG, cwd);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: VaultConfigFile, cwd = process.cwd()): Promise<void> {
  await validateConfig(config, configPath(cwd));
  const file = configPath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

export async function getNodeInfo(cwd = process.cwd()): Promise<NodeInfo> {
  const config = await loadConfig(cwd);
  return { ...config.node, vaults: config.vaults };
}

export async function getVault(vaultId: string, cwd = process.cwd()): Promise<VaultInfo> {
  const config = await loadConfig(cwd);
  const vault = config.vaults.find((item) => item.id === vaultId);
  if (!vault) throw new Error(`Unknown vault: ${vaultId}`);
  return vault;
}

export async function getAppDataDir(cwd = process.cwd()): Promise<string> {
  const config = await loadConfig(cwd);
  return resolveAppDataDir(config, cwd);
}

export function resolveAppDataDir(
  config: Pick<VaultConfigFile, "appDataDir">,
  cwd: string,
): string {
  const fromEnv = process.env[APP_DATA_ENV]?.trim();
  if (fromEnv) return path.resolve(expandHome(fromEnv));
  if (config.appDataDir) return path.resolve(cwd, expandHome(config.appDataDir));
  if (isProjectDevDirectory(cwd)) return path.join(cwd, ".arepo", "data");
  if (process.platform === "linux" && os.homedir()) {
    return path.join(os.homedir(), ".local", "share", "arepo");
  }
  return path.join(cwd, ".arepo", "data");
}

async function validateConfig(config: VaultConfigFile, file: string): Promise<void> {
  if (!config || typeof config !== "object") {
    throw new Error(`Invalid AREPO config at ${file}: config must be an object`);
  }
  if (!config.node || typeof config.node !== "object") {
    throw new Error(`Invalid AREPO config at ${file}: node is required`);
  }
  if (config.node.mode !== "local") {
    throw new Error(`Invalid AREPO config at ${file}: only local node mode is supported in V1`);
  }
  if (config.node.apiVersion !== 1) {
    throw new Error(`Invalid AREPO config at ${file}: apiVersion must be 1`);
  }
  if (config.appDataDir !== undefined) {
    if (typeof config.appDataDir !== "string" || !config.appDataDir.trim()) {
      throw new Error(`Invalid AREPO config at ${file}: appDataDir must be a non-empty string`);
    }
    if (config.appDataDir.includes("\0")) {
      throw new Error(`Invalid AREPO config at ${file}: appDataDir cannot contain null bytes`);
    }
  }
  if (!Array.isArray(config.vaults)) {
    throw new Error(`Invalid AREPO config at ${file}: vaults must be an array`);
  }

  const seenIds = new Set<string>();
  for (const vault of config.vaults) {
    if (!vault || typeof vault !== "object") {
      throw new Error(`Invalid AREPO config at ${file}: each vault must be an object`);
    }
    if (typeof vault.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(vault.id)) {
      throw new Error(
        `Invalid AREPO config at ${file}: vault id must contain only letters, numbers, _ or -`,
      );
    }
    if (seenIds.has(vault.id)) {
      throw new Error(`Invalid AREPO config at ${file}: duplicate vault id "${vault.id}"`);
    }
    seenIds.add(vault.id);

    if (typeof vault.displayName !== "string" || !vault.displayName.trim()) {
      throw new Error(`Invalid AREPO config at ${file}: vault ${vault.id} needs displayName`);
    }
    if (typeof vault.rootPath !== "string" || !path.isAbsolute(vault.rootPath)) {
      throw new Error(
        `Invalid AREPO config at ${file}: vault ${vault.id} rootPath must be absolute`,
      );
    }
    const stat = await fs.stat(vault.rootPath).catch((error) => {
      throw new Error(
        `Invalid AREPO config at ${file}: vault ${vault.id} rootPath is not accessible: ${
          error instanceof Error ? error.message : "stat failed"
        }`,
      );
    });
    if (!stat.isDirectory()) {
      throw new Error(
        `Invalid AREPO config at ${file}: vault ${vault.id} rootPath is not a directory`,
      );
    }

    const permissions = vault.permissions;
    if (!permissions || typeof permissions !== "object") {
      throw new Error(`Invalid AREPO config at ${file}: vault ${vault.id} permissions required`);
    }
    for (const key of ["readIndex", "readContent", "writeContent", "deleteFiles"] as const) {
      if (typeof permissions[key] !== "boolean") {
        throw new Error(
          `Invalid AREPO config at ${file}: vault ${vault.id} permission ${key} must be boolean`,
        );
      }
    }
    if (!permissions.readIndex) {
      throw new Error(
        `Invalid AREPO config at ${file}: vault ${vault.id} must allow readIndex in local mode`,
      );
    }
    if (!permissions.readContent) {
      throw new Error(
        `Invalid AREPO config at ${file}: vault ${vault.id} must allow readContent in local mode`,
      );
    }
    if (!permissions.readContent && permissions.writeContent) {
      throw new Error(
        `Invalid AREPO config at ${file}: vault ${vault.id} cannot writeContent without readContent`,
      );
    }
    if (permissions.deleteFiles && !permissions.writeContent) {
      throw new Error(
        `Invalid AREPO config at ${file}: vault ${vault.id} cannot deleteFiles without writeContent`,
      );
    }
  }
}

export async function addVault(
  input: {
    id?: unknown;
    displayName?: unknown;
    rootPath?: unknown;
    permissions?: unknown;
  },
  cwd = process.cwd(),
): Promise<VaultInfo> {
  if (!input.rootPath || typeof input.rootPath !== "string") {
    throw new Error("rootPath is required");
  }
  const rootPath = path.resolve(input.rootPath);
  const stat = await fs.stat(rootPath);
  if (!stat.isDirectory()) throw new Error("rootPath must be a directory");

  const config = await loadConfig(cwd);
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const requestedId = typeof input.id === "string" ? input.id.trim() : "";
  const permissions =
    input.permissions && typeof input.permissions === "object" && !Array.isArray(input.permissions)
      ? (input.permissions as Partial<VaultInfo["permissions"]>)
      : {};
  const baseId =
    requestedId ||
    slugify(displayName || path.basename(rootPath)) ||
    `vault-${crypto.randomUUID().slice(0, 8)}`;
  const id = uniqueId(
    baseId,
    config.vaults.map((vault) => vault.id),
  );
  const vault: VaultInfo = {
    id,
    displayName: displayName || path.basename(rootPath),
    rootPath,
    permissions: { ...DEFAULT_PERMISSIONS, ...permissions },
  };
  config.vaults.push(vault);
  await saveConfig(config, cwd);
  return vault;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(baseId: string, existing: string[]): string {
  if (!existing.includes(baseId)) return baseId;
  let i = 2;
  while (existing.includes(`${baseId}-${i}`)) i++;
  return `${baseId}-${i}`;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isProjectDevDirectory(cwd: string): boolean {
  if (process.env.NODE_ENV === "development") return true;
  try {
    const pkg = JSON.parse(fsSync.readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      name?: unknown;
    };
    return pkg.name === "arepo";
  } catch {
    return path.basename(cwd).toLowerCase().includes("arepo");
  }
}
