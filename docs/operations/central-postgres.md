# Central PostgreSQL Operations

Central PostgreSQL is the planned shared database service for home-network applications, starting with Manyfold.

## Runtime host

Runtime host:

```text
jellybase / 192.168.1.2
```

Compose service/container:

```text
central-postgres
```

Persistent paths:

```text
/opt/docker/appdata/postgres/data
/opt/docker/appdata/postgres/config/pg_hba.conf
/opt/docker/appdata/postgres/logical-dumps
```

## Network access policy

PostgreSQL binds to:

```text
192.168.1.2:5432
```

Approved initial clients:

```text
jellybase / 192.168.1.2
jellyhome / 192.168.1.1
```

All other LAN clients should be blocked unless explicitly approved later.

Source-managed database-level restriction lives at:

```text
docker/appdata/postgres/config/pg_hba.conf
```

That `pg_hba.conf` is not a complete TCP firewall. Before production-ready status, add a host-level Docker-aware firewall rule or equivalent network policy so non-approved LAN clients cannot reach `192.168.1.2:5432` at all.

Source-managed helper:

```bash
/opt/docker/bin/postgres-firewall-docker-user --print
/opt/docker/bin/postgres-firewall-docker-user --check
# Apply only after reviewing existing DOCKER-USER/firewall rules:
/opt/docker/bin/postgres-firewall-docker-user --apply
```

The helper manages intended `DOCKER-USER` rules for the Docker-published port by matching the current `central-postgres` container IP. Docker DNATs the host port before the filter path, so re-run the helper after recreating the container. If `jellybase` uses a different persistent firewall mechanism, translate the same allowlist policy instead of blindly applying duplicate rules.

Minimum network verification after deploy:

```bash
ss -ltnp | grep ':5432'
# Expected: listens on 192.168.1.2:5432, not 0.0.0.0:5432
```

From `jellyhome`:

```bash
nc -vz 192.168.1.2 5432
# Expected: succeeds
```

From a non-approved LAN host:

```bash
nc -vz 192.168.1.2 5432
# Expected: fails, times out, or is rejected by firewall/network policy
```

## Secrets

Do not commit real passwords to Git and do not paste them into chat.

The first-run superuser password is expected at:

```text
/opt/docker/.secrets/postgres_superuser_password
```

The Manyfold application password is expected at:

```text
/opt/docker/.secrets/postgres_manyfold_password
```

This password is for PostgreSQL user `svc_manyfold` and database `manyfold`.

Recommended permissions:

```bash
sudo install -d -m 750 -o root -g dockerops /opt/docker/.secrets
sudo touch /opt/docker/.secrets/postgres_superuser_password
sudo touch /opt/docker/.secrets/postgres_manyfold_password
sudo chown root:dockerops /opt/docker/.secrets/postgres_superuser_password /opt/docker/.secrets/postgres_manyfold_password
sudo chmod 640 /opt/docker/.secrets/postgres_superuser_password /opt/docker/.secrets/postgres_manyfold_password
```

Then edit each file directly on the host with your preferred editor, for example:

```bash
sudo nano /opt/docker/.secrets/postgres_superuser_password
sudo nano /opt/docker/.secrets/postgres_manyfold_password
```

Use long random passwords. Each file should contain only the password and a trailing newline is OK.

## First deploy checklist

Run from the home-network repo on `jellybase` after the superuser secret file exists:

```bash
./scripts/sync-docker-config
just compose-config
just up central-postgres
```

`scripts/sync-docker-config` installs the source-managed Postgres config and helpers to:

```text
/opt/docker/appdata/postgres/config/pg_hba.conf
/opt/docker/bin/postgres-logical-dump
/opt/docker/bin/postgres-bootstrap-manyfold
/opt/docker/bin/postgres-firewall-docker-user
```

Verify locally:

```bash
docker inspect central-postgres --format '{{.State.Health.Status}}'
docker exec central-postgres pg_isready -U postgres -d postgres
```

If LAN binding is enabled, verify from `jellyhome`:

```bash
nc -vz 192.168.1.2 5432
```

## Manyfold database bootstrap

After central Postgres is healthy and `/opt/docker/.secrets/postgres_manyfold_password` exists on `jellybase`, run:

```bash
./scripts/postgres-bootstrap-manyfold
```

Expected result:

```text
database/user ready: manyfold / svc_manyfold
```

Verification:

```bash
docker exec central-postgres psql -U postgres -d postgres -Atc "SELECT rolsuper FROM pg_roles WHERE rolname='svc_manyfold'"
# Expected: f
```

## Logical dumps

Logical dumps are required from day one, in addition to Borg coverage of `/opt/docker/appdata/postgres`.

Recommended dump location:

```text
/opt/docker/appdata/postgres/logical-dumps
```

Manual run:

```bash
/opt/docker/bin/postgres-logical-dump
```

Source-managed systemd units are provided at:

```text
systemd/central-postgres-logical-dump.service
systemd/central-postgres-logical-dump.timer
```

Install after central Postgres is healthy:

```bash
sudo cp systemd/central-postgres-logical-dump.service /etc/systemd/system/
sudo cp systemd/central-postgres-logical-dump.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now central-postgres-logical-dump.timer
systemctl list-timers central-postgres-logical-dump.timer
```

Minimum logical backup expectations:

1. Dump PostgreSQL globals/roles.
2. Dump application databases, starting with `manyfold` once created.
3. Keep dump files out of `/opt/docker/.secrets`.
4. Do not print passwords in logs or command output.
5. Ensure the dump directory is included in Borg coverage for `jellybase`.

Check latest dump:

```bash
readlink /opt/docker/appdata/postgres/logical-dumps/latest
find /opt/docker/appdata/postgres/logical-dumps/latest -maxdepth 1 -type f -print
```

## Backup/restore notes

Backup class: `postgres-volume-and-logical-dumps`.

Minimum restore path:

1. Restore `/opt/docker/appdata/postgres` from Borg.
2. Ensure `/opt/docker/.secrets/postgres_superuser_password` exists on the host.
3. Deploy `central-postgres`.
4. Verify `pg_isready`.
5. If volume restore is not usable, restore roles from `logical-dumps/latest/globals.sql` and restore app databases from custom-format dumps using `pg_restore`.

## Confirmed decisions

- Host: `jellybase`.
- Image: `postgres:17-alpine`.
- Bind: `192.168.1.2:5432`, restricted to `jellybase` and `jellyhome`.
- Initial superuser/default DB: `postgres` / `postgres`.
- First app DB/user: database `manyfold`, user `svc_manyfold`.
- Backup: Borg plus logical dumps from day one.

Current deployment notes:

- `central-postgres` is deployed on `jellybase` and healthy.
- The first Manyfold database/user pair exists: `manyfold` / `svc_manyfold`.
- `jellyhome` can reach `192.168.1.2:5432`.
- `jellyberry` was verified blocked from `192.168.1.2:5432`.
- The logical dump timer is enabled and active.

Remaining implementation detail:

- Persist or re-apply the Docker-aware firewall policy after container recreation, because the current helper matches the live `central-postgres` container IP.
