# Node Exporter, Disk Health, and Prometheus Operations

Status: first-pass implemented; host overview dashboard source-managed
Last updated: 2026-05-24

## Current reality

`jellyhome`, `jellybase`, and `jellyberry` now expose host telemetry through node_exporter on TCP `9100`. Prometheus runs on `jellybase` and scrapes the targets under job `node_exporter`. Grafana is reachable on `jellybase`. The repo now source-manages a Borgmatic dashboard and a Host Observability dashboard; alert rules and broader log shipping are still follow-up work.

Current endpoints:

```text
http://jellybase:9090   Prometheus
http://jellybase:3001   Grafana
http://jellyhome:9100   node_exporter
http://jellybase:9100   node_exporter
http://jellyberry:9100  node_exporter
```

Prometheus currently sees three node_exporter targets. Because Prometheus runs in Docker on `jellybase`, the `jellybase` target may appear as `host.docker.internal:9100`; use the metric `host` label to identify the host as `jellybase`.

## Source of truth

```text
inventory/hosts.yml
scripts/host-monitoring-policy-check
scripts/node-exporter-rollout-generate
docs/specs/002-node-exporter-disk-health.md
docs/plans/006-node-exporter-disk-health-rollout.md
```

The runtime setup remains stage-based and operator-controlled. Future hosts should be added to inventory and then generated through `just node-exporter-rollout-generate`; do not hand-build one-off host scripts unless the generated stages cannot support the host.

## What is visible

Standard node_exporter metrics include CPU, memory, load, network, filesystem, inode, disk I/O, thermal-zone, and hwmon metrics where the host exposes them. The rollout/bootstrap package set must include `lm-sensors` so operators can locally inspect hwmon/thermal readings with `sensors` while node_exporter exposes the same kernel sensor families to Prometheus.

Sanitized Borgmatic metrics are exported through node_exporter textfile collector when status files exist:

```text
borgmatic_last_run_timestamp_seconds
borgmatic_last_run_success
borgmatic_last_run_exit_code
borgmatic_last_run_duration_seconds
```

Disk-health metrics are exported through the custom textfile probe:

```text
home_network_disk_health_status
home_network_disk_health_last_run_timestamp_seconds
home_network_disk_health_probe_success
home_network_disk_health_unknown_devices
```

Pi-style hosts may also expose indirect early-warning metrics, such as read-only filesystem state, kernel storage error counts, USB reset counts, throttling/undervoltage flags, CPU/GPU temperature via `vcgencmd`, and tiny storage probe success/latency. Treat these as risk indicators, not proof that storage is healthy. Unsupported sensors must stay explicit as missing/unknown rather than implied healthy.

## Quick verification

```bash
curl -fsS http://jellybase:9090/-/ready
curl -fsS http://jellybase:3001/api/health
curl -fsS http://jellyhome:9100/metrics | grep '^node_uname_info'
curl -fsS http://jellybase:9100/metrics | grep '^node_uname_info'
curl -fsS http://jellyberry:9100/metrics | grep '^node_uname_info'
curl -fsS 'http://jellybase:9090/api/v1/query?query=up%7Bjob%3D%22node_exporter%22%7D'
curl -fsS 'http://jellybase:9090/api/v1/query?query=home_network_disk_health_last_run_timestamp_seconds'
curl -fsS 'http://jellybase:9090/api/v1/query?query=node_hwmon_temp_celsius%20or%20node_thermal_zone_temp%20or%20home_network_pi_temperature_celsius'
curl -fsS 'http://jellybase:9090/api/v1/query?query=borgmatic_last_run_success'
just host-monitoring-policy-check
just node-exporter-rollout-generate
git diff --check
```

## Current branch/state

Current rollout and documentation work is on branch:

```text
main
```

The repo remains the source of truth. Runtime config/scripts on hosts should be treated as deployed copies and reconciled back into this repo if they change.

## Remaining work

1. Run and verify generated `stage-07-configure-access-control.sh` on live hosts so TCP `9100` is only reachable from the approved Prometheus scraper path.
2. Deploy and verify source-managed Prometheus config/rules on `jellybase`, then wire alert delivery through the chosen Discord/Hermes or Alertmanager path.
3. Deploy and verify the source-managed `Host Observability` Grafana dashboard on `jellybase`.
4. Decide whether to add `jellybackup` to the node_exporter/disk-health rollout now that the first three hosts work.
5. Fold any live Prometheus/Grafana config changes back into repo-managed files if they were made directly on the host.

## Safety notes

- Keep node_exporter LAN/Tailnet-only. Do not publish TCP `9100` through a public reverse proxy.
- Do not emit Borg secrets, passphrases, exported keys, repository credentials, raw SMART JSON, disk serial numbers, or raw root logs into metrics.
- Disk-health on Raspberry Pi/USB/microSD media is best-effort. Unknown is a valid and honest result.
- Prefer staged, inspectable scripts over one-shot automation.
