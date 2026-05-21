# Borg/Borgmatic Host Rollout

Status: draft
Last updated: 2026-05-21

## Purpose

Complete Borg/Borgmatic setup across the in-scope home-network hosts and verify that primary backups land on `jellybackup` over the LAN.

## Current known facts

- Primary backup target: `jellybackup`
- Target LAN IP: `192.168.1.75`
- Use the LAN IP in Borg/Borgmatic repository URLs.
- Do not use the FQDN for backup traffic because it resolves over Tailscale and is too taxing on the Raspberry Pi backup host.
- `ssh-copy-id` has already been completed from:
  - `jellyhome`
  - `jellybase`
  - `jellyberry`
- Destination repository directories already exist on `jellybackup`, one per server.

## In-scope hosts

Primary clients:

- `jellyhome`
- `jellybase`
- `jellyberry`

Backup server:

- `jellybackup` at `192.168.1.75`

Optional/future:

- `seedbox`, if it remains in backup scope

## Repository URL rule

Use this shape from each client:

```text
ssh://<backup-user>@192.168.1.75/<absolute/path/to/server-specific/repo>
```

Do not use:

```text
ssh://<backup-user>@jellybackup.../<repo>
ssh://<backup-user>@<tailscale-name-or-magicdns>/<repo>
```

Reason: FQDN/MagicDNS paths may route over Tailscale instead of LAN and overload the Pi backup host.

## Host-by-host rollout checklist

For each client host:

1. Confirm SSH connectivity to `192.168.1.75`.
2. Confirm the server-specific destination repo path exists on `jellybackup`.
3. Confirm Borg is installed.
4. Confirm Borgmatic is installed.
5. Create or verify Borgmatic config.
6. Ensure repository URL uses `192.168.1.75`.
7. Configure retention policy.
8. Configure passphrase/credential handling outside git.
9. Run a dry-run or info check.
10. Run the first backup.
11. List archives from the client.
12. Verify the archive appears under the expected destination repo.
13. Enable and verify the timer/schedule.
14. Record the verified repo path and schedule in inventory/docs.

## Suggested per-host verification commands

Run on each client host, adjusting user and repo path once confirmed:

```bash
ssh <backup-user>@192.168.1.75 'hostname && pwd'
borg --version
borgmatic --version
borgmatic config validate
borgmatic info
borgmatic list
systemctl list-timers '*borg*' --all
```

If using system-level Borgmatic timers:

```bash
systemctl status borgmatic.timer
systemctl status borgmatic.service
```

If using user-level Borgmatic timers:

```bash
systemctl --user status borgmatic.timer
systemctl --user status borgmatic.service
```

## Data to confirm before writing final configs

For each client host, confirm:

| Host | Backup repo path on jellybackup | Backup user | Include paths | Exclude paths | Timer/schedule |
| --- | --- | --- | --- | --- | --- |
| jellyhome | TBD | TBD | `/opt/docker`, relevant repos/data | caches/logs/temp | TBD |
| jellybase | TBD | TBD | `/opt/docker`, relevant repos/data | caches/logs/temp | TBD |
| jellyberry | TBD | TBD | `/opt/docker`, Hermes/runtime appdata as needed | caches/logs/temp | TBD |

## Acceptance criteria

- Every in-scope client uses `192.168.1.75` in Borg/Borgmatic repository URLs.
- Every in-scope client can connect to `jellybackup` without password prompts.
- Every in-scope client has Borg and Borgmatic installed.
- Every in-scope client has validated Borgmatic config.
- Every in-scope client has completed one successful backup.
- Every in-scope client can list its archives.
- Every in-scope client has a timer/schedule enabled or an explicitly documented reason not to.
- `just borg-check` or a host-specific equivalent passes.

## Next action

Discover the exact destination repository paths and backup user on `jellybackup`, then generate host-specific Borgmatic configs for `jellyhome`, `jellybase`, and `jellyberry`.
