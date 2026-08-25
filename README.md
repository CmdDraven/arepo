# AREPO

**Archive Relationship and Enrichment Provenance Orchestrator**

Local-first knowledge mapping for user-owned documents.

AREPO maps ordinary documents, tracks relationships and provenance, and enables
optional enrichment without taking ownership of the source files. Markdown is
the first-class V1 format: plain `.md` files are the source of truth, and the
app index, graph inputs, and cache must be rebuildable from those files.

AREPO automatically builds a machine index from the Markdown files in each
configured vault. A user-authored `index.md` file is optional; if it exists, it
is treated as a normal Markdown note, not as the app's machine index.

The first deliberately narrow non-Markdown experiment supports UTF-8 `.txt`
files as read-only source files. They appear in Tree, can be opened as plain
text, participate in browser-local filename/body search, and refresh after
external disk changes. They are not notes: `.txt` files never enter the machine
index, graph, backlinks, Markdown preview, frontmatter, tags, headings, or
validation. AREPO does not create, save, rename, or delete them.

AREPO also supports one deliberately exact structured import:
`*.arepo-chat.json` files whose root declares `"format": "arepo-chat-export"`
and numeric `"version": 1`. These canonical JSON files are read only and remain
unchanged on disk. AREPO validates and displays the conversation and its ordered
messages, preserving conversation/message IDs and source timestamp strings.
Arbitrary `.json`, including `*.chat.json`, is not supported, and chat JSON is
never converted to Markdown or added to Markdown graph/index semantics.

Sync, history, and backups are intentionally external:

- Syncthing for device sync
- Git for version history
- Borg, Restic, or Kopia for backups

AREPO does not replace those tools.

## Platform Independence

AREPO is designed to run as a standalone local tool. It does not require a
hosted project platform, cloud account, hosted database, or remote storage
provider for basic local use. Runtime error handling logs locally to the
browser or backend console. Disabled auth remains the default compatibility
mode, and protected mode is available for deliberate local bearer-token testing,
but neither mode makes LAN, reverse-proxy, or internet exposure safe.

## Modes

### Basic Local Mode

A normal user runs a local Node backend on one machine and opens the web UI in
a browser. The browser talks to the backend on localhost. The backend only
reads and writes configured Markdown vault folders.

### Extensible Node Mode

The backend already exposes local node/vault concepts so future versions can
display multiple registered AREPO nodes from a hub UI. V1 only implements the
local node. It does not implement federation, live sync, hosted auth, or remote
registration.

See [docs/roadmap.md](docs/roadmap.md) for the current local-node roadmap and
[docs/local-node-self-host.md](docs/local-node-self-host.md) for single-node
self-host notes. Phase 4 security design work is tracked in
[docs/node-security-checkpoint.md](docs/node-security-checkpoint.md). The local
protected-mode operator flow is documented in
[docs/protected-mode-operator-workflow.md](docs/protected-mode-operator-workflow.md).

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

If your desktop environment does not allow AREPO to open a second terminal,
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
AREPO_HOST=127.0.0.1 AREPO_PORT=9002 npm run backend:dev:server
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
AREPO_ALLOWED_ORIGINS=http://localhost:9001 npm run backend:dev
```

## Example Test Vault

The repository includes `test-vault/` as a small example Markdown vault for
demos and manual acceptance testing. It is ordinary Markdown content, not
generated app data and not a real user vault.

To try it, start AREPO locally, open Vault Settings, and add the absolute path
to `test-vault/` as a vault. From the repository root, this prints the path to
use:

```bash
realpath test-vault
```

AREPO automatically builds the machine index when the vault is added. A
user-authored `index.md` is not required; if one exists in any vault, AREPO
treats it as a normal note. The example vault intentionally includes broken
wikilinks so validation, inspect mode, and graph missing-link nodes have
something to report. It also demonstrates folder-qualified links, heading
anchors, backlinks, and ignored wikilinks inside code.

Generated machine index/cache files are stored outside the vault under the
configured app data directory. Do not commit `.arepo/`, app-data caches,
`dist/`, `dist-backend/`, or `node_modules/`.

## Configure Vaults

Vault configuration is stored locally in:

```text
.arepo/config.json
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
  "appDataDir": "/absolute/path/to/arepo-data",
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

