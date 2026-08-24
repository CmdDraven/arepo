import type {
  VaultFile,
  VaultFileListResponse,
  VaultFileResponse,
  VaultIndexResponse,
} from "./contracts";
import { foldersFromFilePaths } from "./tree.ts";

export type FileContentState =
  | { status: "unloaded" }
  | { status: "loading" }
  | { status: "loaded"; content: string }
  | { status: "failed"; error: string };

export type FileContentStateMap = Record<string, FileContentState>;

export type FileMetadata = {
  kind: VaultFile["kind"];
  mtimeMs: number;
  size: number;
  hash?: string;
};

export type FileMetadataMap = Record<string, FileMetadata>;

export type VaultLoadData = {
  vaultId: string;
  fileContents: FileContentStateMap;
  fileMeta: FileMetadataMap;
  folders: string[];
  index: VaultIndexResponse["index"];
  issues: VaultIndexResponse["issues"];
};

export type SettledFileContent = {
  state: FileContentState;
  metadata?: Pick<VaultFileResponse, "mtimeMs" | "size" | "hash">;
};

export const CONTENT_LOAD_FAILURE = "Content could not be loaded.";

export function prepareVaultLoad(
  vaultId: string,
  fileList: VaultFileListResponse,
  indexResponse: VaultIndexResponse,
  previous?: Pick<VaultLoadData, "fileContents" | "fileMeta">,
): VaultLoadData {
  return {
    vaultId,
    fileContents: Object.fromEntries(
      fileList.files.map((file) => [
        file.path,
        previous?.fileContents[file.path] ?? ({ status: "loading" } as const),
      ]),
    ),
    fileMeta: Object.fromEntries(
      fileList.files.map((file) => {
        const previousMeta = previous?.fileMeta[file.path];
        return [
          file.path,
          {
            kind: file.kind,
            mtimeMs: file.mtimeMs,
            size: file.size,
            ...(previousMeta?.hash ? { hash: previousMeta.hash } : {}),
          },
        ];
      }),
    ),
    folders: foldersFromFilePaths(fileList.files.map((file) => file.path)),
    index: indexResponse.index,
    issues: indexResponse.issues,
  };
}

export async function settleVaultContents(
  initial: VaultLoadData,
  files: readonly VaultFile[],
  readFile: (file: VaultFile) => Promise<VaultFileResponse>,
): Promise<VaultLoadData> {
  const entries = await Promise.all(
    files.map(async (file) => [file.path, await settleFileContent(file, readFile)] as const),
  );
  const fileContents: FileContentStateMap = { ...initial.fileContents };
  const fileMeta: FileMetadataMap = { ...initial.fileMeta };
  for (const [path, result] of entries) {
    fileContents[path] = result.state;
    if (result.metadata && fileMeta[path]) {
      fileMeta[path] = { ...fileMeta[path], ...result.metadata };
    }
  }
  return { ...initial, fileContents, fileMeta };
}

export async function settleFileContent(
  file: VaultFile,
  readFile: (file: VaultFile) => Promise<VaultFileResponse>,
): Promise<SettledFileContent> {
  try {
    const response = await readFile(file);
    return {
      state: { status: "loaded", content: response.content },
      metadata: {
        mtimeMs: response.mtimeMs,
        size: response.size,
        hash: response.hash,
      },
    };
  } catch {
    return { state: { status: "failed", error: CONTENT_LOAD_FAILURE } };
  }
}

export function loadedFileContents(states: FileContentStateMap): Record<string, string> {
  return Object.fromEntries(
    Object.entries(states).flatMap(([path, state]) =>
      state.status === "loaded" ? [[path, state.content]] : [],
    ),
  );
}

export function contentForLocalSearch(state: FileContentState | undefined): string | null {
  return state?.status === "loaded" ? state.content : null;
}

export function isCurrentVaultData(
  loadedVaultId: string | null,
  activeVaultId: string | null | undefined,
): boolean {
  return Boolean(activeVaultId && loadedVaultId === activeVaultId);
}
