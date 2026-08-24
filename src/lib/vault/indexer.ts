// Pure indexer over a map of path -> markdown content. The index is
// disposable; it can be rebuilt from the Markdown files alone.

import { parseFrontmatter, type Frontmatter } from "./frontmatter.js";

export type Heading = {
  level: number;
  text: string;
  anchor: string; // explicit {#id} or slugified
  explicit: boolean;
};

export type WikiLink = {
  target: string; // raw target (filename stem or id)
  anchor?: string;
  alias?: string;
  raw: string;
};

export type WikiLinkResolution =
  | { status: "resolved"; targetPath: string }
  | { status: "missing" }
  | { status: "excluded-by-index-scope"; targetPath: string }
  | { status: "ambiguous"; targetPaths: string[] }
  | { status: "invalid"; reason: string };

export type NoteIndex = {
  path: string;
  slug: string; // filename without .md
  title: string;
  frontmatter: Frontmatter;
  headings: Heading[];
  anchors: string[];
  wikilinks: WikiLink[];
  tags: string[];
};

export type VaultIndex = {
  notes: Record<string, NoteIndex>; // by path
  bySlug: Record<string, string>; // slug -> path
  duplicateSlugs: Record<string, string[]>;
  byId: Record<string, string>; // frontmatter id -> path
  duplicateIds: Record<string, string[]>;
  excludedBySlug: Record<string, string>;
  duplicateExcludedSlugs: Record<string, string[]>;
  excludedPaths: string[];
  outgoingLinks: Record<
    string,
    {
      target: string;
      targetPath?: string;
      anchor?: string;
      alias?: string;
      raw: string;
      status: WikiLinkResolution["status"];
      broken: boolean;
      targetPaths?: string[];
    }[]
  >;
  backlinks: Record<string, { fromPath: string; anchor?: string; alias?: string }[]>;
  brokenLinks: {
    fromPath: string;
    target: string;
    anchor?: string;
    raw: string;
    status: Extract<
      WikiLinkResolution["status"],
      "missing" | "excluded-by-index-scope" | "invalid"
    >;
    targetPath?: string;
  }[];
  orphanNotes: string[];
};

export type ValidationIssue = {
  kind:
    | "broken-wikilink"
    | "missing-anchor"
    | "duplicate-id"
    | "duplicate-slug"
    | "duplicate-anchor"
    | "ambiguous-link"
    | "missing-title"
    | "missing-id";
  path: string;
  message: string;
  severity: "warning" | "error";
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function pathStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/gm;
const EXPLICIT_ANCHOR_RE = /\{#([a-z0-9-_]+)\}\s*$/i;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const FENCED_CODE_RE =
  /(^|\n)(?:`{3,}[^\n]*\n[\s\S]*?\n`{3,}[ \t]*(?=\n|$)|~{3,}[^\n]*\n[\s\S]*?\n~{3,}[ \t]*(?=\n|$))/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const CODE_TOKEN_PREFIX = "AREPO_CODE_TOKEN_";

export function extractHeadings(body: string): Heading[] {
  const out: Heading[] = [];
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(body))) {
    const level = m[1].length;
    let text = m[2].trim();
    let anchor: string;
    let explicit = false;
    const a = text.match(EXPLICIT_ANCHOR_RE);
    if (a) {
      anchor = a[1];
      explicit = true;
      text = text.replace(EXPLICIT_ANCHOR_RE, "").trim();
    } else {
      anchor = slugify(text);
    }
    out.push({ level, text, anchor, explicit });
  }
  return out;
}

export function extractWikilinks(body: string): WikiLink[] {
  const out: WikiLink[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(body))) {
    out.push(parseWikiLink(m[1]));
  }
  return out;
}

export function parseWikiLink(raw: string): WikiLink {
  let target = raw;
  let alias: string | undefined;
  let anchor: string | undefined;
  const pipe = target.indexOf("|");
  if (pipe !== -1) {
    alias = target.slice(pipe + 1).trim();
    target = target.slice(0, pipe).trim();
  }
  const hash = target.indexOf("#");
  if (hash !== -1) {
    anchor = target.slice(hash + 1).trim();
    target = target.slice(0, hash).trim();
  }
  return { target, anchor, alias, raw };
}

export function indexNote(path: string, content: string): NoteIndex {
  const { frontmatter, body } = parseFrontmatter(content);
  const indexableBody = stripCodeForIndexing(body);
  const headings = extractHeadings(indexableBody);
  const wikilinks = extractWikilinks(indexableBody);
  const slug = pathStem(path);
  const title =
    (typeof frontmatter.title === "string" && frontmatter.title) ||
    headings.find((h) => h.level === 1)?.text ||
    slug;
  return {
    path,
    slug,
    title,
    frontmatter,
    headings,
    anchors: headings.map((h) => h.anchor),
    wikilinks,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
  };
}

