# Central Postgres and Manyfold Adoption Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a reusable central PostgreSQL platform service to `home-network`, then adopt Manyfold onto it with the verified 3D libraries.

**Architecture:** Put central Postgres in the Git-backed `/opt/docker` Compose model on `jellybase`, with persistent state under `/opt/docker/appdata/postgres`, passwords supplied through `/opt/docker/.secrets`, PostgreSQL bound to `192.168.1.2:5432`, and access restricted to `jellybase` and `jellyhome`. Manyfold remains a follow-up service on `jellyhome` after Postgres health, secret handling, network restrictions, and backup expectations are verified.

**Tech Stack:** Docker Compose, `postgres:17-alpine`, `/opt/docker`, Borg/Borgmatic backup policy, PostgreSQL logical dumps, YAML inventory, `just` tasks.

## Progress checklist

- [x] Task 1: Branch and spec baseline.
- [x] Task 2 draft: Central Postgres Compose service exists in `docker/hosts/jellybase.yaml`.
- [x] Task 3 draft: Inventory metadata exists for `central-postgres`; `jellybase` has database roles.
- [x] Task 4 draft: Operator notes exist for first-run central Postgres secrets.
- [x] Task 2 final: Compose service matches approved LAN bind and secret policy.
- [x] Task 3 final: Inventory/backup metadata reflects logical dumps from day one.
- [x] Task 4 final: Operations notes cover `svc_manyfold` and day-one logical dumps.
- [x] Task 5 draft: Source-managed `pg_hba.conf` restricts database-level host auth to `jellybase` and `jellyhome`.
- [x] Task 6 draft: Logical dump, firewall, systemd timer, and Manyfold DB bootstrap helper scripts exist.
- [x] Task 5 final: Deploy central Postgres after required secret files exist.
- [x] Task 6 final: Apply and verify TCP-level firewall/network restrictions before production-ready status.
- [x] Task 7 final: Install timer, run logical dump automation after deploy, and confirm dump artifacts.
- [x] Task 8: Prepare Manyfold database `manyfold` and user `svc_manyfold`.
- [ ] Task 9: Add Manyfold service on `jellyhome`.
- [ ] Task 10: Verify Manyfold library indexing and backup/restore notes.

---

## Task 1: Branch and spec baseline

**Objective:** Establish a reviewable branch and write the implementation spec.

**Files:**
- Create: `docs/specs/004-central-postgres-and-manyfold.md`
- Create: `docs/plans/010-central-postgres-and-manyfold.md`

**Steps:**
1. Pull latest `main` with `git pull --ff-only origin main`.
2. Create `feat/central-postgres-manyfold`.
3. Document current findings, desired architecture, open questions, and progress checklist.
4. Run `git diff --check`.

**Verification:**
- Branch exists and is not `main`.
- Spec contains a progress checklist.
- No real secrets appear in the diff.

## Task 2: Add central Postgres Compose service

**Objective:** Define the central Postgres service without committing any secret values.

**Files:**
- Modify: `docker/hosts/jellybase.yaml`
- Modify: `docker/.env.example`
- Create: `docker/appdata/postgres/config/pg_hba.conf`

**Implementation notes:**
- Add service `central-postgres`.
- Use `postgres:17-alpine`.
- Use initial `POSTGRES_USER=postgres` and `POSTGRES_DB=postgres` defaults via `.env.example`.
- Use `POSTGRES_PASSWORD_FILE=/run/secrets/postgres_superuser_password`.
- Define top-level Compose secret `postgres_superuser_password` pointing at `/opt/docker/.secrets/postgres_superuser_password`.
- Mount `/opt/docker/appdata/postgres/data:/var/lib/postgresql/data`.
- Mount source-managed `pg_hba.conf` from `/opt/docker/appdata/postgres/config/pg_hba.conf`.
- Mount `/opt/docker/appdata/postgres/logical-dumps:/logical-dumps` for day-one dump artifacts.
- Healthcheck with `pg_isready`.
- Bind to `192.168.1.2:${POSTGRES_PORT:-5432}:5432`.
- `pg_hba.conf` allows only:
  - `jellybase` / `192.168.1.2`
  - `jellyhome` / `192.168.1.1`
- Deny other PostgreSQL host auth attempts.
- Add or document host-level firewall/network policy allowing TCP `5432` only from approved hosts before production-ready status.

