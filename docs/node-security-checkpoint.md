# Node Security Checkpoint

Phase 4 is a design checkpoint before AREPO implements authentication, remote
nodes, federation, sync, or LAN-safe deployment.

This document is not an implementation plan for exposing the current backend.
AREPO V1 remains a local-only, unauthenticated Node backend. It binds to
`127.0.0.1` by default and must not be exposed to untrusted networks.

## Current Phase 4 Implementation Status

Phase 4 is in progress. AREPO now has security design documents, inert backend
scaffolding, and status-only request-policy plumbing for future protected mode,
but protected mode is not implemented.

Implemented as inert or status-only:

- Auth posture/config/status reporting: omitted auth config defaults to
  `auth.mode = "disabled"`. If config requests protected mode,
  `/api/node/status` reports requested protected mode as unavailable while
  operational auth remains disabled with no enforcement.
- `backend/routePermissions.ts`: type-only future route permission inventory.
- `backend/authPlanner.ts`: pure dry-run authorization planner for hypothetical
  credentials and route policies.
- `backend/credentialStore.ts`: credential metadata, app-data auth path,
  storage-boundary validation, and JSON store read/write helpers for future
  credentials, token verifiers, browser sessions, and revocations.
- `backend/credentialVerifier.ts`: pure PBKDF2-SHA-256 verifier helpers for
  creating verifier records from supplied secret material and checking supplied
  material against verifier records.
- `backend/sessionVerifier.ts`: pure PBKDF2-SHA-256 browser session verifier
  helpers for supplied session secret material, renewal eligibility planning,
  and logout/revocation planning.
- `backend/credentialVerificationService.ts`: non-HTTP verification service
  for explicitly supplied token or browser-session material against loaded
  credential, verifier, session, and revocation metadata stores.
- `backend/credentialVerificationAudit.ts`: non-HTTP audit integration helpers
  that convert verification results into sanitized auth audit events and append
  them to the existing JSONL audit log when called explicitly.
- `backend/httpCredentialAdapter.ts`: unmounted request-shaped credential
  extraction adapter for future protected mode. It can parse explicit test
  inputs for bearer headers or browser-session cookies, call the non-HTTP
  verification service, and return sanitized audit intent.
- `backend/authAudit.ts`: inert audit event types plus JSONL serialize, parse,
  append, and read helpers.
- `backend/authRevocation.ts`: inert revocation planning helpers for
  credentials, token verifiers, browser sessions, node-secret rotation, and
  emergency local-only reset.
- `backend/browserSecurityPolicy.ts`: inert browser request security policy
  planner for origin, CSRF, credential posture, reduced status, and stronger
  confirmation decisions.
- `backend/requestPolicyStatus.ts`: status-only request-policy readiness summary
  for local diagnostics. It reports policy inventory and planner presence, route
  policy count, and inactive enforcement/credential/audit/revocation/CSRF flags.
- `backend/protectedModeStartup.ts`: diagnostic startup assessment for future
  protected mode. It reports requested/operational auth mode, missing or corrupt
  auth stores, unsafe auth paths, permission warnings, inactive enforcement
  flags, and `networkExposureSafe: false`.

None of these modules enforce authentication, authorization, CSRF, origin
checks, token/session validation, revocation, or audit logging in active request
handling. They do not generate credentials, bearer tokens, cookies, active
sessions, pairing codes, or node registrations. Credential-store persistence
helpers are not imported by active request handling. Credential and session
verifier helpers, including the non-HTTP verification service and its audit
write adapter and HTTP credential adapter, are not mounted into active request
handling and do not reject real HTTP requests. The startup assessment is
diagnostic only and does not reject active API requests. They do not make LAN,
reverse-proxy, or internet exposure safe.

Current runtime behavior remains V1 local-node/no-auth behavior unless existing
local configuration changes the bind address or vault list. The backend binds
to localhost by default, uses configured vault roots only, treats CORS as a
browser-origin filter rather than authentication, and keeps non-local binding
unsafe with a no-auth warning.

Protected-mode enforcement is still blocked on credential issuance, request
credential parsing, session lifecycle, CSRF/origin enforcement, route
authorization middleware, audit wiring, revocation checks, startup safety
checks, and regression tests that cover protected and disabled-auth modes.

