# 004 — Central Postgres and Manyfold Adoption Spec

## Goal

Create a home-network managed central PostgreSQL service first, then adopt Manyfold onto that database and the verified 3D model libraries on `jellyhome`.

## Scope

- Add a central PostgreSQL service to the `/opt/docker` home-network Compose model.
- Run central PostgreSQL on `jellybase` because it is the shared infrastructure host and keeps database state separate from media-heavy `jellyhome` workloads.
- Store database state under `/opt/docker/appdata/postgres`.
- Store secrets outside Git under `/opt/docker/.secrets`.
- Expose PostgreSQL on `192.168.1.2:5432` only for approved LAN clients, initially `jellybase` and `jellyhome`, and protect access with per-service credentials.
- Add database-level source restrictions with `pg_hba.conf` and require host-level firewall or equivalent network policy before production-ready status.
- Add logical dumps from day one in addition to Borg volume coverage.
- Later add Manyfold as a home-network managed service on `jellyhome`, backed by the central PostgreSQL instance.

## Non-goals

- Do not start or reuse the legacy MariaDB/MySQL stack.
- Do not start legacy Manyfold Compose as-is.
- Do not commit real passwords, tokens, database dumps, or `.env` values.
- Do not deploy central Postgres until required secrets, network access policy, and backup approach are ready.
- Do not migrate Manyfold metadata until the old database/data state is either found or declared unnecessary.

## Current findings

- Legacy Manyfold is dormant and not present in `docker ps -a`.
- Legacy MariaDB/MySQL is not running and no stopped MariaDB container was found.
- Legacy Manyfold config points at stale `/home/dominic/...` paths.
- Real 3D libraries are mounted on `jellyhome` at:
  - `/home/jellyfish/media/Primary_5TB/3D_models`
  - `/home/jellyfish/media/Primary_5TB/3D_documents`
- The real `Primary_5TB` mount is `/dev/sdb1` at `/home/jellyfish/media/Primary_5TB`.
- Existing `onecli-postgres-1` containers are app-specific and bridge-bound, not a clean shared Postgres platform service.

## Confirmed central Postgres design

### Host

Runtime host: `jellybase` (`192.168.1.2`).

Rationale:
- Already hosts Prometheus, Grafana, Loki, Home Assistant, and other core always-on services.
- Already integrated into the `/opt/docker` home-network runtime.
- Keeps database service away from the media-heavy `jellyhome` workload while still serving Manyfold over the LAN.
- Creates a reusable shared database platform for future services rather than a Manyfold-only sidecar.

### Container

Service name/container:

```text
central-postgres
```

Image:

```text
postgres:17-alpine
```

Initial superuser/default database:

```text
postgres / postgres
```

Persistent paths:

```text
/opt/docker/appdata/postgres/data
/opt/docker/appdata/postgres/config/pg_hba.conf
/opt/docker/appdata/postgres/logical-dumps
```

Secret path expected on the host:

```text
/opt/docker/.secrets/postgres_superuser_password
```

LAN bind:

```text
192.168.1.2:5432 -> 5432/tcp
```

Initial approved clients:

```text
jellybase / 192.168.1.2
jellyhome / 192.168.1.1
```

Access policy:
- Bind only to the `jellybase` LAN IP, not `0.0.0.0`.
- Accept PostgreSQL host auth only from `jellybase` and `jellyhome` in source-managed `pg_hba.conf`.
- Deny other PostgreSQL host auth attempts in `pg_hba.conf`.
- Before production-ready status, add host-level firewall or equivalent Docker-aware policy so non-approved LAN clients cannot reach TCP/5432 at all.
- Tighten further later if Manyfold/app placement changes.

## Secrets model

No real secret values are stored in Git.

Minimum first-run secret:

```text
/opt/docker/.secrets/postgres_superuser_password
```

Manyfold-specific secret:

```text
/opt/docker/.secrets/postgres_manyfold_password
```

Recommended pattern:

- `postgres` superuser password: long random string, used only for admin/bootstrap.
- `svc_manyfold` application user password: separate long random string for the `manyfold` database.
- Future services each get a separate DB user/password.

