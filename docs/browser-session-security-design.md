# Browser Session Security Design

This is a Phase 4 design note for future protected mode. AREPO does not
implement browser sessions, cookies, CSRF middleware, origin enforcement, token
enforcement, login, pairing, or auth middleware yet. The V1 backend remains
unauthenticated and must not be exposed to untrusted networks.

## Current V1 Posture

- The backend binds to `127.0.0.1` by default.
- There is no authentication and no session model.
- CORS is a browser-origin filter, not authentication.
- The existing allowed CORS origins only control which browser origins may read
  responses; they do not identify a trusted user, device, or node.
- Non-local binding remains unsafe. CORS allowlists, preflight handling, and
  frontend origin checks do not make LAN, reverse-proxy, or internet exposure
  safe.

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
- `Secure` cookies on HTTPS. Localhost development may need explicit handling
  because secure-cookie behavior differs between `http://localhost` and HTTPS
  deployments.
- Short expiry and server-side session records.
- Renewal rules that extend only valid, non-revoked sessions.
- Logout that revokes the server-side session and clears the browser cookie.
- Server-side revocation for compromised devices.
- Audit events for session creation, use, renewal, expiry, logout, and
  revocation.
- No plaintext session secret storage. Store only session verifier material.

Cookie sessions need CSRF protection because the browser can attach cookies to
requests the user did not intend.

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

| Class | Examples | Cookie session checks |
| --- | --- | --- |
| Reduced anonymous status | reduced `GET /api/health`, reduced `GET /api/node/status` | No session required; must expose minimal public data only. |
| Safe/read metadata | generated index, index filters, index search, storage summary, vault file listing | Session/auth required for protected data; CSRF usually not required for `GET`, but origin policy still applies for browser UI. |
| Source-content read | `GET /api/vaults/:vaultId/file` | Session/auth and `readContent`; CSRF usually not required for `GET`, but origin policy still applies. |
| Source mutation | write file, create file/folder, rename, reindex if triggered by browser session | Session/auth, authorization, origin check, and CSRF token. |
| Delete | delete file | Session/auth, `deleteFiles`, origin check, CSRF token, stronger confirmation, and audit. |
| Auth management | credential creation, revocation, auth mode changes, node-secret rotation | Session/auth, `manageAuth`, origin check, CSRF token, stronger confirmation, and audit. |
| Vault management | vault registration/removal, vault permission changes | Session/auth, `manageVaults`, origin check, CSRF token, local-operator confirmation, and audit. |
| Audit read | future audit endpoints | Session/auth, `readAudit`, origin check; CSRF not normally required for `GET`, but responses may reveal sensitive security metadata. |

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

The next implementation slice should remain inert:

1. Add typed browser security policy metadata and pure helper tests for request
   classification, cookie-vs-header-token posture, CSRF requirement planning,
   and reduced anonymous status decisions.
2. Do not add middleware.
3. Do not add cookies or sessions.
4. Do not generate tokens.
5. Do not enforce origin or CSRF checks yet.
6. Do not claim LAN, reverse-proxy, or internet exposure is safe.

Actual enforcement should wait until session storage, credential verification,
audit writing, revocation checks, CORS/origin policy, and route authorization are
implemented and tested together.
