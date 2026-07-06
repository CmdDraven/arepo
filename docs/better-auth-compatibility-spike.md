# Better Auth Compatibility Spike

This spike maps AREPO's browser-auth requirements to Better Auth without
mounting handlers, issuing live cookies, accepting cookies, or changing
bearer-token protected mode.

The structured companion model is in:

- `backend/browserAuthFoundationRequirements.ts`
- `backend/betterAuthCompatibilityModel.ts`

Those files are dependency-free and planning-only.

Isolated proofs:

- `better-auth@1.6.23` is installed for an isolated backend proof only.
- `backend/betterAuthDependencyProof.ts` imports Better Auth in a test-only
  boundary.
- `backend/betterAuthAppDataStoreProof.ts` proves a local app-data SQLite
  store using Node's built-in `node:sqlite`; no additional database dependency
  was added.
- `backend/betterAuthPairingSessionAdapterProof.ts` proves that an AREPO
  pairing completion can create an internal Better Auth user/session in an
  isolated proof path, while recording the remaining public API and cookie
  adapter blockers.
- `backend/betterAuthRouteRequestAdapterProof.ts` proves that AREPO
  routeRequest-style input can be adapted to Better Auth's standard
  `Request`/`Response` handler boundary and that handler responses can be
  wrapped with redacted cookie/body metadata.
- `backend/betterAuthCsrfOwnershipProof.ts` proves Better Auth's own unsafe
  auth endpoints enforce trusted-origin behavior, but does not provide a
  supported CSRF token issue/verify API for arbitrary AREPO API routes.
- `backend/browserAuthCsrfRequestAdapterProof.ts` proves an AREPO-owned,
  unmounted CSRF request adapter shape for future cookie-backed AREPO API
  routes. It consumes AREPO's inert CSRF token store/verifier, classifies safe
  versus unsafe methods, validates token id plus secret, binds tokens to the
  expected browser session id, applies supplemental Origin/Referer checks, and
  returns sanitized test-only allow/deny results.
- `backend/betterAuthSessionTokenStoragePolicy.ts` records that Better Auth's
  stored `session.token` model is accepted with conditions only inside
  sensitive AREPO app data outside vault roots.
- No Better Auth handler is mounted in `backend/server.ts`.
- No live route emits Better Auth cookies or accepts Better Auth cookies as
  credentials.

## Summary

Recommendation: Better Auth remains the preferred foundation target, but live
browser auth must stay inactive until route adapter, cookie issuance, CSRF, and
expiry semantics are proven through supported integration boundaries.

Reasoning:

- It is TypeScript-first and framework-agnostic.
- It exposes standard `Request`/`Response` handler integration, which is closer
  to AREPO's custom Node router than Express-only middleware.
- It has documented session management, database-backed sessions, session
  expiry/freshness settings, cookie configuration, and framework helpers.
- It appears capable of coexisting with AREPO's custom pairing, activation,
  route-contract, audit, and inactive-boundary infrastructure.

The spike does not prove that Better Auth should be activated. The current
isolated proofs strengthen the recommendation: app-data SQLite storage works
without a new database dependency, and internal pairing-to-session creation is
possible. AREPO's routeRequest-style shape can be adapted to Better Auth's
standard handler boundary, and signed cookie issuance/clearing can be observed
and redacted through that boundary. The CSRF ownership proof establishes that
AREPO should own CSRF validation for unsafe cookie-authenticated AREPO API
routes while Better Auth owns protection for its own auth endpoints. The
AREPO-owned CSRF request adapter proof now validates the future request-side
shape for unsafe AREPO mutations, but it remains unmounted and not live.
Public/supported pairing-session attachment, pairing-driven cookie delivery,
and deterministic expiry proof remain unresolved. The Better Auth
`session.token` storage policy is accepted with conditions, but live activation
is still blocked until the remaining proofs and mitigations are complete.

## Requirement Fit

