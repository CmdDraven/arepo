export type DemoFile = { path: string; content: string };

export const DEMO_FILES: DemoFile[] = [
  {
    path: "index.md",
    content: `---
id: index
title: Example Workspace
tags: [index, meta]
---

# Example Workspace

Welcome to your local Markdown knowledge base. The notes below are plain
\`.md\` files on disk — this app only indexes them.

## Sections

- [[meeting-notes|Weekly Meeting Notes]]
- [[project-plan]]
- [[style-guide]]
- [[terminology]]

## Broken link demo

This link points nowhere on purpose: [[nonexistent-note]].

And this anchor is missing: [[project-plan#does-not-exist]].
`,
  },
  {
    path: "Notes/meeting-notes.md",
    content: `---
id: meeting-notes
title: Weekly Meeting Notes
tags: [notes, meeting]
---

# Weekly Meeting Notes

Notes from the weekly sync. Related: [[project-plan]].

## Attendees {#attendees}

- Alice
- Bob
- Carol

## Agenda {#agenda}

1. Review last week's actions
2. Discuss [[project-plan#milestones]]
3. Open questions

## Action Items {#action-items}

- Draft the next iteration of [[project-plan]]
- Update [[style-guide]] with the new heading rules
`,
  },
  {
    path: "Notes/project-plan.md",
    content: `---
id: project-plan
title: Project Alpha Plan
tags: [notes, planning]
---

# Project Alpha Plan

High-level plan for Project Alpha. See also [[meeting-notes]] and
[[terminology]] for definitions.

## Goals {#goals}

1. Ship the first prototype
2. Collect feedback from reviewers
3. Plan Project Beta

## Milestones {#milestones}

| Milestone | Owner | Status |
| --- | --- | --- |
| Draft outline | Alice | Done |
| Build prototype | Bob | In progress |
| Review session | Carol | Pending |

## Checklist {#checklist}

- [ ] Confirm scope
- [ ] Assign owners
- [ ] Schedule review per [[meeting-notes#agenda]]
`,
  },
  {
    path: "Reference/style-guide.md",
    content: `---
id: style-guide
title: Style Guide
tags: [reference, style]
---

# Style Guide

Conventions for notes in this Example Workspace.

## Headings {#headings}

Use sentence case. Add explicit anchors with \`{#anchor-id}\` for any
heading you expect other notes to link to.

## Links {#links}

Prefer wikilinks like [[terminology]] over raw URLs for notes inside the
vault. See [[terminology#sample-term]] for vocabulary.
`,
  },
  {
    path: "Reference/terminology.md",
    content: `---
id: terminology
title: Terminology
tags: [reference, glossary]
---

# Terminology

Shared vocabulary used across the workspace. See also [[style-guide]].

## Sample Term {#sample-term}

A placeholder definition for a generic concept used in [[project-plan]].

## Review Checklist {#review-checklist}

- Confirm the note has a frontmatter \`id\` and \`title\`
- Verify wikilinks resolve
- Cross-check against [[style-guide#headings]]
`,
  },
];
