# Borgmatic Rollout Automation and Telemetry Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Borg/Borgmatic host rollout repeatable for rebuilds and expose non-secret backup results to Hermes, Prometheus, and optional MQTT.

**Architecture:** Root continues to own backup execution because it must read protected source paths and the local passphrase file. Root-owned rollout scripts configure Borgmatic and write sanitized status artifacts under `/var/lib/home-network/backup-status/`. Prometheus should initially consume node_exporter textfile metrics; MQTT can be added as an optional event bus via a publisher/exporter once the local JSON/Prometheus shape is stable.

**Tech Stack:** Bash, Python standard library, Borg, Borgmatic, systemd timers, node_exporter textfile collector, optional `mosquitto_pub`.

---

## Progress checklist

- [x] Generate Borgmatic rollout stages for `jellyhome`, `jellybase`, and `jellyberry`.
- [x] Keep generated stages operator-controlled and wrong-host guarded.
- [x] Write sanitized JSON backup status under `/var/lib/home-network/backup-status/`.
- [x] Write sanitized Prometheus textfile metrics for node_exporter.
- [x] Expose backup status metrics including timestamp, success, exit code, duration, latest archive, and repository reachability.
- [x] Add optional inventory-gated Borgmatic Loki hook generation, enabled for `jellyberry` first.
- [ ] Verify Borgmatic package/config/timer/repository setup is complete on every in-scope host.
- [x] Roll out and verify Borgmatic Loki log shipping on `jellyberry`.
- [x] Roll out and verify Borgmatic Loki log shipping on `jellyhome` and `jellybase`.
- [x] Add optional MQTT retained state/event publishing.
- [x] Add source-managed Grafana panels/dashboards for Borgmatic backup telemetry and logs.
- [ ] Add alerting for backup failure and stale backup status.

## Design decision: Prometheus, MQTT, and Hermes

Prometheus does not natively use MQTT as a scrape target. It can consume MQTT data only through an exporter such as `mqtt_exporter`, custom bridge, or Telegraf. MQTT is a message/state bus; Prometheus is a metrics time-series scraper. They overlap, but they are not the same layer.

Recommended first implementation:

1. Root backup wrapper writes sanitized JSON:
   - `/var/lib/home-network/backup-status/<host>.json`
   - Fields: host, repository, updated_at, status/success, exit code, duration, latest archive name, message, and repository reachability.
2. Root backup wrapper writes Prometheus textfile metrics when a textfile collector directory exists:
   - `/var/lib/node_exporter/textfile_collector/borgmatic_<host>.prom`
   - Metrics include last-run timestamp, success, exit code, duration, repository reachability, and an info metric carrying the latest archive name.
3. Hermes reads JSON for Discord summaries.
4. Prometheus scrapes node_exporter textfile metrics.
5. Optional later: publish the same JSON to MQTT retained topics and/or deploy an MQTT exporter.

Why this is preferred:

- JSON is simple for Hermes and local scripts.
- Textfile collector is the standard way to expose batch job metrics to Prometheus.
- MQTT can be added without making Prometheus depend on the broker path.
- Secrets never need to be readable by Hermes, Prometheus, or MQTT.

If we want “one place” later, use MQTT as a retained state bus plus an MQTT exporter for Prometheus and Hermes subscriber support. That is a valid phase 2, not the simplest phase 1.

## Generated scripts

The rollout generator creates host-specific `/tmp` scripts for `jellyhome`, `jellybase`, and `jellyberry`:

- `stage-01-preflight.sh`
- `stage-02-secrets.sh`
- `stage-03-init-repo.sh`
- `stage-04-export-key.sh`
- `stage-05-configure-borgmatic.sh`
- `stage-06-manual-backup.sh`
- `stage-07-check-and-restore-test.sh`
- `stage-08-enable-timer.sh`
- `stage-09-status-summary.sh`

Each script refuses to run on the wrong host. Every script is intended to be run with `sudo` by the user.

## Acceptance criteria

- Scripts are generated for `jellyhome`, `jellybase`, and `jellyberry`.
- Scripts never print passphrases, private keys, or exported Borg keys.
- Scripts use `192.168.1.75`, not FQDN.
- Scripts use host-specific repo paths:
  - `jellyhome`: `/home/jellybackup/externaldisk/borg_jellyhome`
  - `jellybase`: `/home/jellybackup/externaldisk/borg_jellybase`
- Borgmatic config excludes `/opt/docker/.secrets`.
- Manual backup and scheduled timer wrapper write sanitized JSON status and Prometheus textfile metrics.
- Status includes success, timestamp, duration, latest archive name, and repository reachability without printing secrets.
- Status summary script writes/prints non-secret summary and refreshes Prometheus textfile metrics.
- Scripts pass `bash -n`/Python compile validation.
