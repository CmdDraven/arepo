# AREPO Roadmap

AREPO is currently focused on becoming a reliable daily-driver local node for
user-owned Markdown vaults. The immediate path is local reliability first, then
single-node self-host readiness, then richer mapping. AI, vector features, sync,
and federation are deliberately deferred.

## Phase 1: Daily-Driver Hardening

- Keep open, edit, save, rename, create, reindex, conflict review, and graph
  inspection predictable under repeated real use.
- Use `test-vault/` and `docs/manual-acceptance.md` as the daily release gate.
- Preserve the current local-first guarantees: Markdown remains source of truth,
  generated indexes stay rebuildable, and app data remains outside vaults by
  default.
- Improve visibility where workflows fail: backend health, vault freshness,
  index status, storage/cache size, file metadata, and mutation errors.

## Phase 2: Local Node Architecture

- Treat the backend as the first concrete `local` node implementation.
- Keep node-facing contracts explicit: `NodeInfo`, `VaultInfo`,
  `VaultPermission`, `VaultIndex`, `VaultRuntimeStatus`,
  `VaultStorageSummary`, and `OperationResult`.
- Keep node service responsibilities separate from vault filesystem operations.
- Do not add remote node registration in this phase.

The local node owns configured vault roots, generated disposable indexes/cache,
watcher state, local mutation safety, storage reporting, and startup diagnostics.
It does not own sync, backup, version history, or source-file custody.

## Phase 3: Single-Node Self-Host Readiness

- Keep the default backend bind address at `127.0.0.1`.
- Require explicit configuration for non-local binding and print a no-auth
  warning when enabled.
- Document safe CORS configuration for alternate frontend origins.
- Improve headless startup diagnostics for malformed config, inaccessible vault
  roots, invalid ports, and permission problems.
- Keep reverse proxy or LAN exposure unsupported for untrusted networks until
  authentication exists.

## Phase 4: Node Security Checkpoint

Status: in progress: design plus inert backend scaffolding. Protected mode is
not implemented. See
[docs/node-security-checkpoint.md](node-security-checkpoint.md).

Before true remote nodes, design authentication and trust boundaries. The design
must cover local-only mode, one self-hosted node, a future hub UI, remote node
registration, candidate token or mTLS approaches, vault-level permissions,
audit/event logging, and revocation.

Current Phase 4 scaffolding reports auth posture and defines type-only or pure
planning helpers for route permissions, dry-run authorization, credential
storage boundaries, audit events, revocation planning, and browser security
policy. These helpers are not wired into request handling and do not enforce
authentication or authorization.

Federation must not be implemented before this checkpoint. AREPO must not treat
network presence as trust. Phase 4 has not completed authentication, token
enforcement, LAN-safe deployment, remote node registration, sync, federation,
or protected-mode self-hosting.

## Phase 5: Mapping Improvements

Status: in progress. The current local V1 now has the first read-only mapping
surface built from the generated machine index:

- backend-owned, non-semantic structural index search
- filters for broken links, orphans, tags, folders, duplicate IDs, and duplicate
  anchors
- richer file-level Index inspect details for selected notes, graph selections,
  and structural filter results
- backlink and outgoing-link navigation
- graph multi-selection metadata
- center Tree/Graph workspace views for map inspection

This phase is still non-AI and local-only. Graph, search, inspect, and index data
remain rebuildable from Markdown files. No database, vector store, federation,
sync layer, remote node registration, or Markdown rewrite behavior is part of
Phase 5.

Likely next mapping work should stay read-only and incremental: polish navigation
between map surfaces, improve empty/error states, and broaden tests around the
existing generated-index helpers before adding new feature areas.

## Deferred Work

- AI and vector features
- sync implementation
- Git/versioning replacement
- backup implementation
- mdAtlas migration support
- hosted auth, hosted databases, analytics, telemetry, or cloud storage
- remote node registration before the node security checkpoint
