# AREPO Local Mode Manual Acceptance Test

Use this checklist before treating a local build as usable. The default fixture
is the repository's committed `test-vault/` folder. It is safe to edit and reset
locally, but it is not a real user vault.

This is the canonical manual daily-driver acceptance gate for AREPO V1 local
mode. It verifies current local-node behavior only. Disabled mode remains the
default compatibility path. Protected mode has a separate local operator flow in
[Protected Mode Operator Workflow](protected-mode-operator-workflow.md), but it
must not be used to imply that LAN exposure, reverse-proxy exposure, sync,
AI/vector features, database support, migrations, federation, or remote nodes
are implemented.

## Prerequisites

- Node dependencies are installed with `npm install`.
- You have two terminal windows open at the AREPO repository root.
- You have a browser available on the same machine.

## Release Gate Commands

Run these commands before or after the manual checklist. A local daily-driver
release candidate should pass all four:

```bash
npm run backend:test
npm run frontend:test
npm run lint
npm run build
```

Expected result:

- Backend tests pass.
- Frontend workspace helper tests pass.
- Lint passes. The existing Fast Refresh warnings in shared UI components are
  acceptable if still present.
- Build passes.
- `package.json` includes a focused `frontend:test` script for fragile workspace
  state helpers. It is not a broad browser or end-to-end test suite.

## 1. Start Backend And Frontend

1. Start the guided local backend workflow:

   ```bash
   npm run backend:dev
   ```

2. Expected result: the backend starts in the current terminal and prints the
   default backend URL: `http://127.0.0.1:8734`.
3. Expected result: AREPO opens a second terminal with frontend/build targets,
   or prints the fallback command `npm run frontend:menu`.
4. In the frontend target menu, choose `dev`.
5. Confirm the backend does not bind to `0.0.0.0` unless explicitly configured.
6. To run only the backend without the launcher, use:

   ```bash
   npm run backend:dev:server
   ```

7. To override the backend port for a test run, use `AREPO_PORT`, for example:

   ```bash
   AREPO_PORT=9002 npm run backend:dev:server
   ```

8. You can also start the frontend directly on the default local UI port:

   ```bash
   npm run dev
   ```

9. Open `http://localhost:8733` in the browser, or the URL printed by Vite.
10. To override the frontend port, use normal Vite CLI arguments:

    ```bash
    npm run dev -- --port 9001
    ```

11. Expected result: when using the Vite dev server, the app still talks to
    the backend through the `/api` proxy after a frontend port override.
12. If the frontend is served without the Vite dev proxy, restart the backend
    with that origin in the CORS allowlist:

    ```bash
    AREPO_ALLOWED_ORIGINS=http://localhost:9001 npm run backend:dev:server
    ```

13. Expected result: the app loads without requiring a cloud account, hosted
    database, remote API, or login.
14. Expected result: the backend remains bound to `127.0.0.1` unless explicitly
    configured with `AREPO_HOST`.

## 2. Locate The Repository Test Vault

1. From the AREPO repository root, print the absolute path to the example
   vault:

   ```bash
   realpath test-vault
   ```

2. Expected result: the path points to the repository's `test-vault/` folder.
3. Expected result: the vault contains ordinary Markdown files on disk. No app
   database is required to create or inspect it.
4. Keep this path available for the Add vault flow.

## 3. Add Vault In UI

1. In AREPO, open the Vaults or Settings screen.
2. Confirm the local node health indicator can test the backend connection.
3. Add a vault with:
   - Name: `Test Vault`
   - Root path: the absolute path printed by `realpath test-vault`
   - Permissions: `readIndex`, `readContent`, and `writeContent` enabled
   - `deleteFiles` disabled
4. Submit the form.
5. Expected result: the vault appears in the configured vault list with display
   name, vault id, root path, permissions, file count, indexed note count,
   generated machine index status, vault content size, Markdown/text size,
   attachment/other size, and AREPO map/index cache size.
6. Expected result: if the backend rejects the vault, the UI shows the backend
   error clearly.

### Remove Vault From AREPO

Use a disposable vault for this check, or be prepared to re-add `test-vault/`
afterward.

1. Open Vault Settings and find the configured vault entry.
2. Click `Forget vault`.
3. Expected result: the confirmation says this removes the vault from AREPO and
   does not delete the vault folder or source files.
4. Choose `Keep AREPO-generated index/cache data`, then click
   `Remove from AREPO`.
5. Expected result: the vault disappears from the configured vault list and the
   editor/graph/inspect views do not continue showing stale data for that
   removed vault.
6. Expected result: the vault folder and Markdown/source files still exist on
   disk.
7. Re-add the same vault and confirm AREPO opens and indexes it normally.
8. Remove it again, choosing `Discard AREPO-generated index/cache data`.
9. Expected result: source files still exist, and only verified AREPO-owned
   generated/index/cache data for that vault is removed.
10. Optional stale registration check: register a disposable vault, move or
    delete the vault folder outside AREPO, then use `Forget vault`.
11. Expected result: AREPO can still remove the stale registration. If generated
    data cannot be verified as AREPO-owned and vault-specific, the UI shows a
    diagnostic instead of deleting it.

## 4. Local Node Diagnostics

Open Vault Settings and inspect the `Local Node Diagnostics` card.

1. Expected result: the card is read-only and clearly describes itself as local
   AREPO backend runtime status, not remote node or federation setup.
