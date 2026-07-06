# Browser Session Security Design

This is a Phase 4 design note for future browser-session protected mode. AREPO
now has local bearer-token protected-mode enforcement for API/operator
workflows, documented in
[Protected Mode Operator Workflow](protected-mode-operator-workflow.md). AREPO
does not implement browser sessions, cookies, live CSRF-protected browser
authentication, browser login, pairing UI, or frontend token storage. Protected
mode must not be treated as safe for LAN, reverse-proxy, or internet exposure.
Further custom live browser-auth implementation is paused pending the
[Browser Auth Dependency Evaluation](browser-auth-dependency-evaluation.md).
The existing dark-path scaffolding remains useful as threat-model, route
contract, activation-gate, and acceptance-test infrastructure for whichever
mature auth/session foundation AREPO adopts later.
[Browser Auth Foundation Decision](browser-auth-foundation-decision.md)
selects Better Auth as the preferred isolated compatibility target, with
`express-session` or a comparable server-side session core retained as backup.
`better-auth@1.6.23` is installed for isolated backend proofs only. The proofs
now cover import/handler shape, app-data SQLite storage through Node
`node:sqlite`, internal session lookup/revocation, internal
pairing-to-session feasibility, and pairing-created signed-cookie lookup
through an isolated internal proof path. The routeRequest adapter proof also
shows that AREPO-style request input can reach Better Auth's standard handler
boundary and that handler responses can be wrapped with redacted cookie/body
metadata. They are not mounted, do not emit live cookies, do not accept cookies
as live credentials, and do not change bearer-token protected mode.
The CSRF ownership proof shows Better Auth protects its own unsafe auth
endpoints with trusted-origin behavior, while AREPO should own CSRF validation
for arbitrary unsafe AREPO API routes. AREPO now also has an unmounted
AREPO-owned CSRF request adapter proof that validates token/session/origin
request semantics for future cookie-backed unsafe API routes without enabling
live CSRF enforcement. The Better Auth session-token storage policy accepts the
library-owned `session.token` database model with conditions: storage must stay
in sensitive AREPO app data outside vault roots, reset and corruption must fail
closed, and backups/restores need explicit browser-session warnings. The
deterministic expiry proof shows expired Better Auth sessions can be rejected
predictably through isolated app-data active-session filtering and
Request/Response signed-cookie lookup without slow real-time waits.
The pairing-cookie proof shows sign-out and expiry apply to a pairing-issued
signed-cookie session, but production activation remains blocked because the
proof uses Better Auth's internal adapter plus exported signing rather than a
supported public pairing cookie response boundary.
The pairing-cookie boundary proof then shows a public Better Auth plugin
endpoint can emit the signed `arepo_session` cookie through Better Auth
response behavior after AREPO pairing acceptance. This avoids normal login UX
and frontend secret storage, but production activation still needs a real
AREPO plugin, activation gates, sidecar authorization state, audit redaction,
CSRF sequencing, and an explicit decision accepting plugin endpoint use of
`ctx.context.internalAdapter`.
The production-shaped AREPO Better Auth plugin-boundary proof now models those
pieces in isolation: the activation gate blocks before session creation,
`setSessionCookie`, sidecar reference creation, and success-audit emission by
default; an explicit test-only allowance can create a signed cookie and sidecar
authorization reference through the plugin boundary; signed-cookie lookup,
sign-out, revoke-current, revoke-all, and expiry still work; and audit output,
cookie metadata, and sidecar diagnostics stay redacted. This proof remains
unmounted and does not enable live browser auth.
The session-scope metadata proof selects a hybrid model: Better Auth owns
session/cookie mechanics, while AREPO owns local operator subject policy,
device-label policy, route authorization, audit redaction, and vault/node
permission posture in app-data sidecar state keyed by Better Auth user/session
references. Permission posture must never be serialized into cookies or trusted
from frontend input.

## Current V1 Posture

- The backend binds to `127.0.0.1` by default.
- Disabled auth remains the default compatibility mode.
- `auth.mode = "protected"` enforces local bearer-token authorization for
  backend API/operator requests.
- Bearer token is the only live protected-mode credential path.
- Browser-session cookies are intentionally not accepted as live credentials.
- CSRF enforcement is not live because browser sessions are not live.
- Inert in-memory browser session store and verifier primitives exist for
  storage and verification semantics tests only. They are not wired into request
  authorization.
- Inert in-memory CSRF token store and verifier primitives exist for future
  token semantics tests only. CSRF tokens are not issued from routes and are not
  validated in live request authorization.
