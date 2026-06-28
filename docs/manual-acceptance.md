# mdAtlas Local Mode Manual Acceptance Test

Use this checklist before treating a local build as usable. Run it against a
disposable vault first; do not use important notes for initial acceptance.

## Prerequisites

- Node dependencies are installed with `npm install`.
- You have two terminal windows open at the mdAtlas repository root.
- You have a browser available on the same machine.

## 1. Start Backend And Frontend

1. Start the local backend:

   ```bash
   npm run backend:dev
   ```

2. Confirm the backend prints the default backend URL:
   `http://127.0.0.1:8734`.
3. Confirm it does not bind to `0.0.0.0` unless explicitly configured.
4. To override the backend port for a test run, use `MDATLAS_PORT`, for example:

   ```bash
   MDATLAS_PORT=9002 npm run backend:dev
   ```

5. In another terminal, start the frontend on the default local UI port:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:8733` in the browser, or the URL printed by Vite.
7. To override the frontend port, use normal Vite CLI arguments:

   ```bash
   npm run dev -- --port 9001
   ```

8. If the frontend port changes, restart the backend with that origin in the
   CORS allowlist:

   ```bash
   MDATLAS_ALLOWED_ORIGINS=http://localhost:9001 npm run backend:dev
   ```

9. Expected result: the app loads without requiring a cloud account, hosted
   database, remote API, or login.
10. Expected result: the backend remains bound to `127.0.0.1` unless explicitly
    configured with `MDATLAS_HOST`.

## 2. Create A Disposable Test Vault

1. Create a temporary folder outside the repository, for example:

   ```bash
   mkdir -p /tmp/mdatlas-acceptance-vault/Projects
   ```

2. Add starter Markdown files:

   ```bash
   printf '# Home\n\nSee [[Projects/Alpha]] and [[Missing Note]].\n' > /tmp/mdatlas-acceptance-vault/Home.md
   printf '# Alpha\n\nBack to [[Home]].\n\n## Details\n\nUseful notes.\n' > /tmp/mdatlas-acceptance-vault/Projects/Alpha.md
   ```

3. Expected result: the vault is ordinary Markdown files on disk. No app
   database is required to create or inspect it.

## 3. Add Vault In UI

1. In mdAtlas, open the Vaults or Settings screen.
2. Confirm the local node health indicator can test the backend connection.
3. Add a vault with:
   - Name: `Acceptance Vault`
   - Root path: `/tmp/mdatlas-acceptance-vault`
   - Permissions: `readIndex`, `readContent`, and `writeContent` enabled
   - `deleteFiles` disabled
4. Submit the form.
5. Expected result: the vault appears in the configured vault list with display
   name, vault id, root path, permissions, file count, indexed note count, and
   generated machine index status.
6. Expected result: if the backend rejects the vault, the UI shows the backend
   error clearly.

## 4. First-Run Empty State

Run this only on a clean config or after moving aside `.mdatlas/config.json`.

1. Start mdAtlas with no configured vaults.
2. Expected result: the app explains that mdAtlas needs a local Markdown folder.
3. Expected result: the UI offers the Add vault flow.
4. Expected result: the empty state recommends using a test or disposable vault
   first.

## 5. Edit And Save Files

1. Select `Home.md`.
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
   sed -n '1,120p' /tmp/mdatlas-acceptance-vault/Home.md
   ```

2. Expected result: the saved line is present on disk.
3. Refresh the browser.
4. Expected result: mdAtlas reloads the saved content from the filesystem-backed
   vault.

## 7. Create Files And Folders

1. In the tree view, create a folder named `Inbox`.
2. Create a file named `Inbox/Capture.md` or create `Capture` inside `Inbox`.
3. Add content and save:

   ```markdown
   # Capture

   Linked from [[Home]].
   ```

4. Expected result: the folder and `.md` file appear in the UI.
5. Expected result: the folder and file exist under
   `/tmp/mdatlas-acceptance-vault/Inbox` on disk.

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
2. Run Rebuild index for the acceptance vault.
3. Expected result: the generated machine index status updates successfully.
4. Expected result: file count, indexed note count, and issue count remain
   consistent with the files on disk.