## Current V1 Security Posture

- AREPO V1 is a local-node-only app.
- The backend binds to `127.0.0.1` by default.
- There is no authentication, no session model, no token enforcement, no users,
  and no remote-node registration.
- The backend reads and writes only configured vault roots.
- Markdown files remain the source of truth.
- Generated machine indexes, graph inputs, storage summaries, and cache files
  are rebuildable support data. They are not canonical user content.
- `.arepo/config.json` stores local node and vault configuration. It is not a
  trust store and must not be treated as a secure secret vault.
- CORS is a browser-origin filter, not authentication. A permitted browser
  origin is not a trusted user, device, node, or process.
- Non-local backend binding remains unsafe in V1. It requires explicit
  `AREPO_HOST` configuration and must continue to print a no-auth warning.
- Reverse proxy, LAN, and internet exposure are unsupported for untrusted
  clients until authentication, authorization, audit, revocation, and tests
  exist.

## Threat Model

AREPO's future protected modes must account for these threats before the
backend can make network-safety claims.

- Malicious web page: a page opened in the user's browser may attempt cross-site
  requests to a localhost or LAN AREPO backend.
- Untrusted LAN client: another device on the same network may attempt to read,
  write, delete, enumerate, or reindex vault content.
- Reverse proxy exposure: a proxy may accidentally publish an unauthenticated
  backend to a wider network.
- Local same-user process: another process running as the same OS user may call
  localhost APIs or read local config files.
- Local malware: malware with user-level filesystem access can usually read
  vaults, configs, app data, and tokens; AREPO cannot fully defend against this.
- Stolen token: copied tokens or device credentials can be replayed unless
  tokens are scoped, auditable, rotatable, and revocable.
- Confused deputy access to user vaults: a trusted UI, proxy, extension, or node
  may trick AREPO into using its filesystem privileges on unintended content.
- CSRF and browser-origin risks: cookie-authenticated endpoints may be invoked
  by unwanted browser requests unless CSRF controls and origin checks exist.
- Overbroad CORS: wildcard or broad origin rules can let untrusted web pages
  read API responses in browsers.
- Accidental permission escalation: vault permissions or node permissions may
  drift from read-only to write/delete capability without clear user intent.
- Unsafe delete/write exposure: write and delete APIs affect user-owned source
  files, so protected modes need stricter gates than read-only index access.
- Remote-node impersonation: a peer may claim to be a registered node or replay
  a stale node credential.

The model assumes AREPO cannot protect files from an attacker who already has
the same OS-level access as the user. Protected modes are still valuable because
they can reduce browser, LAN, proxy, token replay, and remote-node risks.

## Deployment Modes

### Local-Only Single-User Mode

Implemented today. The backend binds to localhost, has no authentication, and
serves one local user. This mode may keep `auth.mode = "disabled"` in a future
config because the network boundary is localhost-only. It must continue to warn
that non-local exposure is unsafe.

### Single Self-Hosted Node For Trusted Devices

Future protected mode. One AREPO backend serves selected trusted devices on a
trusted network. It requires token or session enforcement, origin controls,
vault-level authorization, audit logging, revocation, and startup checks before
AREPO can describe it as safer than V1.

### Future Hub UI

Future local or self-hosted UI that lists multiple known nodes. A hub must not
infer trust from network discovery. Each node relationship needs explicit
registration, identity, scope, and revocation.

### Future Remote Registered Nodes

Future nodes that have explicit identity and scoped permissions. Registration
must be authenticated, auditable, revocable, and resistant to impersonation.

### Future Read-Only Archive Node

Future node intended for browsing and search without mutation. It should default
to `readIndex` only, optionally add `readContent`, and never grant
`writeContent` or `deleteFiles`.

### Future AI Enrichment Node

Future node that may read content and produce generated summaries, embeddings,
tags, aliases, or proposed links. It needs explicit enrichment permissions,
clear provenance, generated-data storage boundaries, and a way to disable or
revoke enrichment access.

### Future Mobile Browse Node

Future low-trust client optimized for reading. It should receive minimal scoped
access, short-lived credentials where practical, and no delete permission.

## Candidate Auth Approaches

