# Home Network Platform Specification

Status: draft
Last updated: 2026-05-21
Source inputs:
- `/tmp/home-network-platform-pack.zip`
- `README.md`
- `inventory/hosts.yml`
- `inventory/services.yml`
- `inventory/backups.yml`
- `justfile`
- Existing operations/runbook docs under `docs/`

## 1. Purpose

`home-network` is the Git-backed source of truth for the home lab platform. It should make Docker hosts, service placement, backup policy, deployment commands, drift detection, and recovery steps explicit enough that a failed host is an inconvenience, not a disaster.

The platform is evolving from standalone Docker hosts into a small personal infrastructure control plane:

```text
Git inventory + docs
      ↓
rendered dashboard/config
      ↓
/opt/docker runtime copy
      ↓
Docker Compose services
      ↓
status, drift, backup, and restore checks
```

## 2. Principles

- Git is the authority; live hosts are deployed state.
- `/opt/docker` is the runtime Docker root on managed hosts.
- Secrets stay outside git in host-local locations such as `/opt/docker/.env`, `/opt/docker/.secrets/`, and `/home/jellybot/.hermes/.env`.
- Boring, explicit systems are preferred over clever orchestration.
- Portainer and dashboards may observe and operate, but must not become the only source of configuration truth.
- Sync is not backup; Borg remains the recovery/history mechanism.
- Rerunnable automation should repair expected structure, not surprise-delete production state.
- LAN/Tailnet-only services must stay inside the trusted boundary until auth or a protected reverse proxy exists.

## 3. Current completed platform stages

The platform pack identifies these completed stages. Current repo files support them as follows:

| Stage | Evidence / current source of truth |
| --- | --- |
| Repo structure | `README.md`, `docs/`, `inventory/`, `docker/`, `scripts/`, `justfile` |
| Host inventory | `inventory/hosts.yml` |
| Deployrr-style Docker layout | `docker/docker-compose.yml`, `docker/hosts/*.yaml`, `/opt/docker` runtime convention |
| Shared management stack | Homepage, Dozzle, Portainer, Netdata, Prometheus, Grafana entries in inventory and Compose overlays |
| Homepage generation | `scripts/homepage-render`, `docker/appdata/homepage/*.yaml`, `just homepage-render` |
| Network Map generation | `scripts/network-map-render`, `docker/appdata/network-map/site/` |
| Drift detection | `scripts/drift-check`, `just drift-check-strict` |
| Backup policy | `inventory/backups.yml`, `scripts/backup-policy-check` |
| Borgmatic/Borg integration | `scripts/borg-check`, restore runbooks under `docs/runbooks/` |

## 4. Managed hosts

Authoritative host metadata lives in `inventory/hosts.yml`.

Current platform roles:

- `jellyhome` — main Ubuntu Docker/dev server.
- `jellybase` — secondary Ubuntu Docker/monitoring/home-automation server.
- `jellyberry` — Raspberry Pi Docker host for Hermes and lightweight local services.
- `jellybackup` — Borg backup server.
- `seedbox` — remote sync/backup helper.

Expected host baseline:

- Tailscale joined and reachable.
- Docker Engine and Compose plugin installed where the host has `docker-host` responsibilities.
- `/opt/docker` exists with `root:dockerops` ownership and setgid directories.
- Repo-managed Docker files are synced from this repo into `/opt/docker`.
- Host-specific runtime overlay is selected by short hostname: `/opt/docker/hosts/$(hostname -s).yaml`.

## 5. Service model

Authoritative service metadata lives in `inventory/services.yml`.

Service placement modes:

- `active-active` — safe duplicate/lightweight services such as Homepage.
- `central-ui-plus-agents` — central UI with remote agents, such as Dozzle and Portainer.
- `single-primary` — one writable owner for stateful services.
- `single-primary-home-network-compose` — one host-managed service deployed by the home-network Compose model.
- `duplicated-parents` — intentionally duplicated parent/collector services such as current Netdata placement.

Stateful services must default to single-primary unless explicitly designed for replication/failover. Examples: Mosquitto, Home Assistant, Prometheus, Grafana, databases, media libraries, and anything with writable application state.

