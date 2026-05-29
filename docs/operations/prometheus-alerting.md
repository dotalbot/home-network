# Prometheus Alerting via Alertmanager and Discord

This runbook covers the home-network Prometheus alert-delivery path.

## Scope

Prometheus remains the source of truth for alert rules and alert state.
Alertmanager handles grouping, deduplication, repeat intervals, and silences.
Discord is the wake-up path only.

Runtime host:

- `jellybase`

Managed containers:

- `prometheus`
- `alertmanager`
- `alertmanager-discord-bridge`

Managed source files:

- `docker/appdata/prometheus/config/prometheus.yml`
- `docker/appdata/prometheus/config/rules/home-network-alerts.yml`
- `docker/appdata/alertmanager/config/alertmanager.yml`
- `docker/appdata/alertmanager-discord-bridge/bridge.py`
- `docker/hosts/jellybase.yaml`

## Secret handling

The Discord webhook URL must not be committed to Git.

Expected runtime secret path on `jellybase`:

```bash
/opt/docker/.secrets/alertmanager/discord_webhook_url
```

Expected permissions:

```bash
sudo install -d -m 770 -o root -g dockerops /opt/docker/.secrets/alertmanager
sudo install -m 640 -o root -g dockerops /dev/null /opt/docker/.secrets/alertmanager/discord_webhook_url
sudo nano /opt/docker/.secrets/alertmanager/discord_webhook_url
```

Paste only the Discord webhook URL in the file. Do not paste it into chat, command history, logs, or Git.

To verify the secret without printing it:

```bash
sudo test -s /opt/docker/.secrets/alertmanager/discord_webhook_url && echo good
sudo wc -c /opt/docker/.secrets/alertmanager/discord_webhook_url
```

To rotate it, edit the same file in place and recreate only the bridge container:

```bash
sudo nano /opt/docker/.secrets/alertmanager/discord_webhook_url
docker compose -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellybase.yaml up -d --force-recreate alertmanager-discord-bridge
```

## Routing policy

Alertmanager default route:

- warning alerts grouped by `alertname`, `host`, `monitored_host`, `instance`, `category`, and `service`
- group wait: 30s
- group interval: 10m
- repeat interval: 4h

Critical route:

- `severity="critical"`
- group wait: 10s
- group interval: 5m
- repeat interval: 1h

Info route:

- `severity="info"`
- group wait: 5m
- group interval: 30m
- repeat interval: 12h

The bridge posts compact messages to Discord and includes a reminder that Grafana/Prometheus remain the investigation path.

## Red-flag rule coverage and noise control

Current source-managed red-flag alerts use the monitoring-native route: Prometheus evaluates rules, Alertmanager groups/deduplicates/silences, and the Discord bridge delivers compact wake-up messages. Hermes cron remains for human summaries only, not critical failure delivery.

Covered checks:

- Backup stale/failing: `BorgmaticLastRunFailed`, `BorgmaticMetricsStale`, and `BorgmaticMetricsMissing`.
- Scheduled Borg prerequisite failures: `HomeNetworkScheduledBorgCheckFailed`.
- Host unreachable: `HostTelemetryUnreachable` fires only when both node_exporter and Alloy scrapes are down for the same monitored host.
- node_exporter missing/down: `NodeExporterDown`.
- Textfile collector parse failures: `NodeTextfileScrapeError` for `node_textfile_scrape_error > 0`.
- Disk health probe failed/stale/failed disk: `DiskHealthFailure`, `DiskHealthProbeFailed`, and `DiskHealthProbeStale`.
- Unexpected unknown disk device changes: `UnexpectedUnknownDiskDeviceChange` waits 12h after the unknown-device count changes and remains nonzero; stable known Pi/USB gaps stay covered by the lower-priority `DiskHealthUnknown` info alert.
- Container drift: `HomeNetworkContainerDrift`, sourced from the scheduled `scripts/drift-check` result.
- Optional dashboard render validation: `HomeNetworkScheduledDashboardRenderCheckFailed`, emitted only when the scheduled runner is configured with `DASHBOARD_RENDER_CHECKS=1` or run manually with `--dashboard-render-checks`.