| Requirement                     | Fit               | Owner       | Notes                                                                                                                                                                                |
| ------------------------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local-first default             | likely-compatible | shared      | Must prove disabled auth and startup defaults stay unchanged.                                                                                                                        |
| Localhost-only default          | likely-compatible | shared      | Trusted origins and cookie policy must stay localhost-scoped until activation.                                                                                                       |
| Single-node self-hosting        | needs-spike       | shared      | HTTPS, Secure cookies, and non-local binding policy remain unresolved.                                                                                                               |
| No mandatory cloud identity     | likely-compatible | Better Auth | Better Auth supports local methods, but AREPO must avoid unwanted signup/provider UX.                                                                                                |
| Server-side session semantics   | compatible        | Better Auth | App-data SQLite storage works in isolation through Node `node:sqlite`; `session.token` storage is accepted with app-data, vault-exclusion, reset, backup, and corruption conditions. |
| Secure cookie issuance/clearing | likely-compatible | Better Auth | Handler-boundary proof observed signed cookie issuance and clearing metadata with redaction; pairing-driven issuance remains unresolved and live emission remains forbidden.         |
| Session expiry                  | needs-spike       | Better Auth | Expiry/updateAge are configurable, but the app-data proof did not prove deterministic expired-session filtering.                                                                     |
| Session rotation                | unknown           | shared      | Renewal/rotation policy needs a deliberate AREPO decision.                                                                                                                           |
| Logout                          | likely-compatible | Better Auth | Isolated proof observed sign-out clearing behavior; route adapter/live semantics remain unmounted.                                                                                   |
| Revoke-current                  | likely-compatible | Better Auth | Handler-boundary proof shows sign-out/revocation invalidates a signed-cookie session; production route policy remains unmounted.                                                     |
| Revoke-all                      | likely-compatible | Better Auth | Isolated proof deleted all sessions for one internal user; local-operator mapping still needs proof.                                                                                 |
| No frontend secret storage      | likely-compatible | shared      | Cookie-backed flow can work if AREPO avoids durable frontend secrets.                                                                                                                |
| Explicit pairing flow           | likely-compatible | shared      | Pairing remains custom; internal pairing-to-session creation works; public/supported session attachment remains unproven.                                                            |
| Route contract model            | compatible        | AREPO       | Contracts can wrap any foundation.                                                                                                                                                   |
| Activation gate/preflight       | compatible        | AREPO       | Gates must block mounting until activation.                                                                                                                                          |
| Audit without secrets           | needs-spike       | AREPO       | Better Auth outputs and hooks must be sanitized before audit/status/logging.                                                                                                         |
| CSRF ownership                  | compatible        | AREPO       | Better Auth protects its own auth endpoints; AREPO owns CSRF for arbitrary unsafe AREPO API routes. The unmounted adapter proof validates token/session/origin request checks.       |
| Inactive-boundary regression    | compatible        | AREPO       | Tests can forbid imports and mounting until activation.                                                                                                                              |
| Bearer-token migration          | likely-compatible | shared      | Coexistence should work if routes and principals are kept separate.                                                                                                                  |
| Custom Node router integration  | compatible        | shared      | Isolated adapter proof converts AREPO routeRequest-style input to standard Request and wraps Better Auth Response safely.                                                            |

## Open Questions

- Can AREPO create or attach a Better Auth session from a local pairing proof
  through a public/supported Better Auth path without enabling normal
  username/password or social signup UX?
- How should AREPO implement the accepted app-data storage mitigations for
  Better Auth's session table before live activation?
- Should the isolated routeRequest adapter become the production adapter shape
  once activation gates allow mounting, or does it need a narrower interface?
- Can cookie `Path`, `SameSite`, `Secure`, `HttpOnly`, names, clearing headers,
  and trusted origins match AREPO policy exactly?
- Where should AREPO mount its future CSRF guard relative to browser-session
  authentication, route authorization, audit, and mutation handlers?
- How should the unmounted CSRF adapter proof be adapted to the eventual
  cookie-backed route pipeline without becoming a parallel authorization
  system?
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
- Better Auth can run migrations against a local SQLite file under AREPO app
  data at `app-data/auth/better-auth.sqlite` using Node's built-in
  `node:sqlite`; no new database adapter dependency was added.
- Better Auth migrations create `user`, `session`, `account`, and
  `verification` tables. AREPO must still decide schema ownership, migration,
  backup, reset, and corruption handling policy.
- App-data session state persists across a database close/reopen cycle.
- The app-data proof can look up a session, revoke one current session, and
  revoke all sessions for one internal Better Auth user.
- The pairing-session proof can create a Better Auth user/session after an
  isolated AREPO pairing acceptance without enabling username/password, OAuth,
  social login, or frontend credential storage.
- The pairing-session proof redacts observed sign-out cookie-clearing metadata
  and keeps Better Auth output out of live routes.
- The routeRequest adapter proof converts method, path, query, headers, and
  JSON body into standard `Request` input and captures Better Auth `Response`
  output without Express.
