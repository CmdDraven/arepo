import type { VaultInspectResponse, VaultIndexResponse } from "./types.js";
import { PublicApiError } from "./publicApiError.js";

export function buildVaultInspectResponse(
  data: VaultIndexResponse,
  path: string | null,
): VaultInspectResponse {
  if (!path) throw new PublicApiError(400, "path is required", { code: "invalid-index-path" });
  const note = data.index.notes[path];
  if (!note) {
    throw new PublicApiError(404, `Unknown indexed note: ${path}`, {
      code: "ENOENT",
    });
  }
  const outgoingLinks = (data.index.outgoingLinks[path] ?? []).map((link) => ({
    ...link,
    targetTitle: link.targetPath ? data.index.notes[link.targetPath]?.title : undefined,
  }));
  const backlinks = (data.index.backlinks[path] ?? []).map((backlink) => ({
    ...backlink,
    fromTitle: data.index.notes[backlink.fromPath]?.title ?? backlink.fromPath,
  }));
  return {
    source: "machine-index",
    path: note.path,
    title: note.title,
    frontmatterId:
      typeof note.frontmatter.id === "string" && note.frontmatter.id.trim()
        ? note.frontmatter.id
        : undefined,
    tags: note.tags,
    headings: note.headings,
    anchors: note.anchors,
    outgoingLinks,
    backlinks,
    brokenOutgoingLinks: outgoingLinks.filter((link) => link.broken),
    duplicateId: duplicateIdForPath(data, path),
    duplicateAnchors: duplicateAnchorsForPath(data, path),
    orphan: data.index.orphanNotes.includes(path),
    issues: data.issues.filter((issue) => issue.path === path),
  };
}

function duplicateIdForPath(
  data: VaultIndexResponse,
  path: string,
): VaultInspectResponse["duplicateId"] {
  const note = data.index.notes[path];
  const id = note?.frontmatter.id;
  if (typeof id !== "string" || !id.trim()) return undefined;
  const paths = Object.values(data.index.notes)
    .filter((candidate) => candidate.frontmatter.id === id)
    .map((candidate) => candidate.path);
  return paths.length > 1 ? { id, paths } : undefined;
}

function duplicateAnchorsForPath(
  data: VaultIndexResponse,
  path: string,
): VaultInspectResponse["duplicateAnchors"] {
  const note = data.index.notes[path];
  if (!note) return [];
  const byAnchor = new Map<string, typeof note.headings>();
  for (const heading of note.headings) {
    byAnchor.set(heading.anchor, [...(byAnchor.get(heading.anchor) ?? []), heading]);
  }
  return Array.from(byAnchor.entries()).flatMap(([anchor, headings]) => {
    if (headings.length < 2) return [];
    return {
      anchor,
      headings: headings.map((heading) => ({
        text: heading.text,
        level: heading.level,
        explicit: heading.explicit,
      })),
    };
  });
}
