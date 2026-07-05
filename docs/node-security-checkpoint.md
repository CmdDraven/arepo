# Node Security Checkpoint

Phase 4 is the security checkpoint for AREPO protected mode before remote nodes,
federation, sync, or any LAN-safe deployment claim.

This document is not an implementation plan for exposing the current backend.
AREPO V1 remains a local-first Node backend. It binds to `127.0.0.1` by
default, disabled auth remains the compatibility mode, and protected mode now
enforces local bearer-token authorization when explicitly configured. Protected
mode still must not be treated as safe for LAN, reverse-proxy, or internet
exposure.

## Current Phase 4 Implementation Status

Phase 4 is in progress. AREPO now has an operational protected-mode path for
local bearer-token API/operator use:

- `auth.mode = "disabled"` remains the default local compatibility path.
- `auth.mode = "protected"` verifies bearer tokens on live requests, enforces
  route permissions, fails closed when readiness is incomplete, returns reduced
  anonymous `/api/node/status` and `/api/health`, and appends sanitized audit
  records.
- Credential lifecycle APIs exist for localhost-only bootstrap, credential
  listing, creation, revocation, and rotation.
- Raw bearer tokens are returned only once during bootstrap, create, or rotate.
- `x-arepo-confirmation: confirm` is required for protected credential
  management routes that need stronger confirmation.
- Browser login, browser sessions, live CSRF-protected browser auth, frontend
  token storage, remote node registration, federation, and LAN/reverse-proxy
  safety remain out of scope.
- Browser-session auth is represented in status/readiness as planning-only:
  session cookies are not accepted, session issuance is inactive, CSRF
  enforcement is inactive, and frontend token storage is absent.
- Disabled browser-session and pairing route stubs are mounted for future API
  shape coverage. They return sanitized unavailable responses and do not issue
  cookies, create sessions, create CSRF tokens, create pairing codes, or accept
  browser cookies as live credentials.
- A dedicated browser-auth inactive-boundary regression suite now checks that
  pairing/session/CSRF/cookie/audit primitives remain planning/test
  infrastructure only, that live routes do not emit `Set-Cookie`, and that
  cookies or CSRF-style headers do not authenticate protected routes.
- An inert browser-auth lifecycle coordinator exists for unit tests only. It
  composes pairing-code, session, CSRF token, cookie policy, and audit
  primitives internally, but is not mounted into live routes, credential
  adapters, middleware, protected-mode enforcement, or request authorization.
- A pure browser-auth activation preflight planner exists for planning/status
  only. It reports blockers, warnings, and required confirmations for any future
  browser-auth activation, while keeping browser auth inactive and unwired.
- A pure browser-auth route contract planner exists for planning/status only.
  It documents future browser-auth route contracts and required protections, but
  does not mount routes, issue cookies, accept cookies, validate CSRF, or enable
  browser sessions.

See [Protected Mode Operator Workflow](protected-mode-operator-workflow.md) for
the current local operator commands and manual acceptance flow.

The remaining sections preserve design rationale and historical checkpoint
language. Where older text says a component is future/planning-only, prefer the
current implementation status above and the operator workflow for operational
protected-mode behavior.

Implemented components include:

- Auth posture/config/status reporting: omitted auth config defaults to
  `auth.mode = "disabled"`. If `auth.mode = "protected"`, status reports
  protected-mode readiness, reduced anonymous diagnostics, and safe credential
  lifecycle posture for authorized callers.
- `backend/routePermissions.ts`: type-only future route permission inventory.
- `backend/authPlanner.ts`: pure dry-run authorization planner for hypothetical
  credentials and route policies.
- `backend/credentialStore.ts`: credential metadata, app-data auth path,
  storage-boundary validation, and JSON store read/write helpers for future
  credentials, token verifiers, browser sessions, and revocations.
- `backend/credentialVerifier.ts`: pure PBKDF2-SHA-256 verifier helpers for
  creating verifier records from supplied secret material and checking supplied
  material against verifier records.
- `backend/sessionVerifier.ts`: pure PBKDF2-SHA-256 browser session verifier
  helpers for supplied session secret material, renewal eligibility planning,
  and logout/revocation planning.
- `backend/credentialVerificationService.ts`: non-HTTP verification service
  for explicitly supplied token or browser-session material against loaded
  credential, verifier, session, and revocation metadata stores.
- `backend/credentialVerificationAudit.ts`: non-HTTP audit integration helpers
  that convert verification results into sanitized auth audit events and append
  them to the existing JSONL audit log when called explicitly.
- `backend/httpCredentialAdapter.ts`: request-shaped credential extraction
  adapter for bearer headers. Browser-session cookies are not accepted for live
  auth in this slice.
- `backend/requestAuthorizationPlanner.ts`: route-aware protected-mode planner
  that combines route policy lookup, HTTP credential adapter output, dry-run
  authorization planning, browser security planning, and confirmation
  requirements into enforcement decisions.
- `backend/protectedRequestPipeline.ts`: protected request pipeline that
  composes auth store loading, HTTP credential extraction, token verification,
  route-aware authorization planning, browser policy planning, and sanitized
  audit writes.
- `backend/protectedResponsePlanner.ts`: response planner that maps protected
  request pipeline decisions to sanitized HTTP-style responses such as reduced
  anonymous response, unauthenticated, unauthorized, stronger-confirmation
  required, unknown route, and protected-mode-not-ready.
- `backend/reducedAnonymousStatusPlanner.ts`: unmounted future reduced
  anonymous health/status planner. It defines sanitized liveness/auth-required
  response shapes for protected mode without vaults, paths, origins, dry-run
  counters, credential identifiers, route inventory, generated index data, or
  storage summaries. It is planning scaffold only; current V1 endpoints still
  return their existing local diagnostics.
- `backend/strongerConfirmationPlanner.ts`: stronger-confirmation planner. It
  identifies delete, conflict overwrite,
  vault lifecycle, auth management, credential revocation, node-secret rotation,
  emergency reset, and remote-node lifecycle operations that will require an
  extra confirmation step in protected mode. Live protected credential routes
  currently accept the explicit operator header `x-arepo-confirmation: confirm`.
- `backend/auditRequirementPlanner.ts`: unmounted future audit requirement
  planner. It classifies auth attempts, credential/session/token lifecycle,
  vault lifecycle, source mutations, rejected protected requests, emergency
  reset, and remote-node lifecycle operations into sanitized audit requirement
  plans. It does not write audit logs and is not imported by active request
  handling.
