# Mosquitto MQTT Restore Runbook

Service: Mosquitto MQTT
Host: `jellyhome`
Backup class: `config-and-persistence`
Runtime paths:

- `/opt/docker/appdata/mosquitto/config`
- `/opt/docker/appdata/mosquitto/data`
- `/opt/docker/appdata/mosquitto/log`

Container: `mqtt-mosquitto`
URLs:

- MQTT: `mqtt://192.168.1.1:1883`
- WebSocket: `ws://192.168.1.1:9001`

## Restore priority

Medium-high. Mosquitto carries smart-home and backup-event messaging. Config and persistent data matter; logs are useful but not the source of truth.

## Non-destructive drill

Recommended first restore drill target.

1. Choose a verified `jellyhome` Borg archive.
2. Extract only Mosquitto appdata into scratch space:

```bash
sudo install -d -m 700 /tmp/home-network-restore-drill/mosquitto
cd /tmp/home-network-restore-drill/mosquitto
sudo borg extract --list REPOSITORY::ARCHIVE opt/docker/appdata/mosquitto/config opt/docker/appdata/mosquitto/data
```

3. Inspect expected files without printing credentials:

```bash
sudo test -f opt/docker/appdata/mosquitto/config/mosquitto.conf
sudo find opt/docker/appdata/mosquitto -maxdepth 3 -type f \
  ! -name '*password*' \
  ! -name '*.key' \
  -printf '%p size=%s\n'
```

4. Validate the restored config in a scratch container on an unused port. Use a read-only mount and do not publish production ports:

```bash
docker run --rm \
  -v /tmp/home-network-restore-drill/mosquitto/opt/docker/appdata/mosquitto/config:/mosquitto/config:ro \
  eclipse-mosquitto:2 mosquitto -c /mosquitto/config/mosquitto.conf -p 18883 -v
```

Stop the scratch container after config startup is confirmed.

## Production restore

Only run during an approved maintenance window.

1. Confirm host and repo state:

```bash
hostname -s
cd /home/jellybot/home-network
git status --short --branch
git pull --ff-only origin main
```

2. Stop Mosquitto:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml stop mosquitto
```

3. Preserve current state:

```bash
sudo tar -C /opt/docker/appdata -czf /tmp/mosquitto-pre-restore-$(date -u +%Y%m%dT%H%M%SZ).tgz mosquitto
```

4. Restore config and data from Borg:

```bash
cd /
sudo borg extract --list REPOSITORY::ARCHIVE opt/docker/appdata/mosquitto/config opt/docker/appdata/mosquitto/data
```

5. Verify required files and permissions:

```bash
sudo test -f /opt/docker/appdata/mosquitto/config/mosquitto.conf
sudo find /opt/docker/appdata/mosquitto -maxdepth 2 -printf '%M %u:%g %p\n'
```

6. Recreate the container:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml up -d --force-recreate mosquitto
```

7. Verify broker health:

```bash
docker ps --filter name=mqtt-mosquitto
docker logs --tail=80 mqtt-mosquitto
mosquitto_sub -h 127.0.0.1 -t '$SYS/broker/version' -C 1 -W 5 || true
```

If authenticated smoke-test credentials are required, use host-local secret files and do not print them.

## Rollback

Stop Mosquitto, restore the pre-restore tarball, recreate the container, then verify broker startup and a local subscribe/publish smoke test.

## Drill log

- 2026-05-25: non-destructive restore drill passed on `jellyhome`.
  - Archive: `jellyhome-2026-05-23T09:40:36`.
  - Repository: `ssh://jellybackup@192.168.1.75/home/jellybackup/externaldisk/borg_jellyhome`.
  - Scratch path: `/tmp/home-network-restore-drill/mosquitto`.
  - Restored paths: `opt/docker/appdata/mosquitto/config` and `opt/docker/appdata/mosquitto/data`.
  - Verified files without printing secrets: `mosquitto.conf`, `passwd`, and `mosquitto.db` were present in scratch.
  - Scratch config validation: `eclipse-mosquitto:2` started successfully against the restored config under a timeout.
  - Production `/opt/docker/appdata/mosquitto` was not overwritten.
  - Caveat: Borg access from the `jellyfish` operator account prompted for `jellybackup` SSH credentials; the working restore path used `sudo` so root's Borg SSH key and root-readable passphrase file were used, matching the system Borgmatic runtime model.