## Backup and restore expectations

Central Postgres is high-priority state.

Backup class: `postgres-volume-and-logical-dumps`.

From day one, use both:

- Borg coverage of `/opt/docker/appdata/postgres`.
- Logical dumps under `/opt/docker/appdata/postgres/logical-dumps`.

Logical dumps should include:

- PostgreSQL globals/roles.
- Per-database custom-format dumps where practical, starting with `postgres` and then `manyfold` once created.

Restore target:

- Restore `/opt/docker/appdata/postgres` from Borg, including data and logical dump artifacts.
- Ensure required secret files exist on the host.
- Verify the service starts and passes `pg_isready`.
- Document a restore path using either the volume or logical dump artifacts.

Dump files must not contain secrets in filenames or logs, and must not live under `/opt/docker/.secrets`.

## Manyfold follow-up design

After PostgreSQL is running and verified:

- Add a `manyfold` service on `jellyhome` under `/opt/docker`.
- Use database `manyfold`.
- Use dedicated application user `svc_manyfold`.
- Store the `svc_manyfold` password outside Git at `/opt/docker/.secrets/postgres_manyfold_password`.
- Use Postgres connection details pointing at central Postgres on `192.168.1.2:5432`.
- Mount model libraries read/write or read-mostly after deciding metadata expectations:
  - `/home/jellyfish/media/Primary_5TB/3D_models:/libraries/3D_models`
  - `/home/jellyfish/media/Primary_5TB/3D_documents:/libraries/3D_documents`

## Progress checklist

- [x] Inspect legacy Manyfold and MariaDB state.
- [x] Verify `Primary_5TB` mount and 3D library paths.
- [x] Create feature branch for central Postgres and Manyfold adoption.
- [x] Draft central Postgres spec.
- [x] Confirm database host: `jellybase`.
- [x] Confirm PostgreSQL image: `postgres:17-alpine`.
- [x] Confirm initial superuser/default database values: `postgres` / `postgres`.
- [x] Confirm LAN bind policy: expose `192.168.1.2:5432` only to `jellybase` and `jellyhome`.
- [x] Confirm Manyfold database/user: database `manyfold`, user `svc_manyfold`.
- [x] Confirm backup policy: Borg plus logical dumps from day one.
- [x] Add source-managed `pg_hba.conf` for initial database-level host restrictions.
- [x] Add source-managed logical dump, firewall, systemd timer, and Manyfold DB bootstrap helper scripts.
- [x] User creates `/opt/docker/.secrets/postgres_superuser_password` on `jellybase`.
- [x] User creates `/opt/docker/.secrets/postgres_manyfold_password` on `jellybase`.
- [x] Apply/verify host-level access restriction allowing only `jellybase` and `jellyhome` to reach port `5432`.
- [x] Deploy central Postgres.
- [x] Verify `pg_isready` locally on `jellybase`.
- [x] Verify LAN reachability from `jellyhome`.
- [x] Verify PostgreSQL is not reachable from non-approved LAN hosts.
- [x] Create Manyfold database `manyfold` and user `svc_manyfold`.
- [x] Verify `svc_manyfold` can connect to database `manyfold` and is not a superuser.
- [x] Install timer, then run and verify logical dumps for central Postgres.
- [ ] Add Manyfold service on `jellyhome`.
- [ ] Verify Manyfold connects to central Postgres.
- [ ] Index/validate 3D model libraries in Manyfold.
- [ ] Document restore test for central Postgres using Borg and/or logical dump.

## Confirmed decisions

1. Central Postgres host: `jellybase`.
2. PostgreSQL image: `postgres:17-alpine`.
3. Initial PostgreSQL superuser/default database: `postgres` / `postgres`.
4. PostgreSQL bind: `192.168.1.2:5432`, restricted to `jellybase` and `jellyhome`.
5. Manyfold database: `manyfold`.
6. Manyfold database user: `svc_manyfold`.
7. Backup policy: Borg plus logical dumps from day one.
8. No real passwords, tokens, database dumps, or `.env` values are committed to Git.
