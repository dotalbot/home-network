# Monitoring Stack Restore Runbook

Services: Prometheus, Alertmanager, Grafana, Loki, Alloy config
Host: `jellybase`
Backup classes: `appdata` and `config-only`

Runtime paths:

- `/opt/docker/appdata/prometheus/config`
- `/opt/docker/appdata/prometheus/data`
- `/opt/docker/appdata/alertmanager/config`
- `/opt/docker/appdata/alertmanager/data`
- `/opt/docker/appdata/alertmanager-discord-bridge/bridge.py`
- `/opt/docker/appdata/grafana`
- `/opt/docker/appdata/grafana-provisioning`
- `/opt/docker/appdata/loki/config`
- `/opt/docker/appdata/loki/data`
- `/opt/docker/appdata/alloy/config`

Host-local secrets that must be recreated outside Git:

- `/opt/docker/.secrets/alertmanager/discord_webhook_url`
- Grafana admin credentials in `/opt/docker/.env` if customized

## Restore priority

High. This stack provides observability, alerting, and logs for investigating all other restore work.

## Non-destructive drill

1. Choose a verified `jellybase` Borg archive.
2. Extract config first into scratch space:

```bash
sudo install -d -m 700 /tmp/home-network-restore-drill/monitoring
cd /tmp/home-network-restore-drill/monitoring
sudo borg extract --list REPOSITORY::ARCHIVE \
  opt/docker/appdata/prometheus/config \
  opt/docker/appdata/alertmanager/config \
  opt/docker/appdata/alertmanager-discord-bridge \
  opt/docker/appdata/grafana-provisioning \
  opt/docker/appdata/loki/config \
  opt/docker/appdata/alloy/config
```

3. Validate restored Prometheus and Alertmanager config with containerized tools:

```bash
docker run --rm --entrypoint promtool \
  -v /tmp/home-network-restore-drill/monitoring/opt/docker/appdata/prometheus/config:/etc/prometheus:ro \
  prom/prometheus:latest check config /etc/prometheus/prometheus.yml

docker run --rm --entrypoint amtool \
  -v /tmp/home-network-restore-drill/monitoring/opt/docker/appdata/alertmanager/config/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro \
  prom/alertmanager:latest check-config /etc/alertmanager/alertmanager.yml
```

4. Validate Loki config shape:

```bash
docker run --rm \
  -v /tmp/home-network-restore-drill/monitoring/opt/docker/appdata/loki/config/loki.yml:/etc/loki/loki.yml:ro \
  grafana/loki:3.4.2 -config.file=/etc/loki/loki.yml -verify-config=true
```

5. Optionally extract data directories into scratch space for file-presence checks only. Do not start Prometheus, Grafana, or Loki against production data copies unless the drill explicitly calls for a disposable isolated container.

## Production restore order

Restore monitoring before relying on dashboards/alerts for other services.

1. Confirm host and source state:

```bash
hostname -s
cd /home/jellyfish/home-network
git status --short --branch
git pull --ff-only origin main
```

2. Stop dependent monitoring services:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml stop prometheus alertmanager alertmanager-discord-bridge grafana loki alloy
```

3. Preserve current state:

```bash
sudo tar -C /opt/docker/appdata -czf /tmp/monitoring-pre-restore-$(date -u +%Y%m%dT%H%M%SZ).tgz \
  prometheus alertmanager alertmanager-discord-bridge grafana grafana-provisioning loki alloy
```

4. Restore appdata from Borg. Prefer restoring config from Git via `scripts/sync-docker-config` when the goal is config recovery; restore data directories from Borg when time-series/log/history continuity is required.

```bash
cd /
sudo borg extract --list REPOSITORY::ARCHIVE \
  opt/docker/appdata/prometheus \
  opt/docker/appdata/alertmanager \
  opt/docker/appdata/grafana \
  opt/docker/appdata/grafana-provisioning \
  opt/docker/appdata/loki \
  opt/docker/appdata/alloy
```

5. Recreate host-local secrets without printing values:

```bash
sudo test -s /opt/docker/.secrets/alertmanager/discord_webhook_url
```

6. Re-sync source-managed config, then recreate services:

```bash
cd /home/jellyfish/home-network
./scripts/sync-docker-config
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml up -d --force-recreate prometheus alertmanager-discord-bridge alertmanager grafana loki alloy
```

7. Verify:

```bash
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:9093/-/ready
curl -fsS http://127.0.0.1:3100/ready
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS http://127.0.0.1:9090/api/v1/alertmanagers
```

8. Send a synthetic Alertmanager test only after the Discord webhook secret has been recreated.

## Known caveat

`/opt/docker/appdata/alloy/data` may contain root/container-owned files. `scripts/sync-docker-config` is expected to warn rather than fail when it cannot update those runtime-state modes.

## Rollback

Stop the monitoring services, restore the pre-restore tarball, recreate services, and verify endpoints. If Grafana data is broken but provisioning is intact, Grafana can be rebuilt from provisioning plus admin credentials, but local dashboard edits outside Git may be lost.

## Drill log

- Pending: first non-destructive restore drill.
