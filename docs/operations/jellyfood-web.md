# Jellyfood web service

Jellyfood is a mobile-first food diary web app. The application code lives in the sibling source repo; `home-network` owns the Docker service record and host deployment wiring.

## Ownership

- Source repository: `/home/jellylady/repo/jellyfood`
- Remote: `git@github.com:dotalbot/jellyfood.git`
- Home-network service key: `jellyfood-web`
- Container: `jellyfood-web`
- Host: `jellybase`
- URL: `http://192.168.1.2:8793`

## Runtime

- Build context: `/home/jellylady/repo/jellyfood`
- Dockerfile: `/home/jellylady/repo/jellyfood/Dockerfile`
- Build stage: Node 22 Alpine runs `npm ci` and `npm run export:web`
- Runtime stage: nginx 1.27 Alpine serves the static Expo export
- Published port: `8793:80`
- Runtime secrets: none
- Server-side appdata: none

Jellyfood diary data is local to each user browser/device; it is not a server-side database or Docker volume.

## Deploy

From this `home-network` repo on `jellybase`:

```bash
just homepage-deploy
```

Or deploy only Jellyfood after config has been synced:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/$(hostname -s).yaml up -d --build jellyfood-web
```

## Verify

```bash
docker ps --filter name=jellyfood-web
curl -fsS http://127.0.0.1:8793/
curl -fsS http://192.168.1.2:8793/
just drift-check-strict
```

Expected result: HTTP 200 HTML for the Expo web shell and no missing `jellyfood-web` container in drift check.

## Restore

1. Re-clone or update `/home/jellylady/repo/jellyfood` from `git@github.com:dotalbot/jellyfood.git`.
2. Ensure the Jellyfood repo includes `Dockerfile` and `docker/nginx/default.conf`.
3. Re-sync home-network Docker config with `just sync-docker-config`.
4. Rebuild and start the service with the deploy command above.

No server-side application data needs restoration for Jellyfood itself.
