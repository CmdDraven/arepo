import type { VaultFileKind } from "./contracts";

export type LocalFileSearchDocument = {
  path: string;
  title: string;
  kind: VaultFileKind;
  tags: string[];
  content: string;
};

export type LocalFileSearchResult = {
  path: string;
  title: string;
  kind: VaultFileKind;
  inName: boolean;
  inBody: boolean;
  inTags: boolean;
};

export function searchLocalFiles(
  documents: readonly LocalFileSearchDocument[],
  rawQuery: string,
): LocalFileSearchResult[] | null {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return null;
  return documents.reduce<LocalFileSearchResult[]>((results, document) => {
    const inName =
      document.title.toLocaleLowerCase().includes(query) ||
      document.path.toLocaleLowerCase().includes(query);
    const inBody = document.content.toLocaleLowerCase().includes(query);
    const inTags = document.tags.some((tag) => tag.toLocaleLowerCase().includes(query));
    if (inName || inBody || inTags) {
      results.push({
        path: document.path,
        title: document.title,
        kind: document.kind,
        inName,
        inBody,
        inTags,
      });
    }
    return results;
  }, []);
}
