import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildIndex, type VaultIndex, type ValidationIssue } from "./indexer";
import {
  contentStateAfterPathStatusFailure,
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
import { isApiResponseValidationError, requestApi } from "./apiTransport";
import {
  isAddVaultData,
  isHealthResponse,
  isIndexScopeUpdateData,
  isOperationResult,
  isPathMutationData,
  isRebindVaultData,
  isRemoveVaultResponse,
  isRenameMutationData,
  isVaultFileData,
  isVaultFileListResponse,
  isVaultFileResponse,
  isVaultFileWriteResponse,
  isVaultIndexResponse,
  isVaultListResponse,
  isVaultRuntimeStatus,
  type GeneratedDataAction,
  type HealthResponse,
  type RemoveVaultResponse,
  type VaultRuntimeStatus,
} from "./apiValidation";
import type {
  OperationResult,
  VaultFileResponse,
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
export type {
  GeneratedDataAction,
  HealthResponse,
  RemoveVaultResponse,
  VaultRuntimeStatus,
} from "./apiValidation";

const LAST_VAULT_KEY = "vault:lastVaultId";
const EMPTY_FILE_CONTENTS: FileContentStateMap = {};

type FilesMap = Record<string, string>;
type FileMetaMap = FileMetadataMap;

export type FileResponse = VaultFileResponse;

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
    const nextNode = await requestApi("/api/vaults", isVaultListResponse);
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
      const nextHealth = await requestApi("/api/health", isHealthResponse);
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
        requestApi(`/api/vaults/${encodeURIComponent(vaultId)}/files`, isVaultFileListResponse),
        requestApi(`/api/vaults/${encodeURIComponent(vaultId)}/index`, isVaultIndexResponse),
      ]);
      if (requestId !== loadRequestId.current) return;
      const previous =
        loadedVaultIdRef.current === vaultId
          ? { fileContents: fileContentsRef.current, fileMeta: fileMetaRef.current }
          : undefined;
      const initial = prepareVaultLoad(vaultId, fileList, indexResponse, previous);
      publishVaultLoad(initial);
      const settled = await settleVaultContents(initial, fileList.files, (file) =>
        requestApi(
          `/api/vaults/${encodeURIComponent(vaultId)}/file?path=${encodeURIComponent(file.path)}`,
          isVaultFileResponse,
        ),
      );
      if (requestId !== loadRequestId.current) return;
      publishVaultLoad(settled);
      const status = await requestApi(
        `/api/vaults/${encodeURIComponent(vaultId)}/status`,
        isVaultRuntimeStatus,
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
        const response = await requestApi(
          `/api/vaults/${encodeURIComponent(vault.id)}/file?path=${encodeURIComponent(path)}`,
          isOperationResult(isVaultFileWriteResponse),
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
        const current = await requestApi(
          `/api/vaults/${encodeURIComponent(vault.id)}/file?path=${encodeURIComponent(path)}`,
          isVaultFileResponse,
        );
        const response = await requestApi(
          `/api/vaults/${encodeURIComponent(vault.id)}/file?path=${encodeURIComponent(path)}`,
          isOperationResult(isVaultFileWriteResponse),
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
        await requestApi(
          `/api/vaults/${encodeURIComponent(vault.id)}/file`,
          isOperationResult(isVaultFileData),
          {
            method: "POST",
            body: JSON.stringify({ path }),
          },
        );
      }),
    [mutate],
  );

  const createFileWithContent = useCallback(
    (path: string, content: string) =>
      mutate(async (vault) => {
        await requestApi(
          `/api/vaults/${encodeURIComponent(vault.id)}/file`,
          isOperationResult(isVaultFileData),
          {
            method: "POST",
            body: JSON.stringify({ path, content }),
          },
        );
      }),
    [mutate],
  );

  const createFolder = useCallback(
    (path: string) =>
      mutate(async (vault) => {
        await requestApi(
          `/api/vaults/${encodeURIComponent(vault.id)}/folder`,
          isOperationResult(isPathMutationData),
          {
            method: "POST",
            body: JSON.stringify({ path }),
          },
        );
      }),
    [mutate],
  );

  const rename = useCallback(
    (oldPath: string, newPath: string) =>
      mutate(async (vault) => {
        await requestApi(
          `/api/vaults/${encodeURIComponent(vault.id)}/rename`,
          isOperationResult(isRenameMutationData),
          {
            method: "POST",
            body: JSON.stringify({
              fromPath: oldPath,
              toPath: newPath,
              kind: "file",
            }),
          },
        );
      }),
    [mutate],
  );

  const remove = useCallback(
    (path: string) =>
      mutate(async (vault) => {
        await requestApi(
          `/api/vaults/${encodeURIComponent(vault.id)}/file?path=${encodeURIComponent(path)}`,
          isOperationResult(isPathMutationData),
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
        const response = await requestApi(
          `/api/vaults/${encodeURIComponent(vault.id)}/reindex`,
          isOperationResult(isVaultIndexResponse),
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
        const response = await requestApi(
          `/api/vaults/${encodeURIComponent(vaultId)}/reindex`,
          isOperationResult(isVaultIndexResponse),
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
        const response = await requestApi(
          `/api/vaults/${encodeURIComponent(vaultId)}/index-scope`,
          isOperationResult(isIndexScopeUpdateData),
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
        await requestApi(
          `/api/vaults/${encodeURIComponent(vaultId)}/rebind`,
          isOperationResult(isRebindVaultData),
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
        const current = await requestApi(
          `/api/vaults/${encodeURIComponent(activeVault.id)}/file?path=${encodeURIComponent(path)}`,
          isVaultFileResponse,
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
        const status = await requestApi(
          `/api/vaults/${encodeURIComponent(vaultId)}/status${query}`,
          isVaultRuntimeStatus,
        );
        setVaultStatus(status);
        return status;
      } catch (err) {
        if (path) {
          if (isApiResponseValidationError(err)) {
            setMutationError(errorMessage(err));
            return null;
          }
          // Path-scoped status computes a hash by reading that source body.
          if (
            requestId === loadRequestId.current &&
            loadedVaultIdRef.current === vaultId &&
            fileMetaRef.current[path]
          ) {
            setFileContents((prev) => {
              const next = contentStateAfterPathStatusFailure(prev[path], err);
              return next ? { ...prev, [path]: next } : prev;
            });
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
        return await requestApi(
          `/api/vaults/${encodeURIComponent(activeVault.id)}/file?path=${encodeURIComponent(path)}`,
          isVaultFileResponse,
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
            requestApi(
              `/api/vaults/${encodeURIComponent(vaultId)}/file?path=${encodeURIComponent(path)}`,
              isVaultFileResponse,
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
        if (result.state.status !== "loaded") {
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
        const response = await requestApi("/api/vaults", isOperationResult(isAddVaultData), {
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
        const response = await requestApi(
          `/api/vaults/${encodeURIComponent(vaultId)}`,
          isOperationResult(isRemoveVaultResponse),
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

function operationData<T>(result: OperationResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
