# Plan 015: Lightweight Storage Monitoring

## Goal

Add a lightweight storage monitoring setup for homelab disks and backup/storage paths, starting with `jellybase`, without introducing heavyweight indexing/search services.

## Scope

First target: `jellybase`; second rollout target: `jellyhome`.

Initial capabilities:

- filesystem capacity reports;
- mounted-storage inventory;
- lightweight folder-usage reports with `duc` where available;
- weekly duplicate reports with `czkawka_cli` where available;
- SMART/Scrutiny planning for locally attached disks;
- sanitized SMART health metrics for locally attached disks;
- Prometheus textfile metrics where node_exporter textfile collector is already present;
- operator runbook and report locations.

## Non-goals

- No automatic duplicate deletion.
- No modification of Borg repositories.
- No Elasticsearch/OpenSearch/Solr/Diskover stack.
- No public dashboard exposure.
- No high-frequency full-disk hashing.

## Current jellybase discovery

Discovery run via local tmux window `0:3` connected to `jellybase` as `jellyfish`.

Host:

- Hostname: `jellybase`
- LAN IP observed in login banner: `192.168.1.2`
- OS: Ubuntu 24.04.4 LTS
- Reboot currently required according to login banner.

Disks from `lsblk`:

- `/dev/sda`, 3.6T disk, model `ST4000DM000-1F21`; `/dev/sda1` ext4 mounted at `/mnt/4TB` after clean reformat for reuse.
- `/dev/sdb`, 1.8T disk, model `Hitachi HDS72202`; `/dev/sdb1` ext4 mounted at `/mnt/2TB`.
- `/dev/nvme0n1`, 931.5G disk, model `CT1000P310SSD8`; boot partitions plus LVM root.

Filesystems from `df -hT`:

- `/`: ext4, 98G size, 62G used, 31G free, 67% used.
- `/mnt/2TB`: ext4, 1.8T size, 1.6T used, 189G free, 90% used.
- `/mnt/4TB`: ext4, 3.6T size, 28K used, 3.4T free, 1% used.
- `/boot`: ext4, 2.0G size, 17% used.
- `/boot/efi`: vfat, 1.1G size, 1% used.

Mounted storage:

- `/dev/sdb1` on `/mnt/2TB`.
- `/dev/sda1` on `/mnt/4TB`, UUID `85f9285f-fa1d-4b65-830d-40bea4036aee`.
- No NFS/CIFS mounts observed in the discovery command output.

Candidate scan paths:

- `/mnt/2TB`
- `/mnt/4TB`
- `/opt/docker`
- limited OS-level reporting for `/`, `/boot`, `/boot/efi`

Top-level `/mnt/2TB` candidates observed:

- `/mnt/2TB/copy`
- `/mnt/2TB/USBbackup1`
- `/mnt/2TB/USBbackup2`
- `/mnt/2TB/lost+found`

Borg candidates:

- The simple `find` pattern found only application `data`/`config` directories under `/opt/docker/appdata`.
- No clear Borg repository was confirmed on jellybase from the initial non-sudo discovery.

Tool availability:

- `smartctl`: present at `/usr/sbin/smartctl`, but disk probes require elevated permissions.
- `borg`: present at `/usr/bin/borg`.
- `borgmatic`: present at `/usr/bin/borgmatic`.
- `duc`: not installed from `command -v`.
- `czkawka_cli`: not installed from `command -v`.

Permission notes:

- Active user in tmux: `jellyfish`.
- `sudo -n true` failed: sudo requires a password.
- SMART health checks cannot be completed from this pane without interactive sudo or another privileged route.

Existing runtime context:

- Main Compose project is `docker`, using `/opt/docker/docker-compose.yml` plus `/opt/docker/hosts/jellybase.yaml`.
- Existing monitoring stack is already present: Prometheus, Grafana, Loki, Alloy, Alertmanager, MQTT exporter, Homepage, Network Map.
- A second Compose project exists from `/home/jellylady/repo/home-network/docker/hosts/jellybase.yaml` for at least one running service; keep this in mind when avoiding drift.

## jellyhome rollout status

Discovery and rollout ran via tmux window `0:2` connected to `jellyhome` as `jellyfish` with sudo available.

Host:

- Hostname: `jellyhome`.
- LAN IP observed in login banner: `192.168.1.1`.
- OS: Ubuntu 24.04.4 LTS.
- Reboot currently required according to login banner after package/kernel updates.

Disks from `lsblk`/`smartctl --scan`:

- `/dev/sda`, 931.5G disk, model `CT1000BX500SSD1`; boot partitions plus LVM root.
- `/dev/sdb`, 4.5T disk, model `ST5000DM000-1FK1`; `/dev/sdb1` ext4 mounted at `/home/jellyfish/media/Primary_5TB`.
- `/dev/sdc`, 4.5T disk, model `ST5000DM000-1FK1`; `/dev/sdc1` ext4 mounted at `/home/jellyfish/media/Backup_5TB`.

Mounted storage observed:

- `/` on `/dev/mapper/ubuntu--vg-ubuntu--lv`.
- `/home/jellyfish/media/Primary_5TB` on `/dev/sdb1`, 72% used after scan refresh.
- `/home/jellyfish/media/Backup_5TB` on `/dev/sdc1`, 96% used after scan refresh.
- No `/mnt/*` or separate `/opt/docker` mount observed during rollout.
- The 5TB media mounts are configured in `/etc/fstab` by UUID with `nofail,x-systemd.device-timeout=10s`; root directories are owned by `jellyfish:jellyfish`, and write tests as `jellyfish` passed.

Verified runtime state:

- `duc` installed from Ubuntu packages.
- `czkawka_cli` 11.0.1 installed from the pinned repo-managed installer.
- Storage scan and duplicate scan units installed under `/etc/systemd/system`.
- `home-network-storage-scan.timer` and `home-network-duplicate-scan.timer` enabled.
- Manual storage scan succeeded and wrote `storage_monitoring.prom` plus `storage_smart.prom` into `/var/lib/node_exporter/textfile_collector`; after the media mounts, central Prometheus reports `Primary_5TB=72%` and `Backup_5TB=96%`.
- Scan scripts now choose host-aware default paths. jellyhome includes both 5TB media mounts plus `/opt/docker`; mountpoint guards prevent accidental scans of empty media directories if fstab/device mounting fails.
- Archived summary and duplicate reports have 90-day default retention via `REPORT_RETENTION_DAYS`.
- Central Prometheus on jellybase scrapes jellyhome storage metrics.
- Bounded duplicate scan of `/opt/docker` succeeded and generated a report; it was report-only.

SMART metrics verified for jellyhome:

- SMART health: `sda=1`, `sdb=1`, `sdc=1`.
- Temperatures: `sda=27C`, `sdb=34C`, `sdc=30C` at verification time.
- Filesystem usage: `/=38%`, `/boot/efi=1%`, `/boot=11%` at verification time.

## Proposed implementation shape

1. Source-manage scripts and docs in `/home/jellybot/home-network`.
2. Sync runtime files into `/opt/docker` using the existing `scripts/sync-docker-config` pattern.
3. Prefer systemd timers for host-level scans instead of root crontab.
4. Use a daily light scan for filesystem/duc/report freshness.
5. Use a weekly duplicate scan for `czkawka_cli` to avoid daily heavy hashing.
6. Add Scrutiny later only after privileged SMART probing confirms useful device support.
7. Add Prometheus textfile metrics if the node_exporter textfile collector path exists and is writable by the service/timer context.

## Acceptance criteria

- [x] Initial jellybase non-sudo discovery completed.
- [x] Storage-monitoring runbook exists.
- [x] Source-managed scan scripts exist.
- [x] Runtime report directory exists under `/opt/docker/appdata/storage-monitoring/reports`.
- [x] Daily capacity scan can be run manually and produces reports.
- [x] Weekly duplicate scan can be run manually or is explicitly deferred because `czkawka_cli` is missing.
- [x] Systemd timer/service units exist and are enabled.
- [x] Pinned `czkawka_cli` installer exists and verifies the GitHub release binary before installation.
- [x] First Czkawka duplicate report with the pinned binary is verified on jellybase.
- [x] SMART/Scrutiny deployment decision is based on privileged `smartctl` output.
- [x] Sanitized SMART metrics are emitted for jellybase disks without serial/model labels.
- [x] Storage Prometheus alert rules exist for SMART failures, sector-risk counters, disk temperature, and `/mnt/2TB` capacity thresholds.
- [x] Grafana Host Observability has storage panels for SMART health, temperature, risk counters, filesystem usage, and NVMe wear.
- [x] jellyhome storage scan and duplicate scan timers are installed and enabled.
- [x] jellyhome SMART and filesystem metrics are emitted locally and scraped centrally by jellybase Prometheus.
- [x] jellyhome first bounded duplicate report is verified against `/opt/docker`.
- [x] jellyhome 5TB media volumes are mounted by UUID in `/etc/fstab`, survive reboot path via `mount -av`/`findmnt --verify`, and are writable by `jellyfish`.
- [x] jellyhome media paths are included in host-aware storage/duplicate scan defaults without hardcoding them into other hosts.
- [x] jellyhome Backup_5TB alerting is tuned to avoid immediate noise at the known 96% baseline while still alerting on further growth.
- [x] Prometheus textfile metrics are emitted and scraped, if textfile collector exists.
- [x] No destructive cleanup actions are enabled.

## Next steps

1. Observe the real Alertmanager/Discord delivery path for the existing `/mnt/2TB` warning on jellybase.
2. Keep `/mnt/2TB` cleanup planning separate from this monitoring rollout.
3. After jellyhome's pending reboot, verify both 5TB media mounts return and the next storage scan still exports them.
4. Watch first full scheduled jellyhome duplicate scan duration/noise; keep it report-only and adjust exclusions if it is too heavy.
