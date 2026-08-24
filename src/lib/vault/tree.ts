export function foldersFromFilePaths(paths: readonly string[]): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    segments.pop();
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      folders.add(current);
    }
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

export const indexedFoldersFromNotePaths = foldersFromFilePaths;