- Inert browser cookie policy and header-sanitization primitives exist for
  future cookie/session diagnostics and audit tests only. They do not issue
  cookies, accept cookies as credentials, or participate in live authorization.
- A dedicated inactive-boundary regression suite asserts that browser-auth
  primitives remain unwired from live server behavior until a future slice
  deliberately enables the complete browser-auth path.
- An inert browser-auth lifecycle coordinator exists for planning and unit tests
  only. It composes pairing-code, session, CSRF token, cookie policy, and audit
  primitives internally, but is not mounted into HTTP routes or authorization.
- A pure browser-auth activation preflight planner exists as planning/status
  infrastructure only. It lists the gates that must be satisfied before future
  browser auth route mounting can be considered; current blockers are
  intentional and protective.
- A browser-auth route contract planner exists as planning/status
  infrastructure only. It documents the future pairing, session, CSRF, logout,
  and revocation route surface and required protections without mounting routes
  or changing live behavior.
- A browser-auth activation config policy planner exists as planning/status
  infrastructure only. It defines a future activation config shape and always
  reports activation blocked today, even if future-style activation fields are
  supplied.
- A browser-auth dark route harness and explicit activation gate exist as
  unmounted planning/test infrastructure. The harness can model future route
  flow internally, but the activation gate blocks all active behavior and the
  harness is not mounted into live HTTP routes or authorization.
- A test-only browser-auth issuance flow exists inside the unmounted dark
  harness path. It proves internal pairing-code consumption can create an
  in-memory browser session and CSRF token, but only when an explicit
  test-only allowance is supplied directly in unit tests.
- A disabled browser-auth request-shape adapter exists as unmounted
  planning/test infrastructure. It translates live-like request shapes into
  sanitized dark-harness input, but does not parse cookies for live
  authorization, validate CSRF, authenticate requests, issue cookies, or accept
  cookies.
- The frontend does not store bearer tokens.
- Full authorized status reports `browserSessionAuth.status` as
  `planning-only`; reduced anonymous status does not expose session details.
- CORS is a browser-origin filter, not authentication.
- The existing allowed CORS origins only control which browser origins may read
  responses; they do not identify a trusted user, device, or node.
- Non-local binding remains unsafe. CORS allowlists, preflight handling, and
  frontend origin checks do not make LAN, reverse-proxy, or internet exposure
  safe.

## Future Browser Session Goal

The intended browser path is:

1. A local operator bootstraps or creates a bearer credential.
2. The operator starts a deliberate local pairing/login flow.
3. The backend validates the bearer credential or a short-lived pairing proof.
4. The backend issues an HttpOnly browser session cookie.
5. The frontend never receives, reads, stores, or logs the raw session secret.
6. The frontend uses normal same-origin requests with browser credentials
   included.
7. Unsafe browser-session requests include a CSRF proof.
8. Logout or revocation invalidates the session server-side.
9. Expired, revoked, malformed, or unverifiable sessions fail closed.

AREPO should implement the first browser login path as a local-only pairing
code derived from an already authorized bearer request. That avoids asking users
to paste a long bearer token into the browser UI and keeps the bearer token out
of frontend storage. The pairing code should be short-lived, one-time use,
audited, and exchangeable only from an allowed local browser origin.

## Session Issuance Model

Future session issuance must require:

- `auth.mode = "protected"`.
- browser-session readiness complete enough to enforce safely.
- a valid authorized bearer credential or a one-time pairing proof.
- local host/origin checks; dev exceptions must remain localhost-only.
- sanitized audit events for attempted, succeeded, and denied issuance.
- no raw session secret in JSON responses.
- session cookie delivery via `Set-Cookie` only.
- no raw session secrets in logs, audit records, status responses, or frontend
  state.

Session issuance is currently inactive. The route surface exists only as
disabled stubs and no live route issues browser session cookies in this slice.

## Browser Threat Model

Future protected browser mode must account for:

- Malicious web pages sending requests to `localhost` or a LAN AREPO backend.
- CSRF against cookie-authenticated endpoints because cookies are sent
  automatically by the browser.
- Overbroad CORS exposing API responses to untrusted browser origins.
- Allowed-origin confusion, such as trusting an origin string as if it were a
  user, device, or credential.
- Browser extensions that can read pages, modify requests, or access browser
  storage.
- Token leakage through `localStorage`, `sessionStorage`, copied scripts,
  browser devtools, or extension-accessible state.
- Ambient cookie behavior where the browser attaches session cookies even when
  the user did not intentionally operate AREPO.
- Reverse proxy deployments that accidentally widen network reach while
  preserving localhost-era assumptions.

