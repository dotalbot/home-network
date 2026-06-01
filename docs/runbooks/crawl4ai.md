# Crawl4AI Runbook

**Status:** Active source-managed deployment
**Host:** `jellybase`  
**Service:** `crawl4ai`  
**Image:** `unclecode/crawl4ai:0.8.6`  
**LAN URL:** `http://192.168.1.2:11235`  
**Playground:** `http://192.168.1.2:11235/playground`  
**Health:** `http://192.168.1.2:11235/health`

## Purpose

Crawl4AI provides a local open-source crawler/scraper API that can return LLM-friendly page content for Hermes and project workflows. It is a local complement/fallback to Firecrawl, not a public scraping endpoint and not a Cloudflare/authentication bypass.

Initial consumers are expected to be:

- Hermes workflows that need local web extraction experiments.
- `3dprint_loader` source adapters after they add strict source allowlists and SSRF controls.
- Future Mission Control / portfolio collection jobs where local crawling is cheaper than paid extraction.

## Source of truth

All source-managed configuration lives in this repo:

- Compose overlay: `docker/hosts/jellybase.yaml`
- Crawl4AI config template: `docker/appdata/crawl4ai/config.example.yml`
- Inventory: `inventory/services.yml`
- Homepage card: `docker/appdata/homepage/services.yaml`

Runtime files are synced to `/opt/docker` on the target host by the normal home-network deployment flow.

## Runtime layout on `jellybase`

Expected runtime paths:

```text
/opt/docker/appdata/crawl4ai/config.example.yml      # synced template only
/opt/docker/.secrets/crawl4ai/config.yml             # real runtime config with api_token
/opt/docker/.secrets/crawl4ai/                       # future provider keys/tokens only
```

Before first deploy, create the secret runtime config and JWT signing secret on `jellybase`:

```bash
sudo install -d -m 0750 -o root -g dockerops /opt/docker/.secrets/crawl4ai
sudo cp /opt/docker/appdata/crawl4ai/config.example.yml /opt/docker/.secrets/crawl4ai/config.yml
sudoedit /opt/docker/.secrets/crawl4ai/config.yml   # replace REPLACE_WITH_LONG_RANDOM_TOKEN
# The container runs as appuser and must be able to read the bind-mounted file.
# The parent /opt/docker/.secrets/crawl4ai directory remains 0750 root:dockerops.
sudo chmod 0644 /opt/docker/.secrets/crawl4ai/config.yml

# Also add this to /opt/docker/.env with a long random value, then keep .env restricted:
# CRAWL4AI_JWT_SECRET=<long-random-secret>
sudo chmod 0640 /opt/docker/.env
sudo chown root:dockerops /opt/docker/.env
```

The initial deployment does not require LLM provider secrets. If later workflows need LLM-powered extraction, put provider keys in `/opt/docker/.secrets/crawl4ai/` and mount or inject them via source-managed Compose changes without committing secret values.

## Exposure model

The service is bound to the jellybase LAN IP only:

```yaml
ports:
  - "192.168.1.2:11235:11235"
```

API endpoints are also JWT-protected using the secret `/opt/docker/.secrets/crawl4ai/config.yml` plus `CRAWL4AI_JWT_SECRET` from `/opt/docker/.env`. Health and OpenAPI metadata may remain unauthenticated upstream, so the service must still be treated as LAN-internal only.

This is intentional:

- No public exposure.
- No broad `0.0.0.0` bind.
- No reverse proxy exposure until explicitly approved.
- No direct unauthenticated crawl access for LAN clients.

Because the API can fetch arbitrary URLs, consuming tools must apply their own URL safety rules before calling it:

- allowlist expected source hosts;
- reject private/link-local/loopback IP destinations unless explicitly intended;
- set request timeouts;
- cap response sizes;
- use conservative redirect handling;
- rate-limit source-site traffic.

## Deploy

From the source repo:

```bash
cd /home/jellybot/home-network
git status --short --branch
```

On the runtime host checkout (`jellybase`, normally `/home/jellyfish/repo/home-network`):

