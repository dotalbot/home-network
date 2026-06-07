# Calibre Web Automated on jellyhome

## Purpose

Calibre Web Automated (CWA) provides a browser UI and automated ingest workflow for the ebook library on jellyhome.

## Runtime

- Host: jellyhome
- Container: `calibre-web-automated`
- Image: `crocodilestick/calibre-web-automated:latest`
- LAN URL: `http://192.168.1.1:8083`
- Tailscale URL: `http://100.90.175.59:8083`
- Container port: `8083`

## Persistent paths

- App config: `/opt/docker/appdata/calibre-web-automated/config`
- Calibre library bind: `/home/jellyfish/media/Primary_5TB/ebooks_library/Calibre` -> `/calibre-library`
- Inbound ingest bind: `/home/jellyfish/media/Primary_5TB/ebooks_inbound` -> `/cwa-book-ingest`

The inbound directory is processed by CWA; books placed there may be moved/removed after ingest.

## Deployment

From the source-managed checkout on jellyhome:

```bash
cd /home/jellyfish/repo/home-network
git pull --ff-only origin main
just sync-docker-config
just up calibre-web-automated
```

On jellyhome, `/opt/docker/docker-compose.yml` is a base file and host services come from `/opt/docker/hosts/jellyhome.yaml`. Use `just up calibre-web-automated` or explicit `docker compose --env-file .env -f docker-compose.yml -f hosts/$(hostname -s).yaml up -d calibre-web-automated`; do not use bare `docker compose up`.

## Verification

```bash
docker ps --filter name=calibre-web-automated --format '{{.Names}} {{.Status}} {{.Ports}}'
docker inspect calibre-web-automated --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
curl -fsS http://192.168.1.1:8083/ >/dev/null && echo calibre_web_automated_http_ok
```

Also verify the library mount is on the real 5TB disk, not the root filesystem underlay:

```bash
docker exec calibre-web-automated df -h /calibre-library
docker exec calibre-web-automated ls -la /calibre-library | head
```

Expected source device for the ebook library is `/dev/sdb1` via `/home/jellyfish/media/Primary_5TB`.

## Backup / restore

- Backup class: `appdata-and-library`
- App config is covered by `/opt/docker` backups.
- Ebook library and inbound paths are tracked in `inventory/backups.yml` under `calibre-ebook-library`.
- Restore runbook: `docs/runbooks/calibre-web-automated-restore.md`

## Caveats

- CWA runs as UID/GID 1000 to match the existing ebook library ownership.
- The library path is a bind mount under `/home/jellyfish/media/Primary_5TB`. If the disk is mounted after the container is created, recreate the container so Docker binds the mounted disk, not the root filesystem underlay.
- The service is currently LAN/Tailscale-exposed without an additional reverse proxy. Configure CWA user authentication in the web UI before treating it as generally accessible.
