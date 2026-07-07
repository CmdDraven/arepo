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
- Require explicit configuration for non-local binding and print a warning when
  enabled.
- Document safe CORS configuration for alternate frontend origins.
- Improve headless startup diagnostics for malformed config, inaccessible vault
  roots, invalid ports, and permission problems.
- Keep reverse proxy or LAN exposure unsupported for untrusted networks.

## Phase 4: Node Security Checkpoint

Status: in progress. Local bearer-token protected mode now enforces route
authorization for API/operator workflows, with credential bootstrap, create,
list, revoke, rotate, reduced anonymous status, and sanitized audit records. See
[docs/node-security-checkpoint.md](node-security-checkpoint.md) and
[docs/protected-mode-operator-workflow.md](protected-mode-operator-workflow.md).

Before true remote nodes, design authentication and trust boundaries. The design
must cover local-only mode, one self-hosted node, a future hub UI, remote node
registration, candidate token or mTLS approaches, vault-level permissions,
audit/event logging, and revocation.

Current Phase 4 implementation reports auth posture and readiness, enforces
bearer-token authorization in protected mode, and now reports browser-session
auth as planning-only/inactive with disabled route stubs plus pairing, session
lifecycle, cookie policy, CSRF, frontend no-secret, and audit lifecycle planner
posture. Inert in-memory browser-session store/verifier primitives now exist for
future storage semantics tests only, and inert in-memory CSRF token
store/verifier primitives now exist for future CSRF semantics tests only. Inert
in-memory pairing-code store/verifier primitives now exist for future browser
pairing semantics tests only. Inert browser-auth audit event primitives now
exist for future sanitized browser-auth lifecycle audit tests only. Inert
browser cookie policy and header-sanitization primitives now exist for future
cookie/session safety tests only, backed by an inactive-boundary regression
suite that guards against accidental browser-auth activation. An inert
browser-auth lifecycle coordinator now composes these primitives in unit tests
only and remains unmounted. A pure browser-auth activation preflight planner now
documents activation blockers and required confirmations without enabling live
browser auth. A pure browser-auth route contract planner now documents the
future browser-auth route surface and required protections without mounting
handlers. A pure browser-auth activation config policy planner now defines and
validates future activation config concepts while still blocking activation
today. A browser-auth dark route harness and explicit activation gate now model
future route execution in tests while remaining unmounted and blocked. A
disabled browser-auth request-shape adapter now sanitizes live-like request
shapes for that dark harness without mounting or authenticating. The dark
harness can now exercise test-only pairing-to-session-to-CSRF issuance through
the unmounted lifecycle coordinator, while live routes remain inactive. Test-only
cookie serialization planning now validates future session/CSRF cookie
attributes, redaction, and clearing behavior inside that unmounted harness path
without emitting live `Set-Cookie` headers. CSRF live enforcement, browser
session issuance from live routes, cookie issuance/acceptance, pairing route
activation, frontend token storage, remote-node, and federation work remain
deferred.