2. Expected result: node display name, node id, and node mode render.
3. Expected result: backend host and port render. Defaults should be
   `127.0.0.1:8734` unless explicitly overridden.
4. Expected result: configured browser CORS origins render, including
   `http://localhost:8733` and `http://127.0.0.1:8733` by default.
5. Expected result: vault count renders and matches the configured vault list.
6. Expected result: each configured vault shows watcher/index health, including
   index status and changed-path counts.
7. Expected result: storage-summary availability renders for each vault.
8. Expected result: in the default compatibility path, authentication posture
   renders as disabled/inactive: operational `mode` is `disabled`, requested
   mode is `disabled` unless explicitly configured otherwise, and enforcement is
   `none`.
9. Expected result: no browser login, browser sessions, bearer-token storage,
   pairing UI, or credential-management UI is active or presented.
10. Expected result: protected-mode policy plumbing renders accurately for the
   configured mode: route policy inventory is present, disabled mode shows no
   enforcement, protected mode shows active local bearer-token enforcement only
   when configured and ready, CSRF/origin enforcement for browser sessions is
   inactive, and network safety is `no`.
11. Expected result: protected request dry-run status renders with the Phase 4
   vocabulary: observer configured, observer mounted, observed requests, planned
   response, audit configured, audit attempted, audit appended, and enforced.
   By default observer configured/mounted are `no`, observed requests are `0`,
   audit is disabled, enforced is `no`, enforcement remains inactive, and no
   credentials, sessions, bearer tokens, cookies, login, or pairing controls are
   active or presented.
12. Expected result: if `auth.dryRunRequestPolicy` is explicitly enabled in a
   disposable local config, diagnostics may show observer configured/mounted,
   increment observed request counts, and show a sanitized last observed request
   plus a planned response kind/status/reason. Planned responses are not sent
   and requests still succeed or fail only by existing V1 route behavior.
   Network safety remains `no`.
13. Expected result: if both `auth.dryRunRequestPolicy` and `auth.dryRunAudit`
   are explicitly enabled in a disposable local config, diagnostics may show
   audit configured, audit attempted, audit appended, and last audit status. An
   attempted audit is still observation-only; audit failures do not reject
   requests and network safety remains `no`.
14. Optional API check: request `GET /api/node/auth/dry-run`.
15. Expected result: the response is diagnostic-only and sanitized. It may show
   configured/mounted/observed/planned/audited state, counters, high-level
   status, and reason codes, plus a planned response kind/status/reason. It must
   not include raw credentials, cookies, authorization header values, vault
   roots, filesystem paths, source document bodies, verifier hashes, or salts. It
   must report whether dry-run enforcement is active and must keep network
   safety `false`.
16. Expected result: protected-mode startup and readiness diagnostics render
   stable blocker codes when readiness is incomplete. Displayed blockers must
   not include vault roots, filesystem paths, credentials, cookies, verifier
   hashes, salts, or source document content.
17. Expected result: in protected mode, anonymous `GET /api/node/status` and
   `GET /api/health` return reduced diagnostics. Authorized status with a valid
   bearer token may return full diagnostics and safe credential lifecycle
   posture only.
18. Expected result: unsupported V1 capabilities are visible as disabled:
   browser login, browser sessions, live CSRF-protected browser auth, frontend
   token storage, remote nodes, sync, AI/vector, database support, and
   migrations.
19. Expected result: the diagnostics card does not contain controls to enable
   auth, sync, AI/vector features, database support, migrations, federation,
   remote node registration, reverse proxy setup, or LAN exposure.
20. Stop the backend while leaving the frontend open, then refresh diagnostics
    or reload the settings view.
21. Expected result: the UI shows an understandable backend-unavailable state
    instead of implying the vault data is browser-local canonical state.
22. Restart the backend before continuing the checklist.

### Optional Non-Local Bind Warning Check

Run this only in a trusted local test environment. Do not leave the backend bound
to a LAN-facing address.

1. Stop the backend.
2. Start the backend with a non-local bind address:

   ```bash
   AREPO_HOST=0.0.0.0 npm run backend:dev:server
   ```

3. Open Vault Settings and inspect Local Node Diagnostics.
4. Expected result: a prominent warning is shown.
5. Expected result: if auth mode is disabled, authentication posture still shows
   disabled auth and no enforcement. If auth mode is protected, the UI must not
   describe the non-local bind as LAN-safe or internet-safe.
6. Expected result: no UI controls claim that protected mode, LAN-safe mode,
   reverse-proxy safety, or internet exposure is available.
7. Expected result: the card does not describe this as safe for LAN, internet,
   reverse-proxy, or untrusted-client exposure.
8. Stop the backend and restart it with the default local bind before continuing:

   ```bash
   npm run backend:dev:server
   ```

### Protected Mode Operator Checklist

Use [Protected Mode Operator Workflow](protected-mode-operator-workflow.md) for
the copy-pasteable commands. This checklist is a manual acceptance summary for
that workflow.

Optional helper: after starting a disposable local protected-mode backend, run
`./scripts/manual-protected-mode-check.sh` from the repository root. If the
server already has an active credential, pass
`AREPO_TOKEN="paste-one-time-token-here"`. The script is a curl-based local
operator fixture; it does not test browser login, browser sessions, CSRF, or
network exposure safety.

Default disabled mode:

- Start with default config.
- Confirm existing UI/API behavior still works.
- Confirm `/api/node/status` reports disabled auth posture.

