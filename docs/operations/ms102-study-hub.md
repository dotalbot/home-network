# MS-102 Study Hub Operations

## Purpose

MS-102 Study Hub is the static Microsoft 365 Administrator exam-prep web UI served from `jellyberry`.

## Runtime owner

`home-network` owns the Docker runtime definition:

```text
docker/hosts/jellyberry.yaml
```

The source remains in:

```text
/home/jellybot/ms-102-prep/study-web
```

## URL

```text
http://jellyberry:8794
http://192.168.1.159:8794
```

## Build source assets

```bash
cd /home/jellybot/ms-102-prep
python3 build_study_web.py
```

## Deploy

```bash
cd /home/jellybot/home-network
just sync-docker-config
just up ms102-study-hub
```

## Verify

```bash
docker ps --filter name=ms102-study-hub
curl -fsS http://localhost:8794 >/dev/null
curl -fsS http://localhost:8794/data/flashcards.json >/dev/null
curl -fsS http://localhost:8794/data/questions.json >/dev/null
```

Check Compose ownership:

```bash
docker inspect ms102-study-hub --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

Expected project:

```text
docker
```

## Rollback

Stop/remove the `/opt/docker` Compose-owned service:

```bash
cd /opt/docker
docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellyberry.yaml \
  stop ms102-study-hub

docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellyberry.yaml \
  rm -f ms102-study-hub
```
