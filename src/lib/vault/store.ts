// In-browser vault store. Markdown files live in localStorage as a
// path -> string map. The index is rebuilt on every change and is never
// the source of truth.

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEMO_FILES } from "./demo";
import { buildIndex, validate, type VaultIndex, type ValidationIssue } from "./indexer";

const STORAGE_KEY = "vault:files:v2";

type FilesMap = Record<string, string>;

function loadFromStorage(): FilesMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as FilesMap;
  } catch {
    // ignore
  }
  const seeded: FilesMap = {};
  for (const f of DEMO_FILES) seeded[f.path] = f.content;
  return seeded;
}

function saveToStorage(files: FilesMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch {
    // ignore quota errors
  }
}

export type VaultStore = {
  files: FilesMap;
  index: VaultIndex;
  issues: ValidationIssue[];
  write: (path: string, content: string) => void;
  createFile: (path: string) => void;
  createFolder: (path: string) => void;
  rename: (oldPath: string, newPath: string) => void;
  remove: (path: string) => void;
  resetToDemo: () => void;
  folders: string[];
};

export function useVault(): VaultStore {
  const [files, setFiles] = useState<FilesMap>(() => loadFromStorage());
  const [folders, setFolders] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY + ":folders");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    saveToStorage(files);
  }, [files]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY + ":folders",
        JSON.stringify(folders),
      );
    } catch {
      // ignore
    }
  }, [folders]);

  const index = useMemo(() => buildIndex(files), [files]);
  const issues = useMemo(() => validate(index), [index]);

  const write = useCallback((path: string, content: string) => {
    setFiles((prev) => ({ ...prev, [path]: content }));
  }, []);

  const createFile = useCallback((path: string) => {
    setFiles((prev) => {
      if (prev[path]) return prev;
      const slug = path.split("/").pop()!.replace(/\.md$/i, "");
      const initial = `---\nid: ${slug}\ntitle: ${slug}\ntags: []\n---\n\n# ${slug}\n\n`;
      return { ...prev, [path]: initial };
    });
  }, []);

  const createFolder = useCallback((path: string) => {
    setFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }, []);

  const rename = useCallback((oldPath: string, newPath: string) => {
    setFiles((prev) => {
      if (!prev[oldPath] || prev[newPath]) return prev;
      const { [oldPath]: content, ...rest } = prev;
      return { ...rest, [newPath]: content };
    });
  }, []);

  const remove = useCallback((path: string) => {
    setFiles((prev) => {
      const { [path]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const resetToDemo = useCallback(() => {
    const seeded: FilesMap = {};
    for (const f of DEMO_FILES) seeded[f.path] = f.content;
    setFiles(seeded);
    setFolders([]);
  }, []);

  return {
    files,
    index,
    issues,
    write,
    createFile,
    createFolder,
    rename,
    remove,
    resetToDemo,
    folders,
  };
}
