# Plan: Deploy LinuxServer Webtop on jellybase and jellyhome

## Goal

Deploy `lscr.io/linuxserver/webtop:latest` to both `jellybase` and `jellyhome` through the `home-network` repository, with persistent `/config`, LAN/Tailscale-only exposure, basic authentication, and documented operational/restore notes.

This is a plan-only pass. No runtime changes have been made.

## Current context

Repository:

- Source of truth: `/home/jellybot/home-network`
- Current branch/status inspected: `main`, clean and up to date with `origin/main`
- Routine `home-network` work is allowed directly on `main`, but this plan does not implement yet.

Existing host Compose files:

- `docker/hosts/jellybase.yaml`
- `docker/hosts/jellyhome.yaml`

Existing relevant ports:

jellybase:

- `80` Homepage
- `3001` Grafana host port to container `3000`
- `7007` Dozzle agent
- `8793` Jellyfood web
- `8794` Jellyfood API
- `8788` Network Map
- `9000`, `9001`, `9090`, `9093`, `3100`, `11235`, `5432`, `12345` already used

jellyhome:

- `80` Homepage
- `8080` Dozzle
- `9443` Portainer
- `3214` Manyfold
- `8793` 3dprint-loader web
- `18888`, `9999` Hindsight
- `1883`, `9001`, `12345` already used

LinuxServer Webtop documentation facts checked from upstream README:

- Image: `lscr.io/linuxserver/webtop:latest`
- `latest` tag is XFCE Alpine.
- Architectures: x86-64 and arm64 are supported.
- Browser endpoint defaults:
  - HTTP internal port: `3000` but docs say HTTP must be proxied.
  - HTTPS internal port: `3001`; docs say app can be accessed at `https://yourhost:3001/`.
- Required/basic params:
  - `PUID=1000`
  - `PGID=1000`
  - `TZ=...`
  - `/config` persistent volume
  - `shm_size: "1gb"` recommended for desktop images
- Security warning from docs:
  - No auth by default.
  - Optional `CUSTOM_USER` and `PASSWORD` enable basic HTTP auth.
  - The web interface includes terminal/passwordless sudo inside the container.
  - Do not expose to the Internet unless properly secured.
- Useful hardening variables:
  - `HARDEN_DESKTOP=true` enables `DISABLE_OPEN_TOOLS`, `DISABLE_SUDO`, and `DISABLE_TERMINALS` plus related Selkies UI restrictions.
  - Individual hardening flags include `DISABLE_SUDO`, `DISABLE_TERMINALS`, and `DISABLE_OPEN_TOOLS`.
- GPU/Wayland is available but optional. For a first safe deployment, avoid device passthrough and avoid `seccomp=unconfined` unless needed after testing.

## Key decisions to confirm before implementation

1. Authentication secret

   Recommended: use a generated strong password stored outside Git.

   Proposed runtime files:

   - `/opt/docker/.secrets/webtop-jellybase/password`
   - `/opt/docker/.secrets/webtop-jellyhome/password`

   Compose can use LinuxServer's `FILE__PASSWORD=/run/secrets/webtop_password` pattern so the password is not committed.

   Question: do you want the same username/password on both hosts, or separate per-host passwords?

2. Username

   Proposed default:

   - `CUSTOM_USER=dominic`

   Question: is `dominic` OK, or do you want something else?

3. Ports

   Because Webtop's preferred browser endpoint is HTTPS on internal `3001`, expose that only on LAN/Tailscale-bound addresses, not all interfaces.

   Proposed host ports:

   - jellybase LAN: `https://192.168.1.2:30301`
   - jellybase Tailscale: `https://100.125.86.118:30301`
   - jellyhome LAN: `https://192.168.1.1:30301`
   - jellyhome Tailscale: `https://100.90.175.59:30301`

   Alternative if you want host-unique ports:

   - jellybase: `30301`
   - jellyhome: `30302`

   Recommended: same port `30301` on each host because host IP disambiguates and makes URLs memorable.

