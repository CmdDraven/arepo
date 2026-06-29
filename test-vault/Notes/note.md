---
id: note
title: Test Note
tags: [test, markdown, local]
---

# Test Note

This is a disposable test note for a two-file mdAtlas vault.

There is no required `index.md` inside this vault. 

## Purpose {#purpose}

This file tests folder-qualified wikilinks, anchors, backlinks, preview rendering, graph edges, broken-link validation, and ignored code links.

## Valid Folder Links {#valid-folder-links}

This link should resolve to the reference pnote:

[[Reference/reference-note]]

This link should resolve to a specific section in the reference note:

[[Reference/reference-note#terminology]]

This link should resolve by frontmatter id if id-based links are supported:

[[reference-note]]

## Backlink Target {#backlink-target}

The reference note should link back to this section.

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

## Manual Test

This section is being created while the file is open in mdAtlas, to test behavior with live changes. 

During further testing, edits or addendums to this section will suffice.

Testing live update in this line.

This line conflicts from the live edit data in mdAtlas. Intended to test the Live Buffer is not overwritten. 

Next is testing that buffer writes can be chosen in favour of the local change.
