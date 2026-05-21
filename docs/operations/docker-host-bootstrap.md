# Docker Host Bootstrap for home-network

## Purpose

Use this runbook when adding another host to the `home-network` Docker management pattern.

The operating model is:

```text
home-network repo = source of truth
/opt/docker       = live deploy/runtime location
Docker Compose    = service runtime
```

## Prerequisites

- Docker Engine and Docker Compose plugin installed.
- The admin/service account exists, for example `jellybot`.
- The host has a matching overlay in the repo:

```text
docker/hosts/<hostname>.yaml
```

Check the short hostname:

```bash
hostname -s
```

## One-time bootstrap

Replace `jellybot` with the admin/service account if setting up a different user.

```bash
sudo mkdir -p /opt/docker/{appdata,hosts,.secrets}

sudo groupadd dockerops || true
sudo usermod -aG dockerops jellybot

sudo chown -R root:dockerops /opt/docker
sudo chmod -R g+rwX /opt/docker
sudo find /opt/docker -type d -exec chmod g+s {} \;

sudo chmod 770 /opt/docker/.secrets
```

Create the Compose env file:

```bash
sudo tee /opt/docker/.env >/dev/null <<'EOF'
TZ=Europe/London
EOF

sudo chown root:dockerops /opt/docker/.env
sudo chmod 660 /opt/docker/.env
```

Log out and back in, or reboot, so the user receives the new `dockerops` group membership.

## Verification

```bash
id jellybot
ls -ld /opt/docker /opt/docker/appdata /opt/docker/hosts /opt/docker/.secrets
test -w /opt/docker && echo "writable" || echo "not writable"
```

Expected:

```text
jellybot is a member of dockerops
/opt/docker is root:dockerops and group-writable
/opt/docker/appdata is root:dockerops and group-writable
/opt/docker/hosts is root:dockerops and group-writable
/opt/docker/.secrets is root:dockerops with mode 770
test output says writable
```

## Gremlin: user is in dockerops but sync still asks for sudo

Symptom:

```text
just sync-docker-config
```

asks for sudo even though `id jellybot` shows `dockerops`.

Cause:

The directory exists but is not group-writable. For example:

```text
drwxr-sr-x root dockerops /opt/docker
```

That is not enough. It needs group write:

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

## Sync and deploy from home-network

From the repo:

```bash
cd /home/jellybot/home-network
just sync-docker-config
just compose-config
```

Start one service:

```bash
just up <service-name>
```

Run the full Homepage/update deploy path:

```bash
just homepage-deploy
```

## Important rules

- Do not manually edit `/opt/docker` as the long-term source of truth.
- Edit the repo, then sync/deploy.
- Do not commit `/opt/docker/.env` or `/opt/docker/.secrets`.
- Access to Docker plus `/opt/docker` is effectively root-level power. Keep `dockerops` restricted to trusted admins.
- Repo-managed appdata directories that use `rsync --delete` should not contain manual-only files.
