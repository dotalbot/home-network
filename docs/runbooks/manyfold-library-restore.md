# Manyfold Library Restore Runbook

Service: Manyfold
Host: `jellyhome`
Backup class: `manyfold-appdata-central-postgres-and-library`
Runtime containers: `manyfold`, `manyfold-valkey`
URL: `http://192.168.1.1:3214`

## Runtime paths

- Manyfold config: `/opt/docker/appdata/manyfold/config`
- Manyfold Valkey queue/cache state: `/opt/docker/appdata/manyfold/valkey`
- 3D model library: `/home/jellyfish/media/Primary_5TB/3D_models`
- Database: central PostgreSQL `manyfold` database on `jellybase`
- Compose source: `/home/jellybot/home-network/docker/hosts/jellyhome.yaml`

Host-local secrets that must be recreated outside Git:

- `/opt/docker/.secrets/manyfold_database_url` on `jellyhome`
- `/opt/docker/.secrets/manyfold_secret_key_base` on `jellyhome`
- central Postgres service secrets on `jellybase`, documented in `docs/runbooks/central-postgres-manyfold-restore.md`

Do not print secret file contents.

## Restore priority

High once the library is used as the authoritative 3D model catalog. Restore requires app config, library files, and the central PostgreSQL database to agree.

## Non-destructive drill

Use this before any production restore.

1. Choose verified Borg archives for both `jellyhome` and `jellybase` when validating app/library plus database state.
2. Extract only Manyfold app/library metadata into timestamped scratch space on `jellyhome`:

```bash
if [ -w /tmp/home-network-restore-drill ]; then
  DRILL_BASE=/tmp/home-network-restore-drill
else
  DRILL_BASE="$HOME/home-network-restore-drill"
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRILL="$DRILL_BASE/manyfold-$STAMP"
install -d -m 700 "$DRILL"
cd "$DRILL"
sudo borg extract --list REPOSITORY::ARCHIVE \
  opt/docker/appdata/manyfold/config \
  opt/docker/appdata/manyfold/valkey
```

3. Inspect expected files without dumping secrets:

```bash
sudo test -d "$DRILL/opt/docker/appdata/manyfold/config"
sudo find "$DRILL/opt/docker/appdata/manyfold" -maxdepth 3 -type f \
  ! -name '*secret*' \
  ! -name '*password*' \
  -printf '%p size=%s\n' | head -80
```

4. Verify the library mount exists on the host and has expected content shape. Keep this read-only:

```bash
test -d /home/jellyfish/media/Primary_5TB/3D_models
find /home/jellyfish/media/Primary_5TB/3D_models -maxdepth 2 -type f | head -50
```

5. Run the database-aware drill from `docs/runbooks/central-postgres-manyfold-restore.md` to restore the latest `manyfold` logical dump into a scratch PostgreSQL container.

Expected drill outcome:

- app config files are present in scratch;
- library mount is readable and contains expected model files;
- scratch database restore reports tables in `manyfold_restore`;
- production containers and production data paths are not modified.

## Production restore

Only run during an approved maintenance window.

1. Confirm host and repo state on `jellyhome`:

```bash
hostname -s
cd /home/jellybot/home-network
git status --short --branch
git pull --ff-only origin main
```

2. Confirm central Postgres restore state on `jellybase`. If the database also needs restore, complete `docs/runbooks/central-postgres-manyfold-restore.md` first while Manyfold remains stopped.

3. Stop Manyfold on `jellyhome`:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml stop manyfold manyfold-valkey
```

4. Preserve current appdata before replacing it:

```bash
sudo tar -C /opt/docker/appdata -czf /tmp/manyfold-pre-restore-$(date -u +%Y%m%dT%H%M%SZ).tgz manyfold
```

5. Restore app config and Valkey state from Borg if needed:

```bash
cd /
sudo borg extract --list REPOSITORY::ARCHIVE \
  opt/docker/appdata/manyfold/config \
  opt/docker/appdata/manyfold/valkey
```

6. Restore the 3D model library from the selected backup source only if the library path itself is damaged or missing. Avoid overwriting a healthy library just to repair database/app state.

```bash
sudo test -d /home/jellyfish/media/Primary_5TB/3D_models
# Example full-library restore shape; fill REPOSITORY::ARCHIVE during a real restore.
# cd /
# sudo borg extract --list REPOSITORY::ARCHIVE home/jellyfish/media/Primary_5TB/3D_models
```

7. Verify required secrets and permissions without printing secrets:

```bash
sudo test -s /opt/docker/.secrets/manyfold_database_url
sudo test -s /opt/docker/.secrets/manyfold_secret_key_base
sudo find /opt/docker/appdata/manyfold -maxdepth 2 -printf '%M %u:%g %p\n'
test -r /home/jellyfish/media/Primary_5TB/3D_models
```

8. Re-sync source-managed config and recreate services:

```bash
cd /home/jellybot/home-network
./scripts/sync-docker-config
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml up -d --force-recreate manyfold-valkey manyfold
```

9. Verify app, database, and library:

```bash
docker ps --filter name=manyfold --format '{{.Names}} {{.Status}}'
curl -fsS http://192.168.1.1:3214/ >/dev/null && echo manyfold_http_ok
docker logs --tail=120 manyfold
nc -vz 192.168.1.2 5432
find /home/jellyfish/media/Primary_5TB/3D_models -maxdepth 2 -type f | head -20
```

If UI authentication is required, verify through the browser using existing operator credentials; do not place credentials in the runbook or shell history.

## Rollback

Stop `manyfold`, restore the pre-restore tarball under `/opt/docker/appdata/manyfold`, revert the central Postgres database using the pre-restore database snapshot/logical dump if it was changed, recreate `manyfold-valkey` and `manyfold`, then verify HTTP, logs, database connectivity, and library visibility.

## Drill log

- Pending: first combined Manyfold app/library drill. Database-only drill is tracked in `docs/runbooks/central-postgres-manyfold-restore.md`.
