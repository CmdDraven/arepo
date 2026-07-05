# Browser Auth Dependency Evaluation

Phase 4 currently has strong browser-auth planning and dark-path test
infrastructure, but live browser auth remains inactive. This evaluation pauses
further custom production browser-auth work and asks whether AREPO should
delegate final live session mechanics to a mature library or protocol.

No behavior changes are proposed by this document. Protected mode remains
bearer-token based. Browser sessions, cookies, pairing codes, and CSRF tokens
are not issued or accepted by live HTTP routes.

## Repo Facts

- AREPO uses a custom Node HTTP routing layer in `backend/server.ts`, centered
  on `routeRequest()`. It is not currently an Express app.
- `package.json` has no runtime auth/session library such as `express-session`,
  Auth.js, Better Auth, Passport, or an OIDC client.
- `auth.mode = "protected"` already enforces bearer-token authorization for
  protected API/operator requests.
- Browser-session and pairing routes exist only as inactive stubs.
- The browser-auth dark path already models AREPO-specific invariants:
  activation gates, route contracts, pairing semantics, CSRF expectations,
  cookie policy, audit sanitization, request-shape adaptation, and inactive
  boundary tests.
- The current custom dark-path code is useful as acceptance criteria, but it
  should not automatically become the production auth/session mechanism.

## Requirements

Any live browser-auth foundation must satisfy these AREPO constraints:

- Local-first default behavior and disabled-auth compatibility remain intact.
- Localhost-only browser login/pairing can work without cloud identity.
- Self-hosted single-node deployment is possible later without claiming LAN or
  reverse-proxy safety early.
- No bearer token, session secret, pairing code, CSRF token, cookie value, hash,
  salt, or verifier internals are stored in frontend storage, logs, status, or
  audit records.
- Session expiry, logout, revoke-current, revoke-all, and revocation semantics
  are explicit and testable.
- CSRF protection exists before cookie-authenticated unsafe requests are live.
- Route permissions remain AREPO-owned through `backend/routePermissions.ts`.
- Activation remains gated by AREPO's preflight/config policy/inactive-boundary
  tests.
- Local operator bootstrap and pairing remain deliberate, auditable flows.

## Options

### Continue Bearer-Token Protected Mode Only

Fit:

- Strong fit for local operator/API workflows already implemented.
- Works without cookies, browser sessions, CSRF, frontend token storage, cloud
  identity, or new dependencies.
- Keeps the current security boundary simple.

Gaps:

- Poor browser UX unless users manually supply tokens.
- Does not solve a normal browser login/session experience.
- Long-lived bearer tokens remain easy to leak through shell history, scripts,
  copied commands, or screenshots.

Assessment:

This is the safest short-term fallback. It should remain the operational
protected mode until a browser-auth foundation is deliberately chosen.

### `express-session` Or Comparable Server-Side Session Middleware

Fit:

- Good conceptual fit for server-side session IDs in cookies.
- Supports cookie attributes such as `HttpOnly`, `Secure`, `SameSite`, `Path`,
  and custom cookie names.
- Supports server-side session stores and explicit session destruction.
- Keeps session data server-side rather than in frontend storage.

Risks and integration cost:

- AREPO is not currently an Express application. Adopting `express-session`
  would likely mean adding Express or writing a careful adapter around the
  current `routeRequest()` shape.
- The default `MemoryStore` is explicitly not production-ready, so AREPO would
  still need a deliberate app-data-backed or SQLite-backed store.
- It does not provide AREPO's pairing UX, route permissions, activation gates,
  audit policy, CSRF model, or status posture.
- CSRF remains AREPO's responsibility unless paired with another package.

Assessment:

Good backup direction if AREPO chooses a small, traditional server-side session
core. It is not the lowest-friction path for the current custom router.

### Auth.js

Fit:

- Supports multiple frameworks and has an Express integration.
- Supports JWT and database session strategies.
- Database sessions align with revoke-current/revoke-all better than stateless
  JWT sessions.
