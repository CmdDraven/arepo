import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildIndex, type VaultIndex, type ValidationIssue } from "./indexer";
import {
  CONTENT_LOAD_FAILURE,
  loadedFileContents,
  isCurrentVaultData,
  prepareVaultLoad,
  settleFileContent,
  settleVaultContents,
  type FileContentStateMap,
  type FileMetadataMap,
  type VaultLoadData,
} from "./contentLoading";
import { globalErrorForLoadFailure } from "./loadFailure";
import { hasVisibleVaultData, isVaultAvailable, preferredVaultId } from "./availability";
import type {
  OperationResult,
  VaultFileListResponse,
  VaultFileResponse,
  VaultFileWriteResponse,
  VaultIndexResponse,
  VaultIndexScope,
  VaultInfo,
  VaultListItem,
  VaultListResponse,
  VaultPermission,
} from "./contracts";

export type {
  VaultIndexScope,
  VaultInfo,
  VaultListItem,
  VaultListResponse,
  VaultPermission,
} from "./contracts";

const LAST_VAULT_KEY = "vault:lastVaultId";
const EMPTY_FILE_CONTENTS: FileContentStateMap = {};

type FilesMap = Record<string, string>;
type FileMetaMap = FileMetadataMap;

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

type FileListResponse = VaultFileListResponse;
export type FileResponse = VaultFileResponse;
type FileWriteResponse = VaultFileWriteResponse;
type IndexResponse = VaultIndexResponse;

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

