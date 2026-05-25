# Node Exporter and Disk Health Rollout Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task after user review/approval.

**Goal:** Add generic stage-based node_exporter setup and disk health telemetry for `jellyhome`, `jellybase`, and `jellyberry`, with future-host support from inventory. First-pass rollout is implemented and visible in Prometheus; the access-control stage is generated, while live hardening application/negative verification and future dashboard/alert improvements remain follow-up work.

**Architecture:** Keep monitoring rollout separate from Borgmatic repository setup. Generate per-host staged scripts from inventory. Install node_exporter and disk-health tooling on the host OS, write sanitized disk-health metrics via node_exporter textfile collector, and let Prometheus scrape each host.

**Tech Stack:** Bash, Python 3, PyYAML, systemd, prometheus-node-exporter, smartmontools, nvme-cli, lsblk/util-linux, Prometheus textfile collector.

---

## Scope

In scope:

- Implementation is happening task-by-task after review, starting with repo-only inventory and bootstrap changes.
- Later implementation should add a generator for node_exporter rollout stages.
- Later implementation should update bootstrap scripts to install required packages.
- Later implementation should add disk health probe script and timer.
- Later implementation should document Prometheus scrape targets and verification.

Out of scope for this review draft:

- Running additional node_exporter setup beyond the first-pass host rollout already completed.
- Applying node_exporter access-control hardening rules on live hosts; this plan now defines the generated stage, but runtime application remains operator-controlled.
- Adding Grafana dashboards.
- Adding alertmanager routes.

## Proposed implementation tasks after approval

### Task 1: Add monitoring inventory defaults

Status: implemented in `inventory/hosts.yml`, `scripts/host-monitoring-policy-check`, and `just host-monitoring-policy-check`.

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

