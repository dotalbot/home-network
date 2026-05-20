# Home Network Step 4 Fixes and Fiddles

This document records the practical issues encountered while getting the Step 4 shared management and monitoring stack running.

It is intended as a troubleshooting/runbook companion to the main setup guide.

---

## Final target state

At the end of this round, the intended working shape is:

```text
jellyhome
├── homepage
├── portainer
├── dozzle
└── netdata

jellybase
├── homepage
├── portainer-agent
├── dozzle-agent
├── netdata
├── prometheus
└── grafana
```

The operating model remains:

```text
Git / home-network repo = source of truth
/opt/docker             = live deploy location
Portainer               = operational Docker console
Dozzle                  = central Docker logs
Netdata                 = live host and service state
Prometheus              = long-term metrics
Grafana                 = historical dashboards
BorgBackup              = real backup and recovery
```

Important rule:

```text
Portainer, Dozzle, Netdata, Prometheus and Grafana help operate the platform.
They do not replace Git as the source of truth.
```

---

# 0. Documentation and setup corrections

## Watchtower was removed from the base compose file

An earlier idea used Watchtower as a starter service. This was removed.

Reason:

```text
Watchtower is not the right default for this controlled homelab setup.
Automatic updates are risky.
Image updates should be reviewed, committed to Git, then deployed.
```

The corrected shared base compose file is deliberately empty:

```yaml
services: {}
```

File location:

```text
/opt/docker/docker-compose.yml
```

Repo location:

```text
home-network/docker/docker-compose.yml
```

## Use the dockerops group for /opt/docker

The safer ownership model is:

```text
/opt/docker owned by root:dockerops
trusted admin user is a member of dockerops
random users are not members of dockerops
```

Commands:

```bash
sudo groupadd dockerops || true
sudo usermod -aG dockerops jellyfish
sudo chgrp -R dockerops /opt/docker
sudo chmod -R 775 /opt/docker
sudo find /opt/docker -type d -exec chmod g+s {} \;
```

Check:

```bash
ls -ld /opt/docker
id jellyfish
```

Log out and back in if the group membership does not show.

Why this matters:

```text
A user who can edit Docker compose files and run Docker can effectively gain root-level power on the host.
```

## Do not commit live secrets

Do not commit:

```text
/opt/docker/.env
docker/.env
/opt/docker/.secrets/
docker/.secrets/
```

Recommended `.gitignore` entries:

```gitignore
.env
docker/.env
docker/.secrets/
**/.secrets/
```

Use an example file instead:

```text
docker/.env.example
```

Suggested content:

```env
TZ=Europe/London

PORTAINER_AGENT_SECRET=replace-me

GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=replace-me

NETDATA_CLAIM_TOKEN=
NETDATA_CLAIM_URL=
NETDATA_CLAIM_ROOMS=
```

---

# 1. Portainer Agent port conflict on jellyhome

## Symptom

Running the compose deployment on `jellyhome` produced:

```text
Bind for 0.0.0.0:9001 failed: port is already allocated
```

## Cause

`portainer-agent` was being started on `jellyhome`, but `jellyhome` was also running the main Portainer server.

Because the Portainer server on `jellyhome` has direct access to the local Docker socket, it does not need a local Portainer Agent.

## Fix

Remove this block from `/opt/docker/hosts/jellyhome.yaml`:

```yaml
  portainer-agent:
    image: portainer/agent:lts
    container_name: portainer-agent
    restart: unless-stopped
    ports:
      - "9001:9001"
    environment:
      AGENT_SECRET: ${PORTAINER_AGENT_SECRET}
      TZ: ${TZ}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /var/lib/docker/volumes:/var/lib/docker/volumes
```

Keep `portainer-agent` on `jellybase`.

## Correct design

```text
jellyhome
└── portainer server with local Docker socket

jellybase
└── portainer-agent exposed on 9001
```

