# Better Auth Backup Restore Session-State Policy

Status: accepted with conditions.

This policy is planning infrastructure only. It does not mount Better Auth,
does not issue cookies, does not accept cookies as credentials, does not parse
cookies for live authorization, does not validate live CSRF, and does not
change protected-mode bearer-token behavior.

## Decision

AREPO treats the Better Auth auth database and AREPO-owned sidecar
authorization state as sensitive generated app state, not vault content.
Restored, stale, mismatched, duplicated, missing, or suspicious browser-session
state fails closed by default.

Restoring old auth state must not silently restore browser-session authority.
Reset or re-pairing is required by default after suspicious restore, missing
state, epoch mismatch, or state from different points in time.

## Auth State Epoch

AREPO should introduce an auth-state epoch or generation before live browser
auth activation. Sidecar authorization references must bind to the current
auth-state epoch. The epoch must live in AREPO-owned app data, not in cookies,
not in frontend-controlled metadata, and not in raw Better Auth session objects.

Backup restore should increment or rotate the auth-state epoch unless an
operator deliberately accepts the restored state through a future safe recovery
flow. Old epoch state fails closed and requires reset or re-pairing.

## Restore Behavior

Better Auth auth DB restored without sidecar state:
fail closed and require re-pairing or reset.

Sidecar state restored without matching Better Auth auth DB:
fail closed and require re-pairing or reset.

Both stores restored from different points in time:
fail closed, mark the state suspicious, and require reset or re-pairing.

Both stores restored from the same point in time:
treat as suspicious until the current auth-state epoch is accepted by a future
operator recovery flow. Silent authority restoration is forbidden.

Deleting or resetting the auth database revokes all browser sessions. Deleting
sidecar authorization state revokes AREPO route authority. Auth state reset
invalidates prior sidecar references.

## Backup Posture

Auth DB and sidecar backups are allowed only as operator-managed app-data
backups with explicit warnings. They should be excluded from vault sync/export
by default. Operator backup tooling should protect them as sensitive generated
state, preferably with encryption or equivalent local protections.

Localhost-only mode still treats auth state as sensitive local app state.
Future self-host mode is higher risk and requires stronger backup, filesystem,
HTTPS, and operator policy before live browser auth.

## Detection And Failure

AREPO should detect missing Better Auth sessions for sidecar references,
missing sidecar references for Better Auth sessions, epoch mismatches,
duplicated sidecar references, and suspicious future expiry values. Detection
is best-effort until the sidecar store exists, and Better Auth alone is not
expected to understand AREPO restore semantics.

Renewal is blocked on restore suspicion. Pruning may mark suspicious sidecar
state stale or expired. Revoke-current and revoke-all may proceed only when
references match the current epoch and subject. CSRF validation cannot override
restore suspicion.

## Audit And Status

Audit events are required for auth state reset, restore suspicion, epoch
mismatch, sidecar mismatch, and re-pairing required outcomes. Audit/status
output may use redacted references and aggregate counts only. It must not
include raw cookies, session tokens, `Authorization` headers, `Cookie` headers,
`Set-Cookie` values, CSRF material, pairing material, verifier material, Better
Auth internal secrets, hashes, salts, stack traces, or credential values.

Reduced anonymous status may report that restore suspicion exists, but must
not expose browser-session metadata.

## Remaining Blockers

- Internal-adapter wrapper implementation.
- Production AREPO Better Auth plugin implementation.
- AREPO-owned sidecar authorization store and auth-state epoch implementation.
- Live AREPO-owned CSRF integration behind activation gates.
- Better Auth output/hook sanitization wrappers for audit and status.
- Deliberate disabled-live mounting design behind activation gates and
  inactive-boundary tests.
