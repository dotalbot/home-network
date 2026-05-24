# Prometheus Alerting via Alertmanager and Discord

This runbook covers the home-network Prometheus alert-delivery path.

## Scope

Prometheus remains the source of truth for alert rules and alert state.
Alertmanager handles grouping, deduplication, repeat intervals, and silences.
Discord is the wake-up path only.

Runtime host:

- `jellybase`

Managed containers:

- `prometheus`
- `alertmanager`
- `alertmanager-discord-bridge`

Managed source files:

- `docker/appdata/prometheus/config/prometheus.yml`
- `docker/appdata/prometheus/config/rules/home-network-alerts.yml`
- `docker/appdata/alertmanager/config/alertmanager.yml`
- `docker/appdata/alertmanager-discord-bridge/bridge.py`
- `docker/hosts/jellybase.yaml`

## Secret handling

The Discord webhook URL must not be committed to Git.

Expected runtime secret path on `jellybase`:

```bash
/opt/docker/.secrets/alertmanager/discord_webhook_url
```

Expected permissions:

```bash
sudo install -d -m 770 -o root -g dockerops /opt/docker/.secrets/alertmanager
sudo install -m 640 -o root -g dockerops /dev/null /opt/docker/.secrets/alertmanager/discord_webhook_url
sudo nano /opt/docker/.secrets/alertmanager/discord_webhook_url
```

Paste only the Discord webhook URL in the file. Do not paste it into chat, command history, logs, or Git.

To verify the secret without printing it:

```bash
sudo test -s /opt/docker/.secrets/alertmanager/discord_webhook_url && echo good
sudo wc -c /opt/docker/.secrets/alertmanager/discord_webhook_url
```

To rotate it, edit the same file in place and recreate only the bridge container:

```bash
sudo nano /opt/docker/.secrets/alertmanager/discord_webhook_url
docker compose -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellybase.yaml up -d --force-recreate alertmanager-discord-bridge
```

## Routing policy

Alertmanager default route:

- warning alerts grouped by `alertname`, `host`, `instance`, `category`, and `service`
- group wait: 30s
- group interval: 10m
- repeat interval: 4h

Critical route:

- `severity="critical"`
- group wait: 10s
- group interval: 5m
- repeat interval: 1h

Info route:

- `severity="info"`
- group wait: 5m
- group interval: 30m
- repeat interval: 12h

The bridge posts compact messages to Discord and includes a reminder that Grafana/Prometheus remain the investigation path.

## Deploy

From `/home/jellybot/home-network` on `jellybase`:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
just sync-docker-config
docker compose -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellybase.yaml up -d alertmanager-discord-bridge alertmanager prometheus
```

If the secret file is missing, `alertmanager-discord-bridge` should fail fast and restart until the secret exists.

## Verify

Check config files:

```bash
docker run --rm --entrypoint amtool -v "$PWD/docker/appdata/alertmanager/config/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro" prom/alertmanager:latest check-config /etc/alertmanager/alertmanager.yml
docker run --rm --entrypoint promtool -v "$PWD/docker/appdata/prometheus/config:/etc/prometheus:ro" prom/prometheus:latest check config /etc/prometheus/prometheus.yml
```

Check runtime:

```bash
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'prometheus|alertmanager'
curl -fsS http://127.0.0.1:9093/-/ready
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:9090/api/v1/alertmanagers
```

Expected Prometheus alertmanager discovery includes `alertmanager:9093` as an active target.

Check bridge health from inside the Compose network:

```bash
docker compose -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellybase.yaml exec alertmanager-discord-bridge wget -qO- http://127.0.0.1:9094/healthz
```

## Fake alert test

Use Alertmanager's API to inject a temporary synthetic alert. This tests Alertmanager routing and Discord delivery without breaking a real service.

```bash
starts_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ends_at="$(date -u -d '+5 minutes' +%Y-%m-%dT%H:%M:%SZ)"

curl -fsS -XPOST http://127.0.0.1:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d "[{
    \"labels\": {
      \"alertname\": \"HomeNetworkAlertRouteTest\",
      \"severity\": \"warning\",
      \"category\": \"test\",
      \"host\": \"jellybase\"
    },
    \"annotations\": {
      \"summary\": \"Home-network Alertmanager Discord route test\",
      \"description\": \"Synthetic alert to verify grouped Discord delivery.\"
    },
    \"startsAt\": \"${starts_at}\",
    \"endsAt\": \"${ends_at}\",
    \"generatorURL\": \"http://jellybase:9093/#/alerts\"
  }]"
```

A Discord message should arrive in the configured alert thread. A resolved message should follow after the alert expires.

## Silencing during maintenance

Open Alertmanager:

```text
http://192.168.1.2:9093
```

Create a silence using specific matchers. Prefer narrow matchers, for example:

```text
alertname="NodeExporterDown"
instance="jellyhome:9100"
```

Avoid broad silences such as `severity="critical"` unless the whole monitoring stack is undergoing maintenance.

## Rollback

To stop alert delivery without changing Prometheus rules:

```bash
docker compose -f /opt/docker/docker-compose.yml -f /opt/docker/hosts/jellybase.yaml stop alertmanager alertmanager-discord-bridge
```

To remove Prometheus forwarding temporarily, remove or comment the `alerting.alertmanagers` block in `docker/appdata/prometheus/config/prometheus.yml`, sync, and recreate Prometheus.

## Troubleshooting

- No Discord message: check the webhook secret file exists and `alertmanager-discord-bridge` logs.
- Alertmanager has no alerts: check Prometheus `/alerts` and rule evaluation first.
- Prometheus shows no Alertmanager target: check `prometheus.yml` and recreate Prometheus, not just restart.
- Discord HTTP errors: rotate or re-create the Discord webhook, then update only the host-local secret file.
