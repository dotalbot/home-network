# 004 — Central Postgres and Manyfold Adoption Spec

## Goal

Create a home-network managed central PostgreSQL service first, then adopt Manyfold onto that database and the verified 3D model libraries on `jellyhome`.

## Scope

- Add a central PostgreSQL service to the `/opt/docker` home-network Compose model.
- Prefer `jellybase` as the first database host because it already hosts monitoring and long-running infrastructure.
- Store database state under `/opt/docker/appdata/postgres`.
- Store secrets outside Git under `/opt/docker/.secrets`.
- Expose PostgreSQL on the LAN only when explicitly approved and protected by strong per-service credentials.
- Later add Manyfold as a home-network managed service, backed by the central PostgreSQL instance.

## Non-goals

- Do not start or reuse the legacy MariaDB/MySQL stack.
- Do not start legacy Manyfold Compose as-is.
- Do not commit real passwords, tokens, database dumps, or `.env` values.
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

## Proposed central Postgres design

### Host

Initial host: `jellybase` (`192.168.1.2`).

Rationale:
- Already hosts Prometheus, Grafana, Loki, Home Assistant, and other core always-on services.
- Already integrated into the `/opt/docker` home-network runtime.
- Keeps database service away from the media-heavy `jellyhome` workload unless we decide otherwise.

### Container

Service name/container:

```text
central-postgres
```

Image:

```text
postgres:17-alpine
```

Persistent path:

```text
/opt/docker/appdata/postgres/data
```

Secret path expected on the host:

```text
/opt/docker/.secrets/postgres_superuser_password
```

LAN bind under review:

```text
192.168.1.2:5432 -> 5432/tcp
```

If we decide to avoid LAN exposure at first, bind to `127.0.0.1:5432` and add app-specific networking later.

## Secrets model

No real secret values are stored in Git.

Minimum first-run secret:

```text
/opt/docker/.secrets/postgres_superuser_password
```

Later Manyfold-specific secrets:

```text
/opt/docker/.secrets/postgres_manyfold_password
```

Recommended pattern:

- `postgres` superuser password: long random string, used only for admin/bootstrap.
- `manyfold` application user password: separate long random string.
- Future services each get a separate DB user/password.

## Backup and restore expectations

Central Postgres is high-priority state.

Initial backup class: `appdata-and-database`.

Restore target:

- Restore `/opt/docker/appdata/postgres` from Borg.
- Verify the service starts and passes `pg_isready`.
- For future maturity, add logical dumps or `pg_dumpall` before relying only on volume-level restore.

## Manyfold follow-up design

After PostgreSQL is running and verified:

- Add a `manyfold` service on `jellyhome` under `/opt/docker`.
- Use Postgres connection details pointing at central Postgres.
- Mount model libraries read/write or read-mostly after deciding metadata expectations:
  - `/home/jellyfish/media/Primary_5TB/3D_models:/libraries/3D_models`
  - `/home/jellyfish/media/Primary_5TB/3D_documents:/libraries/3D_documents`
- Use a dedicated Manyfold database and user.

## Progress checklist

- [x] Inspect legacy Manyfold and MariaDB state.
- [x] Verify `Primary_5TB` mount and 3D library paths.
- [x] Create feature branch for central Postgres and Manyfold adoption.
- [x] Draft central Postgres spec.
- [ ] Confirm database host and LAN bind policy.
- [ ] User creates `/opt/docker/.secrets/postgres_superuser_password` on the chosen host.
- [ ] Add/verify central Postgres Compose service.
- [ ] Deploy central Postgres.
- [ ] Verify `pg_isready` and LAN reachability from intended app hosts.
- [ ] Define first app database/user pattern.
- [ ] Add Manyfold service and dedicated DB credentials.
- [ ] Index/validate 3D model libraries in Manyfold.

## Open questions

1. Should the central Postgres service live on `jellybase` as proposed?
2. Should PostgreSQL bind to LAN IP `192.168.1.2:5432` immediately, or start localhost-only?
3. Are you happy with `postgres:17-alpine`, or do you prefer another version?
4. Should I name the admin secret file `/opt/docker/.secrets/postgres_superuser_password`?
5. Should the first application DB be `manyfold` with user `manyfold`, or do you want a naming prefix such as `svc_manyfold`?
6. Do you want per-service logical dumps in addition to Borg volume backup from the start?
