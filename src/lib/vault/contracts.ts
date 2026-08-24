import type { ValidationIssue, VaultIndex } from "./indexer.js";

export type NodeMode = "local" | "remote";

export type VaultPermission = {
  readIndex: boolean;
  readContent: boolean;
  writeContent: boolean;
  deleteFiles: boolean;
};

export type VaultIndexScope = {
  markdown: {
    minDepth: number;
    maxDepth: number | null;
  };
};

export type VaultInfo = {
  id: string;
  displayName: string;
  rootPath: string;
  permissions: VaultPermission;
  vaultIndexScope?: VaultIndexScope;
};

export type NodeInfo = {
  nodeId: string;
  displayName: string;
  mode: NodeMode;
  apiVersion: 1;
  vaults: VaultInfo[];
};

export type VaultFileKind = "markdown" | "plain-text" | "chat-json";

export type VaultFile = {
  path: string;
  kind: VaultFileKind;
  size: number;
  mtimeMs: number;
};

export type VaultFileListResponse = {
  files: VaultFile[];
  folders: string[];
};

export type VaultFileResponse = VaultFile & {
  content: string;
  hash: string;
};

export type VaultFileWriteResponse = Omit<VaultFileResponse, "content">;

export type OperationResult<T> =
  { ok: true; data: T } | { ok: false; error: string; code?: string };

export type VaultIndexResponse = {
  index: VaultIndex;
  issues: ValidationIssue[];
};
