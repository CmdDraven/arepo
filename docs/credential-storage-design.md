# Credential Storage Design

This is a Phase 4 design note for future protected mode. AREPO does not
implement credential storage, token generation, sessions, auth middleware, or
auth enforcement yet. The V1 backend remains unauthenticated and must not be
exposed to untrusted networks.

## Storage Boundaries

Credential storage must keep a hard boundary between user-authored source
content, editable node posture, generated app data, and secret material.

- `.arepo/config.json` may contain non-secret auth posture only, such as
  `auth.mode`, whether protected mode is intended, and references to app-data
  locations. It must not contain bearer tokens, pairing secrets, private keys,
  password hashes, session secrets, token verifiers, recovery material, or node
  private credentials.
- The app data directory may contain credential metadata, salted token verifier
  records, session records, revocation records, audit logs, public node
  metadata, and local secret files.
- Markdown vaults must never contain auth secrets, credential material, token
  verifier data, session state, pairing codes, node secrets, or recovery
  material.
- Generated index/cache data remains rebuildable and non-canonical. Auth state
  is not rebuildable from Markdown and must not be mixed with generated map
  caches in a way that makes it easy to delete accidentally.

## Proposed App Data Layout

The exact app-data root is still controlled by existing AREPO app-data
resolution. A future protected-mode implementation should keep auth material
under a dedicated subdirectory:

```text
<appDataDir>/
  auth/
    credentials.json
    token-verifiers.json
    sessions.json
    revocations.json
    node-secret
    audit/
      events.jsonl
```

Proposed responsibilities:

- `auth/credentials.json`: non-secret credential metadata, labels, actor kind,
  scope, creation time, last-use time, expiry, and revocation references.
- `auth/token-verifiers.json`: token lookup IDs, salts, verifier hashes, hash
  parameters, credential IDs, expiry, and revocation state. It must never store
  plaintext bearer tokens.
- `auth/sessions.json`: short-lived browser session records, session verifier
  hashes, expiry, renewal state, logout/revocation state, CSRF metadata if a
  cookie-based session model is selected, and credential references.
- `auth/revocations.json`: revoked credential IDs, revoked token IDs, revoked
  session IDs, node-secret generation markers, reasons, and timestamps.
- `auth/node-secret`: local node signing/encryption secret material where needed
  for future token or session verification. This file should be owner-only and
  replaceable through rotation.
- `auth/audit/events.jsonl`: append-oriented audit events for auth attempts,
  credential creation/use/revocation, node-secret rotation, permission changes,
  vault registration changes, denied route plans, and emergency reset actions.

Implemented helper names:

- `readCredentialStore` / `writeCredentialStore`
- `readTokenVerifierStore` / `writeTokenVerifierStore`
- `readBrowserSessionStore` / `writeBrowserSessionStore`
- `readRevocationStore` / `writeRevocationStore`
- `validateCredentialStore`, `validateTokenVerifierStore`,
  `validateBrowserSessionStore`, and `validateRevocationStore`
- `createTokenVerifierMetadata`, `verifyTokenMaterial`,
  `createTokenLookupId`, `createTokenDisplayPrefix`, and `constantTimeEqual`
  in `backend/credentialVerifier.ts`
- `createBrowserSessionVerifierMetadata`, `verifyBrowserSessionMaterial`,
  `createSessionLookupId`, `createSessionDisplayPrefix`,
  `planBrowserSessionRenewal`, and `planBrowserSessionLogout` in
  `backend/sessionVerifier.ts`
- `verifySuppliedTokenCredential` and
  `verifySuppliedBrowserSessionCredential` in
  `backend/credentialVerificationService.ts`

These helpers read, validate, and atomically write the JSON files above. They
are not imported by request handling and do not generate credentials, accept
tokens or session secrets from HTTP requests, create active sessions, set
cookies, verify request credentials, or enforce auth. The verification service
operates only on explicitly supplied material and already-loaded metadata
stores; it does not read `Authorization` headers or cookies.

File and directory handling:

- Create `auth/` with owner-only permissions where the operating system supports
  them.
