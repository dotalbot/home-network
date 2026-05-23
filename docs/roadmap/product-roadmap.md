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
- [ ] Decide whether Netdata is removed from Compose/status checks or kept only as optional ad-hoc diagnostics.
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

## V4 — Metrics and Health Observability

- [x] Roll out node_exporter to `jellyhome`, `jellybase`, and `jellyberry`.
- [x] Scrape node_exporter targets from Prometheus on `jellybase`.
- [x] Expose disk-health, backup age, backup duration, and backup success metrics.
- [x] Treat Pi/microSD/USB SMART gaps as explicit `unknown` status instead of false failure.
- [ ] Harden node_exporter TCP `9100` access to approved scraper hosts.
- [ ] Source-manage Prometheus alert rules for stale backups, failed backups, disk pressure, disk-health failures, and stale probes.
- [ ] Source-manage Grafana dashboards and provisioning for the same signals.

## V5 — Logs and Grafana Observability

- [ ] Deploy self-hosted Loki beside Prometheus/Grafana on `jellybase`.
- [ ] Add Loki datasource provisioning to Grafana.
- [ ] Send Borgmatic run logs to Loki using the Borgmatic Loki hook.
- [ ] Add Grafana log panels/search for backup runs.
- [ ] Extend log shipping beyond Borgmatic only after the first pass is stable.
- [ ] Keep Grafana as the primary observability UI and Loki as the log-history layer.

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
| Grafana/Loki observability | Metrics exist, but dashboards/log history/provisioning need source-managed definitions | Grafana provisioning, Loki config, dashboards, and operations docs |
| Netdata retirement path | Netdata is too heavy for the target operating model | inventory/status/Compose/docs decision: remove or optional diagnostics only |
| Reverse proxy + TLS | Needed before safe broader access | proxy/TLS spec, Compose changes, rollback notes |
| Metadata maturity | Inventory needs richer fields for automation | inventory schema notes and validation checks |
| Database-aware backups | Databases need dump/restore discipline, not only volume backup | backup spec and service runbooks |
| Hermes operational integration | Hermes should assist with checks/runbooks without becoming hidden state | Hermes operations doc and explicit scheduled jobs |
| Full rebuild drills | Recovery is only real when tested | drill plan, drill report, fixes merged into docs |

## Immediate next actions

1. Decide the Netdata retirement path: remove from Compose/status checks, or retain as optional ad-hoc diagnostics only.
2. Source-manage Prometheus alert rules and Grafana dashboard/provisioning for backup freshness, backup failures, disk pressure, disk-health failures, and stale probes.
3. Deploy Loki on `jellybase` and provision it as a Grafana datasource.
4. Add Borgmatic Loki hook support to the rollout generator and test it on one host first.
5. Add staged access-control hardening for node_exporter TCP `9100` so only the Prometheus scraper path can reach it.
6. Complete Borg/Borgmatic setup and verification for any remaining in-scope hosts, especially `jellybackup` if it joins monitored/backup-client scope.
7. Add service restore runbooks for Home Assistant and Mosquitto.
8. Add scheduled drift/backup/status checks and route failures to an alert channel.
