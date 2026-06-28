// Minimal YAML frontmatter parser. Supports scalars + simple [a, b] arrays.
// Good enough for tags/title/id without pulling a YAML dep.

export type Frontmatter = {
  id?: string;
  title?: string;
  tags?: string[];
  [k: string]: unknown;
};

export type ParsedDoc = {
  frontmatter: Frontmatter;
  body: string;
  frontmatterRaw: string;
};

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseScalar(v: string): unknown {
  v = v.trim();
  if (!v) return "";
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function parseFrontmatter(source: string): ParsedDoc {
  const m = source.match(FM_RE);
  if (!m) return { frontmatter: {}, body: source, frontmatterRaw: "" };
  const raw = m[1];
  const fm: Frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    fm[key] = parseScalar(value);
  }
  return {
    frontmatter: fm,
    body: source.slice(m[0].length),
    frontmatterRaw: raw,
  };
}

export function stringifyFrontmatter(fm: Frontmatter, body: string): string {
  const keys = Object.keys(fm);
  if (!keys.length) return body;
  const lines = keys.map((k) => {
    const v = fm[k];
    if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
    return `${k}: ${String(v)}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body.startsWith("\n") ? body.slice(1) : body}`;
}