- The adapter proof observes signed `arepo_session` cookie issuance through
  Better Auth's normal email sign-up handler and redacts cookie values in proof
  output.
- The adapter proof observes sign-out cookie clearing and wraps `Set-Cookie`
  data as metadata only: cookie name, path, SameSite, HttpOnly, Secure,
  Max-Age presence/value, classification, and `valueRedacted: true`.
- Session lookup works through Better Auth's signed cookie and handler
  boundary.
- Sign-out/revocation invalidates the signed-cookie session through the handler
  boundary.
- Direct raw token cookie injection remains rejected through the adapter
  boundary.
- Better Auth rejects unsafe signed-cookie auth endpoint requests with missing
  or untrusted Origin and allows the trusted local origin.
- The CSRF ownership proof did not find a supported Better Auth CSRF token
  issue/verify API for arbitrary AREPO routeRequest handlers.
- Future cookie-backed AREPO POST, PUT, PATCH, DELETE, logout, revoke, config,
  vault, pairing, and session mutations require AREPO-owned CSRF validation
  before mutation.
- SameSite remains useful but insufficient by itself, and Origin/Referer checks
  are supplemental rather than replacements for CSRF token validation.
- AREPO's inert CSRF token store/verifier primitives fit the likely ownership
  model and keep raw tokens and hashes out of diagnostics.
- The AREPO-owned CSRF request adapter proof classifies safe methods
  separately, requires CSRF for unsafe cookie-backed route shapes, denies
  missing, malformed, wrong, expired, revoked, consumed, and session-mismatched
  tokens with sanitized reason codes, and allows a valid token/session match
  only as a test-only proof result.
- The CSRF request adapter proof applies Origin/Referer checks as supplemental
  controls and never treats SameSite as sufficient by itself.
- Better Auth's stored `session.token` model is accepted with conditions inside
  AREPO app data. The auth database is sensitive generated app state, must live
  outside vault roots, must be excluded from vault sync/export, and reset or
  corruption must fail closed and revoke browser sessions.

Still unresolved:

- Public/supported creation or attachment of a Better Auth session after AREPO
  local pairing. The current proof uses Better Auth internal adapter behavior.
- Deterministic expiry tests through a supported request/session adapter. The
  app-data proof did not prove expired-session filtering through the internal
  adapter path.
- Implementation of the accepted app-data storage mitigations for Better Auth's
  `session.token` column.
- Signed cookie issuance from the AREPO pairing-session path. The adapter proof
  observed signed cookie issuance only through Better Auth's normal email
  sign-up handler, so pairing-driven cookie issuance still needs a supported
  path or an explicit internal-boundary decision.
- AREPO-specific scope metadata such as vault permission posture. The proof did
  not establish arbitrary session metadata support without schema/authorization
  design.
- Live integration of AREPO-owned CSRF validation into the future cookie-backed
  route pipeline. The adapter proof is unmounted and does not validate live
  requests.
- Sanitized wrapping of Better Auth hooks/outputs for AREPO audit/status beyond
  the response-envelope proof.

## Adoption Blockers

- `public-pairing-to-session-api-unproven`
- `deterministic-expiry-adapter-proof-needed`
- `better-auth-session-token-storage-mitigations-needed`
- `pairing-cookie-issuance-path-unproven`
- `arepo-owned-csrf-live-integration-blocked`
- `better-auth-output-sanitization-unproven`
- `coexistence-routing-proof-needed`
- `mounting-gate-tests-needed`

## Required Proof Tests For The Next Security Spike

A later isolated security proof should test, outside `server.ts`:

- Create or attach a session from an AREPO test-only pairing proof through a
  supported public path, or document deliberate acceptance of an internal
  adapter boundary.
- Prove signed cookie issuance from that pairing path, or keep it blocked.
- Verify expiry behavior with deterministic test time where possible.
- Revoke the current session and revoke all sessions for the local
  operator/principal through the accepted adapter path.
- Implement the accepted Better Auth `session.token` app-data storage
  mitigations before any live activation.
- Adapt the AREPO-owned CSRF request adapter proof into a disabled future route
  pipeline only after storage policy, session scope, and activation gates are
  settled.
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

Run a deterministic expiry proof through the accepted Better Auth
Request/Response or app-data session boundary. The storage model is now accepted
with conditions, so the next highest-risk behavior is whether expired Better
Auth sessions are rejected predictably through the same boundary AREPO would
wrap later. That slice must remain isolated, must not mount Better Auth or
browser auth, and must not emit live cookies or accept cookie credentials in
live authorization.
