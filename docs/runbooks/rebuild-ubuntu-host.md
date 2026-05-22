# Ubuntu Host Rebuild Runbook

This document describes the standard rebuild process for a Docker host in the `home-network` platform.

Examples:
- jellyhome
- jellybase

---

# Goal

Recover a failed/rebuilt Ubuntu host with:

- standard tooling
- Docker structure
- Tailscale connectivity
- deployment config
- restored appdata
- operational services

---

# Phase 1 — Fresh OS install

Install:

```text
Ubuntu Server LTS
```

Recommended:
- Ubuntu 24.04 LTS or newer
- static DHCP reservation
- hostname set correctly

Example:

```text
jellyhome
jellybase
```

---

# Phase 2 — Initial access

Create admin user:

```text
jellyfish
```

Enable SSH.

Verify:

```bash
ssh jellyfish@HOST
```

---

# Phase 3 — Clone home-network repo

Install Git if required:

```bash
sudo apt update
sudo apt install -y git
```

Clone:

```bash
mkdir -p ~/repo
cd ~/repo

git clone GIT_REMOTE_URL home-network
```

---

# Phase 4 — Run bootstrap

```bash
cd ~/repo/home-network

chmod +x bootstrap/bootstrap-ubuntu.sh

sudo ./bootstrap/bootstrap-ubuntu.sh
```

This should:
- install Docker
- install Tailscale
- install just
- install jq/yq
- install Borg/Borgmatic tooling
- install node_exporter and disk health tooling once `docs/specs/node-exporter-disk-health-spec.md` is approved
- create dockerops group
- create /opt/docker layout

---

# Phase 5 — Join Tailscale

If not already joined:

```bash
sudo tailscale up
```

Verify:

```bash
tailscale status
```

---

# Phase 6 — Restore .env and secrets

Restore:

```text
/opt/docker/.env
/opt/docker/.secrets/
```

from:
- Borg
- password manager
- secure backup

Never commit live secrets into Git.

---

# Phase 7 — Sync Docker config

```bash
cd ~/repo/home-network

just sync-docker-config
```

Verify:

```bash
tree /opt/docker
```

Expected:

```text
/opt/docker
├── docker-compose.yml
├── hosts
├── appdata
└── .secrets
```

---

# Phase 8 — Restore Borg data

Restore required appdata.

Example:

```text
/opt/docker/appdata
```

Restore strategy depends on service type.

See:
- inventory/backups.yml
- inventory/services.yml

---

# Phase 9 — Deploy services

```bash
just deploy
```

Verify:

```bash
docker ps
```

---

# Phase 10 — Verify operational stack

Run:

```bash
just status
```

Verify:
- Homepage
- Dozzle
- Portainer
- Netdata
- Prometheus
- Grafana

---

# Phase 11 — Verify drift

```bash
just drift-check
```

Expected:

```text
good
```

or only known ignored containers.

---

# Phase 12 — Verify backup readiness

```bash
just backup-policy-check
just borg-check
```

---

# Phase 13 — Final validation

Check:

```text
Homepage accessible
Monitoring accessible
Docker healthy
Tailscale connected
Expected containers running
```

---

# Notes

## Git remains source of truth

```text
home-network repo = desired state
/opt/docker       = deployed state
```

## Do not rebuild manually forever

If fixes are made live:

```text
copy them back into Git
commit them
```

Otherwise the rebuild path drifts.

## Recovery principle

The objective is:

```text
A dead host becomes an inconvenience, not a disaster.
```