Local malware or a same-user local process may still read files, app data, or
browser storage. Browser-session security reduces browser and network request
risks; it does not defend fully against a compromised OS account.

## Client Types

### Browser UI

The browser UI should use a short-lived browser session in future protected
mode. It may use cookies if CSRF controls are implemented, or a header-based
session token if storage and scripting risks are accepted. The UI credential
should be scoped to selected vaults and should not imply admin authority by
default.

### CLI/API Client

CLI and non-browser API clients should use an `Authorization` header bearer
token. CSRF is different for this client type because browsers do not attach
custom `Authorization` headers to cross-site requests unless script code has
access to the token and CORS permits the request. These tokens remain risky
because users may leak them through shell history, logs, scripts, or copied
config.

### Future Node-To-Node Client

Future AREPO nodes should use node credentials, not browser sessions. Node
credentials should bind to explicit node identity, scope, expiry or rotation
policy, and revocation state. Network discovery or source IP must not imply
node trust.

## Cookie Session Design

A future cookie session model should include:

- `HttpOnly` cookies so normal page JavaScript cannot read the session secret.
- `SameSite=Lax` or `SameSite=Strict`; use `Strict` unless UX requires `Lax`.
- `Secure` cookies on HTTPS. Secure cookies require HTTPS in real browser
  contexts. Local HTTP development may need an explicit dev-only policy, but it
  must be localhost-only and must not silently apply to non-local bind
  addresses.
- `Path` constrained as tightly as practical, likely `/api`.
- no `Domain` attribute unless a later deployment model explicitly justifies it.
- bounded `Max-Age` or `Expires`.
- Short expiry and server-side session records.
- Renewal rules that extend only valid, non-revoked sessions.
- Logout that revokes the server-side session and clears the browser cookie.
- Server-side revocation for compromised devices.
- Audit events for session creation, use, renewal, expiry, logout, and
  revocation.
- No plaintext session secret storage. Store only session verifier material.

Cookie sessions need CSRF protection because the browser can attach cookies to
requests the user did not intend.

Current implementation note: AREPO now includes an inert `browserCookiePolicy`
primitive and an inert `browserHeaderSanitizer` primitive. The cookie policy
primitive defines planned session and CSRF cookie names, validates future-safe
attributes such as `HttpOnly`, `Secure`, `SameSite`, host-only domain posture,
path, and bounded max age, and returns safe diagnostics only. The header
sanitizer redacts `Cookie`, `Authorization`, `Set-Cookie`, and CSRF-style
headers for future diagnostics/audit use. These primitives do not emit
`Set-Cookie`, do not store cookie values, do not parse cookies as credentials,
and are not wired into live request authorization or route middleware.

## CSRF Design

Cookie-authenticated protected endpoints should require a CSRF check for
state-changing or sensitive operations. The likely design is one of:

- Synchronizer token: server stores a CSRF token binding with the session and
  the UI sends it in a custom header.
- Double-submit token: server validates that a non-HttpOnly CSRF cookie and a
  custom header match a server-verifiable binding.

The CSRF token is not an authentication secret. It proves that the request came
from a page that could read or receive the CSRF value under the expected origin
rules. It must be checked in addition to session validity, authorization, and
path safety.

CSRF validation should consider:

- exact origin allowlist for browser UI origins
- `Origin` header when present
- `Referer` fallback only when appropriate
- request method and operation class
- session binding
- token expiry or rotation on session renewal
- rejection and audit reason codes

Bearer-token API requests may remain header-authenticated and should not require
browser CSRF unless they explicitly use browser-session cookies. Origin and
Referer checks are defense in depth for browser sessions, not a replacement for
authentication, authorization, and CSRF validation.

Current implementation note: AREPO now includes an inert in-memory
`browserCsrfTokenStore` primitive and a `browserCsrfTokenVerifier` primitive for
future CSRF semantics. They can create test records tied to a future browser
session id, store only token hashes, verify token id plus raw token secret,
reject missing/wrong/expired/revoked/consumed tokens, revoke tokens for one
session, prune expired tokens, and return safe diagnostics. These primitives do
not persist to disk, do not issue CSRF tokens through any HTTP route, and are
not wired into live request authorization or route middleware.

Current adapter proof note: `backend/browserAuthCsrfRequestAdapterProof.ts`
uses those inert CSRF primitives in an unmounted proof for future
cookie-backed AREPO API routes. It classifies safe methods separately, requires
CSRF for unsafe methods, verifies token id plus token secret, binds the token to
the expected browser session id, denies missing, malformed, wrong, expired,
revoked, consumed, or session-mismatched token material with sanitized reason
codes, applies Origin/Referer checks as supplemental controls, and treats
SameSite as insufficient by itself. Its allow results are explicitly test-only;
it is not mounted, does not authenticate requests, does not mutate route state,
does not emit cookies, and does not validate CSRF in live request
authorization.