**Verification:**
```bash
docker compose --env-file docker/.env.example -f docker/docker-compose.yml -f docker/hosts/jellybase.yaml config >/tmp/central-postgres-compose.yaml
grep -n "central-postgres" /tmp/central-postgres-compose.yaml
grep -n "host_ip: 192.168.1.2" /tmp/central-postgres-compose.yaml
grep -n "pg_hba.conf" /tmp/central-postgres-compose.yaml
```

Expected: exits 0 and rendered config contains `central-postgres`, host IP `192.168.1.2`, and the `pg_hba.conf` mount.

After deploy:
- From `jellyhome`, `nc -vz 192.168.1.2 5432` succeeds.
- From a non-approved LAN host, connection to `192.168.1.2:5432` fails or is blocked.

## Task 3: Add inventory and backup metadata

**Objective:** Make central Postgres visible in service inventory and backup policy.

**Files:**
- Modify: `inventory/services.yml`
- Modify: `inventory/hosts.yml`
- Modify: `inventory/backups.yml`

**Implementation notes:**
- Add service key `central-postgres` under category `Data`.
- Host: `jellybase`.
- Container: `central-postgres`.
- Endpoint: `postgresql://192.168.1.2:5432`.
- Backup class: `postgres-volume-and-logical-dumps`.
- Add `database-host` and `postgres-primary` roles to `jellybase`.
- Record that central Postgres requires both Borg-covered data volume backup and logical dumps from day one.
- Record access policy metadata: bind host `192.168.1.2`, allowed sources `192.168.1.2` and `192.168.1.1`, denied by default.

**Verification:**
```bash
just backup-policy-check
```

Expected: `good`.

## Task 4: Add operator notes for first-run secrets

**Objective:** Give the user exact non-secret commands to create required secret files on the runtime host.

**Files:**
- Create/modify: `docs/operations/central-postgres.md`

**Implementation notes:**
Document commands in a way that does not print secrets:

```bash
sudo install -d -m 750 -o root -g dockerops /opt/docker/.secrets
sudo touch /opt/docker/.secrets/postgres_superuser_password
sudo touch /opt/docker/.secrets/postgres_manyfold_password
sudo chown root:dockerops /opt/docker/.secrets/postgres_superuser_password /opt/docker/.secrets/postgres_manyfold_password
sudo chmod 640 /opt/docker/.secrets/postgres_superuser_password /opt/docker/.secrets/postgres_manyfold_password
```

Then the user edits the files directly on `jellybase`. Do not ask the user to paste passwords into chat.

Also document:
- `/opt/docker/.secrets/postgres_manyfold_password` for `svc_manyfold`.
- Logical dump directory `/opt/docker/appdata/postgres/logical-dumps`.
- `/opt/docker/.secrets` is not a dump destination.

**Verification:**
- Docs contain paths and permissions.
- Docs do not contain actual password values.

## Task 5: Deploy central Postgres after secrets exist

**Objective:** Sync the Compose config to `/opt/docker`, start only central Postgres, and verify health.

**Prerequisite:** User confirms the secret file exists on `jellybase`.

**Commands:**
```bash
just compose-config
just up central-postgres

docker inspect central-postgres --format '{{.State.Health.Status}}'
docker exec central-postgres pg_isready -U postgres -d postgres
```

If LAN-bound, also verify from `jellyhome`:

```bash
nc -vz 192.168.1.2 5432
```

**Expected:**
- Compose config renders.
- Container is healthy.
- `pg_isready` succeeds.
- LAN port is reachable from `jellyhome`.

## Task 6: Enforce TCP-level access restrictions

**Objective:** Ensure Postgres TCP/5432 is reachable only from approved clients, not the whole LAN.

**Files:**
- Modify: `docs/operations/central-postgres.md`
- Create: `scripts/postgres-firewall-docker-user`

**Implementation notes:**
- Compose binding to `192.168.1.2` avoids `0.0.0.0` exposure but does not by itself restrict source hosts.
- `pg_hba.conf` rejects non-approved PostgreSQL auth sources, but non-approved hosts may still complete TCP connection attempts unless host firewall/network policy blocks them.
- Use `scripts/postgres-firewall-docker-user --print` and `--check` to inspect intended policy; the helper matches the current `central-postgres` container IP for Docker-published port traffic.
- Use `scripts/postgres-firewall-docker-user --apply` only after inspecting live `DOCKER-USER`/firewall rules.
- If `jellybase` uses nftables or another persistent mechanism, translate the same allowlist policy and document the choice.
- Do not blindly overwrite firewall state.

