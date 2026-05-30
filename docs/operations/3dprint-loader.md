# 3D Print Loader Operations

## Purpose

`3dprint-loader` is a cross-repo web application for resolving, previewing, and eventually importing 3D-print model links into Manyfold.

It is developed in its own application repository and deployed by `home-network` onto `/opt/docker` on `jellyhome`.

```text
App source:      /home/jellybot/3dprint_loader
Runtime host:    jellyhome
Runtime URL:     http://192.168.1.1:8793
Health URL:      http://192.168.1.1:8793/health
Compose owner:   home-network
Runtime copy:    /opt/docker
```

## Source-of-truth split

```text
/home/jellybot/3dprint_loader
  owns app source, Dockerfiles, tests, API/frontend code, and app docs

/home/jellybot/home-network
  owns runtime placement, Compose overlay, service inventory, secrets paths, and this runbook

/opt/docker
  owns synced runtime Compose copy, host-local .env, .secrets, and appdata
```

Do not hand-edit `/opt/docker/hosts/jellyhome.yaml` as the durable fix. Edit `home-network/docker/hosts/jellyhome.yaml`, then sync.

## Services

```text
3dprint-loader-api
3dprint-loader-web
```

The web container exposes the application on port `8793` and proxies same-origin `/api` and `/health` requests to the API container.

The API container receives the default-network alias `api` because the frontend Nginx config proxies to `http://api:8000`.

## Runtime paths

```text
/opt/docker/appdata/3dprint-loader/storage
/opt/docker/appdata/3dprint-loader/storage/imports/<import_id>/
/opt/docker/.secrets/3dprint-loader/
/opt/docker/.secrets/3dprint-loader/makerworld-storage-state.json
```

`storage/imports/<import_id>/` holds staged STL/3MF files and `manifest.json` records created by the app's "Stage for Manyfold" action. These files are the handoff point for the future Manyfold upload job.

`makerworld-storage-state.json` is optional and password-equivalent when present. Never commit it. Store it only under `/opt/docker/.secrets/3dprint-loader/` or another approved host-local secret path.

## Code refresh deployment

From the operator host, usually Hermes on `jellyberry`, deploy by SSHing to `jellyhome` as `jellybot`.

The runtime checkout must be refreshed before every rebuild:

```bash
ssh jellybot@jellyhome '
  set -euo pipefail
  cd /home/jellybot/3dprint_loader
  git fetch origin
  git checkout feat/initial-mvp-scaffold
  git pull --ff-only origin feat/initial-mvp-scaffold
'
```

Then refresh `home-network` and sync `/opt/docker`:

```bash
ssh jellybot@jellyhome '
  set -euo pipefail
  cd /home/jellybot/home-network
  git fetch origin
  git checkout main
  git pull --ff-only origin main
  ./scripts/sync-docker-config
'
```

Then rebuild/recreate the selected services:

```bash
ssh jellybot@jellyhome '
  set -euo pipefail
  cd /opt/docker
  THREEDPRINT_LOADER_COMMIT_COUNT=$(git -C /home/jellybot/3dprint_loader rev-list --count HEAD) \
  THREEDPRINT_LOADER_COMMIT_SHA=$(git -C /home/jellybot/3dprint_loader rev-parse HEAD) \
  THREEDPRINT_LOADER_COMMIT_TIMESTAMP=$(git -C /home/jellybot/3dprint_loader log -1 --format=%cI) \
  docker compose \
    --env-file .env \
    -f docker-compose.yml \
    -f hosts/jellyhome.yaml \
    up -d --build --force-recreate 3dprint-loader-api 3dprint-loader-web
'
```

## First-time host preparation

Create the runtime directories before the first deploy so Docker does not create them with surprising ownership:

```bash
ssh jellybot@jellyhome '
  set -euo pipefail
  install -d -m 2775 /opt/docker/appdata/3dprint-loader/storage
  install -d -m 2770 /opt/docker/.secrets/3dprint-loader
'
```

If ownership has drifted, fix it with root/sudo using the `dockerops` group before deploying.

## Verification

```bash
ssh jellybot@jellyhome 'docker ps --filter name=3dprint-loader'
ssh jellybot@jellyhome 'curl -fsS http://192.168.1.1:8793/health'
ssh jellybot@jellyhome 'curl -fsS http://192.168.1.1:8793/api/version'
curl -fsS http://192.168.1.1:8793/health
curl -fsS http://192.168.1.1:8793/api/version
```

Expected health response:

```json
{"status":"ok","service":"3dprint-loader-api"}
```

For source-site preview smoke tests, use the app UI and a known working public link. Thingiverse ZIP archive preview is supported through the app's safe archive inspection endpoints; unsafe ZIP entries are filtered and archives are not extracted to disk unless a selected STL/3MF is explicitly staged for import.

Staging smoke test shape:

```bash
curl -fsS -X POST http://192.168.1.1:8793/api/imports/stage-archive-entry \
  -H 'Content-Type: application/json' \
  --data '{"archive_url":"https://tv-zip.thingiverse.com/zip/7356921","entry":"files/example.stl","source_url":"https://www.thingiverse.com/thing:7356921"}'
```

Use a real entry returned by `/api/assets/archive-entries`; the staged output should appear under `/opt/docker/appdata/3dprint-loader/storage/imports/<import_id>/`.

## Rollback

Rollback app code:

```bash
ssh jellybot@jellyhome '
  set -euo pipefail
  cd /home/jellybot/3dprint_loader
  git checkout <known-good-ref>
  cd /opt/docker
  docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml \
    up -d --build --force-recreate 3dprint-loader-api 3dprint-loader-web
'
```

Rollback runtime config by reverting the relevant `home-network` commit, syncing `/opt/docker`, and recreating the services.

