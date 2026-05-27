# Jellyfood API service

Shared food knowledge base API for Jellyfood. Provides a collaborative SQLite-backed store for custom foods that Ellie and Dominic can add, edit, and share.

## Ownership

- Source repository: `/home/jellylady/repo/jellyfood`
- Remote: `git@github.com:dotalbot/jellyfood.git`
- API package: `packages/api/`
- Home-network service key: `jellyfood-api`
- Container: `jellyfood-api`
- Host: `jellybase`
- URL: `http://192.168.1.2:8794`

## Runtime

- Build context: `/home/jellylady/repo/jellyfood`
- Dockerfile: `/home/jellylady/repo/jellyfood/packages/api/Dockerfile`
- Build stage: Node 22 Alpine compiles TypeScript
- Runtime stage: Node 22 Alpine serves Express API
- Published port: `8794:3000`
- SQLite data: `/opt/docker/appdata/jellyfood-api/foods.db`
- Runtime secrets: none

## Deploy

From this `home-network` repo on `jellybase`:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/$(hostname -s).yaml up -d --build jellyfood-api
```

Or deploy alongside other services:

```bash
just homepage-deploy
```

## Verify

```bash
docker ps --filter name=jellyfood-api
curl -fsS http://127.0.0.1:8794/api/health
curl -fsS http://192.168.1.2:8794/api/health
just drift-check-strict
```

Expected result: HTTP 200 JSON `{ "status": "ok", "database": "connected" }` and no missing `jellyfood-api` container in drift check.

## Backup

The SQLite database lives on a Docker volume mount at `/opt/docker/appdata/jellyfood-api/foods.db`.

Safe online backup:

```bash
docker exec jellyfood-api sh -c 'sqlite3 /data/foods.db ".backup /data/foods-backup.db"'
cp /opt/docker/appdata/jellyfood-api/foods-backup.db /backups/jellyfood-api-$(date +%F).db
```

## Restore

1. Re-clone or update `/home/jellylady/repo/jellyfood` from `git@github.com:dotalbot/jellyfood.git`.
2. Ensure the Jellyfood repo includes `packages/api/Dockerfile` and `packages/api/src/`.
3. Re-sync home-network Docker config with `just sync-docker-config`.
4. Rebuild and start the service with the deploy command above.
5. If restoring from backup, stop the container and copy the backup `.db` file into `/opt/docker/appdata/jellyfood-api/foods.db` before starting.
