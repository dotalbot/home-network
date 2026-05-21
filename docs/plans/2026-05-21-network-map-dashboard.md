# Network Map Dashboard Implementation Plan

> **For Hermes:** Implement directly in small steps; use repository-development discipline for validation before commit/push.

**Goal:** Build an interactive web inventory/map for discovered LAN and Tailscale devices, deployed through the repo's Docker/Homepage workflow.

**Architecture:** Generate a static site from `inventory/devices.yml` into `docker/appdata/network-map/site`. Serve it with an `nginx:alpine` container from `/opt/docker/appdata/network-map/site`. Add the service to `inventory/services.yml` so `scripts/homepage-render` adds it to Homepage.

**Tech Stack:** Python 3 + PyYAML generator, static HTML/CSS/JS, nginx container, existing Docker Compose overlay pattern.

---

## Task 1: Add static network map generator

**Objective:** Convert `inventory/devices.yml` into a browser-friendly JSON data file and copy static assets into the Docker appdata tree.

**Files:**
- Create: `scripts/network-map-render`
- Create: `docker/appdata/network-map/site/index.html`
- Create: `docker/appdata/network-map/site/app.js`
- Create: `docker/appdata/network-map/site/styles.css`
- Generate: `docker/appdata/network-map/site/data/inventory.json`

**Verification:**
- `./scripts/network-map-render`
- `python3 -m json.tool docker/appdata/network-map/site/data/inventory.json >/dev/null`

## Task 2: Add Docker/Homepage integration

**Objective:** Make the map deployable through `/opt/docker` and visible in Homepage after `homepage-render`/deploy.

**Files:**
- Modify: `docker/hosts/jellyhome.yaml`
- Modify: `inventory/services.yml`
- Modify: `scripts/sync-docker-config`
- Modify: `justfile`

**Verification:**
- `./scripts/homepage-render`
- Confirm `docker/appdata/homepage/services.yaml` contains `Network Map`.
- `DOCKER_DIR=/tmp/home-network-docker ./scripts/sync-docker-config` should create `/tmp/home-network-docker/appdata/network-map/site`.

## Task 3: Add docs and ignore runtime discovery output

**Objective:** Keep discovery output out of git and document how to update/deploy the map.

**Files:**
- Modify: `.gitignore`
- Create: `docs/operations/network-map-dashboard.md`

**Verification:**
- `git status --short` should not show `.discovery/`.
- `git diff --check`

## Acceptance criteria

- Web UI shows device cards, summary counters, filters, search, selected-device detail panel, and simple topology grouping by LAN/Tailscale/category.
- Data comes from `inventory/devices.yml`.
- Static output resides under `docker/appdata/network-map/site` for sync to `/opt/docker/appdata/network-map/site`.
- Compose service runs on `jellyberry` at `http://jellyberry:8788`.
- Homepage gains a `Network Map` link after `homepage-render`.
- No sudo is required for repo-side generation/validation.

## Permission note

This host currently has no `/opt/docker` directory visible to the agent. Deployment to real `/opt/docker` may require the normal repo deploy workflow or owner permissions. Repo artifacts can still be generated and validated locally.
