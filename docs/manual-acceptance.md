# AREPO Local Mode Manual Acceptance Test

Use this checklist before treating a local build as usable. The default fixture
is the repository's committed `test-vault/` folder. It is safe to edit and reset
locally, but it is not a real user vault.

## Prerequisites

- Node dependencies are installed with `npm install`.
- You have two terminal windows open at the AREPO repository root.
- You have a browser available on the same machine.

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

## 4. First-Run Empty State

Run this only on a clean config or after moving aside `.arepo/config.json`.

1. Start AREPO with no configured vaults.
2. Expected result: the app explains that AREPO needs a local Markdown folder.
3. Expected result: the UI offers the Add vault flow.
4. Expected result: the empty state recommends using a test or disposable vault
   first.

## 5. Edit And Save Files

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

## 6. Confirm Disk Persistence

1. In a terminal, inspect the file:

   ```bash
   sed -n '1,120p' <absolute path to test-vault>/Notes/note.md
   ```

2. Expected result: the saved line is present on disk.
3. Refresh the browser.
4. Expected result: AREPO reloads the saved content from the filesystem-backed
   vault.

## 7. Create Files And Folders

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

## 8. Rename

1. Select `Inbox/Capture.md`.
2. Rename it to `Inbox/Renamed Capture.md`.
3. Expected result: the old file path disappears from the tree.
4. Expected result: the new file path appears.
5. Expected result: the file is renamed on disk.
6. Expected result: renaming to an existing file path is rejected rather than
   overwriting the destination.

## 9. Rebuild Machine Index

1. Open the Vaults or Settings screen.
2. Run Rebuild index for the test vault.
3. Expected result: the generated machine index status updates successfully.
4. Expected result: file count, indexed note count, and issue count remain
   consistent with the files on disk.
5. Expected result: no user-authored `index.md` is required. If `index.md`
   exists, it is treated as a normal Markdown note.

## 10. Valid Wikilinks

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
9. Inspect mode should show backlinks between `Notes/note.md` and
   `Reference/reference-note.md`.

## 11. Broken Wikilinks

1. Confirm `[[missing-note]]` remains in `Notes/note.md`.
2. Confirm `[[Reference/missing-reference]]` remains in
   `Reference/reference-note.md`.
3. Reindex if needed.
4. Expected result: the validation/inspect UI reports broken link issues for the
   intentional missing notes.
5. Expected result: fake wikilinks inside fenced code and inline code are
   ignored and do not appear as validation issues.
6. Expected result: the app does not create missing files silently.

## 12. Graph Mode

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

## 13. Inspect And Backlinks

1. Select `Reference/reference-note.md`.
2. Open Inspect mode.
3. Expected result: backlinks include `Notes/note.md`.
4. Expected result: metadata includes title, path, file size, id if present,
   tags, headings, and outgoing link counts.
5. Optional: create a temporary note that nothing links to.
6. Expected result: the UI shows an empty backlink state rather than an error.

## 14. External Edit Conflict Detection

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

## 15. Unsafe Path Rejection

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

## 16. Delete Permission Default

1. Open the Add vault form.
2. Expected result: `deleteFiles` is disabled by default.
3. Enable delete permission.
4. Expected result: the UI shows a strong warning or confirmation before
   enabling it.
5. Add a vault without enabling delete permission.
6. Expected result: the configured vault shows delete permission as disabled.
7. Expected result: delete operations are rejected by the backend unless the
   vault permission explicitly allows deletes.

## 17. Security Expectations

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
- The local backend has no auth yet and must not be exposed to a LAN or the
  internet.
- Vite dev frontend port overrides continue to use the local `/api` proxy.
- If the frontend is served without the Vite dev proxy, `AREPO_ALLOWED_ORIGINS`
  must include the new frontend origin; wildcard CORS is not acceptable.

## 18. Storage Reporting

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