| Approach | Status | Reasoning |
| --- | --- | --- |
| Local pairing token | Accepted for first protected-mode design | A one-time or short-lived pairing code can add a trusted browser/device without requiring hosted accounts. It should be generated locally, shown only to the user, time-limited, and exchanged for a scoped credential. |
| Long-lived API token | Deferred with restrictions | Useful for CLI tools, scripts, and non-browser clients, but risky if copied into shells, logs, vaults, or sync folders. If added, it must be scoped, named, auditable, rotatable, and revocable. |
| Short-lived session token | Accepted for browser protected mode | Fits browser UI use and limits replay duration. It needs renewal rules, logout, expiration, audit events, and storage decisions. |
| Signed node tokens | Deferred until remote nodes | Appropriate for registered nodes because credentials can include node identity, scope, expiry, and signature verification. It should wait until node registration is explicitly designed. |
| mTLS | Deferred | Strong for node-to-node and enterprise deployments, but operationally heavy for normal users. It may be valuable later as an advanced protected-mode option. |
| Reverse-proxy delegated auth | Deferred and never sufficient by itself | Useful for some self-hosters, but AREPO should not trust only proxy headers unless deployment rules, header stripping, allowed proxy addresses, audit, and fallback behavior are designed. |
| Browser cookie sessions | Accepted only with CSRF design | Ergonomic for the UI, but cookies create CSRF concerns. Cookie sessions need SameSite settings, CSRF tokens or equivalent checks, origin validation, and clear separation from header-token API clients. |

No approach should be implemented by silently making non-local binding safe.
Protected mode needs explicit config, status reporting, tests, and warnings.

## Authorization Model

Authorization should be layered. Authentication answers who or what is calling;
authorization answers which node, vault, and operation that caller may use.

- Node-level trust: each future browser/device/node credential should bind to a
  named local device, remote node, service, or session. Unknown nodes get no
  access.
- Vault-level permissions: each credential should be scoped to specific vaults
  rather than all configured roots by default.
- Operation-level permissions: each credential should declare allowed operations
  within each vault.
- Existing permissions: `readIndex`, `readContent`, `writeContent`, and
  `deleteFiles` remain the base vocabulary.
- Future enrichment permissions: likely separate permissions for reading
  enrichment inputs, writing generated enrichment data, proposing source-file
  edits, approving generated changes, clearing generated data, and managing
  enrichment policy.
- Future remote-node permissions: likely separate permissions for node status,
  node registration, node heartbeat, node metadata, vault listing, and remote
  browsing.
- Read-only node behavior: read-only nodes should default to `readIndex`, add
  `readContent` only by explicit user choice, and reject write, rename, create,
  folder-create, delete, and reindex-mutation operations.
- Least-privilege defaults: new credentials should start with no vault access or
  read-only access to a selected vault. Delete should remain opt-in and rare.

The future model should avoid multi-user RBAC unless a later design explicitly
introduces it. AREPO's first protected mode should be device/node scoped, not a
hosted user-management system.

## Protected-Mode Route Authorization Map

This route map is design only. AREPO does not enforce these checks yet. V1 still
has no authentication and must not be exposed to untrusted networks.

Future protected mode should evaluate authorization after authentication and
after CORS/origin handling. CORS must not replace these checks. A request from an
allowed browser origin still needs a valid credential and the required node,
vault, and operation permission.

Planned permission vocabulary:

- `readIndex`: read generated index metadata, structural map data, validation
  results, watcher/index status, and generated storage/cache summaries for an
  authorized vault.
- `readContent`: read source Markdown file content or source-file-derived data
  that is close enough to content to require source access.
- `writeContent`: create or modify source files, source folders, filenames, or
  generated index state for an authorized vault.
- `deleteFiles`: delete source files. This should remain separate from general
  write access.
- `manageVaults`: add, remove, or change configured vault registrations and
  vault-level permissions.
- `manageNode`: view or change node-level diagnostics and runtime posture that
  is broader than a single vault.
- `manageAuth`: change auth mode, create credentials, revoke credentials, rotate
  node secrets, and manage protected-mode security state.
- `readAudit`: read future auth, node, vault, and mutation audit events.

Generated-index access is not the same as source-content access. Generated
index endpoints may expose paths, titles, headings, tags, wikilinks, backlinks,
broken links, duplicate IDs, duplicate anchors, issue messages, and generated
metadata. They should require `readIndex`, but not automatically require
`readContent`. Direct source file reads require `readContent`. Source file
mutations require `writeContent`, and deletes require `deleteFiles`.

