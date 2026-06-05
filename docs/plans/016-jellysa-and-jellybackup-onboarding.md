# Jellysa and Jellybackup Onboarding Plan

> **For Hermes:** Use home-network-operations and repository-development-discipline. Work directly on `main` for `/home/jellybot/home-network` under the standing home-network exception. Execute through tmux panes one command at a time.

**Goal:** Bring the Raspberry Pi host `jellysa` and existing backup host `jellybackup` into the source-managed home-network operations model.

**Architecture:** `home-network` remains source of truth for inventory, bootstrap scripts, monitoring rollout, and backup policy. Runtime hosts get only the minimum host-local state required: operator SSH access, packages, `/opt/docker` only when the host is intended to be a Docker host, and secrets outside Git. `jellybackup` remains the Borg destination and should not be treated as a Docker application host unless explicitly approved. `jellysa` is a remote South Africa node, so production access and monitoring should prefer Tailscale and use a lower scrape cadence than LAN hosts.

**Tech Stack:** Raspberry Pi OS/Debian 13, systemd, SSH, Tailscale, Borg/Borgmatic, Prometheus node_exporter, home-network inventory.

---

## Discovery snapshot

### jellysa

- Hostname: `jellysa`
- Production role: South Africa Tailscale host, backup/sync node, and exit-node candidate.
- Production access: Tailscale preferred; local LAN discovery address below is pre-relocation evidence only.
- LAN IPv4 observed during onboarding: `192.168.1.194`
- Tailnet DNS/IP: `jellysa.cheetah-iwato.ts.net` / `100.81.255.104`
- LAN IPv6: `2a00:23c8:a926:bb01::503`
- OS: Debian GNU/Linux 13 trixie on Raspberry Pi kernel `6.12.75+rpt-rpi-v8`
- Architecture: `aarch64`
- Active login pane: tmux pane `0:5`, user `jellyfish`
- Current access: interactive SSH works as `jellyfish`; passwordless SSH from the agent has been installed.
- Sudo status: `sudo -n` requires a password.
- Installed basics observed: `sudo` only from the precheck command list; no Docker/Tailscale/Borg/node_exporter found in PATH during precheck.
- Monitoring intent: node_exporter over Tailscale at a 5 minute scrape interval, not the local 15 second LAN cadence.

### jellybackup

- Hostname: `jellybackup`
- LAN IPv4: `192.168.1.75`
- Tailscale IPv4: `100.116.9.17`
- OS: Debian GNU/Linux 13 trixie on Raspberry Pi kernel `6.12.47+rpt-rpi-v8`
- Architecture: `aarch64`
- Active login pane: tmux pane `0:6`, user `jellyfish`
- Existing Borg SSH user: `jellybackup` works and Borg version is `1.4.3`.
- Sudo status: passwordless sudo works for `jellyfish`.
- External disk: `/home/jellybackup/externaldisk`, ext4, about 4.6T total, 2.4T used, 2.0T available.
- Resolved issue: root filesystem was effectively full: `/dev/mmcblk0p2` 59G with about 305M available before recovery; after cleanup it has about 52G available and is 7% used.
- Root filesystem hidden usage: about 52G existed under the unmounted-underlay path `/home/jellybackup/externaldisk/borg_store`, hidden by the mounted external disk. This likely happened when backups wrote to the mountpoint while the external disk was not mounted. The hidden data was copied to the real external disk recovery path and the hidden underlay copy was removed after approval.

## Non-goals / safety

- Do not delete hidden Borg data on `jellybackup` until it has either been copied/moved to the real external disk and verified, or the operator explicitly says it is safe to remove.
- Do not enable UFW on a host unless a backdoor path is verified and a host-specific firewall plan exists.
- Do not create `/opt/docker` on low-power/special-purpose nodes unless their role is confirmed as a Docker host.
- Do not print private SSH keys or backup passphrases.

## Proposed staged tasks

### Task 1: Confirm intended roles

**Objective:** Avoid turning `jellysa` or `jellybackup` into the wrong class of host.

**Resolved:**

- `jellysa` is a Tailscale-managed South Africa node.
- It should support backup/sync duties.
- It is an exit-node candidate.
- It should have monitoring, but at lower frequency than local LAN hosts.

**Still open:**

