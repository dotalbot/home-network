# Image Pastebin Operations

## Purpose

Image Pastebin is a lightweight LAN upload helper for screenshots/images.

## Runtime owner

`home-network` owns the Docker runtime definition:

```text
docker/hosts/jellyberry.yaml
```

The source remains in:

```text
/home/jellybot/image-pastebin
```

## URL

```text
http://jellyberry:8792
```

## Runtime paths

Uploads live in `/opt/docker` appdata:

```text
/opt/docker/appdata/image-pastebin/uploads -> /data/uploads
```

## Security note

This is an unauthenticated LAN helper. Treat it as trusted-LAN/Tailnet-only and clean stale uploads.

## Deploy

```bash
cd /home/jellybot/home-network
just sync-docker-config
just up image-pastebin
```

## Verify

```bash
docker ps --filter name=image-pastebin
curl -fsS http://localhost:8792 >/dev/null
```

Check Compose ownership:

```bash
docker inspect image-pastebin --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

Expected after migration:

```text
docker
```

## Cleanup uploads

List uploads:

```bash
find /opt/docker/appdata/image-pastebin/uploads -type f -maxdepth 1 -ls
```

Delete stale uploads manually after confirming they are not needed.

## Rollback

The home-network-owned container uses the same container name and port as the old project. Stop/remove the `/opt/docker` Compose-owned service before starting the old Compose project.

If you need uploaded files after rollback, copy them back first:

```bash
rsync -a /opt/docker/appdata/image-pastebin/uploads/ \
  /home/jellybot/image-pastebin/uploads/
```

Then roll back runtime ownership:

```bash
cd /opt/docker
docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellyberry.yaml \
  stop image-pastebin

docker compose --env-file .env \
  -f docker-compose.yml \
  -f hosts/jellyberry.yaml \
  rm -f image-pastebin

cd /home/jellybot/image-pastebin
docker compose up -d
```

Verify:

```bash
curl -fsS http://localhost:8792 >/dev/null
docker inspect image-pastebin --format '{{index .Config.Labels "com.docker.compose.project"}}'
```

Expected rollback project:

```text
image-pastebin
```
