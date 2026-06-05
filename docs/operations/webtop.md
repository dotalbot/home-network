# Webtop desktops

## Purpose

`webtop-jellybase` and `webtop-jellyhome` provide browser-accessible LinuxServer Webtop desktops for trusted LAN/Tailscale use.

Image:

- `home-network-webtop-cleanup:latest`

This is a source-managed local image built from `docker/webtop-cleanup/Dockerfile`, which inherits from `lscr.io/linuxserver/webtop:latest` and adds the disk-cleanup tools used by the Webtop desktop sessions.

Default additional tools in the custom image:

- Krokiet `11.0.1` as `/usr/local/bin/krokiet` and `/usr/local/bin/czkawka-gui`; Krokiet is the actively developed Czkawka GUI frontend.
- `ncdu`
- `duf`
- `mc`
- `ranger`
- `rsync`
- `tree`
- `jq`
- `p7zip-full`
- `unzip`
- `zip`

## Access

Use HTTPS. The container uses a self-signed certificate by default, so browsers will show a certificate warning unless this is later placed behind a trusted reverse proxy.

- jellybase LAN: `https://192.168.1.2:30301`
- jellybase Tailscale: `https://100.125.86.118:30301`
- jellyhome LAN: `https://192.168.1.1:30301`
- jellyhome Tailscale: `https://100.90.175.59:30301`

Authentication:

- Username: `dominic`
- Passwords are generated per host and stored outside Git:
  - jellybase: `/opt/docker/.secrets/webtop-jellybase/password`
  - jellyhome: `/opt/docker/.secrets/webtop-jellyhome/password`

Do not commit or paste the password values into Git, docs, logs, or chat.

## Source of truth

Compose services are managed by this repository:

- `docker/hosts/jellybase.yaml`
- `docker/hosts/jellyhome.yaml`
- `docker/webtop-cleanup/Dockerfile`

Runtime copies are deployed under `/opt/docker` by `just sync-docker-config`.

Persistent appdata:

- jellybase: `/opt/docker/appdata/webtop-jellybase/config`
- jellyhome: `/opt/docker/appdata/webtop-jellyhome/config`

Backup class: `appdata`.

## Security posture

LinuxServer's Webtop documentation warns that this container exposes an interactive browser desktop and can include powerful tools inside the container. Treat it as a trusted-LAN/Tailscale-only service.

Initial deployment intentionally uses a hardened profile:

- `HARDEN_DESKTOP=true`
- `START_DOCKER=false`
- `SELKIES_USE_BROWSER_CURSORS=true` to reduce pointer lag by using the browser's native cursor
- no Docker socket is mounted
- no privileged mode is used
- no GPU passthrough
- no `seccomp=unconfined`
- bind ports only to LAN and Tailscale host IPs, not `0.0.0.0`

If the hardened desktop is too restrictive, loosen settings deliberately in a follow-up change after testing.

## Secret/appdata bootstrap

Before the first `docker compose up`, create the host-local secret and appdata paths. Do this on the matching target host only.

jellybase:

```bash
sudo install -d -m 0750 -o root -g dockerops /opt/docker/.secrets/webtop-jellybase
sudo install -d -m 0755 -o 1000 -g 1000 /opt/docker/appdata/webtop-jellybase/config
sudo sh -c 'test -s /opt/docker/.secrets/webtop-jellybase/password || openssl rand -base64 24 > /opt/docker/.secrets/webtop-jellybase/password'
sudo chown root:dockerops /opt/docker/.secrets/webtop-jellybase/password
sudo chmod 0640 /opt/docker/.secrets/webtop-jellybase/password
```

jellyhome:

```bash
sudo install -d -m 0750 -o root -g dockerops /opt/docker/.secrets/webtop-jellyhome
sudo install -d -m 0755 -o 1000 -g 1000 /opt/docker/appdata/webtop-jellyhome/config
sudo sh -c 'test -s /opt/docker/.secrets/webtop-jellyhome/password || openssl rand -base64 24 > /opt/docker/.secrets/webtop-jellyhome/password'
sudo chown root:dockerops /opt/docker/.secrets/webtop-jellyhome/password
sudo chmod 0640 /opt/docker/.secrets/webtop-jellyhome/password
```

## Deployment

Commit/push the source changes first, then pull them on each target host.

On the source checkout:

```bash
git status --short --branch
git diff --check
python3 - <<'PY'
import yaml
for p in ['docker/hosts/jellybase.yaml', 'docker/hosts/jellyhome.yaml', 'inventory/services.yml']:
    with open(p) as f:
        yaml.safe_load(f)
    print('yaml ok', p)
PY
```

On each target host:

```bash
cd ~/repo/home-network
git pull --ff-only origin main
just sync-docker-config
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/$(hostname -s).yaml config >/tmp/webtop-compose-check.yml
docker compose --env-file .env -f docker-compose.yml -f hosts/$(hostname -s).yaml build webtop-$(hostname -s)
docker compose --env-file .env -f docker-compose.yml -f hosts/$(hostname -s).yaml up -d --force-recreate webtop-$(hostname -s)
```

## Runtime verification

jellybase:

```bash
cd /opt/docker
docker ps --filter name=webtop-jellybase
curl -kI https://192.168.1.2:30301/
curl -kI https://100.125.86.118:30301/
docker logs --tail=100 webtop-jellybase
docker exec webtop-jellybase sh -lc 'command -v krokiet czkawka-gui ncdu duf mc ranger rsync tree jq 7z unzip zip'
```

jellyhome:

```bash
cd /opt/docker
docker ps --filter name=webtop-jellyhome
curl -kI https://192.168.1.1:30301/
curl -kI https://100.90.175.59:30301/
docker logs --tail=100 webtop-jellyhome
docker exec webtop-jellyhome sh -lc 'command -v krokiet czkawka-gui ncdu duf mc ranger rsync tree jq 7z unzip zip'
```

Expected notes:

- `curl -k` is used because the container certificate is self-signed.
- Browser verification is required for final acceptance: confirm the desktop loads and keyboard/mouse input work.

## Password retrieval

From the matching host, the operator can read the host-local password with sudo:

```bash
sudo cat /opt/docker/.secrets/webtop-$(hostname -s)/password
```

Do not display passwords in shared logs.

## Rollback

Stop one Webtop service without removing appdata:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/$(hostname -s).yaml stop webtop-$(hostname -s)
```

Remove the container but preserve appdata:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/$(hostname -s).yaml rm -f webtop-$(hostname -s)
```

To fully remove later, delete the source Compose entries, sync config, and separately decide whether to delete appdata/secrets.