## Session Store And Revocation

The session store should contain verifier metadata, not raw session tokens.
Planned safe metadata includes:

- session id
- associated credential id or principal id
- verifier id and verifier metadata
- createdAt
- expiresAt
- renewedAt if renewal is implemented
- lastUsedAt if safe to update without excessive churn
- revokedAt or loggedOutAt
- SameSite policy
- CSRF binding id, not raw CSRF token
- optional client label or user-agent summary only if sanitized and useful

Revocation must be persistent. Logout should revoke the current session.
Revoke-all sessions should be planned for local emergency use. Bearer credential
revocation should either revoke derived browser sessions or make verification
fail by checking the associated credential and revocation store; the exact model
must be explicit before sessions become live.

Current implementation note: AREPO now includes an inert in-memory
`browserSessionStore` primitive and a `browserSessionVerifier` primitive for
future storage semantics. They can create test records, store only verifier
hashes, verify a session id plus verifier secret, reject missing/wrong/expired
or revoked sessions, revoke one session, revoke all sessions for a subject,
prune expired sessions, and return safe diagnostics. These primitives do not
persist to disk, do not issue cookies, do not create sessions through any HTTP
route, and are not accepted by live request authorization.

Better Auth storage policy note: AREPO accepts Better Auth's stored
`session.token` model only as sensitive generated app state under AREPO app
data. The auth database must remain outside vault roots and outside vault
sync/export flows. Deleting or resetting it should revoke all browser sessions
and require re-pairing. Corruption must fail closed. Restoring old backups may
restore old session authority, so backup/restore behavior must warn operators
and should force session reset or re-pairing unless state freshness is proven.

Better Auth expiry proof note: AREPO can configure a bounded Better Auth
session lifetime and inspect safe expiry metadata in the isolated app-data
boundary. The deterministic proof forces one isolated session's expiry into the
past through the internal adapter, confirms active-session lookup excludes it,
and confirms the signed-cookie `get-session` handler returns null and emits
redacted cookie-clearing metadata. The proof does not rely on slow sleeps and
does not enable live cookies. AREPO still needs renewal/update-age policy,
expired-session pruning policy, and backup/restore session-state rules before
browser sessions can be activated.

## Authorization Integration

Browser sessions should enter the same route authorization path as bearer
credentials:

- request credential extraction supports bearer headers and browser-session
  cookies, but live enforcement currently allows bearer headers only.
- session verification returns a principal with node and vault permissions.
- `backend/routePermissions.ts` remains the route policy source.
- routes missing explicit policy fail closed.
- stronger confirmation still applies to sensitive routes.
- browser sessions need a future re-confirmation UX for sensitive operations;
  `x-arepo-confirmation: confirm` is an operator/API signal, not final browser
  UX.

## Pairing And Login Flow

The preferred first flow is:

1. An already authorized local bearer request asks the backend to create a
   short-lived pairing code.
2. The backend stores only verifier metadata for the pairing code.
3. The operator enters or transfers the short code into the browser UI.
4. The browser exchanges the code from an allowed local origin.
5. The backend consumes the code once, issues the HttpOnly session cookie, and
   returns no session secret in JSON.
6. The frontend moves from reduced anonymous status to full authenticated status
   using same-origin requests.

The reserved disabled route surface is:

- `POST /api/node/auth/session`
- `POST /api/node/auth/session/logout`
- `POST /api/node/auth/session/revoke-all`
- `GET /api/node/auth/csrf`
- `POST /api/node/auth/pairing/start`
- `POST /api/node/auth/pairing/complete`

These endpoints return sanitized unavailable responses. They do not issue
cookies, authenticate browser sessions, create CSRF tokens, create pairing
codes, consume pairing codes, revoke live sessions, or make browser login
available.

The current pairing planner is observation-only and reports:

- pairing is disabled and `planning-only`.
- pairing-code issuance is `inactive`.
- pairing-code consumption is `inactive`.
- the intended first flow requires an existing bearer credential.
- the flow is local-origin constrained.
- stronger confirmation is required before issuing a pairing code.
- pairing codes must be short-lived and one-time use.
- raw pairing codes are not stored.
- pairing audit records must be sanitized.