A vault registration has a stable ID and policy independent of whether its
configured filesystem root is currently available. If a root is moved,
deleted, inaccessible, or temporarily unmounted, AREPO keeps the structurally
valid registration and reports that vault as unavailable without blocking
other vaults. Vault Settings can Locate / Rebind the same registration to an
existing directory. Rebinding changes only AREPO's configured root path: it
does not move source files, and it preserves the vault ID, permissions, and
index scope. Forget vault remains a separate option.

Vault Settings also shows read-only local node diagnostics from
`GET /api/node/status`, including backend host/port, startup warnings, vault
runtime health, auth posture, protected-mode readiness, and disabled V1
capability flags.

`appDataDir` is optional. It controls where AREPO writes local generated data
such as machine index caches. You can also set `AREPO_APP_DATA_DIR`; the
environment variable takes precedence over config.

Recommended app data locations:

- Local Linux users: `~/.local/share/arepo`
- Development fallback: `.arepo/data` in the project directory
- Self-hosted or enterprise deployments: a dedicated writable data volume
  outside user vault roots

Do not place generated app data inside a user vault unless you explicitly want
AREPO cache files to appear beside user notes.

## Current Backend API

- `GET /api/health`
- `GET /api/node/status`
- `GET /api/vaults`
- `POST /api/vaults`
- `POST /api/vaults/:vaultId/rebind`
- `DELETE /api/vaults/:vaultId`
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
- `POST /api/node/credentials/bootstrap`
- `GET /api/node/credentials`
- `POST /api/node/credentials`
- `POST /api/node/credentials/:credentialId/revoke`
- `POST /api/node/credentials/:credentialId/rotate`

`POST /api/vaults/:vaultId/reindex` means "rebuild the generated machine index
from Markdown files." It does not create or require a user-authored `index.md`.

`GET /api/node/status` is a local-node-only diagnostic surface. It reports node
identity, local runtime host/port, startup warnings such as non-local binding,
auth posture, vault count, per-vault watcher/index health,
storage-summary availability, protected-mode readiness, safe credential
lifecycle posture when authorized, and explicit capability flags showing that
browser login, browser sessions, sync, AI, database support, migration support,
and remote node registration are not active in V1.

## Security Model

- The backend binds to `127.0.0.1` by default.
- Disabled auth remains the default local compatibility mode.
- `auth.mode = "protected"` enables local bearer-token request authorization.
  Protected mode verifies bearer tokens, enforces route permissions, fails
  closed when readiness is incomplete, returns reduced anonymous status, and
  writes sanitized audit records.
- In protected mode, vault-scoped credentials discover only vaults for which
  they have an applicable vault grant. Ordinary source grants do not reveal
  unrelated registrations or configured absolute root paths. Root paths and
  full registration policy are management metadata; a credential with
  `manageVaults` receives the complete vault-management view.
- Disabled/local auth mode retains complete local registration visibility,
  including configured roots needed by the local Vault Settings UI.
- Protected mode still does not make LAN, reverse-proxy, or internet exposure
  safe.
- Bearer tokens are secrets. Raw bearer tokens are returned only once during
  bootstrap, create, or rotate responses and must not be pasted into bug
  reports, screenshots, docs, logs, or commits.
- AREPO does not currently provide browser login, browser sessions,
  CSRF-protected browser authentication, frontend token storage, or a full
  credential-management UI.
- `x-arepo-confirmation: confirm` is a backend/operator confirmation signal for
  protected routes, not final browser UX.
- `GET /api/node/status` returns reduced anonymous diagnostics in protected
  mode. A valid authorized bearer token may receive full diagnostics and safe
  credential lifecycle posture.
- Non-local binding requires explicit `AREPO_HOST` configuration and prints a
  startup warning.