## Useful diagnostic commands

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}' | grep 9001 || true
sudo ss -ltnp | grep ':9001' || true
```

---

# 2. Dozzle showed jellybase online but jellyhome offline

## Symptom

The Dozzle UI at:

```text
http://jellyhome:8080
```

was working and could see `jellybase`, but showed `jellyhome` as offline.

## Cause

The Dozzle UI container on `jellyhome` was trying to connect back to `jellyhome:7007` as if the local machine were a remote Dozzle agent.

From inside the Dozzle container, that hostname/port path may not route back to the local host agent cleanly.

## Fix

Use this pattern:

```text
Dozzle UI on jellyhome reads local Docker through /var/run/docker.sock
Dozzle UI reads remote Docker hosts through dozzle-agent
```

So `jellyhome` should run:

```text
dozzle UI only
```

and `jellybase` should run:

```text
dozzle-agent
```

## Correct `dozzle` block on jellyhome

```yaml
  dozzle:
    image: amir20/dozzle:latest
    container_name: dozzle
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      TZ: ${TZ}
      DOZZLE_REMOTE_AGENT: "jellybase:7007|jellybase|HomeLab"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

## What was removed from jellyhome

Remove the local `dozzle-agent` block from `jellyhome.yaml`.

## Correct design

```text
jellyhome
├── dozzle UI
└── local Docker socket mount

jellybase
└── dozzle-agent on port 7007
```

## Useful test commands

From `jellyhome`:

```bash
curl http://jellybase:7007
```

From inside the Dozzle container:

```bash
docker exec -it dozzle sh
wget -qO- http://jellybase:7007
```

If hostname resolution is unreliable, use a Tailscale hostname or Tailscale IP instead of `jellybase`.

---

# 3. Prometheus YAML error: external_labels in wrong location

## Symptom

Prometheus failed with:

```text
field external_labels not found in type config.plain
```

## Cause

The config had:

```yaml
external_labels:
  monitor: jellybase-prometheus
  site: home-network
```

at the top level.

Prometheus expects `external_labels` under `global`.

## Fix

Use:

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: jellybase-prometheus
    site: home-network

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets:
          - localhost:9090

  - job_name: netdata-parents
    metrics_path: /api/v1/allmetrics
    params:
      format:
        - prometheus_all_hosts
      source:
        - average
    static_configs:
      - targets:
          - jellyhome:19999
          - host.docker.internal:19999
```

File location:

```text
/opt/docker/appdata/prometheus/config/prometheus.yml
```

Why `host.docker.internal` is used:

```text
Prometheus runs inside Docker on jellybase.
When Prometheus tries to scrape jellybase:19999, Docker/container DNS may resolve jellybase to 127.0.1.1.
That points back into the container context, not the host Netdata listener.
host.docker.internal with host-gateway gives the container a reliable route back to the Docker host.
```

---

# 4. Prometheus validation command correction

## Symptom

Attempting to validate the Prometheus config with the default image command returned:

```text
Error parsing command line arguments: unexpected promtool
prometheus: error: unexpected promtool
```

## Cause

The `prom/prometheus` image starts the `prometheus` binary by default.

So Docker was passing `promtool` as an argument to `prometheus`, rather than running the `promtool` binary.

## Correct validation command

```bash
docker run --rm \
  --entrypoint=/bin/promtool \
  -v /opt/docker/appdata/prometheus/config/prometheus.yml:/etc/prometheus/prometheus.yml:ro \
  prom/prometheus:latest \
  check config /etc/prometheus/prometheus.yml
```

Expected output:

```text
Checking /etc/prometheus/prometheus.yml
 SUCCESS: /etc/prometheus/prometheus.yml is valid prometheus config file syntax
```

---

# 5. Prometheus permission error on data directory

## Symptom

Prometheus started, then crashed repeatedly with:

```text
panic: Unable to create mmap-ed active query log
```

Logs showed:

```text
Error opening query log file
file=/prometheus/queries.active
err="open /prometheus/queries.active: permission denied"
```

## Cause

The mounted data directory was not writable by the user Prometheus runs as inside the container.

Host path:

```text
/opt/docker/appdata/prometheus/data
```

Container path:

```text
/prometheus
```

## Fix

Stop Prometheus:

```bash
cd /opt/docker

docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname).yaml \
  stop prometheus
```

Fix ownership:

```bash
sudo chown -R nobody:nogroup /opt/docker/appdata/prometheus/data
sudo chmod -R 775 /opt/docker/appdata/prometheus/data
```

If `nobody:nogroup` is not accepted, use numeric IDs:

```bash
sudo chown -R 65534:65534 /opt/docker/appdata/prometheus/data
sudo chmod -R 775 /opt/docker/appdata/prometheus/data
```

Restart:

```bash
docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname).yaml \
  up -d prometheus
```

Check:

```bash
docker logs --tail=50 prometheus
```

## Rule to remember

```text
Prometheus data folder → nobody:nogroup or 65534:65534
```

---

# 6. Grafana permission error on data directory

## Symptom

Grafana started but logs showed:

```text
GF_PATHS_DATA='/var/lib/grafana' is not writable.
mkdir: can't create directory '/var/lib/grafana/plugins': Permission denied
```

## Cause

The mounted Grafana data directory was not writable by the Grafana container user.

Grafana commonly runs as:

```text
472:472
```

Host path:

```text
/opt/docker/appdata/grafana
```

Container path:

```text
/var/lib/grafana
```

## Fix

Stop Grafana:

```bash
cd /opt/docker

docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname).yaml \
  stop grafana
```

Fix ownership:

```bash
sudo mkdir -p /opt/docker/appdata/grafana
sudo chown -R 472:472 /opt/docker/appdata/grafana
sudo chmod -R 775 /opt/docker/appdata/grafana
```

Restart:

```bash
docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname).yaml \
  up -d grafana
```

Check:

```bash
docker logs --tail=50 grafana
```

## Rule to remember

```text
Grafana data folder → 472:472
```

---

# 7. Netdata Docker setup

## Intended role

For now:

```text
jellyhome = Netdata live host monitor / future primary parent
jellybase = Netdata live host monitor / future fallback parent
```

Current decision:

```text
Do not configure parent-to-parent streaming yet.
Do not configure child streaming yet.
First get both Netdata agents stable and visible.
```

## Required folders

Run on both `jellyhome` and `jellybase`:

```bash
mkdir -p \
  /opt/docker/appdata/netdata/config \
  /opt/docker/appdata/netdata/lib \
  /opt/docker/appdata/netdata/cache
```

## Permissions

Netdata container commonly uses:

```text
201:201
```

Apply:

```bash
sudo chown -R 201:201 /opt/docker/appdata/netdata
sudo chmod -R 775 /opt/docker/appdata/netdata
```

## Netdata service block for jellyhome

```yaml
  netdata:
    image: netdata/netdata:stable
    container_name: netdata
    hostname: jellyhome
    restart: unless-stopped

    network_mode: host
    pid: host

    cap_add:
      - SYS_PTRACE
      - SYS_ADMIN

    security_opt:
      - apparmor:unconfined

    environment:
      TZ: ${TZ}

    volumes:
      - /opt/docker/appdata/netdata/config:/etc/netdata
      - /opt/docker/appdata/netdata/lib:/var/lib/netdata
      - /opt/docker/appdata/netdata/cache:/var/cache/netdata

      - /:/host/root:ro,rslave
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro

      - /etc/passwd:/host/etc/passwd:ro
      - /etc/group:/host/etc/group:ro
      - /etc/os-release:/host/etc/os-release:ro
      - /etc/localtime:/etc/localtime:ro

      - /var/run/docker.sock:/var/run/docker.sock:ro
```

## Netdata service block for jellybase

```yaml
  netdata:
    image: netdata/netdata:stable
    container_name: netdata
    hostname: jellybase
    restart: unless-stopped

    network_mode: host
    pid: host

    cap_add:
      - SYS_PTRACE
      - SYS_ADMIN

    security_opt:
      - apparmor:unconfined

    environment:
      TZ: ${TZ}

    volumes:
      - /opt/docker/appdata/netdata/config:/etc/netdata
      - /opt/docker/appdata/netdata/lib:/var/lib/netdata
      - /opt/docker/appdata/netdata/cache:/var/cache/netdata

      - /:/host/root:ro,rslave
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro

      - /etc/passwd:/host/etc/passwd:ro
      - /etc/group:/host/etc/group:ro
      - /etc/os-release:/host/etc/os-release:ro
      - /etc/localtime:/etc/localtime:ro

      - /var/run/docker.sock:/var/run/docker.sock:ro
