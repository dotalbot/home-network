# Central PostgreSQL / Manyfold restore runbook

Status: draft; first non-destructive drill pending.

## Scope

This runbook covers restore confidence for the central PostgreSQL platform on `jellybase`, starting with the `manyfold` database used by Manyfold on `jellyhome`.

Runtime components:

| Component | Host | Runtime path / service |
| --- | --- | --- |
| PostgreSQL container | jellybase | `central-postgres` |
| PostgreSQL data volume | jellybase | `/opt/docker/appdata/postgres/data` |
| PostgreSQL config | jellybase | `/opt/docker/appdata/postgres/config/pg_hba.conf` |
| Logical dumps | jellybase | `/opt/docker/appdata/postgres/logical-dumps` |
| Manyfold app | jellyhome | `manyfold` container |
| Manyfold app config/media | jellyhome | `/opt/docker/appdata/manyfold`, `/home/jellyfish/media/Primary_5TB/3D_models` |

Secrets are intentionally outside Git:

- `/opt/docker/.secrets/postgres_superuser_password` on `jellybase`
- `/opt/docker/.secrets/postgres_manyfold_password` on `jellybase`
- `/opt/docker/.secrets/manyfold_database_url` on `jellyhome`

Do not print these values.

## Backup sources

Central Postgres uses two complementary backup paths:

1. Borg/Borgmatic coverage of `/opt/docker/appdata/postgres` on `jellybase`.
2. Logical dumps under `/opt/docker/appdata/postgres/logical-dumps`, created by `central-postgres-logical-dump.timer`.

Logical dumps are preferred for database-aware validation because they can be restored into a scratch Postgres container without touching production data.

## Non-destructive drill: validate latest logical dump

Run on `jellybase` from a safe operator shell.

1. Create a unique scratch directory. Do not delete old scratch directories as part of the automated drill. Prefer `/tmp/home-network-restore-drill` when writable; if that base directory is root-owned/non-writable and sudo is unavailable, use a user-owned scratch base under `$HOME`.

```bash
if [ -w /tmp/home-network-restore-drill ]; then
  DRILL_BASE=/tmp/home-network-restore-drill
else
  DRILL_BASE="$HOME/home-network-restore-drill"
fi
SERVICE=central-postgres-manyfold
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRILL="$DRILL_BASE/$SERVICE-$STAMP"
install -d -m 700 "$DRILL"
printf '%s\n' "$DRILL"
```

2. Locate latest dump artifacts without printing secrets.

```bash
find /opt/docker/appdata/postgres/logical-dumps -maxdepth 3 -type f | sort | tail -20
```

Expected useful artifacts include globals/roles and a `manyfold` database dump.

3. Copy the selected latest dump files into the scratch directory and make the scratch copies readable by the disposable container user. Do not loosen permissions on production dumps.

```bash
cp /opt/docker/appdata/postgres/logical-dumps/latest/* "$DRILL"/
chmod a+rx "$DRILL"
chmod a+r "$DRILL"/*
find "$DRILL" -maxdepth 1 -type f -printf '%f size=%s\n' | sort
```

If `latest` is unreadable or absent for the operator account, pick the newest readable timestamped dump directory explicitly and record that permission caveat in the drill log.

4. Restore and validate inside a one-shot scratch Postgres container. The container initializes its own temporary database directory, restores the copied dumps, prints only shape checks, shuts Postgres down internally, then exits. It does not bind ports and does not touch production containers or volumes.

