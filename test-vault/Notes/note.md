---
id: note
title: Test Note
tags: [test, markdown, local, note]
---

# Test Note

This is a disposable test note for a two-file AREPO vault.

There is no required `index.md` inside this vault.

## Purpose {#purpose}

This file tests folder-qualified wikilinks, anchors, backlinks, preview rendering, graph edges, broken-link validation, and ignored code links.

## Valid Folder Links {#valid-folder-links}

This link should resolve to the reference pnote:

[[Reference/reference-note]]

This link should resolve to a specific section in the reference note:

[[Reference/reference-note#anchor-target]]

This link should resolve by frontmatter id if id-based links are supported:

[[reference-note]]

## Intentional Broken Link {#intentional-broken-link}

This link is intentionally broken:

[[missing-note]]

## Ignored Code Links {#ignored-code-links}

The indexer and preview renderer should not treat these fenced-code examples as real links:

```md
[[Reference/fake-code-link]]
[[Notes/another-fake-note]]
```

The indexer and preview renderer should also ignore inline code like `[[Reference/inline-fake-link]]`.

## Table {#table}

| Test | Expected Result |
|---|---|
| Folder link | `Reference/reference-note` resolves |
| Anchor link | `Reference/reference-note#terminology` resolves |
| Broken link | `missing-note` appears as an issue |
| Code link | `Reference/fake-code-link` is ignored |

## Backlink Target {#backlink-target}

The reference note should link back to this section.

## Manual Test Section

This section is provided as a reference point for manual testing of features as seen fit.
