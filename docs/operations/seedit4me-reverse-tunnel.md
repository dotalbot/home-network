# Seedit4.me Reverse SSH Tunnel

## Purpose

Provide an emergency remote-access path to `jellyberry` when Tailscale is blocked by a network.

The tunnel is intentionally narrow:

```text
jellyberry:22
  -> persistent SSH connection to seedit4.me
  -> seedit4.me loopback port 127.0.0.1:22022
```

You first SSH to seedit4.me, then connect back through the loopback-only reverse port.

## Runtime host

- Local host: `jellyberry`
- Local service user: `jellybot`
- Remote SSH endpoint: `seedit4me@nl13.seedit4.me:2088`
- Remote reverse port: `127.0.0.1:22022`
- Local target: `127.0.0.1:22`

## Managed files

Source-managed:

```text
systemd/home-network-seedit4me-reverse-tunnel.service
scripts/install-seedit4me-reverse-tunnel
bootstrap/bootstrap-pi.sh
```

Host-local secret, not in Git:

```text
/opt/docker/.secrets/seedit4me/ssh_password
```

The secret file contains only the seedit4me SSH password. Do not paste the password into chat, shell history, Git, logs, or docs.

## Install

On `jellyberry`, from the repo:

```bash
cd /home/jellybot/home-network
sudo install -d -m 0770 -o root -g dockerops /opt/docker/.secrets/seedit4me
sudo install -m 0640 -o root -g dockerops /dev/null /opt/docker/.secrets/seedit4me/ssh_password
sudo nano /opt/docker/.secrets/seedit4me/ssh_password
sudo chown root:dockerops /opt/docker/.secrets/seedit4me/ssh_password
sudo chmod 0640 /opt/docker/.secrets/seedit4me/ssh_password
./scripts/install-seedit4me-reverse-tunnel
```

The installer installs `sshpass`, confirms the secret is readable by `jellybot`, requires a pinned SSH host key in `/home/jellybot/.ssh/known_hosts`, copies the systemd unit into `/etc/systemd/system/`, enables it, starts it, and verifies that seedit4.me can see the reverse port.

The current observed ED25519 host-key fingerprint for `nl13.seedit4.me:2088` from this setup session is:

```text
SHA256:f+lTqShffAxrW96d8Gospx/EWJpEd3k5WA+ieVb47vg
```

Verify that fingerprint out-of-band before trusting a fresh rebuilt host. The service uses `StrictHostKeyChecking=yes` so the password is not sent to an unpinned host key.

## Connect from a restricted network

Step 1: connect to seedit4.me:

```bash
ssh -p2088 seedit4me@nl13.seedit4.me
```

Step 2: from the seedit4.me shell, connect through the tunnel back to `jellyberry`:

```bash
ssh -p22022 jellybot@127.0.0.1
```

## Verify on jellyberry

```bash
systemctl status home-network-seedit4me-reverse-tunnel.service --no-pager
systemctl status home-network-seedit4me-tunnel-healthcheck.timer --no-pager
journalctl -u home-network-seedit4me-reverse-tunnel.service -n 80 --no-pager
journalctl -u home-network-seedit4me-tunnel-healthcheck.service -n 80 --no-pager
```

The healthcheck timer writes Prometheus textfile metrics to:

```text
/var/lib/node_exporter/textfile_collector/home_network_seedit4me_tunnel.prom
```

Prometheus alerts route through the existing Alertmanager -> Discord path:

- `Seedit4meReverseTunnelDown`
- `Seedit4meReverseTunnelHealthcheckStale`

Verify the textfile metrics locally:

```bash
sudo /home/jellybot/home-network/scripts/seedit4me-tunnel-healthcheck
curl -fsS http://127.0.0.1:9100/metrics | grep home_network_seedit4me_tunnel
```

Verify the alert rules from Prometheus on `jellybase`:

```bash
curl -fsG --data-urlencode 'query=home_network_seedit4me_tunnel_success{host="jellyberry"}' http://127.0.0.1:9090/api/v1/query
curl -fsS http://127.0.0.1:9090/api/v1/rules | grep Seedit4meReverseTunnel
```

Verify the remote loopback port without printing the password:

```bash
sshpass -f /opt/docker/.secrets/seedit4me/ssh_password \
  ssh -p2088 \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/home/jellybot/.ssh/known_hosts \
  -o PubkeyAuthentication=no \
  -o PreferredAuthentications=password,keyboard-interactive \
  seedit4me@nl13.seedit4.me \
  "timeout 5 bash -lc '</dev/tcp/127.0.0.1/22022' && echo tunnel-open"
```

## Restart / stop

```bash
sudo systemctl restart home-network-seedit4me-reverse-tunnel.service
sudo systemctl stop home-network-seedit4me-reverse-tunnel.service
sudo systemctl disable home-network-seedit4me-reverse-tunnel.service
```

## Security notes

- The remote port is bound to `127.0.0.1` on seedit4.me, not all remote interfaces.
- The tunnel exposes only SSH on `jellyberry`, not dashboards or Docker sockets.
- The systemd service uses `sshpass -f` so the password is read from a root/dockerops-controlled file rather than command-line arguments or environment variables.
- The persistent process is `autossh -M 0` under systemd, with SSH keepalives and `Restart=always` as a second safety net.
- Reconnect behaviour is intentionally polite to the remote host:
  - SSH keepalives detect a dead tunnel after roughly 90 seconds (`ServerAliveInterval=30`, `ServerAliveCountMax=3`).
  - `autossh` has `AUTOSSH_GATETIME=30`, so immediate repeated startup failures bubble back to systemd instead of tight-looping.
  - systemd waits at least 60 seconds before restarting, then uses `RestartSteps=6` up to `RestartMaxDelaySec=10min` on repeated failures.
  - `StartLimitBurst=10` over `StartLimitIntervalSec=3600` prevents endless rapid retries during a bad outage or auth/provider problem.
- If seedit4.me supports SSH keys later, replace password auth with a dedicated key and remove the password secret.
