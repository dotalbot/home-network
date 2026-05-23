# Home Network Platform Product Roadmap

Status: active source of truth
Format: numbered, project-style roadmap for Mission Control and human operators.

## North star

A dead machine should be an inconvenience, not a disaster.

The platform should make the home lab understandable, reproducible, observable, and recoverable through Git-backed inventory, Docker Compose source-of-truth files, clear runbooks, scheduled checks, lightweight observability, and verified backups.

## V1 — Platform Source of Truth

- [x] Establish repo layout for inventory, Docker Compose, scripts, docs, bootstrap, and justfile.
- [x] Track hosts in `inventory/hosts.yml`.
- [x] Track services, URLs, containers, status, and backup classes in `inventory/services.yml`.
- [x] Adopt `/opt/docker` as the runtime Docker source-of-truth copy.
- [x] Use shared Compose plus host overlays: `docker/docker-compose.yml` and `docker/hosts/<hostname>.yaml`.
- [x] Add `just` entrypoints for render, deploy, status, drift, backup, Borgmatic, and rollout generation.
- [ ] Add inventory validation for required service metadata, generated-file policy, and automation-safe fields.

## V2 — Dashboard and Service Inventory

- [x] Generate Homepage config from inventory.
- [x] Generate Network Map static dashboard data from inventory.
- [x] Move dashboard links to stable LAN IPs where hostname resolution is inconsistent.
- [x] Add Dozzle central UI on `jellyhome` with agents on `jellybase` and `jellyberry`.
- [x] Keep Network Map and Homepage LAN/Tailnet-only unless auth or a protected reverse proxy is added.
- [x] Retire Netdata from managed Compose, inventory, Homepage, and status checks; leave running-container/appdata cleanup as a separate manual task.
- [ ] Keep core service links and generated dashboards aligned with inventory.

## V3 — Backup and Recovery Foundation

- [x] Define backup classes and host backup policy in `inventory/backups.yml`.
- [x] Add backup policy validation with `scripts/backup-policy-check`.
- [x] Add Borg/Borgmatic discovery and rollout generation.
- [x] Route Borg traffic to `jellybackup@192.168.1.75` using LAN IPs instead of FQDN/Tailscale.
- [x] Expose Borgmatic status as sanitized node_exporter textfile metrics on `jellyhome`, `jellybase`, and `jellyberry`.
- [ ] Complete Borg/Borgmatic setup and verification for every in-scope host.
- [ ] Add restore runbooks for Home Assistant, Mosquitto, Prometheus, Grafana, Portfolio Mission Control, and key stateful services.
- [ ] Run and document at least one safe restore drill.


## V3.5 — Shared Database Platform and Manyfold Adoption

- [x] Decide central PostgreSQL host: `jellybase`.
- [x] Decide PostgreSQL image and initial defaults: `postgres:17-alpine`, `postgres` / `postgres`.
- [x] Decide first LAN policy: bind `192.168.1.2:5432`, restricted to `jellybase` and `jellyhome`.
- [x] Decide first application database/user: database `manyfold`, user `svc_manyfold`.
- [x] Require Borg plus logical dumps from day one.
- [x] Add central Postgres spec, implementation plan, and operations runbook with confirmed decisions.
- [x] Deploy central Postgres on `jellybase` with secrets outside Git.
- [x] Apply and verify PostgreSQL access restrictions for approved hosts only.
- [x] Install logical dump timer and document restore procedure.
- [x] Create Manyfold database `manyfold` and user `svc_manyfold`.
- [x] Add Manyfold to managed Compose on `jellyhome`.
- [x] Mount verified 3D library from `/home/jellyfish/media/Primary_5TB/3D_models` read-only.
- [x] Verify Manyfold starts, reaches central Postgres, and can see the read-only 3D model library.
- [ ] Verify Manyfold indexes the library after first-login library setup.
- [ ] Complete a safe restore check for central Postgres using Borg and/or logical dump.
- [ ] Document host rebuild order for `/opt/docker/bin` helpers, secrets, timers, firewall rules, and restored database/app state.

## V4 — Metrics and Health Observability

- [x] Roll out node_exporter to `jellyhome`, `jellybase`, and `jellyberry`.
- [x] Scrape node_exporter targets from Prometheus on `jellybase`.
- [x] Expose disk-health, backup age, backup duration, and backup success metrics.
- [x] Treat Pi/microSD/USB SMART gaps as explicit `unknown` status instead of false failure.
- [ ] Harden node_exporter TCP `9100` access to approved scraper hosts.
- [ ] Source-manage Prometheus alert rules for stale backups, failed backups, disk pressure, disk-health failures, and stale probes.
- [ ] Source-manage Grafana dashboards and provisioning for the same signals.

## V5 — Logs and Grafana Observability

