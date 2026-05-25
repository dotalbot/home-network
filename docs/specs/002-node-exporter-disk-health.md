# Node Exporter and Disk Health Spec

Status: first-pass implemented; hardening/dashboard follow-up

## Goal

Add generic, stage-based node_exporter monitoring across `jellyberry`, `jellybase`, and `jellyhome`, with Prometheus scrape support for:

- standard host metrics;
- Borg/Borgmatic sanitized backup stats via node_exporter textfile collector;
- disk capacity and filesystem pressure;
- disk/device health signals where the OS and hardware expose them safely.

The result should work for future hosts such as `jellypi` by adding inventory YAML and running controlled setup stages.

## Non-goals

- Do not expose Borg passphrases, exported Borg keys, SSH keys, tokens, or root-only logs.
- Do not add a push model to Prometheus; Prometheus remains pull-based.
- Do not assume every Raspberry Pi disk/USB bridge exposes full SMART data.
- Do not install Grafana dashboards or alert rules in this first implementation unless explicitly approved later.
- Do not change Netdata topology in this work; this complements Netdata rather than replacing it.

## Design summary

Node exporter runs on each monitored host and exposes host metrics on `:9100/metrics`.

Borgmatic and local health probes write sanitized Prometheus textfile metrics to:

```text
/var/lib/node_exporter/textfile_collector/*.prom
```

Prometheus on `jellybase` scrapes each host:

```text
jellyhome:9100
jellybase:9100
jellyberry:9100
```

Future hosts should be added through inventory and generated setup stages rather than hand-built scripts.

## Current implementation snapshot

As of 2026-05-22, the first working pass is implemented for `jellyhome`, `jellybase`, and `jellyberry`:

- each host answers node_exporter metrics on TCP `9100`;
- Prometheus on `jellybase:9090` scrapes all three targets under job `node_exporter`;
- the `jellybase` scrape target may appear as `host.docker.internal:9100` because Prometheus runs in Docker, while the emitted `host` label remains `jellybase`;
- sanitized Borgmatic textfile metrics are visible for all three hosts;
- `home_network_disk_health_*` metrics are visible for all three hosts;
- Grafana is reachable on `jellybase:3001`, but source-managed dashboards/provisioning are still follow-up work.

The remaining work is hardening TCP `9100`, source-managing alert rules and dashboards, and adding additional hosts such as `jellybackup` if desired.

## Source of truth

Use `inventory/hosts.yml` for host monitoring metadata. Proposed future fields:

```yaml
monitoring_defaults:
  node_exporter:
    enabled: false
    scrape_port: 9100
    scrape_scheme: http
    textfile_collector_dir: /var/lib/node_exporter/textfile_collector
    disk_health: best-effort
    disk_devices:
      - auto
    pi_early_warning: false
    allowed_scrapers:
      - host: jellybase
        role: prometheus

hosts:
  jellypi:
    roles:
      - pi
      - docker-host
      - borg-client
      - node-exporter-client
    monitoring:
      node_exporter:
        enabled: true
        scrape_host: jellypi
        pi_early_warning: true
```

The implementation may start with defaults for existing hosts and add richer schema validation in a later phase.

## OS packages to add to bootstrap/install scripts

Ubuntu-style hosts (`bootstrap/bootstrap-ubuntu.sh`):

```text
prometheus-node-exporter
smartmontools
nvme-cli
util-linux
lsblk is included via util-linux on normal installs
```

Raspberry Pi / Debian-style hosts (`bootstrap/bootstrap-pi.sh`):

```text
prometheus-node-exporter
smartmontools
nvme-cli
util-linux
usbutils
hdparm
mmc-utils
sysstat
raspi-utils or libraspberrypi-bin, depending on distro package availability
```

Notes:

