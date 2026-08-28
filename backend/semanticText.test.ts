import test from "node:test";
import assert from "node:assert/strict";
import { deriveMarkdownSource } from "../src/lib/vault/indexer.js";
import {
  prepareSemanticText,
  SEMANTIC_TEXT_MAX_BYTES,
  SEMANTIC_TEXT_VERSION,
} from "./semanticText.js";

test("semantic text is versioned Markdown-derived title, headings, and prose", () => {
  const content = `---\ntitle: Private title\ntags: [secret]\n---\n# Visible heading\nWords with [a link](https://example.com/private), [[target|friendly label]], and \`INLINE_SECRET\`.\n\n\`\`\`sh\nTOKEN=secret\n\`\`\``;
  const note = deriveMarkdownSource("notes/example.md", content);
  const text = prepareSemanticText({ content, note });
  assert.equal(SEMANTIC_TEXT_VERSION, 1);
  assert.match(text, /^Title: Private title/);
  assert.match(text, /Visible heading/);
  assert.match(text, /Words with a link, friendly label/);
  assert.equal(text.includes("TOKEN=secret"), false);
  assert.equal(text.includes("INLINE_SECRET"), false);
  assert.equal(text.includes("https://example.com/private"), false);
  assert.equal(text.includes("tags:"), false);
});

test("empty and near-empty Markdown produce stable bounded title context", () => {
  const empty = deriveMarkdownSource("empty-note.md", "");
  assert.equal(prepareSemanticText({ content: "", note: empty }), "Title: empty-note");
  const heading = deriveMarkdownSource("heading.md", "# Heading only\n");
  assert.equal(
    prepareSemanticText({ content: "# Heading only\n", note: heading }),
    "Title: Heading only",
  );
});

test("semantic text truncates deterministically at a complete UTF-8 boundary", () => {
  const content = `# Long\n${"🙂 semantic prose ".repeat(4_000)}`;
  const note = deriveMarkdownSource("long.md", content);
  const first = prepareSemanticText({ content, note });
  const second = prepareSemanticText({ content, note });
  assert.equal(first, second);
  assert.ok(Buffer.byteLength(first, "utf8") <= SEMANTIC_TEXT_MAX_BYTES);
  assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(first)));
});
