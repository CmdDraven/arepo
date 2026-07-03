import { useCallback, useEffect, useMemo, useState } from "react";
import { buildIndex, type VaultIndex, type ValidationIssue } from "./indexer";

const LAST_VAULT_KEY = "vault:lastVaultId";

type FilesMap = Record<string, string>;
type FileMetaMap = Record<string, { mtimeMs: number; size: number; hash: string }>;

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

export type GeneratedDataAction = "keep" | "discard";

export type RemoveVaultResponse = {
  vault: VaultInfo;
  remainingVaults: VaultInfo[];
  generatedData: {
    action: GeneratedDataAction;
    deletedPaths: string[];
    diagnostics: string[];
  };
};

export type NodeInfo = {
  nodeId: string;
  displayName: string;
  mode: "local" | "remote";
  apiVersion: 1;
  vaults: VaultInfo[];
};

type FileListResponse = {
  files: { path: string; size: number; mtimeMs: number }[];
  folders: string[];
};

export type FileResponse = {
  path: string;
  content: string;
  mtimeMs: number;
  size: number;
  hash: string;
};

type FileWriteResponse = Omit<FileResponse, "content">;

type IndexResponse = {
  index: VaultIndex;
  issues: ValidationIssue[];
};

export type VaultRuntimeStatus = {
  vaultId: string;
  indexStatus: "fresh" | "stale" | "rebuilding" | "error";
  changedExternally: boolean;
  changedPaths: string[];
  addedPaths: string[];
  deletedPaths: string[];
  lastEventAt?: number;
  lastIndexedAt?: number;
  error?: string;
  file?: {
    path: string;
    exists: boolean;
    mtimeMs?: number;
    size?: number;
    hash?: string;
    changedExternally: boolean;
    deletedExternally: boolean;
  };
};

export type HealthResponse = {
  ok: boolean;
  node: {
    nodeId: string;
    displayName: string;
    mode: "local" | "remote";
    apiVersion: 1;
  };
};

type OperationResult<T = unknown> =
  { ok: true; data?: T } | { ok: false; error: string; code?: string };

export type VaultStore = {
  files: FilesMap;
  fileMeta: FileMetaMap;
  index: VaultIndex;
  issues: ValidationIssue[];
  folders: string[];
  vaults: VaultInfo[];
  activeVault: VaultInfo | null;
  loading: boolean;
  error: string | null;
  mutationError: string | null;
  health: HealthResponse | null;
  vaultStatus: VaultRuntimeStatus | null;
  write: (path: string, content: string) => Promise<boolean>;
  overwriteFile: (path: string, content: string) => Promise<boolean>;
  createFile: (path: string) => Promise<boolean>;
  createFileWithContent: (path: string, content: string) => Promise<boolean>;
  createFolder: (path: string) => Promise<boolean>;
  rename: (oldPath: string, newPath: string) => Promise<boolean>;
  remove: (path: string) => Promise<boolean>;
  reindex: () => Promise<boolean>;
  reindexVault: (vaultId: string) => Promise<boolean>;
  hasExternalChange: (path: string) => Promise<boolean>;
  readFileFromDisk: (path: string) => Promise<FileResponse | null>;
  reloadFile: (path: string) => Promise<boolean>;
  refreshActiveVault: () => Promise<boolean>;
  refreshVaultStatus: (path?: string | null) => Promise<VaultRuntimeStatus | null>;
  addVault: (
    rootPath: string,
    displayName?: string,
    permissions?: Partial<VaultPermission>,
  ) => Promise<boolean>;
  removeVault: (
    vaultId: string,
    generatedDataAction: GeneratedDataAction,
  ) => Promise<RemoveVaultResponse | null>;
  refreshNode: () => Promise<boolean>;
  testHealth: () => Promise<boolean>;
  selectVault: (vaultId: string) => void;
};

const EMPTY_INDEX = buildIndex({});