Status: implemented in `bootstrap/bootstrap-ubuntu.sh`, `bootstrap/bootstrap-pi.sh`, and `docs/runbooks/rebuild-ubuntu-host.md`.

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
apt-get install -y prometheus-node-exporter smartmontools nvme-cli util-linux usbutils hdparm mmc-utils sysstat
# Also install whichever package provides vcgencmd on that distro, usually raspi-utils or libraspberrypi-bin.
```

**Verification:**

Note: distro packages may enable/start `prometheus-node-exporter` immediately on a freshly bootstrapped host. That is acceptable for the first-visibility pass, but port `9100` hardening remains a tracked follow-up before treating the endpoint as locked down.

```bash
bash -n bootstrap/bootstrap-ubuntu.sh bootstrap/bootstrap-pi.sh
```

### Task 3: Create node_exporter rollout generator

Status: implemented in `scripts/node-exporter-rollout-generate` and `just node-exporter-rollout-generate`.

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

**First working pass:** get node_exporter, backup textfile metrics, filesystem metrics, and disk-health textfile metrics working first. Access-control hardening is tracked as a follow-up task below so firewall changes do not block initial visibility.

**Verification:**

```bash
python3 -m py_compile scripts/node-exporter-rollout-generate
scripts/node-exporter-rollout-generate
bash -n /tmp/node-exporter-rollout-jellyhome/stage-*.sh
bash -n /tmp/node-exporter-rollout-jellybase/stage-*.sh
bash -n /tmp/node-exporter-rollout-jellyberry/stage-*.sh
```

### Task 4: Add sanitized disk health probe

Status: implemented through the generated stage scripts and live textfile metrics on `jellyhome`, `jellybase`, and `jellyberry`.

**Objective:** Write numeric disk-health metrics without leaking serial numbers or raw SMART JSON.

**Files:**
- Generated runtime target: `/usr/local/sbin/home-network-disk-health-prometheus`
- Source template location to decide during implementation, likely `scripts/templates/` or embedded in generator.

**Behavior:**

- Use `smartctl --scan-open`.
- Use `smartctl -H -A -j` for supported devices.
- Try safe USB bridge modes such as `sat`, `scsi`, and `auto` when a Pi uses USB storage and normal discovery fails.
- Use `nvme smart-log --output-format=json` for NVMe devices.
- Try `mmc extcsd read` for MMC/eMMC devices where supported, but treat unsupported consumer microSD as `unknown`.
- Emit explicit unknown metrics when device health cannot be determined.
- Add Pi indirect early-warning metrics where available:
  - read-only filesystem state;
  - recent kernel I/O/filesystem error counts;
  - USB storage reset/disconnect counts;
  - `vcgencmd get_throttled` undervoltage/throttling bits;
  - temperature where node_exporter thermal zones are insufficient;
  - tiny safe write/read sanity probe success and latency.
- Write atomically to `/var/lib/node_exporter/textfile_collector/disk_health.prom`.

**Verification:**

```bash
sudo /usr/local/sbin/home-network-disk-health-prometheus
curl -fsS http://127.0.0.1:9100/metrics | grep home_network_disk_health
```

### Task 5: Add systemd timer for disk health probe

Status: implemented through the generated stage scripts and producing fresh Prometheus metrics on the first-pass hosts.

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

Status: implemented in `docs/operations/node-exporter-disk-health.md`, `docs/README.md`, root `README.md`, and this roadmap refresh. Prometheus currently scrapes the first-pass hosts under job `node_exporter`.

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
- Pi SMART limitations and indirect early-warning signals;
- systemd overwrite guards;
- Prometheus label correctness.

## Deferred hardening task: restrict node_exporter scrape access

**Objective:** After initial metrics are working, restrict TCP `9100` so only approved scraper hosts can access node_exporter.

**Staged implementation status:** The rollout generator now emits `stage-07-configure-access-control.sh` for each node_exporter host. The stage uses inventory `allowed_scrapers` plus each scraper host `lan_ip`, applies UFW allow/deny rules only when UFW is already active, and otherwise prints exact recommended UFW policy without enabling or rewriting firewall state.

**Runtime attempt on 2026-05-25:** Stage 07 was executed with sudo on `jellybase`, `jellyhome`, and `jellyberry`. All three hosts reported `Status: inactive` from UFW, so the generated stage intentionally made no firewall changes and printed the reviewed policy instead. Post-attempt Prometheus verification still returned `up{job="node_exporter"} == 1` for `jellyhome:9100`, `jellyberry:9100`, and `host.docker.internal:9100`; TCP `9100` from `jellyberry` to `192.168.1.1`, `192.168.1.2`, and `192.168.1.159` still connected, so negative verification has not passed and runtime hardening remains incomplete until the operator explicitly chooses UFW activation or equivalent nftables/iptables rules.

**Default policy:**

```text
allow TCP 9100 from jellybase / Prometheus host
deny TCP 9100 from everything else
```

**Implementation notes:**

- Use generated `stage-07-configure-access-control.sh`; keep it optional and after first visibility so scraper access is not broken during bootstrap.
- Use inventory-driven allowed scraper metadata, with `jellybase` as the default Prometheus scraper.
- Prefer UFW when active.
- If UFW is inactive, do not silently rewrite firewall policy; print the exact recommended UFW intent plus equivalent nftables/iptables policy guidance and require explicit approval for mutation.
- On `jellybase`, account for Prometheus running locally/in Docker by allowing `127.0.0.1` and the selected Docker/host-gateway path only if needed.

**Verification:**

```bash
# From jellybase, verify remote scrape works for each target.
# From a non-approved host, verify TCP 9100 is blocked or refused.
```

## Current repository state after first-pass rollout

- Repository workflow: direct commits to `main` for this project only.
- Source of truth remains this repo, with runtime copies deployed to the managed hosts.
- Prometheus ready endpoint answers on `jellybase:9090`.
- Grafana health endpoint answers on `jellybase:3001`.
- `jellyhome:9100`, `jellybase:9100`, and `jellyberry:9100` answer node_exporter metrics.
- Prometheus query `up{job="node_exporter"}` returns three healthy targets.
- Prometheus query `home_network_disk_health_last_run_timestamp_seconds` returns all three host labels.
- Prometheus query `borgmatic_last_run_success` returns all three host labels.

## Remaining review decisions for follow-up implementation

Please choose/confirm:

1. Add `jellybackup` to node_exporter/disk-health monitoring now that the first three hosts work?
   - Recommendation: yes soon, because it is the backup target.
2. How should TCP `9100` be hardened on each host?
   - Decision: staged allowlist with `jellybase`/Prometheus as the approved scraper path, using UFW only where active and printing reviewed UFW guidance otherwise.
3. Which Prometheus alert rules and Grafana dashboards should be source-managed first?
   - Recommendation: backup success/staleness, disk pressure, disk-health failure/unknown/stale, and host scrape down.
