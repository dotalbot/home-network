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

1. Create a unique scratch directory. Do not delete old scratch directories as part of the automated drill.

```bash
DRILL_BASE=/tmp/home-network-restore-drill
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

3. Copy the selected latest dump files into the scratch directory.

```bash
cp /opt/docker/appdata/postgres/logical-dumps/latest/* "$DRILL"/
find "$DRILL" -maxdepth 1 -type f -printf '%f\n' | sort
```

4. Start a scratch Postgres container with an isolated volume and a throwaway password.

```bash
docker run --rm -d \
  --name pg-restore-drill-"$STAMP" \
  -e POSTGRES_PASSWORD=restore-drill-only \
  postgres:17-alpine
```

5. Wait for readiness.

```bash
docker exec pg-restore-drill-"$STAMP" pg_isready -U postgres -d postgres
```

6. Restore globals/roles if the dump format supports it.

```bash
GLOBALS=$(find "$DRILL" -maxdepth 1 -type f \( -name '*globals*' -o -name '*roles*' \) | head -1)
if [ -n "$GLOBALS" ]; then
  docker cp "$GLOBALS" pg-restore-drill-"$STAMP":/tmp/globals.sql
  docker exec pg-restore-drill-"$STAMP" psql -U postgres -d postgres -f /tmp/globals.sql
fi
```

7. Restore the `manyfold` database dump into the scratch container.

```bash
MANYFOLD_DUMP=$(find "$DRILL" -maxdepth 1 -type f -iname '*manyfold*' | head -1)
test -n "$MANYFOLD_DUMP"
docker exec pg-restore-drill-"$STAMP" createdb -U postgres manyfold_restore || true
docker cp "$MANYFOLD_DUMP" pg-restore-drill-"$STAMP":/tmp/manyfold.dump
# Choose one based on dump type:
docker exec pg-restore-drill-"$STAMP" sh -c 'pg_restore -U postgres -d manyfold_restore /tmp/manyfold.dump || psql -U postgres -d manyfold_restore -f /tmp/manyfold.dump'
```

8. Validate restored shape.

```bash
docker exec pg-restore-drill-"$STAMP" psql -U postgres -d manyfold_restore -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
docker exec pg-restore-drill-"$STAMP" psql -U postgres -d manyfold_restore -Atc "SELECT current_database();"
```

Expected:

- table count is greater than zero
- database reports `manyfold_restore`
- no production containers were stopped
- no production data paths were modified

9. Stop the scratch container.

```bash
docker stop pg-restore-drill-"$STAMP"
```

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

- Pending: first non-destructive logical-dump restore drill for `manyfold`.