## Troubleshooting

### Web page loads but API calls fail

Check that the API service has network alias `api` in `docker/hosts/jellyhome.yaml` and that both containers share the default Compose network:

```bash
ssh jellybot@jellyhome 'docker inspect 3dprint-loader-api 3dprint-loader-web --format "{{.Name}} {{json .NetworkSettings.Networks}}"'
```

### Compose cannot build

Verify the app checkout exists on `jellyhome`:

```bash
ssh jellybot@jellyhome 'test -d /home/jellybot/3dprint_loader/.git && git -C /home/jellybot/3dprint_loader status --short --branch'
```

### Web proxy returns 502 Bad Gateway even though the API container is healthy

The web container's nginx caches DNS resolution for upstream proxy targets at startup. If the API container is recreated (e.g., after a health restart), it gets a new Docker network IP, but nginx continues trying the stale address.

Fix: restart the web container to force DNS re-resolution:

```bash
docker compose \
  --env-file /opt/docker/.env \
  -f /opt/docker/docker-compose.yml \
  -f /opt/docker/hosts/jellyhome.yaml \
  restart 3dprint-loader-web
```

After restart, verify health:

```bash
curl -fsS http://192.168.1.1:8793/health
```

Expected: `{"status":"ok","service":"3dprint-loader-api"}`

Long-term fix: add an nginx `resolver` directive with `valid=` and use a variable in `proxy_pass` so nginx re-resolves DNS at runtime.

### MakerWorld authenticated discovery does not work

Check whether the optional Playwright storage-state file exists without printing it:

```bash
ssh jellybot@jellyhome 'test -s /opt/docker/.secrets/3dprint-loader/makerworld-storage-state.json && echo present || echo missing'
```

If it is missing, the app should still support public-source flows but may not access auth-gated MakerWorld downloads.

## MakerWorld auth-state maintenance

The MakerWorld authenticated resolver uses a Playwright storage-state file saved to `/opt/docker/.secrets/3dprint-loader/makerworld-storage-state.json` on jellyhome. This file contains session cookies that expire over time.

### Health check script

A cron-compatible health check lives at:

```
scripts/3dprint-loader/check-makerworld-auth.sh
```

Exit codes:

| Code | Meaning                           |
|------|-----------------------------------|
| 0    | Auth state OK, cookies valid      |
| 1    | Warning — expiring or session-only cookies |
| 2    | Auth state missing, invalid, or expired |
| 3    | Infrastructure error (API unreachable) |

The script is silent on exit 0. Warnings and errors go to stderr.

Run it manually:

```bash
./scripts/3dprint-loader/check-makerworld-auth.sh
```

Output example (exit 0):

```
makerworld_auth file=/run/secrets/3dprint-loader/makerworld-storage-state.json status=ok cookies=24 persistent=6 expired=0 session=18 usable=true domains=[makerworld.com,bambulab.com] earliest=2026-08-01T00:00:00+00:00
```

### Maintenance schedule

| Frequency | Action                                          | Who         |
|-----------|-------------------------------------------------|-------------|
| Daily     | Run `check-makerworld-auth.sh`                  | Cron job    |
| On warning| Re-run `makerworld-login` to refresh session    | Operator    |
| On expiry | Re-run `makerworld-login` immediately           | Operator    |

MakerWorld session cookies typically have a shelf life of 30–90 days depending on Bambu Lab's policy. The check script treats any cookie expiry within 7 days as a warning (override with `WARN_DAYS` env).

### Re-running makerworld-login

When the session expires or is about to expire, regenerate the storage-state file from a machine with a display (the login tool opens a browser window):

**Option A — attach to running Chrome (easiest, Mac/desktop Linux):**

1. Launch Chrome with remote debugging:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222 \
     --remote-debugging-address=127.0.0.1
   ```

2. In the 3dprint_loader backend directory:
   ```bash
   cd backend
   . .venv/bin/activate
   makerworld-login --cdp-url http://127.0.0.1:9222 \
     --storage-state /tmp/makerworld-storage-state.json
   ```

3. Log into MakerWorld in the Chrome window (or use an existing session).
4. Press Enter in the terminal to save the state.

**Option B — standalone Playwright browser:**

```bash
cd backend
. .venv/bin/activate
makerworld-login --storage-state /tmp/makerworld-storage-state.json
```

A headed Chromium window opens. Log into MakerWorld, then press Enter.

**Deploy the refreshed state to jellyhome:**

```bash
ssh jellybot@192.168.1.1 'mkdir -p /opt/docker/.secrets/3dprint-loader && chmod 700 /opt/docker/.secrets/3dprint-loader'
scp /tmp/makerworld-storage-state.json jellybot@192.168.1.1:/opt/docker/.secrets/3dprint-loader/makerworld-storage-state.json
ssh jellybot@192.168.1.1 'chmod 600 /opt/docker/.secrets/3dprint-loader/makerworld-storage-state.json'
```

The new state file is immediately usable — no restart needed. The API container mounts `/opt/docker/.secrets/3dprint-loader/` as a read-only volume, so the new file is available on next API request.

### Current state (as of this writing)

The storage-state file is **not present** on jellyhome. Authenticated MakerWorld flows (discovering models from maker pages, watching collections, downloading auth-gated STL/3MF files) require this file to be created first via `makerworld-login`.

## Backup and restore

Backup class: `appdata-and-source-repo`.

Restore requires:

- the `3dprint_loader` Git repository checkout,
- the `home-network` Compose/inventory/runbook state,
- `/opt/docker/appdata/3dprint-loader/storage`, if retained,
- `/opt/docker/.secrets/3dprint-loader/`, recreated manually from secret backups where applicable.

Secrets are intentionally excluded from Git.
