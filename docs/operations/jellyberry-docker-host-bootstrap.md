# Jellyberry Docker Host Bootstrap

## Purpose

Prepare `jellyberry` to use the same Git-backed `/opt/docker` deployment pattern already used for `jellyhome` and `jellybase`.

The model stays the same:

```text
home-network repo = source of truth
/opt/docker       = live runtime/deploy directory
Docker Compose    = service runtime
```

## One-time setup commands

Run these on `jellyberry` as a sudo-capable user.

```bash
sudo mkdir -p /opt/docker/{appdata,hosts,.secrets}

sudo groupadd dockerops || true
sudo usermod -aG dockerops jellybot

sudo chown -R root:dockerops /opt/docker
sudo chmod -R g+rwX /opt/docker
sudo find /opt/docker -type d -exec chmod g+s {} \;
sudo chmod 770 /opt/docker/.secrets
```

Create the required Compose env file:

```bash
sudo tee /opt/docker/.env >/dev/null <<'EOF'
TZ=Europe/London
EOF

sudo chown root:dockerops /opt/docker/.env
sudo chmod 660 /opt/docker/.env
```

Important: log out and back in, or reboot, if `id jellybot` does not show `dockerops` after `usermod`.

## Verify access

```bash
ls -ld /opt/docker /opt/docker/appdata /opt/docker/hosts /opt/docker/.secrets
id jellybot
```

Expected shape:

```text
/opt/docker is owned by root:dockerops
/opt/docker/.secrets is root:dockerops with mode 770
jellybot is a member of dockerops
```

After this, `scripts/sync-docker-config` should be able to write managed config/appdata without sudo because the `dockerops` group owns `/opt/docker`.

## Deploy the Network Map from the repo

From the repo on `jellyberry`:

```bash
cd /home/jellybot/home-network
just network-map-render
just sync-docker-config
just compose-config
just up network-map
```

Or use the full Homepage/update workflow:

```bash
cd /home/jellybot/home-network
just homepage-deploy
```

## Verify the live service

```bash
docker ps --filter name=network-map
curl -fsS http://localhost:8788 >/dev/null
curl -fsS http://localhost:8788/data/inventory.json >/dev/null
```

Browser URL:

```text
http://jellyberry:8788
```

## Permission gremlin encountered

During the jellyberry setup, `jellybot` was correctly added to `dockerops`, but `just sync-docker-config` still asked for sudo.

The issue was directory mode, not group membership:

```text
/opt/docker was root:dockerops but not group-writable
```

Bad shape:

```text
drwxr-sr-x root dockerops /opt/docker
```

Good shape:

```text
drwxrwsr-x root dockerops /opt/docker
```

Fix:

```bash
sudo chmod -R g+rwX /opt/docker
sudo find /opt/docker -type d -exec chmod g+s {} \;
sudo chmod 770 /opt/docker/.secrets
sudo chmod 660 /opt/docker/.env
```

Re-test:

```bash
test -w /opt/docker && echo "writable" || echo "not writable"
```

## Reusable host setup

For the complete reusable checklist for any new Docker host, see:

```text
docs/operations/docker-host-bootstrap.md
```

## Security note

Access to `/opt/docker` plus Docker command access is effectively root-equivalent. Keep `dockerops` limited to trusted admin users only.

The Network Map publishes LAN/Tailscale inventory details on port `8788`, including hostnames, IPs, MAC addresses, open ports, and management-surface hints. Treat it as trusted-LAN/Tailnet-only until an auth/reverse-proxy layer exists.

The `/opt/docker/appdata/homepage` and `/opt/docker/appdata/network-map` paths are repo-managed. The sync script uses `rsync --delete`; do not place manual-only files in those directories.