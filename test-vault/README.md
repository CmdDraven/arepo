---
id: readme
title: Test Vault README
tags: [test, markdown, local]
---

# AREPO Test Vault

This folder is a disposable example Markdown vault for AREPO. It is kept in the repository as a manual-test and demo fixture, not as generated app data and not as a real user vault.

It demonstrates:

- folder-qualified wikilinks such as [[Reference/reference-note]] and [[Notes/note]]
- heading-anchor links such as [[Reference/reference-note#terminology]]
- backlinks between notes
- intentional broken-link validation
- graph mode with linked notes and missing-link nodes
- ignored wikilinks inside fenced code blocks and inline code

It is safe to edit, reset, or delete locally while testing. If you want to restore it after manual edits, use your normal Git workflow. AREPO does not require this folder at runtime.

This vault should not contain generated AREPO machine index data, app cache files, `.arepo/`, `node_modules/`, or build output. AREPO stores generated machine indexes outside user vaults by default.

To test it:

1. Run AREPO locally from the repository root.
2. Open the Vaults settings UI.
3. Add a vault using the absolute path to this `test-vault` folder.
4. Let AREPO build the machine index automatically.
