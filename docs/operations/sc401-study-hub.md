# SC-401 Study Hub Operations

## Purpose

SC-401 Study Hub is the static exam prep web UI served from `jellyberry`.

## Runtime owner

`home-network` owns the Docker runtime definition:

```text
docker/hosts/jellyberry.yaml
```

The source remains in:

```text
/home/jellybot/sc-100-prep/study-web
```

## URL

```text
http://jellyberry:8791
```

## Deploy

```bash
cd /home/jellybot/home-network
just sync-docker-config
just up sc401-study-hub
```

## Verify

```bash
docker ps --filter name=sc401-study-hub
curl -fsS http://localhost:8791 >/dev/null
```

Check Compose ownership:

```bash
docker inspect sc401-study-hub --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

Expected after migration:

```text
docker
```

## Rollback

The home-network-owned container uses the same container name and port as the old project. Stop/remove the `/opt/docker` Compose-owned service before starting the old Compose project.

```bash
cd /opt/docker
docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellyberry.yaml \
  stop sc401-study-hub

docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellyberry.yaml \
  rm -f sc401-study-hub

cd /home/jellybot/sc-100-prep/study-web
docker compose up -d
```

Verify:

```bash
curl -fsS http://localhost:8791 >/dev/null
docker inspect sc401-study-hub --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

Expected rollback project:

```text
study-web
```