- `backend/browserRequestGuardPlanner.ts`: unmounted future browser-origin and
  CSRF guard planner. It classifies browser request source, safe versus unsafe
  methods, origin posture, CSRF requirement state, reduced anonymous status,
  and route-aware request classes without rejecting requests or changing CORS
  behavior.
- `backend/browserSessionAuthPlanner.ts`: pure planning-only browser-session
  auth posture planner. It reports intended pairing-code lifecycle, session
  issuance/logout/revoke-all posture, cookie policy, CSRF posture, frontend
  no-secret handling, planned sanitized audit event categories, stub route
  posture, session-store expectations, and browser-session blockers without
  accepting cookies, issuing sessions, generating pairing codes, generating CSRF
  tokens, or exposing secrets.
- `backend/browserSessionStore.ts` and `backend/browserSessionVerifier.ts`:
  inert in-memory browser-session storage and verifier primitives. They define
  future storage semantics for hashed verifier material, expiry, revocation,
  subject-wide revocation, pruning, and safe diagnostics, but are not wired into
  HTTP authorization, cookie acceptance, session issuance, pairing, or CSRF.
- `backend/browserCsrfTokenStore.ts` and `backend/browserCsrfTokenVerifier.ts`:
  inert in-memory CSRF token storage and verifier primitives. They define future
  CSRF semantics for hashed token material, expiry, revocation, one-time
  consumption, session-wide revocation, pruning, and safe diagnostics, but are
  not wired into HTTP authorization, route middleware, CSRF route issuance, or
  browser session authentication.
- `backend/browserPairingCodeStore.ts` and
  `backend/browserPairingCodeVerifier.ts`: inert in-memory browser pairing-code
  storage and verifier primitives. They define future pairing semantics for
  hashed pairing-code material, expiry, revocation, one-time consumption,
  failed-attempt tracking, max-attempt lockout, subject-wide revocation, pruning,
  and safe diagnostics, but are not wired into HTTP authorization, route
  middleware, pairing route issuance/consumption, or browser session
  authentication.
- `backend/browserAuthAuditEvents.ts`: inert browser-auth audit event
  primitives. They define sanitized future audit categories for pairing,
  session, cookie, CSRF, revocation, expiry, and rejected-auth events, use
  allowlisted safe details, reject secret-shaped metadata, and remain unwired
  from live authorization and route execution.
- `backend/browserCookiePolicy.ts` and `backend/browserHeaderSanitizer.ts`:
  inert browser-auth cookie policy and header-sanitization primitives. They
  define planned cookie names, validate future-safe cookie attributes, produce
  safe diagnostics, and redact `Cookie`, `Authorization`, `Set-Cookie`, and
  CSRF-style headers for future audit/diagnostic use, but do not issue cookies,
  accept cookies as credentials, or wire into live authorization or routes.
- `backend/browserAuthLifecycleCoordinator.ts`: inert in-memory browser-auth
  lifecycle coordinator. It composes pairing-code, session, CSRF token, cookie
  policy, and audit primitives for future design validation, but is unmounted
  and unwired from live authorization, credential adapters, route middleware,
  and HTTP routes.
- `backend/browserAuthActivationPreflight.ts`: pure browser-auth activation
  preflight planner. It documents future activation gates such as mounted route
  surfaces, CSRF enforcement, cookie issuance/acceptance, persistence strategy,
  local-only or stronger network policy, inactive-boundary tests, and explicit
  operator confirmation without enabling browser auth.
- `backend/browserAuthRouteContracts.ts`: pure browser-auth route contract
  planner. It documents planned pairing, session, CSRF, logout, and revocation
  route methods and paths plus future audit, CSRF, browser-session, and
  pairing-code requirements without mounting or wiring any route behavior.
- `backend/credentialSessionLifecyclePlanner.ts`: unmounted future lifecycle
  planner for credential, token, browser-session, and revocation operations. It
  defines requirement codes for creation, verification, rotation, renewal, and
  revocation without creating credentials, sessions, tokens, cookies, pairing
  flows, login flows, or trusted actors.
- `backend/protectedRequestDryRun.ts`: optional mounted dry-run observer gated
  by `auth.dryRunRequestPolicy = true`. It runs the protected request pipeline
  for diagnostics only, optionally appends sanitized audit events when
  `auth.dryRunAudit = true`, computes sanitized future response-plan summaries
  such as "would respond as 401/403/428", stores bounded sanitized
  summaries/counters, always continues to the normal handler, and never sends
  planned 401/403/428 responses.
- `GET /api/node/auth/dry-run`: local diagnostic canary endpoint for sanitized
  protected-request dry-run status. It is observation-only, omits credential
  details, vault roots, filesystem paths, source content, and raw request
  headers/cookies, and reports `enforcementActive: false`,
  `protectedModeOperational: false`, and `networkExposureSafe: false`.
- `backend/authAudit.ts`: inert audit event types plus JSONL serialize, parse,
  append, and read helpers.
- `backend/authRevocation.ts`: inert revocation planning helpers for
  credentials, token verifiers, browser sessions, node-secret rotation, and
  emergency local-only reset.
- `backend/browserSecurityPolicy.ts`: inert browser request security policy
  planner for origin, CSRF, credential posture, reduced status, and stronger
  confirmation decisions.
- `backend/requestPolicyStatus.ts`: status-only request-policy readiness summary
  for local diagnostics. It reports policy inventory and planner presence, route
  policy count, dry-run observer/audit state, and inactive
  enforcement/credential/revocation/CSRF flags.
- `backend/protectedModeStartup.ts`: diagnostic startup assessment for future
  protected mode. It reports requested/operational auth mode, missing or corrupt
  auth stores, unsafe auth paths, permission warnings, inactive enforcement
  flags, and `networkExposureSafe: false`.
- `backend/protectedModeReadiness.ts`: centralized sanitized enforcement
  readiness manifest. It combines auth posture, startup gating, route policy
  coverage, request-policy status, dry-run state, pipeline/planner availability,
  browser-session planning posture, and network posture into stable status.
  For bearer-token protected mode it may report active enforcement when ready;
  for browser-session auth it reports planning-only blockers.

