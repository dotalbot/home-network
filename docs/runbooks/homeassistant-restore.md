# Home Assistant Restore Runbook

Service: Home Assistant
Host: `jellybase`
Backup class: `appdata`
Runtime path: `/opt/docker/appdata/homeassistant/config`
Container: `homeassistant`
URL: `http://192.168.1.2:8123`

## Restore priority

High. Home Assistant contains local smart-home configuration and integrations. Restore must preserve secrets without printing them.

## Non-destructive drill

Use this before any production restore.

1. Choose a verified `jellybase` Borg archive.
2. Extract only Home Assistant appdata into scratch space:

```bash
sudo install -d -m 700 /tmp/home-network-restore-drill/homeassistant
cd /tmp/home-network-restore-drill/homeassistant
sudo borg extract --list REPOSITORY::ARCHIVE opt/docker/appdata/homeassistant/config
```

3. Inspect expected files without dumping secrets:

```bash
sudo test -f opt/docker/appdata/homeassistant/config/configuration.yaml
sudo test -d opt/docker/appdata/homeassistant/config/.storage
sudo find opt/docker/appdata/homeassistant/config -maxdepth 2 -type f \
  ! -name 'secrets.yaml' \
  ! -path '*/.storage/auth*' \
  -printf '%p size=%s\n' | head -50
```

4. Validate YAML shape where possible:

```bash
python3 - <<'PY'
from pathlib import Path
import yaml
p = Path('/tmp/home-network-restore-drill/homeassistant/opt/docker/appdata/homeassistant/config/configuration.yaml')
yaml.safe_load(p.read_text())
print('configuration_yaml=parse_ok')
PY
```

Do not start a scratch Home Assistant container with production secrets unless the drill explicitly needs it.

## Production restore

Only run during an approved maintenance window.

1. Confirm host and repo state:

```bash
hostname -s
cd /home/jellyfish/home-network
git status --short --branch
git pull --ff-only origin main
```

2. Stop Home Assistant:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml stop homeassistant
```

3. Preserve current state before replacing it:

```bash
sudo tar -C /opt/docker/appdata -czf /tmp/homeassistant-pre-restore-$(date -u +%Y%m%dT%H%M%SZ).tgz homeassistant
```

4. Restore from Borg:

```bash
cd /
sudo borg extract --list REPOSITORY::ARCHIVE opt/docker/appdata/homeassistant/config
```

5. Verify permissions and required files:

```bash
sudo test -f /opt/docker/appdata/homeassistant/config/configuration.yaml
sudo test -d /opt/docker/appdata/homeassistant/config/.storage
sudo find /opt/docker/appdata/homeassistant/config -maxdepth 1 -printf '%M %u:%g %p\n'
```

6. Recreate the container:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml up -d --force-recreate homeassistant
```

7. Verify:

```bash
docker ps --filter name=homeassistant
curl -fsS http://127.0.0.1:8123/manifest.json >/dev/null && echo homeassistant_http_ok
docker logs --tail=80 homeassistant
```

## Rollback

Stop the container, restore the pre-restore tarball back under `/opt/docker/appdata/homeassistant`, recreate the container, then verify HTTP and logs.

## Drill log

- Pending: first non-destructive restore drill.
