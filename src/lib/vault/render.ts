// Markdown -> HTML, with wikilink pre-processing and explicit-anchor heading
// rewriting. Wikilinks become anchor tags with data attributes so the host
// component can intercept clicks and route inside the app.

import { marked } from "marked";
import type { VaultIndex } from "./indexer";

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const HEADING_ANCHOR_RE = /^(#{1,6}\s+.+?)\s*\{#([a-z0-9_-]+)\}\s*$/gim;

export function renderMarkdown(body: string, index: VaultIndex): string {
  // Replace wikilinks before passing to marked so they survive as HTML.
  const withLinks = body.replace(WIKILINK_RE, (_m, inner: string) => {
    let target = inner;
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
    const targetPath = index.bySlug[target] ?? index.byId[target];
    const broken = !targetPath;
    const label = alias ?? (anchor ? `${target}#${anchor}` : target);
    const cls = broken ? "wikilink wikilink-broken" : "wikilink";
    const dataPath = targetPath ? ` data-path="${targetPath}"` : "";
    const dataAnchor = anchor ? ` data-anchor="${anchor}"` : "";
    return `<a href="#" class="${cls}"${dataPath}${dataAnchor}>${label}</a>`;
  });

  // Rewrite "## Foo {#id}" into a heading with id=id and strip the {#id}.
  const withAnchors = withLinks.replace(
    HEADING_ANCHOR_RE,
    (_m, head: string, id: string) => `${head} <a id="${id}"></a>`,
  );

  return marked.parse(withAnchors, { async: false }) as string;
}
