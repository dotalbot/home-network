# Spec 003 — Loki + Grafana Observability

Status: first-pass implemented; first-wave Borgmatic Loki verified; source-managed dashboard deployed; alerting follow-up
Roadmap area: V5 — Logs and Grafana Observability
Plan: `docs/plans/009-loki-grafana-observability.md`

## Goal

Add lightweight, source-managed log visibility to the home-network platform while keeping Grafana as the main observability UI, and correlate those logs with host performance and available sensor telemetry from each monitored host.

## Progress checklist

- [x] Deploy Loki on `jellybase` as the trusted LAN/Tailnet log-history layer.
- [x] Provision Loki as a Grafana datasource through repo-managed config.
- [x] Document Loki/Grafana verification and rollback in operations docs.
- [x] Add inventory-driven Borgmatic Loki hook support to the Borgmatic rollout generator.
- [x] Roll out Borgmatic Loki log shipping to `jellyberry` first and verify queryable entries with `job="borgmatic"` and `host="jellyberry"`.
- [x] Roll out Borgmatic Loki log shipping to `jellybase` and `jellyhome` after `jellyberry` is verified.
- [x] Add/source-manage Grafana Borgmatic logs dashboard or panels.
- [x] Verify Borgmatic log labels stay low-cardinality and secret-free for first-wave hosts.
- [x] Decide MQTT/Hermes/Discord backup event notifications belong to the next event-notification phase, not the Loki log-history phase.
- [x] Implement MQTT/Hermes/Discord backup event notifications with compact, secret-free backup lifecycle events.
- [ ] Extend host observability beyond backup logs to selected system/container logs, host performance stats, and available sensor information from each monitored host.
- [ ] Add Grafana views that correlate logs with CPU, memory, load, disk I/O, filesystem use, network throughput, uptime, temperature, throttling/undervoltage state, and available thermal/fan/disk sensor data.
- [ ] Add alerting policy for backup failures/staleness, Loki availability, and log-investigation handoff.

## Strategic direction

- Prometheus and node_exporter remain the metrics and alert-state layer.
- Loki is the log-history layer on `jellybase`.
- Grafana is the shared UI for metrics and logs.
- Host performance and sensor telemetry belong in Prometheus/Grafana alongside logs so operators can correlate incidents with host load, temperatures, throttling, disk pressure, and network activity.
- MQTT/Hermes/Discord may carry notifications, but they are not the long-term log store.
- Netdata has been retired from the managed Compose/inventory/dashboard/status path; existing containers/appdata are cleanup-only.

## Initial scope

1. Deploy self-hosted Loki on `jellybase` beside Prometheus and Grafana. [implemented]
2. Provision Loki as a Grafana datasource through repo-managed config. [implemented]
3. Send Borgmatic run logs to Loki using Borgmatic's Loki monitoring hook. [first-wave hosts verified]
4. Keep labels low-cardinality: host, job, instance, backup_profile, and environment are acceptable; archive names, file paths, repo URLs, and error strings belong in log content.
5. Add a source-managed Grafana dashboard or panels for Borgmatic log search and backup-run context. [implemented]

## Host performance and sensor telemetry scope

The next observability phase should make each monitored host visible in Grafana, not just its backup logs.

Collect where available:

- Performance: CPU utilization, load average, memory/swap, filesystem usage, disk I/O, network throughput/errors, uptime, process/service availability.
- Sensors: CPU/GPU temperature, disk temperature where supported, Raspberry Pi throttling/undervoltage flags, fan/thermal-zone readings, and other safe hardware-health gauges.
- Health state: explicit `unknown` or `not available` for unsupported sensors, rather than false healthy/failing values.

Prometheus/node_exporter and textfile collectors are the preferred path for these metrics. Loki remains for logs. Grafana should present both together so a host incident can be investigated by time, host, service, log stream, and metric state.

## Non-goals

- Public exposure of Grafana or Loki.
- Replacing Prometheus metrics with logs.
- Building a Netdata parent/child streaming topology.
- Shipping every system/container log before Borgmatic logs are working and verified.

## MQTT event notification boundary

MQTT/Hermes/Discord are the instant event-notification path, not the log-history path.

Use MQTT for:

- Backup started/succeeded/failed events.
- Retained latest backup state per host.
- Hermes/Discord notification fan-out.
- Grafana/Loki hints in failure notifications.

Do not use MQTT for:

- Full Borgmatic logs.
- High-cardinality log lines.
- Long-term search/history.
- Primary Prometheus scraping.

Topic shape:

```text
home-network/backups/<host>/borgmatic/event       non-retained start/success/failure event
home-network/backups/<host>/borgmatic/state       retained latest summarized state
home-network/systems/<host>/<component>/event     future generic system event
home-network/systems/<host>/<component>/state     future retained component state
```

Payload rules:

- Compact JSON only.
- Secret-free.
- No repository URLs with credentials.
- No passphrases, key material, raw file lists, or verbose logs.
- If broker auth is required, read the MQTT password from a local root-readable secret file such as `/opt/docker/.secrets/mqtt_borgmatic_password`; never print it.
- Current deployment uses the dedicated `borgmatic` MQTT user for backup event/state topics. The password must exist in the local root-readable secret file on each backup host; the Hermes bridge uses a service-readable root-owned copy at `/etc/home-network/mqtt_borgmatic_password`, owned `root:jellybot` with mode `0640`.
- Include host, component, status, timestamp, duration, exit code, severity, and a Grafana/Loki hint when useful.

Discord routing requirement:

- Backup MQTT event notifications must post to the new `#jellymax` Discord thread.
- Parent channel ID is `1505100652659867678`; thread ID is `1507781022249648159`; final target is `discord:1505100652659867678:1507781022249648159`.

## Acceptance criteria

- [x] Loki is reachable from the trusted monitoring path on `jellybase`.
- [x] Grafana lists a provisioned Loki datasource.
- [x] Borgmatic runs on `jellyberry`, `jellybase`, and `jellyhome` produce queryable Loki entries with expected host/job labels.
- [x] Documentation explains rollback and how to verify Loki from CLI and Grafana; Borgmatic log verification and dashboard verification completed for first-wave hosts.
- [x] No secrets, repository URLs with credentials, or raw passphrases appear in labels or committed config.

## Dashboard verification

- [x] Grafana provisioned dashboard `Borgmatic Backups` with UID `borgmatic-backups` in folder `Home Network`.
- [x] Dashboard API verification returned `provisioned: true` and 9 panels.
- [x] Supporting Prometheus and Loki dashboard queries returned Borgmatic success metrics/log entries for first-wave hosts.