Current implementation note: AREPO now includes an inert in-memory
`browserPairingCodeStore` primitive and a `browserPairingCodeVerifier` primitive
for future pairing semantics. They can create test records, return a generated
raw pairing code only to the direct caller of the primitive, store only pairing
code hashes, verify code id plus raw code secret, reject
missing/wrong/expired/revoked/consumed/locked codes, consume a valid code once,
revoke one code, revoke codes for a subject, track failed attempts, lock after a
configured maximum failed-attempt count, prune expired or consumed codes, and
return safe diagnostics. These primitives do not persist to disk, do not issue
or consume pairing codes through HTTP routes, and are not wired into live request
authorization or route middleware.

## Browser Session Lifecycle Plan

The session lifecycle planner is also observation-only. It reports the future
shape without creating sessions:

- session issuance is `inactive`.
- session store and session verifier primitives exist as inactive in-memory test
  infrastructure and are not wired into authorization.
- session revocation and expiry are `planned`; Better Auth deterministic expiry
  behavior is proven only in isolated dependency proofs.
- logout/current-session revocation is `inactive` today and planned for future
  live sessions.
- revoke-all browser sessions is `inactive` today and planned for emergency
  local operation.
- browser session cookies are not accepted as live credentials.
- raw session secrets are not stored.
- raw session secrets are never returned in JSON.
- derived-session invalidation after bearer credential revocation is planned.

The first live implementation should deliver the session secret only via
`Set-Cookie`, store verifier metadata server-side, and keep the raw session
secret unreadable by frontend JavaScript.

## Audit Behavior

Planned sanitized audit events:

- `browser_pairing_issue_attempted`
- `browser_pairing_issue_succeeded`
- `browser_pairing_issue_denied`
- `browser_pairing_consume_attempted`
- `browser_pairing_consume_succeeded`
- `browser_pairing_consume_denied`
- `browser_session_issue_attempted`
- `browser_session_issue_succeeded`
- `browser_session_issue_denied`
- `browser_session_logout_succeeded`
- `browser_session_revoke_all_succeeded`
- `browser_session_denied_invalid`
- `browser_session_denied_expired`
- `browser_session_denied_revoked`
- `browser_csrf_denied`

Audit records must not include raw session tokens, raw CSRF tokens, raw pairing
codes, Authorization headers, cookies, verifier hashes, salts, or browser
fingerprinting data beyond explicitly safe sanitized labels.

Current implementation note: AREPO now includes inert browser-auth audit event
primitives for future pairing, session, cookie, CSRF, revocation, expiry, and
rejected-auth events. These primitives build sanitized in-memory test events
from allowlisted metadata only. They reject secret-shaped detail keys and
obvious raw secret values, and they are not wired into live request
authorization, route middleware, or browser-auth route execution.

## Frontend No-Secret Handling

Frontend constraints:

- no bearer token in `localStorage`, `sessionStorage`, IndexedDB, cookies, or
  durable app state.
- no raw session secret available to JavaScript.
- reduced anonymous status must be distinguishable from authenticated full
  status.
- login/pairing UI is future work.
- logout should call a backend revocation endpoint once implemented.
- unsafe mutations should include CSRF proof once browser sessions are live.

## Readiness And Status

Browser-session readiness blockers:

- session verifier/store availability
- session revocation store availability
- secure cookie policy for the current bind/origin posture
- CSRF verifier and token-binding policy
- pairing/login issuance policy
- sanitized failure responses
- audit behavior if protected readiness requires it
- route authorization integration
- reduced anonymous status behavior preserved

Current full status may expose safe posture only, such as:

```text
browserSessionAuth.status = planning-only
browserSessionAuth.liveSessionAuth = false
browserSessionAuth.acceptsSessionCookies = false
browserSessionAuth.sessionIssuance = inactive
browserSessionAuth.csrfEnforcement = inactive
browserSessionAuth.frontendTokenStorage = false
browserSessionAuth.sessionRoutes = stubbed
browserSessionAuth.pairingRoutes = stubbed
browserSessionAuth.csrfEndpoint = stubbed
browserSessionAuth.pairing.status = planning-only
browserSessionAuth.pairing.issueCode = inactive
browserSessionAuth.pairing.consumeCode = inactive
browserSessionAuth.pairing.storesRawCodes = false
browserSessionAuth.pairing.codeStore.status = inactive
browserSessionAuth.pairing.codeStore.implementation = in-memory-test-primitive
browserSessionAuth.pairing.codeStore.wiredIntoAuthorization = false
browserSessionAuth.pairing.codeStore.wiredIntoRoutes = false
browserSessionAuth.pairing.codeVerifier.status = inactive
browserSessionAuth.pairing.codeVerifier.wiredIntoAuthorization = false
browserSessionAuth.pairing.codeVerifier.wiredIntoRoutes = false
browserSessionAuth.audit.eventPrimitives.status = inactive
browserSessionAuth.audit.eventPrimitives.implementation = in-memory-test-primitive
browserSessionAuth.audit.eventPrimitives.wiredIntoAuthorization = false
browserSessionAuth.audit.eventPrimitives.wiredIntoRoutes = false
browserSessionAuth.audit.eventPrimitives.sanitizesSecretMaterial = true
browserSessionAuth.sessionLifecycle.issuance = inactive
browserSessionAuth.sessionLifecycle.logout = inactive
browserSessionAuth.sessionLifecycle.revokeAll = inactive
browserSessionAuth.sessionLifecycle.storesRawSessionSecrets = false
browserSessionAuth.sessionLifecycle.returnsSessionSecretsInJson = false
browserSessionAuth.sessionStore.status = inactive
browserSessionAuth.sessionStore.implementation = in-memory-test-primitive
browserSessionAuth.sessionStore.wiredIntoAuthorization = false
browserSessionAuth.sessionVerifier.status = inactive
browserSessionAuth.sessionVerifier.wiredIntoAuthorization = false
browserSessionAuth.cookiePolicy.issuance = inactive
browserSessionAuth.cookiePolicy.httpOnly = required
browserSessionAuth.cookiePolicy.secure = required-outside-local-dev
browserSessionAuth.cookiePolicy.domain = omitted
browserSessionAuth.cookiePolicy.setsCookiesToday = false
browserSessionAuth.cookiePolicy.policyPrimitives.status = inactive
browserSessionAuth.cookiePolicy.policyPrimitives.implementation = policy-test-primitive
browserSessionAuth.cookiePolicy.policyPrimitives.wiredIntoAuthorization = false
browserSessionAuth.cookiePolicy.policyPrimitives.wiredIntoRoutes = false
browserSessionAuth.cookiePolicy.policyPrimitives.issuesCookies = false
browserSessionAuth.cookiePolicy.policyPrimitives.acceptsCookies = false
browserSessionAuth.cookiePolicy.headerSanitizer.status = inactive
browserSessionAuth.cookiePolicy.headerSanitizer.implementation = header-redaction-test-primitive
browserSessionAuth.cookiePolicy.headerSanitizer.wiredIntoAuthorization = false
browserSessionAuth.cookiePolicy.headerSanitizer.wiredIntoRoutes = false
browserSessionAuth.cookiePolicy.headerSanitizer.redactsCookieHeaders = true
browserSessionAuth.cookiePolicy.headerSanitizer.redactsAuthorizationHeaders = true
browserSessionAuth.cookiePolicy.headerSanitizer.redactsSetCookieHeaders = true
browserSessionAuth.cookiePolicy.headerSanitizer.redactsCsrfHeaders = true
browserSessionAuth.csrf.tokenIssuance = inactive
browserSessionAuth.csrf.validation = inactive
browserSessionAuth.csrf.unsafeMethodsRequireCsrfWhenSessionAuthLive = true
browserSessionAuth.csrf.bearerTokenRequiresBrowserCsrf = false
browserSessionAuth.csrf.tokenStore.status = inactive
browserSessionAuth.csrf.tokenStore.implementation = in-memory-test-primitive
browserSessionAuth.csrf.tokenStore.wiredIntoAuthorization = false
browserSessionAuth.csrf.tokenStore.wiredIntoRoutes = false
browserSessionAuth.csrf.tokenVerifier.status = inactive
browserSessionAuth.csrf.tokenVerifier.wiredIntoAuthorization = false
browserSessionAuth.csrf.tokenVerifier.wiredIntoRoutes = false
browserSessionAuth.frontend.tokenStorage = false
browserSessionAuth.frontend.sessionSecretReadableByJs = false
browserSessionAuth.frontend.loginUi = inactive
```

Status must not expose raw session secrets, raw CSRF tokens, raw pairing codes,
session hashes, salts, cookies, or Authorization headers. Reduced anonymous
status must not expose browser-session readiness detail.

## Header Token Design

Header bearer tokens should be used for CLI/API clients and possibly some
non-cookie browser flows. They differ from cookie sessions:

- Browsers do not attach `Authorization` automatically to cross-site forms or
  image/script tags.
- A malicious web page cannot send a useful bearer token unless it can read or
  obtain that token.
- CORS still controls whether browser script can read responses, but CORS is not
  authentication.