| Current endpoint | Current behavior | Future protected-mode requirement | Notes |
| --- | --- | --- | --- |
| `OPTIONS *` | CORS preflight response | No content permission; origin policy only | A successful preflight must never authorize the following request. |
| `GET /api/health` | Local node health and node identity | Anonymous reduced response only, or `manageNode` for current full node identity | In protected mode, anonymous health should expose only service liveness and that auth is required. Full node identity should require auth. |
| `GET /api/node/status` | Node diagnostics, runtime posture, startup warnings, vault counts, capability flags, auth posture | `manageNode` for the full current response | A reduced anonymous status may report only liveness, protected-mode requirement, and safe public warnings. It must not expose vault names, roots, counts, origins, or detailed runtime diagnostics. |
| `GET /api/vaults` | List configured vaults and permissions | `readIndex` for each returned vault, plus `manageVaults` for full registration metadata | A non-admin credential should see only vaults it can access and should not receive filesystem roots unless explicitly allowed. |
| `POST /api/vaults` | Register a local vault and build its generated index | `manageVaults` and local-operator confirmation | Adding a vault expands AREPO filesystem reach and should be treated as administrative. |
| `GET /api/vaults/:vaultId/files` | List Markdown files and folders in a vault | `readIndex` on that vault | File and folder names are index-like metadata, not source body content. |
| `GET /api/vaults/:vaultId/file?path=...` | Read source Markdown file content and metadata | `readContent` on that vault | Path safety checks still apply before and after auth enforcement. |
| `GET /api/vaults/:vaultId/status` | Vault watcher/index status; optional file status for `path` | `readIndex`; require `readContent` when a specific source `path` is requested | File-level status can reveal existence, size, timestamp, hash, and conflict state for a source file. |
| `GET /api/vaults/:vaultId/storage` | Storage summary for vault content and generated cache | `readIndex` on that vault | It exposes aggregate sizes and generated-cache paths, not file bodies. Future per-file storage details may need stronger checks. |
| `PUT /api/vaults/:vaultId/file?path=...` | Write source Markdown file content; may overwrite after conflict parameters | `writeContent` and `readContent` on that vault | Conflict overwrite should require a fresh confirmation token or equivalent explicit user confirmation in addition to permission. |
| `POST /api/vaults/:vaultId/file` | Create a source Markdown file | `writeContent` and `readContent` on that vault | Creation writes source content and should keep path safety and collision checks. |
| `POST /api/vaults/:vaultId/folder` | Create a source folder | `writeContent` on that vault | Folder creation changes source tree shape but does not require reading file bodies. |
| `POST /api/vaults/:vaultId/rename` | Rename source file or folder | `writeContent` and `readContent` on that vault | Rename can overwrite namespace expectations and should preserve conflict/path checks. |
| `DELETE /api/vaults/:vaultId/file?path=...` | Delete a source file | `deleteFiles`, plus `writeContent` and `readContent` on that vault | Delete should require stronger confirmation or a delete-specific grant; `writeContent` alone is not enough. |
| `POST /api/vaults/:vaultId/reindex` | Rebuild generated machine index from source Markdown | `readIndex` and `readContent` on that vault | Reindex reads source files to produce generated metadata. It does not write source Markdown. |
| `GET /api/vaults/:vaultId/index` | Read generated machine index | `readIndex` on that vault | Generated index data is rebuildable and non-canonical, but can reveal sensitive metadata. |
| `GET /api/vaults/:vaultId/index/filters?filter=...` | Read generated structural filter results | `readIndex` on that vault | Includes broken links, orphan notes, tags, folders, duplicate IDs, and duplicate anchors. |
| `GET /api/vaults/:vaultId/index/search?q=...` | Search generated index fields | `readIndex` on that vault | Searches index metadata, not full source content. Future full-text search should require `readContent`. |
| `GET /api/vaults/:vaultId/index/inspect?path=...` | Inspect generated metadata for one indexed note | `readIndex` on that vault | Includes headings, anchors, links, backlinks, tags, duplicate metadata, and issues; it should not return source body content. |
| Future auth management routes | Not implemented | `manageAuth` | Token creation, pairing, revocation, auth mode changes, and node secret rotation should never be covered by vault permissions. |
| Future audit routes | Not implemented | `readAudit`, with `manageNode` or `manageAuth` for sensitive audit scopes | Audit may reveal paths, node identities, denied operations, and security events. |

