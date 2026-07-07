# Better Auth Internal Adapter Risk Decision

Status: accepted with conditions for future browser-auth plugin work.

This decision does not enable browser authentication. Better Auth remains
isolated and unmounted. Live protected-mode authorization remains bearer-token
based. Live routes still do not issue cookies, accept cookies, parse cookies for
authorization, validate CSRF, issue pairing codes, or create browser sessions.

## Decision

AREPO accepts `ctx.context.internalAdapter` only as official-plugin-pattern
internal access inside a future Better Auth plugin boundary. This is not a
general permission to use Better Auth internals.

The decision is accepted because the isolated production-shaped plugin proof
shows that:

- `createAuthEndpoint` is a public exported Better Auth API.
- `setSessionCookie` is a public exported Better Auth API.
- Better Auth plugin endpoints can create a signed `arepo_session` cookie
  through Better Auth response behavior.
- Better Auth official plugin patterns use plugin context access to internal
  adapter operations.
- Direct token signing is no longer required by the accepted proof path.
- Signed-cookie lookup, sign-out, revoke-current, revoke-all, expiry, and
  direct raw token rejection work in isolation.

The risk is still real: Better Auth may change the plugin context or
`internalAdapter` semantics during upgrades. Production activation remains
blocked until AREPO implements a narrow wrapper, pins and reviews Better Auth
upgrades, and keeps inactive-boundary tests in place.

## API Classification

| Boundary                      | Classification                                   | Decision                                                          |
| ----------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| `createAuthEndpoint`          | public exported API                              | Accepted for future plugin endpoint shape.                        |
| `setSessionCookie`            | public exported API                              | Accepted for future signed-cookie response behavior.              |
| `ctx.context.internalAdapter` | official-plugin-pattern internal access          | Accepted only behind an AREPO wrapper inside the plugin boundary. |
| Direct token signing          | unsupported internal access for AREPO production | Forbidden.                                                        |

## Wrapper Policy

The future wrapper must live only inside the Better Auth plugin boundary. It
must expose named operations only, return redacted references only, and sanitize
all errors and reason codes.

Allowed operations:

- Find or create the local Better Auth user reference for an already accepted
  AREPO local subject.
- Create a Better Auth session for an already accepted AREPO pairing flow.
- Return only safe user/session references needed by AREPO sidecar
  authorization state.
- Support focused wrapper regression tests for session lookup, revoke-current,
  revoke-all, and expiry behavior.

Forbidden operations:

- Direct token signing.
- Returning raw session tokens.
- Returning raw cookies or `Set-Cookie` values.
- Reading or logging `Authorization`, `Cookie`, or `Set-Cookie` header values.
- Arbitrary `internalAdapter` calls.
- Arbitrary database mutation.
- Route authorization decisions inside Better Auth plugin code.
- Frontend-provided permission state.
- Vault/node permission storage in Better Auth cookies, session metadata, or
  frontend-controlled data.
- Treating raw Better Auth session objects as AREPO authorization policy.
- Any additional unsupported Better Auth internal API.

## Upgrade Policy

Before live browser-auth activation, AREPO must:

- Pin the Better Auth version used by browser auth.
- Review Better Auth release notes before upgrades.
- Treat plugin context or `internalAdapter` contract changes as activation
  blockers.
- Run the full isolated proof suite and inactive-boundary tests after every
  Better Auth upgrade.
- Keep `express-session` or a comparable server-side session core as the backup
  path if this risk becomes unacceptable.

## Regression Requirements

Future implementation tests must prove:

- The wrapper allows only named operations.
- The wrapper never returns raw session tokens.
- The wrapper sanitizes errors.
- The plugin boundary blocks before wrapper calls when the activation gate
  denies execution.
- Inactive-boundary tests forbid live imports until deliberate activation.
- Signed-cookie lookup still works in isolation.
- Direct raw token cookie injection remains rejected.
- Revoke-current and revoke-all remain targeted.
- AREPO-owned CSRF is still required before unsafe AREPO mutations.

## Ownership

Better Auth remains responsible for session and cookie mechanics, session
records, expiry, and revocation primitives.

AREPO remains responsible for activation gates, route contracts, pairing UX,
route permissions, audit policy, inactive-boundary tests, hybrid sidecar
authorization state, and CSRF policy for AREPO API routes.

## Remaining Blockers

- Internal-adapter wrapper implementation.
- Production AREPO Better Auth plugin implementation.
- AREPO-owned sidecar authorization store implementation.
- Expired-session pruning policy.
- Backup/restore session-state policy.
- Live AREPO-owned CSRF integration behind activation gates.
- Better Auth output/hook sanitization wrappers for audit and status.
- Deliberate disabled-live mounting design behind activation gates and
  inactive-boundary tests.
