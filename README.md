# Vault — Local Markdown Knowledge Base

A small, local-first Markdown editor + indexer + viewer.

The point of this app is **not** to be your storage layer. Plain `.md`
files on disk are the source of truth. The app only:

- shows you a file tree of a vault
- lets you edit Markdown
- previews it (with wikilinks, anchors, frontmatter)
- indexes notes into a rebuildable graph
- shows backlinks and validation issues

Sync, history, and backups are intentionally **not** in scope. Use:

- **Syncthing** for sync between devices
- **Git** for version history
- **Borg / Restic / Kopia** for backups

There is no login, no cloud, no analytics, no telemetry, no proprietary
file format. Everything runs in your browser.

## Running locally

```bash
npm install
npm run dev
```

Then open the URL the dev server prints (typically
`http://localhost:8080`).

## Storage in this prototype

This is a browser prototype, so the workspace is currently kept in your
browser's `localStorage`, seeded from `src/lib/vault/demo.ts` on first
load. The data shape is just `path -> markdown string` — nothing
proprietary. "Reset demo" in the top bar wipes localStorage and
re-seeds the demo files.

To bind the app to a real folder of `.md` files on disk, swap
`src/lib/vault/store.ts` for an implementation backed by the File
System Access API or a tiny local Node server. The indexer
(`src/lib/vault/indexer.ts`) and renderer (`src/lib/vault/render.ts`)
are pure functions over a `Record<string, string>` and don't care where
the files come from.

## Markdown conventions

### YAML frontmatter

```markdown
---
id: project-plan
title: Project Alpha Plan
tags: [notes, planning]
---
```

### Explicit heading anchors

```markdown
## Milestones {#milestones}
```

### Wikilinks

```markdown
[[Some Note]]
[[Some Note#section-id]]
[[Some Note#section-id|Alias Text]]
```

Wikilink targets resolve by **filename stem** (`project-plan.md` →
`project-plan`) or by **frontmatter `id`**. Broken links are rendered
in red with a strikethrough and listed in the validation panel.

## Index

The index lives in memory and is rebuilt on every change. For each
note it records: path, title, frontmatter id, tags, headings,
heading anchors, outgoing wikilinks, and backlinks. It is fully
disposable — delete it and rebuild it from the Markdown files.

## Validation

The right pane lists, for the active file:

- broken wikilinks
- missing anchors
- duplicate heading anchors within the file
- duplicate frontmatter ids across the vault
- missing title / missing id (warnings, not fatal)

## Keyboard

- `Ctrl/Cmd + S` — save the current file