- [x] Deploy self-hosted Loki beside Prometheus/Grafana on `jellybase`.
- [x] Add Loki datasource provisioning to Grafana.
- [ ] Send Borgmatic run logs to Loki using the Borgmatic Loki hook.
- [ ] Add Grafana log panels/search for backup runs.
- [ ] Extend log shipping beyond Borgmatic only after the first pass is stable.
- [x] Keep Grafana as the primary observability UI and Loki as the log-history layer.

## V6 — Scheduled Operations and Alerting

- [ ] Schedule status, drift, backup policy, Borg/Borgmatic, and dashboard validation checks.
- [ ] Add lock handling so recurring checks cannot overlap.
- [ ] Write check results atomically to a known state directory.
- [ ] Route failures to Discord/Hermes or monitoring-native alerts.
- [ ] Document how to pause, resume, troubleshoot, and verify scheduled checks.

## V7 — Network Access, TLS, and Hardening

- [ ] Pick a reverse proxy approach.
- [ ] Define internal DNS and TLS source.
- [ ] Add auth requirements for sensitive dashboards.
- [ ] Keep direct LAN/Tailnet rollback paths documented.
- [ ] Avoid exposing unauthenticated sensitive services beyond LAN/Tailnet.

## V8 — Automation and Rebuild Confidence

- [ ] Improve `just` targets for routine operations and safe deploys.
- [ ] Keep dangerous actions explicit and non-default.
- [ ] Document Hermes automation boundaries: what may run automatically vs only on request.
- [ ] Ensure generated state is atomic and not accidentally committed.
- [ ] Document that `/opt/docker/bin` helpers are recreated from Git via `scripts/sync-docker-config`, while secrets, timers, firewall rules, and data need restore/reapply steps.
- [ ] Run a full rebuild drill on a low-risk host or disposable VM/Pi.
- [ ] Fix any missing docs discovered during the rebuild drill.

## Strategic observability decision

Netdata is no longer the strategic monitoring path for this project because it is heavier than needed for the home-network operating model. Historical Netdata references may remain while services are still running, but future work should prioritize:

- Prometheus and node_exporter for metrics and alert state.
- Loki for logs.
- Grafana as the shared UI for metrics and logs.
- Hermes/Discord or monitoring-native alerts for actionable notifications.

Do not build a Netdata streaming topology unless this decision is explicitly reversed.

## Gap register

| Gap | Why it matters | Target artifact |
| --- | --- | --- |
| Borg/Borgmatic host rollout | Borg/Borgmatic must be installed, configured, and verified on every in-scope host | `docs/operations/borgmatic-host-rollout.md` plus `borg-check` passing per host |
| Service restore coverage | Stateful services need exact restore steps | `docs/runbooks/<service>-restore.md` or completed service templates |
| Scheduled operations | Drift/backup/status checks are manual unless scheduled elsewhere | cron/systemd timers or Hermes cron jobs plus docs |
| Alerting | Failed checks should notify instead of waiting for manual review | Discord/Hermes alert path or monitoring alerts |
| Node exporter hardening | TCP `9100` is live and should be restricted to approved scrapers | staged hardening generator plus positive/negative verification |
| Grafana/Loki observability | Loki and datasource provisioning exist; Borgmatic log hooks, dashboards, and alerts remain | Borgmatic Loki hook rollout, Grafana log panels, and alerting docs |
| Reverse proxy + TLS | Needed before safe broader access | proxy/TLS spec, Compose changes, rollback notes |
| Metadata maturity | Inventory needs richer fields for automation | inventory schema notes and validation checks |
| Database-aware backups | Databases need dump/restore discipline, not only volume backup | central Postgres runbook, logical dump automation, and service restore runbooks |
| Hermes operational integration | Hermes should assist with checks/runbooks without becoming hidden state | Hermes operations doc and explicit scheduled jobs |
| Full rebuild drills | Recovery is only real when tested | drill plan, drill report, fixes merged into docs |

## Immediate next actions

1. Finalize and deploy central Postgres on `jellybase` with LAN access restricted to `jellybase` and `jellyhome`, plus Borg and logical dumps from day one.
2. Create Manyfold database `manyfold` and user `svc_manyfold`, then add Manyfold on `jellyhome` with the verified 3D library mounts.
3. Source-manage Prometheus alert rules for backup freshness, backup failures, disk pressure, disk-health failures, stale probes, and Loki log search.
4. Add staged access-control hardening for node_exporter TCP `9100` so only the Prometheus scraper path can reach it.
5. Clean up retired Netdata containers/appdata from `jellyhome` and `jellybase` when approved.
6. Complete Borg/Borgmatic setup and verification for any remaining in-scope hosts, especially `jellybackup` if it joins monitored/backup-client scope.
7. Add service restore runbooks for Home Assistant and Mosquitto.
8. Add scheduled drift/backup/status checks and route failures to an alert channel.
