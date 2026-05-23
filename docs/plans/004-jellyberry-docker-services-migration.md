# Jellyberry Docker Services Migration Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Move ad-hoc Docker services currently running from `/home/jellybot/...` on `jellyberry` into the Git-backed `home-network` `/opt/docker` deployment pattern.

**Architecture:** Keep app source repositories where they already live when they are real projects, but make `home-network` the operational inventory and deployment source of truth. Runtime mounts, host overlays, appdata folders, Homepage entries, and migration runbooks live in `home-network`; secrets stay out of Git.

**Tech Stack:** Docker Compose, Nginx/static dashboards, Python app containers, `/opt/docker`, `home-network` inventory YAML, Homepage renderer.

---

## Current observed Docker services on jellyberry

Originally observed with `docker ps` on 2026-05-21 as ad-hoc Compose projects, then migrated into the `/opt/docker` home-network Compose project on jellyberry:

```text
portfolio-mission-control-v2   portfolio-intel compose project   port 8787
sc401-study-hub                study-web compose project         port 8791
image-pastebin                 image-pastebin compose project    port 8792
```

Original compose working directories kept for rollback:

```text
/home/jellybot/portfolio-intel/docker-compose.yml
/home/jellybot/sc-100-prep/study-web/docker-compose.yml
/home/jellybot/image-pastebin/docker-compose.yml
```

## Target service placement

```text
jellyberry
├── network-map                 http://jellyberry:8788
├── portfolio-mission-control-v2 http://jellyberry:8787
├── sc401-study-hub             http://jellyberry:8791
└── image-pastebin              http://jellyberry:8792
```

## Non-goals

- Do not move source code repositories into `/opt/docker`.
- Do not commit secrets from `/home/jellybot/.hermes/.env` or `/opt/docker/.env`.
- Do not stop existing containers until the equivalent `home-network` Compose config is validated.
- Do not remove old compose files until the new deployment is verified and rollback is documented.
- Do not expose unauthenticated admin data beyond the trusted LAN/Tailnet; Network Map and image-pastebin need explicit security notes until auth/reverse proxy exists.

---

### Task 1: Bootstrap `/opt/docker` on jellyberry

**Objective:** Make `/opt/docker` writable through the same `root:dockerops` model used by jellyhome.

**Files:**
- Read: `docs/operations/jellyberry-docker-host-bootstrap.md`

**Steps:**
1. Run the one-time sudo commands in `docs/operations/jellyberry-docker-host-bootstrap.md`.
2. Verify `id jellybot` includes `dockerops`.
3. Verify `/opt/docker` exists and is `root:dockerops`.

**Verification:**

```bash
ls -ld /opt/docker
id jellybot
```

Expected: `/opt/docker` exists and `jellybot` is in `dockerops`.

---

### Task 2: Deploy Network Map on jellyberry

**Objective:** Move Network Map hosting from jellyhome to jellyberry.

**Files:**
- Create: `docker/hosts/jellyberry.yaml`
- Modify: `docker/hosts/jellyhome.yaml`
- Modify: `inventory/services.yml`
- Modify: `docs/operations/network-map-dashboard.md`

**Steps:**
1. Keep the `network-map` service only in `docker/hosts/jellyberry.yaml`.
2. Set `inventory/services.yml` URL to `http://jellyberry:8788`.
3. Render and sync:

```bash
./scripts/network-map-render
./scripts/homepage-render
./scripts/sync-docker-config
```

4. Validate Compose:

```bash
docker compose --env-file /opt/docker/.env \
  -f docker/docker-compose.yml \
  -f docker/hosts/jellyberry.yaml \
  config >/dev/null
```

For a temporary sync check on jellyberry before `/opt/docker` is ready, use a writable temp directory and an existing group:

```bash
TMP_DOCKER_DIR=$(mktemp -d)
DOCKER_DIR="$TMP_DOCKER_DIR" DOCKER_GROUP=docker ./scripts/sync-docker-config
rm -rf "$TMP_DOCKER_DIR"
```

That temp sync check depends on `hostname -s` matching an existing `docker/hosts/<hostname>.yaml`; it is intended to run on jellyberry.

**Verification:**

```bash
docker compose --env-file /opt/docker/.env -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellyberry.yaml config >/dev/null
docker compose --env-file /opt/docker/.env -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellyberry.yaml up -d network-map
curl -fsS http://localhost:8788 >/dev/null
curl -fsS http://localhost:8788/data/inventory.json >/dev/null
```

---

### Task 3: Add portfolio Mission Control to home-network

**Objective:** Bring the existing `portfolio-mission-control-v2` runtime under `home-network` host overlay control while keeping `/home/jellybot/portfolio-intel` as the project source.

