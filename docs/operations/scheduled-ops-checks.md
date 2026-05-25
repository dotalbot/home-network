# Scheduled Operational Checks

This runbook defines the scheduled drift/backup/status check delivery path for the home-network stack.

## Delivery paths

There are two useful delivery paths. They solve different problems.

### Path A: Prometheus textfile metrics -> Alertmanager -> Discord

This is the default path for operational failures.

Flow:

```text
systemd timer on jellybase
  -> scripts/scheduled-ops-check
  -> /var/lib/node_exporter/textfile_collector/home_network_scheduled_ops.prom
  -> node_exporter
  -> Prometheus rules
  -> Alertmanager grouping/silences/repeats
  -> alertmanager-discord-bridge
  -> Discord alert thread
```

Use this path for wake-up signals where repeated notifications, silences, and dashboards matter:

- backup policy or timer health failure;
- Docker Compose drift;
- service status failures;
- Prometheus/Alertmanager readiness failures;
- missing node_exporter targets;
- stale scheduled-check runner metrics.

Why this is preferred:

- Prometheus remains the source of truth for alert state.
- Alertmanager handles grouping, repeat intervals, and silences.
- Discord stays a wake-up path, not the investigation database.
- The runner output is secret-free and visible through Prometheus/Grafana.

### Path B: Hermes cron summary

Use Hermes cron for softer human summaries, not primary health alerts.

Good uses:

- daily/weekly operational digest;
- “what changed?” narrative summaries;
- roadmap progress summaries;
- reminders for planned manual work such as the `jellybase` reboot.

Avoid using Hermes cron as the only failure path for critical operational checks. If Hermes, the gateway, Discord auth, or a model provider is unavailable, primary alerts should still exist in Prometheus/Alertmanager.

## Managed files

Source-managed files:

- `scripts/scheduled-ops-check`
- `systemd/home-network-scheduled-ops-check.service`
- `systemd/home-network-scheduled-ops-check.timer`
- `docker/appdata/prometheus/config/rules/home-network-alerts.yml`

Runtime metric path on `jellybase`:

```bash
/var/lib/node_exporter/textfile_collector/home_network_scheduled_ops.prom
```

## Checks currently covered

The runner checks:

- takes a non-blocking lock at `/run/lock/home-network-scheduled-ops-check.lock` so overlapping timer runs exit quietly;
- repo cleanliness through `git status --short --branch`;
- service reachability through `scripts/status`;
- Docker service drift through `scripts/drift-check`;
- backup policy metadata through `scripts/backup-policy-check`;
- host monitoring policy through `scripts/host-monitoring-policy-check`;
- Prometheus readiness;
- Alertmanager readiness;
- `up{job="node_exporter"}` for all node_exporter targets;
- Prometheus discovery of at least one Alertmanager.

## Install on jellybase

From `/home/jellybot/home-network` on `jellybase`:

```bash
sudo install -m 644 systemd/home-network-scheduled-ops-check.service /etc/systemd/system/home-network-scheduled-ops-check.service
sudo install -m 644 systemd/home-network-scheduled-ops-check.timer /etc/systemd/system/home-network-scheduled-ops-check.timer
sudo systemctl daemon-reload
sudo systemctl enable --now home-network-scheduled-ops-check.timer
```

The service file runs the repo copy at `/home/jellybot/home-network/scripts/scheduled-ops-check` so source updates apply after the jellybase checkout is refreshed. If that path changes, update the service file before enabling the timer.

## Manual run

From `/home/jellybot/home-network` on `jellybase`:

```bash
just scheduled-ops-check
```

From another host, point it at jellybase services and skip local command checks:

```bash
scripts/scheduled-ops-check \
  --no-command-checks \
  --prometheus-url http://192.168.1.2:9090 \
  --alertmanager-url http://192.168.1.2:9093
```

## Verify timer and metrics

```bash
systemctl list-timers 'home-network-scheduled-ops-check.timer' --all --no-pager
systemctl status home-network-scheduled-ops-check.timer --no-pager
systemctl status home-network-scheduled-ops-check.service --no-pager
curl -fsS http://127.0.0.1:9100/metrics | grep home_network_scheduled_check
curl -fsG --data-urlencode 'query=home_network_scheduled_check_overall_success' http://127.0.0.1:9090/api/v1/query
```

Prometheus alerts added by this rollout:

- `HomeNetworkScheduledOpsCheckFailed`
- `HomeNetworkScheduledOpsCheckStale`

## Pause and resume

Pause scheduled checks during maintenance:

```bash
sudo systemctl stop home-network-scheduled-ops-check.timer
```

Resume:

```bash
sudo systemctl start home-network-scheduled-ops-check.timer
```

For known maintenance that will break checks but should not page Discord, prefer an Alertmanager silence scoped to:

```text
category="scheduled-ops"
```

## Troubleshooting

- If `home_network_scheduled_check_last_run_timestamp_seconds` is stale, check the timer and service journal.
- If only command checks fail, run `just scheduled-ops-check` locally on `jellybase` and inspect the named failed check.
- If Prometheus or Alertmanager checks fail, verify the containers and local ready endpoints first.
- If Discord does not receive a scheduled-ops alert, verify Alertmanager and the Discord bridge using `docs/operations/prometheus-alerting.md`.