- `prometheus-node-exporter` gives the node_exporter systemd service.
- `smartmontools` provides `smartctl` for SATA/SAS/USB/NVMe devices when supported.
- `nvme-cli` provides `nvme smart-log` for NVMe devices.
- `usbutils` helps identify USB-SATA bridges on Pi hosts.
- `hdparm` can provide limited disk metadata on some devices but is not a SMART replacement.
- `mmc-utils` can expose limited eMMC/MMC data on some boards/cards; it may not help with normal consumer microSD.
- `sysstat` provides `iostat`, useful for latency/utilization early-warning metrics when device health is opaque.
- `vcgencmd` from `raspi-utils`/`libraspberrypi-bin` exposes Pi throttling, undervoltage, and temperature signals that can predict storage trouble indirectly.

## Raspberry Pi disk-health reality check

Disk health on Raspberry Pi can be awkward because many Pi setups use:

- microSD cards, which usually do not expose SMART;
- USB flash drives, which often expose little health data;
- USB-SATA bridges, where SMART may require a bridge-specific `smartctl -d` option;
- USB-NVMe bridges, where health support depends on bridge firmware.

Therefore disk health is defined as best-effort:

1. Always collect filesystem capacity and inode pressure from node_exporter.
2. Try `smartctl --scan-open` to discover SMART-capable devices.
3. Try multiple safe `smartctl` bridge modes when a USB bridge is detected, for example `sat`, `scsi`, and `auto`, but only emit sanitized results.
4. Try `smartctl -H -A -j <device>` for devices discovered by smartmontools.
5. For NVMe devices, try `nvme smart-log --output-format=json <device>`.
6. For MMC/eMMC devices, try `mmc extcsd read` where supported, but treat unsupported output as `unknown` rather than failure.
7. If no device health is available, emit an explicit metric saying health is unknown instead of pretending success.

This keeps Pi support honest: no SMART, no problem, but no fibbing. A lying disk is a bad sector with a PR team.

## Raspberry Pi early-warning signals

Even when a Pi cannot expose real SMART data, we can still monitor weak signals that often show up before a storage failure becomes obvious. These are not perfect disk-health signals, but early warning is better than nothing.

Recommended first-pass Pi signals:

1. Filesystem pressure
   - Use node_exporter filesystem metrics for free bytes and free inodes.
   - Alert before the Pi fills the root filesystem; full disks cause weird corruption-like symptoms.

2. Filesystem mount state
   - Detect whether important filesystems have become read-only.
   - Metric idea: `home_network_filesystem_readonly{host="<host>",mountpoint="/"} 0|1`.
   - A surprise read-only root filesystem is a serious early warning.

3. Kernel I/O and filesystem errors
   - Scan recent `journalctl -k`/kernel messages for storage phrases such as `I/O error`, `Buffer I/O error`, `EXT4-fs error`, `mmcblk`, `reset SuperSpeed USB device`, and `uas_eh_abort_handler`.
   - Emit counts, not raw log lines.
   - Metric idea: `home_network_disk_kernel_error_count{host="<host>",window="24h"}`.

4. Pi undervoltage and throttling
   - Use `vcgencmd get_throttled` where available.
   - Undervoltage causes USB/storage resets and SD-card corruption on Pis, so it is a storage-risk signal even though it is not a disk metric.
   - Metric ideas:
     - `home_network_pi_undervoltage_now{host="<host>"} 0|1`
     - `home_network_pi_undervoltage_seen{host="<host>"} 0|1`
     - `home_network_pi_throttled_seen{host="<host>"} 0|1`

5. Temperature
   - Use node_exporter thermal zones and/or `vcgencmd measure_temp`.
   - Sustained heat can cause throttling and instability.
   - Metric idea: `home_network_pi_temperature_celsius{host="<host>"}` if node_exporter thermal metrics are not enough.

6. Device resets/disconnects
   - Count USB reset/disconnect messages from kernel logs for USB-SATA/USB-NVMe setups.
   - Metric idea: `home_network_usb_storage_reset_count{host="<host>",window="24h"}`.

7. Disk latency/utilization trend
   - Use node_exporter disk stats and optionally `iostat` from `sysstat` for local verification.
   - Rising await/utilization at normal load can flag struggling media or USB bridges.
   - Prefer Prometheus queries from node_exporter counters for ongoing alerting instead of shelling out constantly.

