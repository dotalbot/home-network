# 012 — Seedit4.me Reverse Tunnel

Status: active

## Goal

Create a persistent fallback access path into `jellyberry` for networks that block Tailscale.

## Scope

- Establish a reverse SSH tunnel from `jellyberry` to `seedit4me@nl13.seedit4.me:2088`.
- Bind the remote reverse port to `127.0.0.1:22022` on seedit4.me.
- Forward that port to `127.0.0.1:22` on `jellyberry`.
- Store the seedit4me password as a host-local secret outside Git.
- Manage persistence with a systemd service.
- Add required package support to the Pi bootstrap path.

## Non-goals

- Do not expose the reverse port publicly on seedit4.me.
- Do not publish Homepage, Network Map, Grafana, Loki, Prometheus, Docker, or other dashboards through this tunnel.
- Do not commit passwords or generated secret files.
- Do not replace Tailscale; this is a fallback path.

## Progress checklist

- [x] Decide remote tunnel port: `22022`.
- [x] Decide authentication path: password-based via host-local secret, `sshpass`, and `autossh` supervision.
- [x] Add source-managed systemd unit.
- [x] Add install/verify script.
- [x] Add operations runbook.
- [x] Add bootstrap package requirement.
- [x] Require pinned SSH host key before password auth.
- [ ] Operator stores password at `/opt/docker/.secrets/seedit4me/ssh_password`.
- [ ] Install package/service on `jellyberry`.
- [ ] Verify remote loopback port opens on seedit4.me.
- [ ] Verify restricted-network connection flow.

## Acceptance criteria

- `systemctl status home-network-seedit4me-reverse-tunnel.service` is active on `jellyberry`.
- From seedit4.me, `127.0.0.1:22022` accepts an SSH connection to `jellyberry`.
- The tunnel restarts automatically after SSH/network failure and after reboot.
- The password is never printed, committed, or stored in environment variables.
