# Consolidated Backup Management Operator Guide

Status: phase 0 operator guide
Last updated: 2026-06-01

## Purpose

This guide explains how a human operator should view backup status, request backup path changes, and perform scratch restores in the consolidated Borg management model.

The current platform is GitOps-first:

- `inventory/backups.yml` is the canonical backup policy source.
- Borgmatic runs on each client host and writes to host-specific repositories on `jellybackup` over the LAN IP `192.168.1.75`.
- Operators review Git changes and run staged rollout scripts; web/UI workflows should not silently mutate live privileged config.
- Restore drills use scratch paths by default. Production restores require explicit approval and maintenance-window handling.

## Quick status checklist

Use this order when checking whether backups are healthy:

1. Check the Network Map backup cards for a quick host-level view.
2. Check the Grafana Borgmatic dashboard for recent metrics and trends.
3. Check Loki/Grafana Explore for Borgmatic logs if a host is failing.
4. Check Discord backup events for recent start/success/failure notifications.
5. On a host, read the sanitized JSON status file if needed:

```bash
python3 -m json.tool /var/lib/home-network/backup-status/$(hostname -s).json
```

6. On a host, check the managed timer:

```bash
systemctl list-timers 'home-network-borgmatic*' --all --no-pager
systemctl status home-network-borgmatic-$(hostname -s).timer --no-pager
```

7. Only when needed, inspect Borgmatic directly from the host that owns the backup. Do not print passphrases, exported repo keys, private keys, or raw secret files.

## What each status surface means

| Surface | Best for | Notes |
|---|---|---|
| Network Map backup cards | Fast green/amber/red host summary | Uses collected non-secret backup telemetry. |
| Grafana Borgmatic dashboard | History, age, failures, duration, repository reachability | Source-managed dashboard lives under `docker/appdata/grafana-provisioning/dashboards/json/`. |
| Loki | Borgmatic logs | Keep labels low-cardinality and secret-free. |
| Discord backup events | Operator notifications | MQTT bridge should emit compact non-secret messages only. |
| `/var/lib/home-network/backup-status/<host>.json` | Local host truth for Hermes/Discord summaries | Contains host, status, exit code, duration, archive name, and repository reachability. |
| `/var/lib/node_exporter/textfile_collector/borgmatic_<host>.prom` | Prometheus scrape input | Written by the root-owned Borgmatic wrapper when the textfile directory exists. |

A healthy host should normally have:

- recent `updated_at`/timestamp;
- `status: success` or success metric `1`;
- `exit_code: 0`;
- repository reachability `true`/`1`;
- a latest archive name matching the host prefix;
- an enabled managed timer if that host is expected to run scheduled backups.

## How to request a backup path change

Path changes should go through Git review before rollout.

### Safe request format

When requesting a path addition/removal/change, include:

- host name, for example `jellybase`;
- service name, for example `central-postgres` or `manyfold`;
- exact source path, for example `/opt/docker/appdata/postgres/logical-dumps`;
- backup class or restore priority;
- whether the path contains secrets;
- whether the service must be stopped or dumped first for consistency;
- desired restore behavior, for example scratch drill only or production restore runbook needed.

Example:

```text
Add /opt/docker/appdata/example/data to jellybase backups.
Service: example-api.
Class: appdata-and-database.
Consistency: requires logical dump before Borgmatic.
Restore: scratch restore should validate database dump before production restore.
Secrets: no known secrets under this path.
```

### Review workflow

1. Edit `inventory/backups.yml` on a feature branch.
2. Add or update a runbook under `docs/runbooks/` if restore behavior changes.
3. Update architecture/operator docs if the workflow changes.
4. Run validation:

```bash
git diff --check
python3 - <<'PY'
from pathlib import Path
import yaml
for path in ['inventory/backups.yml']:
    yaml.safe_load(Path(path).read_text())
    print(f'ok {path}')
PY
just backup-policy-check
```

5. Generate rollout artifacts for review without installing them:

```bash
BORG_ROLLOUT_OUTPUT_DIR=/tmp/borgmatic-rollout-review scripts/borgmatic-rollout-generate
```

6. Review the generated host stages before running anything with `sudo`.
7. Commit/push the branch and have a human review it.
8. Only after approval, run the relevant generated stages manually on the matching host.

### Rules for paths

- Paths must be absolute.
- Do not add `/opt/docker/.secrets` or secret directories.
- Avoid cache, temp, logs, build artifacts, and generated files unless there is a clear restore reason.
- For databases, prefer consistent logical dumps plus clear restore runbooks.
- For SQLite, include WAL/SHM rules and consider service stop/checkpoint requirements for production restores.
- For large media/library paths, document expected size and destination impact.

## How to perform a scratch restore drill

Scratch restore drills prove that an archive is usable without touching production paths. The detailed phase 4 safety model lives in `docs/operations/backup-restore-drill-safety.md`; use it as the canonical guide for future restore-drill automation, approval gates, validators, and tmux/sudo handoff points.

### Before you start

Confirm:

- the host that owns the archive;
- the destination repository label, currently primary only;
- the service/path to restore;
- the restore rule in `inventory/backups.yml`;
- the runbook under `docs/runbooks/`;
- the archive name or selection policy, for example latest successful archive;
- the scratch destination, normally under `/tmp`.