```

## Netdata validation

Run locally on each Netdata host:

```bash
curl http://localhost:19999/api/v1/info
```

Expected:

```text
JSON response containing hostname, version, reachable status and collector information.
```

On `jellybase`, this confirmed Netdata was healthy locally, so later Prometheus scrape failure was a Docker-to-host routing issue rather than a dead Netdata service.

---

# 8. Prometheus could scrape jellyhome Netdata but not jellybase Netdata

## Symptom

Prometheus showed:

```text
jellyhome:19999 UP
jellybase:19999 DOWN
```

Error:

```text
dial tcp 127.0.1.1:19999: connect: connection refused
```

## Cause

Netdata on `jellybase` was running and reachable from the host:

```bash
curl http://localhost:19999/api/v1/info
```

But Prometheus was running inside Docker.

Inside that container context, `jellybase` resolved to `127.0.1.1`, so Prometheus tried to connect to the wrong place.

## Fix

Use `host.docker.internal` for the local host target and map it through Docker's host gateway.

In `/opt/docker/appdata/prometheus/config/prometheus.yml`:

```yaml
  - job_name: netdata-parents
    metrics_path: /api/v1/allmetrics
    params:
      format:
        - prometheus_all_hosts
      source:
        - average
    static_configs:
      - targets:
          - jellyhome:19999
          - host.docker.internal:19999
```

In the Prometheus service block:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Restart:

```bash
cd /opt/docker

docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname).yaml \
  up -d prometheus
```

Check targets:

```text
http://jellybase:9090/targets
```

Expected:

```text
jellyhome:19999              UP
host.docker.internal:19999   UP
```

---

# 9. Final known-good Prometheus service block

For `jellybase`:

```yaml
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.path=/prometheus"
      - "--storage.tsdb.retention.time=90d"
      - "--web.enable-lifecycle"
    volumes:
      - /opt/docker/appdata/prometheus/config/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - /opt/docker/appdata/prometheus/data:/prometheus
```

---

# 10. Final known-good Grafana service block

For the host running Grafana:

```yaml
  grafana:
    image: grafana/grafana-oss:latest
    container_name: grafana
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      TZ: ${TZ}
      GF_SECURITY_ADMIN_USER: ${GRAFANA_ADMIN_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:-change-me}
    volumes:
      - /opt/docker/appdata/grafana:/var/lib/grafana
```

If Grafana is on `jellybase`, open:

```text
http://jellybase:3001
```

If Grafana is on `jellyhome`, open:

```text
http://jellyhome:3001
```

---

# 11. Grafana datasource and dashboard notes

## Grafana login works but shows nothing

Cause:

```text
Grafana does not show data just because it is running.
It needs a datasource and dashboards/panels.
```

Add Prometheus as a datasource:

```text
Connections → Data sources → Add data source → Prometheus
```

If Grafana and Prometheus are on the same Docker compose network, use:

```text
http://prometheus:9090
```

If that fails, use:

```text
http://jellybase:9090
```

or configure `host.docker.internal` for Grafana too.

## Query test

In Grafana Explore, select the Prometheus datasource and test:

```promql
up
```

In Explore mode, queries auto-run, or can be re-run with the top-right refresh button.

## Imported Netdata dashboards may show N/A

An imported dashboard showed:

```text
N/A
No data
Instance variable warning
cpu variable warning
```

Cause:

```text
The imported dashboard expected different metric names or labels from the current Netdata Prometheus export.
This is a dashboard compatibility issue, not necessarily a broken monitoring stack.
```

Known working test:

```promql
up
```

Next task for another day:

```text
Discover actual Netdata metric names exported by the current Netdata version and build/import a compatible dashboard.
```

Useful discovery queries:

```promql
up
```

```promql
{__name__=~".*"}
```

Or use:

```text
Grafana → Explore → Metrics browser
```

Search for:

```text
cpu
system
disk
ram
```

---

# 12. Final access URLs

Current known-good service URLs:

```text
Dozzle:
  http://jellyhome:8080