- Create secret-bearing files with owner read/write permissions only where
  supported.
- Write JSON state atomically through a temp file, fsync where practical, then
  rename.
- Audit events should be append-oriented. If JSONL is used, a single corrupt
  line should not make the entire audit log unreadable.
- If a state file is missing in local-only disabled-auth mode, AREPO should keep
  operating as local-only; the current helper returns an empty store.
- If a required protected-mode state file is missing or corrupt, protected mode
  should fail closed, avoid partial enforcement, and surface a local recovery
  diagnostic.
- The current helper reports malformed JSON as a corrupt-store error and rejects
  malformed schema. A future recovery slice should preserve corrupt auth files
  for inspection by renaming or copying to a quarantine path before replacement,
  when safe to do so.

## Credential Types

### Browser Session Credential

Short-lived credential for the web UI. It should be created only after a local
pairing or future protected-mode sign-in flow. Browser sessions should have
expiry, renewal rules, logout, audit events, and CSRF/origin posture designed
before use.

### Local Pairing Credential

Temporary credential used to authorize a new browser or trusted device. Pairing
secrets should be one-time or short-lived, displayed only to the local operator,
and exchanged for a scoped credential. Expired or completed pairing material
should be removed or marked unusable.

### Long-Lived API Token Credential

Credential for scripts, CLI tools, and non-browser clients. It should be named,
scoped, revocable, auditable, and shown only once at creation. Long-lived API
tokens are high risk because users may paste them into shells, scripts, logs, or
sync folders.

### Future Node Credential

Credential for future registered AREPO nodes. It should bind to a node identity,
scope, expiry or rotation policy, and revocation state. It must wait for remote
node registration design and must not be inferred from network presence.

### Future Read-Only Archive Credential

Credential for browse/archive use. It should default to `readIndex` on selected
vaults, optionally add `readContent`, and never include `writeContent`,
`deleteFiles`, `manageVaults`, `manageNode`, `manageAuth`, or `readAudit` by
default.

## Token And Verifier Model

Bearer token handling must assume any copied token can be replayed until expiry
or revocation.

- Never store plaintext bearer tokens.
- Store only public token IDs or prefixes plus salted verifier material.
- Use a token prefix or lookup ID so verification can find a small candidate set
  without scanning every verifier.
- Store verifier algorithm, salt, parameters, credential ID, created time,
  expiry, and revoked time.
- Current verifier primitives use PBKDF2-SHA-256 with explicit parameters:
  scheme `pbkdf2-sha256`, digest `sha256`, iterations, salt length, and output
  length. This is a simple built-in Node crypto primitive for future verifier
  records, not an active auth mechanism.
- Compare verifier output with constant-time comparison where practical.
- Display a bearer token only once at creation.
- Store only a short non-secret display prefix for later identification.
- Do not write tokens to logs, audit event details, Markdown files, config
  files, browser-visible diagnostics, or generated index/cache data.
- Token rotation should create a new verifier and revoke or expire the old one.

## Scope Model

Each credential or session should have explicit scope:

- credential ID
- display name or label
- actor/device kind: browser session, device, API client, future node, archive,
  enrichment worker, or local operator
- node/global permissions: `manageNode`, `manageVaults`, `manageAuth`,
  `readAudit`
- vault-scoped grants: vault ID plus permissions such as `readIndex`,
  `readContent`, `writeContent`, and `deleteFiles`
- expiry time where applicable
- createdAt
- createdBy or local operator reference where available
- lastUsedAt and lastUsedRoute, without logging bearer token values
- revokedAt, revokedBy, and revocation reason
- verifier IDs or session IDs associated with the credential

Least privilege should be the default. New credentials should start with no
vault access or selected-vault read-only access. `deleteFiles`, `manageAuth`,
and `manageVaults` should require explicit local-operator intent.

## Session Model

Browser sessions are distinct from API tokens:

- Sessions should be short-lived and renewable under explicit rules.
- Sessions should support logout and server-side revocation.
- Session records should store verifier hashes, not plaintext session secrets.
- Current session verifier primitives use PBKDF2-SHA-256 with explicit
  parameters and store lookup IDs, display prefixes, salts, hash parameters,
  and verifier hashes. This is pure helper logic for future protected mode, not
  an active cookie or session mechanism.
