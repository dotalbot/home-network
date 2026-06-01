# Database Pre-Backup Hook Integration Plan

Status: phase 4 design; documentation-only
Date: 2026-06-01

## Goal

Make database dumps first-class Borgmatic pre-backup dependencies while preserving the existing safe runtime model: no secrets in Git/logs, no silent privileged host mutation, and no removal of the current standalone dump timer until a later confidence gate approves it.

## Current foundation

- `scripts/postgres-logical-dump` already creates central PostgreSQL logical dumps on `jellybase` under `/opt/docker/appdata/postgres/logical-dumps`.
- `inventory/backups.yml` now has validation-only backup set metadata, including PostgreSQL logical dump metadata.
- Existing Borgmatic rollout behavior still uses legacy host `important_paths` and does not yet execute database hooks as part of the managed Borgmatic wrapper.
- Restore docs already prefer scratch validation for PostgreSQL and SQLite before production restore.

## Non-goals for this phase

- Do not change live `/etc/borgmatic/config.yaml`.
- Do not enable, disable, or replace systemd timers.
- Do not run privileged host rollout scripts.
- Do not delete the standalone PostgreSQL logical dump timer.
- Do not restore any production database.

## Target model

Future render-only and rollout phases should produce a wrapper flow like this:

```text
home-network-borgmatic-run-<host>
  |
  +-- load host policy from rendered config/manifest
  +-- for each enabled pre-backup hook:
  |     +-- run hook with bounded timeout
  |     +-- write secret-free hook result
  |     +-- fail backup if required hook fails
  +-- run borgmatic create/prune/compact/check
  +-- write backup status JSON, Prometheus textfile metrics, MQTT event
```

Database hook policy belongs in `inventory/backups.yml`; rendered scripts/configs should be generated artifacts, not hand-edited runtime state.

## Hook policy schema

Recommended normalized shape for a backup set:

```yaml
hosts:
  jellybase:
    backup_sets:
      - id: central-postgres-logical-dumps
        type: postgres_logical_dump
        backup_class: postgres-volume-and-logical-dumps
        service: central-postgres
        paths:
          - /opt/docker/appdata/postgres/logical-dumps
        hook:
          id: central-postgres-logical-dump
          phase: pre_backup
          command: /opt/docker/bin/postgres-logical-dump
          run_as: root
          required: true
          timeout_seconds: 1800
          freshness_max_age_seconds: 93600
          output_path: /opt/docker/appdata/postgres/logical-dumps
          status_path: /var/lib/home-network/backup-status/postgres-logical-dump.json
        restore_runbook: docs/runbooks/central-postgres-manyfold-restore.md
        restore_metadata:
          validator: postgres_logical_dump_restore
          scratch_only_by_default: true
```

Validation rules:

- `hook.phase` must be `pre_backup` for phase 4/6 database work.
- `hook.command` must be absolute and must not contain shell metacharacters if stored as a scalar.
- `hook.output_path` must be absolute and included by the host's Borg source paths.
- Required hooks must fail the backup if the hook exits non-zero or produces stale output.
- Hook status files must be secret-free and written atomically.
- Hook logs must not print database passwords, `.env` values, or dump contents.

## PostgreSQL integration design

### Execution

Use the existing dump script as the first hook implementation target:

```text
/opt/docker/bin/postgres-logical-dump
```

Runtime assumptions:

- intended host: `jellybase`;
- container: `central-postgres` unless overridden by environment;
- output base: `/opt/docker/appdata/postgres/logical-dumps`;
- default databases: `postgres manyfold` unless overridden by environment;
- dump format: globals SQL plus per-database custom-format dumps.

### Freshness gate

A required PostgreSQL hook should be considered successful only when:

1. the hook exits `0`;
2. a new timestamped dump directory or updated `latest` symlink exists;
3. `manifest.txt` exists in the dump directory;
4. required database dump files exist for configured databases that are expected to exist;
5. dump timestamp is within `freshness_max_age_seconds` before Borg starts.

If these checks fail, the wrapper should fail before `borgmatic create`. A green Borg archive containing stale database dumps is a lie with a timestamp. Databases are where the bits get spicy.

### Telemetry

Add secret-free fields to backup status or a separate hook status JSON:

```json
{
  "hook_id": "central-postgres-logical-dump",
  "host": "jellybase",
  "service": "central-postgres",
  "status": "success",
  "exit_code": 0,
  "started_at": "2026-06-01T03:00:00Z",
  "ended_at": "2026-06-01T03:02:30Z",
  "dump_dir": "/opt/docker/appdata/postgres/logical-dumps/20260601T030000Z",
  "latest_symlink_ok": true,
  "databases": ["postgres", "manyfold"],
  "secrets_redacted": true
}
```

Suggested Prometheus metrics:

- `home_network_backup_hook_last_success_timestamp{host,hook,service}`
- `home_network_backup_hook_duration_seconds{host,hook,service}`
- `home_network_backup_hook_success{host,hook,service}`
- `home_network_backup_hook_fresh{host,hook,service}`

## SQLite integration design

SQLite-backed services need policy metadata even when no pre-backup dump command is required.

Recommended metadata:

```yaml
backup_sets:
  - id: service-sqlite
    type: sqlite
    paths:
      - /opt/docker/appdata/service/data/app.db
    sqlite:
      database_path: /opt/docker/appdata/service/data/app.db
      include_sidecars: true
      sidecars:
        - /opt/docker/appdata/service/data/app.db-wal
        - /opt/docker/appdata/service/data/app.db-shm
      consistency_mode: online_with_wal_sidecars
      production_restore_requires: stop_service_or_checkpoint
      scratch_validator: sqlite_integrity_check
```

Supported consistency modes:

- `offline_copy` — service must be stopped before backup/restore for a consistent file copy.
- `online_with_wal_sidecars` — include database plus `-wal`/`-shm`; scratch restore must copy the set together.
- `checkpoint_before_backup` — future hook may run a documented checkpoint command before Borg.

Validation rules:

- SQLite database paths must be under an approved backed-up source root.
- If `include_sidecars: true`, sidecar paths must share the same parent directory as the database file.
- Production restore must require service stop or a documented checkpoint process.
- Scratch validation must run `PRAGMA integrity_check;` on the restored copy.

## PostgreSQL restore constraints

For PostgreSQL-backed services:

- Scratch drills restore logical dumps into a temporary PostgreSQL container or scratch database only.
- Live `central-postgres` is never the target of a drill.
- Restore validators should check globals, expected database names, extensions/roles where runbooks specify them, and service-level smoke counts when safe.
- Production restore requires a service-specific runbook, maintenance window, pre-restore dump, service stop/restart plan, and explicit operator approval.
- Database passwords remain in host-local secret files or password manager; they are not stored in inventory or result manifests.

## Hook rollout phases

### Phase A — Render-only design

- Extend the future renderer to emit hook manifests per host.
- Keep generated artifacts under `/tmp` or `build/` for review.
- Run validation and fixture tests only.

### Phase B — Wrapper dry run

- Generate the wrapper command sequence without installing it.
- Confirm it calls the existing dump script with bounded timeout.
- Confirm status JSON and metrics are secret-free.

### Phase C — Manual confidence run

- Operator runs the generated hook command in a tmux pane on the owning host.
- If sudo prompts, the operator types it in tmux; the automation does not collect the password.
- Verify dump freshness and scratch restore against a temporary PostgreSQL container.

### Phase D — Managed Borgmatic pre-hook

- After review, install/update the managed host wrapper through the existing staged rollout process.
- Keep the standalone dump timer enabled initially as a fallback.
- Monitor two or more successful backup cycles.

### Phase E — Timer consolidation gate

Only after confidence:

- compare hook-driven dumps with standalone timer output;
- confirm alerts/telemetry cover dump failures;
- document rollback;
- explicitly approve disabling the standalone timer.

## tmux/sudo handoff points

The future operator flow should include these handoff points:

1. Review generated hook manifest and wrapper diff in Git.
2. In the target host tmux pane, run `hostname -s` and inspect current directory.
3. Run a non-secret preflight: container exists, output directory exists, expected dump path is covered by Borg source paths, and available disk space can hold the dump plus temporary files.
4. Run the hook manually if approved.
5. If sudo prompts, stop and let the operator type the password in the pane.
6. Run scratch restore validation from the produced dump.
7. Capture only secret-free status output.
8. Approve staged rollout only after the manual confidence run passes.

## Acceptance criteria for implementation phase

A later implementation card should be considered complete when:

- hook policy is validated from `inventory/backups.yml`;
- generated hook manifests are deterministic and reviewable;
- `scripts/postgres-logical-dump` can be executed as a required pre-backup hook without leaking secrets;
- failure of a required hook prevents a misleading successful Borg archive;
- SQLite policy metadata captures WAL/SHM and production restore constraints;
- scratch restore validators exist for PostgreSQL logical dumps and SQLite integrity checks;
- docs and runbooks state the production restore gate clearly;
- `just backup-policy-check`, syntax checks, and fixture tests pass.

## Open questions

1. Should hook status be embedded into the existing per-host backup status JSON or written as separate per-hook JSON files that the backup wrapper summarizes?
2. Which SQLite-backed services should be modeled first: Home Assistant, Mosquitto persistence, Grafana, or another service?
3. Should the first PostgreSQL scratch validator restore all configured databases every time, or restore only service-critical databases for faster drills?
4. What retention should apply to logical dump directories once Borg pre-hooks are active: current 14 days, shorter local retention, or policy-specific retention?