Portainer:
  https://jellyhome:9443

Homepage:
  http://jellyhome:3000
  http://jellybase:3000

Netdata:
  http://jellyhome:19999
  http://jellybase:19999

Prometheus:
  http://jellybase:9090

Grafana:
  http://jellybase:3001
```

---

# 13. Troubleshooting checklist

## Docker config render

Before deploying:

```bash
cd /opt/docker

docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname).yaml \
  config
```

## Start one service only

```bash
docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname).yaml \
  up -d prometheus
```

## Logs

```bash
docker logs --tail=50 prometheus
docker logs --tail=50 grafana
docker logs --tail=50 dozzle
docker logs --tail=50 portainer
docker logs --tail=50 netdata
```

## Ports

```bash
sudo ss -ltnp | grep ':9090'
sudo ss -ltnp | grep ':3001'
sudo ss -ltnp | grep ':8080'
sudo ss -ltnp | grep ':9443'
sudo ss -ltnp | grep ':19999'
```

## Running containers

```bash
docker ps
```

## Prometheus targets

Open:

```text
http://jellybase:9090/targets
```

Expected:

```text
prometheus        UP
netdata-parents   UP
```

---

# 14. Copy working configs back into Git

Once fixed live under `/opt/docker`, copy the working files back into the `home-network` repo.

From each host:

```bash
cd ~/repo/home-network

mkdir -p docker/hosts

cp /opt/docker/docker-compose.yml docker/docker-compose.yml
cp /opt/docker/hosts/$(hostname).yaml docker/hosts/$(hostname).yaml
```

Make sure these exist in the repo:

```text
docker/docker-compose.yml
docker/hosts/jellyhome.yaml
docker/hosts/jellybase.yaml
docker/.env.example
docs/step-4-management-stack-fixes.md
.gitignore
```

Do not copy live secrets into Git.

Commit:

```bash
cd ~/repo/home-network

git status

git add \
  inventory/hosts.yml \
  docker/docker-compose.yml \
  docker/hosts/jellyhome.yaml \
  docker/hosts/jellybase.yaml \
  docker/.env.example \
  .gitignore \
  docs/

git commit -m "Add Step 4 shared management stack"
```

Alternative commit message:

```bash
git commit -m "Document working management stack fixes"
```

---

# 15. Lessons learned

## Keep local and remote management paths distinct

Do not force the local host through its own remote agent unless there is a clear reason.

Use:

```text
local host   → Docker socket or host-gateway
remote hosts → agent or host DNS
```

## Permission problems are normal with bind mounts

Some containers do not run as root.

Useful remembered ownerships:

```text
Prometheus → 65534:65534
Grafana    → 472:472
Netdata    → 201:201
```

## Validate configs before blaming Docker

For Prometheus:

```bash
docker run --rm \
  --entrypoint=/bin/promtool \
  -v /opt/docker/appdata/prometheus/config/prometheus.yml:/etc/prometheus/prometheus.yml:ro \
  prom/prometheus:latest \
  check config /etc/prometheus/prometheus.yml
```

## Grafana being empty is not a failure

Grafana requires:

```text
datasource
queries
dashboards
compatible metrics
```

The fact that `up` works proves the datasource path is working.

## Netdata is the better live view for now

For day-to-day immediate debugging:

```text
Netdata + Dozzle
```

For historical dashboards:

```text
Prometheus + Grafana
```

## Keep Git as the truth

The live `/opt/docker` files are the working deployment.

The `home-network` repo must be updated after fixes, otherwise the rebuild path will be wrong.

---

# 16. Dad-joke-grade summary

The platform now works because we remembered the oldest law of Docker:

```text
The container is innocent until the bind mount is proven guilty.
```

