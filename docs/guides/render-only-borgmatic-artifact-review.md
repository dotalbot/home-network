# Render-only Borgmatic artifact review guide

Status: phase 2 implemented; render-only, not deployed
Last updated: 2026-06-01
Related plan: `docs/plans/012-consolidated-borg-management.md`
Renderer: `scripts/borgmatic-render-generate`

## Purpose

The phase 2 renderer turns `inventory/backups.yml` into reviewable Borgmatic artifacts without installing anything.

It is safe by default because it writes only to a validated output directory. Accepted destinations are:

```text
build/borgmatic-render/
/tmp/...
```

The renderer resolves symlinks before validating the path and refuses live locations such as `/etc/borgmatic`, `/opt/docker`, `/var`, `/root`, or any other directory outside the two render roots.

It must not write `/etc/borgmatic`, `/etc/systemd/system`, `/opt/docker/bin`, secret files, repo keys, or live runtime state.

## What it renders

For each renderable Borg-enabled host with an enabled primary destination and repository path, the renderer writes:

```text
<output>/<host>/borgmatic-config.yaml
<output>/<host>/home-network-borgmatic-<host>.service
<output>/<host>/home-network-borgmatic-<host>.timer
<output>/<host>/home-network-borgmatic-<host>
<output>/<host>/restore-manifest.yaml
<output>/validation-report.json
```

Current renderable hosts are:

- `jellyhome`
- `jellybase`
- `jellyberry`

`seedbox` is intentionally skipped while its primary destination is disabled and repository path is not confirmed.

## How to render

From the repo root:

```bash
./scripts/borgmatic-render-generate --clean
```

Render to `/tmp` for a disposable review bundle:

```bash
./scripts/borgmatic-render-generate --clean --output-dir /tmp/home-network-borgmatic-render
```

Render one host:

```bash
./scripts/borgmatic-render-generate --clean --host jellybase --output-dir /tmp/home-network-borgmatic-render
```

The command prints a compact JSON summary and writes the detailed report to `validation-report.json`.

## Review checklist

Before copying anything to a host, review the generated files as a diff against the current live host config or prior render.

Minimum checks:

1. `validation-report.json` says:
   - `yaml_parsed: true`
   - `secret_scan_passed: true`
   - `live_paths_mutated: false`
2. `borgmatic-config.yaml` uses LAN repository URLs, for example `ssh://jellybackup@192.168.1.75/...`.
3. `source_directories` match the intended host policy in `inventory/backups.yml`.
4. `/opt/docker/.secrets` stays excluded.
5. `encryption_passcommand` points to a secret file path and does not contain an inline passphrase.
6. Loki labels stay low-cardinality and secret-free.
7. MQTT metadata names only broker/topic/password-file paths, not password content.
8. The systemd timer matches the inventory default schedule.
9. The restore manifest links backup sets, database hooks, restore metadata, and runbooks correctly.

Helpful commands:

```bash
python3 -m json.tool build/borgmatic-render/validation-report.json
python3 - <<'PY'
from pathlib import Path
import yaml
for path in Path('build/borgmatic-render').glob('**/*.yaml'):
    yaml.safe_load(path.read_text())
    print('ok', path)
PY
git diff --no-index /path/to/old-render build/borgmatic-render || true
```

## Promotion boundary

Rendered files are not installed automatically.

A future deploy/promote task must still:

- compare render output with current host files;
- create backups of any existing live config before overwriting;
- require explicit operator approval before writing privileged paths;
- verify Borgmatic config on the target host;
- run manual backup/check/restore-test stages before enabling timers.

This phase only creates reviewable artifacts. It does not replace the guarded rollout stages yet.

## Verification commands for contributors

Run these before committing renderer changes:

```bash
python3 -m py_compile scripts/borgmatic-render-generate
python3 -m unittest tests/test_borgmatic_render_generate.py
./scripts/borgmatic-render-generate --clean
python3 - <<'PY'
from pathlib import Path
import yaml
for path in Path('build/borgmatic-render').glob('**/*.yaml'):
    yaml.safe_load(path.read_text())
    print('parsed', path)
PY
./scripts/backup-policy-check
just backup-policy-check
git diff --check
```

If `build/borgmatic-render/` is used, it remains an ignored generated review bundle. Use `/tmp` when you want a disposable bundle outside the repo.