export function stripCodeForIndexing(body: string): string {
  return body.replace(FENCED_CODE_RE, "\n").replace(INLINE_CODE_RE, "");
}

export function maskMarkdownCode(body: string): { masked: string; code: string[] } {
  const code: string[] = [];
  const replaceCode = (value: string) => {
    const token = `@@${CODE_TOKEN_PREFIX}${code.length}@@`;
    code.push(value);
    return token;
  };
  return {
    masked: body.replace(FENCED_CODE_RE, replaceCode).replace(INLINE_CODE_RE, replaceCode),
    code,
  };
}

export function restoreMarkdownCode(masked: string, code: string[]): string {
  return masked.replace(/@@AREPO_CODE_TOKEN_(\d+)@@/g, (_match, rawIndex: string) => {
    const value = code[Number(rawIndex)];
    return value ?? "";
  });
}

export function buildIndex(
  files: Record<string, string>,
  options: { excludedPaths?: string[] } = {},
): VaultIndex {
  const notes: Record<string, NoteIndex> = {};
  const bySlug: Record<string, string> = {};
  const slugPaths: Record<string, string[]> = {};
  const byId: Record<string, string> = {};
  const idPaths: Record<string, string[]> = {};
  const excludedPaths = (options.excludedPaths ?? [])
    .filter((path) => path.toLowerCase().endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));
  const excludedSlugPaths: Record<string, string[]> = {};
  for (const path of excludedPaths) {
    (excludedSlugPaths[pathStem(path)] ||= []).push(path);
  }
  for (const [path, content] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith(".md")) continue;
    const note = indexNote(path, content);
    notes[path] = note;
    (slugPaths[note.slug] ||= []).push(path);
    const id = note.frontmatter.id;
    if (typeof id === "string" && id) {
      (idPaths[id] ||= []).push(path);
    }
  }
  const duplicateSlugs: Record<string, string[]> = {};
  for (const [slug, paths] of Object.entries(slugPaths)) {
    if (paths.length === 1 && paths[0]) bySlug[slug] = paths[0];
    else duplicateSlugs[slug] = paths;
  }
  const duplicateIds: Record<string, string[]> = {};
  for (const [id, paths] of Object.entries(idPaths)) {
    if (paths.length === 1 && paths[0]) byId[id] = paths[0];
    else duplicateIds[id] = paths;
  }
  const excludedBySlug: Record<string, string> = {};
  const duplicateExcludedSlugs: Record<string, string[]> = {};
  for (const [slug, paths] of Object.entries(excludedSlugPaths)) {
    if (paths.length === 1 && paths[0]) excludedBySlug[slug] = paths[0];
    else duplicateExcludedSlugs[slug] = paths;
  }
  const backlinks: VaultIndex["backlinks"] = {};
  const outgoingLinks: VaultIndex["outgoingLinks"] = {};
  const brokenLinks: VaultIndex["brokenLinks"] = [];
  for (const note of Object.values(notes)) {
    for (const wl of note.wikilinks) {
      const resolution = resolveWikiLink(
        { notes, bySlug, duplicateSlugs, byId, duplicateIds, excludedPaths, excludedBySlug },
        wl,
      );
      const targetPath = resolution.status === "resolved" ? resolution.targetPath : undefined;
      (outgoingLinks[note.path] ||= []).push({
        target: wl.target,
        targetPath,
        anchor: wl.anchor,
        alias: wl.alias,
        raw: wl.raw,
        status: resolution.status,
        broken: !targetPath,
        targetPaths: resolution.status === "ambiguous" ? resolution.targetPaths : undefined,
      });
      if (!targetPath) {
        if (
          resolution.status === "missing" ||
          resolution.status === "excluded-by-index-scope" ||
          resolution.status === "invalid"
        ) {
          brokenLinks.push({
            fromPath: note.path,
            target: wl.target,
            anchor: wl.anchor,
            raw: wl.raw,
            status: resolution.status,
            targetPath:
              resolution.status === "excluded-by-index-scope" ? resolution.targetPath : undefined,
          });
        }
        continue;
      }
      (backlinks[targetPath] ||= []).push({
        fromPath: note.path,
        anchor: wl.anchor,
        alias: wl.alias,
      });
    }
  }
  const orphanNotes = Object.values(notes)
    .filter(
      (note) =>
        (outgoingLinks[note.path] ?? []).length === 0 && (backlinks[note.path] ?? []).length === 0,
    )
    .map((note) => note.path);
  return {
    notes,
    bySlug,
    duplicateSlugs,
    byId,
    duplicateIds,
    excludedBySlug,
    duplicateExcludedSlugs,
    excludedPaths,
    outgoingLinks,
    backlinks,
    brokenLinks,
    orphanNotes,
  };
}