Bearer-token protected mode is live when `auth.mode = "protected"` and
readiness is complete. Browser-session auth is not live: active request handling
does not accept browser-session cookies, issue cookies, generate CSRF tokens,
or create pairing codes. The optional dry-run observer remains observation-only
when explicitly enabled. The dry-run canary endpoint reports sanitized
observation health and planned response summaries only. None of these planning
surfaces make LAN, reverse-proxy, or internet exposure safe.

Current runtime behavior remains disabled local compatibility mode unless
`auth.mode = "protected"` is explicitly configured. The backend binds to
localhost by default, uses configured vault roots only, treats CORS as a
browser-origin filter rather than authentication, and keeps non-local binding
unsafe.

Future browser-session enforcement remains blocked on live session issuance,
secure cookie policy for the current bind/origin posture, pairing/login flow,
CSRF validation, logout/revocation routes, browser re-confirmation UX, and
frontend no-secret state handling.

## Dry-run Vocabulary

Phase 4 status objects, the Local Node Diagnostics UI, the dry-run canary, and
tests use these terms consistently:

- `configured`: the feature is explicitly enabled in config.
- `mounted`: the dry-run observer is present in the request pipeline and capable
  of observing requests.
- `observed`: a request was processed by dry-run diagnostics.
- `planned`: a future protected response plan was computed, but not sent.
- `audited`: a sanitized dry-run audit event was appended or attempted.
- `enforced`: a real request was rejected, allowed, or modified based on
  protected-mode auth decisions.

The current invariant is that `enforced`, `enforcementActive`,
`protectedModeOperational`, and `networkExposureSafe` are always false. A dry-run
observer can be configured and mounted, can observe requests, can compute planned
future responses, and can attempt sanitized audit appends, but none of that means
authentication or authorization is active.

## Enforcement Readiness Manifest

`/api/node/status` includes a protected-mode readiness manifest for local
diagnostics. The manifest is the single sanitized summary of why AREPO is not
ready to enforce protected-mode requests. It exposes stable blocker codes and
counts only; it must not include raw authorization headers, bearer tokens, cookie
values, verifier hashes or salts, credential IDs, session IDs, token IDs, audit
event IDs, vault roots, filesystem paths, source document bodies, or raw CORS
origin lists beyond the existing runtime diagnostics surface.

The manifest currently always reports:

- `readyForEnforcement: false`
- `enforcementActive: false`
- `protectedModeOperational: false`
- `networkExposureSafe: false`

Expected blocker families include disabled/unavailable auth mode, startup gate
not ready, inactive credential verification, inactive credential acceptance,
inactive audit enforcement, inactive revocation checks, inactive CSRF/origin
enforcement, missing reduced anonymous status enforcement, missing stronger
confirmation enforcement, explicit enforcement flag disabled, planning-only
request pipeline, planning-only response planner, planning-only reduced
anonymous status planner, planning-only stronger-confirmation planner,
planning-only audit requirement planner, planning-only browser request guard
planner, inactive credential/session/token issuance, planning-only
credential/session lifecycle planner, optional dry-run observation-only state,
and non-local bind without active protected mode when applicable. Dry-run
observation, dry-run audit, route plans, reduced anonymous response plans,
stronger-confirmation plans, audit requirement plans, browser request guard
plans, credential/session lifecycle plans, and response plans may reduce
uncertainty for implementation work, but they never make the readiness manifest
enforcement-ready by themselves.

## Reduced Anonymous Status Planning

Future protected mode must not expose the current full `/api/node/status`
response anonymously. The reduced anonymous status planner defines future
responses for reduced `/api/health`, reduced `/api/node/status`, and optionally
reduced `/api/node/auth/dry-run`.

Reduced anonymous plans may expose only service liveness, API version,
`authRequired: true`, `protectedModeOperational`, `enforcementActive`,
`networkExposureSafe`, stable reason codes, and minimal public warning labels.
They must not expose vault IDs, vault names, vault roots, filesystem paths, file
paths, configured CORS origins, raw host/origin/header/cookie values, source
document bodies, generated index contents, storage summaries, dry-run counters,
planned response details for real routes, credential IDs, session IDs, token
IDs, audit event IDs, verifier hashes/salts, or route inventory details.

This planner is not mounted. Current V1 `/api/health`, `/api/node/status`, and
`/api/node/auth/dry-run` responses are unchanged. The readiness manifest may
report the planner as available, but reduced anonymous status remains not
actively enforced or mounted.

## Stronger-Confirmation Planning

Some future protected-mode operations need an extra confirmation step beyond
normal authentication and authorization. The stronger-confirmation planner
classifies those operations without generating confirmation tokens, enforcing
requests, or changing runtime handlers.

Current and future operation classes that require stronger confirmation include
source-file delete, conflict overwrite, vault registration/removal, vault
permission changes, auth mode changes, credential creation/revocation, node
secret rotation, emergency local-only reset, and future remote-node
registration/removal. Safe read/index operations do not require stronger
confirmation.

Planner output is sanitized and uses stable reason codes only. It must not
include filesystem paths, vault roots, source document bodies, raw headers,
cookies, bearer values, credential IDs, session IDs, token IDs, audit event IDs,
verifier hashes, or salts. The planner is not mounted, current V1 endpoint
behavior is unchanged, and readiness may report it only as planning scaffold
while stronger confirmation remains not actively enforced.

## Audit Requirement Planning

Future protected mode must define which security-sensitive operations require
audit records before those operations become enforceable. The audit requirement
planner classifies future operation and route-shaped inputs without writing
audit logs, rejecting requests, creating credentials, or changing runtime
handlers.

Operations that require audit include auth attempts, credential/session/token
lifecycle changes, node-secret rotation, vault registration/removal/permission
changes, source file create/write/rename/delete, conflict overwrite,
path/origin/CSRF rejection, authorization denial, emergency local-only reset,
and future remote-node registration/removal. Generated-index reads are
deliberately classified as not required for audit by default. Source-content
reads are deliberately classified as recommended for audit rather than silently
left unspecified.

Planner output uses stable reason codes and sanitized labels only. It must not
include raw authorization headers, bearer values, cookie values, verifier hashes
or salts, credential IDs, session IDs, token IDs, audit event IDs, vault roots,
filesystem paths, raw CORS origins, or source document bodies. The planner is
not mounted, current V1 endpoint behavior is unchanged, and readiness may report
it only as planning scaffold while audit enforcement remains inactive.