8. MMC/eMMC lifetime where available
   - Try `mmc extcsd read /dev/mmcblk0` on supported devices.
   - Some eMMC devices expose lifetime estimates; normal microSD often does not.
   - Metric idea: `home_network_mmc_life_time_estimate{host="<host>",device="/dev/mmcblk0",type="a|b"}`.
   - If unsupported, emit unknown.

9. Lightweight write/read sanity probe
   - Optionally write and read a tiny test file under a chosen safe path such as `/var/lib/home-network/disk-health/`.
   - Measure latency and verify contents.
   - Keep it low-frequency and tiny to avoid wearing flash.
   - Metric ideas:
     - `home_network_storage_probe_success{host="<host>",path="/var/lib/home-network/disk-health"} 0|1`
     - `home_network_storage_probe_latency_seconds{host="<host>",path="/var/lib/home-network/disk-health"}`.

Do not run destructive tests such as `badblocks -w`, filesystem stress tests, or large write endurance checks as part of routine monitoring. That would be like checking whether your smoke alarm works by setting fire to the curtains.

## First working pass output

The initial rollout is intended to make these results visible in Prometheus:

1. Backup results from Borgmatic status textfile metrics.
2. Disk capacity/filesystem pressure from standard node_exporter filesystem metrics.
3. Best-effort disk/device health from a custom disk health textfile probe.
4. Basic host metrics such as CPU, memory, load, network, and disk I/O from node_exporter.
5. Raspberry Pi indirect early-warning signals where available: read-only filesystems, kernel I/O error counts, undervoltage/throttling, temperature, USB storage resets, and tiny write/read probe success/latency.

So yes: the first useful dashboard/query set should cover both backup results and disk results.

## Metrics

### Existing Borgmatic metrics

Already planned/generated by Borgmatic rollout scripts:

```text
borgmatic_last_run_timestamp_seconds{host="<host>"}
borgmatic_last_run_success{host="<host>"}
borgmatic_last_run_exit_code{host="<host>"}
borgmatic_last_run_duration_seconds{host="<host>"}
borgmatic_repository_reachable{host="<host>"}
borgmatic_last_archive_info{host="<host>",archive_name="<archive>"}
```

### Standard node_exporter filesystem metrics

Provided by node_exporter without custom scripts:

```text
node_filesystem_size_bytes
node_filesystem_avail_bytes
node_filesystem_free_bytes
node_filesystem_files
node_filesystem_files_free
node_disk_read_bytes_total
node_disk_written_bytes_total
node_disk_io_time_seconds_total
```

Prometheus can alert on disk pressure from these directly.

### Custom disk health textfile metrics

Proposed custom metrics written to:

```text
/var/lib/node_exporter/textfile_collector/disk_health.prom
```

Metric shape:

```text
# 1 = healthy/pass, 0 = failing/fail, -1 = unknown/unavailable
home_network_disk_health_status{host="jellyberry",device="/dev/sda",source="smartctl"} 1

# Unix timestamp when the probe last ran
home_network_disk_health_last_run_timestamp_seconds{host="jellyberry"} 1779465600

# Probe success: 1 = probe ran, 0 = script failure
home_network_disk_health_probe_success{host="jellyberry"} 1

# Count of devices with unknown health
home_network_disk_health_unknown_devices{host="jellyberry"} 1
```

Pi early-warning metrics when available:

```text
home_network_filesystem_readonly{host="jellypi",mountpoint="/"} 0
home_network_disk_kernel_error_count{host="jellypi",window="24h"} 0
home_network_usb_storage_reset_count{host="jellypi",window="24h"} 0
home_network_pi_undervoltage_now{host="jellypi"} 0
home_network_pi_undervoltage_seen{host="jellypi"} 0
home_network_pi_throttled_seen{host="jellypi"} 0
home_network_storage_probe_success{host="jellypi",path="/var/lib/home-network/disk-health"} 1
home_network_storage_probe_latency_seconds{host="jellypi",path="/var/lib/home-network/disk-health"} 0.012
```

