# Node Exporter and Disk Health Rollout Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task after user review/approval.

**Goal:** Add generic stage-based node_exporter setup and disk health telemetry for `jellyhome`, `jellybase`, and `jellyberry`, with future-host support from inventory.

**Architecture:** Keep monitoring rollout separate from Borgmatic repository setup. Generate per-host staged scripts from inventory. Install node_exporter and disk-health tooling on the host OS, write sanitized disk-health metrics via node_exporter textfile collector, and let Prometheus scrape each host.

**Tech Stack:** Bash, Python 3, PyYAML, systemd, prometheus-node-exporter, smartmontools, nvme-cli, lsblk/util-linux, Prometheus textfile collector.

---

## Scope

In scope:

- Plan/spec only in this branch until reviewed.
- Later implementation should add a generator for node_exporter rollout stages.
- Later implementation should update bootstrap scripts to install required packages.
- Later implementation should add disk health probe script and timer.
- Later implementation should document Prometheus scrape targets and verification.

Out of scope for this review draft:

- Running node_exporter setup on the hosts.
- Changing Prometheus live config.
- Adding Grafana dashboards.
- Adding alertmanager routes.

## Proposed implementation tasks after approval

### Task 1: Add monitoring inventory defaults

**Objective:** Make monitored hosts discoverable from inventory.

**Files:**
- Modify: `inventory/hosts.yml`
- Modify or create: `scripts/host-monitoring-policy-check`
- Modify: `justfile`

**Steps:**
1. Add `node-exporter-client` role to `jellyhome`, `jellybase`, and `jellyberry`.
2. Add optional `monitoring` metadata for node_exporter defaults.
3. Add validation that any `node-exporter-client` host has a scrape host/port or can derive defaults.
4. Run validation.

### Task 2: Add OS package requirements to bootstrap scripts

**Objective:** Ensure fresh OS rebuilds include node_exporter and disk health tools.

**Files:**
- Modify: `bootstrap/bootstrap-ubuntu.sh`
- Modify: `bootstrap/bootstrap-pi.sh`
- Modify: `docs/runbooks/rebuild-ubuntu-host.md`

**Packages:**

Ubuntu:

```bash
apt-get install -y prometheus-node-exporter smartmontools nvme-cli util-linux
```

Pi/Debian:

```bash
apt-get install -y prometheus-node-exporter smartmontools nvme-cli util-linux usbutils hdparm
```

**Verification:**

```bash
bash -n bootstrap/bootstrap-ubuntu.sh bootstrap/bootstrap-pi.sh
```

### Task 3: Create node_exporter rollout generator

**Objective:** Generate operator-controlled staged scripts for each monitored host.

**Files:**
- Create: `scripts/node-exporter-rollout-generate`
- Modify: `justfile`

**Generated directory:**

```text
/tmp/node-exporter-rollout-<host>/
```

**Generated stages:**

```text
stage-00-preflight.sh
stage-01-install-packages.sh
stage-02-configure-node-exporter.sh
stage-03-install-disk-health-probe.sh
stage-04-enable-disk-health-timer.sh
stage-05-verify-local-metrics.sh
stage-06-prometheus-target-note.sh
```

**Verification:**

```bash
python3 -m py_compile scripts/node-exporter-rollout-generate
scripts/node-exporter-rollout-generate
bash -n /tmp/node-exporter-rollout-jellyhome/stage-*.sh
bash -n /tmp/node-exporter-rollout-jellybase/stage-*.sh
bash -n /tmp/node-exporter-rollout-jellyberry/stage-*.sh
```

### Task 4: Add sanitized disk health probe

**Objective:** Write numeric disk-health metrics without leaking serial numbers or raw SMART JSON.

**Files:**
- Generated runtime target: `/usr/local/sbin/home-network-disk-health-prometheus`
- Source template location to decide during implementation, likely `scripts/templates/` or embedded in generator.

**Behavior:**

- Use `smartctl --scan-open`.
- Use `smartctl -H -A -j` for supported devices.
- Use `nvme smart-log --output-format=json` for NVMe devices.
- Emit explicit unknown metrics when device health cannot be determined.
- Write atomically to `/var/lib/node_exporter/textfile_collector/disk_health.prom`.

**Verification:**

```bash
sudo /usr/local/sbin/home-network-disk-health-prometheus
curl -fsS http://127.0.0.1:9100/metrics | grep home_network_disk_health
```

### Task 5: Add systemd timer for disk health probe

**Objective:** Run disk health probe periodically without relying on cron.

**Files:**
- Generated runtime target: `/etc/systemd/system/home-network-disk-health.service`
- Generated runtime target: `/etc/systemd/system/home-network-disk-health.timer`

**Safety:**

- Refuse to overwrite existing managed files unless `ALLOW_OVERWRITE_DISK_HEALTH_TIMER=1` is set.
- Use `RandomizedDelaySec` to avoid all hosts probing at the same second.

**Verification:**

```bash
systemctl list-timers '*disk-health*' --all --no-pager
systemctl status home-network-disk-health.timer --no-pager
```

### Task 6: Add Prometheus scrape target documentation

**Objective:** Make it obvious how metrics flow into Prometheus on `jellybase`.

**Files:**
- Create: `docs/operations/node-exporter-disk-health.md`
- Modify: `docs/README.md`
- Modify: `docs/roadmap/product-roadmap.md`

**Verification:**

```bash
git diff --check
```

### Task 7: Run independent review before host rollout

**Objective:** Catch operational/security issues before sudo scripts run.

**Review focus:**

- node_exporter exposure boundaries;
- root script safety;
- disk serial/privacy leakage;
- Pi SMART limitations;
- systemd overwrite guards;
- Prometheus label correctness.

## Review decision needed before implementation

Please choose/confirm:

1. Install method: apt/system package vs Docker container.
   - Recommended: apt/system package.
2. Disk health timer cadence: 30 minutes, hourly, or daily.
   - Recommended: hourly.
3. Include `jellybackup` now or after the first three hosts.
   - Recommended: after first three, then add `jellybackup` because it is critical.
4. Prometheus target addressing: hostnames vs LAN IPs.
   - Recommended: hostnames first, fallback to LAN IPs if DNS/routing misbehaves.
