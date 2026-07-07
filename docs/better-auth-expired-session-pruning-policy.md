# Better Auth Expired-Session Pruning Policy

Status: accepted with conditions.

This policy is planning infrastructure only. It does not mount Better Auth,
does not issue cookies, does not accept cookies as credentials, does not parse
cookies for live authorization, does not validate live CSRF, and does not
change protected-mode bearer-token behavior.

## Decision

AREPO accepts a split pruning model:

- Better Auth remains authoritative for session validity, expiry, cookie
  mechanics, and its own session records.
- AREPO remains authoritative for route authorization through sidecar
  authorization state keyed by Better Auth user/session references.
- AREPO must not directly delete or mutate Better Auth session rows unless
  Better Auth exposes a supported cleanup API that is explicitly adopted later.
- AREPO may prune, expire, stale, or tombstone only AREPO-owned sidecar
  authorization references.
- Pruning never grants authority. It can only remove authority, mark authority
  stale, or retain redacted audit metadata.

## Sidecar State Handling

Expired Better Auth session with active sidecar:
mark the sidecar expired, remove authority-bearing state, retain only a
redacted tombstone if audit retention is needed.

Missing Better Auth session with active sidecar:
mark the sidecar stale and fail closed.

Active Better Auth session with missing sidecar:
fail closed. A Better Auth session alone is not AREPO route authorization.

Mismatched Better Auth session and sidecar:
mark stale, deny authority, and require operator-visible remediation if the
state cannot be reconciled safely.

Revoked sidecar:
retain a revoked tombstone if useful for audit, but never authorize.

## Cadence

Startup pruning may run later if it is bounded, deterministic, and audited.
Manual operator pruning should be supported later. Session lookup, logout, and
revoke paths may classify sidecar state when the future disabled/live path
exists. Scheduled background pruning is deferred until the backup/restore
policy and app lifecycle model are implemented.

Automatic pruning must never create authority or silently repair mismatched
state into an active session.

## Backup Restore And Clock Handling

Backup/restore inconsistencies fail closed. Restored auth DB state with stale
sidecar state, restored sidecar state with missing Better Auth sessions, and
mismatched restored records should require reset, re-pairing, or explicit
operator recovery.

Suspicious future expiry values and clock skew outside a small tolerance should
fail closed and require operator review. Tests for future pruning logic must use
a deterministic clock.

## Audit And Status

Pruning should emit sanitized audit events for started, completed, denied,
sidecar-expired, and sidecar-stale outcomes. Audit/status output may use
redacted references and aggregate counts only. It must not include raw cookies,
session tokens, `Authorization` headers, `Cookie` headers, `Set-Cookie` values,
CSRF material, pairing material, verifier material, Better Auth internal
secrets, hashes, salts, stack traces, or credential values.

Reduced anonymous status must not expose browser-session pruning details. A
future authorized full status view may expose aggregate counts only.

## Remaining Blockers

- Production AREPO Better Auth plugin implementation.
- AREPO-owned sidecar authorization store and auth-state epoch implementation.
- Live AREPO-owned CSRF integration behind activation gates.
- Better Auth output/hook sanitization wrappers for audit and status.
- Deliberate disabled-live route mounting proof behind activation gates and
  inactive-boundary tests.