## Browser Request Guard Planning

Future browser session protected mode needs explicit browser-origin and CSRF
guard behavior before any cookie or session flow can be made real. The browser
request guard planner classifies explicit request-shaped inputs without reading
active HTTP requests, parsing cookies as trusted auth, rejecting requests,
creating sessions, generating CSRF tokens, or changing CORS behavior.

The planner distinguishes non-browser or unknown clients, same-origin browser
requests, allowed browser origins, disallowed browser origins, missing origins,
and malformed origins. It classifies safe methods such as `GET` and `HEAD`
separately from unsafe methods such as `POST`, `PUT`, `PATCH`, and `DELETE`.
Unsafe browser methods require future CSRF protection. Missing, invalid, or
unsupported CSRF posture is reported with stable reason codes, not by changing
current V1 endpoint behavior.

Route-aware planning uses the protected route inventory where possible.
Generated-index and status reads, source-content reads, source mutations, vault
mutations, auth-management request classes, node-management diagnostics, and
reduced anonymous status are deliberately classified. Missing, malformed, or
disallowed browser origins are fail-closed in future protected-mode plans.

Planner output is sanitized. It must not include raw `Origin`, `Referer`, or
`Host` values, raw authorization headers, bearer values, cookie values, CSRF
token values, verifier hashes or salts, credential IDs, session IDs, token IDs,
audit event IDs, vault roots, filesystem paths, raw CORS origins, or source
document bodies. The planner is not mounted, current V1 endpoint behavior and
CORS behavior are unchanged, and readiness may report it only as planning
scaffold while CSRF/origin enforcement remains inactive.

## Credential And Session Lifecycle Planning

Future protected mode must define lifecycle requirements before AREPO can create
or accept credentials, browser sessions, API tokens, cookies, login, or pairing
flows. The credential/session lifecycle planner classifies explicit
operation-shaped inputs and returns sanitized requirement codes only.

Credential creation, credential secret rotation, and credential revocation
require stronger confirmation, audit, and revocation-state compatibility.
Credential verification requires verifier availability, revocation checks, and
sanitized failure handling. Browser session creation requires secure cookie
policy planning, expiry, revocation checks, browser origin/CSRF guard
compatibility, and audit. Browser session renewal requires expiry and revocation
checks. Browser session revocation requires audit and revocation compatibility.
API token creation, rotation, and revocation require stronger confirmation,
audit, expiry or explicit long-lived-token classification, and revocation
checks. Revoke-all and emergency revoke-all operations require stronger
confirmation, audit, revocation compatibility, and local-only safety
assumptions for emergency reset.

Planner output must not include raw authorization headers, bearer values, cookie
values, CSRF token values, verifier hashes or salts, credential IDs, session
IDs, token IDs, audit event IDs, vault roots, filesystem paths, raw origins,
referers, hosts, or source document bodies. The planner is not mounted, current
V1 endpoint behavior is unchanged, and readiness may report it only as planning
scaffold while credential/session/token issuance and enforcement remain
inactive.

## Enforcement Readiness Checklist

This checklist is the gate before any auth middleware is mounted. It separates
implemented scaffolding from future runtime behavior so Phase 4 cannot be
mistaken for active protection.

Implemented but unmounted, status-only, or observation-only:

- Auth posture/config/status reporting for disabled local mode and requested
  protected mode as unavailable.
- Route permission inventory for current backend endpoints.
- Dry-run authorization planner for hypothetical credentials.
- Credential store metadata, validation, and JSON persistence helpers.
- Token verifier and browser session verifier primitives for supplied secret
  material.
- Non-HTTP credential verification service and sanitized verification audit
  helpers.
- HTTP credential extraction adapter for explicit request-shaped inputs.
- Route-aware request authorization planner for explicit request-shaped inputs.
- Protected request pipeline that composes store loading, credential adapter
  verification, route planning, browser policy planning, and optional sanitized
  audit writes for explicit request-shaped inputs.
- Protected response planner that converts future protected-mode decisions into
  sanitized HTTP-style response plans without mounting or enforcing them.
- Browser security, revocation, startup-gating, and request-policy status
  helpers.
- Audit requirement planner that describes future audit expectations without
  writing audit logs or enforcing requests.
- Browser request guard planner that describes future origin and CSRF
  expectations without enforcing requests or changing CORS behavior.
- Credential/session lifecycle planner that describes future issuance,
  verification, rotation, renewal, and revocation requirements without creating
  credentials, sessions, tokens, or cookies.

Mounted but dry-run:

- Optional protected request dry-run observer behind
  `auth.dryRunRequestPolicy = true`. It runs planning for observation only,
  stores bounded sanitized diagnostics, always continues to the normal handler,
  and keeps `enforcementActive` and `networkExposureSafe` false.
- Mounted response-plan dry-run diagnostics behind the same explicit observer.
  They summarize only planned response kind, planned status, stable reason code,
  auth-required, confirmation-required, `enforcementActive: false`, and
  `networkExposureSafe: false`; planned responses are never sent.
- Optional dry-run audit append behind both `auth.dryRunRequestPolicy = true`
  and `auth.dryRunAudit = true`. It writes sanitized observation events only;
  append failures are reported in diagnostics and never reject requests.
- `GET /api/node/auth/dry-run` dry-run canary endpoint. It exposes only
  sanitized observation status and counters, not credentials, vault roots,
  filesystem paths, source document bodies, raw authorization headers, or raw
  cookies.
- No auth, route authorization, revocation, CSRF/origin, or audit enforcement
  middleware is mounted in active request handling.

Required before first auth middleware:

- Protected-mode config must fail closed and never silently downgrade to
  disabled without a clear diagnostic.
- Auth store load failures, corrupt stores, unsafe store paths, and unreadable
  stores must fail closed.
- The HTTP credential adapter must be mounted deliberately, with tests proving
  no raw bearer token, cookie, session secret, verifier hash, salt, private key,
  pairing secret, password hash, recovery material, or source document body is
  exposed or logged.
- The protected request pipeline must be switched from dry-run observation to
  enforcement deliberately and only after disabled-mode regression tests still
  prove V1 local/no-auth behavior remains available when `auth.mode =
  "disabled"`.
- The protected response planner must be mounted deliberately only after
  response bodies, status codes, audit behavior, reduced anonymous diagnostics,
  and disabled-mode behavior are tested together.
