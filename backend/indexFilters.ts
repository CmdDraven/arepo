import type {
  IndexFilterKind,
  IndexFilterResponse,
  IndexFilterResult,
  VaultIndexResponse,
} from "./types.js";

const FILTERS = new Set<IndexFilterKind>([
  "broken-links",
  "orphan-notes",
  "tags",
  "folders",
  "duplicate-ids",
  "duplicate-anchors",
]);

export function parseIndexFilterKind(value: unknown): IndexFilterKind {
  if (typeof value !== "string" || !FILTERS.has(value as IndexFilterKind)) {
    throw new Error(
      `Unknown index filter "${String(value ?? "")}". Expected one of: ${Array.from(FILTERS).join(", ")}`,
    );
  }
  return value as IndexFilterKind;
}

export function buildIndexFilterResponse(
  data: VaultIndexResponse,
  filter: IndexFilterKind,
): IndexFilterResponse {
  const results = buildResults(data, filter);
  return { filter, total: results.length, source: "machine-index", results };
}

function buildResults(data: VaultIndexResponse, filter: IndexFilterKind): IndexFilterResult[] {
  switch (filter) {
    case "broken-links":
      return data.index.brokenLinks.map((link, index) => {
        const note = data.index.notes[link.fromPath];
        return {
          id: `${filter}:${link.fromPath}:${index}`,
          filter,
          path: link.fromPath,
          title: note?.title ?? link.fromPath,
          reason: `Broken wikilink [[${link.raw}]]`,
          target: link.target,
          anchor: link.anchor,
        };
      });
    case "orphan-notes":
      return data.index.orphanNotes.map((path) => {
        const note = data.index.notes[path];
        return {
          id: `${filter}:${path}`,
          filter,
          path,
          title: note?.title ?? path,
          reason: "No incoming or outgoing note links",
        };
      });
    case "tags":
      return Object.values(data.index.notes).flatMap((note) =>
        note.tags.map((tag) => ({
          id: `${filter}:${tag}:${note.path}`,
          filter,
          path: note.path,
          title: note.title,
          reason: `Tagged #${tag}`,
          tag,
        })),
      );
    case "folders":
      return Object.values(data.index.notes).map((note) => {
        const folder = folderForPath(note.path);
        return {
          id: `${filter}:${folder}:${note.path}`,
          filter,
          path: note.path,
          title: note.title,
          reason: folder === "/" ? "At vault root" : `In folder ${folder}`,
          folder,
        };
      });
    case "duplicate-ids":
      return duplicateIds(data);
    case "duplicate-anchors":
      return duplicateAnchors(data);
  }
}

function duplicateIds(data: VaultIndexResponse): IndexFilterResult[] {
  const byId = new Map<string, string[]>();
  for (const note of Object.values(data.index.notes)) {
    const id = note.frontmatter.id;
    if (typeof id === "string" && id.trim()) {
      const key = id.trim();
      byId.set(key, [...(byId.get(key) ?? []), note.path]);
    }
  }
  return Array.from(byId.entries()).flatMap(([id, paths]) => {
    if (paths.length < 2) return [];
    return paths.map((path) => {
      const note = data.index.notes[path];
      return {
        id: `duplicate-ids:${id}:${path}`,
        filter: "duplicate-ids" as const,
        path,
        title: note?.title ?? path,
        reason: `Duplicate frontmatter id "${id}"`,
        duplicateKey: id,
      };
    });
  });
}

function duplicateAnchors(data: VaultIndexResponse): IndexFilterResult[] {
  return Object.values(data.index.notes).flatMap((note) => {
    const byAnchor = new Map<string, typeof note.headings>();
    for (const heading of note.headings) {
      byAnchor.set(heading.anchor, [...(byAnchor.get(heading.anchor) ?? []), heading]);
    }
    return Array.from(byAnchor.entries()).flatMap(([anchor, headings]) => {
      if (headings.length < 2) return [];
      return headings.map((heading, index) => ({
        id: `duplicate-anchors:${note.path}:${anchor}:${index}`,
        filter: "duplicate-anchors" as const,
        path: note.path,
        title: note.title,
        reason: `Duplicate heading anchor "${anchor}"`,
        duplicateKey: anchor,
        headingText: heading.text,
        anchor,
      }));
    });
  });
}

function folderForPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "/" : path.slice(0, index);
}
