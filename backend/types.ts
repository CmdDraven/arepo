import type { VaultIndex, ValidationIssue } from "../src/lib/vault/indexer.js";

export type NodeMode = "local" | "remote";

export type VaultPermission = {
  readIndex: boolean;
  readContent: boolean;
  writeContent: boolean;
  deleteFiles: boolean;
};

export type VaultInfo = {
  id: string;
  displayName: string;
  rootPath: string;
  permissions: VaultPermission;
};

export type NodeInfo = {
  nodeId: string;
  displayName: string;
  mode: NodeMode;
  apiVersion: 1;
  vaults: VaultInfo[];
};

export type VaultFile = {
  path: string;
  size: number;
  mtimeMs: number;
};

export type OperationResult<T = unknown> =
  { ok: true; data?: T } | { ok: false; error: string; code?: string };

export type VaultConfigFile = {
  node: Omit<NodeInfo, "vaults">;
  appDataDir?: string;
  vaults: VaultInfo[];
};

export type VaultIndexResponse = {
  index: VaultIndex;
  issues: ValidationIssue[];
};

export const DEFAULT_PERMISSIONS: VaultPermission = {
  readIndex: true,
  readContent: true,
  writeContent: true,
  deleteFiles: false,
};