- Route authorization must cover every active endpoint and unknown routes must
  fail closed in protected mode.
- Audit writes must be active, sanitized, append-only, and resilient to corrupt
  JSONL lines before protected mode is advertised.
- Revocation checks must be active for credentials, token verifiers, browser
  sessions, node-secret generation state, and emergency local-only reset.
- CSRF and origin checks must be active for browser cookie sessions before any
  cookie-authenticated state-changing route is accepted.
- Delete, overwrite-after-conflict, vault registration/removal, auth changes,
  token revocation, and node-management actions must require stronger
  confirmation where planned.
- Full anonymous diagnostics must be replaced by reduced anonymous
  health/status responses before protected mode is used outside local-only
  disabled-auth operation.
- Disabled-mode regression tests must continue to prove that adding protected
  mode does not change Markdown read/write/delete semantics when auth is
  disabled.

Required before non-local safety claims:

- Protected mode must be operational with credential verification, route
  authorization, audit writing, revocation checks, CSRF/origin enforcement, and
  reduced anonymous status all active and tested together.
- Non-local bind startup must refuse unsafe configurations or emit blocking
  fail-closed diagnostics rather than a warning-only posture.
- Reverse-proxy deployments must have explicit origin, header, TLS, forwarded
  host/proto, and cookie security guidance.
- Token/session lifecycle, expiry, rotation, logout, revocation, emergency
  reset, and audit preservation must be tested with failure cases.
- CORS must remain documented and tested as browser-origin policy only, never
  as authentication or authorization.
- Documentation and UI diagnostics must continue to say that LAN,
  reverse-proxy, and internet exposure are unsafe until the protected-mode
  implementation and tests support those claims.

## Current V1 Security Posture

- AREPO V1 is a local-node-only app.
- The backend binds to `127.0.0.1` by default.
- Disabled auth remains the default compatibility mode.
- Protected mode enforces local bearer-token authorization for API/operator
  workflows when explicitly configured.
- There is no browser session model, hosted user system, browser login,
  frontend token storage, or remote-node registration.
- The backend reads and writes only configured vault roots.
- Markdown files remain the source of truth.
- Generated machine indexes, graph inputs, storage summaries, and cache files
  are rebuildable support data. They are not canonical user content.
- `.arepo/config.json` stores local node and vault configuration. It is not a
  trust store and must not be treated as a secure secret vault.
- CORS is a browser-origin filter, not authentication. A permitted browser
  origin is not a trusted user, device, node, or process.
- Non-local backend binding remains unsafe in V1. It requires explicit
  `AREPO_HOST` configuration and must continue to print a no-auth warning.
- Reverse proxy, LAN, and internet exposure are unsupported for untrusted
  clients until authentication, authorization, audit, revocation, and tests
  exist.

## Threat Model

AREPO's future protected modes must account for these threats before the
backend can make network-safety claims.

- Malicious web page: a page opened in the user's browser may attempt cross-site
  requests to a localhost or LAN AREPO backend.
- Untrusted LAN client: another device on the same network may attempt to read,
  write, delete, enumerate, or reindex vault content.
- Reverse proxy exposure: a proxy may accidentally publish an unauthenticated
  backend to a wider network.
- Local same-user process: another process running as the same OS user may call
  localhost APIs or read local config files.
- Local malware: malware with user-level filesystem access can usually read
  vaults, configs, app data, and tokens; AREPO cannot fully defend against this.
- Stolen token: copied tokens or device credentials can be replayed unless
  tokens are scoped, auditable, rotatable, and revocable.
- Confused deputy access to user vaults: a trusted UI, proxy, extension, or node
  may trick AREPO into using its filesystem privileges on unintended content.
- CSRF and browser-origin risks: cookie-authenticated endpoints may be invoked
  by unwanted browser requests unless CSRF controls and origin checks exist.
- Overbroad CORS: wildcard or broad origin rules can let untrusted web pages
  read API responses in browsers.
- Accidental permission escalation: vault permissions or node permissions may
  drift from read-only to write/delete capability without clear user intent.
- Unsafe delete/write exposure: write and delete APIs affect user-owned source
  files, so protected modes need stricter gates than read-only index access.
- Remote-node impersonation: a peer may claim to be a registered node or replay
  a stale node credential.

The model assumes AREPO cannot protect files from an attacker who already has
the same OS-level access as the user. Protected modes are still valuable because
they can reduce browser, LAN, proxy, token replay, and remote-node risks.

## Deployment Modes

### Local-Only Single-User Mode

Implemented today. The backend binds to localhost and serves one local user.
This mode keeps `auth.mode = "disabled"` by default because the compatibility
boundary is localhost-only. It must continue to warn that non-local exposure is
unsafe.

### Single Self-Hosted Node For Trusted Devices

Future protected mode. One AREPO backend serves selected trusted devices on a
trusted network. It requires token or session enforcement, origin controls,
vault-level authorization, audit logging, revocation, and startup checks before
AREPO can describe it as safer than V1.

### Future Hub UI

Future local or self-hosted UI that lists multiple known nodes. A hub must not
infer trust from network discovery. Each node relationship needs explicit
registration, identity, scope, and revocation.

### Future Remote Registered Nodes

Future nodes that have explicit identity and scoped permissions. Registration
must be authenticated, auditable, revocable, and resistant to impersonation.

### Future Read-Only Archive Node

Future node intended for browsing and search without mutation. It should default
to `readIndex` only, optionally add `readContent`, and never grant
`writeContent` or `deleteFiles`.

### Future AI Enrichment Node

Future node that may read content and produce generated summaries, embeddings,
tags, aliases, or proposed links. It needs explicit enrichment permissions,
clear provenance, generated-data storage boundaries, and a way to disable or
revoke enrichment access.

### Future Mobile Browse Node

Future low-trust client optimized for reading. It should receive minimal scoped
access, short-lived credentials where practical, and no delete permission.

## Candidate Auth Approaches