**Files:**
- Modify: `docker/hosts/jellyberry.yaml`
- Modify: `inventory/services.yml`
- Create/modify: `docs/operations/portfolio-mission-control.md`

**Compose source facts:**

```text
project: portfolio-intel
compose: /home/jellybot/portfolio-intel/docker-compose.yml
port: 8787
mounts:
  /home/jellybot/portfolio-intel/config:/app/config:ro
  /home/jellybot/portfolio-intel/docs:/app/docs:ro
  /home/jellybot/portfolio-intel/data:/app/data:ro
  /home/jellybot/portfolio-intel/mission-control-v2/data:/app/mission-control-v2/data:rw
  /home/jellybot/.hermes/.env:/run/secrets/hermes_env:ro
```

**Steps:**
1. Read `/home/jellybot/portfolio-intel/docker-compose.yml`.
2. Copy the service definition into `docker/hosts/jellyberry.yaml`, preserving image/build context and mounts.
3. Prefer a repo-built image tag if the service needs local build context; document the build command.
4. Add/confirm Homepage inventory entry with URL `http://jellyberry:8787`.
5. Validate without stopping the existing container.
6. Deploy using `home-network` Compose only after config passes.

**Verification:**

```bash
docker compose --env-file /opt/docker/.env -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellyberry.yaml config >/dev/null
curl -fsS http://localhost:8787 >/dev/null
```

**Rollback:** Existing `/home/jellybot/portfolio-intel/docker-compose.yml` remains available. If needed, run `docker compose -f /home/jellybot/portfolio-intel/docker-compose.yml up -d` from the original project.

---

### Task 4: Add SC-401 Study Hub to home-network

**Objective:** Bring the `sc401-study-hub` static site container under `home-network` control.

**Files:**
- Modify: `docker/hosts/jellyberry.yaml`
- Modify: `inventory/services.yml`
- Create/modify: `docs/operations/sc401-study-hub.md`

**Compose source facts:**

```text
project: study-web
compose: /home/jellybot/sc-100-prep/study-web/docker-compose.yml
port: 8791 -> 80
```

**Steps:**
1. Read the existing compose file and Dockerfile.
2. Decide whether this should run from a prebuilt local image or be rebuilt by an explicit script.
3. Add the service to `docker/hosts/jellyberry.yaml` with port `8791:80`.
4. Add Homepage metadata under a Study/Training category.
5. Validate and deploy after Network Map is stable.

**Verification:**

```bash
curl -fsS http://localhost:8791 >/dev/null
```

**Rollback:** Existing `/home/jellybot/sc-100-prep/study-web/docker-compose.yml` remains available until migration is verified.

---

### Task 5: Add image-pastebin to home-network

**Objective:** Bring the temporary LAN upload helper under inventory control, with an explicit safety note because it is an unauthenticated LAN service.

**Files:**
- Modify: `docker/hosts/jellyberry.yaml`
- Modify: `inventory/services.yml`
- Create/modify: `docs/operations/image-pastebin.md`

**Compose source facts:**

```text
project: image-pastebin
compose: /home/jellybot/image-pastebin/docker-compose.yml
port: 8792
mount: /home/jellybot/image-pastebin/uploads:/data/uploads:rw
```

**Steps:**
1. Read the existing compose file and Dockerfile.
2. Add the service to `docker/hosts/jellyberry.yaml` preserving the uploads bind mount.
3. Add a Homepage entry marked LAN-only/temporary.
4. Add cleanup instructions for stale uploads.
5. Validate and deploy after the study hub.

**Verification:**

```bash
curl -fsS http://localhost:8792 >/dev/null
```

**Rollback:** Existing `/home/jellybot/image-pastebin/docker-compose.yml` remains available until migration is verified.

---

### Task 6: Clean up duplicate compose ownership

**Objective:** Ensure each running service has one operational owner.

**Files:**
- Modify: `docs/operations/*.md` as needed
- Modify: `inventory/services.yml`

**Steps:**
1. Confirm each service is running from the `home-network` Compose project.
2. Stop old compose-project containers only after the new service responds correctly.
3. Keep source repos intact.
4. Record the final service ownership table.

**Verification:**

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
docker inspect <container> --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

Expected: migrated services are owned by the `/opt/docker`/`home-network` Compose project, not scattered ad-hoc compose projects.

---

## Final acceptance criteria

- `/opt/docker` exists on jellyberry with `root:dockerops` ownership.
- `network-map` runs from `docker/hosts/jellyberry.yaml`.
- Homepage links to `http://jellyberry:8788`.
- The three former ad-hoc jellyberry Docker services are represented in `inventory/services.yml` and run from `docker/hosts/jellyberry.yaml`.
- Each migrated service has an operation doc and rollback path.
- No secrets are committed.
- `docker compose config` passes for `jellyberry`.
