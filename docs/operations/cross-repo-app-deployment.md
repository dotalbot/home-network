# Cross-Repo App Deployment Method

## Purpose

Use this method when an application is developed in its own repository but deployed and operated through the `home-network` `/opt/docker` platform.

Typical example:

```text
jellyberry / Hermes development checkout
  /home/jellybot/3dprint_loader

jellyhome runtime checkout
  /home/jellybot/3dprint_loader

home-network source-of-truth
  /home/jellybot/home-network

runtime Compose copy
  /opt/docker
```

The key rule is:

```text
app repo owns source and tests
home-network owns runtime deployment
/opt/docker is runtime copy only
```

## Why this method exists

Hermes commonly runs on `jellyberry`, while some services should run on another Docker host such as `jellyhome` because their data, related services, or hardware live there.

For example, `3dprint_loader` is developed from Hermes on `jellyberry`, but should run on `jellyhome` because Manyfold and the 3D model library are on `jellyhome`.

This method gives every deployment a code refresh without turning `/opt/docker` into a development workspace.

## Source ownership

### Application repository owns

- Application source code.
- Dockerfiles and build context.
- App tests and build checks.
- `.env.example` with non-secret defaults.
- App-specific runbook and health endpoints.
- Release branch/commit history.

### `home-network` owns

- Host placement.
- Runtime Compose service definitions.
- LAN/Tailnet ports.
- Bind mounts.
- Secret file locations.
- Service inventory.
- Backup class and restore notes.
- `/opt/docker` sync/deploy workflow.

### `/opt/docker` owns

- Runtime Compose copy generated from `home-network`.
- Host-local `.env`.
- Host-local `.secrets/`.
- Runtime appdata/state.

Do not hand-edit `/opt/docker/docker-compose.yml` or `/opt/docker/hosts/*.yaml` as the long-term source of truth.

## Standard flow

```text
1. Develop and test in the app repo on jellyberry.
2. Commit and push the app branch.
3. SSH to the runtime host, for example jellyhome.
4. Refresh the app checkout with git fetch + fast-forward only.
5. Sync home-network config to /opt/docker.
6. Rebuild/recreate the selected services.
7. Run health checks and drift checks.
```

## Runtime host checkout

Each cross-repo app should have a checkout on the runtime host at a predictable path, usually:

```text
/home/jellybot/<repo-name>
```

For `3dprint_loader` on `jellyhome`:

```text
/home/jellybot/3dprint_loader
```

The runtime checkout is not edited manually during normal deployment. It is refreshed from Git.

## Code refresh rule

Every deployment must refresh code before rebuilding containers:

```bash
cd /home/jellybot/3dprint_loader
git fetch origin
git checkout feat/initial-mvp-scaffold
git pull --ff-only origin feat/initial-mvp-scaffold
```

Use `--ff-only` so deployment does not create merge commits or silently paper over drift.

Do not use `git reset --hard` unless explicitly approved for that deployment.

## Deploy command shape

After code refresh, run Compose from `/opt/docker` using the `home-network` synced config:

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
  up -d --build --force-recreate <service-a> <service-b>
```

Use `up -d --build --force-recreate` when code, environment, ports, mounts, images, or container-create settings may have changed. A plain `restart` is not enough for those changes.

## Verification

Minimum verification after deploy:

```bash
docker ps --filter name=<service>
docker logs --tail=100 <service>
curl -fsS http://127.0.0.1:<port>/health || curl -fsS http://127.0.0.1:<port>/
cd /home/jellybot/home-network && just drift-check-strict
git status --short --branch
```

Also verify the LAN URL from another host when practical.

## Permission and access model

Hermes on `jellyberry` needs a controlled way to trigger deployments on `jellyhome`.

Supported options:

### Option A: SSH key plus `dockerops`

Recommended for frequent deployments.

- Allow `jellybot@jellyberry` to SSH to `jellybot@jellyhome`.
- Add the runtime user to `dockerops` on the runtime host.
- Ensure `/opt/docker` is `root:dockerops` and group-writable.
- Start a fresh login/session after group changes.

This gives the agent enough access to sync and deploy, so treat it as high trust.

### Option B: staged sudo scripts

Recommended when human review is required.

Hermes writes a staged script containing exact commands, and the user reviews/runs it on the runtime host.

Pros:

- Human-in-the-loop.
- No broad permanent deploy permissions.

Cons:

- Slower.
- Requires manual action each deployment.

### Option C: root-owned deploy helper

Future option for a tighter production path.

A root-owned helper or sudoers entry allows only specific operations such as:

- sync `home-network` Compose files,
- run `docker compose config`,
- recreate an allowlisted service,
- run health checks.

Use this only after the deployment command shape has stabilized.

## Secrets

Secrets must not be committed to any repository.

Use host-local paths:

```text
/opt/docker/.env
/opt/docker/.secrets/<service>/
```

For `3dprint_loader`:

```text
/opt/docker/.secrets/3dprint-loader/
/opt/docker/appdata/3dprint-loader/storage
```

Treat browser storage-state files, cookies, API tokens, and app credentials as password-equivalent secrets.

## Rollback

Rollback should be Git-first:

```bash
cd /home/jellybot/3dprint_loader
git fetch origin
git checkout <known-good-branch-or-sha>

cd /opt/docker
docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f hosts/$(hostname -s).yaml \
  up -d --build --force-recreate <service-a> <service-b>
```

For later image-based deployments, rollback by pinning an earlier image tag in `home-network` and redeploying.

## Future image-based mode

While apps are moving quickly, build from a runtime Git checkout.

Once stable, prefer immutable images:

```text
app repo CI builds image tagged with commit SHA
home-network pins that image tag
runtime host pulls and recreates containers
```

This improves rollback and reproducibility, but is heavier during active development.

## `3dprint_loader` initial recommendation

Deploy `3dprint_loader` on `jellyhome` because:

- Manyfold runs on `jellyhome`.
- The 3D model library mount is on `jellyhome`.
- Future imports avoid cross-host model file movement.

Recommended runtime layout:

```text
/home/jellybot/3dprint_loader                 # runtime source checkout
/opt/docker/appdata/3dprint-loader/storage    # runtime storage/cache
/opt/docker/.secrets/3dprint-loader/          # MakerWorld/session/API secrets
```

Recommended service names:

```text
3dprint-loader-api
3dprint-loader-web
```

Recommended first LAN port:

```text
8793
```
