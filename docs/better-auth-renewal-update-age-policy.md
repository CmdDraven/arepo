# Better Auth Renewal And Update-Age Policy

Status: accepted with conditions for future browser-auth work.

This policy does not enable browser authentication. Better Auth remains
isolated and unmounted. Live protected-mode authorization remains bearer-token
based. Live routes still do not issue cookies, accept cookies, parse cookies for
authorization, validate CSRF, issue pairing codes, or create browser sessions.

## Decision

AREPO will use a bounded browser-session lifetime with bounded Better Auth
`updateAge` renewal. The initial future policy is:

- Session max age: 30 minutes.
- Better Auth `updateAge`: 5 minutes.
- Renewal is freshness only.
- Renewal may extend expiry metadata through Better Auth, but it does not grant
  new authorization, rotate authority, create a new subject, or bypass AREPO
  route permissions.

Better Auth remains responsible for session/cookie mechanics, expiry metadata,
and revocation primitives. AREPO remains responsible for activation gates,
route contracts, pairing UX, sidecar authorization state, route permissions,
audit policy, inactive-boundary tests, and CSRF policy for AREPO API routes.

## Authority Rules

Renewal is allowed only when the future cookie-backed request path has a valid
Better Auth session and a valid AREPO sidecar authorization reference. Renewal
must be blocked when the sidecar reference is missing, revoked, stale, or
mismatched.

Renewal never authorizes a route. Future route authorization must continue to
use AREPO-owned sidecar authorization state and route permissions, not raw
Better Auth session objects, frontend metadata, or cookie-derived permission
claims.

## Request Sequencing

Safe/read-only cookie-backed requests may update safe last-seen metadata after
session lookup and sidecar validation.

Unsafe cookie-backed requests must not renew before CSRF validation. For future
POST, PUT, PATCH, DELETE, logout, revoke, config, vault, pairing, or session
mutation routes, AREPO-owned CSRF validation must happen before mutation and
before renewal can be treated as successful freshness. SameSite remains helpful
but insufficient by itself.

Activation gates and route contracts must still pass before any future
cookie-backed renewal path can be mounted.

## Revocation And Expiry

Revoke-current overrides renewal. Revoke-all overrides renewal. Expiry
overrides renewal. Expired sessions must not be silently revived by renewal.

If a session is revoked, expired, missing sidecar state, or mismatched with
sidecar state, renewal must fail with sanitized reason codes and must not update
last-seen metadata.

## Audit And Last-Seen Metadata

Renewal should emit sanitized audit events when it is attempted, succeeds, or
is denied. Audit records must not include cookie values, session tokens,
authorization headers, cookie headers, `Set-Cookie` values, CSRF material,
pairing material, hashes, salts, or raw Better Auth payloads.

Last-seen updates are allowed only as safe metadata. They must not become
authorization truth and must not include vault/node permission posture.

## Backup And Restore Risk

Restored old auth database state can restore old freshness metadata. Restored
old sidecar state can mismatch Better Auth session state. Renewal must be
blocked when restored state is inconsistent.

Backup/restore policy must require reset or re-pairing unless AREPO can prove
session, revocation, sidecar, and expiry state are current and consistent.
Operators need a warning that restored app-data auth state can affect future
browser-session freshness.

## Remaining Blockers

- Production AREPO Better Auth plugin implementation.
- AREPO-owned sidecar authorization store implementation.
- Live AREPO-owned CSRF integration behind activation gates.
- Better Auth output/hook sanitization wrappers for audit and status.
- Deliberate disabled-live route mounting proof behind activation gates and
  inactive-boundary tests.