### Reduced Anonymous Status

Protected mode should not keep the current full anonymous status responses. A
future protected backend may expose:

- `GET /api/health`: anonymous liveness, API version, and a boolean such as
  `authRequired`.
- `GET /api/node/status`: either require `manageNode` for the current full
  diagnostics response, or return a reduced anonymous response with no vault
  details, no filesystem paths, no configured CORS origins, and no credential
  inventory.

The current unauthenticated full status is acceptable only in local-only V1
because the backend binds to localhost by default and still warns against
non-local exposure.

### Least-Privilege Credential Defaults

- Read-only archive credential: `readIndex` by default for selected vaults;
  optionally `readContent`; never `writeContent`, `deleteFiles`, `manageVaults`,
  `manageNode`, `manageAuth`, or `readAudit`.
- Normal trusted browser credential: `readIndex`, `readContent`, and
  `writeContent` for selected vaults; no `deleteFiles` unless explicitly added;
  no `manageAuth`; limited or no `manageNode` unless diagnostics are deliberately
  part of the trusted-browser role.
- Admin/local operator credential: `manageNode`, `manageVaults`, `readAudit`,
  and selected vault permissions; `manageAuth` only when the operator is
  changing protected-mode state; `deleteFiles` remains explicit.
- Future enrichment node credential: `readIndex` plus narrowly scoped
  `readContent` for eligible vaults or paths; future enrichment-write
  permissions for generated data only; no source `writeContent`, `deleteFiles`,
  `manageVaults`, `manageNode`, or `manageAuth` by default.

### Stronger Confirmation Operations

Some operations should require more than a valid credential carrying a broad
permission:

- Delete: require `deleteFiles`, a delete-specific confirmation, and audit.
- Overwrite after conflict: require `writeContent`, `readContent`, current
  conflict context, and explicit user confirmation.
- Vault registration, removal, root path changes, and vault permission changes:
  require `manageVaults`, local-operator intent, and audit.
- Auth mode changes, token creation, token revocation, session revocation, and
  node secret rotation: require `manageAuth`, local-operator intent, and audit.
- Non-local bind with disabled auth: should remain warned or refused depending
  on future protected-mode policy; it must never be considered safe because of
  CORS.

The next implementation slice should be a type-only route permission inventory
or tests around a pure authorization planner. It should not enforce requests
until credential parsing, auth storage, audit, revocation, and CSRF/origin
policy are designed.

## Audit And Event Model

Protected modes need a local audit trail before AREPO can support revocation and
incident recovery. Audit data should live outside Markdown vaults and should not
be treated as source content.

Events to record:

- auth attempt accepted or rejected
- pairing started, completed, expired, or cancelled
- token, session, or node credential created
- token, session, or node credential used
- token, session, or node credential revoked
- node secret rotated
- vault registration added, changed, or removed
- vault permission changed
- file created, written, renamed, or deleted
- delete attempt rejected or accepted
- path traversal, symlink escape, or unsafe path rejected
- non-local bind startup detected
- remote-node registration attempted, accepted, or rejected
- CORS or origin rejection
- auth configuration changed
- enrichment-policy changed when enrichment policies exist

Audit records should include timestamp, actor identity when known, node/session
identity when known, vault ID when relevant, operation, result, and a stable
reason code for rejection. They should avoid storing full document contents.

## Revocation And Recovery

Protected modes need clear local recovery actions.

- Revoke token/device/node: invalidate one credential without changing all
  others; record the revocation in audit.
- Rotate node secret: replace the local signing or node secret and invalidate
  credentials derived from the old secret.
- Disable non-local access: switch bind host back to `127.0.0.1` or refuse
  protected-mode startup until the operator explicitly re-enables it.
- Emergency local-only reset: remove active credentials and force
  `auth.mode = "disabled"` only with localhost binding, preserving vault config
  where practical.
- Lost-token recovery: require local filesystem or console access to create a
  new credential; do not support cloud recovery for the first implementation.
