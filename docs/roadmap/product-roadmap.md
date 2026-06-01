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
- [x] Complete Borg/Borgmatic setup and verification for `jellyhome`, `jellybase`, and `jellyberry`; remaining scope is future hosts such as `jellybackup` if they become backup clients.
- [x] Add restore runbooks for Home Assistant, Mosquitto, Prometheus, Grafana, Portfolio Mission Control, and key stateful services.
- [x] Run and document safe restore drills for Mosquitto on `jellyhome` and monitoring-stack config on `jellybase`.
- [x] Complete phase 5 consolidated backup-management integration review: architecture, read-only UI/API design, restore-drill safety, database-hook design, and rollout gates are aligned in `docs/plans/012-consolidated-borg-management.md`.
- [ ] Implement the approved first read-only Backup Management surface: generated `backup-management.json` plus a Network Map Backups view on `jellybase`, with no write routes and no shell execution.
- [x] Document scratch-only restore-drill automation safety, operator approval gates, SQLite/PostgreSQL validators, and tmux/sudo handoff points in `docs/operations/backup-restore-drill-safety.md`.
- [x] Document first-class database pre-backup hook design for PostgreSQL logical dumps and SQLite WAL/SHM constraints in `docs/plans/014-database-pre-backup-hooks.md`.
- [ ] Implement restore-drill automation and database pre-backup hooks only after separate approval, keeping scratch-only defaults and production restore gates.


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
- [x] Mount verified 3D library from `/home/jellyfish/media/Primary_5TB/3D_models` read-write as required by Manyfold local library validation.
- [x] Verify Manyfold starts, reaches central Postgres, and can validate the 3D model library path.
- [x] Verify Manyfold indexes the library against central PostgreSQL.
- [x] Complete a safe restore check for central Postgres using a post-index logical dump.
- [x] Document host rebuild order for `/opt/docker/bin` helpers, secrets, timers, firewall rules, and restored database/app state.

## V4 — Metrics and Health Observability

- [x] Roll out node_exporter to `jellyhome`, `jellybase`, and `jellyberry`.
- [x] Scrape node_exporter targets from Prometheus on `jellybase`.
- [x] Expose disk-health, backup age, backup duration, and backup success metrics.
- [x] Treat Pi/microSD/USB SMART gaps as explicit `unknown` status instead of false failure.
- [ ] Add per-host performance dashboards for CPU, memory, load, disk I/O, filesystem use, network throughput, and uptime.
- [ ] Add per-host sensor telemetry where available, including CPU/GPU temperature, disk temperature, throttling/undervoltage state, fan/thermal-zone readings, and other safe hardware-health signals.
- [ ] Keep sensor gaps explicit as `unknown`/`not available` rather than false healthy or false failure.
- [x] Harden node_exporter TCP `9100` access to approved scraper hosts; UFW baselines now allow Prometheus/jellybase scrape paths, Prometheus reports all targets up, and negative checks from non-approved `jellyberry` to `jellyhome`/`jellybase` TCP `9100` time out.
- [x] Source-manage Prometheus alert rules for stale backups, failed backups, disk pressure, disk-health failures, and stale probes.
- [x] Source-manage Grafana dashboards and provisioning for backup, disk-health, host performance, and host sensor signals.

## V4.5 — Network Map Live Dashboard

- [x] Refactor Network Map monolithic app.js into ES modules (topology, node-health, backup-status, alerts, service-matrix, drilldown, filters, api).
- [x] Move Network Map deployment from jellyberry to jellybase alongside Prometheus/Grafana.
- [x] Add nginx reverse proxy config for /api/prometheus/query, /api/prometheus/query_range, and /api/alerts routes (using Docker DNS names).
- [x] Phase 1: Live node health on topology (CPU, memory, disk, temperature, online status from Prometheus). Deployed and verified — 3 nodes reporting health data.
- [x] Phase 2: Backup status per host from deployed `borgmatic_last_run_*`, `borgmatic_repository_reachable`, and `borgmatic_last_archive_info` Prometheus metrics.
- [x] Phase 3: Alert feed sidebar from Alertmanager v2 API, grouped by host, with click-to-select affected host in the detail panel.
- [x] Phase 4: iframe drill-down links (Grafana host/backups, Prometheus, Dozzle, Portainer, Alertmanager).
- [x] Phase 5: Enhanced service matrix with health indicators, backup status, active-alert counts, service count, and direct URLs.

## V4.6 — Jellyoffice Environmental Sensor Node

