# Better Auth Compatibility Spike

This spike maps AREPO's browser-auth requirements to Better Auth without
mounting handlers, issuing live cookies, accepting cookies, or changing
bearer-token protected mode.

The structured companion model is in:

- `backend/browserAuthFoundationRequirements.ts`
- `backend/betterAuthCompatibilityModel.ts`

Those files are dependency-free and planning-only.

Follow-up proof:

- `better-auth@1.6.23` is installed for an isolated backend proof only.
- `backend/betterAuthDependencyProof.ts` imports Better Auth in a test-only
  boundary.
- No Better Auth handler is mounted in `backend/server.ts`.
- No live route emits Better Auth cookies or accepts Better Auth cookies as
  credentials.

## Summary

Recommendation: Better Auth remains the preferred target for a real isolated
adapter/database proof.

Reasoning:

- It is TypeScript-first and framework-agnostic.
- It exposes standard `Request`/`Response` handler integration, which is closer
  to AREPO's custom Node router than Express-only middleware.
- It has documented session management, database-backed sessions, session
  expiry/freshness settings, cookie configuration, and framework helpers.
- It appears capable of coexisting with AREPO's custom pairing, activation,
  route-contract, audit, and inactive-boundary infrastructure.

The spike does not prove that Better Auth should be activated. It identifies
what must be proven next. The current isolated dependency proof strengthens the
recommendation but keeps app-data database storage, pairing-to-public-session
attachment, route adapter behavior, and CSRF ownership unresolved.

## Requirement Fit

| Requirement                     | Fit               | Owner       | Notes                                                                                                                         |
| ------------------------------- | ----------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Local-first default             | likely-compatible | shared      | Must prove disabled auth and startup defaults stay unchanged.                                                                 |
| Localhost-only default          | likely-compatible | shared      | Trusted origins and cookie policy must stay localhost-scoped until activation.                                                |
| Single-node self-hosting        | needs-spike       | shared      | HTTPS, Secure cookies, and non-local binding policy remain unresolved.                                                        |
| No mandatory cloud identity     | likely-compatible | Better Auth | Better Auth supports local methods, but AREPO must avoid unwanted signup/provider UX.                                         |
| Server-side session semantics   | likely-compatible | Better Auth | Database-backed sessions appear aligned; app-data storage must be proven.                                                     |
| Secure cookie issuance/clearing | likely-compatible | Better Auth | Isolated proof configured the session cookie name/attributes and observed clearing metadata; live emission remains forbidden. |
| Session expiry                  | compatible        | Better Auth | Isolated proof configured expiry/updateAge; deterministic expiry testing still needs adapter work.                            |
| Session rotation                | unknown           | shared      | Renewal/rotation policy needs a deliberate AREPO decision.                                                                    |
| Logout                          | likely-compatible | Better Auth | Isolated proof observed sign-out clearing behavior; route adapter/live semantics remain unmounted.                            |
| Revoke-current                  | likely-compatible | Better Auth | Isolated proof deleted one internally created session; public API mapping still needs proof.                                  |
| Revoke-all                      | likely-compatible | Better Auth | Isolated proof deleted all sessions for one internal user; local-operator mapping still needs proof.                          |
| No frontend secret storage      | likely-compatible | shared      | Cookie-backed flow can work if AREPO avoids durable frontend secrets.                                                         |
| Explicit pairing flow           | needs-spike       | AREPO       | Pairing remains custom; session creation/attachment must be proven.                                                           |
| Route contract model            | compatible        | AREPO       | Contracts can wrap any foundation.                                                                                            |
| Activation gate/preflight       | compatible        | AREPO       | Gates must block mounting until activation.                                                                                   |
| Audit without secrets           | needs-spike       | AREPO       | Better Auth outputs and hooks must be sanitized before audit/status/logging.                                                  |
| CSRF ownership                  | unknown           | shared      | Must prove whether Better Auth covers AREPO unsafe API routes or AREPO owns CSRF.                                             |
| Inactive-boundary regression    | compatible        | AREPO       | Tests can forbid imports and mounting until activation.                                                                       |
| Bearer-token migration          | likely-compatible | shared      | Coexistence should work if routes and principals are kept separate.                                                           |
| Custom Node router integration  | likely-compatible | shared      | Standard handler support looks promising; adapter behavior must be proven.                                                    |

## Open Questions