4. Desktop capability level

   Recommended initial setting:

   - `HARDEN_DESKTOP=true`
   - `START_DOCKER=false`
   - no Docker socket mount
   - no `privileged`
   - no `/dev/dri` GPU passthrough initially
   - no `seccomp=unconfined` initially

   This gives browser desktop access while avoiding the most risky “remote root-ish workstation” shape.

   Question: do you want full desktop freedom inside the container, or a hardened safer desktop first?

5. Persistence and backup class

   Proposed persistent paths:

   - `/opt/docker/appdata/webtop-jellybase/config:/config` on jellybase
   - `/opt/docker/appdata/webtop-jellyhome/config:/config` on jellyhome

   Proposed backup class:

   - `appdata`, because user home/config inside the webtop is persistent and likely useful.

   Question: should these webtops be treated as disposable sandboxes instead? If yes, we can mark backup as `config-only` or create a new `disposable-appdata` class.

## Proposed approach

Add one Webtop service per host, with host-specific container names and appdata paths. Keep the services source-managed in `home-network`, deploy via the existing `/opt/docker` sync path, and document both operational access and security caveats.

I recommend naming services:

- `webtop-jellybase`
- `webtop-jellyhome`

This avoids duplicate container names when viewing from Portainer/Dozzle and makes service inventory clear.

## Likely Compose shape

### jellybase service draft

File: `docker/hosts/jellybase.yaml`

```yaml
  webtop-jellybase:
    image: lscr.io/linuxserver/webtop:latest
    container_name: webtop-jellybase
    restart: unless-stopped
    shm_size: "1gb"
    ports:
      - "192.168.1.2:${WEBTOP_JELLYBASE_PORT:-30301}:3001"
      - "100.125.86.118:${WEBTOP_JELLYBASE_PORT:-30301}:3001"
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: ${TZ}
      CUSTOM_USER: ${WEBTOP_USER:-dominic}
      FILE__PASSWORD: /run/secrets/webtop_password
      TITLE: Jellybase Webtop
      HARDEN_DESKTOP: "true"
      START_DOCKER: "false"
    secrets:
      - webtop_jellybase_password
    volumes:
      - /opt/docker/appdata/webtop-jellybase/config:/config
    security_opt:
      - no-new-privileges:true
```

Secrets block addition in same file:

```yaml
secrets:
  webtop_jellybase_password:
    file: /opt/docker/.secrets/webtop-jellybase/password
```

Need to merge with any existing `secrets:` block if present.

### jellyhome service draft

File: `docker/hosts/jellyhome.yaml`

```yaml
  webtop-jellyhome:
    image: lscr.io/linuxserver/webtop:latest
    container_name: webtop-jellyhome
    restart: unless-stopped
    shm_size: "1gb"
    ports:
      - "192.168.1.1:${WEBTOP_JELLYHOME_PORT:-30301}:3001"
      - "100.90.175.59:${WEBTOP_JELLYHOME_PORT:-30301}:3001"
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: ${TZ}
      CUSTOM_USER: ${WEBTOP_USER:-dominic}
      FILE__PASSWORD: /run/secrets/webtop_password
      TITLE: Jellyhome Webtop
      HARDEN_DESKTOP: "true"
      START_DOCKER: "false"
    secrets:
      - webtop_jellyhome_password
    volumes:
      - /opt/docker/appdata/webtop-jellyhome/config:/config
    security_opt:
      - no-new-privileges:true
```

Secrets block addition in same file:

```yaml
secrets:
  webtop_jellyhome_password:
    file: /opt/docker/.secrets/webtop-jellyhome/password
```

Need to merge with existing `secrets:` block in `jellyhome.yaml`, which currently has Manyfold/Postgres secrets.

## Step-by-step implementation plan

### Phase 0: Confirm decisions

Ask/confirm:

1. Username: `dominic` or another username?
2. Same password both hosts, or unique per host?
3. Port: use `30301` on both hosts, or unique ports?
4. Hardened desktop first, or full-powered desktop?
5. Back up Webtop appdata or treat as disposable?

If the user says “use your defaults”, proceed with:

- username `dominic`
- unique generated password per host
- port `30301` on both hosts
- hardened desktop first
- backup class `appdata`

