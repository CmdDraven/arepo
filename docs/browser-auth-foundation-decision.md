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
  Express unless explicitly chosen. The isolated proof confirms the handler
  shape exists; a router adapter is still needed.
- Session storage can live in AREPO app data, preferably with a deliberate
  local SQLite strategy. The isolated app-data proof now confirms Better Auth
  can run migrations and persist sessions in `app-data/auth/better-auth.sqlite`
  through Node's built-in `node:sqlite`; AREPO still needs schema ownership,
  backup/reset, corruption handling, and stored session-token policy decisions.
- Cookie names, `HttpOnly`, `SameSite`, `Secure`, `Path`, clearing behavior,
  and trusted origins can match AREPO policy.
- Local pairing can create or attach a browser session without normal
  username/password/social signup becoming the default UX. The isolated
  pairing-session proof can create an internal Better Auth user/session after
  AREPO pairing acceptance, but a public/supported Better Auth session
  attachment path remains unproven.
- Revoke-current and revoke-all semantics are possible without exposing session
  token material. The isolated proof exercised these through Better Auth
  internals; the production adapter path remains unproven.
- Deterministic expiry must be proven through an accepted request/session
  adapter. The app-data proof can configure expiry/updateAge, but did not prove
  expired-session filtering through the internal adapter path.
- Raw token cookie injection remains rejected in the isolated proof, so signed
  cookie issuance/clearing must be handled by a deliberate response adapter.
- CSRF ownership is explicit before cookie-authenticated unsafe routes are live.
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

Run an isolated Better Auth `routeRequest()` to standard `Request`/`Response`
adapter proof outside live server paths. It should prove signed cookie
issuance/clearing observation, sanitized response wrapping, session lookup,
revocation, and expiry behavior through the adapter boundary without mounting
live routes or changing protected-mode authorization.
