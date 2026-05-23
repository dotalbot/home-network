# Home Network Setup Steps

This document records the setup decisions and commands agreed so far for the `home-network` repo and the first stage of the homelab control-plane setup.

Current planning docs now live in:

```text
docs/specs/001-home-network-platform.md
docs/roadmap/product-roadmap.md
docs/README.md
```

Treat this file as historical setup context. Use the spec and roadmap above for current next-step planning.

The goal is to create a simple, repeatable, Git-backed structure for managing Docker services, host roles, service placement, recovery, and future automation.

---

## Current working principles

- `home-network` is the source-of-truth repo.
- Docker services follow the deployrr-style layout:
  - shared base compose file
  - host-specific compose overlays
  - app data kept under one predictable directory
  - secrets kept outside normal config files
- Not every service should be active/active.
- Homepage and similar light dashboard services can be active/active.
- Stateful services such as Mosquitto, Calibre, Prometheus, databases, and media tools should normally be single-primary unless deliberately designed otherwise.
- BorgBackup remains the real backup system.
- Dev folder sync is allowed for manual failover, but sync is not a backup.
- Docker management should be centralised but not become the source of truth.
- Hermes can assist with setup and drift checks, but Git should remain the authority.

---

# Step 1 — Repo and folder foundation

## What was done

The main repo already exists:

```text
home-network
```

The initial folder structure has been created:

```text
home-network/
├── inventory/
├── docker/
├── bootstrap/
├── scripts/
├── docs/
├── chezmoi/
└── hermes/
```

## Purpose

This repo becomes the central place to answer:

- What machines exist?
- What roles do they perform?
- What services run where?
- How do we rebuild a host?
- How do we deploy Docker services?
- How do we recover from Borg backups?
- How do we generate dashboard/homepage entries?

---

# Step 2 — Define all hosts

## File to create

```text
inventory/hosts.yml
```

## Starter content

```yaml
# inventory/hosts.yml

hosts:
  jellyhome:
    description: Main Ubuntu Docker/dev server
    roles:
      - docker-host
      - homepage-primary
      - dozzle-ui
      - portainer-server
      - calibre
      - mqtt
      - netdata-parent
      - dev-server
      - borg-client
      - tailscale-node

  jellybase:
    description: Secondary Ubuntu Docker/monitoring server
    roles:
      - docker-host
      - homepage-secondary
      - prometheus
      - dozzle-agent
      - portainer-agent
      - netdata-parent
      - dev-sync-mirror
      - borg-client
      - tailscale-node

  jellyberry:
    description: Raspberry Pi monitoring/lightweight services node
    roles:
      - pi
      - dozzle-agent
      - netdata-child
      - borg-client
      - tailscale-node

  seedbox:
    description: Remote seedbox / remote sync / backup helper
    roles:
      - remote-server
      - remote-sync
      - remote-backup
      - tailscale-exit-node
      - borg-target
```

## Commit command

```bash
git add inventory/hosts.yml
git commit -m "Add host inventory"
```

## Why this matters

This file is the start of the machine inventory. It provides a simple structured view of each host and what that host is responsible for.

Later this can be used by:

- deployment scripts
- Homepage generation
- Borg backup policy
- Netdata grouping
- Hermes runbooks
- recovery docs
- service placement checks

---

# Step 3 — Standardise Docker layout

## Target Docker path

On Docker hosts, use:

```text
/opt/docker
```

Initial target hosts:

- `jellyhome`
- `jellybase`

Raspberry Pis can be added later if they run Docker workloads.

---

## Step 3.1 — Create the base folder structure

Run on each Docker host:

```bash
sudo mkdir -p /opt/docker/{appdata,hosts,.secrets}
```

Expected layout:

```text
/opt/docker
├── appdata
├── hosts
└── .secrets
```

---

## Step 3.2 — Use a dedicated management group

Instead of making `/opt/docker` owned directly by one normal user, use a dedicated group.

Recommended group:

```text
dockerops
```

Create the group:

```bash
sudo groupadd dockerops
```

If the group already exists, this may return an error. That is fine. You can check with:

```bash
getent group dockerops
```

Add your admin user to it:

```bash
sudo usermod -aG dockerops jellyfish
```

Apply group ownership:

```bash
sudo chgrp -R dockerops /opt/docker
```

Allow the group to write:

```bash
sudo chmod -R 775 /opt/docker
```

Make new files inherit the group:

```bash
sudo find /opt/docker -type d -exec chmod g+s {} \;
```

Recommended final ownership model:

```text
/opt/docker owned by root:dockerops
trusted admin user is a member of dockerops
random users are not members of dockerops
```

Check:

```bash
ls -ld /opt/docker
id jellyfish
```

You may need to log out and back in before group membership applies.

## Why this matters

Anyone who can edit Docker compose files and run Docker commands can effectively gain root-level power on that host.

So this should be limited to trusted admin users only.

---

## Step 3.3 — Corrected shared base compose file

The earlier idea of using Watchtower as the first shared service has been removed.

Reason:

- Watchtower is not a good default for this setup.
- The project/repo is read-only/archived.
- Automatic container updates are risky for a controlled home server platform.
- Updates should be reviewed and applied through Git/deploy commands.