These are risk indicators, not proof of disk health. They are useful because Pi storage often fails indirectly: power instability, USB resets, filesystem errors, or sudden read-only remounts.

Optional device attributes when safely available:

```text
home_network_disk_temperature_celsius{host="jellybase",device="/dev/nvme0",source="nvme"} 38
home_network_disk_power_on_hours{host="jellybase",device="/dev/sda",source="smartctl"} 12034
home_network_disk_percentage_used{host="jellybase",device="/dev/nvme0",source="nvme"} 2
```

Do not emit serial numbers. They are not needed for dashboard/alerts and can be treated as unnecessary device identity leakage.

## Generated stages

The generator is implemented separately from Borgmatic rollout, to avoid mixing backup repo setup with host monitoring setup:

```text
scripts/node-exporter-rollout-generate
```

It should generate:

```text
/tmp/node-exporter-rollout-<host>/
```

Stages:

1. `stage-00-preflight.sh`
   - Check current hostname matches expected host.
   - Check OS family.
   - Check sudo/root.
   - Show whether node_exporter, smartctl, nvme, lsblk, and systemd are available.
   - No mutation.

2. `stage-01-install-packages.sh`
   - Install OS packages listed above.
   - Use apt on Debian/Ubuntu/Pi hosts.
   - Refuse unsupported OS rather than guessing.

3. `stage-02-configure-node-exporter.sh`
   - Create `/var/lib/node_exporter/textfile_collector`.
   - Ensure node_exporter runs with textfile collector enabled.
   - Prefer distro package defaults when they already support textfile collector.
   - If override is needed, write a systemd drop-in, not a full unit replacement.
   - Restart node_exporter only after writing config.

4. `stage-03-install-disk-health-probe.sh`
   - Install `/usr/local/sbin/home-network-disk-health-prometheus`.
   - Script writes textfile output atomically via temp file + rename.
   - Script never prints SMART JSON by default and never emits serial numbers.

5. `stage-04-enable-disk-health-timer.sh`
   - Install a systemd service/timer to run the probe periodically, e.g. every 30 minutes.
   - Refuse to overwrite existing managed files unless an explicit override is set.

6. `stage-05-verify-local-metrics.sh`
   - Run the disk health probe once.
   - Curl `http://127.0.0.1:9100/metrics`.
   - Verify node_exporter standard metrics and custom metrics appear.

7. `stage-06-prometheus-target-note.sh`
   - Print the Prometheus scrape target that should be present on `jellybase`.
   - No remote mutation in this first version.

## Prometheus integration

Prometheus config includes a node_exporter scrape job equivalent to:

```yaml
scrape_configs:
  - job_name: node_exporter
    static_configs:
      - targets:
          - jellyhome:9100
          - jellybase:9100
          - jellyberry:9100
```

If DNS is unreliable, use LAN IPs from inventory where available. Avoid Tailscale-only routing unless explicitly chosen.

## Alert ideas for later implementation

These queries still need to become source-managed Prometheus alert rules and/or Grafana dashboard panels.

Disk pressure:

```promql
(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"}) < 0.10
```

Disk health failing:

```promql
home_network_disk_health_status == 0
```

Disk health unknown for too long:

```promql
home_network_disk_health_unknown_devices > 0
```

Disk health probe stale:

```promql
time() - home_network_disk_health_last_run_timestamp_seconds > 7200
```

Pi early-warning conditions:

```promql
home_network_filesystem_readonly == 1
home_network_disk_kernel_error_count > 0
home_network_usb_storage_reset_count > 0
home_network_pi_undervoltage_now == 1
home_network_pi_undervoltage_seen == 1
home_network_storage_probe_success == 0
home_network_storage_probe_latency_seconds > 1
```

Backup failure:

```promql
borgmatic_last_run_success == 0
```

Backup stale:

```promql
time() - borgmatic_last_run_timestamp_seconds > 93600
```

## Later hardening: access control and security model