5. Expected result: no user-authored `index.md` is required. If `index.md`
   exists, it is treated as a normal Markdown note.

## 10. Valid Wikilinks

1. Open `Home.md`.
2. Confirm `[[Projects/Alpha]]` is treated as a valid wikilink.
3. Open preview mode.
4. Click the rendered wikilink.
5. Expected result: mdAtlas opens `Projects/Alpha.md`.
6. Inspect mode should show a backlink from `Home.md` to `Projects/Alpha.md`.

## 11. Broken Wikilinks

1. Confirm `[[Missing Note]]` remains in `Home.md`.
2. Reindex if needed.
3. Expected result: the validation/inspect UI reports a broken link issue for
   the missing note.
4. Expected result: the app does not create missing files silently.

## 12. Graph Mode

1. Switch the left vault panel from Tree to Graph.
2. Expected result: graph mode renders nodes for notes in the vault.
3. Expected result: linked notes have visible edges.
4. Expected result: broken or disconnected notes do not break graph rendering.
5. Pan and zoom the graph.
6. Expected result: pan and zoom controls remain usable on desktop and mobile
   viewport sizes.

## 13. Inspect And Backlinks

1. Select `Projects/Alpha.md`.
2. Open Inspect mode.
3. Expected result: backlinks include `Home.md`.
4. Expected result: metadata includes title, id if present, tags, headings, and
   outgoing link counts.
5. Select a note with no backlinks.
6. Expected result: the UI shows an empty backlink state rather than an error.

## 14. External Edit Conflict Detection

This case protects safe coexistence with other editors. Use Kate, VSCodium, or
another local editor for the external-edit steps.

1. Open `Home.md` in mdAtlas.
2. Make an unsaved edit in the mdAtlas editor.
3. Open the same file in Kate, VSCodium, or another editor.
4. Edit the same file externally and save it. A terminal can also simulate the
   external save:

   ```bash
   printf '\nExternal edit.\n' >> /tmp/mdatlas-acceptance-vault/Home.md
   ```

5. Expected result: mdAtlas shows an external-change conflict for the open file.
6. Click `Keep editing`.
7. Expected result: the conflict banner does not spam or reappear on every poll.
8. Expected result: a persistent conflict indicator remains visible for the open
   file.
9. Click normal `Save`.
10. Expected result: normal save is blocked with a clear message that the disk
    changed externally and the user must review or overwrite to continue.
11. Open `Review changes`.
12. Expected result: the diff compares `Your edits` against `Disk version`.
13. Expected result: removed text is highlighted with `#a51b0b`.
14. Expected result: added text is highlighted with `#34219C`.
15. Expected result: Markdown is shown as plain escaped text, not rendered HTML.
16. Choose `Overwrite disk with my edits`.
17. Confirm the overwrite prompt.
18. Expected result: the external editor detects that the disk file changed.
19. Reload the file in the external editor.
20. Expected result: the mdAtlas editor buffer was written to disk.
21. Expected result: mdAtlas clears the dirty state and conflict state.
22. Expected result: the conflict does not re-trigger from mdAtlas' own
    overwrite.

## 15. Unsafe Path Rejection

Use the UI where possible, and use direct HTTP calls only against the local
backend.

1. In Add vault, try a relative root path such as `notes`.
2. Expected result: the UI rejects it before submit.
3. Try a root path containing `..`, duplicate slashes, or a newline.
4. Expected result: the UI rejects the malformed path.
5. Against an existing vault, attempt to read a traversal path:

   ```bash
   curl 'http://127.0.0.1:8734/api/vaults/acceptance-vault/file?path=../secret.md'
   ```

6. Expected result: the backend rejects the request and does not read outside
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
- If the frontend port is changed, `MDATLAS_ALLOWED_ORIGINS` must include the
  new frontend origin; wildcard CORS is not acceptable.

## Acceptance Result

Record the result after completing the checklist:

- Date:
- Build or commit:
- Operating system:
- Browser:
- Pass/fail:
- Notes:
