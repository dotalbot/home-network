# Portfolio Mission Control Operations

## Purpose

Portfolio Mission Control is the local portfolio/project dashboard served from `jellyberry`.

## Runtime owner

`home-network` owns the Docker runtime definition:

```text
docker/hosts/jellyberry.yaml
```

The application source remains in:

```text
/home/jellybot/portfolio-intel
```

## URL

```text
http://jellyberry:8787
```

## Runtime paths

Read-only source mounts:

```text
/home/jellybot/portfolio-intel/config -> /app/config
/home/jellybot/portfolio-intel/docs   -> /app/docs
/home/jellybot/portfolio-intel/data   -> /app/data
```

Generated appdata:

```text
/opt/docker/appdata/portfolio-mission-control-v2/data -> /app/mission-control-v2/data
```

Secret mount:

```text
/home/jellybot/.hermes/.env -> /run/secrets/hermes_env
```

Do not commit the Hermes env file. This service currently depends on the Hermes env file in the `jellybot` home directory rather than `/opt/docker/.secrets`; include that file in host restore planning.

## Deploy

```bash
cd /home/jellybot/home-network
just sync-docker-config
just up portfolio-mission-control-v2
```

## Verify

```bash
docker ps --filter name=portfolio-mission-control-v2
curl -fsS http://localhost:8787 >/dev/null
```

Check Compose ownership:

```bash
docker inspect portfolio-mission-control-v2 --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

Expected after migration:

```text
docker
```

## Rollback

The home-network-owned container uses the same container name and port as the old project. Stop/remove the `/opt/docker` Compose-owned service before starting the old Compose project.

If you need the latest generated roadmap data after rollback, copy it back first:

```bash
rsync -a /opt/docker/appdata/portfolio-mission-control-v2/data/ \
  /home/jellybot/portfolio-intel/mission-control-v2/data/
```

Then roll back runtime ownership:

```bash
cd /opt/docker
docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellyberry.yaml \
  stop portfolio-mission-control-v2

docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellyberry.yaml \
  rm -f portfolio-mission-control-v2

cd /home/jellybot/portfolio-intel
docker compose up -d
```

Verify:

```bash
curl -fsS http://localhost:8787 >/dev/null
docker inspect portfolio-mission-control-v2 --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

Expected rollback project:

```text
portfolio-intel
```