- Header tokens can leak through logs, shell history, copied scripts, terminal
  scrollback, process listings, browser storage, and extension-accessible state.
- Bearer tokens should be shown only once, stored only as verifier material,
  scoped narrowly, expired or rotated, and revocable.

Browser UI should avoid storing long-lived bearer tokens in `localStorage`.
`sessionStorage` reduces persistence but does not protect against active page
script or extension access.

## CORS And Origin Policy

CORS, origin checks, CSRF checks, authentication, and authorization are separate
controls:

- CORS controls which browser origins may read responses.
- Origin checks verify request provenance signals.
- CSRF checks verify a browser session request includes a valid anti-CSRF value.
- Authentication verifies the credential or session.
- Authorization verifies route, vault, node, and operation permissions.

Rules for future protected mode:

- Allowed origins are not trusted actors.
- Passing preflight is not authorization.
- Protected endpoints still need authentication and authorization.
- Cookie-authenticated sensitive requests need CSRF checks.
- Reduced anonymous health/status may exist, but full node diagnostics should
  require `manageNode`.
- Non-local bind must not become safe from CORS alone.
- Wildcard CORS must remain unsupported for protected browser UI use.
- Reverse proxy deployments must strip untrusted forwarded auth headers unless
  an explicit delegated-auth design exists.

## Request Classification

Future protected mode should classify requests before deciding which browser
session checks apply.

| Class                    | Examples                                                                          | Cookie session checks                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Reduced anonymous status | reduced `GET /api/health`, reduced `GET /api/node/status`                         | No session required; must expose minimal public data only.                                                                           |
| Safe/read metadata       | generated index, index filters, index search, storage summary, vault file listing | Session/auth required for protected data; CSRF usually not required for `GET`, but origin policy still applies for browser UI.       |
| Source-content read      | `GET /api/vaults/:vaultId/file`                                                   | Session/auth and `readContent`; CSRF usually not required for `GET`, but origin policy still applies.                                |
| Source mutation          | write file, create file/folder, rename, reindex if triggered by browser session   | Session/auth, authorization, origin check, and CSRF token.                                                                           |
| Delete                   | delete file                                                                       | Session/auth, `deleteFiles`, origin check, CSRF token, stronger confirmation, and audit.                                             |
| Auth management          | credential creation, revocation, auth mode changes, node-secret rotation          | Session/auth, `manageAuth`, origin check, CSRF token, stronger confirmation, and audit.                                              |
| Vault management         | vault registration/removal, vault permission changes                              | Session/auth, `manageVaults`, origin check, CSRF token, local-operator confirmation, and audit.                                      |
| Audit read               | future audit endpoints                                                            | Session/auth, `readAudit`, origin check; CSRF not normally required for `GET`, but responses may reveal sensitive security metadata. |

Preflight `OPTIONS` is not a class of authorization. It can fail or pass before
auth checks, but it must not grant access to the actual operation.

## Failure Behavior

- Missing `Origin`: for cookie-authenticated browser requests, reject sensitive
  non-GET operations unless a deliberate localhost exception is designed and
  tested. For CLI/header-token requests, do not require browser-origin semantics
  unless the request presents browser-session cookies.
- Untrusted `Origin`: reject before performing the protected operation; audit
  with a stable origin rejection reason.
- Failed CSRF token: reject the request, preserve session state unless repeated
  failures trigger defensive action, and audit without logging the token value.
- Expired session: reject, clear cookie when practical, and require re-pairing
  or sign-in.
- Revoked session: reject, clear cookie when practical, and audit the rejected
  use.
- Missing session: return an auth-required response, not a generic success or
  LAN-safe status.
- Non-local bind with disabled auth: warn or refuse according to future startup
  policy; never treat it as safe because CORS is configured.
- Failed authorization: reject after authentication and CSRF/origin checks where
  applicable, and audit the denied route/permission without source content.

## Minimal First Implementation Recommendation

The current scaffold remains inert for browser sessions:

1. Keep typed browser security and browser-session auth planners pure.
2. Report browser-session posture as planning-only/inactive.
3. Keep disabled route stubs sanitized and route-policy covered.
4. Do not accept session cookies as live credentials.
5. Do not add middleware that issues cookies.
6. Do not generate browser sessions, CSRF tokens, or pairing codes.
7. Do not enforce origin or CSRF checks as live browser-session auth yet.
8. Do not claim LAN, reverse-proxy, or internet exposure is safe.
9. Keep the in-memory session store and verifier primitives as unit-tested,
   inactive infrastructure until issuance, cookie, CSRF, revocation, audit, and
   authorization integration are designed and tested together.