Use an empty shared base file for now.

Create:

```bash
nano /opt/docker/docker-compose.yml
```

Content:

```yaml
services: {}
```

This allows the shared/host overlay pattern to be tested without adding unnecessary services.

---

## Step 3.4 — Host overlay for jellyhome

Create:

```bash
nano /opt/docker/hosts/jellyhome.yaml
```

Starter content:

```yaml
services:

  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    container_name: homepage
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      TZ: Europe/London
    volumes:
      - /opt/docker/appdata/homepage:/app/config

  dozzle:
    image: amir20/dozzle:latest
    container_name: dozzle
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

## What jellyhome runs at this stage

```text
jellyhome
├── homepage
└── dozzle UI
```

Later planned/potential services on `jellyhome`:

```text
jellyhome
├── calibre-web-automated
├── mosquitto mqtt
├── portainer server
├── netdata parent
└── dev services
```

---

## Step 3.5 — Host overlay for jellybase

Create:

```bash
nano /opt/docker/hosts/jellybase.yaml
```

Starter content:

```yaml
services:

  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    container_name: homepage
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      TZ: Europe/London
    volumes:
      - /opt/docker/appdata/homepage:/app/config
```

## What jellybase runs at this stage

```text
jellybase
└── homepage
```

Later planned/potential services on `jellybase`:

```text
jellybase
├── prometheus
├── dozzle agent
├── portainer agent
├── netdata parent
└── dev sync mirror
```

---

## Step 3.6 — Deploy using shared base + host overlay

On each host:

```bash
cd /opt/docker
```

Validate the combined compose config:

```bash
docker compose \
  -f docker-compose.yml \
  -f hosts/$(hostname).yaml \
  config
```

Deploy:

```bash
docker compose \
  -f docker-compose.yml \
  -f hosts/$(hostname).yaml \
  up -d
```

Check containers:

```bash
docker ps
```

---

## Step 3.7 — Create appdata folders

On `jellyhome`:

```bash
mkdir -p \
  /opt/docker/appdata/homepage \
  /opt/docker/appdata/dozzle \
  /opt/docker/appdata/mosquitto \
  /opt/docker/appdata/calibre-web-automated
```

On `jellybase`:

```bash
mkdir -p \
  /opt/docker/appdata/homepage \
  /opt/docker/appdata/prometheus
```

These folders prepare the standard appdata layout even before all services are deployed.

---

## Step 3.8 — Copy Docker configs back into Git

Inside the `home-network` repo, keep versioned copies:

```text
home-network/docker/
├── docker-compose.yml
└── hosts/
    ├── jellyhome.yaml
    └── jellybase.yaml
```

Copy from live host paths into the repo as needed:

```bash
mkdir -p docker/hosts
cp /opt/docker/docker-compose.yml docker/docker-compose.yml
cp /opt/docker/hosts/$(hostname).yaml docker/hosts/$(hostname).yaml
```

Commit:

```bash
git add docker/docker-compose.yml docker/hosts/
git commit -m "Add deployrr-style Docker layout"
```

Long-term, Git should become the source of truth, and `/opt/docker` should be deployed from the repo rather than manually edited forever.

---

# Current service placement model

## Active/active candidates

Good active/active or duplicated services:

```text
homepage
netdata parents
dozzle agents
portainer agents
reverse proxy layer, later
uptime/status dashboards, later
```

## Single-primary candidates

Better as single-primary unless deliberately redesigned:

```text
calibre-web-automated
mosquitto mqtt
prometheus
postgres/databases
media managers
file indexers
anything with a writable database or persistent state
```

---

# Current intended host responsibilities

## jellyhome

```text
Primary Docker/dev host
Homepage primary
Dozzle UI
Future Portainer server
Future Calibre-Web-Automated
Future Mosquitto MQTT
Netdata parent
Borg client
Tailscale node
```

## jellybase

```text
Secondary Docker/monitoring host
Homepage secondary
Future Prometheus host
Future Dozzle agent
Future Portainer agent
Netdata parent
Dev sync mirror
Borg client
Tailscale node
```

## jellyberry

```text
Raspberry Pi lightweight node
Netdata child
Possible Dozzle agent if Docker is present
Borg client if it has local state worth backing up
Tailscale node
```

## seedbox

```text
Remote server
Remote sync helper
Backup target or backup relay
Tailscale exit node
Possible Dozzle agent if Docker is present
```

---

# Near-term next steps

The next stage is Step 4: shared management stack.

Planned additions:

```text
Portainer server on jellyhome
Portainer agents on Docker hosts
Dozzle agents on Docker hosts
Netdata parent/child design
Homepage configuration
Service inventory file
```

Suggested next files to create:

```text
inventory/services.yml
scripts/deploy
scripts/status
scripts/homepage-render
```

---

# Important reminders

- Do not put secrets directly in Git.
- Do not let Portainer become the source of truth.
- Do not rely on sync as backup.
- Keep BorgBackup as the recovery/history mechanism.
- Keep host-specific config in `docker/hosts/$HOSTNAME.yaml`.
- Keep persistent service data in `docker/appdata/$SERVICE`.
- Use Hermes to assist and check, not to silently mutate production.


