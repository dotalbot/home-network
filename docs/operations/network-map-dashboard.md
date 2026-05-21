# Network Map Dashboard Operations

## Purpose

The Network Map dashboard is a static, interactive inventory manager for LAN and Tailscale discovery data. It reads from `inventory/devices.yml` and renders a browser UI with:

- summary counters
- LAN/Tailscale filters
- category and port filters
- searchable device cards
- selected-device details
- simple grouped topology/map view

## Source and generated paths

Source inventory:

```text
inventory/devices.yml
```

Generator:

```text
scripts/network-map-render
```

Generated static site:

```text
docker/appdata/network-map/site/
```

Runtime location after sync/deploy:

```text
/opt/docker/appdata/network-map/site/
```

## Render locally

```bash
./scripts/network-map-render
```

Validation:

```bash
python3 -m json.tool docker/appdata/network-map/site/data/inventory.json >/dev/null
```

## Docker service

The service is defined in the jellyberry Compose overlay:

```text
docker/hosts/jellyberry.yaml
```

It uses nginx and publishes:

```text
http://jellyberry:8788
```

## Homepage integration

The dashboard is listed in `inventory/services.yml` as `network-map`.

When Homepage is regenerated, the link appears automatically:

```bash
./scripts/homepage-render
```

Full deploy workflow:

```bash
just homepage-deploy
```

That renders Homepage, renders the network map, syncs config/appdata to `/opt/docker`, and runs Docker Compose through the repo deploy script.

## Permissions note

Repo-side generation works without sudo. Real deployment on `jellyberry` needs the one-time `/opt/docker` bootstrap in:

```text
docs/operations/jellyberry-docker-host-bootstrap.md
```

After that bootstrap, the `dockerops` group should let `jellybot` sync managed files to `/opt/docker` without broad sudo.

## Update workflow after discovery

1. Update `inventory/devices.yml` from discovery results.
2. Run:

```bash
./scripts/network-map-render
./scripts/homepage-render
```

3. Deploy/sync when ready:

```bash
just homepage-deploy
```

4. Open:

```text
http://jellyberry:8788
```
