---
id: notes-nestest-note
title: Nested Test Note
tags: [test, markdown, local, nested]
---

# Nested Test Note

This is a disposable nested test note for the AREPO test vault.

Its purpose is to confirm that Markdown files inside nested subdirectories are discovered, indexed, rendered, and included in graph data like ordinary top-level notes. 

## Purpose {#purpose}

This file should be discovered at:

`Notes/Nestest/note.md`

The indexer should treat it as a normal Markdown note, including its frontmatter, headings, anchors, tags, outgoing links, backlinks, and graph node.

## Valid Vault Links {#valid-vault-links}

This link should resolve to the main test note:

[[Notes/note]]

This link should resolve to a specific section in the main test note:

[[Notes/note#backlink-target]]

This link should resolve to the reference note:

[[Reference/reference-note]]

This link should resolve to a specific section in the reference note:

[[Reference/reference-note#terminology]]

## Nested Anchor Target {#nested-anchor-target}

Other notes can link directly to this section with:

`[[Notes/Nestest/note#nested-anchor-target]]`

## Ignored Code Links {#ignored-code-links}

The indexer and preview renderer should not treat these fenced-code examples as real links:

```md
[[Notes/Nestest/fake-nested-link]]
[[Reference/fake-nested-reference]]
````

The indexer and preview renderer should also ignore inline code like `[[Notes/Nestest/inline-fake-link]]`.

## Manual Test Expectations {#manual-test-expectations}

| Test                  | Expected Result                                                 |
| --------------------- | --------------------------------------------------------------- |
| Nested file discovery | `Notes/Nestest/note.md` appears in the vault tree               |
| Frontmatter ID        | `notes-nestest-note` is indexed without conflicting with `note` |
| Folder link           | `Notes/note` resolves                                           |
| Anchor link           | `Notes/note#backlink-target` resolves                           |
| Reference link        | `Reference/reference-note` resolves                             |
| Code links            | Fake links inside code are ignored                              |

## Backlink Source {#backlink-source}

This section links back to the main note and reference note so graph and backlink behavior can be checked from a nested file.