export type VaultStore = {
  files: FilesMap;
  fileContents: FileContentStateMap;
  fileMeta: FileMetaMap;
  index: VaultIndex;
  issues: ValidationIssue[];
  folders: string[];
  vaultView: VaultListResponse["vaultView"];
  vaults: VaultListItem[];
  activeVault: VaultListItem | null;
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
  updateVaultIndexScope: (vaultId: string, scope: VaultIndexScope) => Promise<boolean>;
  rebindVault: (vaultId: string, rootPath: string) => Promise<boolean>;
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
  const [node, setNode] = useState<VaultListResponse | null>(null);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LAST_VAULT_KEY);
  });
  const [fileContents, setFileContents] = useState<FileContentStateMap>({});
  const [fileMeta, setFileMeta] = useState<FileMetaMap>({});
  const [folders, setFolders] = useState<string[]>([]);
  const [index, setIndex] = useState<VaultIndex>(EMPTY_INDEX);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultRuntimeStatus | null>(null);
  const [loadedVaultId, setLoadedVaultId] = useState<string | null>(null);
  const loadRequestId = useRef(0);
  const loadedVaultIdRef = useRef<string | null>(null);
  const fileContentsRef = useRef<FileContentStateMap>({});
  const fileMetaRef = useRef<FileMetaMap>({});

  const vaults = useMemo(() => node?.vaults ?? [], [node]);
  const activeVault = useMemo(() => {
    const id = preferredVaultId(vaults, activeVaultId);
    return vaults.find((vault) => vault.id === id) ?? null;
  }, [activeVaultId, vaults]);
  const hasCurrentVaultData =
    isCurrentVaultData(loadedVaultId, activeVault?.id) &&
    hasVisibleVaultData(loadedVaultId, activeVault);
  const visibleFileContents = hasCurrentVaultData ? fileContents : EMPTY_FILE_CONTENTS;
  const visibleFileMeta = hasCurrentVaultData ? fileMeta : {};
  const visibleFolders = hasCurrentVaultData ? folders : [];
  const visibleIndex = hasCurrentVaultData ? index : EMPTY_INDEX;
  const visibleIssues = hasCurrentVaultData ? issues : [];
  const files = useMemo(() => loadedFileContents(visibleFileContents), [visibleFileContents]);
  const visibleVaultStatus =
    activeVault && vaultStatus?.vaultId === activeVault.id ? vaultStatus : null;

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    fileMetaRef.current = fileMeta;
  }, [fileMeta]);

  const publishVaultLoad = useCallback((data: VaultLoadData) => {
    loadedVaultIdRef.current = data.vaultId;
    fileContentsRef.current = data.fileContents;
    fileMetaRef.current = data.fileMeta;
    setLoadedVaultId(data.vaultId);
    setFileContents(data.fileContents);
    setFileMeta(data.fileMeta);
    setFolders(data.folders);
    setIndex(data.index);
    setIssues(data.issues);
  }, []);

  const clearVaultLoad = useCallback(() => {
    loadRequestId.current += 1;
    loadedVaultIdRef.current = null;
    fileContentsRef.current = {};
    fileMetaRef.current = {};
    setLoadedVaultId(null);
    setFileContents({});
    setFileMeta({});
    setFolders([]);
    setIndex(EMPTY_INDEX);
    setIssues([]);
    setVaultStatus(null);
  }, []);

  const loadNode = useCallback(async () => {
    const nextNode = await api<VaultListResponse>("/api/vaults");
    setNode(nextNode);
    const nextActiveVaultId = preferredVaultId(nextNode.vaults, activeVaultId);
    if (nextActiveVaultId !== activeVaultId) {
      setActiveVaultId(nextActiveVaultId);
      if (typeof window !== "undefined") {
        if (nextActiveVaultId) {
          window.localStorage.setItem(LAST_VAULT_KEY, nextActiveVaultId);
        } else {
          window.localStorage.removeItem(LAST_VAULT_KEY);
        }
      }
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

  const loadVault = useCallback(
    async (vaultId: string) => {
      const requestId = ++loadRequestId.current;
      const [fileList, indexResponse] = await Promise.all([
        api<FileListResponse>(`/api/vaults/${encodeURIComponent(vaultId)}/files`),
        api<IndexResponse>(`/api/vaults/${encodeURIComponent(vaultId)}/index`),
      ]);
      if (requestId !== loadRequestId.current) return;
      const previous =
        loadedVaultIdRef.current === vaultId
          ? { fileContents: fileContentsRef.current, fileMeta: fileMetaRef.current }
          : undefined;
      const initial = prepareVaultLoad(vaultId, fileList, indexResponse, previous);
      publishVaultLoad(initial);
      const settled = await settleVaultContents(initial, fileList.files, (file) =>
        api<FileResponse>(
          `/api/vaults/${encodeURIComponent(vaultId)}/file?path=${encodeURIComponent(file.path)}`,
        ),
      );
      if (requestId !== loadRequestId.current) return;
      publishVaultLoad(settled);
      const status = await api<VaultRuntimeStatus>(
        `/api/vaults/${encodeURIComponent(vaultId)}/status`,
      );
      if (requestId !== loadRequestId.current) return;
      setVaultStatus(status);
    },
    [publishVaultLoad],
  );

  const refreshActiveVault = useCallback(async () => {
    if (!activeVault) return false;
    setMutationError(null);
    try {
      await loadVault(activeVault.id);
      return true;
    } catch (err) {
      setMutationError(globalErrorForLoadFailure("whole-vault", err));
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
      clearVaultLoad();
      return;
    }
    if (!isVaultAvailable(activeVault)) {
      clearVaultLoad();
      setError(null);
      setLoading(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_VAULT_KEY, activeVault.id);
      }
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
        if (!cancelled) setError(globalErrorForLoadFailure("whole-vault", err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeVault, clearVaultLoad, loadVault]);

  const mutate = useCallback(
    async (fn: (vault: VaultListItem) => Promise<void>) => {
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
        const data = operationData(response);
        setFileContents((prev) => ({
          ...prev,
          [data.path]: { status: "loaded", content },
        }));
        setFileMeta((prev) => ({
          ...prev,
          [data.path]: {
            kind: data.kind,
            mtimeMs: data.mtimeMs,
            size: data.size,
            hash: data.hash,
          },
        }));
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
        const data = operationData(response);
        setFileContents((prev) => ({
          ...prev,
          [data.path]: { status: "loaded", content },
        }));
        setFileMeta((prev) => ({
          ...prev,
          [data.path]: {
            kind: data.kind,
            mtimeMs: data.mtimeMs,
            size: data.size,
            hash: data.hash,
          },
        }));
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
        const data = operationData(response);
        setIndex(data.index);
        setIssues(data.issues);
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
        const data = operationData(response);
        if (activeVault?.id === vaultId) {
          setIndex(data.index);
          setIssues(data.issues);
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

  const updateVaultIndexScope = useCallback(
    async (vaultId: string, scope: VaultIndexScope) => {
      setMutationError(null);
      try {
        const response = await api<OperationResult<{ vault: VaultInfo; index: IndexResponse }>>(
          `/api/vaults/${encodeURIComponent(vaultId)}/index-scope`,
          {
            method: "PATCH",
            body: JSON.stringify({ vaultIndexScope: scope }),
          },
        );
        const data = operationData(response);
        await loadNode();
        if (activeVault?.id === vaultId) {
          setIndex(data.index.index);
          setIssues(data.index.issues);
          await loadVault(vaultId);
        }
        return true;
      } catch (err) {
        setMutationError(errorMessage(err));
        return false;
      }
    },
    [activeVault?.id, loadNode, loadVault],
  );

  const rebindVault = useCallback(
    async (vaultId: string, rootPath: string) => {
      setMutationError(null);
      try {
        await api<OperationResult<{ vault: VaultInfo; indexRebuilt: boolean }>>(
          `/api/vaults/${encodeURIComponent(vaultId)}/rebind`,
          {
            method: "POST",
            body: JSON.stringify({ rootPath }),
          },
        );
        if (activeVaultId === vaultId) clearVaultLoad();
        await loadNode();
        setActiveVaultId(vaultId);
        return true;
      } catch (err) {
        setMutationError(errorMessage(err));
        return false;
      }
    },
    [activeVaultId, clearVaultLoad, loadNode],
  );

  const hasExternalChange = useCallback(
    async (path: string) => {
      if (!activeVault) return false;
      const meta = fileMeta[path];
      if (!meta?.hash) return false;
      setMutationError(null);
      try {
        const current = await api<FileResponse>(
          `/api/vaults/${encodeURIComponent(activeVault.id)}/file?path=${encodeURIComponent(path)}`,
        );
        return current.hash !== meta.hash;
      } catch {
        return true;
      }
    },
    [activeVault, fileMeta],
  );

  const refreshVaultStatus = useCallback(
    async (path?: string | null) => {
      if (!activeVault) return null;
      const vaultId = activeVault.id;
      const requestId = loadRequestId.current;
      try {
        const query = path ? `?path=${encodeURIComponent(path)}` : "";
        const status = await api<VaultRuntimeStatus>(
          `/api/vaults/${encodeURIComponent(vaultId)}/status${query}`,
        );
        setVaultStatus(status);
        return status;
      } catch (err) {
        if (path) {
          // Path-scoped status computes a hash by reading that source body.
          if (
            requestId === loadRequestId.current &&
            loadedVaultIdRef.current === vaultId &&
            fileMetaRef.current[path]
          ) {
            setFileContents((prev) => ({
              ...prev,
              [path]: { status: "failed", error: CONTENT_LOAD_FAILURE },
            }));
          }
          return null;
        }
        setMutationError(globalErrorForLoadFailure("whole-vault", err));
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
      } catch {
        return null;
      }
    },
    [activeVault],
  );

  const reloadFile = useCallback(
    async (path: string) => {
      if (!activeVault) return false;
      const vaultId = activeVault.id;
      const requestId = loadRequestId.current;
      setMutationError(null);
      const listed = fileMeta[path];
      if (!listed) return false;
      setFileContents((prev) => ({ ...prev, [path]: { status: "loading" } }));
      try {
        const result = await settleFileContent(
          { path, kind: listed.kind, mtimeMs: listed.mtimeMs, size: listed.size },
          () =>
            api<FileResponse>(
              `/api/vaults/${encodeURIComponent(vaultId)}/file?path=${encodeURIComponent(path)}`,
            ),
        );
        if (requestId !== loadRequestId.current || loadedVaultIdRef.current !== vaultId) {
          return false;
        }
        setFileContents((prev) => ({ ...prev, [path]: result.state }));
        if (result.metadata) {
          setFileMeta((prev) => ({
            ...prev,
            [path]: { ...prev[path], ...result.metadata },
          }));
        }
        if (result.state.status === "failed") {
          return false;
        }
        await refreshVaultStatus(path);
        return true;
      } catch (err) {
        setMutationError(globalErrorForLoadFailure("source-content", err));
        return false;
      }
    },
    [activeVault, fileMeta, refreshVaultStatus],
  );

  const addVault = useCallback(
    async (rootPath: string, displayName?: string, permissions?: Partial<VaultPermission>) => {
      setMutationError(null);
      try {
        const response = await api<OperationResult<{ vault: VaultInfo }>>("/api/vaults", {
          method: "POST",
          body: JSON.stringify({ rootPath, displayName, permissions }),
        });
        const data = operationData(response);
        await loadNode();
        setActiveVaultId(data.vault.id);
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
        const data = operationData(response);
        await loadNode();
        if (activeVaultId === vaultId) {
          const nextVaultId = data.remainingVaults[0]?.id ?? null;
          setActiveVaultId(nextVaultId);
          if (typeof window !== "undefined") {
            if (nextVaultId) {
              window.localStorage.setItem(LAST_VAULT_KEY, nextVaultId);
            } else {
              window.localStorage.removeItem(LAST_VAULT_KEY);
            }
          }
        }
        return data;
      } catch (err) {
        setMutationError(errorMessage(err));
        return null;
      }
    },
    [activeVaultId, loadNode],
  );

  return {
    files,
    fileContents: visibleFileContents,
    fileMeta: visibleFileMeta,
    index: visibleIndex,
    issues: visibleIssues,
    folders: visibleFolders,
    vaultView: node?.vaultView ?? "management",
    vaults,
    activeVault,
    loading,
    error,
    mutationError,
    health,
    vaultStatus: visibleVaultStatus,
    write,
    overwriteFile,
    createFile,
    createFileWithContent,
    createFolder,
    rename,
    remove,
    reindex,
    reindexVault,
    updateVaultIndexScope,
    rebindVault,
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

function operationData<T>(result: OperationResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
