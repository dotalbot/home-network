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
journalctl -u home-network-seedit4me-reverse-tunnel.service -n 80 --no-pager
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
- If seedit4.me supports SSH keys later, replace password auth with a dedicated key and remove the password secret.
