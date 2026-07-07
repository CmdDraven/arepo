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
- `backend/betterAuthDeterministicExpiryProof.ts` proves deterministic expiry
  behavior through isolated app-data and Request/Response signed-cookie
  boundaries without long real-time waits.
- `backend/betterAuthPairingCookieIssuanceProof.ts` proves that an AREPO
  pairing-created Better Auth session can be accepted through a signed
  `arepo_session` cookie in isolation. The proof uses Better Auth's internal
  adapter plus exported signing primitive, so production activation remains
  blocked on a supported session/cookie response boundary.
- `backend/betterAuthSessionScopeMetadataProof.ts` proves the preferred hybrid
  metadata model: Better Auth owns session/cookie mechanics, while AREPO owns
  local operator identity, device-label policy, route authorization, and
  vault/node permission posture in app-data sidecar state keyed by redacted
  Better Auth user/session references.
- `backend/betterAuthPairingCookieBoundaryProof.ts` proves that a public Better
  Auth plugin endpoint can model AREPO pairing completion, create/reuse the
  Better Auth local subject, create a session, and emit a signed
  `arepo_session` cookie through Better Auth `Response` behavior. The path
  uses Better Auth's endpoint/plugin APIs and public `setSessionCookie` helper,
  but still uses `ctx.context.internalAdapter` inside the plugin, matching
  Better Auth's own official plugin pattern.
- `backend/betterAuthArepoPluginBoundaryProof.ts` turns that tiny plugin proof
  into a production-shaped, still-unmounted AREPO plugin boundary proof. It
  checks the activation gate and route contract before session creation,
  creates sidecar authorization references only after test-only allowance,
  emits sanitized audit-like events, records CSRF sequencing points, observes
  only redacted cookie metadata, and classifies `ctx.context.internalAdapter`
  as official-plugin-pattern internal access that still needs a production
  wrapper implementation.
- `backend/betterAuthInternalAdapterRiskDecision.ts` records that AREPO accepts
  `ctx.context.internalAdapter` only as official-plugin-pattern internal access
  behind a narrow wrapper inside the future Better Auth plugin boundary. Direct
  token signing, raw token exposure, route authorization decisions, arbitrary
  adapter calls, and vault/node permission storage in Better Auth cookies or
  metadata remain forbidden.
- `backend/betterAuthInternalAdapterWrapper.ts` now provides the disabled-live
  narrow wrapper boundary. It exposes only named pairing/session operations,
  returns redacted references, and remains unmounted from live server/auth
  paths.
- `backend/browserAuthDisabledLiveAdapter.ts` now provides the inert
  disabled-live route adapter skeleton. It checks the activation gate and
  returns sanitized inactive results while remaining unmounted.
- `backend/betterAuthRenewalUpdateAgePolicy.ts` records the bounded
  renewal/update-age decision: future browser sessions use a 30-minute max age
  and 5-minute Better Auth `updateAge`; renewal is freshness only, never new
  authorization, and must be blocked when AREPO sidecar authorization is
  missing, revoked, stale, or mismatched.
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
Pairing-driven signed-cookie lookup is now proven in isolation through two
paths: the earlier internal-adapter/signing proof, and the newer public plugin
endpoint proof that emits Better Auth's signed cookie through handler
`Response` behavior. The Better Auth `session.token` storage policy is
accepted with conditions, and deterministic expiry is proven in isolation. The
session-scope metadata proof selects a hybrid model that keeps authorization
state AREPO-owned and treats Better Auth user/session ids as references only.
The production-shaped AREPO plugin-boundary proof now models activation-gate
ordering, sidecar authorization references, CSRF sequencing, and sanitized
audit output in isolation. The internal-adapter risk decision accepts the
Better Auth plugin-context adapter pattern with conditions, but production
still needs the wrapper implementation and upgrade policy. The renewal/update-
age policy accepts bounded freshness renewal while keeping AREPO-owned sidecar
authorization authoritative.
Live activation is still blocked until the remaining proofs and mitigations are
complete.

## Requirement Fit