- Strong fit for OAuth/social/OIDC-style login if AREPO later supports external
  identity providers.

Risks and integration cost:

- It is oriented around provider-based sign-in. AREPO's first desired browser
  path is local pairing from an existing bearer credential, not a hosted account
  or OAuth provider.
- The documented Express integration does not match AREPO's current custom Node
  HTTP router directly.
- Auth.js is now presented as part of Better Auth, so new work should compare
  it against Better Auth before adopting it.
- AREPO would still keep custom activation gates, pairing UX, route contracts,
  route permissions, audit policy, and inactive-boundary tests.

Assessment:

Useful if AREPO later prioritizes OAuth/OIDC providers. It is not the preferred
first local-only browser-session foundation.

### Better Auth

Fit:

- Strongest candidate for a focused integration spike.
- TypeScript-first and framework-agnostic.
- Offers standard `Request`/`Response` handler integration plus helper
  functions for Node/Express and TanStack Start.
- Provides account/session management, cookie handling, session expiry, session
  listing, revoke session, revoke other sessions, and revoke all sessions.
- Supports database-backed sessions and stateless modes.
- Cookie settings are configurable, and the docs explicitly discuss signed
  cookies, secure cookies, custom cookie names/attributes, and trusted origins.

Risks and integration cost:

- Better Auth is a full auth framework, not just a session-cookie primitive.
  AREPO must avoid accidentally adopting cloud/social/account assumptions into
  the local-first path.
- Its database/schema model may be heavier than AREPO wants unless an app-data
  SQLite path is selected intentionally.
- Stateless mode weakens immediate revocation unless constrained carefully.
- AREPO must verify CSRF behavior and whether Better Auth covers the exact
  unsafe-method model needed for local cookie-authenticated API requests.
- AREPO's pairing flow, route permission model, activation gate, audit policy,
  and inactive-boundary regression suite should remain custom.

Assessment:

Preferred dependency spike. The `Request`/`Response` style is closer to AREPO's
current custom router than Express middleware, and the session/revocation/cookie
feature set maps well to AREPO's browser-auth acceptance criteria.

### OIDC/OAuth Through External Identity Provider

Fit:

- Strong standard for external identity. OpenID Connect defines an identity
  layer on top of OAuth 2.0 for verifying an end user via an authorization
  server.
- Useful for future self-host deployments where an operator already has an
  identity provider.
- Delegates login security, MFA, account recovery, and SSO to mature systems.

Gaps:

- Poor fit for local-first default behavior.
- Requires external accounts or a self-hosted identity provider.
- Does not by itself define AREPO's local session store, route permissions,
  CSRF posture, pairing UX, audit details, or inactive activation gate.
- Increases deployment complexity before AREPO has a stable local browser-auth
  path.

Assessment:

Future optional integration, not the first browser-auth activation foundation.

### Continue Custom AREPO Browser Auth For Everything

Fit:

- Maximum control over local-first pairing, vault-specific permissions,
  operator confirmation, audit records, and activation gates.
- Existing dark-path tests already cover many AREPO-specific boundaries.

Risks:

- High risk of subtle production security mistakes in session cookies, CSRF,
  revocation race behavior, secret rotation, replay handling, and browser edge
  cases.
- Requires AREPO to maintain code that mature libraries have already tested
  across more deployments.
- More custom code means a larger activation surface to prove safe before live
  browser auth.

Assessment:

Do not hand-roll the final production browser-auth/session mechanism. Keep the
custom code where AREPO is genuinely unique: route contracts, activation gates,
pairing UX, audit policy, consent/confirmation, vault permission integration,
and inactive-boundary regression tests.

## Recommendation

Preferred direction:

1. Keep bearer-token protected mode as the only live auth path for now.
2. Do not continue turning AREPO's custom dark-path session/cookie primitives
   into the production browser-auth engine.
