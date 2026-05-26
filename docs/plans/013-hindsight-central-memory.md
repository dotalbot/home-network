# 013 — Central Hindsight Memory Service

Status: deployed; retain/recall smoke test pending explicit approval

## Goal

Run one central Hindsight service on `jellyhome` for Hermes/OpenCode memory experiments, instead of separate embedded databases per agent.

## Scope

Included:

- Docker Compose service on `jellyhome`.
- Persistent appdata under `/opt/docker/appdata/hindsight/data`.
- Host-local provider secret under `/opt/docker/.secrets/hindsight/hindsight.env`.
- Inventory, Homepage, backup metadata, and operations docs.
- API/UI verification from jellyhome and the operator host.

Non-goals for this first pass:

- Do not replace Honcho for the default Hermes profile yet.
- Do not automatically add OpenCode plugins to active repos while sessions are running.
- Do not expose Hindsight on the public internet.

## Decisions

- Host: `jellyhome`.
- Image: `ghcr.io/vectorize-io/hindsight:0.6.2`.
- API host port: `18888` (`8888` remains the in-container port).
- UI port: `9999`.
- Bind addresses: jellyhome LAN `192.168.1.1` and Tailnet `100.90.175.59` only.
- First-pass LLM provider: OpenRouter via host-local secret file.
- Memory bank strategy: repo/project banks first, global bank second.

## Checklist

- [x] Add Hindsight Compose service to `docker/hosts/jellyhome.yaml`.
- [x] Add service inventory and backup class.
- [x] Add Homepage entry via inventory render.
- [x] Add operations doc.
- [x] Create host-local secret env file on jellyhome.
- [x] Validate Docker Compose config.
- [x] Sync source config to `/opt/docker` on jellyhome.
- [x] Deploy Hindsight container.
- [x] Verify API on port 18888.
- [x] Verify UI on port 9999.
- [ ] Run a retain/recall smoke test.
- [ ] Decide whether to test one Hermes profile or one OpenCode repo.

## Current verified state

- Hindsight container is running on `jellyhome`.
- API is exposed on host port `18888` because port `8888` is already occupied on jellyhome by a separate APK-serving HTTP server.
- UI is exposed on host port `9999`.
- Startup completed successfully after correcting the image tag (`0.6.2` not `v0.6.2`) and fixing appdata ownership for the embedded pg0 data directory.

## Verification commands

```bash
scripts/homepage-render
scripts/backup-policy-check
python3 - <<'PY'
import yaml
for path in ['inventory/services.yml', 'inventory/backups.yml', 'docker/hosts/jellyhome.yaml']:
    yaml.safe_load(open(path))
    print(path, 'ok')
PY
ssh jellyhome 'cd /home/jellybot/home-network && scripts/deploy'
ssh jellyhome 'docker logs --tail 80 hindsight'
curl -fsS http://192.168.1.1:18888
curl -fsS http://192.168.1.1:9999 >/dev/null
```

## Rollback

```bash
ssh jellyhome 'cd /opt/docker && docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml stop hindsight'
ssh jellyhome 'cd /opt/docker && docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml rm -f hindsight'
```

Leave `/opt/docker/appdata/hindsight/data` in place unless explicitly cleaning state.