- Exact backup/sync paths and excludes.
- Whether `jellysa` should be Docker-capable or systemd-only.
- Whether `jellybackup` should get node_exporter/host monitoring only, or also a `jellybot` operator account and `/opt/docker` layout for source-managed helper scripts.

### Task 2: Establish durable SSH/operator access

**Objective:** Make future automation non-interactive without storing passwords.

**jellysa:**

- Add the local `jellybot` public key to `jellyfish` or `jellybot` authorized_keys.
- If `jellybot` should be an operator account, run `scripts/bootstrap-jellybot-operator` with sudo after sudo access is available.

**jellybackup:**

- Add the local `jellybot` public key to the appropriate operator account.
- Consider running `scripts/bootstrap-jellybot-operator --skip-github-key` if the host needs repo-managed helper scripts; keep it non-Docker if backup-target-only is preferred.

### Task 3: Fix jellybackup root filesystem before package rollout

**Objective:** Free the SD card safely.

**Evidence:** 52G hidden below the mounted external-disk mountpoint.

**Safe approach:**

1. Create a destination on the real external disk, e.g. `/home/jellybackup/externaldisk/recovered-root-underlay-20260605/`.
2. Use a root-bind view to access the hidden underlay source: `/tmp/rootfs-view/home/jellybackup/externaldisk/borg_store`.
3. Copy or move the hidden data to the real external disk.
4. Verify size and representative files.
5. Only then remove the hidden source if approved.
6. Verify `df -hT /` returns a healthy free-space value.

### Task 4: Register jellysa in inventory

**Objective:** Make `jellysa` visible to home-network scripts and dashboards.

**Files:**

- Modify: `inventory/hosts.yml`
- Modify if backed up: `inventory/backups.yml`
- Modify if served/monitored as a service host: `inventory/services.yml`

**Initial values to use:**

- `lan_ip: 192.168.1.194`
- `tailscale_ip: 100.81.255.104`
- roles pending confirmation.

### Task 5: Bring jellybackup into monitoring

**Objective:** Add node_exporter and disk-health visibility for the backup target.

**Prerequisite:** Root filesystem free space fixed.

**Steps:**

- Update `inventory/hosts.yml` so `jellybackup` is a `node-exporter-client` if monitoring is desired.
- Generate node_exporter rollout stages.
- Run install/configure/verify stages on `jellybackup` with sudo.
- Update Prometheus scrape config from generated config.
- Verify `up{monitored_host="jellybackup"}` and filesystem/disk metrics.

### Task 6: Roll out backup/sync and low-frequency monitoring for jellysa

**Objective:** Add remote-safe monitoring and backup/sync without treating a South Africa node like a LAN machine.

**Monitoring design:**

- Install node_exporter on `jellysa`.
- Scrape `100.81.255.104:9100` over Tailscale from jellybase Prometheus.
- Use a separate Prometheus scrape job with `scrape_interval: 5m` and `scrape_timeout: 30s`.
- Relabel the resulting metrics to `job="node_exporter"` so existing dashboards and alerts still apply.
- Do not add LAN firewall assumptions until the host's South Africa network posture is known.

**Potential backup sets:**

- Default first candidate: `/home/jellyfish` with explicit excludes once workload is known.
- If Docker host: `/opt/docker`, plus relevant repo paths.
- If systemd-only utility node: selected `/home/jellyfish` and service config paths.

## Current blockers

- `jellysa` needs sudo password entry or passwordless sudo/bootstrap before host packages and operator account can be installed.
- `jellysa` backup/sync paths and excludes still need confirmation before enabling Borgmatic timers.
- `jellybackup` external disk persistence in `/etc/fstab` is still pending; the safety layer blocked the first attempt to add the UUID-based fstab entry.

## Verification checklist

- [x] `jellysa` role confirmed.
- [x] `jellysa` passwordless SSH/operator path established.
- [ ] `jellysa` sudo/bootstrap completed or explicitly deferred.
- [ ] `jellysa` low-frequency Tailscale node_exporter scrape deployed and verified.
- [ ] `jellysa` backup/sync paths and excludes confirmed.
- [x] `jellybackup` hidden underlay data moved/recovered or explicitly removed.
- [x] `jellybackup` root filesystem has safe free space.
- [ ] `jellybackup` node_exporter installed/configured if approved.
- [ ] Prometheus scrapes `jellybackup` if monitoring was enabled.
- [ ] `inventory/hosts.yml` and `inventory/backups.yml` reflect live state.
