# mdAtlas

mdAtlas is an independent local-first Markdown knowledge-base viewer/editor/indexer.
Plain `.md` files are the source of truth. The app index, graph, and any
cache must be rebuildable from those files.

mdAtlas automatically builds a machine index from the Markdown files in each
configured vault. A user-authored `index.md` file is optional; if it exists, it
is treated as a normal Markdown note, not as the app's machine index.

Sync, history, and backups are intentionally external:

- Syncthing for device sync
- Git for version history
- Borg, Restic, or Kopia for backups

mdAtlas does not replace those tools.

## Platform Independence

mdAtlas is designed to run as a standalone local tool. It does not require a
hosted project platform, cloud account, hosted database, or remote storage
provider for basic local use. Runtime error handling logs locally to the
browser or backend console; do not expose the unauthenticated local backend to
untrusted networks.

## Modes

### Basic Local Mode

A normal user runs a local Node backend on one machine and opens the web UI in
a browser. The browser talks to the backend on localhost. The backend only
reads and writes configured Markdown vault folders.

### Extensible Node Mode

The backend already exposes local node/vault concepts so future versions can
display multiple registered mdAtlas nodes from a hub UI. V1 only implements the
local node. It does not implement federation, live sync, hosted auth, or remote
registration.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the guided local dev workflow:

```bash
npm run backend:dev
```

This starts the backend in the current terminal and tries to open a second
terminal with frontend/build targets:

- `dev` starts the Vite UI on `http://localhost:8733`.
- `dev:port` starts the Vite UI on a custom port.
- `build`, `build:dev`, and `preview` run the matching npm targets.

If your desktop environment does not allow mdAtlas to open a second terminal,
run the menu yourself in another terminal:

```bash
npm run frontend:menu
```

For a backend-only terminal, use:

```bash
npm run backend:dev:server
```

The backend host and port remain configurable through environment variables:

```bash
MDATLAS_HOST=127.0.0.1 MDATLAS_PORT=9002 npm run backend:dev:server
```

You can also start the frontend directly. It defaults to the local UI port
`http://localhost:8733`:

```bash
npm run dev
```

Normal Vite CLI overrides still work for a different frontend port:

```bash
npm run dev -- --port 9001
```

Open the URL printed by Vite. The dev server proxies `/api` to the backend at
`http://127.0.0.1:8734` by default. The Vite dev proxy works with overridden
frontend ports such as `9001` because browser requests stay same-origin to Vite.

If you serve the frontend without the Vite dev proxy, or call the backend
directly from another browser origin, add that origin to the backend CORS
allowlist:

```bash
MDATLAS_ALLOWED_ORIGINS=http://localhost:9001 npm run backend:dev
```

## Example Test Vault

The repository includes `test-vault/` as a small example Markdown vault for
demos and manual acceptance testing. It is ordinary Markdown content, not
generated app data and not a real user vault.

To try it, start mdAtlas locally, open Vault Settings, and add the absolute path
to `test-vault/` as a vault. From the repository root, this prints the path to
use:

```bash
realpath test-vault
```

mdAtlas automatically builds the machine index when the vault is added. A
user-authored `index.md` is not required; if one exists in any vault, mdAtlas
treats it as a normal note. The example vault intentionally includes broken
wikilinks so validation, inspect mode, and graph missing-link nodes have
something to report. It also demonstrates folder-qualified links, heading
anchors, backlinks, and ignored wikilinks inside code.

Generated machine index/cache files are stored outside the vault under the
configured app data directory. Do not commit `.mdatlas/`, app-data caches,
`dist/`, `dist-backend/`, or `node_modules/`.

## Configure Vaults

Vault configuration is stored locally in:

```text
.mdatlas/config.json
```

Example:

```json
{
  "node": {
    "nodeId": "local",
    "displayName": "Local Node",
    "mode": "local",
    "apiVersion": 1
  },
  "appDataDir": "/absolute/path/to/mdatlas-data",
  "vaults": [
    {
      "id": "notes",
      "displayName": "Notes",
      "rootPath": "/absolute/path/to/notes",
      "permissions": {
        "readIndex": true,
        "readContent": true,
        "writeContent": true,
        "deleteFiles": false
      }
    }
  ]
}
```

The UI can also add an existing local vault folder through the top bar. The
backend never scans the whole filesystem; only configured vault roots are
accessible.

`appDataDir` is optional. It controls where mdAtlas writes local generated data
such as machine index caches. You can also set `MDATLAS_APP_DATA_DIR`; the
environment variable takes precedence over config.

Recommended app data locations:

- Local Linux users: `~/.local/share/mdatlas`
- Development fallback: `.mdatlas/data` in the project directory
- Self-hosted or enterprise deployments: a dedicated writable data volume
  outside user vault roots

Do not place generated app data inside a user vault unless you explicitly want
mdAtlas cache files to appear beside user notes.

## Current Backend API

- `GET /api/health`
- `GET /api/vaults`
- `POST /api/vaults`
- `GET /api/vaults/:vaultId/files`
- `GET /api/vaults/:vaultId/file?path=...`
- `PUT /api/vaults/:vaultId/file?path=...`
- `POST /api/vaults/:vaultId/file`
- `POST /api/vaults/:vaultId/folder`
- `POST /api/vaults/:vaultId/rename`
- `DELETE /api/vaults/:vaultId/file?path=...`
- `POST /api/vaults/:vaultId/reindex`
- `GET /api/vaults/:vaultId/index`
- `GET /api/vaults/:vaultId/storage`

