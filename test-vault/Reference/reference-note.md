---
id: reference-note
title: Reference Note
tags: [reference, test]
---

# Reference Note

This is a disposable reference note for a two-file AREPO vault.

## Overview {#overview}

This link should resolve to the test note:

[[Notes/note]]

This link should resolve to a specific section in the test note:

[[Notes/note#backlink-target]]

This link should resolve by frontmatter id if id-based links are supported:

[[note]]

## Terminology {#terminology}

| Term | Meaning |
|---|---|
| Vault | A configured folder containing Markdown files |
| Note | A Markdown file inside a vault |
| Wikilink | A link written like `[[Notes/note]]` |
| Anchor | A stable section id like `{#overview}` |

## Anchor Target {#anchor-target}

This section exists so the test note can link here.

## Intentional Broken Link {#intentional-broken-link}

This link is intentionally broken:

[[Reference/missing-reference]]

## Ignored Code Links {#ignored-code-links}

The indexer and preview renderer should not treat these fenced-code examples as real links:

```md
[[Reference/fake-reference-link]]
[[Notes/fake-note]]
```

The indexer and preview renderer should also ignore inline code like `[[inline-fake-reference]]`.

