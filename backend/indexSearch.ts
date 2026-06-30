import type {
  IndexSearchMatchType,
  IndexSearchResponse,
  IndexSearchResult,
  VaultIndexResponse,
} from "./types.js";

type RankedResult = IndexSearchResult & { rank: number };

const MAX_RESULTS = 100;

export function buildIndexSearchResponse(
  data: VaultIndexResponse,
  rawQuery: string | null,
): IndexSearchResponse {
  const q = (rawQuery ?? "").trim();
  if (!q) return { q, total: 0, source: "machine-index", results: [] };
  const needle = q.toLowerCase();
  const results = Object.values(data.index.notes).flatMap((note) => {
    const out: RankedResult[] = [];
    addMatch(out, {
      query: needle,
      matchType: "file",
      rank: exactRank(needle, note.path, 0, 1),
      path: note.path,
      title: note.title,
      matchedField: "path",
      matchedValue: note.path,
    });
    addMatch(out, {
      query: needle,
      matchType: "file",
      rank: exactRank(needle, note.title, 0, 1),
      path: note.path,
      title: note.title,
      matchedField: "title",
      matchedValue: note.title,
    });
    const frontmatterId = note.frontmatter.id;
    if (typeof frontmatterId === "string") {
      addMatch(out, {
        query: needle,
        matchType: "frontmatter-id",
        rank: exactRank(needle, frontmatterId, 2, 3),
        path: note.path,
        title: note.title,
        matchedField: "frontmatter id",
        matchedValue: frontmatterId,
      });
    }
    for (const tag of note.tags) {
      addMatch(out, {
        query: needle,
        matchType: "tag",
        rank: exactRank(needle, tag, 4, 5),
        path: note.path,
        title: note.title,
        matchedField: "tag",
        matchedValue: tag,
        tag,
      });
    }
    for (const heading of note.headings) {
      addMatch(out, {
        query: needle,
        matchType: "heading",
        rank: exactRank(needle, heading.text, 6, 7),
        path: note.path,
        title: note.title,
        matchedField: "heading",
        matchedValue: heading.text,
        headingText: heading.text,
        anchor: heading.anchor,
      });
      addMatch(out, {
        query: needle,
        matchType: "anchor",
        rank: exactRank(needle, heading.anchor, 8, 9),
        path: note.path,
        title: note.title,
        matchedField: "heading anchor",
        matchedValue: heading.anchor,
        headingText: heading.text,
        anchor: heading.anchor,
      });
    }
    for (const link of data.index.outgoingLinks[note.path] ?? []) {
      addMatch(out, {
        query: needle,
        matchType: "link-target",
        rank: exactRank(needle, link.target, 10, 11),
        path: note.path,
        title: note.title,
        matchedField: "outgoing link target",
        matchedValue: link.target,
        anchor: link.anchor,
        linkTarget: link.target,
        targetPath: link.targetPath,
      });
      if (link.targetPath) {
        addMatch(out, {
          query: needle,
          matchType: "link-target",
          rank: exactRank(needle, link.targetPath, 10, 11),
          path: note.path,
          title: note.title,
          matchedField: "outgoing link path",
          matchedValue: link.targetPath,
          anchor: link.anchor,
          linkTarget: link.target,
          targetPath: link.targetPath,
        });
      }
    }
    for (const backlink of data.index.backlinks[note.path] ?? []) {
      const from = data.index.notes[backlink.fromPath];
      addMatch(out, {
        query: needle,
        matchType: "backlink",
        rank: exactRank(needle, backlink.fromPath, 12, 13),
        path: note.path,
        title: note.title,
        matchedField: "backlink source path",
        matchedValue: backlink.fromPath,
        anchor: backlink.anchor,
        fromPath: backlink.fromPath,
        fromTitle: from?.title ?? backlink.fromPath,
      });
      if (from) {
        addMatch(out, {
          query: needle,
          matchType: "backlink",
          rank: exactRank(needle, from.title, 12, 13),
          path: note.path,
          title: note.title,
          matchedField: "backlink source title",
          matchedValue: from.title,
          anchor: backlink.anchor,
          fromPath: backlink.fromPath,
          fromTitle: from.title,
        });
      }
    }
    return out;
  });
  const deduped = dedupe(results)
    .sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path) || a.id.localeCompare(b.id))
    .slice(0, MAX_RESULTS)
    .map(({ rank: _rank, ...result }) => result);
  return { q, total: deduped.length, source: "machine-index", results: deduped };
}

function addMatch(
  out: RankedResult[],
  input: Omit<RankedResult, "id"> & { query: string; matchType: IndexSearchMatchType },
) {
  const value = input.matchedValue.trim();
  if (!value || !value.toLowerCase().includes(input.query)) return;
  const id = [
    input.matchType,
    input.path,
    input.matchedField,
    value,
    input.anchor ?? "",
    input.targetPath ?? "",
    input.fromPath ?? "",
  ].join(":");
  const { query: _query, ...result } = input;
  out.push({ ...result, id, matchedValue: value });
}

function exactRank(query: string, value: string, exact: number, partial: number) {
  return value.trim().toLowerCase() === query ? exact : partial;
}

function dedupe(results: RankedResult[]): RankedResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.id)) return false;
    seen.add(result.id);
    return true;
  });
}
