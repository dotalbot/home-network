# home-network

Git-backed source of truth for the home lab: hosts, Docker services, backups, dashboards, recovery notes, and operational runbooks.

This repo answers the practical questions:

- What machines exist?
- What services run where?
- How is `/opt/docker` built on each Docker host?
- How do we deploy, verify, and recover services?
- What is backed up, and where are restore notes kept?

## Trust boundary

This is a private infrastructure repo. It can contain internal hostnames, LAN IPs, MAC addresses, service URLs, open-port inventory, and Tailnet names.

Do not publish this repo publicly without first redacting inventory and generated dashboard data.

Secrets do not belong in git. Keep runtime secrets in host-local files such as:

```text
/opt/docker/.env
/opt/docker/.secrets/
/home/jellybot/.hermes/.env
```

## Platform specification and roadmap

Use these as the current planning documents before starting the next structured work:

```text
docs/specs/home-network-platform-spec.md
docs/roadmap/product-roadmap.md
docs/README.md
```

The spec records what the platform is, what has already been built, and the operating rules. The roadmap records completed stages, known gaps, and the next phase sequence.

## Current shape

```text
home-network/
├── bootstrap/                 # host bootstrap helpers
├── docker/                    # repo-managed Docker source-of-truth
│   ├── docker-compose.yml     # shared base compose file
│   ├── hosts/                 # host-specific compose overlays
│   └── appdata/               # repo-managed config/static dashboard data
├── docs/                      # setup notes, operations docs, runbooks, plans
├── inventory/                 # hosts, services, devices, backup policy
├── scripts/                   # deploy, status, render, and drift-check tooling
└── justfile                   # common operator commands
```

Runtime Docker files are synced to:

```text
/opt/docker
```

`home-network` is the source of truth. `/opt/docker` is the runtime copy.

## Managed hosts

Primary inventory file:

```text
inventory/hosts.yml
```

Current host roles include:

- `jellyhome` — main Ubuntu Docker/dev server
- `jellybase` — secondary Ubuntu Docker/monitoring server
- `jellyberry` — Raspberry Pi Docker host for Hermes and lightweight local services
- `jellybackup` — Borg backup server
- `seedbox` — remote sync/backup helper

## Managed services

Primary service inventory file:

```text
inventory/services.yml
```

Currently tracked service groups include:

- Homepage
- Dozzle
- Portainer
- Network Map
- Portfolio Mission Control
- SC-401 Study Hub
- Image Pastebin
- Netdata
- Prometheus
- Grafana
- Home Assistant
- planned media/IoT services

The active jellyberry local services are managed via `/opt/docker`:

```text
http://jellyberry:8788  Network Map
http://jellyberry:8787  Portfolio Mission Control
http://jellyberry:8791  SC-401 Study Hub
http://jellyberry:8792  Image Pastebin
```

## Common commands

Run these from a managed Docker/operator host with this repo checked out. Some commands also require `/opt/docker`, Docker, `/opt/docker/.env`, Borg config/secrets, and host-local service source trees to exist on that host.

List available commands:

```bash
just --list
```

Check host/service status:

```bash
just status
```

Render Homepage and Network Map config, sync to `/opt/docker`, then deploy:

```bash
just homepage-deploy
```

Sync repo-managed Docker config to `/opt/docker`:

```bash
just sync-docker-config
```

Validate the runtime Compose config for the current host:

```bash
just compose-config
```

Check expected vs running containers:

```bash
just drift-check-strict
```

Check Borg backup policy and local rollout readiness:

```bash
just backup-policy-check
just borg-check
just borgmatic-rollout-discovery
just borgmatic-rollout-generate
just host-monitoring-policy-check
just node-exporter-rollout-generate
```

Restart a managed service:

```bash
just restart <service-name>
```

Example:

```bash
just restart network-map
```

## Docker model

The repo uses a shared base compose file plus host overlays:

```text
docker/docker-compose.yml
docker/hosts/<hostname>.yaml
```

On a Docker host, the runtime copy lives at:

```text
/opt/docker/docker-compose.yml
/opt/docker/hosts/<hostname>.yaml
/opt/docker/appdata/
```

The expected management pattern is:

1. Edit files in this repo.
2. Run validation locally.
3. Sync to `/opt/docker`.
4. Deploy with Docker Compose from `/opt/docker`.
5. Run drift and HTTP checks.
6. Commit the repo changes.

## Bootstrap a Docker host

Start with:

```text
docs/operations/docker-host-bootstrap.md
```

Important convention:

- `/opt/docker` should be owned by `root:dockerops`.
- directories should keep the setgid bit so new files inherit `dockerops`.
- normal operations should not require sudo once group permissions are correct.

Expected permission shape:

```text
drwxrwsr-x root dockerops /opt/docker
```

## Network Map

Network Map is a static dashboard generated from inventory data.

Source and generated files:

```text
inventory/hosts.yml
inventory/services.yml
inventory/devices.yml
docker/appdata/network-map/site/
scripts/network-map-render
```

Render it with:

```bash
just network-map-render
```

Operational docs:

```text
docs/operations/network-map-dashboard.md
docs/operations/safe-network-discovery.md
```

Note: Network Map exposes internal topology. Keep it LAN/Tailnet-only unless auth or a protected reverse proxy is added.

## Monitoring and observability

Prometheus and Grafana run on `jellybase`:

```text
http://jellybase:9090  Prometheus
http://jellybase:3001  Grafana
```

Current first-pass host telemetry is implemented for:

```text
jellyhome:9100   node_exporter
jellybase:9100   node_exporter
jellyberry:9100  node_exporter
```

Prometheus scrapes these under job `node_exporter`. In the current Docker scrape path, `jellybase` may appear as `host.docker.internal:9100` while the metric `host` label remains `jellybase`.

Visible metric families include standard node_exporter host metrics, sanitized Borgmatic textfile metrics, and `home_network_disk_health_*` disk-health metrics. Grafana is reachable, but source-managed dashboard/provisioning files remain follow-up work. TCP `9100` access-control hardening is also still a staged follow-up; keep endpoints LAN/Tailnet-only.

Operational docs:

```text
docs/operations/node-exporter-disk-health.md
docs/specs/node-exporter-disk-health-spec.md
docs/plans/2026-05-22-node-exporter-disk-health-rollout.md
```

Useful checks:

```bash
just host-monitoring-policy-check
just node-exporter-rollout-generate
```

## Backups and restore

Backup policy lives in:

```text
inventory/backups.yml
```

Backup/restore planning is now also captured in:

```text
docs/specs/home-network-platform-spec.md
docs/roadmap/product-roadmap.md
```

Backup class alignment and local rollout readiness are validated by:

```bash
just backup-policy-check
just borgmatic-rollout-discovery
just borgmatic-rollout-generate
```

Runbooks live in:

```text
docs/runbooks/
docs/operations/
```

Useful starting points:

```text
docs/runbooks/rebuild-ubuntu-host.md
docs/runbooks/service-restore-template.md
docs/operations/docker-host-bootstrap.md
```

## Development workflow

Use feature branches. Do not commit directly to `main`.

Suggested flow:

```bash
git status --short --branch
git checkout -b feat/my-change
# edit files
just compose-config
just drift-check-strict
git diff --check
git add <files>
git commit -m "type: describe change"
git push -u origin HEAD
```

Open a PR only when ready for review. Merge only after explicitly deciding to merge.

## Quick troubleshooting

If `just sync-docker-config` asks for sudo unexpectedly, check `/opt/docker` permissions:

```bash
stat -c '%A %U %G %n' /opt/docker
```

If the group-write bit is missing, fix it:

```bash
sudo chmod -R g+rwX /opt/docker
sudo find /opt/docker -type d -exec chmod g+s {} \;
```

If drift check reports unexpected containers:

1. Check whether the container should be managed by this repo.
2. Add it to `inventory/services.yml` and the relevant host overlay if yes.
3. Stop/remove old ad-hoc Compose containers only after the new managed service is validated.

Docker docs: the network always keeps receipts. Unfortunately, so does Git.