- CORS is restricted to the local frontend dev origins by default:
  `http://localhost:8733` and `http://127.0.0.1:8733`.
- Extra CORS origins can be added with comma-separated
  `AREPO_ALLOWED_ORIGINS`; do not use wildcard origins. For example:
  `AREPO_ALLOWED_ORIGINS=http://localhost:9001 npm run backend:dev`.
- The Vite dev proxy strips browser `Origin` before forwarding local `/api`
  requests, so normal `npm run dev -- --port ...` overrides do not require a
  CORS change.
- If the frontend is served without the Vite dev proxy, the backend CORS
  allowlist must include that frontend origin.
- Only configured vault roots in `.arepo/config.json` are accessible.
- Config structure is validated at startup. Duplicate vault IDs, malformed JSON,
  malformed root-path values, and unsafe permission/index-scope shapes are
  rejected. A structurally valid registration with a missing or inaccessible
  root remains loadable and is reported as unavailable at runtime.
- The index/cache is rebuildable from Markdown files and is not canonical state.
- Syncthing, Git, and Borg/Restic/Kopia remain external responsibilities.

See [docs/protected-mode-operator-workflow.md](docs/protected-mode-operator-workflow.md)
for protected-mode configuration, bootstrap, credential creation, rotation,
revocation, failure checks, and audit sanitization steps.

The backend accepts only POSIX-style relative vault paths. It rejects absolute
paths, `..`, empty segments, duplicate slashes, symlink path traversal, and paths
that resolve outside the configured vault root. Content reads accept `.md`,
`.txt`, and the exact case-insensitive `*.arepo-chat.json` suffix; all file
mutation operations require `.md`.

File saves write and sync a uniquely named temporary file in the same directory,
rename it into place, and clean up the temporary file if the operation fails.
Writes to one path are serialized so concurrent saves cannot both consume the
same optimistic precondition. The UI does not mark a file saved until the
backend confirms the write. Saves include the file hash/mtime seen by the UI;
if the file changed on disk, the backend rejects the write and the UI keeps the
editor dirty.

## Indexing

The backend reads Markdown files from disk and rebuilds the generated machine
index from source files. The index includes paths, titles, frontmatter ids,
tags, headings, anchors, wikilinks, outgoing links, backlinks, broken links,
orphan notes, duplicate ids, and duplicate anchors. It deliberately excludes
full Markdown bodies. A credential with `readIndex` can retrieve structural
index data but cannot recover source content through index endpoints.

When a vault is added, AREPO builds the machine index automatically. Ordinary
index, search, filter, and inspection reads reuse the persisted index only after
validating its derivation version, index scope, Markdown inventory, and current
in-scope content hashes. Manual reindexing always forces a rebuild from the
current Markdown files.

Generated machine indexes are stored outside user vaults by default, under the
configured app data directory:

```text
<appDataDir>/indexes/<vault-id>-<vault-root-hash>.json
```

These files are disposable caches. They may be deleted and rebuilt from the
Markdown vault. Markdown files remain the source of truth. AREPO must not
depend on a user-created `index.md` file to make graph, backlinks, validation,
or search work. The version 4 cache stores disposable per-source Markdown
structural derivations without full source bodies. Matching content hashes let
unchanged sources skip parsing while global link, backlink, duplicate, orphan,
and validation state is reassembled deterministically when inputs change.
Whole-index validation still reads and hashes every in-scope Markdown body
because the current watcher cannot prove exact-on-access content identity; AREPO
falls back to canonical source reads rather than trusting size, mtime, or a
possibly stale watcher snapshot.

The frontend still owns preview rendering and graph layout, but note content
and the index now come from the local backend.

### Index benchmark

The structural-index benchmark generates deterministic synthetic vaults in a
temporary directory, measures indexing work and broad timing/memory phases, and
removes the fixtures when it finishes or fails:

```bash
npm run bench:index -- --profile small
npm run bench:index -- --profile medium
npm run bench:index -- --profile datacentre
```