- [x] Bootstrap Pi Zero 2 W (jellyoffice) with Pimoroni Enviro (not Enviro+): OS packages, Tailscale SSH, I2C/SPI verified.
- [x] Deploy Python enviro-publisher service: BME280/LTR-559/proximity + host health → MQTT to Mosquitto on jellyhome. Noise deferred: ADS1015 detected but channel reads return I/O errors.
- [x] Home Assistant MQTT auto-discovery: retained discovery topics under `homeassistant/sensor/jellyoffice/#` verified.
- [x] MQTT→Prometheus bridge: mqtt-exporter on jellybase, scraped by Prometheus with `mqtt_temperature`, `mqtt_humidity`, `mqtt_pressure`, `mqtt_lux`, `mqtt_proximity`, and host-health metrics verified.
- [x] Temperature compensation for BME280 (software offset + GPIO extender cable recommendation).
- [x] Health metrics via MQTT (uptime, CPU temp, disk, memory, Wi-Fi RSSI) — no node_exporter on 512MB device.
- [x] Homepage and Network Map integration: `Jellyoffice Enviro` appears in Homepage IoT and Network Map as LAN `192.168.1.71` / Tailnet `100.120.3.77`, with MQTT/Prometheus health enrichment.
- [x] Headless two-SSID Wi-Fi failover: NetworkManager profiles configured on jellyoffice for `EE-Hub-QPq9` and `TP-Link_B65B`; source-managed helper/runbook exist and Wi-Fi secrets stay on-device.

## V5 — Logs and Grafana Observability

- [x] Deploy self-hosted Loki beside Prometheus/Grafana on `jellybase`.
- [x] Add Loki datasource provisioning to Grafana.
- [x] Send Borgmatic run logs to Loki using the Borgmatic Loki hook.
- [x] Add Grafana log panels/search for backup runs.
- [x] Extend log shipping beyond Borgmatic using Grafana Alloy on `jellyhome`, `jellybase`, and `jellyberry` for host systemd journal logs and selected Docker container logs.
- [x] Fix `jellybase` self-log shipping to use the local Loki service endpoint instead of the host LAN endpoint from inside the Alloy container.
- [x] Correlate host logs with Prometheus host performance and sensor telemetry in Grafana so operators can move from “what happened?” to “what was the host doing?”.
  - [x] Add host/time-range aligned correlation panels for Loki log volume, warning/error-like log volume, service scrape availability, recent warning/error logs, and raw selected host logs.
- [x] Add low-noise host log-signal metrics and alerts for failed units, kernel/storage errors, OOM events, and stale probes.
- [x] Keep Grafana as the primary observability UI and Loki as the log-history layer.

## V6 — Scheduled Operations and Alerting

- [x] Add scheduled drift/backup/status checks and route failures to the same alert channel or a clearly documented Hermes-only path.
  - [x] Use Prometheus textfile metrics plus Alertmanager/Discord as the default wake-up path.
  - [x] Keep Hermes cron for human summaries/reminders, not as the only critical alert path.
- [x] Add lock handling so recurring checks cannot overlap.
- [x] Write check results atomically to a known state directory.
- [x] Route Prometheus alerts through Alertmanager and a Discord delivery bridge.
  - [x] Add source-managed Alertmanager service on `jellybase`.
  - [x] Add `alerting.alertmanagers` wiring to Prometheus.
  - [x] Store Discord webhook URL outside Git under `/opt/docker/.secrets/alertmanager/discord_webhook_url` or an equivalent host-local secret.
  - [x] Route red-flag alerts through monitoring-native delivery for backup failures/staleness/missing metrics, scheduled Borg check failures, likely host unreachable, `node_exporter` down, `node_textfile_scrape_error`, disk-health failure/probe failure/staleness, unexpected unknown disk-device count changes, container drift, optional dashboard render validation, Loki/Alloy down, critical disk/voltage conditions, and warning-level temperature/throttling conditions.
  - [x] Group warning alerts with conservative repeat intervals for filesystem/inode pressure, stale probes, container drift, and non-critical capacity warnings.
  - [x] Add silence/runbook docs for maintenance windows, fake-alert testing, first-response checks, and rollback.
  - [x] Verified on `jellybase`: Prometheus has active Alertmanager target, bridge health is OK, synthetic alert delivery returned HTTP 200, and synthetic groups cleared after expiry.
  - [x] Track operational caveats: host-local Discord webhook secret must be recreated during rebuilds; `/opt/docker/appdata/alloy/data` ownership drift may produce warning-only sync output; `jellybase` still needs a planned OS reboot after package updates.
- [x] Document how to pause, resume, troubleshoot, and verify scheduled checks.

## V7 — Network Access, TLS, and Hardening

- [x] Deploy and verify the loopback-only reverse SSH tunnel fallback from `jellyberry` to seedit4.me for cases where Tailscale is blocked; service is active/enabled, remote loopback `127.0.0.1:22022` returned `tunnel-open`, and Prometheus alerts cover tunnel-down/stale-healthcheck states.
- [ ] Pick a reverse proxy approach.
- [ ] Define internal DNS and TLS source.
- [ ] Add auth requirements for sensitive dashboards.
- [x] Add host firewall/UFW makeover spec and rollout runbook before enabling UFW anywhere.
- [x] Apply staged host firewall/UFW rollout after approval: Tailscale SSH fallback, LAN SSH fallback, SSH/service allowlists, rollback, and positive verification completed for `jellyberry`, `jellyhome`, and `jellybase`.
- [x] Add Docker-layer hardening follow-up for Docker-published ports where UFW cannot enforce restrictions alone (`DOCKER-USER` rules or bind-address changes), then run positive and negative verification for `12345`, `7007`, `9001`, `5432`, `9000`, and similar restricted ports.
- [ ] Add persistence/reapply mechanism for DOCKER-USER hardening after reboot or container recreation.
- [ ] Avoid exposing unauthenticated sensitive services beyond LAN/Tailnet.

