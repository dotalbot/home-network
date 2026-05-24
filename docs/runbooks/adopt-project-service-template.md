# Adopt Project Service Template

Use this checklist when adopting an application from another repository into the `home-network` `/opt/docker` deployment model.

## Inputs

```text
Service name:
Application repo path:
Runtime host:
Runtime checkout path:
Branch or tag:
LAN port:
Health URL:
State/appdata paths:
Secret paths:
Backup class:
Rollback target:
```

## 1. App repo readiness

- [ ] App repo has a clean working tree or known intentional branch state.
- [ ] App repo has Dockerfile(s) for required services.
- [ ] App repo has `.dockerignore` where useful.
- [ ] App repo has `.env.example` with no secrets.
- [ ] App has a health endpoint or a documented root smoke test.
- [ ] App tests/build pass before deployment.
- [ ] App branch is pushed to origin.

Suggested checks:

```bash
cd /home/jellybot/<app-repo>
git status --short --branch
git log --oneline -3
docker compose config
```

Run app-specific tests/builds from the app repo.

## 2. Runtime host preparation

- [ ] Runtime host is selected and documented.
- [ ] SSH access from the operator host is available, or a staged sudo/manual script path is chosen.
- [ ] Runtime checkout exists at `/home/jellybot/<app-repo>`.
- [ ] Runtime checkout can fetch/pull from origin.
- [ ] Runtime user can deploy via `dockerops`, staged sudo, or a controlled helper.
- [ ] `/opt/docker` permissions are verified.

Suggested checks on runtime host:

```bash
hostname -s
id
stat -c '%A %U %G %n' /opt/docker /opt/docker/hosts /opt/docker/appdata /opt/docker/.secrets
cd /home/jellybot/<app-repo> && git fetch origin && git status --short --branch
```

## 3. home-network source changes

Update these files as appropriate:

- [ ] `docker/hosts/<runtime-host>.yaml` includes the service Compose definitions.
- [ ] `inventory/services.yml` includes service metadata, host, container names, URL, source path, and restore note.
- [ ] `inventory/backups.yml` includes or reuses the correct backup class/rule.
- [ ] `docs/operations/<service>.md` explains runtime operation.
- [ ] `docs/README.md` links the new operation doc if durable.
- [ ] Homepage/network-map generated config is updated if the service should appear there.

## 4. Secrets and state

- [ ] No secrets are added to Git.
- [ ] Runtime secrets are stored under `/opt/docker/.secrets/<service>/`.
- [ ] Runtime state is stored under `/opt/docker/appdata/<service>/`.
- [ ] Secrets are mounted read-only where possible.
- [ ] Browser storage-state/cookie files are treated as password-equivalent secrets.
- [ ] Restore notes mention required secrets and appdata paths.

## 5. Code refresh deployment

Every deploy refreshes source on the runtime host before rebuilding:

```bash
cd /home/jellybot/<app-repo>
git fetch origin
git checkout <branch-or-tag>
git pull --ff-only origin <branch>
```

Then deploy from `home-network`/`/opt/docker`:

```bash
cd /home/jellybot/home-network
just sync-docker-config

cd /opt/docker
docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname -s).yaml \
  config

docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname -s).yaml \
  up -d --build --force-recreate <service-name>
```

Use all service names together if the app has multiple containers, for example API and web.

## 6. Verification

- [ ] `docker compose config` passes on the runtime host.
- [ ] Containers are running.
- [ ] Logs do not show startup errors.
- [ ] Local health/root endpoint responds.
- [ ] LAN URL responds.
- [ ] `just drift-check-strict` passes or the expected exception is documented.
- [ ] `git status --short --branch` is clean or intentional in both repos.

Suggested commands:

```bash
docker ps --filter name=<service-name>
docker logs --tail=100 <service-name>
curl -fsS http://127.0.0.1:<port>/health || curl -fsS http://127.0.0.1:<port>/
cd /home/jellybot/home-network && just drift-check-strict
```

## 7. Rollback

- [ ] Known-good branch, tag, commit, or image tag is recorded.
- [ ] Rollback command has been documented.
- [ ] Stateful data rollback requirements are known.

Git checkout rollback:

```bash
cd /home/jellybot/<app-repo>
git fetch origin
git checkout <known-good-sha-or-tag>

cd /opt/docker
docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname -s).yaml \
  up -d --build --force-recreate <service-name>
```

## 8. Closeout

- [ ] `home-network` docs and inventory reflect the live deployment.
- [ ] App repo docs mention the home-network runtime path.
- [ ] Verification commands/results are captured in the final status.
- [ ] Commit and push `home-network` changes.
