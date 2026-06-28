// Markdown -> HTML, with wikilink pre-processing and explicit-anchor heading
// rewriting. Wikilinks become anchor tags with data attributes so the host
// component can intercept clicks and route inside the app.

import { marked } from "marked";
import {
  maskMarkdownCode,
  parseWikiLink,
  resolveWikiLink,
  restoreMarkdownCode,
  type VaultIndex,
} from "./indexer.js";

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const HEADING_ANCHOR_RE = /^(#{1,6}\s+.+?)\s*\{#([a-z0-9_-]+)\}\s*$/gim;

export function renderMarkdown(body: string, index: VaultIndex): string {
  // Mask Markdown code before replacing wikilinks so literal examples stay literal.
  const masked = maskMarkdownCode(body);
  const withLinks = masked.masked.replace(WIKILINK_RE, (_m, inner: string) => {
    const link = parseWikiLink(inner);
    const resolution = resolveWikiLink(index, link);
    const targetPath = resolution.status === "resolved" ? resolution.targetPath : undefined;
    const broken = resolution.status !== "resolved";
    const label = link.alias ?? (link.anchor ? `${link.target}#${link.anchor}` : link.target);
    const cls =
      resolution.status === "ambiguous"
        ? "wikilink wikilink-broken wikilink-ambiguous"
        : broken
          ? "wikilink wikilink-broken"
          : "wikilink";
    const dataPath = targetPath ? ` data-path="${escapeAttr(targetPath)}"` : "";
    const dataAnchor = link.anchor ? ` data-anchor="${escapeAttr(link.anchor)}"` : "";
    return `<a href="#" class="${cls}"${dataPath}${dataAnchor}>${escapeHtml(label)}</a>`;
  });
  const restored = restoreMarkdownCode(withLinks, masked.code);

  // Rewrite "## Foo {#id}" into a heading with id=id and strip the {#id}.
  const withAnchors = restored.replace(
    HEADING_ANCHOR_RE,
    (_m, head: string, id: string) => `${head} <a id="${escapeAttr(id)}"></a>`,
  );

  return sanitizeHtml(marked.parse(withAnchors, { async: false }) as string);
}

const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

const GLOBAL_ATTRS = new Set(["id", "class"]);
const LINK_ATTRS = new Set(["href", "title", "data-path", "data-anchor"]);

function sanitizeHtml(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  cleanNode(doc.body);
  return doc.body.innerHTML;
}

function cleanNode(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        element.replaceWith(...Array.from(element.childNodes));
        continue;
      }
      for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        const allowed = GLOBAL_ATTRS.has(name) || (tag === "a" && LINK_ATTRS.has(name));
        if (!allowed || name.startsWith("on")) {
          element.removeAttribute(attr.name);
          continue;
        }
        if ((name === "href" || name === "src") && isUnsafeUrl(attr.value)) {
          element.removeAttribute(attr.name);
        }
      }
    } else if (
      child.nodeType !== Node.TEXT_NODE &&
      child.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    ) {
      child.remove();
      continue;
    }
    cleanNode(child);
  }
}

function isUnsafeUrl(value: string): boolean {
  const trimmed = Array.from(value.trim())
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f && !/\s/.test(char);
    })
    .join("");
  return /^(javascript|data|vbscript):/i.test(trimmed);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