## V8 — Automation and Rebuild Confidence

- [ ] Improve `just` targets for routine operations and safe deploys.
- [ ] Keep dangerous actions explicit and non-default.
- [ ] Document Hermes automation boundaries: what may run automatically vs only on request.
- [ ] Trial central Hindsight on `jellyhome` for one Hermes profile or one OpenCode repo before replacing existing memory providers.
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
| Borg/Borgmatic host rollout | Borg/Borgmatic is configured and verified for `jellyhome`, `jellybase`, and `jellyberry`; future hosts such as `jellybackup` need onboarding only if they become monitored backup clients | `docs/operations/borgmatic-host-rollout.md`, managed `home-network-borgmatic-<host>.timer`, node_exporter Borgmatic metrics |
| Service restore coverage | Stateful services have exact restore steps and three completed non-destructive drills: Mosquitto, monitoring stack, and Home Assistant config; Manyfold app/library and planned Calibre media-library coverage are drafted before the libraries become harder to rebuild | `docs/runbooks/<service>-restore.md`, `docs/plans/011-restore-drills-and-runtime-caveats.md` |
| Scheduled operations | Drift/backup/status checks are scheduled via systemd timer and exported to Prometheus textfile metrics | `scripts/scheduled-ops-check`, `docs/operations/scheduled-ops-checks.md`, Prometheus rules |
| Alerting | Alertmanager/Discord path is source-managed and live on `jellybase`; runtime still requires the host-local Discord webhook secret plus caveat tracking for Alloy data ownership warnings and planned `jellybase` reboot | `/opt/docker/.secrets/alertmanager/discord_webhook_url`, `docs/operations/prometheus-alerting.md`, `docs/plans/011-restore-drills-and-runtime-caveats.md` |
| Node exporter hardening | UFW host baseline and DOCKER-USER Docker-layer hardening are now applied and positively verified on `jellyberry`, `jellyhome`, and `jellybase`; Prometheus scrapes remain green, and negative checks from a non-approved host timed out for sensitive Docker-published ports on jellybase | Add persistence/reapply mechanism for DOCKER-USER rules after reboot or container recreation |
| Host firewall/UFW makeover | Staged UFW rollout and Docker-layer follow-up completed for Docker hosts with Tailscale SSH and LAN SSH fallbacks, explicit allowlists, rollback docs, and positive service/Prometheus checks | Maintain runbook evidence in `docs/operations/host-firewall-ufw-rollout.md` and `docs/operations/docker-user-firewall-hardening.md`; add persistence for Docker-layer rules |
| Grafana/Loki observability | Loki, datasource provisioning, Borgmatic log hooks, Alloy host/container log shipping, Grafana dashboards, Alertmanager/Discord routing, and host log/metric/sensor correlation exist | keep Grafana dashboards source-managed and verify provisioning after changes |
| Reverse proxy + TLS | Needed before safe broader access | proxy/TLS spec, Compose changes, rollback notes |
| Metadata maturity | Inventory now has richer backup-management schema and validation; the next gap is using it in a read-only management surface without creating hidden state | `backup-management.json` generator, Network Map Backups view, validation checks |
| Database-aware backups | Database hook and restore constraints are designed, but live Borgmatic pre-backup hook integration is not yet deployed | `docs/plans/014-database-pre-backup-hooks.md`, central Postgres runbook, logical dump automation, and service restore runbooks |
| Hermes operational integration | Hermes should assist with checks/runbooks without becoming hidden state | Hermes operations doc and explicit scheduled jobs |
| Full rebuild drills | Recovery is only real when tested | drill plan, drill report, fixes merged into docs |

## Immediate next actions

1. Decide whether to approve the first backup-management implementation slice: read-only `backup-management.json` generator plus Network Map Backups view on `jellybase`; do not deploy or mutate live hosts before approval.
2. Delete retired root-owned Netdata appdata from `jellyhome` and `jellybase` after sudo is available; containers are already retired from the managed path.
3. Plan the unrelated `jellybase` OS reboot required after package updates.
4. Add persistence/reapply mechanism for DOCKER-USER hardening after reboot or container recreation.
5. Run the next recovery-confidence step: non-destructive logical-dump restore drill for Manyfold into a scratch PostgreSQL container, following `docs/runbooks/central-postgres-manyfold-restore.md`.