The 50,000-file datacentre profile is explicitly opt-in and checks available
temporary-filesystem space before generation. File count, average source size,
links per source, seed, warm iterations, and an optional JSON result path can be
overridden with `--files`, `--average-bytes`, `--links-per-file`, `--seed`,
`--warm-iterations`, and `--json`. The `file-heavy` and `byte-heavy` profiles
separate per-file filesystem overhead from canonical read/hash bandwidth.

Benchmark timings are machine- and environment-specific. Repeated runs are
normally affected by the operating system page cache; the harness does not
pretend to flush it. These measurements are not performance thresholds and do
not run in the normal test, lint, or build commands. Correctness and work-count
contracts remain covered by deterministic automated tests instead.

The UI includes read-only structural index filters for broken links, orphan
notes, tags, folders, duplicate frontmatter IDs, and duplicate heading anchors.
These filters query the generated machine index and do not persist new canonical
search or graph state.

The UI also includes backend-owned, non-semantic index search over structural
fields such as file paths, titles, frontmatter IDs, tags, headings, anchors,
outgoing link targets, and backlinks. It is not AI search, vector search, or
full document body search.

The Tree's browser-local text search can match Markdown and plain-text bodies
only after the frontend has fetched those files through the content-read
endpoint. That path requires `readContent`; it does not obtain bodies from the
structural index. Plain-text results are identified separately from Markdown
notes. For a valid loaded chat export, file-level search text is derived only
from the conversation title/ID and message IDs, authors, and text. It does not
search arbitrary JSON keys or punctuation. Malformed or unreadable chat files
remain filename/path-searchable but contribute no body search text.

### AREPO chat export V1

The supported structured dialect has this shape:

```json
{
  "format": "arepo-chat-export",
  "version": 1,
  "conversation": {
    "id": "conv-001",
    "title": "Example conversation"
  },
  "messages": [
    {
      "id": "msg-001",
      "author": "Alice",
      "timestamp": "2026-08-24T10:00:00Z",
      "text": "Hello."
    }
  ]
}
```

Conversation IDs must be non-empty. Message IDs must be non-empty and unique
within the conversation. Every message requires string author, timestamp, and
text fields. Timestamps must be parseable ISO-8601-style values with `Z` or an
explicit numeric offset. Array order is canonical. Message timestamps are
source event time; filesystem mtime remains separate operational observation
time. Unknown fields are left untouched in the canonical file but are not part
of the V1 view. Invalid JSON/schema produces a bounded structured-validation
state, distinct from an unreadable source-content failure.

Individual source-content reads are isolated from the vault metadata and
structural-index load. If one supported file cannot be read, AREPO keeps the
Tree, file metadata, Markdown index, issues, and successfully loaded files
available. The unreadable file is reported individually; filename/path search
still includes it, while body search covers only successfully loaded content.

The Inspect panel can show read-only file-level machine-index details for a
selected note or structural filter result, including headings, anchors, outgoing
links, backlinks, broken outgoing links, duplicate IDs, duplicate anchors, and
orphan status. Backlink and outgoing-link rows can navigate to related notes
without modifying Markdown files.

Graph selection can show combined metadata for multiple selected notes,
including selected file count, combined file size, tags, headings, outgoing
links, backlinks, issue count, and selected paths.

## Workspace UI

The local UI includes a document close workflow that clears the central document
workspace without modifying files. If the editor has unsaved changes, AREPO asks
for confirmation before discarding the in-memory buffer.

The desktop workspace has resizable and tuckable left and right panes. Tucked
panes keep narrow resize strips and tapered restore tabs available, and the
center workspace clips content when panes are resized to extreme widths.

Tree and Graph views can be assigned to the center workspace. Opening a document
takes over the center workspace; closing it restores the previously assigned
Tree or Graph center view when one was set.

## Storage Reporting

`GET /api/vaults/:vaultId/storage` reports local storage use for a configured
vault. Per-file size is shown in the Metadata panel, graph multi-selection shows
combined selected-file size, and full vault storage details are shown in Vault
Settings. The backend scans only inside the configured vault root, counts regular
files, and skips symlinks. It reports:

- total vault file count and bytes
- Markdown/text file count and bytes
- attachment/other file count and bytes
- AREPO app-data cache bytes for the vault's generated machine index files

Generated machine indexes live under the app data directory and are disposable
cache. They are not user-authored Markdown content and can be rebuilt from the
vault files.

These storage categories are physical reporting buckets, not the supported
source-kind taxonomy. Chat JSON currently remains in the broad attachment/other
bucket; this does not make it an attachment or place it in the Markdown index.

The current indexer strips fenced code blocks and inline code before extracting
headings and wikilinks. It is still a lightweight Markdown parser, not a full
CommonMark AST pipeline.

## External Changes

The local backend watches configured vault roots for supported `.md`, `.txt`,
and `*.arepo-chat.json` file changes, additions, deletions, and renames. It does
not watch outside configured vault roots and continues to ignore symlink
escapes. Watch events are debounced. Markdown changes mark the vault index stale
and rebuild it after the event burst settles; plain-text-only and chat-only
changes remain visible in watcher status without staling or rebuilding the
Markdown machine index.

The frontend polls vault status from the local backend. If the open Markdown
file changes on disk and the editor has no unsaved changes, AREPO refreshes from
disk. Open plain-text and chat files always reload their read-only view from disk. If the
Markdown editor is dirty, AREPO keeps the browser buffer intact and shows a
conflict warning with actions to keep edits, reload the disk version, or save
the buffer as a new file. If an open Markdown file is deleted on disk, AREPO
shows a warning and lets the user close the buffer or save it as a new file; a
deleted read-only source offers only the close path. A chat edit that becomes
malformed reloads the canonical bytes and displays structured validation; a
later valid edit restores the structured view.

This third source is implemented directly and narrowly. AREPO does not yet have
generic adapters, record locators, provenance, or a universal structured-source
index.

The `.txt` experiment uses Node's normal UTF-8 decoding and does not detect
legacy encodings; invalid UTF-8 may therefore be displayed with replacement
characters. A plain-text rename is treated as deletion of the old path plus
discovery of the new path. The old read-only buffer is closed or refreshed
before the new path is opened; AREPO does not assign stable identity across the
rename.

Manual Rebuild index remains available. It forces the generated machine index
to be rebuilt from current Markdown files and is useful after very large
external operations or if the operating system drops filesystem events.

Watcher limitations:

- The backend watches only configured vault roots.
- Directory watchers are refreshed as folders appear and disappear.
- Filesystem events can be coalesced or dropped by the operating system during
  large bursts, so status polling also rescans supported file metadata.
- This is change detection only. It is not sync, version history, or backup.

## Local Storage

`localStorage` is only used for UI preferences such as theme and the last
selected vault id. It is not used as canonical note storage.

## Verification

```bash
npm run backend:test
npm run frontend:test
npm run lint
npm run build
```

## Daily-Driver Release Checklist

Use this before treating a local build as daily-driver ready:

1. Install dependencies with `npm install`.
2. Start the backend with `npm run backend:dev`.
3. Start the frontend with `npm run dev` and open `http://localhost:8733`.
4. Add the absolute path to `test-vault/` through Vault Settings.
5. Run the manual acceptance checklist in `docs/manual-acceptance.md`.
6. Run `npm run backend:test`, `npm run frontend:test`, `npm run lint`, and
   `npm run build`.
7. Confirm `.arepo/`, generated app data, `dist/`, `dist-backend/`, and
   `node_modules/` are not being committed.

The canonical manual local-mode gate is
[docs/manual-acceptance.md](docs/manual-acceptance.md). It uses `test-vault/`
and includes Local Node Diagnostics checks.

## Limitations

- Localhost-first backend; disabled auth is the default compatibility mode.
- Protected mode supports local bearer-token authorization for API/operator
  workflows, but it is not a LAN, reverse-proxy, or internet safety claim.
- No live sync, Git replacement, or backup system.
- No remote node registration yet.
- Markdown preview is sanitized in the browser, but the backend API should still
  not be exposed to untrusted networks.
