# Home Network Documentation Index

Start here when planning or operating the `home-network` platform.

Unless stated otherwise, paths in this index are relative to the repository root.

## Strategy and roadmap

- `docs/specs/001-home-network-platform.md` — current platform specification.
- `docs/specs/002-node-exporter-disk-health.md` — implemented first-pass design for generic node_exporter, backup telemetry, and disk health rollout.
- `docs/specs/003-loki-grafana-observability.md` — first-pass Loki + Grafana log observability design.
- `docs/roadmap/product-roadmap.md` — completed stages, gap register, and next phases.

## Operator docs

- `../README.md` — repo overview, trust boundary, common commands, and development workflow.
- `docs/home-network-setup-steps.md` — historical setup steps and early design decisions.
- `docs/step-9-considerations.md` — bootstrap strategy and future direction.

## Operations docs

- `docs/operations/borgmatic-host-rollout.md` — Borg/Borgmatic host rollout checklist and LAN backup target notes.
- `docs/operations/docker-host-bootstrap.md` — bootstrap a Docker host into the `/opt/docker` model.
- `docs/operations/jellyberry-docker-host-bootstrap.md` — jellyberry-specific bootstrap/deploy notes.
- `docs/operations/network-map-dashboard.md` — Network Map operations.
- `docs/operations/safe-network-discovery.md` — safe LAN/Tailnet discovery process.
- `docs/operations/portfolio-mission-control.md` — Portfolio Mission Control runtime notes.
- `docs/operations/sc401-study-hub.md` — SC-401 Study Hub runtime notes.
- `docs/operations/image-pastebin.md` — Image Pastebin runtime notes.
- `docs/operations/node-exporter-disk-health.md` — current node_exporter, Prometheus scrape, Borgmatic telemetry, and disk-health operations.
- `docs/operations/loki-grafana-observability.md` — Loki/Grafana operations, verification, and rollback.
- `docs/operations/cross-repo-app-deployment.md` — deployment method for apps developed in one repo/host and run through `home-network` on another Docker host.
- `docs/operations/3dprint-loader.md` — runtime operations, code refresh deploy, verification, and rollback for the 3D Print Loader service on jellyhome.
- `docs/operations/jellybot-operator-bootstrap.md` — prepare future hosts with the `jellybot` operator account, Docker groups, `/opt/docker` permissions, GitHub SSH keys, and inter-host deploy SSH access.

## Runbooks

- `docs/runbooks/rebuild-ubuntu-host.md` — rebuild an Ubuntu host.
- `docs/runbooks/service-restore-template.md` — template for service-specific restore docs.
- `docs/runbooks/homeassistant-restore.md` — restore/drill Home Assistant on jellybase.
- `docs/runbooks/mosquitto-restore.md` — restore/drill Mosquitto MQTT on jellyhome.
- `docs/runbooks/monitoring-stack-restore.md` — restore/drill Prometheus, Alertmanager, Grafana, Loki, and Alloy config on jellybase.
- `docs/runbooks/portfolio-mission-control-restore.md` — restore/drill Portfolio Mission Control V2 on jellyberry.
- `docs/runbooks/adopt-project-service-template.md` — checklist for adopting a cross-repo app into the `/opt/docker` deployment model.

## Plans

- `docs/plans/` — numbered implementation plans and design options.

## Source of truth files

- `inventory/hosts.yml` — host inventory.
- `inventory/services.yml` — service placement, URLs, containers, status, and backup class.
- `inventory/devices.yml` — device/network inventory.
- `inventory/backups.yml` — backup classes, host backup policy, and restore rules.
- `docker/docker-compose.yml` — shared base Compose file.
- `docker/hosts/*.yaml` — host-specific Compose overlays.
- `docker/appdata/` — repo-managed config/static dashboard data.
- `scripts/` — render, deploy, status, drift, and backup checks.
- `justfile` — operator command entrypoint.

## Current documentation gaps

Use `docs/roadmap/product-roadmap.md` as the active gap register. Current high-value gaps:

1. Harden node_exporter TCP `9100` access.
2. Document scheduled operations and check pause/resume handling.
3. Finish Grafana correlation across host logs, performance stats, and sensor telemetry.
4. Run the next safe non-destructive restore drill, preferably Home Assistant config extraction on `jellybase`.
5. Plan the unrelated jellybase OS reboot.
6. Clean up retired Netdata appdata and stale preserved generated-file scratch directories when explicitly approved.
7. Draft reverse proxy/TLS design before exposing services beyond direct LAN/Tailnet URLs.
8. Add inventory validation for required service metadata.