- Cookie-based sessions need SameSite policy, secure flag behavior, CSRF tokens
  or equivalent protection, and strict origin checks.
- Header-based browser tokens reduce ambient cookie CSRF risk but increase
  exposure to browser storage and scripting mistakes.
- Session renewal should update expiry and audit metadata without extending a
  revoked session.
- Expired sessions should fail closed and be eligible for cleanup.
- A lost browser session should be recoverable only through local operator
  access, a new pairing flow, or another still-authorized admin credential.

API tokens differ because they are usually long-lived, manually copied, and
used outside browsers. They should not receive browser cookie behavior or CSRF
assumptions.

## Revocation And Recovery

Future protected mode needs revocation before it can make safety claims:

- Revoke one credential: mark the credential and all associated verifier/session
  IDs revoked.
- Revoke one token/session: mark one verifier or session revoked while leaving
  sibling credentials active if intended.
- Revoke all credentials: invalidate all verifier/session records while
  preserving audit history.
- Rotate node secret: create a new secret generation, invalidate dependent
  verifiers or sessions as needed, and record the rotation in audit.
- Emergency local-only reset: disable protected posture, bind only to localhost,
  revoke active protected-mode credentials, preserve vault config where
  practical, and preserve audit evidence.
- Removing a future node credential should revoke that node's verifier material
  and require fresh registration to rejoin.
- Revocation must not delete audit history. Audit retention and pruning should
  be explicit later.

## Backup And Sync Warnings

- App data backups may copy active credentials, verifier material, revocation
  state, audit logs, and node secrets.
- Restoring old app data may restore old credentials unless revocation and node
  secret generation checks prevent replay.
- `.arepo/config.json` copying should not pair devices. It contains posture and
  vault paths, not credential trust.
- Generated auth material should not be synced casually across devices.
- Markdown vault sync tools must not sync auth material because auth material
  must not live in Markdown vaults.
- UI and docs should warn users before copying app data from a protected node to
  another machine.

## Failure Modes

- Missing auth files: local-only disabled-auth mode may continue; protected mode
  should fail closed with a recovery diagnostic.
- Corrupt credential store: preserve the corrupt file when practical, stop
  protected-mode startup, and require local recovery rather than silently
  accepting all requests.
- Permissions too broad: warn when a credential has `deleteFiles`, `manageAuth`,
  `manageVaults`, or all-vault access; require audit for permission changes.
- App data unavailable: protected mode should fail closed because verifier and
  revocation state cannot be trusted.
- Clock skew: expiry should tolerate small skew only where justified; expired
  credentials should not be extended silently.
- Token replay: replayed bearer tokens remain valid until expiry or revocation,
  so short expiry, audit, last-use metadata, and revocation are required.
- Partial writes: atomic writes and recovery markers should prevent half-written
  verifier or revocation state from being treated as valid.
- Lost node secret: dependent credentials should become invalid and require local
  recovery or re-pairing.

## Current Startup Gating Status

The credential-store type, validation, path, read, and atomic-write helpers now
exist. `backend/protectedModeStartup.ts` adds diagnostic startup gating around
those stores:

1. Disabled local mode tolerates missing auth store files.
2. Requested protected mode reports missing, corrupt, unsafe, or unreadable auth
   stores as unavailable/fail-closed diagnostics.
3. Corrupt stores include quarantine-candidate metadata, but the helper does not
   rename, delete, or repair files yet.
4. Valid empty stores still do not make protected mode operational because
   enforcement, credential verification, audit wiring, revocation checks, and
   CSRF/origin enforcement are not implemented.
5. Request handling remains independent until credential verification, audit,
   revocation, CSRF/origin posture, and route authorization are ready together.

Do not generate tokens, create sessions, accept bearer credentials, or enforce
route authorization until credential storage startup checks, audit, revocation,
CSRF/origin posture, and recovery behavior are implemented and tested.
