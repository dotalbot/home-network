# Home Network Documentation Index

Start here when planning or operating the `home-network` platform.

Unless stated otherwise, paths in this index are relative to the repository root.

## Strategy and roadmap

- `docs/specs/home-network-platform-spec.md` — current platform specification.
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

## Runbooks

- `docs/runbooks/rebuild-ubuntu-host.md` — rebuild an Ubuntu host.
- `docs/runbooks/service-restore-template.md` — template for service-specific restore docs.

## Plans

- `docs/plans/` — dated implementation plans and design options.

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

1. Complete Borg/Borgmatic setup and verification on every in-scope host.
2. Add service-specific restore runbooks for active stateful services.
3. Document scheduled operations and alerting once implemented.
4. Draft reverse proxy/TLS design before exposing services beyond direct LAN/Tailnet URLs.
5. Add inventory validation for required service metadata.
