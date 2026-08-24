import fsSync, { type Stats } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PublicApiError } from "./publicApiError.js";
import type { DirectoryBrowserEntry, DirectoryBrowserResponse } from "./types.js";

export async function browseServerDirectories(
  requestedPath: string | null,
): Promise<DirectoryBrowserResponse> {
  const input = requestedPath === null || requestedPath === "" ? os.homedir() : requestedPath;
  if (input.includes("\0") || !path.isAbsolute(input)) {
    throw new PublicApiError(400, "Directory path must be absolute.", {
      code: "invalid-directory-path",
    });
  }

  const resolvedInput = path.resolve(input);
  let requestedStat;
  try {
    requestedStat = await lstatWithoutSymlinkComponents(resolvedInput);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new PublicApiError(404, "Directory was not found.", {
        code: "directory-not-found",
      });
    }
    throw error;
  }
  if (!requestedStat.isDirectory()) {
    throw new PublicApiError(400, "Directory path must identify a directory.", {
      code: "invalid-directory-path",
    });
  }

  let currentPath: string;
  try {
    currentPath = await fs.realpath(resolvedInput);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new PublicApiError(404, "Directory was not found.", {
        code: "directory-not-found",
      });
    }
    throw error;
  }

  const canonicalStat = await fs.lstat(currentPath);
  if (!canonicalStat.isDirectory()) {
    throw new PublicApiError(400, "Directory path must identify a directory.", {
      code: "invalid-directory-path",
    });
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const directories = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map(async (entry): Promise<DirectoryBrowserEntry | null> => {
          const childPath = path.join(currentPath, entry.name);
          try {
            await fs.access(childPath, fsSync.constants.R_OK | fsSync.constants.X_OK);
            return { name: entry.name, path: childPath };
          } catch {
            return null;
          }
        }),
    )
  )
    .filter((entry): entry is DirectoryBrowserEntry => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const parent = path.dirname(currentPath);
  return {
    currentPath,
    parentPath: parent === currentPath ? null : parent,
    directories,
  };
}

async function lstatWithoutSymlinkComponents(absolutePath: string): Promise<Stats> {
  const root = path.parse(absolutePath).root;
  const relativePath = path.relative(root, absolutePath);
  const components = relativePath ? relativePath.split(path.sep).filter(Boolean) : [];
  let currentPath = root;
  let currentStat = await fs.lstat(currentPath);
  rejectDirectorySymlink(currentStat);

  for (const component of components) {
    currentPath = path.join(currentPath, component);
    currentStat = await fs.lstat(currentPath);
    rejectDirectorySymlink(currentStat);
  }
  return currentStat;
}

function rejectDirectorySymlink(stat: Stats): void {
  if (stat.isSymbolicLink()) {
    throw new PublicApiError(400, "Directory symlinks cannot be browsed.", {
      code: "directory-symlink-not-allowed",
    });
  }
}