**Verification:**
```bash
ss -ltnp | grep ':5432'
# Expected: 192.168.1.2:5432, not 0.0.0.0:5432
```

From `jellyhome`:

```bash
nc -vz 192.168.1.2 5432
# Expected: succeeds
```

From a non-approved LAN host:

```bash
nc -vz 192.168.1.2 5432
# Expected: fails, times out, or is rejected
```

## Task 7: Add day-one logical dump automation

**Objective:** Ensure central Postgres has logical dumps in addition to Borg volume coverage before it is considered production-ready.

**Files:**
- Create: `scripts/postgres-logical-dump`
- Create: `systemd/central-postgres-logical-dump.service`
- Create: `systemd/central-postgres-logical-dump.timer`
- Modify: `scripts/sync-docker-config`
- Modify: `docs/operations/central-postgres.md`
- Modify: `inventory/backups.yml`

**Implementation notes:**
- Dump PostgreSQL globals/roles.
- Dump application databases where practical, starting with `postgres` and `manyfold` once created.
- Store dumps under `/opt/docker/appdata/postgres/logical-dumps`.
- Do not print passwords or include secrets in filenames.
- Use local container execution so credentials are not exposed in process lists.
- Ensure dump output is covered by Borg for `jellybase`.

**Verification:**
```bash
bash -n scripts/postgres-logical-dump
```

After deploy:
```bash
/opt/docker/bin/postgres-logical-dump
sudo cp systemd/central-postgres-logical-dump.service /etc/systemd/system/
sudo cp systemd/central-postgres-logical-dump.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now central-postgres-logical-dump.timer
find /opt/docker/appdata/postgres/logical-dumps/latest -maxdepth 1 -type f -print
```

Expected:
- A manual dump run succeeds.
- Dump files are created in the documented location.
- Dump logs do not contain passwords.

## Task 8: Prepare Manyfold database/user

**Objective:** Create the first application DB/user pattern for Manyfold.

**Prerequisite:** User creates `/opt/docker/.secrets/postgres_manyfold_password`.

**Files:**
- Create: `scripts/postgres-bootstrap-manyfold`
- Modify: `docs/operations/central-postgres.md`

**Implementation notes:**
- Database: `manyfold`.
- User: `svc_manyfold`.
- Script reads `/opt/docker/.secrets/postgres_manyfold_password`.
- Script creates/updates role `svc_manyfold` without printing the password.
- Script creates database `manyfold` owned by `svc_manyfold` if missing.
- Script verifies `svc_manyfold` is not a superuser.

**Verification:**
```bash
bash -n scripts/postgres-bootstrap-manyfold
```

After deploy:
```bash
./scripts/postgres-bootstrap-manyfold
docker exec central-postgres psql -U postgres -d postgres -Atc "SELECT rolsuper FROM pg_roles WHERE rolname='svc_manyfold'"
```

Expected:
- Database `manyfold` exists.
- User `svc_manyfold` exists.
- `svc_manyfold` can connect to database `manyfold`.
- `svc_manyfold` is not a superuser.

## Task 9: Add Manyfold service

**Objective:** Add Manyfold to `home-network` using central Postgres and verified 3D library mounts.

**Files:**
- Modify: `docker/hosts/jellyhome.yaml`
- Modify: `inventory/services.yml`
- Modify: `docs/specs/004-central-postgres-and-manyfold.md`

**Implementation notes:**
- Use the correct paths:
  - `/home/jellyfish/media/Primary_5TB/3D_models`
  - `/home/jellyfish/media/Primary_5TB/3D_documents`
- Do not use stale `/home/dominic/...` paths.
- Use database `manyfold` and user `svc_manyfold`.
- Use the per-app password secret; do not commit any real password.

**Verification:**
- Compose config renders on `jellyhome`.
- Manyfold starts.
- Manyfold can connect to Postgres.
- Manyfold can see the model library mount(s).

## Confirmed decisions

- Database host: `jellybase`.
- PostgreSQL bind: `192.168.1.2:5432`, restricted to `jellybase` and `jellyhome`.
- PostgreSQL image: `postgres:17-alpine`.
- Initial superuser/default database: `postgres` / `postgres`.
- Superuser password file: `/opt/docker/.secrets/postgres_superuser_password`.
- Manyfold password file: `/opt/docker/.secrets/postgres_manyfold_password`.
- Manyfold database/user: database `manyfold`, user `svc_manyfold`.
- Backup policy: Borg plus logical dumps from day one.
- No secrets or dump contents are committed to Git.