Node exporter does not provide application-level authorization by default in the Debian/Ubuntu package flow. Treat it as a host-local metrics endpoint protected by network policy.

This is tracked for after the first working metrics pass. Recommended default:

1. Install node_exporter as an OS/systemd service.
2. Keep it reachable only on LAN/Tailnet, never from the public internet.
3. Add host firewall rules so only the Prometheus scraper can reach TCP `9100`.
4. Keep Prometheus on `jellybase` as the first allowed scraper.
5. Do not route node_exporter through public reverse proxies.

For this network, the first-pass allowlist should be:

```text
allowed to scrape TCP 9100: jellybase / Prometheus host
denied by default: all other hosts
```

Implementation detail:

- On `jellyhome` and `jellyberry`, allow TCP `9100` only from the `jellybase` LAN IP, and optionally from the `jellybase` Tailscale IP if Prometheus is explicitly configured to scrape over Tailnet.
- On `jellybase`, allow local scraping from `127.0.0.1`; if Prometheus runs in Docker bridge mode and scrapes the host via bridge/gateway, allow only the required Docker bridge subnet or use a host-network/explicit host-gateway pattern.
- Generated `stage-07-configure-access-control.sh` should use inventory `monitoring_defaults.node_exporter.allowed_scrapers` and host `lan_ip` values.
- If UFW is active, generated rollout should use UFW rules. If UFW is not active, generated rollout should print the exact recommended UFW commands plus equivalent nftables/iptables policy guidance without mutating firewall state or enabling UFW automatically.

Example UFW intent, not blindly copy/paste for every host:

```bash
sudo ufw deny 9100/tcp
sudo ufw allow from 192.168.1.2 to any port 9100 proto tcp comment 'Prometheus scrape from jellybase'
```

Optional stronger pattern later:

- Scrape over Tailscale only and enforce Tailscale ACLs so only `jellybase` can connect to `*:9100`.
- Add node_exporter `web.config` TLS/basic-auth only if the installed package version and Prometheus config support it cleanly. This is more moving parts than firewall allowlisting and is not needed for the first LAN-only rollout.

## Security and privacy

- Keep node_exporter bound to LAN/Tailnet-reachable interfaces only by firewall/network policy.
- Do not expose node_exporter to the public internet.
- Deny TCP `9100` by default and allow only Prometheus scraper hosts.
- Do not emit secrets, serial numbers, Borg repo URLs with credentials, SMART raw JSON, or root logs.
- Textfile metrics should be world-readable only if they contain sanitized numeric status.
- Disk probe script should run as root only if needed for device access; output remains sanitized.

Later hardening acceptance criteria:

- Node exporter is reachable only from approved Prometheus scraper hosts.
- Non-approved hosts cannot connect to TCP `9100`.

## Acceptance criteria

- `jellyhome`, `jellybase`, and `jellyberry` each expose node_exporter metrics for the first working pass.
- Each host exposes Borgmatic textfile metrics when status exists.
- Each host exposes standard filesystem metrics.
- Each host exposes custom disk health metrics, even if health is `unknown` on Pi/USB/microSD hardware.
- Pi-style hosts expose indirect early-warning metrics where supported, including read-only filesystem state, kernel storage error counts, undervoltage/throttling flags, USB reset counts, and tiny write/read probe health.
- Prometheus can scrape all three hosts.
- Setup is stage-based and operator-controlled.
- Future host onboarding is inventory-driven.
- OS bootstrap scripts include required packages.
- Docs explain limitations and verification steps.

## Remaining review questions

1. Should `jellybackup` be added to the node_exporter/disk-health monitoring rollout now?
   - Recommendation: yes soon, because it is the backup target.
2. Should TCP `9100` hardening be implemented as a new stage in this generator or a separate hardening generator?
   - Decision: optional `stage-07-configure-access-control.sh` in the generator, after first-pass visibility checks.
3. Which Grafana dashboards and Prometheus alert rules should be source-managed first?
   - Recommendation: backup freshness/failure, node_exporter scrape down, disk pressure, disk-health failure/unknown/stale, and Pi early-warning conditions.
