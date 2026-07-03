---
id: note
title: Test Note
tags: [test, markdown, local, note]
---

# Test Note

This is a disposable main test note for an AREPO vault fixture.

There is no required `index.md` inside this vault.

## Purpose {#purpose}

This file tests folder-qualified wikilinks, nested Markdown discovery, anchors, backlinks, preview rendering, graph edges, broken-link validation, and ignored code links.

## Valid Folder Links {#valid-folder-links}

This link should resolve to the reference note:

[[Reference/reference-note]]

This link should resolve to a specific section in the reference note:

[[Reference/reference-note#terminology]]

This link should resolve to the nested test note:

[[Notes/Nestest/note]]

This link should resolve to a specific section in the nested test note:

[[Notes/Nestest/note#nested-anchor-target]]

This link should resolve by frontmatter id if id-based links are supported:

[[reference-note]]

This nested note link should also resolve by frontmatter id if id-based links are supported:

[[notes-nestest-note]]

## Intentional Broken Link {#intentional-broken-link}

This link is intentionally broken:

[[missing-note]]

## Ignored Code Links {#ignored-code-links}

The indexer and preview renderer should not treat these fenced-code examples as real links:

```md
[[Reference/fake-code-link]]
[[Notes/another-fake-note]]
[[Notes/Nestest/fake-code-link]]
```

The indexer and preview renderer should also ignore inline code like `[[Reference/inline-fake-link]]`.

## Table {#table}

| Test | Expected Result |
|---|---|
| Folder link | `Reference/reference-note` resolves |
| Anchor link | `Reference/reference-note#terminology` resolves |
| Nested file link | `Notes/Nestest/note` resolves |
| Nested anchor link | `Notes/Nestest/note#nested-anchor-target` resolves |
| Broken link | `missing-note` appears as an issue |
| Code link | `Reference/fake-code-link` is ignored |

## Backlink Target {#backlink-target}

The reference note and nested test note should link back to this section.

## Manual Test Section

This section is provided as a reference point for manual testing of features as seen fit.
