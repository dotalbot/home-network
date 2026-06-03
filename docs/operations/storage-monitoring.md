# Storage Monitoring Runbook

Status: draft, jellybase discovery complete; implementation pending.

## Purpose

Provide lightweight visibility into homelab storage without deploying heavy search/indexing systems.

The stack should produce local text/JSON reports first, then expose selected safe metrics through Prometheus/Grafana.

## Safety rules

- Report only; do not delete duplicates automatically.
- Do not modify Borg repositories.
- Do not run frequent full-disk hashing.
- Keep dashboards LAN/Tailscale-only.
- Avoid indexing/search platforms such as Elasticsearch, OpenSearch, Solr, or Diskover.
- Avoid storing raw disk serials in Prometheus labels or public dashboards.

## jellybase inventory

Discovery date: 2026-06-03
Discovery method: non-sudo commands in tmux window `0:3`, SSH session to `jellybase` as `jellyfish`.

### Host

- Hostname: `jellybase`
- LAN IP observed: `192.168.1.2`
- OS observed: Ubuntu 24.04.4 LTS
- Existing Compose project: `/opt/docker/docker-compose.yml` + `/opt/docker/hosts/jellybase.yaml`

### Disks

| Device | Size | Type | Model | Mount/use |
|---|---:|---|---|---|
| `/dev/sda` | 3.6T | disk | `ST4000DM000-1F21` | no mounted partition observed |
| `/dev/sdb` | 1.8T | disk | `Hitachi HDS72202` | `/dev/sdb1` mounted at `/mnt/2TB` |
| `/dev/nvme0n1` | 931.5G | disk | `CT1000P310SSD8` | boot + LVM root |

### Filesystems

| Mount | Type | Size | Used | Available | Use |
|---|---|---:|---:|---:|---:|
| `/` | ext4 | 98G | 62G | 31G | 67% |
| `/mnt/2TB` | ext4 | 1.8T | 1.6T | 189G | 90% |
| `/boot` | ext4 | 2.0G | 297M | 1.5G | 17% |
| `/boot/efi` | vfat | 1.1G | 6.2M | 1.1G | 1% |

### Candidate scan paths

- `/mnt/2TB`
- `/opt/docker`
- root filesystem summary only for `/`

Top-level `/mnt/2TB` directories seen:

- `/mnt/2TB/copy`
- `/mnt/2TB/USBbackup1`
- `/mnt/2TB/USBbackup2`
- `/mnt/2TB/lost+found`

Suggested exclusions:

- `/mnt/2TB/lost+found`
- any confirmed Borg repository paths
- any transient/cache folders discovered later

### Borg repositories

No confirmed Borg repository was found by the initial shallow non-sudo discovery.

The command found application `data` and `config` directories under `/opt/docker/appdata`, but these are not enough to identify Borg repositories.

### Tool availability on jellybase

- `smartctl`: installed, but requires elevated permissions for device checks.
- `borg`: installed.
- `borgmatic`: installed.
- `duc`: not installed.
- `czkawka_cli`: not installed.

### Permission notes

- Active operator user: `jellyfish`.
- Non-interactive sudo is not available in the pane: `sudo -n true` requires a password.
- SMART probes failed with `Permission denied` for `/dev/sda`, `/dev/sdb`, and `/dev/nvme0n1`.

## Proposed report locations

Runtime reports:

```text
/opt/docker/appdata/storage-monitoring/reports
```

Runtime indexes/state:

```text
/opt/docker/appdata/storage-monitoring/duc
```

Source-managed scripts should live in the repo first, then sync to runtime.

## Proposed schedule

Daily light scan:

```text
03:20 daily
```

Contents:

- `df -hT`
- `lsblk`
- `duc` index/report if installed
- report freshness metadata
- optional Prometheus textfile metrics

Weekly duplicate scan:

```text
04:15 Sunday
```

Contents:

- `czkawka_cli dup` against selected scan paths if installed
- report only; no deletions

## Scrutiny / SMART status

Scrutiny should not be deployed until a privileged `smartctl` probe confirms which devices are useful.

Candidate devices based on `lsblk`:

- `/dev/sda`
- `/dev/sdb`
- `/dev/nvme0n1`

Current blocker:

- SMART checks need sudo/root access.

## Current recommendation

Start with reports and metrics, not Scrutiny:

1. Install/use `duc` for daily capacity/folder reports.
2. Install/use `czkawka_cli` for weekly duplicate reports.
3. Add systemd timers.
4. Add Prometheus textfile metrics if node_exporter collector path exists.
5. Return to Scrutiny after privileged SMART probing.

`/mnt/2TB` is already 90% full, so it should be the first target for folder-usage visibility.