export function useVault(): VaultStore {
  const [node, setNode] = useState<NodeInfo | null>(null);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LAST_VAULT_KEY);
  });
  const [files, setFiles] = useState<FilesMap>({});
  const [fileMeta, setFileMeta] = useState<FileMetaMap>({});
  const [folders, setFolders] = useState<string[]>([]);
  const [index, setIndex] = useState<VaultIndex>(EMPTY_INDEX);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultRuntimeStatus | null>(null);

  const vaults = useMemo(() => node?.vaults ?? [], [node]);
  const activeVault = useMemo(
    () => vaults.find((vault) => vault.id === activeVaultId) ?? vaults[0] ?? null,
    [activeVaultId, vaults],
  );

  const loadNode = useCallback(async () => {
    const nextNode = await api<NodeInfo>("/api/vaults");
    setNode(nextNode);
    if (!activeVaultId && nextNode.vaults[0]) {
      setActiveVaultId(nextNode.vaults[0].id);
    }
  }, [activeVaultId]);

  const testHealth = useCallback(async () => {
    setMutationError(null);
    try {
      const nextHealth = await api<HealthResponse>("/api/health");
      setHealth(nextHealth);
      return true;
    } catch (err) {
      setHealth(null);
      setMutationError(errorMessage(err));
      return false;
    }
  }, []);

  const refreshNode = useCallback(async () => {
    setMutationError(null);
    try {
      await loadNode();
      return true;
    } catch (err) {
      setMutationError(errorMessage(err));
      return false;
    }
  }, [loadNode]);

  const loadVault = useCallback(async (vaultId: string) => {
    const [fileList, indexResponse] = await Promise.all([
      api<FileListResponse>(`/api/vaults/${encodeURIComponent(vaultId)}/files`),
      api<IndexResponse>(`/api/vaults/${encodeURIComponent(vaultId)}/index`),
    ]);
    const fileData = await Promise.all(
      fileList.files.map(async (file) => {
        return api<FileResponse>(
          `/api/vaults/${encodeURIComponent(vaultId)}/file?path=${encodeURIComponent(file.path)}`,
        );
      }),
    );
    const fileEntries = fileData.map((data) => [data.path, data.content] as const);
    const metaEntries = fileData.map(
      (data) => [data.path, { mtimeMs: data.mtimeMs, size: data.size, hash: data.hash }] as const,
    );
    setFiles(Object.fromEntries(fileEntries));
    setFileMeta(Object.fromEntries(metaEntries));
    setFolders(fileList.folders);
    setIndex(indexResponse.index);
    setIssues(indexResponse.issues);
    const status = await api<VaultRuntimeStatus>(
      `/api/vaults/${encodeURIComponent(vaultId)}/status`,
    );
    setVaultStatus(status);
  }, []);

  const refreshActiveVault = useCallback(async () => {
    if (!activeVault) return false;
    setMutationError(null);
    try {
      await loadVault(activeVault.id);
      return true;
    } catch (err) {
      setMutationError(errorMessage(err));
      return false;
    }
  }, [activeVault, loadVault]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadNode()
      .then(() => testHealth())
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadNode, testHealth]);

  useEffect(() => {
    if (!activeVault) {
      setFiles({});
      setFileMeta({});
      setFolders([]);
      setIndex(EMPTY_INDEX);
      setIssues([]);
      setVaultStatus(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_VAULT_KEY, activeVault.id);
    }
    loadVault(activeVault.id)
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeVault, loadVault]);

  const mutate = useCallback(
    async (fn: (vault: VaultInfo) => Promise<void>) => {
      if (!activeVault) {
        setMutationError("No vault selected");
        return false;
      }
      setMutationError(null);
      try {
        await fn(activeVault);
        await loadVault(activeVault.id);
        return true;
      } catch (err) {
        setMutationError(errorMessage(err));
        return false;
      }
    },
    [activeVault, loadVault],
  );

  const write = useCallback(
    (path: string, content: string) =>
      mutate(async (vault) => {
        const meta = fileMeta[path];
        const response = await api<OperationResult<FileWriteResponse>>(
          `/api/vaults/${encodeURIComponent(vault.id)}/file?path=${encodeURIComponent(path)}`,
          {
            method: "PUT",
            body: JSON.stringify({
              content,
              expectedHash: meta?.hash,
              expectedMtimeMs: meta?.mtimeMs,
            }),
          },
        );
        if (response.ok && response.data) {
          setFiles((prev) => ({ ...prev, [response.data.path]: content }));
          setFileMeta((prev) => ({
            ...prev,
            [response.data.path]: {
              mtimeMs: response.data.mtimeMs,
              size: response.data.size,
              hash: response.data.hash,
            },
          }));
        }
      }),
    [fileMeta, mutate],
  );

  const overwriteFile = useCallback(
    (path: string, content: string) =>
      mutate(async (vault) => {
        const current = await api<FileResponse>(
          `/api/vaults/${encodeURIComponent(vault.id)}/file?path=${encodeURIComponent(path)}`,
        );
        const response = await api<OperationResult<FileWriteResponse>>(
          `/api/vaults/${encodeURIComponent(vault.id)}/file?path=${encodeURIComponent(path)}`,
          {
            method: "PUT",
            body: JSON.stringify({
              content,
              expectedHash: current.hash,
              expectedMtimeMs: current.mtimeMs,
            }),
          },
        );
        if (response.ok && response.data) {
          setFiles((prev) => ({ ...prev, [response.data.path]: content }));
          setFileMeta((prev) => ({
            ...prev,
            [response.data.path]: {
              mtimeMs: response.data.mtimeMs,
              size: response.data.size,
              hash: response.data.hash,
            },
          }));
        }
      }),
    [mutate],
  );

  const createFile = useCallback(
    (path: string) =>
      mutate(async (vault) => {
        await api(`/api/vaults/${encodeURIComponent(vault.id)}/file`, {
          method: "POST",
          body: JSON.stringify({ path }),
        });
      }),
    [mutate],
  );

  const createFileWithContent = useCallback(
    (path: string, content: string) =>
      mutate(async (vault) => {
        await api(`/api/vaults/${encodeURIComponent(vault.id)}/file`, {
          method: "POST",
          body: JSON.stringify({ path, content }),
        });
      }),
    [mutate],
  );

  const createFolder = useCallback(
    (path: string) =>
      mutate(async (vault) => {
        await api(`/api/vaults/${encodeURIComponent(vault.id)}/folder`, {
          method: "POST",
          body: JSON.stringify({ path }),
        });
      }),
    [mutate],
  );

  const rename = useCallback(
    (oldPath: string, newPath: string) =>
      mutate(async (vault) => {
        await api(`/api/vaults/${encodeURIComponent(vault.id)}/rename`, {
          method: "POST",
          body: JSON.stringify({
            fromPath: oldPath,
            toPath: newPath,
            kind: "file",
          }),
        });
      }),
    [mutate],
  );

  const remove = useCallback(
    (path: string) =>
      mutate(async (vault) => {
        await api(
          `/api/vaults/${encodeURIComponent(vault.id)}/file?path=${encodeURIComponent(path)}`,
          {
            method: "DELETE",
          },
        );
      }),
    [mutate],
  );

  const reindex = useCallback(
    () =>
      mutate(async (vault) => {
        const response = await api<OperationResult<IndexResponse>>(
          `/api/vaults/${encodeURIComponent(vault.id)}/reindex`,
          { method: "POST" },
        );
        if (response.ok && response.data) {
          setIndex(response.data.index);
          setIssues(response.data.issues);
        }
      }),
    [mutate],
  );

  const reindexVault = useCallback(
    async (vaultId: string) => {
      setMutationError(null);
      try {
        const response = await api<OperationResult<IndexResponse>>(
          `/api/vaults/${encodeURIComponent(vaultId)}/reindex`,
          { method: "POST" },
        );
        if (activeVault?.id === vaultId && response.ok && response.data) {
          setIndex(response.data.index);
          setIssues(response.data.issues);
          await loadVault(vaultId);
        }
        return true;
      } catch (err) {
        setMutationError(errorMessage(err));
        return false;
      }
    },
    [activeVault?.id, loadVault],
  );

  const hasExternalChange = useCallback(
    async (path: string) => {
      if (!activeVault) return false;
      const meta = fileMeta[path];
      if (!meta) return false;
      setMutationError(null);
      try {
        const current = await api<FileResponse>(
          `/api/vaults/${encodeURIComponent(activeVault.id)}/file?path=${encodeURIComponent(path)}`,
        );
        return current.hash !== meta.hash;
      } catch (err) {
        setMutationError(errorMessage(err));
        return true;
      }
    },
    [activeVault, fileMeta],
  );

  const refreshVaultStatus = useCallback(
    async (path?: string | null) => {
      if (!activeVault) return null;
      try {
        const query = path ? `?path=${encodeURIComponent(path)}` : "";
        const status = await api<VaultRuntimeStatus>(
          `/api/vaults/${encodeURIComponent(activeVault.id)}/status${query}`,
        );
        setVaultStatus(status);
        return status;
      } catch (err) {
        setMutationError(errorMessage(err));
        return null;
      }
    },
    [activeVault],
  );

  const readFileFromDisk = useCallback(
    async (path: string) => {
      if (!activeVault) return null;
      setMutationError(null);
      try {
        return await api<FileResponse>(
          `/api/vaults/${encodeURIComponent(activeVault.id)}/file?path=${encodeURIComponent(path)}`,
        );
      } catch (err) {
        setMutationError(errorMessage(err));
        return null;
      }
    },
    [activeVault],
  );

  const reloadFile = useCallback(
    async (path: string) => {
      if (!activeVault) return false;
      setMutationError(null);
      try {
        const data = await api<FileResponse>(
          `/api/vaults/${encodeURIComponent(activeVault.id)}/file?path=${encodeURIComponent(path)}`,
        );
        setFiles((prev) => ({ ...prev, [data.path]: data.content }));
        setFileMeta((prev) => ({
          ...prev,
          [data.path]: { mtimeMs: data.mtimeMs, size: data.size, hash: data.hash },
        }));
        await refreshVaultStatus(path);
        return true;
      } catch (err) {
        setMutationError(errorMessage(err));
        return false;
      }
    },
    [activeVault, refreshVaultStatus],
  );

  const addVault = useCallback(
    async (rootPath: string, displayName?: string, permissions?: Partial<VaultPermission>) => {
      setMutationError(null);
      try {
        const response = await api<OperationResult<{ vault: VaultInfo }>>("/api/vaults", {
          method: "POST",
          body: JSON.stringify({ rootPath, displayName, permissions }),
        });
        if (!response.ok || !response.data) throw new Error("Vault creation failed");
        await loadNode();
        setActiveVaultId(response.data.vault.id);
        return true;
      } catch (err) {
        setMutationError(errorMessage(err));
        return false;
      }
    },
    [loadNode],
  );

  const removeVault = useCallback(
    async (vaultId: string, generatedDataAction: GeneratedDataAction) => {
      setMutationError(null);
      try {
        const response = await api<OperationResult<RemoveVaultResponse>>(
          `/api/vaults/${encodeURIComponent(vaultId)}`,
          {
            method: "DELETE",
            body: JSON.stringify({ generatedDataAction }),
          },
        );
        if (!response.ok || !response.data) throw new Error("Vault removal failed");
        await loadNode();
        if (activeVaultId === vaultId) {
          const nextVaultId = response.data.remainingVaults[0]?.id ?? null;
          setActiveVaultId(nextVaultId);
          if (typeof window !== "undefined") {
            if (nextVaultId) {
              window.localStorage.setItem(LAST_VAULT_KEY, nextVaultId);
            } else {
              window.localStorage.removeItem(LAST_VAULT_KEY);
            }
          }
        }
        return response.data;
      } catch (err) {
        setMutationError(errorMessage(err));
        return null;
      }
    },
    [activeVaultId, loadNode],
  );

  return {
    files,
    fileMeta,
    index,
    issues,
    folders,
    vaults,
    activeVault,
    loading,
    error,
    mutationError,
    health,
    vaultStatus,
    write,
    overwriteFile,
    createFile,
    createFileWithContent,
    createFolder,
    rename,
    remove,
    reindex,
    reindexVault,
    hasExternalChange,
    readFileFromDisk,
    reloadFile,
    refreshActiveVault,
    refreshVaultStatus,
    addVault,
    removeVault,
    refreshNode,
    testHealth,
    selectVault: setActiveVaultId,
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(
      typeof data.error === "string" ? data.error : `Request failed with ${response.status}`,
    );
  }
  return data as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
