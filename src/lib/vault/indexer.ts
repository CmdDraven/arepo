// Pure indexer over a map of path -> markdown content. The index is
// disposable; it can be rebuilt from the Markdown files alone.

import { parseFrontmatter, type Frontmatter } from "./frontmatter";

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

export type NoteIndex = {
  path: string;
  slug: string; // filename without .md
  title: string;
  frontmatter: Frontmatter;
  headings: Heading[];
  anchors: string[];
  wikilinks: WikiLink[];
  tags: string[];
  body: string;
};

export type VaultIndex = {
  notes: Record<string, NoteIndex>; // by path
  bySlug: Record<string, string>; // slug -> path
  byId: Record<string, string>; // frontmatter id -> path
  backlinks: Record<string, { fromPath: string; anchor?: string; alias?: string }[]>;
};

export type ValidationIssue = {
  kind:
    | "broken-wikilink"
    | "missing-anchor"
    | "duplicate-id"
    | "duplicate-anchor"
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
    const raw = m[1];
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
    out.push({ target, anchor, alias, raw });
  }
  return out;
}

export function indexNote(path: string, content: string): NoteIndex {
  const { frontmatter, body } = parseFrontmatter(content);
  const headings = extractHeadings(body);
  const wikilinks = extractWikilinks(body);
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
    tags: Array.isArray(frontmatter.tags)
      ? (frontmatter.tags as string[]).map(String)
      : [],
    body,
  };
}

export function buildIndex(files: Record<string, string>): VaultIndex {
  const notes: Record<string, NoteIndex> = {};
  const bySlug: Record<string, string> = {};
  const byId: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith(".md")) continue;
    const note = indexNote(path, content);
    notes[path] = note;
    bySlug[note.slug] = path;
    const id = note.frontmatter.id;
    if (typeof id === "string" && id && !(id in byId)) {
      byId[id] = path;
    }
  }
  const backlinks: VaultIndex["backlinks"] = {};
  for (const note of Object.values(notes)) {
    for (const wl of note.wikilinks) {
      const targetPath = bySlug[wl.target] ?? byId[wl.target];
      if (!targetPath) continue;
      (backlinks[targetPath] ||= []).push({
        fromPath: note.path,
        anchor: wl.anchor,
        alias: wl.alias,
      });
    }
  }
  return { notes, bySlug, byId, backlinks };
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
      const targetPath = index.bySlug[wl.target] ?? index.byId[wl.target];
      if (!targetPath) {
        issues.push({
          kind: "broken-wikilink",
          path: note.path,
          message: `Broken link [[${wl.raw}]]`,
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