10. Keep the in-memory CSRF token store and verifier primitives as unit-tested,
    inactive infrastructure until browser session issuance and CSRF route
    delivery/validation become live together.
11. Keep the in-memory pairing-code store and verifier primitives as
    unit-tested, inactive infrastructure until pairing start/complete routes,
    bearer authorization, audit, browser session issuance, cookie delivery, and
    CSRF integration are designed and tested together.
12. Keep the browser cookie policy and header-sanitization primitives as
    unit-tested, inactive infrastructure until session issuance, cookie
    delivery, CSRF validation, route middleware, and audit wiring are designed
    and tested together.
13. Keep the browser-auth lifecycle coordinator as unit-tested, unmounted
    infrastructure. It may validate future lifecycle semantics internally, but
    live HTTP routes must continue returning inactive responses until browser
    session issuance, cookie delivery, CSRF validation, audit, revocation,
    frontend handling, and authorization are implemented together.
14. Keep the activation preflight planner pure and unmounted. It may report
    blockers, warnings, and required confirmations, but it must not mount routes,
    issue cookies, accept cookies, validate CSRF tokens, or change live bearer
    authorization behavior.
15. Keep the route contract planner pure and unmounted. It may document future
    route methods, paths, audit categories, CSRF requirements, pairing
    requirements, and browser-session requirements, but it must not register
    handlers or alter live route behavior.
16. Keep the activation config policy planner pure and unmounted. It may define
    and validate future browser-auth config concepts, but it must not add a live
    activation flag, mount routes, issue or accept cookies, validate CSRF, or
    enable browser sessions.
17. Keep the activation gate and dark route harness unmounted. They may model
    future route execution in unit tests, but the gate must block active
    behavior until a later activation slice deliberately wires browser-session
    issuance, cookie delivery, CSRF validation, audit, and authorization
    together.
18. Keep the disabled request-shape adapter unmounted. It may classify
    live-like headers and route shapes for tests, but it must output only
    sanitized presence/classification data and must not authenticate, validate
    CSRF, issue cookies, or feed live authorization.
19. Keep the test-only issuance allowance out of runtime config, environment
    variables, live routes, and frontend code. It may exercise pairing,
    session, and CSRF semantics inside the unmounted harness only.
20. Keep test-only cookie serialization planning inside the unmounted harness
    path. It may convert internal test-only session and CSRF issuance material
    into planned `Set-Cookie` strings for unit tests, but live routes must not
    emit those headers, accept cookies, or expose cookie values in diagnostics,
    status, audit events, errors, or inactive responses.
21. Keep the Better Auth dependency, app-data store, pairing-session,
    pairing-cookie, pairing-cookie boundary, production-shaped AREPO plugin
    boundary, and session-scope metadata proofs isolated from live server paths.
    They may validate local SQLite storage, internal pairing-to-session
    behavior, pairing-created signed-cookie lookup, plugin-boundary cookie
    emission, sidecar authorization reference posture, CSRF sequencing,
    sanitized audit-like events, session lookup, revoke-current, revoke-all,
    metadata reference posture, and sanitized response observations, but they
    must not mount Better Auth, issue live cookies, accept cookies, parse
    cookies for live authorization, validate live CSRF, or change bearer-token
    protected mode.
22. Keep the Better Auth routeRequest adapter proof isolated from live server
    paths. It may validate standard `Request` conversion, sanitized
    `Response` wrapping, signed cookie issuance/clearing observation, and
    signed-cookie session lookup in tests, but it must not become live route
    middleware or a cookie credential adapter until activation gates, CSRF,
    storage policy, and route contracts are deliberately wired.
23. Keep the Better Auth CSRF ownership proof isolated from live server paths.
    It may show Better Auth's own auth endpoint Origin behavior and classify
    AREPO unsafe route requirements, but AREPO-owned CSRF validation for
    non-auth API routes must remain unmounted until a deliberate adapter slice
    proves token validation, supplemental Origin/Referer checks, sanitized
    denial, and pre-mutation ordering.
24. Keep the AREPO-owned CSRF request adapter proof isolated from live server
    paths. It may prove future unsafe cookie-backed route validation with
    token/session binding and supplemental Origin/Referer checks, but it must
    not become middleware, live route authorization, live CSRF enforcement, or
    cookie credential acceptance until a deliberate activation phase wires the
    full browser-auth path.

Actual enforcement should wait until session storage, credential verification,
audit writing, revocation checks, CORS/origin policy, and route authorization are
implemented and tested together.
