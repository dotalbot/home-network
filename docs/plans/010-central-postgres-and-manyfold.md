# Central Postgres and Manyfold Adoption Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a reusable central PostgreSQL platform service to `home-network`, then adopt Manyfold onto it with the verified 3D libraries.

**Architecture:** Put central Postgres in the Git-backed `/opt/docker` Compose model on the chosen infrastructure host, with persistent state under `/opt/docker/appdata/postgres` and passwords supplied through `/opt/docker/.secrets`. Manyfold remains a follow-up service after Postgres health, secret handling, and backup expectations are verified.

**Tech Stack:** Docker Compose, `postgres:17-alpine`, `/opt/docker`, Borg/Borgmatic backup policy, YAML inventory, `just` tasks.

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

**Implementation notes:**
- Add service `central-postgres`.
- Use `postgres:17-alpine` unless user chooses another version.
- Use `POSTGRES_PASSWORD_FILE=/run/secrets/postgres_superuser_password`.
- Define top-level Compose secret `postgres_superuser_password` pointing at `/opt/docker/.secrets/postgres_superuser_password`.
- Mount `/opt/docker/appdata/postgres/data:/var/lib/postgresql/data`.
- Healthcheck with `pg_isready`.
- Bind policy must match the user's answer:
  - LAN option: `192.168.1.2:${POSTGRES_PORT:-5432}:5432`
  - localhost option: `127.0.0.1:${POSTGRES_PORT:-5432}:5432`

**Verification:**
```bash
docker compose --env-file docker/.env.example -f docker/docker-compose.yml -f docker/hosts/jellybase.yaml config >/tmp/central-postgres-compose.yaml
```

Expected: exits 0 and rendered config contains `central-postgres`.

## Task 3: Add inventory and backup metadata

**Objective:** Make central Postgres visible in service inventory and backup policy.

**Files:**
- Modify: `inventory/services.yml`
- Modify: `inventory/hosts.yml`
- Optional modify: `inventory/backups.yml` if a more specific backup class is needed.

**Implementation notes:**
- Add service key `central-postgres` under category `Data` or `Core`.
- Host: `jellybase` unless user chooses otherwise.
- Container: `central-postgres`.
- URL/endpoint: `postgresql://192.168.1.2:5432` if LAN-bound, otherwise mark local-only.
- Backup class: start with `appdata-and-database`.
- Add `database-host` or `postgres-primary` role to `jellybase`.

**Verification:**
```bash
just backup-policy-check
```

Expected: `good`.

## Task 4: Add operator notes for first-run secrets

**Objective:** Give the user exact non-secret commands to create required secret files on the runtime host.

**Files:**
- Create: `docs/operations/central-postgres.md`

**Implementation notes:**
Document commands in a way that does not print secrets, for example:

```bash
sudo install -d -m 750 -o root -g dockerops /opt/docker/.secrets
sudo install -m 640 -o root -g dockerops /dev/stdin /opt/docker/.secrets/postgres_superuser_password
```

Then the user pastes a password into stdin and sends EOF, or uses their preferred editor. Do not ask the user to paste passwords into Discord.

**Verification:**
- Docs contain paths and permissions.
- Docs do not contain actual password values.

## Task 5: Deploy central Postgres after secrets exist

**Objective:** Sync the Compose config to `/opt/docker`, start only central Postgres, and verify health.

**Prerequisite:** User confirms the secret file exists on the chosen host.

**Commands:**
```bash
just compose-config
just up central-postgres

docker inspect central-postgres --format '{{.State.Health.Status}}'
docker exec central-postgres pg_isready -U postgres
```

If LAN-bound, also verify from `jellyhome`:

```bash
nc -vz 192.168.1.2 5432
```

**Expected:**
- Compose config renders.
- Container is healthy.
- `pg_isready` succeeds.
- LAN port is reachable only if LAN binding was chosen.

## Task 6: Prepare Manyfold database/user

**Objective:** Create the first application DB/user pattern for Manyfold.

**Prerequisite:** User provides/creates `/opt/docker/.secrets/postgres_manyfold_password`.

**Implementation options:**
- Manual one-time SQL over `docker exec`.
- Or repo-managed idempotent bootstrap script that reads password files on the host and never prints values.

**Verification:**
- `manyfold` database exists.
- `manyfold` user can connect but does not have superuser privileges.

## Task 7: Add Manyfold service

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
- Use a dedicated Manyfold DB user/password.

**Verification:**
- Compose config renders on `jellyhome`.
- Manyfold starts.
- Manyfold can connect to Postgres.
- Manyfold can see the model library mount(s).

## Open decisions before Task 2 deploy

- Database host: `jellybase` or another host.
- Port binding: LAN `192.168.1.2:5432` or localhost-only first.
- Postgres image version.
- Secret filenames.
- Initial app DB/user naming convention.
- Whether to add logical dumps immediately.