| Approach | Status | Reasoning |
| --- | --- | --- |
| Local pairing token | Accepted for first protected-mode design | A one-time or short-lived pairing code can add a trusted browser/device without requiring hosted accounts. It should be generated locally, shown only to the user, time-limited, and exchanged for a scoped credential. |
| Long-lived API token | Deferred with restrictions | Useful for CLI tools, scripts, and non-browser clients, but risky if copied into shells, logs, vaults, or sync folders. If added, it must be scoped, named, auditable, rotatable, and revocable. |
| Short-lived session token | Accepted for browser protected mode | Fits browser UI use and limits replay duration. It needs renewal rules, logout, expiration, audit events, and storage decisions. |
| Signed node tokens | Deferred until remote nodes | Appropriate for registered nodes because credentials can include node identity, scope, expiry, and signature verification. It should wait until node registration is explicitly designed. |
| mTLS | Deferred | Strong for node-to-node and enterprise deployments, but operationally heavy for normal users. It may be valuable later as an advanced protected-mode option. |
| Reverse-proxy delegated auth | Deferred and never sufficient by itself | Useful for some self-hosters, but AREPO should not trust only proxy headers unless deployment rules, header stripping, allowed proxy addresses, audit, and fallback behavior are designed. |
| Browser cookie sessions | Accepted only with CSRF design | Ergonomic for the UI, but cookies create CSRF concerns. Cookie sessions need SameSite settings, CSRF tokens or equivalent checks, origin validation, and clear separation from header-token API clients. |

No approach should be implemented by silently making non-local binding safe.
Protected mode needs explicit config, status reporting, tests, and warnings.

## Authorization Model

Authorization should be layered. Authentication answers who or what is calling;
authorization answers which node, vault, and operation that caller may use.

- Node-level trust: each future browser/device/node credential should bind to a
  named local device, remote node, service, or session. Unknown nodes get no
  access.
- Vault-level permissions: each credential should be scoped to specific vaults
  rather than all configured roots by default.
- Operation-level permissions: each credential should declare allowed operations
  within each vault.
- Existing permissions: `readIndex`, `readContent`, `writeContent`, and
  `deleteFiles` remain the base vocabulary.
- Future enrichment permissions: likely separate permissions for reading
  enrichment inputs, writing generated enrichment data, proposing source-file
  edits, approving generated changes, clearing generated data, and managing
  enrichment policy.
- Future remote-node permissions: likely separate permissions for node status,
  node registration, node heartbeat, node metadata, vault listing, and remote
  browsing.
- Read-only node behavior: read-only nodes should default to `readIndex`, add
  `readContent` only by explicit user choice, and reject write, rename, create,
  folder-create, delete, and reindex-mutation operations.
- Least-privilege defaults: new credentials should start with no vault access or
  read-only access to a selected vault. Delete should remain opt-in and rare.

The future model should avoid multi-user RBAC unless a later design explicitly
introduces it. AREPO's first protected mode should be device/node scoped, not a
hosted user-management system.

## Protected-Mode Route Authorization Map

This route map is now the enforcement source for protected mode. V1 still must
not be exposed to untrusted networks.

Protected mode evaluates authorization after bearer credential verification.
CORS must not replace these checks. A request from an allowed browser origin
still needs a valid credential and the required node, vault, and operation
permission.

Planned permission vocabulary:

- `readIndex`: read generated index metadata, structural map data, validation
  results, watcher/index status, and generated storage/cache summaries for an
  authorized vault.
- `readContent`: read source Markdown file content or source-file-derived data
  that is close enough to content to require source access.
- `writeContent`: create or modify source files, source folders, filenames, or
  generated index state for an authorized vault.
- `deleteFiles`: delete source files. This should remain separate from general
  write access.
- `manageVaults`: add, remove, or change configured vault registrations and
  vault-level permissions.
- `manageNode`: view or change node-level diagnostics and runtime posture that
  is broader than a single vault.
- `manageAuth`: change auth mode, create credentials, revoke credentials, rotate
  node secrets, and manage protected-mode security state.
- `readAudit`: read future auth, node, vault, and mutation audit events.

Generated-index access is not the same as source-content access. Generated
index endpoints may expose paths, titles, headings, tags, wikilinks, backlinks,
broken links, duplicate IDs, duplicate anchors, issue messages, and generated
metadata. They should require `readIndex`, but not automatically require
`readContent`. Direct source file reads require `readContent`. Source file
mutations require `writeContent`, and deletes require `deleteFiles`.

### Future Protected Responses

`backend/protectedResponsePlanner.ts` is unmounted scaffolding for future
protected-mode HTTP responses. It does not reject active requests and is not
imported by active route handlers. The planned response categories are:

- `allow`: protected handler may continue after authentication, authorization,
  bearer revocation, and confirmation checks pass.
- `reduced-anonymous`: reduced health/status response with no vault
  roots, filesystem paths, credential IDs, session IDs, source content, or
  detailed runtime inventory.
- `unauthenticated`: 401-style response for missing, malformed, not-found,
  expired, or revoked bearer credential material.
- `unauthorized`: 403-style response for authenticated credentials that lack
  route, node, or vault permissions.
- `csrf-required` and `origin-rejected`: future browser-session rejection plans
  for missing/failed CSRF or untrusted/missing origin where origin is required.
- `stronger-confirmation-required`: 428-style response for confirmation-gated
  protected routes when normal permission is present but explicit operator
  confirmation is still needed.
- `not-found-or-unknown-route`: fail-closed response when a route is not covered
  by the protected route inventory.
- `service-unavailable-or-not-ready`: 503-style response for protected-mode
  startup/store readiness failures.

Protected-mode responses are sanitized and keep `networkExposureSafe: false`.
Live protected-mode responses may report active enforcement where appropriate;
dry-run and planning responses must keep their observation-only posture clear.
Responses must not include raw bearer tokens, session secrets, authorization
header values, cookies, verifier hashes/salts, vault roots, filesystem paths,
source document bodies, credential IDs, session IDs, token IDs, or audit event
IDs.

