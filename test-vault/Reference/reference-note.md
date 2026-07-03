---
id: reference-note
title: Reference Note
tags: [reference, markdown, test, local]
---

# Reference Note

This is a disposable reference note for an AREPO vault fixture with top-level and nested Markdown files.

## Overview {#overview}

This link should resolve to the main test note:

[[Notes/note]]

This link should resolve to a specific section in the main test note:

[[Notes/note#backlink-target]]

This link should resolve to the nested test note:

[[Notes/Nestest/note]]

This link should resolve to a specific section in the nested test note:

[[Notes/Nestest/note#nested-anchor-target]]

This link should resolve by frontmatter id if id-based links are supported:

[[note]]

This nested note link should also resolve by frontmatter id if id-based links are supported:

[[notes-nestest-note]]

## Terminology {#terminology}

| Term | Meaning |
|---|---|
| Vault | A configured folder containing Markdown files |
| Note | A Markdown file inside a vault |
| Nested note | A Markdown file inside a subdirectory, such as `Notes/Nestest/note.md` |
| Wikilink | A link written like `[[Notes/note]]` |
| Anchor | A stable section id like `{#overview}` |

## Intentional Broken Link {#intentional-broken-link}

This link is intentionally broken:

[[Reference/missing-reference]]

## Ignored Code Links {#ignored-code-links}

The indexer and preview renderer should not treat these fenced-code examples as real links:

```md
[[Reference/fake-reference-link]]
[[Notes/fake-note]]
[[Notes/Nestest/fake-nested-reference]]
```

The indexer and preview renderer should also ignore inline code like `[[inline-fake-reference]]`.

## Anchor Target {#anchor-target}

This section exists so the main test note and nested test note can link here.
