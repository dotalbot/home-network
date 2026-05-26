# Hindsight Operations

Status: first-pass central Docker instance on `jellyhome`, deployed and endpoint-verified.

## Purpose

Hindsight is the shared long-term memory backend for agent experiments. The goal is to avoid fragmented per-agent embedded databases by running one central service and pointing clients at the same API.

## Runtime

- Host: `jellyhome`
- Container: `hindsight`
- Image: `ghcr.io/vectorize-io/hindsight:0.6.2`
- API: `http://192.168.1.1:18888` and `http://100.90.175.59:18888`
- UI: `http://192.168.1.1:9999` and `http://100.90.175.59:9999`
- Persistent data: `/opt/docker/appdata/hindsight/data`
- Secret env file: `/opt/docker/.secrets/hindsight/hindsight.env`

Ports are bound to the jellyhome LAN and Tailscale IPs, not `0.0.0.0`.
The API is exposed on host port `18888` because port `8888` is already in active use on jellyhome by a separate APK-serving HTTP process.
The container also uses a stable worker ID: `hindsight-jellyhome`.

Deployment notes:

- Use image tag `ghcr.io/vectorize-io/hindsight:0.6.2` (`v0.6.2` does not exist in GHCR).
- The first startup required correcting appdata ownership so the in-container `hindsight` user could start embedded pg0 successfully.

## Secret file

Create `/opt/docker/.secrets/hindsight/hindsight.env` on jellyhome. Do not commit it.

Current first-pass provider choice uses the existing OpenRouter key as an OpenAI-compatible Hindsight provider:

```env
HINDSIGHT_API_LLM_PROVIDER=openrouter
HINDSIGHT_API_LLM_MODEL=qwen/qwen3.5-9b
HINDSIGHT_API_LLM_API_KEY=<secret>
HINDSIGHT_API_LLM_BASE_URL=https://openrouter.ai/api/v1
```

If the provider changes later, update only the host-local secret file and redeploy the service.

## Bank strategy

Use project banks first and a global bank sparingly:

| Bank | Use |
| --- | --- |
| `global-dominic` | Stable user preferences, machine names, recurring patterns |
| `logk-main` | LogK architecture, Golden Spine, content lifecycle |
| `jellyweb-main` | Django/PostGIS/map/POI/NSPL work |
| `home-network-main` | Docker, Tailscale, Borg, Homepage, monitoring |
| `hermes-main` | Hermes operational behaviour, plugins, memory choices |
| `opencode-main` | OpenCode-specific patterns, agents, model profiles |

Avoid one giant bank. It will become memory soup. Nobody wants soup in the server rack.

## Hermes integration note

Hermes can use one external memory provider at a time alongside built-in memory. Keep Honcho active until Hindsight proves itself in normal workflow.

When ready to test a Hermes profile against Hindsight, use local external mode with:

```text
API URL: http://jellyhome:18888
Bank ID: hermes-main
Recall budget: mid
```

Equivalent config shape is expected under `~/.hermes/hindsight/config.json`:

```json
{
  "mode": "local_external",
  "api_url": "http://jellyhome:18888",
  "bank_id": "hermes-main",
  "recall_budget": "mid"
}
```

Do not switch the default Hermes profile away from Honcho until testing passes.

## OpenCode integration note

Project config example for a repo such as LogK:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "@vectorize-io/opencode-hindsight",
      {
        "hindsightApiUrl": "http://jellyhome:18888",
        "bankId": "logk-main",
        "autoRecall": true,
        "autoRetain": true,
        "recallBudget": "mid",
        "retainEveryNTurns": 3,
        "debug": false
      }
    ]
  ]
}
```

Do not add this to active repos blindly while an OpenCode session is running; add it intentionally per repo after the central service is verified.

## Deploy

From the `home-network` checkout on jellyhome:

```bash
scripts/deploy
```

Or directly from `/opt/docker` after sync:

```bash
docker compose --env-file /opt/docker/.env -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellyhome.yaml up -d hindsight
```

## Verify

```bash
docker ps --filter name=hindsight
curl -fsS http://192.168.1.1:18888 || true
curl -fsS http://100.90.175.59:18888 || true
curl -fsS http://192.168.1.1:9999 >/dev/null
```

Use the API and UI checks plus container logs. First startup can take time while embedded pg0 and model assets initialize.

## Backup and restore

Backup class: `appdata`.

Restore:

1. Bootstrap jellyhome Docker and `/opt/docker`.
2. Restore `/opt/docker/appdata/hindsight/data` from Borg.
3. Recreate `/opt/docker/.secrets/hindsight/hindsight.env` from secret storage.
4. Sync/deploy `home-network`.
5. Verify API/UI and a retain/recall smoke test before pointing agents at it.