| Requirement                     | Fit               | Owner       | Notes                                                                                                                                                                                                                    |
| ------------------------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local-first default             | likely-compatible | shared      | Must prove disabled auth and startup defaults stay unchanged.                                                                                                                                                            |
| Localhost-only default          | likely-compatible | shared      | Trusted origins and cookie policy must stay localhost-scoped until activation.                                                                                                                                           |
| Single-node self-hosting        | needs-spike       | shared      | HTTPS, Secure cookies, and non-local binding policy remain unresolved.                                                                                                                                                   |
| No mandatory cloud identity     | likely-compatible | Better Auth | Better Auth supports local methods, but AREPO must avoid unwanted signup/provider UX.                                                                                                                                    |
| Server-side session semantics   | compatible        | Better Auth | App-data SQLite storage works in isolation through Node `node:sqlite`; `session.token` storage is accepted with app-data, vault-exclusion, reset, backup, and corruption conditions.                                     |
| Secure cookie issuance/clearing | likely-compatible | Better Auth | Handler-boundary proof observed signed cookie issuance and clearing metadata with redaction; production-shaped plugin-boundary proof emits pairing-driven signed cookies in isolation.                                   |
| Session expiry                  | compatible        | Better Auth | Deterministic expiry is proven through app-data active-session filtering and signed-cookie `get-session` rejection after an isolated expiry override; renewal and sidecar pruning policies are accepted with conditions. |
| Session rotation                | unknown           | shared      | Renewal/rotation policy needs a deliberate AREPO decision.                                                                                                                                                               |
| Logout                          | likely-compatible | Better Auth | Isolated proof observed sign-out clearing behavior; route adapter/live semantics remain unmounted.                                                                                                                       |
| Revoke-current                  | likely-compatible | Better Auth | Handler-boundary proof shows sign-out/revocation invalidates a signed-cookie session; production route policy remains unmounted.                                                                                         |
| Revoke-all                      | compatible        | Better Auth | Isolated proof deletes all sessions for one Better Auth subject while preserving another subject; AREPO still needs sidecar subject policy.                                                                              |
| No frontend secret storage      | likely-compatible | shared      | Cookie-backed flow can work if AREPO avoids durable frontend secrets.                                                                                                                                                    |
| Explicit pairing flow           | likely-compatible | shared      | Pairing remains custom; a production-shaped public Better Auth plugin endpoint can emit a signed cookie, create sidecar references, and stay behind the activation gate in isolation.                                    |
| Route contract model            | compatible        | AREPO       | Contracts can wrap any foundation.                                                                                                                                                                                       |
| Activation gate/preflight       | compatible        | AREPO       | Gates must block mounting until activation.                                                                                                                                                                              |
| Audit without secrets           | likely-compatible | AREPO       | The plugin-boundary proof emits sanitized audit-like events and redacted references; production hook/output wrapping remains.                                                                                            |
| CSRF ownership                  | compatible        | AREPO       | Better Auth protects its own auth endpoints; AREPO owns CSRF for arbitrary unsafe AREPO API routes. The unmounted adapter proof validates token/session/origin request checks.                                           |
| Inactive-boundary regression    | compatible        | AREPO       | Tests can forbid imports and mounting until activation.                                                                                                                                                                  |
| Bearer-token migration          | likely-compatible | shared      | Coexistence should work if Better Auth user/session references map to AREPO-owned authorization state without changing bearer APIs.                                                                                      |
| Custom Node router integration  | compatible        | shared      | Isolated adapter proof converts AREPO routeRequest-style input to standard Request and wraps Better Auth Response safely.                                                                                                |

## Open Questions

- Should AREPO accept Better Auth plugin endpoint use of
  `ctx.context.internalAdapter`, matching Better Auth's own official plugin
  pattern, for production pairing-session issuance?
- How should AREPO implement the accepted app-data storage mitigations for
  Better Auth's session table before live activation?
- Should the isolated routeRequest adapter become the production adapter shape
  once activation gates allow mounting, or does it need a narrower interface?
- Can cookie `Path`, `SameSite`, `Secure`, `HttpOnly`, names, clearing headers,
  and trusted origins match AREPO policy exactly?
- What sidecar schema should map Better Auth user/session references to AREPO
  local operator subject, device labels, and route/vault permission posture?
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
- The deterministic expiry proof configures a bounded session lifetime,
  observes safe expiry metadata, excludes expired sessions from active app-data
  lookup, forces an isolated session expiry without sleeping, and verifies
  Better Auth's signed-cookie `get-session` path returns null and emits
  redacted cookie-clearing metadata for the expired session.
- The pairing-cookie proof creates a Better Auth user/session after isolated
  AREPO pairing acceptance, signs the session token with Better Auth's exported
  crypto primitive, and verifies that Better Auth accepts the resulting
  `arepo_session` cookie for isolated session lookup.
- Direct raw token cookie injection remains rejected for the pairing-issued
  session.
- Sign-out invalidates the pairing-issued signed-cookie session, and the
  deterministic expiry behavior also applies to the pairing-issued signed
  cookie.