## 6. Runtime and deployment model

Source-of-truth paths:

```text
docker/docker-compose.yml
docker/hosts/<hostname>.yaml
docker/appdata/
inventory/*.yml
scripts/*
justfile
```

Runtime paths:

```text
/opt/docker/docker-compose.yml
/opt/docker/hosts/<hostname>.yaml
/opt/docker/appdata/
/opt/docker/.env
/opt/docker/.secrets/
```

Primary operator commands:

```bash
just status
just homepage-render
just network-map-render
just sync-docker-config
just compose-config
just deploy
just homepage-deploy
just drift-check-strict
just backup-policy-check
just borg-check
```

Expected deployment flow:

1. Edit source-of-truth files in this repo.
2. Render generated config or dashboards when inventory changes.
3. Validate Compose and generated artifacts.
4. Sync repo-managed Docker config to `/opt/docker`.
5. Deploy from `/opt/docker`.
6. Verify service health, drift status, and backup policy.
7. Commit the repo changes.

## 7. Backup and restore model

Authoritative backup metadata lives in `inventory/backups.yml`.

Backup classes currently include:

- `config-only`
- `appdata`
- `appdata-and-database`
- `appdata-and-library`
- `config-and-persistence`
- `config-and-cache`
- `source-repo`
- `appdata-and-source-repo`
- `uploads-if-needed`

Required restore flow for any managed service:

1. Bootstrap or repair the target host.
2. Restore required data from Borg when the service is not config-only.
3. Sync Docker config from this repo to `/opt/docker`.
4. Deploy the service.
5. Verify application health.
6. Run drift and backup checks.

Backup class labels are now declared for the active service inventory. Restore maturity still depends on service-specific metadata and runbooks. Source-built services should carry source metadata in `inventory/services.yml`:

```yaml
source:
  type: git | local-directory
  local_path: /path/on/host
  remote: git remote or TBD
  build_context: /path/used/by/compose
  dockerfile: Dockerfile
  restore_note: short host-specific restore note
```

## 8. Observability and operations

Current operational capabilities:

- Homepage gives service navigation.
- Network Map gives inventory/topology visibility.
- Dozzle gives container log access.
- Portainer gives container management UI while Git remains authoritative.
- Netdata provides per-host/system visibility.
- Prometheus/Grafana provide monitoring on `jellybase`.
- `scripts/status` provides a CLI operator snapshot.
- `scripts/drift-check` compares expected vs running containers.
- `scripts/borg-check` and `scripts/backup-policy-check` provide backup-policy verification.

Target capabilities still to mature:

- scheduled status/backup/drift operations;
- alerting for drift, failed backups, and host/service outages;
- Netdata streaming parent/child design;
- reverse proxy and TLS;
- full rebuild drills;
- Hermes operational integration.

## 9. Security and trust boundary

This is a private infrastructure repo. It can contain LAN IPs, hostnames, Tailnet names, internal URLs, open-port inventory, service names, and topology data.

Current boundary:

- Trusted LAN and Tailnet only.
- No public exposure by default.
- Internal dashboards may be unauthenticated only inside that boundary.

Before any Internet-facing exposure:

- add authentication or a protected reverse proxy;
- define allowed hosts and TLS termination;
- verify secret handling;
- document rollback;
- review generated dashboard data for sensitive inventory leakage.

## 10. Acceptance criteria for platform maturity

The platform is considered mature enough for regular structured operation when:

- every managed host has accurate inventory and bootstrap notes;
- every managed service has placement, URL, backup class, restore priority, and runbook link;
- backup classes referenced by services all exist in `inventory/backups.yml`;
- `just status`, `just drift-check-strict`, `just backup-policy-check`, and `just borg-check` run cleanly from the operator host;
- Homepage and Network Map are generated from inventory without manual-only edits;
- every stateful service has a restore runbook or a completed service-restore template;
- scheduled drift/backup checks exist and alert somewhere useful;
- at least one full rebuild drill has been performed and documented.

## 11. Non-goals for the next phase

- Kubernetes migration.
- Full active-active replication for stateful services.
- Public exposure of internal dashboards without auth/TLS.
- GUI-only service management.
- Automatic destructive repair actions.
