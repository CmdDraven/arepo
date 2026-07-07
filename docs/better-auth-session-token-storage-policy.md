# Better Auth Session Token Storage Policy

Status: accepted with conditions for isolated browser-auth planning. This is
not a live integration decision.

## Decision

AREPO accepts Better Auth's `session.token` storage model only inside AREPO app
data and only with explicit mitigations before browser sessions can become
live.

The Better Auth auth database is sensitive generated app state. It is not
user-authored vault content, must live outside vault roots, and must be excluded
from normal vault sync, export, and source-file workflows.

Live browser auth remains inactive. Better Auth remains isolated and unmounted.
Protected-mode request authorization remains bearer-token based.

## Token Classification

AREPO treats Better Auth's stored session token material as framework-owned
opaque session secret material. It must be handled as bearer-equivalent at rest:
copying the auth database may copy browser-session authority or enough material
for Better Auth to validate sessions.

The current policy does not add AREPO-side hashing or encryption around Better
Auth's session table before activation. That choice is conditional:

- Better Auth owns the session schema and token verification contract.
- AREPO stores the database only under app data, outside vault roots.
- AREPO documents the database as sensitive generated state.
- AREPO fails closed on missing or corrupt auth storage.
- AREPO keeps reset/re-pairing behavior explicit.

If a later proof shows the library-owned token model cannot meet AREPO's threat
model, AREPO should revisit `express-session` or another server-side session
foundation before enabling browser auth.

## Storage Location

Expected isolated proof location:

```text
app-data/auth/better-auth.sqlite
```

Production activation may choose a final app-data path, but the policy is the
same:

- Auth storage must live outside every configured vault root.
- Auth storage must not be committed, exported, indexed as Markdown, or treated
  as user-authored content.
- Auth storage must not be moved into vault sync or backup flows without an
  explicit sensitive-data warning.
- AREPO should attempt or document owner-only file permissions for local app
  data where the platform allows it.

## Reset And Corruption

Deleting or resetting the Better Auth database should revoke all browser
sessions and require re-pairing.

If the auth database is missing, unreadable, or corrupt, future browser-session
auth must fail closed. AREPO must not silently recreate a database and preserve
or imply existing browser sessions. The expected operator flow is explicit
repair, reset, and re-pairing.

## Backup And Restore

Backups of the auth database are sensitive. Restoring an older auth database can
restore older session state or stale revocation state unless the restore process
also forces logout/re-pairing or preserves a current consistent auth snapshot.

Policy:

- Backup/restore docs must warn that auth database backups can affect browser
  session authority.
- Restoring an old auth database should require session reset or re-pairing
  unless state freshness is deliberately proven.
- Revocation and expiry are reliable only when the auth database state is
  current.

## Localhost And Self-Host Posture

For localhost-only testing, this storage model is acceptable with local app-data
protection and clear operator warnings.

For future self-hosting, this storage model requires stronger filesystem,
backup, HTTPS, reverse-proxy, and operator policies. It does not make LAN,
reverse-proxy, or internet exposure safe by itself.

## Required Mitigations

- Store the Better Auth database under AREPO app data, outside vault roots.
- Exclude the auth database from vault sync, export, and source-content flows.
- Classify the auth database as sensitive generated app state.
- Attempt or document owner-only file permissions for auth app data.
- Treat auth database reset as revoking all browser sessions.
- Fail closed on auth database corruption.
- Require session reset or re-pairing after unsafe backup restore.
- Warn operators that app-data auth storage contains sensitive session material.

## Remaining Activation Blockers

This policy removes the storage-policy decision blocker, but it does not enable
browser auth. These blockers remain:

- production AREPO Better Auth pairing plugin implementation
- internal-adapter wrapper implementation for plugin endpoint session issuance
- AREPO-owned sidecar authorization store implementation
- expired-session pruning policy
- backup/restore session-state policy
- live AREPO-owned CSRF integration behind activation gates
- Better Auth output/hook sanitization wrappers for audit and status
- deliberate mounting behind activation gate, route contracts, and
  inactive-boundary tests

## Structured Model

The dependency-free model lives in:

```text
backend/betterAuthSessionTokenStoragePolicy.ts
```

It reports `accepted-with-conditions`, required mitigations, reset/corruption
behavior, backup/restore warnings, localhost versus self-host posture, and
remaining activation blockers. It does not import Better Auth, mount routes,
issue cookies, accept cookies, parse cookies for authorization, validate live
CSRF, or change bearer-token protected mode.