- Can AREPO create or attach a Better Auth session from a local pairing proof
  without enabling normal username/password or social signup UX?
- Can the session store live under AREPO app data through SQLite or another
  deliberate local store?
- Can Better Auth route handling be adapted to `routeRequest()` without
  adopting Express?
- Can cookie `Path`, `SameSite`, `Secure`, `HttpOnly`, names, clearing headers,
  and trusted origins match AREPO policy exactly?
- Does Better Auth protect AREPO's arbitrary unsafe API routes from CSRF, or
  must AREPO retain separate CSRF validation?
- Can revoke-current and revoke-all avoid exposing raw session token material?
- Which Better Auth response/hook fields are safe for AREPO audit events?
- Can all Better Auth integration code remain forbidden from live server paths
  until activation?

## Isolated Dependency Proof Results

Passed:

- Better Auth imports and instantiates in AREPO's backend TypeScript build.
- Better Auth can be used through a standard `Request`/`Response` handler
  without Express.
- Better Auth's Node helper exports are available for a later adapter proof.
- The isolated auth instance can configure the planned `arepo_session` cookie
  name, `HttpOnly`, `SameSite=Lax`, local-dev `Secure=false`, `Path=/api`, and
  bounded max age.
- `GET /api/auth/get-session` without a cookie returns a safe null session in
  the isolated proof.
- `POST /api/auth/sign-out` emits cookie-clearing metadata in the isolated
  proof; the proof redacts values and no live route emits those headers.
- Better Auth internals can create a local user/session, look up the session,
  delete one session, and delete all sessions for one internal user.
- Directly placing an internal session token in the configured cookie does not
  authenticate, which confirms a real session-cookie adapter is needed rather
  than raw token injection.

Still unresolved:

- Public/supported creation or attachment of a Better Auth session after AREPO
  local pairing.
- AREPO app-data SQLite or another deliberate local store.
- Deterministic expiry tests through a real adapter.
- CSRF protection for AREPO's own unsafe cookie-authenticated API routes.
- Sanitized wrapping of Better Auth hooks/outputs for AREPO audit/status.
- Final `routeRequest()` to standard `Request`/`Response` adapter behavior.

## Adoption Blockers

- `pairing-to-better-auth-session-unproven`
- `app-data-session-store-unproven`
- `cookie-attribute-proof-missing`
- `csrf-ownership-unresolved`
- `better-auth-output-sanitization-unproven`
- `custom-router-adapter-proof-needed`
- `coexistence-routing-proof-needed`
- `mounting-gate-tests-needed`

## Required Proof Tests For The Next Adapter/Database Spike

A later isolated adapter/database proof should test, outside `server.ts`:

- Create a Better Auth instance with a local app-data database strategy.
- Create or attach a session from an AREPO test-only pairing proof through a
  supported public or deliberately accepted internal adapter path.
- Retrieve a session from a standard `Request` shape.
- Verify expiry behavior with deterministic test time where possible.
- Revoke the current session.
- Revoke all sessions for the local operator/principal.
- Inspect planned `Set-Cookie` headers and confirm AREPO cookie attributes.
- Confirm no raw session token, cookie value, bearer token, authorization
  header, hash, salt, or verifier internals appear in sanitized wrappers.
- Confirm Better Auth remains unmounted and forbidden from live authorization
  paths.

## Risks And Mitigations

- Risk: Better Auth's account model pulls AREPO toward hosted-account UX.
  Mitigation: keep pairing UX AREPO-owned and disable/provider-gate account
  flows until deliberately selected.
- Risk: Better Auth's session store requires schema/migration behavior that is
  too heavy for local-first app data.
  Mitigation: spike SQLite/app-data storage before activation.
- Risk: Better Auth does not cover AREPO's CSRF needs for arbitrary API routes.
  Mitigation: keep AREPO CSRF ownership unresolved until proven; do not mount
  cookie auth without CSRF tests.
- Risk: Integration accidentally emits cookies or accepts cookie credentials.
  Mitigation: extend inactive-boundary tests before any real dependency import.

## Recommended Next Slice

Run an isolated Better Auth app-data database and pairing-session adapter proof.
It may add the smallest necessary local database adapter dependency if selected
explicitly. It must not mount routes, issue live cookies, accept cookie
credentials, validate CSRF in live authorization, add login UI, add frontend
token/session storage, or change bearer-token protected mode.