Protected mode before bootstrap:

- Start with `auth.mode = "protected"` and valid auth/audit stores.
- Confirm anonymous `/api/node/status` returns reduced status.
- Confirm protected vault/file routes deny anonymous access.
- Confirm protected mode does not silently downgrade to disabled mode.

Bootstrap:

- Run localhost bootstrap.
- Confirm the raw bearer token appears once.
- Confirm repeating bootstrap is denied once an active credential exists.
- Confirm bootstrap is localhost-only.

Authorized operation:

- Use the token to call `/api/node/status` and confirm full diagnostics.
- Use the token to call a protected read endpoint.
- Use the token plus `x-arepo-confirmation: confirm` to create a second
  credential.
- List credentials and confirm no raw token, token hash, salt, or verifier
  internals appear.

Rotation:

- Rotate a credential.
- Confirm the new token appears once.
- Confirm the old token no longer works.
- Confirm the new token works.

Revocation:

- Revoke a credential.
- Confirm the revoked token no longer works.
- Confirm listing shows safe revoked status/metadata.

Sanitization:

- Confirm auth failure responses do not include bearer token material.
- Confirm audit records do not include bearer token material, authorization
  headers, cookies, hashes, salts, confirmation header values, or verifier
  internals.
- Confirm reduced anonymous status does not expose credential lifecycle details
  beyond intentionally safe fields.

Remaining limitations:

- No browser login.
- No browser sessions.
- No live CSRF enforcement path.
- No frontend token storage.
- No full credential-management UI.
- Protected mode does not make LAN, reverse-proxy, or internet exposure safe.

## 5. First-Run Empty State

Run this only on a clean config or after moving aside `.arepo/config.json`.

1. Start AREPO with no configured vaults.
2. Expected result: the app explains that AREPO needs a local Markdown folder.
3. Expected result: the UI offers the Add vault flow.
4. Expected result: the empty state recommends using a test or disposable vault
   first.

## 6. Edit And Save Files

1. Select `Notes/note.md`.
2. Add a line in the editor:

   ```markdown
   Local acceptance edit.
   ```

3. Confirm the editor shows a dirty state.
4. Save the file.
5. Expected result: the dirty state clears only after the backend confirms the
   save.
6. Expected result: no browser localStorage note copy becomes the source of
   truth.

### Close Document Workspace

1. With `Notes/note.md` open and no unsaved edits, click `Close` in the document
   action bar near `Rename` and `Save`.
2. Expected result: the central editor/preview workspace changes to `No document
   open`.
3. Expected result: the file remains present in the Tree view and on disk.
4. Expected result: AREPO does not automatically open another document.
5. Select `Notes/note.md` again from the Tree, Graph, Index search, or Index
   filters. If Index search or Index filters are collapsed, expand that panel first.
6. Expected result: the normal editor/preview workflow returns.
7. Make an unsaved edit, then click `Close`.
8. Expected result: AREPO asks for confirmation before discarding the in-memory
   edit buffer.
9. Cancel the confirmation.
10. Expected result: the document remains open and dirty.
11. Click `Close` again and confirm.
12. Expected result: the document closes without writing to disk, deleting the
    file, or renaming the file.

### Center Tree And Graph Assignment

Run this on a desktop-width browser window.

1. With no document open, set the left vault pane to `Tree` and click `Center`.
2. Expected result: Tree appears in the central workspace without opening a
   document.
3. Open `Notes/note.md` from the center Tree.
4. Expected result: the document editor/preview takes over the center
   workspace.
5. Click `Close` in the document action bar.
6. Expected result: the center Tree view is restored.
7. Set the left vault pane to `Graph` and click `Center`.
8. Expected result: Graph appears in the central workspace without opening a
   document.
9. Select a graph node in the center Graph.
10. Expected result: existing graph selection, inspect, and navigation behavior
    still works.
11. Open a graph node in preview.
12. Expected result: the document preview takes over the center workspace.
13. Click `Close`.
14. Expected result: the center Graph view is restored.
15. In the center Tree, confirm `Index search`, `Index filters`, and
    `Optional homepage note` can collapse and expand.
16. Expected result: collapsing these utility panels does not clear existing
    results, and the actual file tree remains easy to reach without excessive
    scrolling.
17. Type a file search query in the sidebar Tree, then switch to the center
    Tree.
18. Expected result: the center Tree file search input does not mirror the
    sidebar query.
19. Type a different file search query in the center Tree.
20. Expected result: the sidebar Tree query remains unchanged.
21. Change the sidebar Index filter kind or search query, then inspect the
    center Tree controls.
22. Expected result: center Index filter/search state remains independent.
23. Change the center Index filter kind or search query, then inspect the
    sidebar controls.
24. Expected result: sidebar Index filter/search state remains independent.
25. If both sidebar Graph and center Graph are visible, change a graph-local
    control or viewport in one placement.
26. Expected result: the other graph placement does not unintentionally mirror
    that local control state.
27. With no Tree or Graph center view assigned, open and close a document.
28. Expected result: closing returns to the neutral `No document open` center
    state.
29. Use Index search, Index filters, backlinks, or outgoing links to open a
    document.
30. Expected result: the document opens in the center workspace and closing it
    restores the prior center Tree/Graph view when one was assigned.
31. Expected result: side Tree/Graph navigation, resizable/tuckable panes,
    diagnostics, edit/preview, save, rename, and close behavior remain intact.