### Phase 1: Repo changes

Edit source-of-truth files only:

- `docker/hosts/jellybase.yaml`
- `docker/hosts/jellyhome.yaml`
- `inventory/services.yml`
- `inventory/backups.yml` only if a new backup class is needed; otherwise no change.
- `docs/operations/webtop.md` new runbook.
- Possibly `docker/appdata/homepage/services.yaml` only if Homepage is manually curated there; otherwise use existing render/inventory flow if applicable.

Inventory additions:

Add service entries under `inventory/services.yml`:

- `webtop-jellybase`
- `webtop-jellyhome`

Include:

- category: Tools
- mode: host-local-desktop
- host/container mapping
- URLs for LAN and Tailscale
- description with explicit trusted-LAN/Tailscale security boundary
- backup: `appdata`
- status: active after successful deployment, or planned before deploy

### Phase 2: Secret/appdata bootstrap

On each host, create secret and appdata directories outside Git:

- `/opt/docker/.secrets/webtop-jellybase/password`
- `/opt/docker/.secrets/webtop-jellyhome/password`
- `/opt/docker/appdata/webtop-jellybase/config`
- `/opt/docker/appdata/webtop-jellyhome/config`

Recommended permissions:

- secrets dirs: `root:dockerops 0750` or stricter
- password file: `root:dockerops 0640`
- appdata config: owned by UID/GID matching container `PUID=1000`, `PGID=1000`

Generate passwords without printing them in logs/chat. If the user needs them, provide via their preferred secure channel or tell them the file paths and retrieval command to run locally.

### Phase 3: Validate Compose

From `/home/jellybot/home-network`:

```bash
git diff --check
python3 - <<'PY'
import yaml
for p in ['docker/hosts/jellybase.yaml', 'docker/hosts/jellyhome.yaml', 'inventory/services.yml']:
    with open(p) as f:
        yaml.safe_load(f)
    print('yaml ok', p)
PY
```

After syncing to runtime hosts:

On jellybase:

```bash
cd ~/repo/home-network
git pull --ff-only origin main
just sync-docker-config
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml config >/tmp/jellybase-compose.yml
```

On jellyhome:

```bash
cd ~/repo/home-network
git pull --ff-only origin main
just sync-docker-config
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml config >/tmp/jellyhome-compose.yml
```

### Phase 4: Deploy one host at a time

Deploy jellybase first:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellybase.yaml up -d webtop-jellybase
```

Verify:

```bash
docker ps --filter name=webtop-jellybase
curl -kfsS https://192.168.1.2:30301/ >/tmp/webtop-jellybase.html
curl -kfsS https://100.125.86.118:30301/ >/tmp/webtop-jellybase-ts.html
```

Then deploy jellyhome:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellyhome.yaml up -d webtop-jellyhome
```

Verify:

```bash
docker ps --filter name=webtop-jellyhome
curl -kfsS https://192.168.1.1:30301/ >/tmp/webtop-jellyhome.html
curl -kfsS https://100.90.175.59:30301/ >/tmp/webtop-jellyhome-ts.html
```

Note: `curl -k` is expected because LinuxServer Webtop uses a self-signed certificate by default.

### Phase 5: Browser/user verification

Because Webtop is graphical, CLI verification only proves the service is reachable. Final acceptance should include browser verification from the user's machine:

- Open `https://192.168.1.2:30301/`
- Open `https://192.168.1.1:30301/`
- Accept self-signed cert warning if expected.
- Log in with configured basic auth.
- Confirm desktop loads.
- Confirm keyboard/mouse input works.
- Confirm basic app launch works.

Optional browser automation can inspect page title/HTTP auth challenge, but the useful proof is a human seeing the desktop stream.

### Phase 6: Homepage / dashboard links

Add links after the service is confirmed healthy:

- Homepage service/link entries for both webtops.
- Optionally Network Map/service inventory link if generated from inventory.

Recommended labels:

- Webtop jellybase
- Webtop jellyhome

URLs:

- `https://192.168.1.2:30301`
- `https://192.168.1.1:30301`