`POST /api/vaults/:vaultId/reindex` means "rebuild the generated machine index
from Markdown files." It does not create or require a user-authored `index.md`.

## Security Model

- The backend binds to `127.0.0.1` by default.
- There is no authentication yet. Do not expose the backend to a LAN or the
  internet.
- Non-local binding requires explicit `MDATLAS_HOST` configuration and prints a
  startup warning.
- CORS is restricted to the local frontend dev origins by default:
  `http://localhost:8733` and `http://127.0.0.1:8733`.
- Extra CORS origins can be added with comma-separated
  `MDATLAS_ALLOWED_ORIGINS`; do not use wildcard origins. For example:
  `MDATLAS_ALLOWED_ORIGINS=http://localhost:9001 npm run backend:dev`.
- The Vite dev proxy strips browser `Origin` before forwarding local `/api`
  requests, so normal `npm run dev -- --port ...` overrides do not require a
  CORS change.
- If the frontend is served without the Vite dev proxy, the backend CORS
  allowlist must include that frontend origin.
- Only configured vault roots in `.mdatlas/config.json` are accessible.
- Config is validated at startup. Duplicate vault IDs, missing roots, malformed
  JSON, and unsafe permission shapes are rejected.
- The index/cache is rebuildable from Markdown files and is not canonical state.
- Syncthing, Git, and Borg/Restic/Kopia remain external responsibilities.

The backend accepts only POSIX-style relative vault paths. It rejects absolute
paths, `..`, empty segments, duplicate slashes, symlink path traversal, and paths
that resolve outside the configured vault root. Note file operations require
`.md`.

File saves write to a temporary file in the same directory and then rename it
into place. The UI does not mark a file saved until the backend confirms the
write. Saves include the file hash/mtime seen by the UI; if the file changed on
disk, the backend rejects the write and the UI keeps the editor dirty.

## Indexing

The backend reads Markdown files from disk and rebuilds the generated machine
index from source files. The index includes paths, titles, frontmatter ids,
tags, headings, anchors, wikilinks, outgoing links, backlinks, broken links,
orphan notes, duplicate ids, and duplicate anchors.

When a vault is added, mdAtlas builds the machine index automatically. Manual
reindexing only forces a rebuild from the current Markdown files.

Generated machine indexes are stored outside user vaults by default, under the
configured app data directory:

```text
<appDataDir>/indexes/<vault-id>-<vault-root-hash>.json
```

These files are disposable caches. They may be deleted and rebuilt from the
Markdown vault. Markdown files remain the source of truth. mdAtlas must not
depend on a user-created `index.md` file to make graph, backlinks, validation,
or search work.

The frontend still owns preview rendering and graph layout, but note content
and the index now come from the local backend.

## Storage Reporting

`GET /api/vaults/:vaultId/storage` reports local storage use for a configured
vault. Per-file size is shown in the Metadata panel, graph multi-selection shows
combined selected-file size, and full vault storage details are shown in Vault
Settings. The backend scans only inside the configured vault root, counts regular
files, and skips symlinks. It reports:

- total vault file count and bytes
- Markdown/text file count and bytes
- attachment/other file count and bytes
- mdAtlas app-data cache bytes for the vault's generated machine index files

Generated machine indexes live under the app data directory and are disposable
cache. They are not user-authored Markdown content and can be rebuilt from the
vault files.

The current indexer strips fenced code blocks and inline code before extracting
headings and wikilinks. It is still a lightweight Markdown parser, not a full
CommonMark AST pipeline.

## External Changes

The local backend watches configured vault roots for Markdown file changes,
additions, deletions, and renames. It does not watch outside configured vault
roots and continues to ignore symlink escapes. Watch events are debounced so
large Syncthing or Git bursts mark the vault stale first and rebuild the
generated machine index after the event burst settles.

The frontend polls vault status from the local backend. If the open file changes
on disk and the editor has no unsaved changes, mdAtlas refreshes from disk. If
the editor is dirty, mdAtlas keeps the browser buffer intact and shows a
conflict warning with actions to keep edits, reload the disk version, or save
the buffer as a new file. If the open file is deleted on disk, mdAtlas shows a
warning and lets the user close the buffer or save it as a new file.

Manual Rebuild index remains available. It forces the generated machine index
to be rebuilt from current Markdown files and is useful after very large
external operations or if the operating system drops filesystem events.

Watcher limitations:

- The backend watches only configured vault roots.
- Directory watchers are refreshed as folders appear and disappear.
- Filesystem events can be coalesced or dropped by the operating system during
  large bursts, so status polling also rescans Markdown metadata.
- This is change detection only. It is not sync, version history, or backup.

## Local Storage

`localStorage` is only used for UI preferences such as theme and the last
selected vault id. It is not used as canonical note storage.

## Verification

```bash
npm run backend:test
npm run lint
npm run build
```

## Limitations

- Localhost-only backend; no auth yet.
- No live sync, Git replacement, or backup system.
- No remote node registration yet.
- Markdown preview is sanitized in the browser, but the backend API should still
  not be exposed to untrusted networks until authentication is designed.