### Resize Workspace Columns

Run this on a desktop-width browser window.

1. With a vault open, drag the vertical handle between the left vault column and
   the center workspace.
2. Expected result: the left column resizes, the center workspace adjusts, and
   the left border can be dragged all the way to the right column border.
3. Drag the vertical handle between the center workspace and the right
   inspect/metadata column.
4. Expected result: the right column resizes, the center workspace adjusts, and
   the right border can be dragged all the way to the left column border.
5. Drag the left column handle all the way toward the left edge.
6. Expected result: the vault column tucks away and leaves only a narrow
   pull-tab/resize strip visible plus a small tapered restore tab protruding
   into the workspace.
7. Click the left tapered restore tab.
8. Expected result: the vault column returns to a usable width.
9. Tuck the left column again, then drag the left tapered restore tab rightward.
10. Expected result: the vault column begins expanding immediately from the
    edge and resizes continuously from the drag.
11. Before releasing the pointer, drag the same tab back left toward the edge.
12. Expected result: the vault column shrinks and can tuck again in the same
    gesture.
13. Tuck the left column again, then drag the border pull-tab back to the right.
14. Expected result: border-based untuck still works.
15. Drag the right column handle all the way toward the right edge.
16. Expected result: the inspect/metadata column tucks away and leaves only a
    narrow pull-tab/resize strip visible plus a small tapered restore tab
    protruding into the workspace.
17. Click the right tapered restore tab.
18. Expected result: the inspect/metadata column returns to a usable width.
19. Tuck the right column again, then drag the right tapered restore tab
    leftward.
20. Expected result: the inspect/metadata column begins expanding immediately
    from the edge and resizes continuously from the drag.
21. Before releasing the pointer, drag the same tab back right toward the edge.
22. Expected result: the inspect/metadata column shrinks and can tuck again in
    the same gesture.
23. Tuck the right column again, then drag the border pull-tab back to the left.
24. Expected result: border-based untuck still works.
25. Tuck the right column, then drag the left column border toward the right
    edge.
26. Expected result: the left border can still reach the tucked right pane's
    pull-tab/edge.
27. Tuck the left column, then drag the right column border toward the left
    edge.
28. Expected result: the right border can still reach the tucked left pane's
    pull-tab/edge.
29. Toggle between dark and light mode if available.
30. Expected result: both tapered restore tabs have visible contrast, border,
    raised background, hover state, and focus state in both themes.
31. Expected result: resizing or tucking does not open files, select graph
    nodes, type in the editor, or trigger a save.
32. Confirm an open document remains open after resizing and tucking.
33. Close the document, resize both side columns again, and reopen
    `Notes/note.md`.
34. Expected result: close/reopen behavior still works and no file is changed on
    disk by resizing.
35. Switch between Tree and Graph, then resize/tuck both side columns.
36. Expected result: Tree navigation, Graph view, graph selection, and graph
    multi-select metadata remain usable.
37. Drag the left and right pane borders until they meet or nearly meet in the
    middle, including cases where the opposite pane is tucked.
38. Expected result: the center workspace may become extremely narrow, but Tree,
    Graph, document controls, editor text, preview content, inspect data,
    backlinks, metadata, Index search, and Index filters do not bleed outside
    their assigned panes.
39. While panes are extremely narrow, confirm resize handles and tapered restore
    tabs remain visible and usable.
40. Expected result: no horizontal artifact lines, ghost labels, floating text,
    or overlapping controls appear outside pane bounds.
41. Return both side panes to normal widths.
42. Expected result: normal content returns cleanly and all Tree, Graph, Index
    inspect, backlink, metadata, and document controls work as before.
43. Use Index search, Index filters, Index inspect, backlinks, outgoing links,
    and Local Node Diagnostics after resizing.
44. Expected result: those read-only mapping and diagnostics surfaces remain
    visible and usable.
45. Refresh the page.
46. Expected result: column widths and tucked state may reset. Layout
    persistence is not part of AREPO V1 yet.

## 7. Confirm Disk Persistence

1. In a terminal, inspect the file:

   ```bash
   sed -n '1,120p' <absolute path to test-vault>/Notes/note.md
   ```

2. Expected result: the saved line is present on disk.
3. Refresh the browser.
4. Expected result: AREPO reloads the saved content from the filesystem-backed
   vault.

## 8. Create Files And Folders

1. In the tree view, create a folder named `Inbox`.
2. Create a file named `Inbox/Capture.md` or create `Capture` inside `Inbox`.
3. Add content and save:

   ```markdown
   # Capture

   Linked from [[Notes/note]].
   ```

4. Expected result: the folder and `.md` file appear in the UI.
5. Expected result: the folder and file exist under
   `<absolute path to test-vault>/Inbox` on disk.

## 9. Rename

1. Select `Inbox/Capture.md`.
2. Rename it to `Inbox/Renamed Capture.md`.
3. Expected result: the old file path disappears from the tree.
4. Expected result: the new file path appears.
5. Expected result: the file is renamed on disk.
6. Expected result: renaming to an existing file path is rejected rather than
   overwriting the destination.

### 9A. Read-only UTF-8 plain-text experiment

1. Create a temporary UTF-8 file directly on disk:

   ```bash
   printf 'Plain text — Zażółć gęślą jaźń — こんにちは\n' > <absolute path to test-vault>/Reference/plain-text-check.txt
   ```

2. Expected result: `plain-text-check.txt` appears in Tree with a distinct
   plain-text marker and opens in a read-only plain-text viewer.
3. Expected result: no Save, Rename, Markdown Preview, frontmatter, headings,
   backlinks, graph node, validation, or machine-index inspection is offered
   for the file.
4. Search Tree for `こんにちは`.
5. Expected result: the `.txt` file is returned as a plain-text body match.
6. Edit the file externally and save it.
7. Expected result: the open read-only view reloads from disk, while the
   generated Markdown index remains fresh.
8. Attempt direct `PUT`, `POST`, rename, and `DELETE` file API requests targeting
   `.txt` paths.
9. Expected result: every mutation is rejected by the backend and the disk file
   is unchanged.
10. Rebuild the machine index and confirm the `.txt` filename and body do not
    appear in index, graph, backlinks, or validation data.
11. Remove the temporary file directly on disk when finished.

### 9B. Read-only AREPO chat-export V1 experiment

Create `conversation.arepo-chat.json` directly in the test vault with this valid
fixture:

```json
{
  "format": "arepo-chat-export",
  "version": 1,
  "conversation": {
    "id": "conv-manual-001",
    "title": "Nebula launch review"
  },
  "messages": [
    {
      "id": "msg-manual-001",
      "author": "Alice",
      "timestamp": "2026-08-24T10:00:00Z",
      "text": "The distinctive cobalt-orbit proposal is ready."
    },
    {
      "id": "msg-manual-002",
      "author": "Bob",
      "timestamp": "2026-08-24T11:15:00+01:00",
      "text": "I will verify the launch checklist."
    },
    {
      "id": "msg-manual-003",
      "author": "Chloé",
      "timestamp": "2026-08-24T12:30:00+01:00",
      "text": "Approval recorded under aurora-signal."
    }
  ]
}
```

Expected results:

1. The file appears in Tree with a `CHAT` marker and opens in a structured,
   read-only conversation view.
2. Conversation ID, title, three messages, source order, message IDs, authors,
   exact timestamp strings, and message text are visible. No JSON editor, Save,
   Rename, Preview, or Save As action is offered.
3. Local searches for `Nebula launch review`, `conv-manual-001`, `Chloé`,
   `cobalt-orbit`, `aurora-signal`, and `msg-manual-002` find the source file.
4. Rebuilding the Markdown index produces no chat graph node, link, backlink,
   heading, tag, frontmatter, validation issue, or structural search result.
5. Edit the file externally. The view reloads without marking the Markdown
   index stale.

Exercise each invalid fixture separately under a distinct
`*.arepo-chat.json` filename:

```text
malformed.arepo-chat.json
{"format": "arepo-chat-export"

unsupported-version.arepo-chat.json
{"format":"arepo-chat-export","version":2,"conversation":{"id":"conv"},"messages":[]}

duplicate-id.arepo-chat.json
{"format":"arepo-chat-export","version":1,"conversation":{"id":"conv"},"messages":[{"id":"same","author":"A","timestamp":"2026-08-24T10:00:00Z","text":"one"},{"id":"same","author":"B","timestamp":"2026-08-24T11:00:00Z","text":"two"}]}

timezone-less.arepo-chat.json
{"format":"arepo-chat-export","version":1,"conversation":{"id":"conv"},"messages":[{"id":"msg","author":"A","timestamp":"2026-08-24T10:00:00","text":"no timezone"}]}
```

Each invalid source must remain in Tree and filename/path search, show a bounded
structured-validation state, and contribute no message-body search text. Change
one invalid file back to valid V1 JSON and confirm the structured view recovers.
Ordinary `data.json`, `messages.json`, and `whatever.chat.json` files must remain
undiscovered. Remove the temporary fixtures directly on disk when finished.

## 10. Rebuild Machine Index

1. Open the Vaults or Settings screen.
2. Run Rebuild index for the test vault.
3. Expected result: the generated machine index status updates successfully.
4. Expected result: file count, indexed note count, and issue count remain
   consistent with the files on disk.
5. Expected result: no user-authored `index.md` is required. If `index.md`
   exists, it is treated as a normal Markdown note.

## 11. Valid Wikilinks

1. Open `Notes/note.md`.
2. Confirm `[[Reference/reference-note]]` is treated as a valid folder-qualified
   wikilink.
3. Confirm `[[Reference/reference-note#terminology]]` is treated as a valid
   anchor-qualified wikilink.
4. Open preview mode.
5. Click the rendered folder-qualified wikilink.
6. Expected result: AREPO opens `Reference/reference-note.md`.
7. Click the rendered anchor-qualified wikilink.
8. Expected result: AREPO opens the reference note and scrolls to the
   `terminology` heading anchor.
9. The right-side Inspect panel should show backlinks between `Notes/note.md`
   and `Reference/reference-note.md`.

## 12. Broken Wikilinks

1. Confirm `[[missing-note]]` remains in `Notes/note.md`.
2. Confirm `[[Reference/missing-reference]]` remains in
   `Reference/reference-note.md`.
3. Reindex if needed.
4. Expected result: the validation/inspect UI reports broken link issues for the
   intentional missing notes.
5. Expected result: fake wikilinks inside fenced code and inline code are
   ignored and do not appear as validation issues.
6. Expected result: the app does not create missing files silently.

## 13. Structural Index Filters

Use the `Index filters` panel in the vault sidebar, or expand it first if the
panel is collapsed. These filters are read-only views over the generated machine
index; they must not modify source Markdown.

1. Select `Broken links`.
2. Expected result: intentional broken links from `test-vault/` are listed as
   navigable rows with source file path and missing target details.
3. Select `Orphan notes`.
4. Expected result: orphan notes are listed if present, or the UI shows `No
   orphan notes found.`
5. Select `Tags`.
6. Expected result: tagged notes from the fixture appear with tag labels.
7. Select `Folders`.
8. Expected result: notes are listed with their vault-root-relative folder, such
   as `Notes` or `Reference`.
9. Select `Duplicate IDs`.
10. Expected result: duplicate frontmatter IDs are listed if present, or the UI
    shows `No duplicate IDs found.`
11. Select `Duplicate anchors`.
12. Expected result: duplicate heading anchors are listed if present, or the UI
    shows `No duplicate heading anchors found.`
13. Click a filter result row.
14. Expected result: AREPO opens the matching note without editing it and the
    Inspect panel shows the file-level machine-index details for that result.
15. Expected result: the same file is selected for inspection if you switch to
    Graph mode, rather than leaving the inspect panel on the previous note.
16. Expected result: the panel does not offer AI analysis, semantic search,
    database persistence, sync, migration, federation, remote-node, or mutation
    controls.

Backend-owned index search is shown near the structural filters, and may be
inside a collapsible `Index search` panel. It is a read-only, deterministic
search over generated machine-index fields, not AI, semantic/vector search, or
full document body search.

17. Search for `Notes/note.md`.
18. Expected result: a path match appears and clicking it opens the matching
    note without editing it.
19. Search for `Test Note`.
20. Expected result: a title match appears.
21. Search for `local` or another tag from the fixture.
22. Expected result: tag matches appear with the matched field and value.
23. Search for `Purpose` or a visible heading from `test-vault/`.
24. Expected result: heading matches appear with heading text and anchors when
    available.
25. Search for `valid-folder-links` or another heading anchor.
26. Expected result: anchor matches appear.
27. Search for `Reference/reference-note` or `missing-note`.
28. Expected result: outgoing link target matches appear, including intentional
    broken-link targets when present in the generated index.
29. Click a search result row.
30. Expected result: the Inspect panel updates for that file and remains
    read-only.
31. Expected result: there are no AI analysis, embeddings, vector database,
    full-text body search, sync, migration, federation, remote-node, or mutation
    controls in the search UI.

## 14. Graph Mode

1. Switch the left vault panel from Tree to Graph.
2. Expected result: graph mode renders nodes for notes in the vault.
3. Expected result: linked notes have visible edges.
4. Expected result: intentional broken links appear as missing-link nodes.
5. Expected result: broken or disconnected notes do not break graph rendering.
6. Pan and zoom the graph.
7. Expected result: pan and zoom controls remain usable on desktop and mobile
   viewport sizes.
8. Expected result: an unobtrusive canvas hint explains Shift-drag area
   selection and Shift-click node toggling.
9. Hold Shift and drag from any point on the graph canvas to draw a selection
   rectangle over multiple nodes.
10. Expected result: selected nodes are visually marked and the Metadata panel
    updates with the selected file count, combined file size, tags, heading
    count, outgoing links, backlinks, issue count, and selected paths.
11. Hold Shift and click a single node without dragging.
12. Expected result: that node is toggled in or out of the current graph
    selection.
13. Expected result: a single selected graph note updates the Inspect panel for
    that note. Multi-selection keeps the combined metadata view.
14. Click a graph node normally.
15. Expected result: the note opens and the Inspect panel stays aligned to that
    note.

## 15. Inspect And Backlinks

1. Select `Reference/reference-note.md`.
2. Inspect the right-side metadata/inspect panel.
3. Expected result: the `Index inspect` section says its source is the
   `machine-index` and shows title, path, frontmatter ID if present, tags, and
   orphan status.
4. Expected result: headings and heading anchors are listed without rendering
   Markdown as HTML.
5. Click a heading or duplicate-anchor heading row.
6. Expected result: AREPO switches to Preview and scrolls to the visible anchor
   when practical.
7. Expected result: outgoing links show resolved destination paths and broken
   outgoing links show the missing target clearly.
8. Click a resolved outgoing-link row.
9. Expected result: AREPO navigates to and inspects the resolved target file.
10. Expected result: broken outgoing-link rows clearly state that there is no
    resolved file target and do not create or open a file.
11. Expected result: backlinks include `Notes/note.md` and can be clicked to
    navigate without editing either file.
12. Select `Notes/note.md` or click an index-filter result for an intentional
    broken link.
13. Expected result: validation issues and broken outgoing links appear in the
    inspect view with clear error text.
14. If the fixture contains duplicate frontmatter IDs or duplicate heading
    anchors, confirm the inspect view lists the duplicate key and participating
    paths/headings. If none are present, confirm the empty states are explicit.
15. Click a duplicate frontmatter ID peer path if one is present.
16. Expected result: AREPO navigates to and inspects that peer file.
17. Optional: create a temporary note that nothing links to.
18. Expected result: the inspect view reports `orphan: yes` and shows empty
    backlink/outgoing sections rather than an error.
19. Expected result: the inspect view remains read-only and does not offer AI,
    semantic search, full-text search, database persistence, sync, migration,
    federation, remote-node, or mutation controls.

