# Loki + Grafana Observability Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add self-hosted Loki + Grafana log visibility, starting with Borgmatic backup logs and then extending the same log pipeline to system and container logs across the homelab.

**Architecture:** Keep Prometheus/node_exporter as the metrics and alert-state layer. Add Loki as the central log history layer, with Borgmatic sending run logs directly to Loki using borgmatic's Loki monitoring hook. Grafana becomes the shared viewing layer for metrics plus logs. MQTT remains the low-latency event bus for instant notifications and state fan-out, not the long-term log store.

**Tech Stack:** Borgmatic Loki hook, self-hosted Grafana Loki, Grafana dashboard provisioning, Prometheus/node_exporter textfile metrics, optional Alertmanager, Mosquitto MQTT, Hermes/Discord notification bridge, Docker Compose under `/opt/docker` managed by this repo.

---

## Progress checklist

- [x] Task 1: Record the Borgmatic + Loki spec.
- [x] Task 2: Add Loki to the monitoring stack on `jellybase`.
- [x] Task 3: Add Grafana Loki datasource provisioning.
- [x] Task 4: Extend Borgmatic rollout generator with optional Loki hook.
- [ ] Task 5: Roll out Borgmatic Loki hook to `jellyberry` first.
- [ ] Task 6: Import/source-manage Borgmatic Grafana logs dashboard.
- [ ] Task 7: Roll out to `jellyhome` and `jellybase`.
- [ ] Task 8: Add MQTT event publishing for instant Discord notifications.
- [ ] Task 9: Generalize Loki beyond Borgmatic.
- [ ] Task 10: Add alerting policy.

## 1. What this adds

Current backup observability is metric/status-first:

- Borgmatic wrapper/status artifacts report success, timestamp, duration, exit code, and latest archive.
- node_exporter textfile metrics expose sanitized backup status to Prometheus.
- Grafana can visualize backup health once dashboards are source-managed.

Loki adds the missing log-history layer:

- Full Borgmatic run output across hosts.
- Searchable failure context, warnings, changed-files messages, and check/prune/compact logs.
- Per-host/per-instance labels so one Grafana dashboard can cover `jellyhome`, `jellybase`, `jellyberry`, and later `jellybackup`/`jellypi`.

This does not replace Prometheus. It complements it:

```text
Borgmatic status metrics -> node_exporter -> Prometheus -> alerts/health panels
Borgmatic run logs       -> borgmatic Loki hook -> Loki -> log panels/search
Instant state events     -> MQTT -> Hermes/Discord/Home Assistant/automation
```

## 2. Design decision: where MQTT fits

MQTT should sit on the event-notification path, not the log-storage path.

Use MQTT for:

- Instant "backup started/succeeded/failed" events.
- Retained latest backup state per host.
- Triggering Hermes to post Discord notifications without polling.
- Home Assistant automations or local dashboard badges.
- Later generic host events like service restart, disk-health risk, UPS event, package-upgrade result, or failed container healthcheck.

Do not use MQTT for:

- Full Borgmatic logs.
- High-cardinality log lines.
- Long-term search/history.
- Primary Prometheus scraping.

Recommended MQTT topic shape:

```text
home-network/backups/<host>/borgmatic/event       non-retained start/success/failure event
home-network/backups/<host>/borgmatic/state       retained latest summarized state
home-network/systems/<host>/<component>/event     future generic system event
home-network/systems/<host>/<component>/state     future retained component state
```

Example retained state payload:

```json
{
  "host": "jellybase",
  "component": "borgmatic",
  "status": "success",
  "started_at": "2026-05-23T03:00:00Z",
  "ended_at": "2026-05-23T03:07:41Z",
  "duration_seconds": 461,
  "exit_code": 0,
  "archive": "jellybase-2026-05-23T03:00:00",
  "loki_url_hint": "grafana explore query labels host=jellybase job=borgmatic",
  "severity": "info"
}
```

Discord path:

