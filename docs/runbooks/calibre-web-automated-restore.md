# Calibre Web Automated Restore Runbook

Service: Calibre Web Automated
Host: `jellyhome`
Backup class: `appdata-and-library`
Runtime container: `calibre-web-automated` once deployed
URL: pending in `inventory/services.yml`
Status: planned; write this before the media library becomes important.

## Runtime paths

Expected paths when deployed:

- appdata/config: `/opt/docker/appdata/calibre-web-automated`
- book library: operator-selected media/library path on `jellyhome` (record the final path in `inventory/services.yml` before going live)
- Compose source: `/home/jellybot/home-network/docker/hosts/jellyhome.yaml`

Host-local secrets, if any, must live under `/opt/docker/.secrets/calibre-web-automated/` and stay out of Git.

## Restore priority

Currently low because the service is planned. Raise to high before importing an authoritative book library or making Calibre metadata the source of truth.

## Before first production use

Complete these items before marking the service active:

- record the final library path in `inventory/services.yml`;
- add the Compose service to `docker/hosts/jellyhome.yaml`;
- document whether metadata lives in appdata, the book library, or both;
- confirm Borg covers the appdata path and the library path;
- run one non-destructive extraction drill before importing important media.

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
LIBRARY_PATH=/path/to/final/calibre/library
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
LIBRARY_PATH=/path/to/final/calibre/library
test -d "$LIBRARY_PATH"
find "$LIBRARY_PATH" -maxdepth 2 -type f | head -50
# Example library restore shape; fill final path and archive during a real restore.
# cd /
# sudo borg extract --list REPOSITORY::ARCHIVE path/to/final/calibre/library
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
# Fill in the final URL when deployed:
# curl -fsS http://127.0.0.1:PORT/ >/dev/null && echo calibre_web_http_ok
```

Verify in the UI that the expected books and metadata appear before declaring recovery complete.

## Rollback

Stop `calibre-web-automated`, restore the pre-restore tarball under `/opt/docker/appdata/calibre-web-automated`, restore the previous library snapshot only if it was modified, recreate the container, then verify logs, HTTP, and library visibility.

## Drill log

- Pending: service is planned; first drill should run after Compose, final library path, and initial appdata exist.
