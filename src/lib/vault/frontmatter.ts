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

export type RelatedMetadataParseResult = {
  frontmatterStatus: "absent" | "ready" | "malformed";
  fieldStatus: "absent" | "supported" | "unsupported";
  entries: string[];
  issues: string[];
};

export type RelatedMetadataEditResult =
  | { status: "updated"; content: string }
  | { status: "already-present"; content: string }
  | { status: "unsupported" | "malformed"; content: string };

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

export function markdownBodyForRendering(source: string): string {
  return parseFrontmatter(source).body;
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

export function parseRelatedMetadata(source: string): RelatedMetadataParseResult {
  const block = locateFrontmatter(source);
  if (block.status === "absent") {
    return { frontmatterStatus: "absent", fieldStatus: "absent", entries: [], issues: [] };
  }
  if (block.status === "malformed") {
    return {
      frontmatterStatus: "malformed",
      fieldStatus: "unsupported",
      entries: [],
      issues: ["Markdown frontmatter is malformed."],
    };
  }
  return parseRelatedField(block.raw);
}

export function addRelatedMetadataEntry(
  source: string,
  canonicalTarget: string,
): RelatedMetadataEditResult {
  const link = `[[${canonicalTarget}]]`;
  const encoded = JSON.stringify(link);
  const block = locateFrontmatter(source);
  if (block.status === "malformed") return { status: "malformed", content: source };
  if (block.status === "absent") {
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const prefix = `---${newline}related:${newline}  - ${encoded}${newline}---${newline}`;
    return {
      status: "updated",
      content: `${prefix}${source.length > 0 ? newline : ""}${source}`,
    };
  }
  const parsed = parseRelatedField(block.raw);
  if (parsed.fieldStatus === "unsupported" || !frontmatterIsSafeForTextualEdit(block.raw)) {
    return { status: "unsupported", content: source };
  }
  if (parsed.entries.includes(link)) return { status: "already-present", content: source };
  if (parsed.fieldStatus === "absent") {
    const insertion = `related:${block.newline}  - ${encoded}${block.newline}`;
    return {
      status: "updated",
      content: `${source.slice(0, block.closingStart)}${insertion}${source.slice(block.closingStart)}`,
    };
  }
  if (parsed.fieldEnd === undefined || parsed.itemIndent === undefined) {
    return { status: "unsupported", content: source };
  }
  const insertion = `${parsed.itemIndent}- ${encoded}${block.newline}`;
  const absoluteInsertion = block.rawStart + parsed.fieldEnd;
  return {
    status: "updated",
    content: `${source.slice(0, absoluteInsertion)}${insertion}${source.slice(absoluteInsertion)}`,
  };
}

type ReadyFrontmatter = {
  status: "ready";
  raw: string;
  rawStart: number;
  closingStart: number;
  newline: "\n" | "\r\n";
};

type ParsedRelatedField = RelatedMetadataParseResult & {
  fieldEnd?: number;
  itemIndent?: string;
};

function locateFrontmatter(
  source: string,
): { status: "absent" } | { status: "malformed" } | ReadyFrontmatter {
  const opening = source.match(/^---(\r?\n)/);
  if (!opening) return source.startsWith("---") ? { status: "malformed" } : { status: "absent" };
  const newline = opening[1] as "\n" | "\r\n";
  const rawStart = opening[0].length;
  const closingPattern = new RegExp(`^---[ \\t]*(?:${newline}|$)`, "m");
  const rest = source.slice(rawStart);
  const closing = closingPattern.exec(rest);
  if (!closing) return { status: "malformed" };
  const closingStart = rawStart + closing.index;
  return {
    status: "ready",
    raw: source.slice(rawStart, closingStart),
    rawStart,
    closingStart,
    newline,
  };
}

function parseRelatedField(raw: string): ParsedRelatedField {
  const lines = linesWithOffsets(raw);
  const declarations = lines.filter((line) => /^related\s*:/.test(line.text));
  if (declarations.length === 0) {
    return {
      frontmatterStatus: "ready",
      fieldStatus: "absent",
      entries: [],
      issues: [],
    };
  }
  if (declarations.length !== 1) return unsupportedRelated("Duplicate related metadata fields.");
  const declaration = declarations[0];
  const colon = declaration.text.indexOf(":");
  if (declaration.text.slice(colon + 1).trim() !== "") {
    return unsupportedRelated("The related metadata field must be a YAML sequence.");
  }
  const laterTopLevel = lines.find(
    (line) =>
      line.offset > declaration.offset &&
      line.text.trim() !== "" &&
      !line.text.trimStart().startsWith("#") &&
      !/^\s/.test(line.text),
  );
  const fieldEnd = laterTopLevel?.offset ?? raw.length;
  const fieldLines = lines.filter(
    (line) => line.offset > declaration.offset && line.offset < fieldEnd,
  );
  const entries: string[] = [];
  let itemIndent: string | undefined;
  for (const line of fieldLines) {
    if (line.text.trim() === "" || line.text.trimStart().startsWith("#")) continue;
    const item = line.text.match(/^( +)-[ \t]+(.+?)[ \t]*$/);
    if (!item || line.text.includes("\t")) {
      return unsupportedRelated("The related metadata field contains an unsupported value.");
    }
    itemIndent ??= item[1];
    if (item[1] !== itemIndent) {
      return unsupportedRelated("The related metadata sequence uses inconsistent indentation.");
    }
    const decoded = decodeQuotedYamlString(item[2]);
    if (decoded === undefined) {
      return unsupportedRelated("Each related metadata entry must be a quoted string.");
    }
    entries.push(decoded);
  }
  if (entries.length === 0 || !itemIndent) {
    return unsupportedRelated("The related metadata field must be a YAML sequence of strings.");
  }
  return {
    frontmatterStatus: "ready",
    fieldStatus: "supported",
    entries,
    issues: [],
    fieldEnd,
    itemIndent,
  };
}

function unsupportedRelated(message: string): ParsedRelatedField {
  return {
    frontmatterStatus: "ready",
    fieldStatus: "unsupported",
    entries: [],
    issues: [message],
  };
}

function decodeQuotedYamlString(value: string): string | undefined {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return undefined;
}

function frontmatterIsSafeForTextualEdit(raw: string): boolean {
  let hasKey = false;
  for (const { text } of linesWithOffsets(raw)) {
    if (text.trim() === "" || text.trimStart().startsWith("#")) continue;
    if (text.includes("\t")) return false;
    if (/^\s/.test(text)) {
      if (!hasKey) return false;
      continue;
    }
    const field = text.match(/^[A-Za-z0-9_-]+\s*:(.*)$/);
    if (!field || !balancedScalar(field[1])) return false;
    hasKey = true;
  }
  return true;
}

function balancedScalar(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('"') !== trimmed.endsWith('"')) return false;
  if (trimmed.startsWith("'") !== trimmed.endsWith("'")) return false;
  if (trimmed.startsWith("[") !== trimmed.endsWith("]")) return false;
  if (trimmed.startsWith("{") !== trimmed.endsWith("}")) return false;
  return true;
}

function linesWithOffsets(raw: string): Array<{ text: string; offset: number }> {
  const result: Array<{ text: string; offset: number }> = [];
  const expression = /.*(?:\r\n|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(raw)) && match[0] !== "") {
    result.push({ text: match[0].replace(/\r?\n$/, ""), offset: match.index });
  }
  return result;
}
