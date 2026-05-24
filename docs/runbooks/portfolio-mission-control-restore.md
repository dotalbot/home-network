# Portfolio Mission Control Restore Runbook

Service: Portfolio Mission Control V2
Host: `jellyberry`
Backup class: `appdata-and-source-repo`
Runtime container: `portfolio-mission-control-v2`
URL: `http://192.168.1.159:8787`

Source repository:

- `/home/jellybot/portfolio-intel`
- remote: `git@github.com:dotalbot/portfolio-intel.git`

Runtime paths:

- `/opt/docker/appdata/portfolio-mission-control-v2/data`
- `/home/jellybot/portfolio-intel`
- host-local environment/secrets in `/home/jellybot/.hermes/.env` when GitHub/private repo access is needed

## Restore priority

Medium. Mission Control is operationally useful but not required to bring core infrastructure back online.

## Non-destructive drill

1. Choose a verified `jellyberry` Borg archive.
2. Extract runtime appdata into scratch space:

```bash
sudo install -d -m 700 /tmp/home-network-restore-drill/portfolio-mission-control-v2
cd /tmp/home-network-restore-drill/portfolio-mission-control-v2
sudo borg extract --list REPOSITORY::ARCHIVE opt/docker/appdata/portfolio-mission-control-v2/data
```

3. Inspect expected data files:

```bash
find opt/docker/appdata/portfolio-mission-control-v2/data -maxdepth 2 -type f -printf '%p size=%s\n'
python3 -m json.tool opt/docker/appdata/portfolio-mission-control-v2/data/roadmap.json >/dev/null && echo roadmap_json_ok
```

4. Verify source repository recoverability without changing production:

```bash
git ls-remote git@github.com:dotalbot/portfolio-intel.git HEAD
```

Do not print tokens from `/home/jellybot/.hermes/.env`.

## Production restore

1. Confirm host and source state:

```bash
hostname -s
cd /home/jellybot/home-network
git status --short --branch
git pull --ff-only origin main
```

2. Restore or clone the app source repository:

```bash
test -d /home/jellybot/portfolio-intel/.git || git clone git@github.com:dotalbot/portfolio-intel.git /home/jellybot/portfolio-intel
cd /home/jellybot/portfolio-intel
git pull --ff-only
```

3. Preserve current runtime data:

```bash
sudo tar -C /opt/docker/appdata -czf /tmp/portfolio-mission-control-v2-pre-restore-$(date -u +%Y%m%dT%H%M%SZ).tgz portfolio-mission-control-v2 || true
```

4. Restore appdata from Borg:

```bash
cd /
sudo borg extract --list REPOSITORY::ARCHIVE opt/docker/appdata/portfolio-mission-control-v2/data
```

5. Verify private environment prerequisites without printing secrets:

```bash
test -f /home/jellybot/.hermes/.env
```

6. Sync home-network runtime and recreate the service:

```bash
cd /home/jellybot/home-network
./scripts/sync-docker-config
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellyberry.yaml up -d --force-recreate portfolio-mission-control-v2
```

7. Verify:

```bash
curl -fsS http://127.0.0.1:8787/ >/dev/null && echo mission_control_http_ok
curl -fsS http://127.0.0.1:8787/data/roadmap.json | python3 -m json.tool >/dev/null && echo roadmap_json_ok
docker logs --tail=80 portfolio-mission-control-v2
```

## Rollback

Restore the pre-restore tarball under `/opt/docker/appdata/portfolio-mission-control-v2`, recreate the container, and verify `/` plus `/data/roadmap.json`.

## Drill log

- Pending: first non-destructive restore drill.