```bash
docker run --rm \
  --user postgres \
  -v "$DRILL:/restore:ro" \
  postgres:17-alpine \
  sh -lc '
    set -eu
    initdb -D /tmp/pgdata >/tmp/initdb.log
    pg_ctl -D /tmp/pgdata -o "-c listen_addresses=localhost" -w start >/tmp/pgstart.log
    psql -U postgres -d postgres -f /restore/globals.sql >/tmp/globals.log
    createdb -U postgres manyfold_restore
    pg_restore -U postgres -d manyfold_restore /restore/manyfold.dump >/tmp/restore.log
    printf "table_count=%s\n" "$(psql -U postgres -d manyfold_restore -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='\''public'\'';")"
    printf "database=%s\n" "$(psql -U postgres -d manyfold_restore -Atc "SELECT current_database();")"
    printf "user_tables=%s\n" "$(psql -U postgres -d manyfold_restore -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='\''public'\'';")"
    pg_ctl -D /tmp/pgdata -m fast -w stop >/tmp/pgstop.log
  '
```

Expected:

- table count is greater than zero
- database reports `manyfold_restore`
- `user_tables` is greater than zero for a populated Manyfold dump
- no production containers were stopped
- no production data paths were modified

Leave the scratch directory in place for the drill log. Manual cleanup can happen later after listing paths.

## Production restore: central Postgres

Production restore requires an explicit maintenance window.

High-level order:

1. Stop dependent apps, starting with Manyfold on `jellyhome`.
2. Stop `central-postgres` on `jellybase`.
3. Take a pre-restore snapshot/tarball of current `/opt/docker/appdata/postgres` if the disk is healthy.
4. Restore either:
   - full Postgres appdata from Borg; or
   - initialize a fresh Postgres volume and restore logical dumps.
5. Recreate `central-postgres`.
6. Verify `pg_isready`, roles, databases, and pg_hba restrictions.
7. Restart Manyfold.
8. Verify Manyfold UI and library state.
9. Verify logical dump timer and Borg metrics after the next cycle.

Do not run production restore steps from automation without explicit operator approval.

## Verification commands

On `jellybase`:

```bash
docker inspect central-postgres --format '{{.State.Health.Status}}'
docker exec central-postgres pg_isready -U postgres -d postgres
docker exec central-postgres psql -U postgres -d postgres -Atc "SELECT datname FROM pg_database WHERE datname='manyfold';"
systemctl list-timers central-postgres-logical-dump.timer --all
find /opt/docker/appdata/postgres/logical-dumps/latest -maxdepth 1 -type f -printf '%f\n' | sort
```

From `jellyhome`:

```bash
nc -vz 192.168.1.2 5432
docker ps --filter name=manyfold --format '{{.Names}} {{.Status}}'
```

## Rollback

If the production restore fails before old data is replaced, restart existing services and investigate from logs.

If old data was moved aside or archived first, restore that pre-restore copy under `/opt/docker/appdata/postgres`, recreate `central-postgres`, then restart dependent apps.

## Drill log

- Pending: first successful non-destructive logical-dump restore drill for `manyfold`.
- 2026-05-28 precheck: `central-postgres` was healthy and logical dumps existed through `20260527T024501Z`, including `manyfold.dump`, `postgres.dump`, `globals.sql`, and `manifest.txt`. Drill execution was not completed because `/tmp/home-network-restore-drill` was not writable by the operator user, sudo was not cached, and the jellybase SSH session closed. Runbook updated to support a user-owned `$HOME/home-network-restore-drill` fallback for the next attempt.
- 2026-05-30 attempt: `central-postgres` was still running healthy on `jellybase`. The operator could read/copy the older `20260527T024501Z` dump set into `/home/jellyfish/home-network-restore-drill/central-postgres-manyfold-20260530T090057Z`, but newer dump directories `20260529T023759Z` and `20260530T023754Z` returned `Permission denied` and `latest/` was not usable from the non-sudo shell. The scratch Postgres restore was not successful: first run mounted scratch files that were not readable by the container's `postgres` user, and a retry without `--user postgres` failed because `initdb` cannot run as root; the SSH/tmux session then closed. Production `central-postgres` was not stopped and production data paths were not overwritten. Fix captured above: make only the scratch copies world-readable before mounting them, run the one-shot container as `postgres`, and avoid `docker stop` by shutting down Postgres inside the container.