## 15A. Related Notes Metadata Promotion

Use a disposable scratch vault with two Markdown notes for this check. Enable
Related Notes for that vault, generate a suggestion for the pair, and choose
**Keep** so the pair appears in the kept relationships list.

1. Select the first note and choose **Add to note metadata** for the kept pair.
2. Expected result: the dialog is titled `Store relationship in`, defaults to
   `Current note only`, and offers exactly `Current note only`, `Related note
   only`, and `Both notes`.
3. Choose `Current note only` and confirm.
4. Expected result: only the current note receives a quoted `related` entry in
   frontmatter; the related note and both notes' rendered prose remain unchanged.
5. Recreate and keep the relationship, choose `Related note only`, and confirm.
6. Expected result: only the related note receives the reciprocal target in its
   frontmatter; rendered prose remains unchanged.
7. With a fresh pair, choose `Both notes` and confirm.
8. Expected result: the current note's multiline `related` sequence contains a
   quoted `"[[related-note]]"` entry and the related note contains the reciprocal
   `"[[current-note]]"` entry. The UI reports complete reciprocal metadata.
9. Expected result: Inspect preserves one authored outgoing declaration for
   each note, while Graph shows one relationship edge for the pair rather than
   parallel reciprocal edges.
10. Expected result: Metadata labels the figures `explicit outgoing
   relationships` and `incoming explicit relationships`. Body-only and
   metadata-only relationships each count once; a body and metadata declaration
   to the same target still count once.
11. Add a visible body wikilink between another kept pair and reopen its kept
   action.
12. Expected result: the metadata-promotion dialog remains available because a
   body link does not choose metadata ownership. Promoting adds metadata while
   leaving the body wikilink and rendered prose intact; Inspect reports both
   Note text and Note metadata provenance.
13. Optional partial-success race: after confirming `Both notes`, arrange for
   the related note to change externally after the current source publishes but
   before the related source publishes.
14. Expected result: AREPO says the operation is partially complete, identifies
   the source that now has metadata and the source that was not changed, does
   not claim the whole promotion failed, preserves the kept decision, and offers
   retry. It does not roll back the successful current-note write.
15. Reload and retry `Both notes`.
16. Expected result: the already-present side is not duplicated, the missing
   side is added, the operation completes, and the kept decision clears.
17. If either source changes before promotion preflight, expected result: AREPO
   reports a bounded conflict, writes neither source, and preserves the kept
   decision.

## 15B. Semantic Scope And Loopback Provider

Use a disposable vault with at least three Markdown notes. A real Ollama
service is optional except for the connection-test step.

1. Open Vault Settings, enable **Semantic similarity**, and configure a model.
2. Choose **Use selected Markdown notes**, check exactly two notes, save, and
   reload Settings.
3. Expected result: both selections persist, the third note remains unchecked,
   and the count says two notes are selected.
4. Choose **Use all Markdown notes**.
5. Expected result: the UI explains that All is dynamic rather than a snapshot
   of checked paths. Add a Markdown note and verify the effective count includes
   it after refresh.
6. Switch back to Selected before saving a different selection.
7. Expected result: the previous explicit selected set is still present.
8. Delete one selected note externally and refresh.
9. Expected result: its stored selection is retained but scope status reports
   one unavailable selection; the path is not silently deselected.
10. Restore an eligible Markdown note at the same path.
11. Expected result: the selection becomes eligible again.
12. Rename a selected note through AREPO.
13. Expected result: the stored selection follows the managed rename.
14. Switch to All, rename a previously selected note or containing folder
    through AREPO, then switch back to Selected.
15. Expected result: the dormant selection follows the managed rename without
    changing All authorization while All was active.
16. Rename a selected note externally while All is active, then switch back to
    Selected.
17. Expected result: the old path becomes unavailable and the new path is not
    inferred or automatically selected.
18. Clear all Selected paths while leaving Semantic similarity enabled.
19. Expected result: the UI says no notes are selected and no vault-content
    semantic processing can run.
20. If Ollama is available, enter `http://localhost:11434` and use **Test
    connection**.
21. Expected result: the saved/status address is literal
    `http://127.0.0.1:11434`; the fixed capability probe works even with zero
    selected notes and no vault text is chosen for the test.
22. Disable Semantic similarity.
23. Expected result: no vault-content semantic work is authorized regardless of
    the retained scope. Related Notes remains governed by its separate toggle.

## 16. External Edit Conflict Detection

This case protects safe coexistence with other editors. Use Kate, VSCodium, or
another local editor for the external-edit steps.

1. Open `Notes/note.md` in AREPO.
2. Make an unsaved edit in the AREPO editor.
3. Open the same file in Kate, VSCodium, or another editor.
4. Edit the same file externally and save it. A terminal can also simulate the
   external save:

   ```bash
   printf '\nExternal edit.\n' >> <absolute path to test-vault>/Notes/note.md
   ```

5. Expected result: AREPO shows an external-change conflict for the open file.
6. Click `Keep editing`.
7. Expected result: the conflict banner does not spam or reappear on every poll.
8. Expected result: a persistent conflict indicator remains visible for the open
   file.
9. Click normal `Save`.
10. Expected result: normal save is blocked with a clear message that the disk
    changed externally and the user must review or overwrite to continue.
11. Open `Review changes`.
12. Expected result: the review screen offers both `Diff` and `Full files`
    views.