export function resolveWikiLink(
  index: Pick<
    VaultIndex,
    | "notes"
    | "bySlug"
    | "duplicateSlugs"
    | "byId"
    | "duplicateIds"
    | "excludedPaths"
    | "excludedBySlug"
  >,
  link: WikiLink,
): WikiLinkResolution {
  const target = link.target.trim();
  if (!target) return { status: "missing" };
  if (isUnsafeWikiPath(target)) {
    return { status: "invalid", reason: "Wikilink target must be vault-root-relative" };
  }
  if (target.includes("/")) {
    const path = target.toLowerCase().endsWith(".md") ? target : `${target}.md`;
    if (index.notes[path]) return { status: "resolved", targetPath: path };
    if (index.excludedPaths.includes(path)) {
      return { status: "excluded-by-index-scope", targetPath: path };
    }
    return { status: "missing" };
  }
  const byId = index.byId[target];
  if (byId) return { status: "resolved", targetPath: byId };
  const ambiguousId = index.duplicateIds[target];
  if (ambiguousId?.length) return { status: "ambiguous", targetPaths: ambiguousId };
  const bySlug = index.bySlug[target];
  if (bySlug) return { status: "resolved", targetPath: bySlug };
  const ambiguous = index.duplicateSlugs[target];
  if (ambiguous?.length) return { status: "ambiguous", targetPaths: ambiguous };
  const excludedBySlug = index.excludedBySlug[target];
  if (excludedBySlug) {
    return { status: "excluded-by-index-scope", targetPath: excludedBySlug };
  }
  return { status: "missing" };
}

function isUnsafeWikiPath(target: string): boolean {
  if (target.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(target)) return true;
  if (target.includes("\\")) return true;
  if (target.includes("//")) return true;
  return target.split("/").some((segment) => segment === "" || segment === "..");
}

export function validate(index: VaultIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const idCounts: Record<string, string[]> = {};
  for (const note of Object.values(index.notes)) {
    const id = note.frontmatter.id;
    if (typeof id === "string" && id) {
      (idCounts[id] ||= []).push(note.path);
    } else {
      issues.push({
        kind: "missing-id",
        path: note.path,
        message: `No frontmatter id`,
        severity: "warning",
      });
    }
    if (!note.frontmatter.title) {
      issues.push({
        kind: "missing-title",
        path: note.path,
        message: `No frontmatter title`,
        severity: "warning",
      });
    }
    const seenAnchors = new Set<string>();
    for (const a of note.anchors) {
      if (seenAnchors.has(a)) {
        issues.push({
          kind: "duplicate-anchor",
          path: note.path,
          message: `Duplicate heading anchor "${a}"`,
          severity: "error",
        });
      }
      seenAnchors.add(a);
    }
    for (const wl of note.wikilinks) {
      const resolution = resolveWikiLink(index, wl);
      const targetPath = resolution.status === "resolved" ? resolution.targetPath : undefined;
      if (!targetPath) {
        if (resolution.status === "ambiguous") {
          issues.push({
            kind: "ambiguous-link",
            path: note.path,
            message: `Ambiguous link [[${wl.raw}]] could resolve to ${resolution.targetPaths.join(", ")}`,
            severity: "error",
          });
          continue;
        }
        issues.push({
          kind: "broken-wikilink",
          path: note.path,
          message:
            resolution.status === "invalid"
              ? `Unsafe link [[${wl.raw}]]`
              : resolution.status === "excluded-by-index-scope"
                ? `Target exists but is outside this vault's Index Scope: [[${wl.raw}]]`
                : `Missing link [[${wl.raw}]]`,
          severity: "error",
        });
        continue;
      }
      if (wl.anchor) {
        const target = index.notes[targetPath];
        if (!target.anchors.includes(wl.anchor)) {
          issues.push({
            kind: "missing-anchor",
            path: note.path,
            message: `Missing anchor #${wl.anchor} in ${target.slug}`,
            severity: "error",
          });
        }
      }
    }
  }
  for (const [slug, paths] of Object.entries(index.duplicateSlugs)) {
    for (const p of paths) {
      issues.push({
        kind: "duplicate-slug",
        path: p,
        message: `Ambiguous filename stem "${slug}" also exists in ${paths
          .filter((candidate) => candidate !== p)
          .join(", ")}`,
        severity: "error",
      });
    }
  }
  for (const [id, paths] of Object.entries(idCounts)) {
    if (paths.length > 1) {
      for (const p of paths) {
        issues.push({
          kind: "duplicate-id",
          path: p,
          message: `Duplicate frontmatter id "${id}"`,
          severity: "error",
        });
      }
    }
  }
  return issues;
}