3. Run an isolated Better Auth integration spike next, without installing it as
   a live dependency or mounting any route.
4. Treat the existing dark-path code as acceptance criteria and boundary tests
   for any adopted library.

Decision follow-up:

- [Browser Auth Foundation Decision](browser-auth-foundation-decision.md)
  selects Better Auth as the preferred isolated compatibility target.
- [Better Auth Compatibility Spike](better-auth-compatibility-spike.md)
  records the requirement fit, blockers, open questions, and proof tests for the
  next dependency spike.
- `better-auth@1.6.23` is now installed for
  `backend/betterAuthDependencyProof.ts`, an isolated test-only proof. It is not
  mounted in the live backend, does not change bearer-token protected mode, and
  does not enable browser auth.

Backup direction:

- If Better Auth proves too broad or too invasive, evaluate a smaller
  server-side session core such as `express-session` plus a deliberate
  AREPO-owned CSRF package/model and app-data-backed session store. This likely
  requires either Express adoption or a custom adapter.

Rejected for first browser-auth activation:

- Auth.js as the first local-only browser path: provider-oriented and less
  directly aligned with AREPO's custom Node router than Better Auth's standard
  handler model.
- OIDC/OAuth as the default local browser path: excellent for future external
  identity, but too operationally heavy for local-first default behavior.
- Fully custom production browser auth: unnecessary risk in browser session and
  CSRF mechanics.

## What Should Remain Custom

Even if AREPO adopts a mature auth/session library, these parts should remain
AREPO-owned:

- `auth.mode` compatibility and protected-mode fail-closed posture.
- Vault and node route permission policy.
- Local credential bootstrap and bearer-token operator workflow.
- Pairing UX and operator consent semantics.
- Activation config policy, activation gate, and preflight blockers.
- Browser-auth route contracts and inactive stubs until activation.
- Audit event allowlists and secret redaction policy.
- Reduced anonymous status behavior.
- Inactive-boundary regression suite.
- Manual acceptance fixtures and local-first deployment warnings.

## Safest Next Slice

Add a dependency decision-record/integration-spike slice that does not enable
auth:

- Define a `docs/browser-auth-foundation-decision.md` ADR selecting the
  preferred foundation for an isolated spike.
- If Better Auth is selected, create a test-only adapter design that maps an
  AREPO dark-harness pairing completion into Better Auth-style session
  requirements without mounting routes.
- Decide whether the proof needs a real dependency install or can be modeled
  from official APIs first.
- Define acceptance criteria: no live route mounting, no live `Set-Cookie`, no
  cookie credential acceptance, no frontend storage, no bearer-token behavior
  changes, and inactive-boundary tests remain green.

## Medium-Term Integration Path

1. Choose the foundation in a decision record.
2. Build an isolated test-only module that exercises the chosen library's
   session creation, session lookup, logout, revocation, and cookie attributes
   outside `server.ts`.
3. Add a compatibility adapter from library session identity to AREPO route
   permissions, still unmounted.
4. Add CSRF verification tests for unsafe cookie-backed requests, still
   unmounted.
5. Extend inactive-boundary tests to forbid accidental mounting.
6. Only then consider a disabled-live route mounting slice guarded by
   activation config and preflight blockers.

## Sources Checked

- Express session middleware:
  <https://expressjs.com/en/resources/middleware/session/>
- Auth.js overview and session strategies:
  <https://authjs.dev/> and
  <https://authjs.dev/concepts/session-strategies>
- Better Auth introduction, installation, sessions, cookies, and Express
  integration:
  <https://better-auth.com/docs/introduction>,
  <https://better-auth.com/docs/installation>,
  <https://better-auth.com/docs/concepts/session-management>,
  <https://better-auth.com/docs/concepts/cookies>, and
  <https://better-auth.com/docs/integrations/express>
- OpenID Connect Core:
  <https://openid.net/specs/openid-connect-core-1_0.html>
