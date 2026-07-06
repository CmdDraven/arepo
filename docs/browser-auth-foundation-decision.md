# Browser Auth Foundation Decision

Status: accepted for isolated compatibility work. Better Auth is installed for
isolated backend proofs only. This is not a live integration decision.

## Decision

AREPO will not hand-roll the final production browser-auth/session mechanism by
default.

Protected mode remains bearer-token based until a mature session foundation is
selected, proven in isolation, and deliberately integrated behind AREPO's
activation gates. Browser sessions, cookies, CSRF tokens, pairing codes, login
UI, and frontend token/session storage remain inactive.

Better Auth is selected as the preferred target for isolated compatibility and
adapter/database spikes. `express-session` or a comparable server-side session
core remains the backup path. OIDC/OAuth remains future optional
external-identity work, not the immediate local-first default.

## Rationale

AREPO already owns the local-first constraints that are specific to the
application:

- `auth.mode` compatibility and protected-mode fail-closed posture.
- Route permissions and vault/node authorization policy.
- Local bearer-token bootstrap and operator workflows.
- Pairing UX and operator consent.
- Activation config policy, preflight blockers, and activation gates.
- Browser-auth route contracts and inactive stubs.
- Sanitized audit/status/logging policy.
- Reduced anonymous diagnostics.
- Inactive-boundary regression tests.

Those pieces should remain custom. Session-cookie mechanics, session expiry,
cookie handling, revocation plumbing, and framework compatibility should be
delegated to a mature auth/session foundation where possible.

The existing browser-auth dark-path code is therefore acceptance criteria and
safety scaffolding. It is not a decision to turn AREPO's test primitives into
the production browser-auth engine.

## Better Auth Direction

Better Auth is the preferred compatibility target because its current docs
describe:

- TypeScript-first, framework-agnostic authentication.
- Standard `Request`/`Response` handler integration.
- Node and Express helpers.
- TanStack Start integration points.
- Database-backed session records and stateless mode.
- Session expiry/freshness configuration.
- Session management APIs.
- Configurable cookies, secure-cookie behavior, trusted origins, and cookie
  naming.

Those properties appear closest to AREPO's current custom Node router and future
local browser-session needs, but they must be proven in a dependency spike
before any live integration.

## Backup Direction

If Better Auth proves too broad, too account-centric, or too difficult to keep
inside AREPO's local-first activation boundary, use a smaller server-side
session foundation such as `express-session` plus AREPO-owned CSRF, audit,
pairing, and route-permission integration.

That backup likely requires either adopting Express for backend routing or
building a carefully bounded adapter around AREPO's current `routeRequest()`
shape.

## Rejected For Immediate Activation

- Fully custom production browser auth: too much avoidable risk in cookie,
  CSRF, revocation, session renewal, and browser edge cases.
- Auth.js as the first local-only default: useful for provider/OIDC scenarios,
  but less directly aligned with AREPO's custom router and pairing-first path
  than Better Auth.
- OIDC/OAuth as the default local browser path: useful later for external
  identity, but too operationally heavy for AREPO's local-first default.

## What Must Be Proven Before Live Browser Auth

- Better Auth remains fully unmounted until activation. The isolated dependency
  proof currently satisfies this boundary.
- Better Auth can coexist with bearer-token protected mode. The isolated proof
  did not change bearer-token behavior.
- AREPO can integrate through standard `Request`/`Response` without adopting
  Express unless explicitly chosen. The isolated routeRequest adapter proof now
  confirms AREPO-style method/path/query/header/body input can become a
  standard `Request`, and Better Auth `Response` output can be wrapped with
  redacted cookie/body metadata.
- Session storage can live in AREPO app data, preferably with a deliberate
  local SQLite strategy. The isolated app-data proof now confirms Better Auth
  can run migrations and persist sessions in `app-data/auth/better-auth.sqlite`
  through Node's built-in `node:sqlite`. The
  [Better Auth Session Token Storage Policy](better-auth-session-token-storage-policy.md)
  accepts Better Auth's `session.token` storage model with conditions: the auth
  database is sensitive generated app state, must live outside vault roots, must
  be excluded from vault sync/export, and reset/corruption/backup behavior must
  be explicit.
- Cookie names, `HttpOnly`, `SameSite`, `Secure`, `Path`, clearing behavior,
  and trusted origins can match AREPO policy.
- Local pairing can create or attach a browser session without normal
  username/password/social signup becoming the default UX. The isolated
  pairing-cookie proof can create an internal Better Auth user/session after
  AREPO pairing acceptance and make Better Auth accept a signed
  `arepo_session` cookie for lookup, but it uses Better Auth's internal adapter
  plus exported signing. A public/supported session and cookie response
  boundary remains unproven.
- Revoke-current and revoke-all semantics are possible without exposing session
  token material. The isolated proof exercised these through Better Auth
  internals; the production adapter path remains unproven.
- Deterministic expiry must be proven through an accepted request/session
  adapter. The isolated deterministic expiry proof now confirms active-session
  filtering in app data and signed-cookie `get-session` rejection after an
  isolated expiry override, without slow wall-clock waits. AREPO still needs
  renewal/update-age values, expired-session pruning policy, and backup/restore
  session-state policy before activation.
- Raw token cookie injection remains rejected in the isolated proof. Signed
  cookie issuance and clearing are observable through Better Auth's normal
  handler routes; pairing-driven signed-cookie lookup is proven only through an
  isolated internal proof path.
- CSRF ownership is explicit before cookie-authenticated unsafe routes are live.
  The isolated CSRF ownership proof shows Better Auth protects its own auth
  endpoints with trusted-origin behavior, but AREPO should own CSRF validation
  for arbitrary unsafe AREPO API routes.
- The AREPO-owned CSRF request adapter shape is proven before live cookie-backed
  AREPO mutations exist. The unmounted proof now consumes AREPO's inert CSRF
  token store/verifier, requires CSRF for unsafe route shapes, binds tokens to
  the expected browser session id, applies supplemental Origin/Referer checks,
  treats SameSite as insufficient by itself, and returns sanitized test-only
  allow/deny results.
- Better Auth outputs can be wrapped so audit/status/logging never leak
  secrets.
- Inactive-boundary regression tests can forbid accidental mounting until a
  deliberate activation phase.

## Forbidden Until Activation

- Mounting Better Auth in `backend/server.ts`.
- Accepting cookies as live credentials.
- Issuing live `Set-Cookie` headers.
- Parsing cookies for live request authorization.
- Validating CSRF in live request authorization.
- Adding browser login UI.
- Adding frontend bearer-token or session-token storage.
- Changing bearer-token protected-mode behavior.
- Claiming LAN, reverse-proxy, or internet safety.

## Next Slice

Run an isolated session-scope metadata proof. Storage policy, deterministic
expiry, CSRF ownership, routeRequest adaptation, and pairing-created signed
cookie lookup now have isolated answers. The next blocker is deciding how
AREPO's local operator subject, device label, and future permission posture map
to Better Auth user/session records or AREPO-owned authorization state. The
slice must remain outside live server paths and must not mount browser auth.
