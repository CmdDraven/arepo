import { Buffer } from "node:buffer";
import { parseFrontmatter } from "../src/lib/vault/frontmatter.js";
import { stripCodeForIndexing, type NoteIndex } from "../src/lib/vault/indexer.js";
import { SEMANTIC_TEXT_VERSION } from "../src/lib/vault/semanticContracts.js";

export { SEMANTIC_TEXT_VERSION };
export const SEMANTIC_TEXT_MAX_BYTES = 24 * 1024;

export function prepareSemanticText(input: { content: string; note: NoteIndex }): string {
  const parsed = parseFrontmatter(input.content);
  const bodyWithoutCode = stripCodeForIndexing(parsed.body);
  const prose = normalizeMarkdownProse(bodyWithoutCode);
  const sections = [`Title: ${normalizeWhitespace(input.note.title)}`];
  const headings = unique(
    input.note.headings
      .map((heading) => normalizeWhitespace(heading.text))
      .filter((heading) => heading.length > 0 && heading !== input.note.title),
  );
  if (headings.length > 0)
    sections.push(`Headings:\n${headings.map((value) => `- ${value}`).join("\n")}`);
  if (prose) sections.push(`Content:\n${prose}`);
  return truncateUtf8(sections.join("\n\n"), SEMANTIC_TEXT_MAX_BYTES);
}

function normalizeMarkdownProse(body: string): string {
  return normalizeWhitespace(
    body
      .replace(/^#{1,6}\s+.*$/gm, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g, "$1")
      .replace(/https?:\/\/[^\s)>\]]+/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/[*_~]+/g, " "),
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) return value;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = maxBytes; end > 0; end -= 1) {
    try {
      return decoder.decode(encoded.subarray(0, end)).trimEnd();
    } catch {
      // Move to the previous complete UTF-8 boundary.
    }
  }
  return "";
}