```text
Borgmatic wrapper/hook
  -> publish MQTT event
  -> Hermes MQTT subscriber or lightweight bridge
  -> Discord message
  -> link/hint to Grafana Loki logs when relevant
```

That gives near-instant notification while Loki keeps the full receipts. Backup logs: now with actual receipts, not just vibes.

## 3. Initial rollout scope

Phase 1 applies only to Borgmatic logs.

Hosts in scope first:

- `jellyberry` first, because it is lightweight and already has a working manual Borgmatic path.
- `jellybase` after jellyberry verifies cleanly.
- `jellyhome` after jellybase verifies cleanly.

Optional after first pass:

- `jellybackup`, once we decide whether it should run node_exporter/Loki clients and what backup jobs it owns.
- Future hosts from inventory.

Non-goals for phase 1:

- Public exposure of Grafana/Loki.
- Replacing Prometheus backup metrics.
- Shipping secrets, passphrases, Borg keys, raw root-only config, or `/opt/docker/.secrets` contents.
- Generic all-system logging before Borgmatic is stable.

## 4. Target architecture

```text
[host: jellybase/jellyhome/jellyberry]
  borgmatic systemd timer/service
    |
    |-- sanitized status JSON/prom textfile -> node_exporter -> Prometheus
    |
    |-- borgmatic Loki hook -> http://jellybase:<loki-port>/loki/api/v1/push
    |
    `-- optional local wrapper -> mosquitto_pub -> MQTT broker

[jellybase monitoring stack]
  Loki stores logs
  Prometheus stores metrics
  Grafana queries both
  Grafana dashboard 20736-style Borgmatic Logs view is provisioned/source-managed

[notification path]
  MQTT broker -> Hermes/bridge -> Discord concise notification
```

Preferred labels for Borgmatic Loki streams:

```yaml
job: borgmatic
host: __hostname
instance: <host>
repo: borg_<host>
environment: home-network
source: borgmatic
```

Keep labels low-cardinality. Do not label every archive name, path, file, error string, or repository URL as a Loki label. Put those in log content or summarized JSON instead.

## 5. Inventory/source-of-truth additions

Add observability fields to inventory rather than hardcoding hosts.

Candidate file updates:

- Modify: `inventory/hosts.yml`
- Modify: `inventory/backups.yml`
- Create: `inventory/observability.yml` if the shape becomes too large for existing files.
- Create/modify: `docs/operations/loki-grafana-observability.md`
- Create/modify: `docs/specs/003-loki-grafana-observability.md`

Example inventory shape:

```yaml
loki:
  enabled: true
  endpoint: "http://jellybase:3100/loki/api/v1/push"
  retention_days: 30
  labels:
    environment: home-network

mqtt_events:
  enabled: false
  broker: "mqtt://jellybase:1883"
  topic_prefix: "home-network"

borgmatic_log_shipping:
  enabled_hosts:
    - jellybase
    - jellyhome
    - jellyberry
  labels:
    job: borgmatic
    source: borgmatic
