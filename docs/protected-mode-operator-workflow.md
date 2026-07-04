# Protected Mode Operator Workflow

This is the local operator workflow for AREPO protected mode. Protected mode now
enforces request authorization for backend routes, verifies bearer tokens, uses
route permissions, returns reduced anonymous status, and writes sanitized audit
records.

Protected mode is still not a LAN, reverse-proxy, or internet safety claim. Run
it for local testing and deliberate operator workflows only. CORS is a browser
origin filter, not authentication.

Bearer tokens are secrets. Raw bearer tokens are shown only once during
bootstrap, create, or rotate responses. Do not paste real tokens into bug
reports, screenshots, docs, logs, commits, shell history you intend to share, or
chat transcripts.

AREPO does not currently provide browser login, browser sessions,
CSRF-protected browser authentication, frontend token storage, or a full
credential-management UI. The `x-arepo-confirmation: confirm` header is a
backend/operator confirmation signal for protected routes, not the final
browser UX.

## Configuration

Disabled mode remains the default compatibility mode:

```json
{
  "node": {
    "nodeId": "local",
    "displayName": "Local Node",
    "mode": "local",
    "apiVersion": 1
  },
  "auth": {
    "mode": "disabled"
  },
  "vaults": []
}
```

For protected-mode local testing, set `auth.mode` to `protected` in
`.arepo/config.json`:

```json
{
  "node": {
    "nodeId": "local",
    "displayName": "Local Node",
    "mode": "local",
    "apiVersion": 1
  },
  "appDataDir": "/absolute/path/to/arepo-data",
  "auth": {
    "mode": "protected"
  },
  "vaults": []
}
```

`appDataDir` is optional but recommended. AREPO writes generated indexes and
auth stores under app data, outside user vaults by default. You can also set
`AREPO_APP_DATA_DIR`; the environment variable takes precedence over config.

Supported backend runtime environment variables:

- `AREPO_HOST`: backend bind host. Defaults to `127.0.0.1`.
- `AREPO_PORT`: backend port. Defaults to `8734`.
- `AREPO_ALLOWED_ORIGINS`: comma-separated CORS allowlist additions.
- `AREPO_APP_DATA_DIR`: generated app data and auth store directory.

Optional diagnostic auth config fields:

```json
{
  "auth": {
    "mode": "protected",
    "dryRunRequestPolicy": false,
    "dryRunAudit": false
  }
}
```

`auth.requestedMode` may appear in older diagnostic configs. Operational
protected mode is controlled by `auth.mode`.

## Manual Acceptance Fixtures

The repository includes local protected-mode fixtures for repeatable operator
checks:

- Example config:
  `docs/examples/protected-mode.local.config.example.json`
- Curl-based script:
  `scripts/manual-protected-mode-check.sh`

To use the config template, copy or adapt its contents into `.arepo/config.json`
for a disposable local test workspace. Replace placeholder paths such as
`/absolute/path/to/arepo-protected-mode-app-data` with a real app-data directory
outside user vaults. The template contains no bearer tokens, credential records,
verifier hashes, salts, or audit records.

Start the backend with the normal local workflow:

```bash
npm run backend:dev:server
```

Then run the manual script against the local server:

```bash
./scripts/manual-protected-mode-check.sh
```

The script assumes protected mode is already running on
`http://127.0.0.1:8734`. Override only for another localhost URL:

```bash
AREPO_BASE_URL="http://127.0.0.1:8734" ./scripts/manual-protected-mode-check.sh
```

If the server has already been bootstrapped, provide an existing local operator
token. The script keeps it in memory and does not print it by default:

```bash
AREPO_TOKEN="paste-one-time-token-here" ./scripts/manual-protected-mode-check.sh
```

The script performs anonymous reduced status, bootstrap or supplied-token use,
authorized full status, missing/malformed/revoked-token failures, listing,
credential creation, wrong-confirmation denial, rotation, revocation, and
response sanitization checks. It requires `curl` and `jq`.

Audit logs are not discovered automatically. If you want the script to scan a
known local audit file, pass it explicitly:

```bash
AREPO_AUDIT_EVENTS="/absolute/path/to/arepo-data/auth/audit/events.jsonl" \
  AREPO_TOKEN="paste-one-time-token-here" \
  ./scripts/manual-protected-mode-check.sh
```

The script does not reset credentials, bypass bootstrap one-time behavior,
modify vault source files, store raw tokens on disk, test browser login, test
browser sessions, test CSRF, or make protected mode safe for LAN,
reverse-proxy, or internet exposure.

## Start Protected Mode

From the repository root:

```bash
npm run backend:dev:server
```

Use placeholders for tokens in shell examples:

```bash
AREPO="http://127.0.0.1:8734"
AREPO_TOKEN="paste-one-time-token-here"
```

Anonymous status is intentionally reduced in protected mode:

```bash
curl -s "$AREPO/api/node/status"
```

Before bootstrap, protected vault and file routes should deny anonymous access
instead of silently downgrading to disabled mode.

## Bootstrap First Credential

Bootstrap is localhost-only and only works while no active credentials exist.

```bash
curl -s -X POST "$AREPO/api/node/credentials/bootstrap" \
  -H 'content-type: application/json' \
  --data '{"label":"local operator"}'
```

The response contains `data.bearerToken` and `data.tokenType` exactly once.
Assign the token to `AREPO_TOKEN` for this local session:

```bash
AREPO_TOKEN="paste-one-time-token-here"
```

Running bootstrap again after an active credential exists should return a clean
denial and should not create another credential.

## Authorized Status

Full diagnostics require a valid authorized bearer token:

```bash
curl -s "$AREPO/api/node/status" \
  -H "authorization: Bearer $AREPO_TOKEN"
```

The full response may include safe credential lifecycle posture such as active,
revoked, and expired credential counts plus bootstrap availability. It must not
include raw tokens, verifier hashes, salts, authorization headers, cookies, or
verifier internals.

Full status may also report `browserSessionAuth.status = planning-only`.
Browser-session cookies are not accepted as live credentials, session issuance
is inactive, and CSRF enforcement is inactive in this slice.
The reserved browser-session, pairing, and CSRF routes return sanitized
unavailable responses; they do not issue cookies, create pairing codes, create
CSRF tokens, or provide browser login.

## List Credentials

```bash
curl -s "$AREPO/api/node/credentials" \
  -H "authorization: Bearer $AREPO_TOKEN"
```

The list includes safe metadata such as `credentialId`, `label`, `createdAt`,
`expiresAt`, `revokedAt`, `lastUsedAt`, permissions, vault grants, status, and
verifier/session counts. It does not include the raw bearer token, token hash,
salt, or verifier internals.

## Create Credential

Credential creation requires a valid bearer token with `manageAuth` and the
explicit confirmation header:

```bash
curl -s -X POST "$AREPO/api/node/credentials" \
  -H "authorization: Bearer $AREPO_TOKEN" \
  -H "x-arepo-confirmation: confirm" \
  -H 'content-type: application/json' \
  --data '{"label":"second local operator","nodePermissions":["manageNode"]}'
```

If permissions are omitted, AREPO creates a local operator credential using the
current backend defaults. The raw replacement token appears only in the create
response.

Optional expiry:

```bash
curl -s -X POST "$AREPO/api/node/credentials" \
  -H "authorization: Bearer $AREPO_TOKEN" \
  -H "x-arepo-confirmation: confirm" \
  -H 'content-type: application/json' \
  --data '{"label":"temporary operator","expiresAt":"2026-12-31T23:59:59.000Z"}'
```

## Rotate Credential

Set the credential id from a safe metadata listing:

```bash
CREDENTIAL_ID="paste-credential-id-here"
```

Rotate creates a replacement credential, revokes the old credential, and returns
the new raw bearer token exactly once:

```bash
curl -s -X POST "$AREPO/api/node/credentials/$CREDENTIAL_ID/rotate" \
  -H "authorization: Bearer $AREPO_TOKEN" \
  -H "x-arepo-confirmation: confirm" \
  -H 'content-type: application/json' \
  --data '{"label":"rotated local operator"}'
```

After rotation, the old bearer token should return sanitized `401` responses and
the new bearer token should authorize matching routes.

## Revoke Credential

```bash
curl -s -X POST "$AREPO/api/node/credentials/$CREDENTIAL_ID/revoke" \
  -H "authorization: Bearer $AREPO_TOKEN" \
  -H "x-arepo-confirmation: confirm" \
  -H 'content-type: application/json' \
  --data '{"reason":"local operator test"}'
```

Revocation is persistent. The revoked bearer token should no longer authorize
protected routes. Repeating revocation returns a clean idempotent result.

## Failure Checks

Missing bearer token:

```bash
curl -i "$AREPO/api/node/credentials"
```

Malformed bearer token:

```bash
curl -i "$AREPO/api/node/credentials" \
  -H "authorization: Bearer not-a-valid-token"
```

Wrong confirmation value:

```bash
curl -i -X POST "$AREPO/api/node/credentials" \
  -H "authorization: Bearer $AREPO_TOKEN" \
  -H "x-arepo-confirmation: wrong" \
  -H 'content-type: application/json' \
  --data '{"label":"should fail"}'
```

Expected results:

- Missing, malformed, expired, or revoked bearer tokens return sanitized `401`.
- Valid credentials without sufficient permission return sanitized `403`.
- Missing or wrong confirmation for confirmation-gated routes returns sanitized
  `428`.
- Reduced anonymous `GET /api/node/status` remains reduced.
- Error responses do not echo token material, confirmation header values,
  hashes, salts, authorization headers, cookies, or verifier internals.

## Audit Sanitization

Auth audit events are written under app data, normally:

```text
<appDataDir>/auth/audit/events.jsonl
```

Inspect audit records after bootstrap, create, rotate, revoke, and failed
authorization attempts. They should contain sanitized event kinds, results,
reason codes, and safe credential ids where needed. They must not contain raw
bearer tokens, token hashes, salts, authorization headers, cookies,
confirmation header values, verifier internals, vault source content, or source
Markdown.

## Remaining Limitations

- Disabled mode remains the default local compatibility mode.
- Protected mode does not make LAN, reverse-proxy, or internet exposure safe.
- Browser login is not implemented.
- Browser sessions are not accepted.
- Live CSRF enforcement is not wired because browser-session auth is not live.
- Frontend token storage is not implemented.
- There is no full credential-management UI.
- `x-arepo-confirmation: confirm` is a backend/operator signal, not final
  product UX.
- Remote node registration, federation, and sync are not implemented.
