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
2. Extract only Home Assistant appdata into timestamped scratch space:

```bash
DRILL_BASE=/tmp/home-network-restore-drill
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRILL="$DRILL_BASE/homeassistant-$STAMP"
sudo install -d -m 700 "$DRILL"
sudo borgmatic --config /etc/borgmatic/config.yaml extract \
  --archive ARCHIVE \
  --path opt/docker/appdata/homeassistant/config \
  --destination "$DRILL"
```

3. Inspect expected files without dumping secrets:

```bash
DRILL=/tmp/home-network-restore-drill/homeassistant-YYYYMMDDTHHMMSSZ
sudo test -f "$DRILL/opt/docker/appdata/homeassistant/config/configuration.yaml"
sudo test -d "$DRILL/opt/docker/appdata/homeassistant/config/.storage"
sudo find "$DRILL/opt/docker/appdata/homeassistant/config" -maxdepth 2 -type f \
  ! -name 'secrets.yaml' \
  ! -path '*/.storage/auth*' \
  -printf '%p size=%s\n' | head -50
```

4. Validate YAML shape where possible:

```bash
python3 - <<'PY'
from pathlib import Path
import yaml

class Loader(yaml.SafeLoader):
    pass

Loader.add_constructor(
    None,
    lambda loader, node: loader.construct_scalar(node)
    if isinstance(node, yaml.ScalarNode)
    else loader.construct_sequence(node)
    if isinstance(node, yaml.SequenceNode)
    else loader.construct_mapping(node),
)

DRILL = Path('/tmp/home-network-restore-drill/homeassistant-YYYYMMDDTHHMMSSZ')
p = DRILL / 'opt/docker/appdata/homeassistant/config/configuration.yaml'
yaml.load(p.read_text(), Loader=Loader)
print('configuration_yaml_shape=parse_ok')
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

- 2026-05-25: non-destructive Home Assistant config restore drill completed on `jellybase`.
  - Archive: `jellybase-2026-05-25T03:12:03`.
  - Scratch path: `/tmp/home-network-restore-drill/homeassistant-20260525T091318Z`.
  - Restored path only: `opt/docker/appdata/homeassistant/config`.
  - Required restored files/directories found:
    - `configuration.yaml`
    - `.storage/`
    - Home Assistant DB files and selected `.storage` registry/state files were present.
  - Validation results:
    - YAML shape parse passed for `configuration.yaml`, `automations.yaml`, `scripts.yaml`, and `scenes.yaml` using a Home Assistant-aware loader that tolerates custom tags such as `!include`.
    - JSON parse passed for `.storage/core.config`, `.storage/core.config_entries`, `.storage/core.device_registry`, and `.storage/core.entity_registry`.
    - Production `homeassistant` container remained running and healthy.
    - `curl http://127.0.0.1:8123/manifest.json` returned successfully after the drill.
  - Production `/opt/docker` data was not modified.
  - Caveat found: generic `yaml.safe_load` is too strict for Home Assistant configs because `configuration.yaml` can use custom tags such as `!include`; future drills should use a tolerant shape parser or Home Assistant's own config checks in an isolated context.
