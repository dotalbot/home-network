# Calibre Web Automated Restore Runbook

Service: Calibre Web Automated
Host: `jellyhome`
Backup class: `appdata-and-library`
Runtime container: `calibre-web-automated`
URL: `http://192.168.1.1:8083` (LAN), `http://100.90.175.59:8083` (Tailscale)
Status: active on jellyhome; appdata and ebook library are backup-tracked.

## Runtime paths

Runtime paths:

- appdata/config: `/opt/docker/appdata/calibre-web-automated/config`
- book library root mounted into CWA: `/home/jellyfish/media/Primary_5TB/ebooks_library/Calibre`
- inbound ingest folder: `/home/jellyfish/media/Primary_5TB/ebooks_inbound`
- Compose source: `/home/jellyfish/repo/home-network/docker/hosts/jellyhome.yaml` on jellyhome; `/home/jellybot/home-network/docker/hosts/jellyhome.yaml` in the operator source checkout

Host-local secrets, if any, must live under `/opt/docker/.secrets/calibre-web-automated/` and stay out of Git.

## Restore priority

High. The Calibre metadata database lives in the ebook library at `/home/jellyfish/media/Primary_5TB/ebooks_library/Calibre/metadata.db`; CWA application config lives under `/opt/docker/appdata/calibre-web-automated/config`.

## Production notes

- Final library and inbound paths are recorded in `inventory/services.yml`.
- Compose service lives in `docker/hosts/jellyhome.yaml`.
- Borg policy tracks `/opt/docker`, `/home/jellyfish/media/Primary_5TB/ebooks_library`, and `/home/jellyfish/media/Primary_5TB/ebooks_inbound` for jellyhome.
- Run a non-destructive extraction drill after the service has accumulated current appdata.

## Non-destructive drill

Use a unique scratch directory; do not delete old scratch directories from automated drill commands.

1. Choose a verified `jellyhome` Borg archive after the service has data.
2. Extract appdata into scratch space:

```bash
if [ -w /tmp/home-network-restore-drill ]; then
  DRILL_BASE=/tmp/home-network-restore-drill
else
  DRILL_BASE="$HOME/home-network-restore-drill"
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRILL="$DRILL_BASE/calibre-web-automated-$STAMP"
install -d -m 700 "$DRILL"
cd "$DRILL"
sudo borg extract --list REPOSITORY::ARCHIVE opt/docker/appdata/calibre-web-automated
```

3. Inspect expected files without printing credentials:

```bash
sudo find "$DRILL/opt/docker/appdata/calibre-web-automated" -maxdepth 3 -type f \
  ! -name '*password*' \
  ! -name '*secret*' \
  -printf '%p size=%s\n' | head -80
```

4. Inspect the library path read-only after it is finalized:

```bash
LIBRARY_PATH=/home/jellyfish/media/Primary_5TB/ebooks_library/Calibre
test -d "$LIBRARY_PATH"
find "$LIBRARY_PATH" -maxdepth 2 -type f | head -50
```

5. If the service image supports config validation, run it against scratch appdata with read-only mounts and no production ports. Otherwise, validate by file presence only until the exact image and config layout are known.

Expected drill outcome:

- appdata files restore into scratch;
- library path is present and readable;
- production container and production library are untouched;
- final image-specific validation command is added here after deployment.

## Production restore

Only run during an approved maintenance window after the service has been deployed.

1. Confirm host and source state:

```bash
hostname -s
cd /home/jellybot/home-network
git status --short --branch
git pull --ff-only origin main
```

2. Stop the service:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml stop calibre-web-automated
```

3. Preserve current state:

```bash
sudo tar -C /opt/docker/appdata -czf /tmp/calibre-web-automated-pre-restore-$(date -u +%Y%m%dT%H%M%SZ).tgz calibre-web-automated
```

4. Restore appdata from Borg:

```bash
cd /
sudo borg extract --list REPOSITORY::ARCHIVE opt/docker/appdata/calibre-web-automated
```

5. Restore or reattach the book library only if the library path is damaged or empty. Prefer verifying the existing library before overwriting it:

```bash
LIBRARY_PATH=/home/jellyfish/media/Primary_5TB/ebooks_library/Calibre
test -d "$LIBRARY_PATH"
find "$LIBRARY_PATH" -maxdepth 2 -type f | head -50
# Example library restore shape; fill archive during a real restore.
# cd /
# sudo borg extract --list REPOSITORY::ARCHIVE home/jellyfish/media/Primary_5TB/ebooks_library
```

6. Verify permissions and secrets:

```bash
sudo find /opt/docker/appdata/calibre-web-automated -maxdepth 2 -printf '%M %u:%g %p\n'
test -r "$LIBRARY_PATH"
# If secrets are added later:
# sudo test -d /opt/docker/.secrets/calibre-web-automated
```

7. Re-sync source-managed config and recreate the service:

```bash
cd /home/jellybot/home-network
./scripts/sync-docker-config
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml up -d --force-recreate calibre-web-automated
```

8. Verify:

```bash
docker ps --filter name=calibre-web-automated --format '{{.Names}} {{.Status}}'
docker logs --tail=120 calibre-web-automated
curl -fsS http://192.168.1.1:8083/ >/dev/null && echo calibre_web_http_ok
```

Verify in the UI that the expected books and metadata appear before declaring recovery complete.

## Rollback

Stop `calibre-web-automated`, restore the pre-restore tarball under `/opt/docker/appdata/calibre-web-automated`, restore the previous library snapshot only if it was modified, recreate the container, then verify logs, HTTP, and library visibility.

## Drill log

- Pending: first post-deployment drill should extract appdata and verify `/home/jellyfish/media/Primary_5TB/ebooks_library/Calibre/metadata.db` in scratch/read-only checks.