13. Expected result: the `Diff` view compares `Your edits` against `Disk
    version` and shows only changed lines plus two lines of context before and
    after each change.
14. Expected result: Markdown is shown as plain escaped text, not rendered HTML.
15. Switch to `Full files`.
16. Expected result: both full plain-text file versions are readable with line
    numbers.
17. Expected result: removed text is highlighted with `#a51b0b` in the full-file
    view.
18. Expected result: added text is highlighted with `#34219C` in the full-file
    view.
19. Choose `Overwrite disk with my edits`.
20. Confirm the overwrite prompt.
21. Expected result: the external editor detects that the disk file changed.
22. Reload the file in the external editor.
23. Expected result: the AREPO editor buffer was written to disk.
24. Expected result: AREPO clears the dirty state and conflict state.
25. Expected result: the conflict does not re-trigger from AREPO's own
    overwrite.

## 17. Unsafe Path Rejection

Use the UI where possible, and use direct HTTP calls only against the local
backend.

1. Note the configured vault id shown in Vault Settings for use in direct API
   checks.
2. In Add vault, try a relative root path such as `notes`.
3. Expected result: the UI rejects it before submit.
4. Try a root path containing `..`, duplicate slashes, or a newline.
5. Expected result: the UI rejects the malformed path.
6. Against an existing vault, attempt to read a traversal path, replacing
   `<vault-id>` with the configured vault id:

   ```bash
   curl 'http://127.0.0.1:8734/api/vaults/<vault-id>/file?path=../secret.md'
   ```

7. Expected result: the backend rejects the request and does not read outside
   the configured vault root.

## 18. Delete Permission Default

1. Open the Add vault form.
2. Expected result: `deleteFiles` is disabled by default.
3. Enable delete permission.
4. Expected result: the UI shows a strong warning or confirmation before
   enabling it.
5. Add a vault without enabling delete permission.
6. Expected result: the configured vault shows delete permission as disabled.
7. Expected result: delete operations are rejected by the backend unless the
   vault permission explicitly allows deletes.

## 19. Security And Scope Expectations

Confirm the following throughout local-mode acceptance:

- The frontend defaults to `http://localhost:8733`.
- The backend defaults to `http://127.0.0.1:8734`.
- The backend binds to `127.0.0.1` by default.
- No cloud auth, hosted database, analytics, Supabase, Firebase, or remote
  storage is required.
- The browser talks to the local backend through `/api`.
- The backend only accesses configured vault roots.
- Markdown files remain the source of truth.
- Machine indexes, graph data, and caches are rebuildable from Markdown files.
- Sync remains external through tools such as Syncthing.
- Version history remains external through Git.
- Backups remain external through Borg, Restic, or Kopia.
- Disabled mode is the default local compatibility mode. Protected mode enforces
  local bearer-token authorization when explicitly configured, but it still must
  not be treated as LAN, reverse-proxy, or internet safe.
- Vite dev frontend port overrides continue to use the local `/api` proxy.
- If the frontend is served without the Vite dev proxy, `AREPO_ALLOWED_ORIGINS`
  must include the new frontend origin; wildcard CORS is not acceptable.
- Vault Settings shows unsupported V1 capabilities as disabled, not as features
  that can be enabled.
- Index filters are read-only views over the generated machine index and do not
  modify source Markdown files.
- No UI flow in this checklist enables browser login, browser sessions,
  frontend token storage, sync, AI/vector features, database support,
  migrations, federation, remote node registration, reverse proxy setup, or LAN
  exposure.

## 20. Storage Reporting

1. Select `Notes/note.md`.
2. Expected result: the Metadata panel shows the selected file's size.
3. Switch to Graph mode and multi-select both committed notes by holding Shift
   and dragging a selection box around graph nodes.
4. Expected result: the Metadata panel shows combined metadata, including
   selected file count and combined selected-file size.
5. Open the Vaults or Settings screen and refresh the configured vaults list.
6. Expected result: Vault content size and file count include the committed
   fixture files.
7. Expected result: Markdown/text size includes the committed `.md` files.
8. Expected result: AREPO map/index cache size is shown separately from vault
   content and is treated as disposable cache.
9. Optional attachment check: add a temporary file such as
   `<absolute path to test-vault>/Assets/example.bin`.
10. Expected result: Attachment/other size includes non-Markdown files.
11. Optional symlink check: create a symlink inside the vault to a file outside
    the vault.
12. Expected result: storage reporting skips the symlink and does not count or
    follow the outside file.

## Optional: Create A Temporary Scratch Vault

Use this only when you want to avoid editing the committed `test-vault/` fixture.

1. Create a temporary folder outside the repository:

   ```bash
   mkdir -p /tmp/arepo-acceptance-vault/Projects
   printf '# Home\n\nSee [[Projects/Alpha]] and [[Missing Note]].\n' > /tmp/arepo-acceptance-vault/Home.md
   printf '# Alpha\n\nBack to [[Home]].\n\n## Details\n\nUseful notes.\n' > /tmp/arepo-acceptance-vault/Projects/Alpha.md
   ```

2. Add `/tmp/arepo-acceptance-vault` through Vault Settings instead of
   `test-vault/`.
3. Expected result: AREPO treats it like any other configured local Markdown
   vault and builds the machine index automatically.

## Acceptance Result

Record the result after completing the checklist:

- Date:
- Build or commit:
- Operating system:
- Browser:
- Pass/fail:
- Notes:
