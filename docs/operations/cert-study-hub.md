# Certification Study Hub Operations

## Purpose

Certification Study Hub is the unified static study menu served from `jellyberry`.

It collapses the existing course hubs into one browser interface:

- SC-401 Study Hub
- MS-102 Study Hub
- AB-900 Copilot and Agent Administration Fundamentals

## Runtime owner

`home-network` owns the Docker runtime definition:

```text
docker/hosts/jellyberry.yaml
```

The generated static source remains in:

```text
/home/jellybot/cert-study-hub
```

The generator script is:

```text
/home/jellybot/build_cert_study_hub.py
```

## URL

```text
http://jellyberry:8795
http://192.168.1.159:8795
```

Legacy direct course URLs may remain available while the unified menu is the preferred entry point:

```text
http://192.168.1.159:8791  # SC-401
http://192.168.1.159:8794  # MS-102
```

## Build source assets

```bash
python3 /home/jellybot/build_cert_study_hub.py
```

Inputs:

```text
/home/jellybot/sc-100-prep/study-web
/home/jellybot/ms-102-prep/study-web
/home/jellybot/ab-900-prep
```

## Deploy

```bash
cd /home/jellybot/home-network
just sync-docker-config
just up cert-study-hub
```

If Homepage should show only the unified menu, restart Homepage after sync:

```bash
just up homepage
```

## Verify

```bash
docker ps --filter name=cert-study-hub
curl -fsS http://localhost:8795 >/dev/null
curl -fsS http://localhost:8795/courses/sc401/index.html >/dev/null
curl -fsS http://localhost:8795/courses/ms102/index.html >/dev/null
curl -fsS http://localhost:8795/courses/ab900/index.html >/dev/null
```

Check Compose ownership:

```bash
docker inspect cert-study-hub --format '{{index .Config.Labels "com.docker.compose.project"}}'
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
  stop cert-study-hub

docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellyberry.yaml \
  rm -f cert-study-hub
```