### Phase 7: Commit/push

After runtime verification:

```bash
git status --short --branch
git diff --check
git add docker/hosts/jellybase.yaml docker/hosts/jellyhome.yaml inventory/services.yml docs/operations/webtop.md [homepage files if changed]
git commit -m "feat: add webtop desktops"
git push origin main
```

## Files likely to change

Required:

- `docker/hosts/jellybase.yaml`
- `docker/hosts/jellyhome.yaml`
- `inventory/services.yml`
- `docs/operations/webtop.md`

Possibly:

- `inventory/backups.yml` if adding a disposable/sandbox backup class.
- `docker/appdata/homepage/services.yaml` if links are not generated from inventory.
- Generated network map/homepage artifacts if the repo's render scripts intentionally update them.

Runtime-only, not committed:

- `/opt/docker/.secrets/webtop-jellybase/password`
- `/opt/docker/.secrets/webtop-jellyhome/password`
- `/opt/docker/appdata/webtop-jellybase/config`
- `/opt/docker/appdata/webtop-jellyhome/config`

## Tests / validation

Repo-level:

- YAML parse for changed YAML files.
- `git diff --check`.
- `just compose-config` where applicable, or explicit `docker compose --env-file .env -f docker-compose.yml -f hosts/<host>.yaml config` on each target host.
- If inventory/render scripts are touched:
  - `just homepage-render`
  - `just network-map-render`
  - `just drift-check-strict` after deploy.

Runtime-level:

- `docker ps` shows both containers healthy/running.
- `docker logs --tail=100 webtop-jellybase` has no fatal errors.
- `docker logs --tail=100 webtop-jellyhome` has no fatal errors.
- `curl -kI https://<host-ip>:30301/` returns HTTP response.
- If auth is enabled, unauthenticated access should get `401` or browser auth challenge depending endpoint behavior.
- Authenticated browser session reaches desktop.
- Confirm service is not bound to unwanted interfaces if we use explicit LAN/Tailscale bind addresses.

Security validation:

- No Docker socket mounted.
- No `privileged: true`.
- No `seccomp=unconfined` unless explicitly needed later.
- No password committed in Git.
- Service is bound to LAN/Tailscale IPs only, not `0.0.0.0`, unless user explicitly approves wider exposure.

Backup validation:

- `backup-policy-check` still passes.
- Webtop appdata paths are covered by existing Borg include rules or explicitly documented as restore paths.

## Risks and tradeoffs

1. Security exposure

   Webtop is a browser-accessible desktop with a terminal. Even without host Docker socket, it is a powerful interactive surface. Keep it LAN/Tailscale-only and authenticated.

2. Self-signed certificate

   The default HTTPS endpoint uses a self-signed cert. Browsers will warn. This is acceptable for initial LAN/Tailscale deployment, but a reverse proxy with trusted TLS would be cleaner later.

3. Basic auth limitations

   LinuxServer docs say `CUSTOM_USER`/`PASSWORD` basic auth is suitable only for trusted local networks. Do not expose this directly to the Internet.

4. Hardening may reduce usefulness

   `HARDEN_DESKTOP=true` disables sudo/terminals/open tools inside the desktop. That is safer, but if the goal is a full remote admin workstation, the user may want less hardening. Start hardened, loosen deliberately.

5. Resource use

   GUI desktops can use more CPU/RAM than small services. `shm_size: 1gb` is recommended. Monitor after deployment.

6. GPU acceleration uncertainty

   Not using `/dev/dri` is safer and portable. If performance is poor, add GPU passthrough later as a separate change after checking host GPU devices and kernel/libseccomp compatibility.

7. Port collisions

   Proposed `30301` appears unused in repo Compose definitions, but runtime should still be checked with `ss -ltnp` on both hosts before deployment.

## User decisions

Confirmed by the user before implementation:

1. Username: use `dominic`.
2. Passwords: generated unique per-host passwords are fine.
3. Ports: use `30301` on both hosts.
4. Capability profile: start with the hardened/test profile first.
5. Persistence: back up `/config` appdata.
