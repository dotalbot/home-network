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
- [ ] Harden node_exporter TCP `9100` access to approved scraper hosts; staged generator exists, live host application/negative verification remains.
- [x] Source-manage Prometheus alert rules for stale backups, failed backups, disk pressure, disk-health failures, and stale probes.
- [x] Source-manage Grafana dashboards and provisioning for backup, disk-health, host performance, and host sensor signals.

## V4.5 — Network Map Live Dashboard

- [x] Refactor Network Map monolithic app.js into ES modules (topology, node-health, backup-status, alerts, service-matrix, drilldown, filters, api).
- [x] Move Network Map deployment from jellyberry to jellybase alongside Prometheus/Grafana.
- [x] Add nginx reverse proxy config for /api/prometheus/query, /api/prometheus/query_range, and /api/alerts routes (using Docker DNS names).
- [x] Phase 1: Live node health on topology (CPU, memory, disk, temperature, online status from Prometheus). Deployed and verified — 3 nodes reporting health data.
- [ ] Phase 2: Backup status per host (borgmatic_* metrics: timestamp, success, size).
- [ ] Phase 3: Alert feed sidebar from Alertmanager v2 API, grouped by host, with node highlighting.
- [ ] Phase 4: iframe drill-down links (Grafana kiosk, Dozzle, Portainer, Alertmanager).
- [ ] Phase 5: Enhanced service matrix with health indicators, container status, backup class, and direct URLs.

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
  - [x] Route critical alerts immediately: backup failures/staleness, `node_exporter` down, Loki down, Alloy down, critical disk/temperature/voltage/throttling conditions.
  - [x] Group warning alerts with conservative repeat intervals for filesystem/inode pressure, stale probes, and non-critical capacity warnings.
  - [x] Add silence/runbook docs for maintenance windows, fake-alert testing, first-response checks, and rollback.
  - [x] Verified on `jellybase`: Prometheus has active Alertmanager target, bridge health is OK, synthetic alert delivery returned HTTP 200, and synthetic groups cleared after expiry.
  - [x] Track operational caveats: host-local Discord webhook secret must be recreated during rebuilds; `/opt/docker/appdata/alloy/data` ownership drift may produce warning-only sync output; `jellybase` still needs a planned OS reboot after package updates.
- [x] Document how to pause, resume, troubleshoot, and verify scheduled checks.

## V7 — Network Access, TLS, and Hardening

- [x] Deploy and verify the loopback-only reverse SSH tunnel fallback from `jellyberry` to seedit4.me for cases where Tailscale is blocked; service is active/enabled, remote loopback `127.0.0.1:22022` returned `tunnel-open`, and Prometheus alerts cover tunnel-down/stale-healthcheck states.
- [ ] Pick a reverse proxy approach.
- [ ] Define internal DNS and TLS source.
- [ ] Add auth requirements for sensitive dashboards.
- [ ] Keep direct LAN/Tailnet rollback paths documented.
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
| Service restore coverage | Stateful services have exact restore steps and three completed non-destructive drills: Mosquitto, monitoring stack, and Home Assistant config | `docs/runbooks/<service>-restore.md`, `docs/plans/011-restore-drills-and-runtime-caveats.md` |
| Scheduled operations | Drift/backup/status checks are scheduled via systemd timer and exported to Prometheus textfile metrics | `scripts/scheduled-ops-check`, `docs/operations/scheduled-ops-checks.md`, Prometheus rules |
| Alerting | Alertmanager/Discord path is source-managed and live on `jellybase`; runtime still requires the host-local Discord webhook secret plus caveat tracking for Alloy data ownership warnings and planned `jellybase` reboot | `/opt/docker/.secrets/alertmanager/discord_webhook_url`, `docs/operations/prometheus-alerting.md`, `docs/plans/011-restore-drills-and-runtime-caveats.md` |
| Node exporter hardening | TCP `9100` is live and staged hardening exists; stage 07 was run on `jellybase`, `jellyhome`, and `jellyberry` but UFW was inactive on all three, so no rules were applied and negative verification still fails open | defer direct `9100` firewall mutation into a broader UFW makeover with Tailscale SSH as the emergency access path, host firewall baseline, rollback notes, then generated `stage-07-configure-access-control.sh` plus positive/negative verification |
| Host firewall/UFW makeover | UFW is intentionally inactive today; enabling it safely needs a designed sequence with Tailscale SSH/back-door access, SSH allow rules, Docker/LAN service allowances, rollback commands, and verification before node_exporter can be locked down | new firewall hardening spec/runbook covering Tailscale SSH access, UFW defaults, host/service allowlists, staged rollout, and recovery checks |
| Grafana/Loki observability | Loki, datasource provisioning, Borgmatic log hooks, Alloy host/container log shipping, Grafana dashboards, Alertmanager/Discord routing, and host log/metric/sensor correlation exist | keep Grafana dashboards source-managed and verify provisioning after changes |
| Reverse proxy + TLS | Needed before safe broader access | proxy/TLS spec, Compose changes, rollback notes |
| Metadata maturity | Inventory needs richer fields for automation | inventory schema notes and validation checks |
| Database-aware backups | Databases need dump/restore discipline, not only volume backup | central Postgres runbook, logical dump automation, and service restore runbooks |
| Hermes operational integration | Hermes should assist with checks/runbooks without becoming hidden state | Hermes operations doc and explicit scheduled jobs |
| Full rebuild drills | Recovery is only real when tested | drill plan, drill report, fixes merged into docs |

## Immediate next actions

1. Delete retired root-owned Netdata appdata from `jellyhome` and `jellybase` after sudo is available; containers are already retired from the managed path.
2. Plan the unrelated `jellybase` OS reboot required after package updates.
3. Add a host firewall/UFW makeover spec before enabling UFW anywhere: Tailscale SSH must be verified as the emergency access path, SSH/service allowlists must be explicit, rollback must be documented, and node_exporter TCP `9100` hardening should be folded into that staged rollout.
4. Plan the next recovery-confidence step: database-aware restore validation for a central PostgreSQL-backed service, or a low-risk full rebuild drill on disposable hardware/VM.