Noise controls:

- Critical alerts are reserved for backup run failures, likely whole-host unreachable conditions, and direct disk/power/kernel red flags.
- `HostTelemetryUnreachable` inhibits lower-level `NodeExporterDown` and `AlloyDown` alerts for the same `monitored_host` so a dead host does not produce three Discord messages.
- Specific scheduled-check alerts suppress the generic scheduled-ops failure for container drift, backup-policy, Borg prerequisite, and optional dashboard-render failures.
- Warning alerts have `for:` windows and Alertmanager repeat interval 4h by default.
- Info alerts use a 12h repeat interval and are for known-but-worth-tracking gaps such as long-term unknown disk-health status.
- Prefer narrow silences by `alertname`, `host`/`monitored_host`, `instance`, `category`, or `service` during maintenance.
- Do not page on raw logs; log-derived alerts are thresholded textfile metrics.

## Deploy

From `/home/jellybot/home-network` on `jellybase`:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
just sync-docker-config
docker compose -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellybase.yaml up -d alertmanager-discord-bridge alertmanager prometheus
```

If the secret file is missing, `alertmanager-discord-bridge` should fail fast and restart until the secret exists.

## Verify

Check config files:

```bash
docker run --rm --entrypoint amtool -v "$PWD/docker/appdata/alertmanager/config/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" prom/alertmanager:latest check-config /etc/alertmanager/alertmanager.yml
docker run --rm --entrypoint promtool -v "$PWD/docker/appdata/prometheus/config:/etc/prometheus:ro" prom/prometheus:latest check config /etc/prometheus/prometheus.yml
```

Check runtime:

```bash
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'prometheus|alertmanager'
curl -fsS http://127.0.0.1:9093/-/ready
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:9090/api/v1/alertmanagers
```

Expected Prometheus alertmanager discovery includes `alertmanager:9093` as an active target.

Check bridge health from inside the Compose network:

```bash
docker compose -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellybase.yaml exec alertmanager-discord-bridge wget -qO- http://127.0.0.1:9094/healthz
```

## Fake alert test

Use Alertmanager's API to inject a temporary synthetic alert. This tests Alertmanager routing and Discord delivery without breaking a real service.

```bash
starts_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ends_at="$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)"

curl -fsS -XPOST http://127.0.0.1:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d "[{
    \"labels\": {
      \"alertname\": \"HomeNetworkAlertRouteTest\",
      \"severity\": \"warning\",
      \"category\": \"test\",
      \"host\": \"jellybase\"
    },
    \"annotations\": {
      \"summary\": \"Home-network Alertmanager Discord route test\",
      \"description\": \"Synthetic alert to verify grouped Discord delivery.\"
    },
    \"startsAt\": \"${starts_at}\",
    \"endsAt\": \"${ends_at}\",
    \"generatorURL\": \"http://jellybase:9093/#/alerts\"
  }]"
```

A Discord message should arrive in the configured alert thread. A resolved message should follow after the alert expires.

## Silencing during maintenance

Open Alertmanager:

```text
http://192.168.1.2:9093
```

Create a silence using specific matchers. Prefer narrow matchers, for example:

```text
alertname="NodeExporterDown"
instance="jellyhome:9100"
```

Avoid broad silences such as `severity="critical"` unless the whole monitoring stack is undergoing maintenance.

## Rollback

To stop alert delivery without changing Prometheus rules:

```bash
docker compose -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellybase.yaml stop alertmanager alertmanager-discord-bridge
```

To remove Prometheus forwarding temporarily, remove or comment the `alerting.alertmanagers` block in `docker/appdata/prometheus/config/prometheus.yml`, sync, and recreate Prometheus.

## Troubleshooting

- No Discord message: check the webhook secret file exists and `alertmanager-discord-bridge` logs.
- Alertmanager has no alerts: check Prometheus `/alerts` and rule evaluation first.
- Prometheus shows no Alertmanager target: check `prometheus.yml` and recreate Prometheus, not just restart.
- Discord HTTP errors: rotate or re-create the Discord webhook, then update only the host-local secret file.