- Compromised-device response: revoke that device, rotate shared secrets if
  needed, inspect audit events, and review vault permissions.
- Removing a remote node: revoke node credentials, disable node-specific access,
  keep historical audit entries, and require fresh registration for rejoin.
- Audit trail preservation: revocation should not delete audit history. Audit
  retention and pruning need an explicit policy later.

## Secret And Config Model

AREPO needs a clear boundary between user-editable config, app data, secrets,
and source vault content.

- Secrets may live in a local app-data directory controlled by AREPO, not in
  Markdown vaults.
- Generated secret files should be created with owner-only permissions where the
  operating system supports it.
- `.arepo/config.json` may store non-secret posture and references such as
  node ID, display name, mode, app data path, vault roots, vault permissions,
  bind host, and whether protected mode is intended.
- `.arepo/config.json` should not store plaintext long-lived bearer tokens,
  pairing secrets, private keys, session secrets, password hashes, recovery
  secrets, OAuth tokens, or remote-node private credentials.
- App data may store generated indexes, caches, audit logs, token metadata,
  hashed token verifiers, public node metadata, revocation state, and local
  secret files.
- Markdown vaults must never store AREPO auth secrets, remote-node credentials,
  session data, private keys, pairing codes, or token recovery material.
- Backup and sync tools may copy app data if the user configures them that way.
  Docs and UI should warn that copying app data can copy active credentials or
  audit records.
- Copying `.arepo/config.json` to another machine should be treated as copying
  vault paths and posture, not as safely pairing a new device.

See [Credential Storage Design](credential-storage-design.md) for the future
protected-mode credential storage and lifecycle design. That design is not
implemented and does not make non-local exposure safe.

## Browser And API Security

- CORS is not authentication. It controls which browser origins can read
  responses, but it does not prove the caller is trusted.
- A malicious page may still try to send requests to localhost or LAN services.
  Future protected modes need auth checks on every protected endpoint.
- Cookie sessions are convenient for browser UI but require CSRF protection,
  SameSite policy, logout, expiration, and origin checks.
- Header tokens are better for CLI/API clients and avoid ambient browser cookie
  behavior, but they are easy to leak into logs, shell history, scripts, and
  copied configs.
- Localhost assumptions apply only to local-only mode. Once the backend binds to
  a non-local address, AREPO must assume untrusted clients can reach it.
- Origin checks should complement, not replace, token or session verification.
- Preflight behavior is not a security boundary. Passing an OPTIONS preflight
  must not grant access to the actual operation.
- Browser UI and API clients may need different auth paths: browser sessions for
  normal UI use, header tokens for scripts and integrations, and node tokens for
  future node-to-node communication.

See [Browser Session Security Design](browser-session-security-design.md) for
the future CSRF, origin, cookie-session, and header-token request policy. That
design is not implemented and does not make non-local exposure safe.

## Explicit Non-Goals For First Auth Implementation

- no hosted auth
- no cloud account
- no federation
- no sync
- no multi-user RBAC unless explicitly designed later
- no database requirement
- no LAN, reverse-proxy, or internet safety claims until implemented and tested
- no weakening of vault path safety
- no OAuth provider requirement
- no password account system for the first local protected-mode slice
- no remote-node registration in the first auth slice
- no change to Markdown save, write, rename, create, or delete semantics unless
  the operation is denied by an explicit future authorization check

## Recommended First Implementation Path

The smallest safe code slice after this design should describe auth posture
without enforcing credentials yet.

1. Add typed auth posture/config fields and status reporting.
2. Keep the default `auth.mode = "disabled"` for local-only mode.
3. Report whether the backend is in local-only disabled-auth mode or an
   explicitly configured future protected posture.
4. Preserve the existing non-local bind no-auth warning.
5. Add tests that prove status reporting does not claim auth is active and does
   not mark non-local binding as safe.
6. Design protected mode before token enforcement, including credential storage,
   audit events, revocation, CSRF posture, and permission checks.
7. Only after protected mode is designed, add token/session enforcement behind
   explicit config and tests.

The first implementation must not make LAN binding, reverse proxy exposure, or
internet exposure safe by declaration. AREPO should make a safety claim only
after every protected endpoint has authentication, authorization, audit,
revocation, startup warnings, and regression tests.