| Current endpoint | Current behavior | Future protected-mode requirement | Notes |
| --- | --- | --- | --- |
| `OPTIONS *` | CORS preflight response | No content permission; origin policy only | A successful preflight must never authorize the following request. |
| `GET /api/health` | Local node health and node identity | Anonymous reduced response only, or `manageNode` for current full node identity | In protected mode, anonymous health should expose only service liveness and that auth is required. Full node identity should require auth. |
| `GET /api/node/status` | Node diagnostics, runtime posture, startup warnings, vault counts, capability flags, auth posture | `manageNode` for the full current response | A reduced anonymous status may report only liveness, protected-mode requirement, and safe public warnings. It must not expose vault names, roots, counts, origins, or detailed runtime diagnostics. |
| `GET /api/node/auth/dry-run` | Sanitized dry-run canary diagnostics for observation-only protected-request planning | `manageNode` for full protected-mode diagnostics; deliberately reduced anonymous canary may exist | Current response omits credential details, vault roots, filesystem paths, source bodies, raw headers, and raw cookies. It is not authoritative and must not imply enforcement or network safety. |
| `GET /api/vaults` | List configured vaults and permissions | `readIndex` for each returned vault, plus `manageVaults` for full registration metadata | A non-admin credential should see only vaults it can access and should not receive filesystem roots unless explicitly allowed. |
| `POST /api/vaults` | Register a local vault and build its generated index | `manageVaults` and local-operator confirmation | Adding a vault expands AREPO filesystem reach and should be treated as administrative. |
| `DELETE /api/vaults/:vaultId` | Remove a vault registration from AREPO; optionally discard verified AREPO-generated cache for that vault | `manageVaults` and local-operator confirmation | Removal must unregister the vault without deleting the vault folder, source files, attachments, or user-authored Markdown. Generated-data discard must only target verified AREPO-owned vault-specific cache. |
| `GET /api/vaults/:vaultId/files` | List Markdown files and folders in a vault | `readIndex` on that vault | File and folder names are index-like metadata, not source body content. |
| `GET /api/vaults/:vaultId/file?path=...` | Read source Markdown file content and metadata | `readContent` on that vault | Path safety checks still apply before and after auth enforcement. |
| `GET /api/vaults/:vaultId/status` | Vault watcher/index status; optional file status for `path` | `readIndex`; require `readContent` when a specific source `path` is requested | File-level status can reveal existence, size, timestamp, hash, and conflict state for a source file. |
| `GET /api/vaults/:vaultId/storage` | Storage summary for vault content and generated cache | `readIndex` on that vault | It exposes aggregate sizes and generated-cache paths, not file bodies. Future per-file storage details may need stronger checks. |
| `PUT /api/vaults/:vaultId/file?path=...` | Write source Markdown file content; may overwrite after conflict parameters | `writeContent` and `readContent` on that vault | Conflict overwrite should require a fresh confirmation token or equivalent explicit user confirmation in addition to permission. |
| `POST /api/vaults/:vaultId/file` | Create a source Markdown file | `writeContent` and `readContent` on that vault | Creation writes source content and should keep path safety and collision checks. |
| `POST /api/vaults/:vaultId/folder` | Create a source folder | `writeContent` on that vault | Folder creation changes source tree shape but does not require reading file bodies. |
| `POST /api/vaults/:vaultId/rename` | Rename source file or folder | `writeContent` and `readContent` on that vault | Rename can overwrite namespace expectations and should preserve conflict/path checks. |
| `DELETE /api/vaults/:vaultId/file?path=...` | Delete a source file | `deleteFiles`, plus `writeContent` and `readContent` on that vault | Delete should require stronger confirmation or a delete-specific grant; `writeContent` alone is not enough. |
| `POST /api/vaults/:vaultId/reindex` | Rebuild generated machine index from source Markdown | `readIndex` and `readContent` on that vault | Reindex reads source files to produce generated metadata. It does not write source Markdown. |
| `GET /api/vaults/:vaultId/index` | Read generated machine index | `readIndex` on that vault | Generated index data is rebuildable and non-canonical, but can reveal sensitive metadata. |
| `GET /api/vaults/:vaultId/index/filters?filter=...` | Read generated structural filter results | `readIndex` on that vault | Includes broken links, orphan notes, tags, folders, duplicate IDs, and duplicate anchors. |
| `GET /api/vaults/:vaultId/index/search?q=...` | Search generated index fields | `readIndex` on that vault | Searches index metadata, not full source content. Future full-text search should require `readContent`. |
| `GET /api/vaults/:vaultId/index/inspect?path=...` | Inspect generated metadata for one indexed note | `readIndex` on that vault | Includes headings, anchors, links, backlinks, tags, duplicate metadata, and issues; it should not return source body content. |
| Future auth management routes | Not implemented | `manageAuth` | Token creation, pairing, revocation, auth mode changes, and node secret rotation should never be covered by vault permissions. |
| Future audit routes | Not implemented | `readAudit`, with `manageNode` or `manageAuth` for sensitive audit scopes | Audit may reveal paths, node identities, denied operations, and security events. |

### Reduced Anonymous Status

Protected mode should not keep the current full anonymous status responses. A
future protected backend may expose:

- `GET /api/health`: anonymous liveness, API version, and a boolean such as
  `authRequired`.
- `GET /api/node/status`: either require `manageNode` for the current full
  diagnostics response, or return a reduced anonymous response with no vault
  details, no filesystem paths, no configured CORS origins, and no credential
  inventory.

Full status without credentials is acceptable only in disabled local
compatibility mode because the backend binds to localhost by default and still
warns against non-local exposure. Protected mode returns reduced anonymous
status unless a valid authorized bearer token is supplied.

### Least-Privilege Credential Defaults

- Read-only archive credential: `readIndex` by default for selected vaults;
  optionally `readContent`; never `writeContent`, `deleteFiles`, `manageVaults`,
  `manageNode`, `manageAuth`, or `readAudit`.
- Normal trusted browser credential: `readIndex`, `readContent`, and
  `writeContent` for selected vaults; no `deleteFiles` unless explicitly added;
  no `manageAuth`; limited or no `manageNode` unless diagnostics are deliberately
  part of the trusted-browser role.
- Admin/local operator credential: `manageNode`, `manageVaults`, `readAudit`,
  and selected vault permissions; `manageAuth` only when the operator is
  changing protected-mode state; `deleteFiles` remains explicit.
- Future enrichment node credential: `readIndex` plus narrowly scoped
  `readContent` for eligible vaults or paths; future enrichment-write
  permissions for generated data only; no source `writeContent`, `deleteFiles`,
  `manageVaults`, `manageNode`, or `manageAuth` by default.

### Stronger Confirmation Operations

Some operations should require more than a valid credential carrying a broad
permission:

- Delete: require `deleteFiles`, a delete-specific confirmation, and audit.
- Overwrite after conflict: require `writeContent`, `readContent`, current
  conflict context, and explicit user confirmation.