Further custom live browser-auth implementation is paused pending
[docs/browser-auth-dependency-evaluation.md](browser-auth-dependency-evaluation.md).
The current direction is to avoid hand-rolling the final production
browser-session mechanism, keep bearer-token protected mode as the live path,
and use the existing browser-auth dark-path scaffolding as acceptance criteria
for a mature auth/session dependency spike.
Better Auth is now selected as the preferred isolated compatibility target in
[docs/browser-auth-foundation-decision.md](browser-auth-foundation-decision.md),
with the current fit and proof work captured in
[docs/better-auth-compatibility-spike.md](better-auth-compatibility-spike.md).
`better-auth@1.6.23` is installed for an isolated backend dependency proof that
checks import/instantiation, standard handler shape, cookie policy control,
sign-out clearing metadata, and internal session/revocation behavior. Isolated
app-data and pairing-session proofs now show that Better Auth can use a local
SQLite app-data store through Node `node:sqlite`, persist sessions across
database reopen, revoke one or all sessions, and create an internal Better Auth
session after an AREPO pairing acceptance. An isolated routeRequest adapter
proof now shows AREPO-style request input can reach Better Auth's standard
handler boundary, signed cookie issuance/clearing can be observed and redacted
through normal Better Auth handler routes, session lookup works through a
signed cookie, sign-out invalidates that session, and direct raw token cookie
injection remains rejected. An isolated CSRF ownership proof now shows Better
Auth protects its own unsafe auth endpoints with trusted-origin behavior, while
AREPO should own CSRF validation for future cookie-authenticated unsafe AREPO
API routes. An unmounted AREPO-owned CSRF request adapter proof now validates
safe versus unsafe method classification, CSRF token/session binding,
supplemental Origin/Referer checks, and sanitized test-only denial/allow
results for those future unsafe route shapes. A Better Auth session-token
storage policy now accepts the stored `session.token` model with conditions
inside sensitive AREPO app data outside vault roots, with vault sync/export
exclusion, fail-closed corruption behavior, reset/re-pairing semantics, and
backup/restore warnings. An isolated deterministic expiry proof now shows
Better Auth can reject expired sessions through app-data active-session lookup
and signed-cookie `get-session` behavior without slow sleeps. An isolated
pairing-cookie proof now shows a pairing-created Better Auth session can be
accepted through a signed `arepo_session` cookie, direct raw token injection
remains rejected, and sign-out/expiry apply to that pairing-issued session. The
proof still relies on Better Auth's internal adapter plus exported signing, so
an isolated pairing-cookie boundary proof now checks the public Better Auth
plugin endpoint path and confirms it can emit the signed cookie through Better
Auth response behavior. A production-shaped isolated AREPO Better Auth
plugin-boundary proof now adds activation-gate ordering, route-contract
checking, sidecar authorization references, CSRF sequencing points, sanitized
audit-like events, signed-cookie lookup, sign-out, revoke-current, revoke-all,
expiry, and direct raw token rejection inside the unmounted proof boundary. An
internal-adapter risk decision now accepts `ctx.context.internalAdapter` only as
official-plugin-pattern internal access behind a future narrow AREPO wrapper,
while keeping direct token signing, raw token exposure, arbitrary adapter calls,
and route authorization inside Better Auth plugin code forbidden. A
renewal/update-age policy now accepts a bounded 30-minute max age and 5-minute
Better Auth `updateAge`, treats renewal as freshness only, keeps AREPO sidecar
authorization authoritative, and forbids unsafe request renewal before CSRF. An
expired-session pruning policy now accepts sidecar-only pruning: Better Auth
remains authoritative for session validity and expiry, AREPO marks sidecar
state expired or stale, fails closed on missing or mismatched records, and
retains only redacted tombstones for audit. A backup/restore session-state
policy now requires auth-state epoch binding for sidecar references, treats
restored or mismatched state as suspicious, and requires reset or re-pairing by
default. An
isolated session-scope metadata proof now selects the hybrid model:
Better Auth owns session/cookie mechanics, while AREPO owns local operator
identity, device-label policy, route authorization, and vault/node permission
posture in sidecar app-data state keyed by Better Auth user/session references.
The disabled-live internal-adapter wrapper and inert route adapter skeleton
now exist, but are not mounted into live route execution. Remaining work
includes disabled-live route mounting proof, production AREPO Better Auth
plugin implementation, persisted sidecar state, auth-state epoch
implementation, output sanitization wrappers, and live CSRF integration. No
Better Auth handler is mounted and live browser auth remains inactive.

Federation must not be implemented before this checkpoint. AREPO must not treat
network presence as trust. Phase 4 has not completed browser login, browser
sessions, CSRF-protected browser auth, LAN-safe deployment, remote node
registration, sync, federation, or protected-mode self-hosting.

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
