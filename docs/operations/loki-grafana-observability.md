# Loki + Grafana Observability Operations

Status: first-pass implemented on `jellybase`.

## Purpose

Loki provides the lightweight log-history layer for the home-network platform. Prometheus/node_exporter remain the metrics and alert-state layer. Grafana is the shared UI for both metrics and logs.

Netdata is retired from the managed Compose/inventory/dashboard/status path. Existing Netdata containers/appdata may remain until the approved cleanup pass.

## Source of truth

```text
docker/hosts/jellybase.yaml
docker/appdata/loki/config/loki.yml
docker/appdata/grafana-provisioning/datasources/datasources.yaml
scripts/sync-docker-config
inventory/services.yml
```

Runtime copy on `jellybase`:

```text
/opt/docker/hosts/jellybase.yaml
/opt/docker/appdata/loki/config/loki.yml
/opt/docker/appdata/loki/data/     # runtime data, not rsync-deleted
/opt/docker/appdata/grafana-provisioning/datasources/datasources.yaml
```

## Endpoints

```text
http://jellybase:3100/ready        Loki readiness
http://jellybase:3001/api/health  Grafana health
http://jellybase:9090/-/ready     Prometheus readiness
```

Grafana datasource:

```text
name: Loki
uid: loki
url: http://loki:3100
```

## Deploy

From the `home-network` repo on `jellybase`:

```bash
git pull --ff-only origin main
just homepage-render
just network-map-render
just sync-docker-config
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml config
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml up -d loki grafana homepage prometheus
```

Use `up -d` rather than `restart` when Compose service definitions, mounts, ports, or environment change. Restart keeps old container config. Loki runtime data lives under `/opt/docker/appdata/loki/data` and must not be deleted by config sync; the sync script creates it and makes it writable for the Loki container UID.

## Verify

```bash
curl -fsS http://127.0.0.1:3100/ready
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS http://127.0.0.1:9090/-/ready
```

Push a non-secret smoke-test log:

```bash
ts="$(date +%s%N)"
curl -fsS -H "Content-Type: application/json" -X POST \
  http://127.0.0.1:3100/loki/api/v1/push \
  --data-raw "{\"streams\":[{\"stream\":{\"job\":\"borgmatic\",\"host\":\"jellybase\",\"instance\":\"jellybase\",\"environment\":\"home-network\",\"source\":\"manual-test\"},\"values\":[[\"${ts}\",\"manual loki smoke test from jellybase\"]]}]}"

curl -fsG --data-urlencode 'query={job="borgmatic",host="jellybase",source="manual-test"}' \
  http://127.0.0.1:3100/loki/api/v1/query_range
```

Verify Grafana knows the Loki datasource without printing secrets:

```bash
cd /opt/docker
set -a; . ./.env; set +a
curl -fsS -u "${GRAFANA_ADMIN_USER:-admin}:${GRAFANA_ADMIN_PASSWORD}" \
  http://127.0.0.1:3001/api/datasources/name/Loki
```

## Rollback

1. Revert the repo commit or remove the `loki` service and Grafana provisioning mount from `docker/hosts/jellybase.yaml`.
2. Run `just sync-docker-config`.
3. On `jellybase`, run:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml up -d grafana prometheus
docker stop loki || true
docker rm loki || true
```

Leave `/opt/docker/appdata/loki/data` in place until you intentionally delete log history.

## Remaining work

- Source-manage Grafana log panels/dashboards for Borgmatic logs.
- Add alerting and Discord/Hermes notification wiring for actionable failures.
- Decide whether `jellybackup` should join the Borgmatic Loki/log-metrics rollout.


## Borgmatic Loki hook rollout

`inventory/backups.yml` contains the first-wave `borgmatic_loki` block. It is enabled for `jellyberry`, `jellybase`, and `jellyhome` after each host completed a manual Borgmatic run with queryable Loki entries and Prometheus success metrics.

The rollout generator renders a Borgmatic `loki:` monitoring block into `/tmp/borgmatic-rollout-<host>/stage-05-configure-borgmatic.sh` only for enabled hosts. Keep labels low-cardinality and secret-free: `job`, `host`, `instance`, `environment`, and `backup_profile` are acceptable. Do not add repository URLs, archive names, file paths, error messages, passphrases, or key material as labels.

Verification from a host after applying stage 05 and running a Borgmatic backup; replace the host label as needed:

```bash
curl -fsS http://jellybase:3100/ready
curl -fsG \
  --data-urlencode 'query={job="borgmatic",host="jellyberry"}' \
  http://jellybase:3100/loki/api/v1/query_range
```

Expand `borgmatic_loki.enabled_hosts` only after the target host has queryable logs and Prometheus metrics still update. The first-wave enabled hosts are now verified.


## First-wave verification result

Borgmatic Loki log shipping is verified for `jellyberry`, `jellybase`, and `jellyhome`. Each host has queryable Loki entries for `{job="borgmatic",host="<host>"}` and Prometheus reports `borgmatic_last_run_success{host="<host>"} 1`. The verified manual archives were:

- `jellyberry-2026-05-23T09:23:49`
- `jellybase-2026-05-23T08:39:51`
- `jellyhome-2026-05-23T09:40:36`