```bash
git pull --ff-only origin main
just sync-docker-config
just up crawl4ai
```

If using raw Compose instead of `just`, use both the base compose file and host overlay:

```bash
cd /opt/docker
docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellybase.yaml \
  up -d crawl4ai
```

Do not use `docker compose restart crawl4ai` for first deploy or config changes; it will not pick up changed image/env/port/mount settings. Use `up -d` so Compose can recreate the container.

## Verification

Run after deploy:

```bash
docker ps --filter name=crawl4ai
curl -fsS http://192.168.1.2:11235/health
curl -fsS http://192.168.1.2:11235/metrics | head
```

The container healthcheck uses `127.0.0.1` inside the container. The host port is intentionally bound only to `192.168.1.2`, so host-side `127.0.0.1:11235` is not expected to work.

JWT token bootstrap test:

```bash
curl -fsS http://192.168.1.2:11235/token \
  -H 'Content-Type: application/json' \
  -d '{"email":"operator@gmail.com","api_token":"<token-from-secret-config>"}'
```

Crawl4AI v0.8.6 validates that the email domain has MX records; reserved domains such as `local.invalid` fail with `Invalid email domain`.

Functional smoke test with a benign page should use a bearer token returned by `/token`:

```bash
curl -fsS http://192.168.1.2:11235/md \
  -H 'Authorization: Bearer ACCESS_TOKEN_FROM_TOKEN_RESPONSE' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'
```

If the exact endpoint shape changes upstream, verify available routes from:

```bash
curl -fsS http://192.168.1.2:11235/openapi.json
```

Homepage verification:

```bash
curl -fsS http://192.168.1.2:11235/health
# Then check Homepage Tools section for Crawl4AI after sync/reload.
```

## Operations

Common commands on `jellybase`:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml ps crawl4ai
docker logs --tail=100 crawl4ai
docker inspect crawl4ai --format '{{json .State.Health}}'
```

Upgrade flow:

1. Read upstream release notes.
2. Change the pinned image tag in `docker/hosts/jellybase.yaml`.
3. Run Compose config validation.
4. Deploy with `just sync-docker-config && just up crawl4ai` on `jellybase`.
5. Re-run health and functional smoke tests.

Rollback:

1. Revert the image tag/config change in this repo.
2. Sync config to `/opt/docker`.
3. Run `just up crawl4ai` to recreate with the previous image/config.

## Troubleshooting

### Container unhealthy: browser crashes

Likely shared-memory or resource pressure.

Check:

```bash
docker logs --tail=200 crawl4ai
docker stats --no-stream crawl4ai
```

Mitigations:

- Keep `shm_size: "1gb"` or increase if jellybase has enough RAM.
- Reduce `crawler.pool.max_pages` in `docker/appdata/crawl4ai/config.yml`.
- Avoid concurrent heavy jobs until resource use is understood.

### HTTP 404 for a test endpoint

Use OpenAPI to confirm live routes:

```bash
curl -fsS http://192.168.1.2:11235/openapi.json
```

Upstream route names may change between releases; prefer health/openapi checks as deployment truth.

### Service reachable locally but not from LAN

Check whether the port is bound to `192.168.1.2` and whether host firewall/DOCKER-USER rules allow trusted LAN access:

```bash
docker port crawl4ai
ss -ltnp | grep 11235
```

Do not broaden to `0.0.0.0` unless explicitly approved. Fix with a narrow LAN/Tailnet allow rule if needed.

### LLM extraction fails

Initial deployment intentionally ships without provider keys. Add a source-managed secret mount/env-file pattern only after a specific workflow needs it. Store secret values under `/opt/docker/.secrets/crawl4ai/`; never commit them.

## Follow-up integration work

Recommended next cards after the service is live:

1. Add a Hermes wrapper/tool or MCP config for Crawl4AI with URL allowlists and output caps.
2. Add a `3dprint_loader` Crawl4AI metadata fallback behind per-source allowlists.
3. Add Prometheus alerting only if operational use justifies it after the service has settled.