- Vault registration, removal, root path changes, and vault permission changes:
  require `manageVaults`, local-operator intent, and audit.
- Auth mode changes, token creation, token revocation, session revocation, and
  node secret rotation: require `manageAuth`, local-operator intent, and audit.
- Non-local bind with disabled auth: should remain warned or refused depending
  on future protected-mode policy; it must never be considered safe because of
  CORS.

The next implementation slice should be a type-only route permission inventory
or tests around a pure authorization planner. It should not enforce requests
until credential parsing, auth storage, audit, revocation, and CSRF/origin
policy are designed.

## Audit And Event Model

Protected modes need a local audit trail before AREPO can support revocation and
incident recovery. Audit data should live outside Markdown vaults and should not
be treated as source content.

Events to record:

- auth attempt accepted or rejected
- pairing started, completed, expired, or cancelled
- token, session, or node credential created
- token, session, or node credential used
- token, session, or node credential revoked
- node secret rotated
- vault registration added, changed, or removed
- vault permission changed
- file created, written, renamed, or deleted
- delete attempt rejected or accepted
- path traversal, symlink escape, or unsafe path rejected
- non-local bind startup detected
- remote-node registration attempted, accepted, or rejected
- CORS or origin rejection
- auth configuration changed
- enrichment-policy changed when enrichment policies exist

Audit records should include timestamp, actor identity when known, node/session
identity when known, vault ID when relevant, operation, result, and a stable
reason code for rejection. They should avoid storing full document contents.

## Revocation And Recovery

Protected modes need clear local recovery actions.

- Revoke token/device/node: invalidate one credential without changing all
  others; record the revocation in audit.
- Rotate node secret: replace the local signing or node secret and invalidate
  credentials derived from the old secret.
- Disable non-local access: switch bind host back to `127.0.0.1` or refuse
  protected-mode startup until the operator explicitly re-enables it.
- Emergency local-only reset: remove active credentials and force
  `auth.mode = "disabled"` only with localhost binding, preserving vault config
  where practical.
- Lost-token recovery: require local filesystem or console access to create a
  new credential; do not support cloud recovery for the first implementation.
- Compromised-device response: revoke that device, rotate shared secrets if
  needed, inspect audit events, and review vault permissions.
- Removing a remote node: revoke node credentials, disable node-specific access,
  keep historical audit entries, and require fresh registration for rejoin.
- Audit trail preservation: revocation should not delete audit history. Audit
  retention and pruning need an explicit policy later.

## Secret And Config Model

AREPO needs a clear boundary between user-editable config, app data, secrets,
and source vault content.

- Secrets may live in a local app-data directory controlled by AREPO, not in
  Markdown vaults.
- Generated secret files should be created with owner-only permissions where the
  operating system supports it.
- `.arepo/config.json` may store non-secret posture and references such as
  node ID, display name, mode, app data path, vault roots, vault permissions,
  bind host, and whether protected mode is intended.
- `.arepo/config.json` should not store plaintext long-lived bearer tokens,
  pairing secrets, private keys, session secrets, password hashes, recovery
  secrets, OAuth tokens, or remote-node private credentials.
- App data may store generated indexes, caches, audit logs, token metadata,
  hashed token verifiers, public node metadata, revocation state, and local
  secret files.
- Markdown vaults must never store AREPO auth secrets, remote-node credentials,
  session data, private keys, pairing codes, or token recovery material.
- Backup and sync tools may copy app data if the user configures them that way.
  Docs and UI should warn that copying app data can copy active credentials or
  audit records.
- Copying `.arepo/config.json` to another machine should be treated as copying
  vault paths and posture, not as safely pairing a new device.

See [Credential Storage Design](credential-storage-design.md) for the future
protected-mode credential storage and lifecycle design. That design is not
implemented and does not make non-local exposure safe.

## Browser And API Security

- CORS is not authentication. It controls which browser origins can read
  responses, but it does not prove the caller is trusted.
- A malicious page may still try to send requests to localhost or LAN services.
  Future protected modes need auth checks on every protected endpoint.
- Cookie sessions are convenient for browser UI but require CSRF protection,
  SameSite policy, logout, expiration, and origin checks.
- Header tokens are better for CLI/API clients and avoid ambient browser cookie
  behavior, but they are easy to leak into logs, shell history, scripts, and
  copied configs.
- Localhost assumptions apply only to local-only mode. Once the backend binds to
  a non-local address, AREPO must assume untrusted clients can reach it.
- Origin checks should complement, not replace, token or session verification.
- Preflight behavior is not a security boundary. Passing an OPTIONS preflight
  must not grant access to the actual operation.
- Browser UI and API clients may need different auth paths: browser sessions for
  normal UI use, header tokens for scripts and integrations, and node tokens for
  future node-to-node communication.

See [Browser Session Security Design](browser-session-security-design.md) for
the future CSRF, origin, and cookie-session request policy. Browser-session
auth is not implemented and does not make non-local exposure safe.

## Explicit Non-Goals For First Auth Implementation

- no hosted auth
- no cloud account
- no federation
- no sync
- no multi-user RBAC unless explicitly designed later
- no database requirement
- no LAN, reverse-proxy, or internet safety claims until implemented and tested
- no weakening of vault path safety
- no OAuth provider requirement
- no password account system for the first local protected-mode slice
- no remote-node registration in the first auth slice
- no change to Markdown save, write, rename, create, or delete semantics unless
  the operation is denied by an explicit future authorization check

## Recommended First Implementation Path

The smallest safe code slice after this design should describe auth posture
without enforcing credentials yet.

1. Add typed auth posture/config fields and status reporting.
2. Keep the default `auth.mode = "disabled"` for local-only mode.
3. Report whether the backend is in local-only disabled-auth mode or an
   explicitly configured future protected posture.
4. Preserve the existing non-local bind no-auth warning.
5. Add tests that prove status reporting does not claim auth is active and does
   not mark non-local binding as safe.
6. Design protected mode before token enforcement, including credential storage,
   audit events, revocation, CSRF posture, and permission checks.
7. Only after protected mode is designed, add token/session enforcement behind
   explicit config and tests.

The first implementation must not make LAN binding, reverse proxy exposure, or
internet exposure safe by declaration. AREPO should make a safety claim only
after every protected endpoint has authentication, authorization, audit,
revocation, startup warnings, and regression tests.