- The pairing-cookie proof does not enable username/password, OAuth, social
  login, email login, frontend credential storage, login UI, live routes, or
  live cookies.
- The session-scope metadata proof confirms Better Auth session lookup exposes
  stable user/session references, sanitized device hints can be retrieved and
  survive app-data DB reopen, revoke-current and revoke-all still target the
  right sessions, and vault/node permission posture should remain AREPO-owned
  rather than cookie-derived.
- The pairing-cookie boundary proof confirms a public Better Auth plugin
  endpoint can model AREPO pairing acceptance, avoid normal login UX, call
  Better Auth's public `setSessionCookie` helper, emit a signed `arepo_session`
  cookie through response behavior, support signed-cookie lookup, reject direct
  raw token cookie injection, and preserve sign-out, revoke-current,
  revoke-all, and expiry semantics in isolation.
- The production-shaped AREPO plugin-boundary proof confirms the activation
  gate blocks by default before Better Auth session creation, `setSessionCookie`,
  sidecar authorization reference creation, or success-audit emission. With an
  explicit test-only allowance, the proof issues a signed cookie through the
  plugin boundary, creates redacted sidecar authorization references, preserves
  sign-out/revoke-current/revoke-all/expiry behavior, records CSRF sequencing
  points, and keeps all cookie/session material redacted.

Accepted with conditions:

- `ctx.context.internalAdapter` may be used only inside the future Better Auth
  plugin boundary through a narrow AREPO wrapper.
- The wrapper may find/create the local subject user, create a session for an
  accepted AREPO pairing flow, return redacted Better Auth user/session
  references, and support focused regression checks for lookup, revocation, and
  expiry.
- The wrapper must never return raw session tokens, raw cookies, auth headers,
  cookie headers, `Set-Cookie` values, route authorization decisions, or
  frontend-provided permission state.
- Better Auth upgrades must be pinned, reviewed, and tested before browser auth
  activation.
- Renewal uses a 30-minute session max age and 5-minute `updateAge`, extends
  freshness only, and never grants authorization.
- Renewal must not run before CSRF validation on unsafe cookie-backed AREPO
  requests.

Still unresolved:

- Production AREPO Better Auth plugin implementation. The production-shaped
  proof remains isolated and unmounted; live activation still needs the real
  plugin, persisted sidecar authorization, CSRF integration, audit/status
  wrappers, and inactive-boundary coverage.
- Internal-adapter wrapper implementation. The risk is accepted with
  conditions, but no production wrapper is mounted or implemented yet.
- Implementation of the accepted app-data storage mitigations for Better Auth's
  `session.token` column.
- Expired-session pruning and backup/restore session-state policy are now
  accepted with conditions; implementation still needs sidecar state and an
  auth-state epoch before live activation.
- AREPO-owned sidecar authorization store implementation. The metadata proof
  selects this model but does not create the production sidecar schema.
- Live integration of AREPO-owned CSRF validation into the future cookie-backed
  route pipeline. The adapter proof is unmounted and does not validate live
  requests.
- Sanitized wrapping of Better Auth hooks/outputs for production AREPO
  audit/status beyond the isolated proof events.

## Adoption Blockers

- `production-arepo-better-auth-plugin-needed`
- `arepo-sidecar-authorization-store-needed`
- `better-auth-session-token-storage-mitigations-needed`
- `arepo-owned-csrf-live-integration-blocked`
- `better-auth-output-sanitization-wrapper-needed`
- `coexistence-routing-proof-needed`
- `mounting-gate-tests-needed`

## Required Proof Tests For Later Security Spikes

Later isolated security work should test, outside `server.ts`:

- Prove disabled-live route mounting can preserve the existing inactive route
  behavior before connecting the skeleton to `server.ts`.
- Revoke the current session and revoke all sessions for the local
  operator/principal through the accepted adapter path.
- Implement the accepted Better Auth `session.token` app-data storage
  mitigations before any live activation.
- Implement the AREPO-owned sidecar authorization state that maps Better Auth
  references to local operator and route/vault permission posture.
- Adapt the AREPO-owned CSRF request adapter proof into a disabled future route
  pipeline only after storage policy, sidecar authorization, and activation
  gates are settled.
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

Run a disabled-live route mounting proof. The internal-adapter wrapper and
inert disabled-live adapter skeleton now exist, so the next highest-risk
integration boundary is proving that `server.ts` can delegate the existing
browser-auth stubs to the inert adapter without changing responses, emitting
cookies, or accepting cookie credentials. Keep Better Auth active handlers
unmounted and live browser auth inactive.
