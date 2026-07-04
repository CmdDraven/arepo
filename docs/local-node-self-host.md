# Local Node And Self-Host Notes

AREPO V1 is a single local node. It can be experimented with on a self-hosted
machine. Disabled auth remains the default compatibility mode, and protected
mode supports local bearer-token API/operator workflows, but AREPO still must
not be exposed to untrusted networks.

## Runtime Configuration

The backend defaults are intentionally local-only:

```text
AREPO_HOST=127.0.0.1
AREPO_PORT=8734
```

The frontend dev UI defaults to:

```text
http://localhost:8733
```

Supported environment variables:

- `AREPO_HOST`: backend bind host. Non-local values such as `0.0.0.0` print a
  warning. Protected mode is not a LAN or internet safety claim.
- `AREPO_PORT`: backend TCP port. Must be an integer from `1` to `65535`.
- `AREPO_ALLOWED_ORIGINS`: comma-separated browser origins allowed by CORS.
- `AREPO_APP_DATA_DIR`: generated app data/cache directory.
- `AREPO_NO_OPEN_TERMINAL`: disables the helper that tries to open a second
  terminal for frontend targets.

Example alternate frontend origin:

```bash
AREPO_ALLOWED_ORIGINS=http://localhost:9001 npm run backend:dev
npm run dev -- --port 9001
```

Do not use wildcard CORS.

## Local Config File

Vault configuration lives in `.arepo/config.json` in the project directory for
development. A minimal config looks like this:

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
  "appDataDir": "/absolute/path/to/arepo-data",
  "vaults": [
    {
      "id": "notes",
      "displayName": "Notes",
      "rootPath": "/absolute/path/to/notes",
      "permissions": {
        "readIndex": true,
        "readContent": true,
        "writeContent": true,
        "deleteFiles": false
      }
    }
  ]
}
```

V1 supports only `mode: "local"`. Vault roots must exist, be absolute paths, and
be readable by the backend process. Delete permission should remain disabled
unless the user explicitly accepts that risk.

For protected-mode local testing, set `auth.mode` to `"protected"` and follow
[Protected Mode Operator Workflow](protected-mode-operator-workflow.md). Do not
store raw bearer tokens in config or vault files. A disposable local template is
available at `docs/examples/protected-mode.local.config.example.json`, and the
curl-based manual fixture is `scripts/manual-protected-mode-check.sh`.

## What The Local Node Owns

The local node owns:

- configured vault roots
- generated disposable machine indexes and cache files
- file watcher state
- local mutation safety checks
- atomic note writes where practical
- storage reporting
- runtime health and vault status

The local node does not own source custody. Markdown files remain normal files on
disk. Sync, history, and backups remain external responsibilities handled by
tools such as Syncthing, Git, Borg, Restic, or Kopia.

## Single-Node Self-Host Checklist

Use this only on trusted machines and trusted networks. Protected mode enforces
local bearer-token authorization, but it does not make LAN, reverse-proxy, or
internet exposure safe.

1. Create a dedicated AREPO app-data directory outside your vaults.
2. Configure only the vault roots AREPO should access.
3. Keep `deleteFiles` disabled unless you explicitly need it.
4. Start the backend with the default `127.0.0.1` bind address when possible.
5. If you bind to a LAN address, read the warning and do not expose the backend
   to untrusted clients.
6. Configure exact CORS origins with `AREPO_ALLOWED_ORIGINS`; do not use a
   wildcard.
7. Run the manual acceptance checklist against `test-vault/` after upgrades.
8. Keep backups/versioning external and verify them independently.

Remote node registration, sync, and federation are not implemented in V1.

## Runtime Status Endpoint

`GET /api/node/status` returns a local-node-only runtime summary. It is intended
for daily-driver diagnostics and future settings/status UI, not for remote node
registration.

The response includes:

- node identity and mode
- backend bind host and port
- whether the current runtime is still local-only
- exact CORS origins configured for the local backend
- startup warnings such as non-local binding
- vault count and per-vault watcher/index health
- storage-summary availability
- auth posture and protected-mode readiness
- explicit capability flags showing that remote nodes, browser login, browser
  sessions, sync, AI, database support, and migration support are disabled in V1

This endpoint does not make LAN or reverse-proxy exposure safe. Generated
index/cache data remains disposable and rebuildable from source Markdown files.