```

## 6. Implementation tasks

### Task 1: Record the Borgmatic + Loki spec

**Objective:** Define the exact log, metric, and event boundaries before runtime changes.

**Files:**

- Create: `docs/specs/003-loki-grafana-observability.md`
- Update: `docs/README.md`
- Update: `docs/roadmap/product-roadmap.md`

**Steps:**

1. Document Prometheus as metrics, Loki as logs, MQTT as instant events.
2. Document labels, retention, trust boundary, and secret exclusions.
3. Add acceptance criteria for Borgmatic-first rollout.
4. Add generic-system logging as later scope.
5. Run `git diff --check`.

**Verification:**

```bash
git diff --check
git diff -- docs/specs/003-loki-grafana-observability.md docs/README.md docs/roadmap/product-roadmap.md
```

### Task 2: Add Loki to the monitoring stack on jellybase

**Objective:** Deploy self-hosted Loki beside Grafana/Prometheus as the central log store.

**Files:**

- Modify repo-managed Docker Compose for the monitoring stack under `/opt/docker` source files.
- Create: Loki config file under the repo-managed monitoring config path.
- Update: `.gitignore` only if Loki runtime data paths need ignoring.

**Runtime target:**

- Loki HTTP endpoint available on trusted LAN/internal Docker network only.
- Suggested port: `3100`, unless current stack already reserves it.

**Steps:**

1. Inspect current monitoring Compose files and Grafana provisioning layout.
2. Add a `loki` service with persistent data under `/opt/docker/appdata/loki` or the repo's equivalent managed appdata path.
3. Configure local filesystem storage and a conservative retention period, e.g. 30 days to start.
4. Validate Compose config.
5. Deploy/recreate only the monitoring services needed.
6. Verify Loki readiness.

**Verification:**

```bash
docker compose config
curl -fsS http://127.0.0.1:3100/ready
curl -fsS http://jellybase:3100/ready
```

### Task 3: Add Grafana Loki datasource provisioning

**Objective:** Make Grafana able to query Loki without manual click-ops.

**Files:**

- Modify/create Grafana provisioning datasource YAML in repo-managed config.
- Update operations doc with datasource name and URL.

**Steps:**

1. Inspect current Grafana datasource provisioning.
2. Add Loki datasource named `Loki` pointing at the internal Loki URL.
3. Recreate/restart Grafana if provisioning requires it.
4. Verify Grafana health.
5. Verify the datasource via Grafana API or UI query if credentials are available locally.

**Verification:**

```bash
curl -fsS http://jellybase:3001/api/health
# If Grafana API auth is available, query datasource list and confirm Loki exists.
```

### Task 4: Extend Borgmatic rollout generator with optional Loki hook

**Objective:** Generate host-specific Borgmatic config that ships logs to Loki using inventory-driven labels.

**Files:**

- Modify: `scripts/borgmatic-rollout-generate`
- Modify: `inventory/backups.yml` and/or `inventory/observability.yml`
- Modify: `docs/operations/borgmatic-host-rollout.md`
- Test/verify generated files under `/tmp/borgmatic-rollout-<host>/`

**Steps:**

1. Add optional observability config parsing.
2. Generate Borgmatic Loki monitoring hook config only for enabled hosts.
3. Use `__hostname` or explicit inventory host label consistently.
4. Keep endpoint non-secret; if any auth is later needed, read it from a root-only file and never print it.
5. Preserve existing generated stage ordering and wrong-host guards.
6. Run Python compile and generator checks.
7. Run `bash -n` on generated stage scripts.

**Verification:**

```bash
python3 -m py_compile scripts/borgmatic-rollout-generate
./scripts/borgmatic-rollout-generate
bash -n /tmp/borgmatic-rollout-jellybase/stage-*.sh
bash -n /tmp/borgmatic-rollout-jellyhome/stage-*.sh
bash -n /tmp/borgmatic-rollout-jellyberry/stage-*.sh
grep -R "loki" /tmp/borgmatic-rollout-jellyberry
! grep -R "^loki:" /tmp/borgmatic-rollout-jellybase /tmp/borgmatic-rollout-jellyhome
```

### Task 5: Roll out Borgmatic Loki hook to jellyberry first

**Objective:** Prove the log path on one low-risk host before touching the rest.

**Host:** `jellyberry` / tmux window 4.

**Steps:**

1. Copy or regenerate the latest `/tmp/borgmatic-rollout-jellyberry/` stages on jellyberry.
2. Run only the config/update stage needed for Loki hook integration.
3. Validate Borgmatic config.
4. Run a bounded manual Borgmatic action or test run that emits logs.
5. Query Loki for `host="jellyberry"` and `job="borgmatic"`.
6. Confirm existing Prometheus backup metrics still work.

**Verification:**

```bash
sudo borgmatic config validate
curl -fsG http://jellybase:3100/loki/api/v1/labels
curl -fsG --data-urlencode 'query={job="borgmatic",host="jellyberry"}' http://jellybase:3100/loki/api/v1/query_range
curl -fsS 'http://jellybase:9090/api/v1/query?query=borgmatic_last_run_success{host="jellyberry"}'
```

### Task 6: Import/source-manage Borgmatic Grafana dashboard

**Objective:** Add the Borgmatic Logs dashboard as source-managed Grafana provisioning, adjusted for local labels.

**Files:**

- Create: Grafana dashboard JSON under repo-managed provisioning path.
- Modify: Grafana dashboard provider YAML if needed.
- Update: `docs/operations/loki-grafana-observability.md`

**Steps:**

1. Download or copy the Borgmatic Logs dashboard JSON from Grafana dashboard ID 20736.
2. Replace datasource references with the local Loki datasource UID/name.
3. Confirm queries match labels: `job="borgmatic"`, `host`, `instance`.
4. Provision dashboard through repo-managed Grafana config.
5. Recreate/restart Grafana if needed.
6. Verify dashboard exists and panels query data.

**Verification:**

```bash
curl -fsS http://jellybase:3001/api/health
# If API auth is available, verify dashboard by UID and panel count.
# Otherwise verify in browser/UI after provisioning.
```

### Task 7: Roll out to jellyhome and jellybase

**Objective:** Extend the proven Borgmatic log shipping pattern to the remaining first-wave hosts after jellyberry is verified.

**Hosts:**

- `jellyhome` / tmux window 3.
- `jellybase` / tmux window 2.

**Steps per host:**

1. Regenerate host stages.
2. Run config/update stage only.
3. Validate Borgmatic config.
4. Trigger a bounded manual Borgmatic action or wait for the next scheduled run.
5. Query Loki by host label.
6. Query Prometheus backup metric by host label.

**Verification:**

```bash
sudo borgmatic config validate
curl -fsG --data-urlencode 'query={job="borgmatic",host="jellyhome"}' http://jellybase:3100/loki/api/v1/query_range
curl -fsG --data-urlencode 'query={job="borgmatic",host="jellybase"}' http://jellybase:3100/loki/api/v1/query_range
curl -fsS 'http://jellybase:9090/api/v1/query?query=borgmatic_last_run_success'
```

### Task 8: Add MQTT event publishing for instant Discord notifications

**Objective:** Publish compact backup lifecycle events to MQTT and bridge important events to Discord.

**Files:**

- Modify Borgmatic wrapper/status script generated by `scripts/borgmatic-rollout-generate`, or add a small root-owned event publisher helper.
- Add MQTT topic contract to `docs/specs/003-loki-grafana-observability.md`.
- Add Hermes/Discord bridge runbook under `docs/operations/`.

**Steps:**

1. Decide whether `mosquitto_pub` runs directly from the Borgmatic wrapper or from a local non-root status watcher.
2. Keep payload compact and secret-free.
3. Publish start/success/failure event topics.
4. Publish retained latest state topic.
5. Add a Hermes subscriber/cron/watch bridge that posts failures immediately and successes optionally/quietly.
6. Include a Grafana Explore/dashboard hint in Discord failure messages.

**Discord message shape:**

```text
🚨 Borg backup failed: jellybase
Exit: 2 | Duration: 7m41s
Logs: Grafana > Borgmatic Logs > host=jellybase
Latest state: home-network/backups/jellybase/borgmatic/state
```

**Verification:**

```bash
mosquitto_sub -v -t 'home-network/backups/+/borgmatic/#'
mosquitto_pub -t 'home-network/backups/jellybase/borgmatic/event' -m '{"host":"jellybase","status":"test"}'
```

### Task 9: Generalize Loki beyond Borgmatic

**Objective:** Extend the same pattern to system and container logs after backup logs are stable.

**Candidate sources:**

- systemd journal logs via Promtail/Alloy or another lightweight log shipper.
- Docker container logs from selected services.
- Home Assistant logs if useful.
- Mosquitto logs.
- Prometheus/Grafana/Loki stack logs.

**Rules:**

1. Start with allowlisted units/services, not "ship everything forever".
2. Apply retention from day one.
3. Avoid labels with unbounded values.
4. Do not ship secrets or verbose application payloads without review.
5. Keep Dozzle for live container tailing; use Loki for history/search/correlation.

**Future label shape:**

```yaml
job: systemd-journal | docker | home-assistant | mosquitto
host: <host>
unit: <systemd unit, allowlisted>
container: <container name, allowlisted>
environment: home-network
```

### Task 10: Add alerting policy

**Objective:** Route health and failure signals to the right notification path.

**Policy:**

- Prometheus/Alertmanager for metric state:
  - backup failed
  - backup stale
  - node exporter down
  - disk-health failed/stale
  - Loki target unavailable
- Loki/Grafana for log investigation and optional log-derived alerts:
  - repeated Borgmatic warnings
  - specific known fatal patterns
- MQTT/Hermes for instant fan-out:
  - backup started/succeeded/failed
  - urgent failure events to Discord
  - retained latest state

**Acceptance criteria:**

- A backup failure creates/updates Prometheus state.
- A backup failure appears in Loki with host labels.
- A backup failure publishes an MQTT event.
- Discord receives a concise failure notification with a Grafana log hint.

## 7. Verification checklist

Before considering Borgmatic-first rollout complete:

- [ ] Loki `/ready` returns OK from jellybase and from target host network paths.
- [ ] Grafana has a working Loki datasource.
- [ ] Borgmatic logs from `jellyberry`, then `jellybase` and `jellyhome`, are queryable by host label.
- [ ] Existing Prometheus backup metrics still return all expected hosts.
- [ ] Dashboard is source-managed and visible in Grafana.
- [ ] Logs contain no passphrases, private keys, exported Borg keys, secret file contents, or raw `/opt/docker/.secrets` values.
- [ ] MQTT test event can reach a subscriber.
- [ ] Discord bridge can post a test failure message without exposing secrets.
- [ ] Docs explain metrics vs logs vs events clearly.
- [ ] Rollback steps are documented.

## 8. Rollback plan

If Loki/Grafana deployment fails:

1. Disable/remove the Loki service from the monitoring Compose change.
2. Recreate Grafana/Prometheus back to previous known config.
3. Confirm Grafana and Prometheus health.
4. Leave Borgmatic config unchanged until Loki endpoint exists.

If a host Borgmatic config fails validation:

1. Do not run backup.
2. Restore previous `/etc/borgmatic/config.yaml` from the stage backup.
3. Re-run `sudo borgmatic config validate`.
4. Confirm existing timer/service state remains unchanged.

If MQTT notification path is noisy:

1. Disable only the MQTT publish/bridge path.
2. Keep Loki and Prometheus active.
3. Re-enable with stricter event filtering.

## 9. Security and privacy notes

- Loki should remain trusted LAN/Tailnet only.
- Do not public reverse-proxy Loki directly.
- Grafana exposure should stay behind existing trusted access rules until auth/TLS policy is explicitly designed.
- Use low-cardinality labels only.
- Never put secrets in labels; labels are indexed and easy to expose.
- Treat Borgmatic logs as sensitive operational data even when they do not contain passphrases.
- Keep `/opt/docker/.secrets` excluded from backup and log shipping.

## 10. Open decisions

1. Should Loki live on `jellybase` with Prometheus/Grafana, or on another host later if log volume grows?
2. What retention period is acceptable for backup logs: 14, 30, or 90 days?
3. Should successful backup Discord messages be instant, daily digest only, or silent unless failure?
4. Should MQTT events go through Home Assistant automations, a Hermes-native subscriber, or a small dedicated bridge?
5. Should `jellybackup` be added as a monitored/log-shipping host in the same first wave?