Never restore directly into these paths during a drill:

- `/`
- `/opt/docker`
- live `/opt/docker/appdata/...`
- live database directories
- `/home/jellyfish/media/...`
- any existing production mount or bind-mounted appdata path

### Generic scratch restore shape

Run from the host that owns the Borgmatic config and repository access. The commands below are operator-run examples for future drills; they were not executed while producing this phase 0 documentation.

```bash
host="$(hostname -s)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
restore_dir="/tmp/home-network-restore-drill/${host}-${stamp}"
sudo install -d -m 0755 "$restore_dir"

# Example only: replace the path with the approved path from the runbook.
sudo borgmatic extract --archive latest \
  --path opt/docker/.home-network-backup-sentinel \
  --destination "$restore_dir"
```

Then validate the restored data. Examples:

```bash
# File/sentinel comparison example
sudo diff -q /opt/docker/.home-network-backup-sentinel \
  "$restore_dir/opt/docker/.home-network-backup-sentinel"
```

```bash
# SQLite example; adjust database path from the runbook
sqlite3 "$restore_dir/path/to/database.sqlite" 'PRAGMA integrity_check;'
```

```bash
# PostgreSQL logical dump example; use a temporary container/network only
# and follow the service-specific runbook.
```

Record the drill outcome in the relevant runbook, task, or future management UI:

- host;
- archive;
- paths restored;
- scratch destination;
- validators run;
- pass/fail result;
- cleanup action.

### Cleanup

After validation and recording results:

```bash
sudo rm -rf -- "$restore_dir"
```

Only remove the scratch directory you created. Do not use broad globs.

## Production restore gate

A production restore is not a scratch drill. It requires explicit operator approval and a service-specific runbook.

Minimum gate before production restore:

1. Confirm the service owner and user impact.
2. Confirm the archive and backup destination.
3. Confirm secrets are available outside Git.
4. Take a pre-restore local snapshot or dump when possible.
5. Stop affected services.
6. Restore data to the production path.
7. Recreate secrets manually from the host-local secret store or password manager.
8. Redeploy from Git.
9. Verify health checks and expected data.
10. Keep rollback artifacts until at least one later successful backup cycle.

## Database restores

The database hook design lives in `docs/plans/014-database-pre-backup-hooks.md`. Treat that plan as the current design source for PostgreSQL pre-backup hooks, SQLite WAL/SHM constraints, scratch validators, and timer consolidation gates.

For central PostgreSQL services:

- Prefer scratch restore drills using logical dumps under `/opt/docker/appdata/postgres/logical-dumps`.
- Restore into a temporary PostgreSQL container for validation.
- Validate required databases, globals, extensions, roles, and service-level counts.
- Do not print database passwords, `.env` values, or raw secret files.

For SQLite services:

- Restore database files plus `-wal` and `-shm` sidecars when present.
- Run `PRAGMA integrity_check;` against the scratch copy.
- For production restore, stop the service or follow its checkpoint procedure before replacing live files.

## Future management UI behavior

The future Backup Management UI/API should initially be read-only:

- show hosts, backup classes, important paths, destination labels, and restore priority;
- show latest success/failure, backup age, duration, exit code, latest archive, and repository reachability;
- show database dump freshness and restore-drill status;
- link to Grafana, Loki, Network Map, and runbooks.

When editable workflows are added, the UI should:

- validate requested path changes;
- show a diff against `inventory/backups.yml`;
- render Borgmatic config/systemd/restore-manifest artifacts for review;
- create a patch, branch, or commit for human review;
- generate operator-run rollout stages;
- avoid direct production restores and avoid arbitrary shell execution.

## Troubleshooting quick reference

| Symptom | First checks | Likely next action |
|---|---|---|
| Backup card is red | JSON status, Grafana, Loki | Inspect wrapper result and Borgmatic logs on owning host. |
| Backup card is amber/stale | Timer status and last run timestamp | Check if host is online and managed timer is enabled. |
| Repository unreachable | LAN IP `192.168.1.75`, SSH from runtime user, repo path | Verify root SSH and host-specific repository directory. |
| Missing Prometheus metrics | textfile directory and node_exporter config | Ensure wrapper can write `.prom` and node_exporter scrapes it. |
| Discord event missing | MQTT retained/event topics, bridge service | Check bridge service and password file permissions without printing values. |
| PostgreSQL archive stale | dump timer/hook and dump directory | Validate `scripts/postgres-logical-dump` and include dump path in Borg source paths. |
| Generated rollout skips host | `hosts.<name>.repository_path` missing | Add destination policy only after target repo/access is designed. |

## Secret-handling reminders

Do not paste, commit, log, or send:

- Borg passphrases;
- exported Borg repo keys;
- SSH private keys;
- database passwords;
- MQTT passwords;
- `.env` contents;
- raw file listings from sensitive appdata if they reveal private paths or names.

It is OK to record secret file paths and permissions, for example `/opt/docker/.secrets/borgmatic-passphrase` with mode `0600`, as long as values are not shown.
