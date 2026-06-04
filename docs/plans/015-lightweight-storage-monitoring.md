# Plan 015: Lightweight Storage Monitoring

## Goal

Add a lightweight storage monitoring setup for homelab disks and backup/storage paths, starting with `jellybase`, without introducing heavyweight indexing/search services.

## Scope

First target: `jellybase`.

Initial capabilities:

- filesystem capacity reports;
- mounted-storage inventory;
- lightweight folder-usage reports with `duc` where available;
- weekly duplicate reports with `czkawka_cli` where available;
- SMART/Scrutiny planning for locally attached disks;
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
- [ ] First Czkawka duplicate report with the pinned binary is verified on jellybase.
- [ ] SMART/Scrutiny deployment decision is based on privileged `smartctl` output.
- [x] Prometheus textfile metrics are emitted and scraped, if textfile collector exists.
- [x] No destructive cleanup actions are enabled.

## Next steps

1. Install pinned `czkawka_cli` on jellybase with `scripts/install-czkawka-cli`.
2. Run and verify the first non-destructive duplicate report, starting with mounted paths only.
3. Use sudo in tmux window `0:3` for privileged `smartctl --scan` and per-device SMART probes.
4. Decide whether simple SMART textfile metrics are enough or whether Scrutiny is worth deploying.
5. Review whether `/mnt/2TB` at 90% needs an immediate alert threshold or cleanup planning.
