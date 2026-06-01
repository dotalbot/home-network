# Consolidated Borg Management Plan

Status: phase 0 architecture/operator docs drafted
Date: 2026-06-01

## Progress checklist

- [x] Phase 0: inspect current repository backup artifacts plus local `jellyberry` runtime-facing backup status without changing live services.
- [x] Phase 0: document current-state and target backup-management architecture in `docs/architecture/consolidated-borg-management.md`.
- [x] Phase 0: document operator status, path-change, and scratch-restore workflows in `docs/guides/consolidated-backup-management-operator-guide.md`.
- [x] Phase 1: evolve `inventory/backups.yml` schema and validation for first-class destinations, backup sets, database hooks, and restore metadata.
  - [x] Add validation-only `backup_defaults`, `destinations`, host destination mappings, `backup_sets`, database hook metadata, restore metadata, Docker/remote host typing, and disabled secondary destination placeholder.
  - [x] Extend `scripts/backup-policy-check` with additive schema validation plus self-test fixtures while keeping live Borgmatic rollout behavior unchanged.
- [ ] Phase 2: split render-only Borgmatic config/systemd/restore-manifest generation from installer stages.
- [ ] Phase 3: build a read-only management surface over inventory and telemetry.
- [ ] Phase 4+: add controlled Git-reviewed edits, restore-drill automation, database pre-backup hooks, secondary destination rollout, and optional BorgWarehouse evaluation.

## Goal

Build one home-network backup management surface that answers, for every host/service:

- what is backed up;
- when it last backed up;
- which destination(s) it goes to;
- which policy/retention/check/restore class applies;
- how to safely add, change, or remove paths;
- how to run non-destructive restore drills and approved production restores;
- how database dumps are produced, included, and restored.

This must work across Docker hosts, non-Docker hosts, low-power nodes, one current backup destination, and a future second destination.

## Current foundation

The existing home-network backup platform is already a good base:

- `inventory/backups.yml` defines backup classes, restore rules, per-host important paths, the primary target, and Borgmatic telemetry settings.
- `scripts/borgmatic-rollout-generate` creates guarded per-host rollout stages and managed systemd timers.
- Borg/Borgmatic is already validated for `jellyhome`, `jellybase`, and `jellyberry`.
- Primary destination is `jellybackup` at `192.168.1.75`, using LAN IPs to avoid Tailscale overload on the backup Pi.
- Sanitized backup state already flows to:
  - node_exporter textfile metrics;
  - Prometheus;
  - Grafana Borgmatic dashboard;
  - Network Map backup cards;
  - Loki Borgmatic logs;
  - MQTT/Discord backup events.
- Central PostgreSQL logical dumps already exist separately via `scripts/postgres-logical-dump` and systemd units.

The main gap is not the backup engine. The gap is a unified management/control plane that is editable, service-aware, multi-destination-aware, and restore-aware.

## External options reviewed

### Borgmatic

Borgmatic remains the right execution layer.

Strengths:

- proven wrapper around Borg;
- works with root-owned paths;
- supports Docker and non-Docker hosts equally;
- supports hooks for database dumps;
- supports multiple repositories;
- fits systemd timers and Prometheus textfile metrics;
- already deployed here.

Weakness:

- no native friendly central UI for editing policies/restores.

Decision: keep Borgmatic as the backup engine/orchestrator.

### BorgWarehouse

BorgWarehouse is a web UI for the central Borg repository server. Its public docs describe repo creation/edit/delete, monitoring repository size/status, stale backup monitoring, API access, and setup wizard flows.

Strengths:

- good target-side UI for repository lifecycle, quotas, and stale repository visibility;
- likely useful if `jellybackup` should have a dedicated repository-management UI;
- could also be deployed on a future second self-hosted destination.

Weaknesses:

- server-side repo management only;
- does not naturally know client source paths, Docker services, database dump rules, restore classes, or home-network inventory;
- could drift from Git unless integrated deliberately;
- adds UI attack surface on the backup server.

Decision: optional later for destination/repository management, not the canonical policy source.

### Borg UI / Vorta-style interfaces

A newer Borg UI project advertises backup execution, archive browsing, restore workflows, repository management, schedules, hooks, notifications, SSH remote machine management, and multi-arch containers. Vorta remains a mature desktop Borg GUI.

Strengths:

- friendlier per-file browsing/restores;
- useful for a single workstation or ad-hoc restore workflow.

Weaknesses:

- likely duplicates Borgmatic scheduling/config;
- less aligned with Git-backed homelab policy;
- broad web UI that can execute backups/restores is high risk if exposed;
- not obviously integrated with current Prometheus/Grafana/Loki/inventory model.

Decision: do not replace the current platform with this now. Consider only as an isolated restore-browser experiment if needed.

### BorgBase or another offsite Borg target

Strengths:

- mature hosted Borg destination;
- good candidate for the second/offsite destination if self-hosting is not desired.

Weaknesses:

- hosted dependency/cost;
- still does not replace client-side Borgmatic policy and database-dump orchestration.

Decision: candidate for the future second destination, not the management plane.

## Recommended architecture

Use a hybrid GitOps model:

1. `inventory/backups.yml` remains the canonical backup policy source.
2. Borgmatic remains the execution engine on each client host.
3. Prometheus/Grafana/Loki remain the status and observability plane.
4. Add a small internal Backup Management UI/API as the management plane.
5. Optionally add BorgWarehouse later on destination hosts for repo lifecycle/quota visibility.

The custom UI should be deliberately thin. It should not become an unrestricted privileged web shell. Initial actions should produce reviewed Git changes and generated rollout artifacts, not silently mutate live `/etc/borgmatic/config.yaml` or run production restores.

## Target data model

Evolve `inventory/backups.yml` from host-level `important_paths` into a first-class model with defaults, destinations, backup sets, hooks, and restore metadata.

Sketch:

```yaml
backup_defaults:
  retention:
    keep_daily: 7
    keep_weekly: 4
    keep_monthly: 6
  checks:
    repository: true
    archives_frequency: 2 weeks
  schedule:
    on_calendar: "*-*-* 03:00:00"
    randomized_delay_sec: 30m

destinations:
  primary:
    enabled: true
    type: borg_ssh
    host: jellybackup
    address: 192.168.1.75
    ssh_user: jellybackup
    address_policy: use_lan_ip_not_fqdn
    repository_path_template: /home/jellybackup/externaldisk/borg_{host}
  secondary:
    enabled: false
    type: borg_ssh
    host: TBD
    address: TBD
    ssh_user: TBD
    repository_path_template: TBD
    purpose: future_second_destination

hosts:
  jellybase:
    borg_enabled: true
    role: secondary-monitoring-host
    destinations:
      primary:
        repository_path: /home/jellybackup/externaldisk/borg_jellybase
    backup_sets:
      - id: docker-root
        type: path
        paths:
          - /opt/docker
        excludes:
          - /opt/docker/.secrets
          - /opt/docker/appdata/*/cache
      - id: central-postgres-logical-dumps
        type: postgres_logical_dump
        service: central-postgres
        dump_command: /opt/docker/bin/postgres-logical-dump
        output_path: /opt/docker/appdata/postgres/logical-dumps
        run_before_backup: true
        restore_runbook: docs/runbooks/central-postgres-manyfold-restore.md
```

Recommended backup set types:

- `path` — generic host path backup; works for Docker and non-Docker.
- `docker_appdata` — `/opt/docker/appdata/<service>` with default Docker excludes.
- `source_repo` — source checkout/remote metadata.
- `postgres_logical_dump` — run dump before Borg create and include output path.
- `sqlite` — appdata plus `-wal`/`-shm` consistency rules.
- `media_library` — large library paths with explicit destination/retention policy.
- `config_only` — Git-backed service; no Borg payload unless runtime config exists.
- `none` — e.g. constrained sensor nodes where config is in Git and data ships elsewhere.

## Phase 1 validation-only schema notes

Phase 1 adds additive inventory fields that are ignored by the existing Borgmatic rollout generator until a later render-only phase switches over deliberately. The legacy fields `primary_target`, `hosts.<host>.repository_path`, and `hosts.<host>.important_paths` remain in place so live behavior is unchanged.

Schema additions:

- `backup_defaults` records future retention/check/schedule defaults for renderers and UI validation only.
- `destinations` declares named Borg targets. `primary` mirrors the existing `primary_target` values and still routes to `jellybackup` over `192.168.1.75`; `secondary` is explicitly `enabled: false` with TBD fields so it cannot be rendered accidentally.
- `hosts.<host>.host_type` distinguishes `docker`, `non_docker`, `hybrid`, and `remote` handling before backup sets are interpreted. Docker-specific backup sets are valid only on `docker` or `hybrid` hosts.
- `hosts.<host>.destinations.<label>` maps host repositories to destination labels. For currently validated hosts, `primary.repository_path` must match the legacy `repository_path` exactly.
- `hosts.<host>.backup_sets[]` describes payload intent without changing source paths. Each set has an `id`, `type`, optional `backup_class`, paths covered by legacy `important_paths`, destination labels, and `restore_metadata`.
- `postgres_logical_dump` backup sets make database dump hooks first-class. The current `central-postgres-logical-dumps` set records `/opt/docker/bin/postgres-logical-dump`, `run_before_backup: true`, and the existing dump output path while noting that the standalone timer remains live until a later rollout phase.
- Restore metadata and `restore_runbook` values link backup sets to scratch-first restore procedures without storing secrets or permitting production writes.
- Hosts without a confirmed repository, currently `seedbox`, keep legacy `borg_enabled: true` for compatibility with existing planning but have their phase 1 destination disabled and marked `planned_repository_path_missing`.

Validation added to `scripts/backup-policy-check` now checks the additive schema without rendering or installing anything: destination consistency, disabled secondary presence, repository path parity with legacy fields, absolute safe paths, backup set coverage by legacy source roots, database dump output coverage, Docker/non-Docker type constraints, restore rule references, and source metadata requirements.

## Management UI shape

Host it LAN/Tailnet-only, probably on `jellybase` beside Prometheus/Grafana/Network Map.

Read-only MVP:

- Hosts list: backup enabled, Docker/non-Docker, timer state, destination labels.
- Service/path view: backup sets, source paths, excludes, backup class, restore priority.
- Last run: success, age, duration, exit code, latest archive, repo reachability.
- Destination status: primary now, secondary when added.
- Database backup status: latest dump time, dump path included, last restore-drill result.
- Deep links to Grafana, Loki, Network Map, restore runbooks.

Editable MVP+:

- Add/remove/change backup paths by editing `inventory/backups.yml` through a controlled workflow.
- Validate changes before saving.
- Render Borgmatic config and show diff against current/generated config.
- Produce a commit or patch; do not live-mutate hosts silently.
- Generate per-host rollout commands/stages.

Restore MVP+:

- Select host/service/archive.
- Generate a non-destructive restore-drill command into a timestamped scratch path.
- Show runbook steps and warnings.
- Production restore remains explicit operator-approved maintenance-window flow.

Avoid in early versions:

- storing Borg passphrases or SSH private keys in the UI;
- direct production restores from the web browser;
- broad write access to `/etc/borgmatic`;
- arbitrary shell command execution;
- exposing the UI beyond LAN/Tailnet.

## Database backup integration

Current logical dumps are useful but scheduled separately from Borg. Target architecture should make database dumps first-class pre-backup dependencies.

Transition:

1. Keep existing central Postgres logical dump timer.
2. Add `postgres_logical_dump` backup set for `jellybase`.
3. Generate a pre-backup hook/wrapper step that runs `scripts/postgres-logical-dump` before `borgmatic create`.
4. Ensure `/opt/docker/appdata/postgres/logical-dumps` is included in Borg source paths.
5. Emit dump freshness/status metrics.
6. For critical DBs, a dump failure should fail the backup loudly, because an archive without a fresh logical dump is misleading.
7. Keep restore drills scratch-only by default using temporary PostgreSQL containers.

SQLite services should declare whether WAL/SHM files must be captured and whether the service needs to be stopped/checkpointed for production restores.

## Multiple destinations

Prepare for two destinations now, but enable carefully.

Borgmatic can use multiple repositories. Generated config should eventually look like:

```yaml
repositories:
  - path: ssh://jellybackup@192.168.1.75/home/jellybackup/externaldisk/borg_jellybase
    label: primary
  # future:
  # - path: ssh://...
  #   label: secondary
```

Rollout plan:

1. Add disabled secondary destination metadata.
2. Render configs with only primary active.
3. Enable secondary for one low-risk host.
4. Verify create/list/check/prune/compact behavior.
5. Add per-destination telemetry labels.
6. Roll out host-by-host.

Recommended additive metrics:

- `borgmatic_destination_last_run_success{host,destination}`
- `borgmatic_destination_repository_reachable{host,destination}`
- `home_network_backup_set_info{host,set,type}`
- `home_network_backup_policy_expected{host}`

Keep existing metrics stable for current dashboards.

## Renderer/generator evolution

Current rollout generation embeds much of the config in staged shell scripts. That works, but for a management UI and policy diffing we should split rendering from installation.

Target flow:

```text
inventory/backups.yml
        |
        v
scripts/backup-config-render
        |
        +--> build/borgmatic/<host>/config.yaml
        +--> build/systemd/<host>/*.service/*.timer
        +--> build/restore-manifests/<host>/*.json
        +--> validation report
```

Benefits:

- generated YAML is reviewable/diffable;
- live `/etc/borgmatic/config.yaml` can be compared to rendered config;
- UI can show planned changes before rollout;
- multiple destinations are easier to test;
- shell scripts become installers, not config templates.

## Restore safety model

Default restore action: drill only.

Safe flow:

1. Identify service, host, backup class, destination, and restore rule from inventory.
2. Select archive from Borg status/Grafana/Borg list.
3. Extract into a scratch path such as `/tmp/home-network-restore-drill/<service>-<timestamp>/`.
4. Validate files, ownership expectations, SQLite integrity, or PostgreSQL dump restore in scratch.
5. Only after explicit approval, run production restore:
   - stop affected services;
   - take a pre-restore local snapshot/dump;
   - replace appdata/database/library paths;
   - recreate secrets manually from host-local secret store/password manager;
   - redeploy from Git;
   - verify health;
   - keep rollback artifact until at least one successful backup cycle.

Restore tooling must refuse production-looking destinations by default, including `/`, `/opt/docker`, `/home/jellyfish/media`, database data directories, and live appdata paths unless explicit production flags are supplied.

## Phased implementation plan

### Phase 0 — Confirm current reality

- Inventory current Borgmatic config/timers on `jellyhome`, `jellybase`, and `jellyberry`.
- Compare live source paths against `inventory/backups.yml`.
- Confirm backup status metrics are current.
- Confirm PostgreSQL dump freshness and archive inclusion.

Deliverable: short current-state report and any inventory corrections.

### Phase 1 — Schema and validation

Files likely touched:

- `inventory/backups.yml`
- `scripts/backup-policy-check` or new `scripts/backup-inventory-check`
- `justfile`
- docs under `docs/operations/` and/or `docs/plans/`

Add validation for:

- enabled hosts have enabled destinations;
- paths are absolute and safe;
- dump output paths are included in source paths;
- Docker backup sets do not leak into non-Docker hosts;
- future secondary destination may exist disabled;
- restore rules exist for every policy class.

### Phase 2 — Render-only artifacts

Files likely touched:

- new `scripts/backup-config-render`
- `scripts/borgmatic-rollout-generate`
- test fixtures for rendered configs
- `docs/operations/borgmatic-host-rollout.md`

Render configs/systemd/restore manifests to `/tmp` or `build/`, validate them, and compare against current expected behavior without installing.

### Phase 3 — Read-only management UI

Implementation options:

- Extend Network Map with a Backup Management section, or
- Add a small FastAPI/React or static+API app under `docker/appdata/backup-manager`.

Recommended first cut: extend Network Map or add a simple LAN-only service on `jellybase` that reads inventory + Prometheus + runbook links. Do not add write actions yet.

### Phase 4 — Controlled edits

Add UI/API actions that create validated patches/commits for `inventory/backups.yml` and render diffs. The operator still reviews/applies rollout stages.

### Phase 5 — Restore drill automation

Add `scripts/backup-restore-drill` with service/host/archive arguments. It extracts into scratch paths and runs validators. UI can generate or launch drills only after explicit confirmation.

### Phase 6 — Database pre-backup hooks

Move logical dump freshness into Borgmatic-controlled pre-backup execution, while keeping the standalone timer until confidence is high.

### Phase 7 — Secondary destination

Add destination schema, enable one low-risk host, verify, then expand.

### Phase 8 — Optional BorgWarehouse

If desired, deploy BorgWarehouse on `jellybackup` for repo/quota/target-side visibility. Keep Git inventory canonical unless we explicitly build an API sync.

## Security boundaries

- Backup UI is LAN/Tailnet-only.
- No Borg passphrases, exported repo keys, SSH private keys, or DB passwords in Git or UI logs.
- Backup execution remains root-owned on client hosts.
- Web UI writes proposed Git changes first, not live privileged config.
- Production restore requires explicit operator approval and host-local verification.
- Secrets are restored manually from host-local secret stores/password manager, not from Git or Discord.

## Risks

- UI write actions could become dangerous if they bypass Git review.
- Multiple destinations can change runtime, prune/check/compact behavior, and network load.
- Database dump failures can block backups, but silently backing up stale DB dumps is worse.
- Existing dirty docs in the repo should not be mixed with this work accidentally.
- BorgWarehouse or Borg UI could create policy drift if allowed to become a second source of truth.

## Recommended next step

Start with Phase 0 and Phase 1:

1. Add a richer schema proposal to `inventory/backups.yml` without changing live behavior.
2. Add `scripts/backup-inventory-check` to validate the new model.
3. Keep existing Borgmatic timers/configs untouched.
4. Produce a read-only backup-management data JSON that the Network Map or a future UI can consume.

This gets us closer to the requested management interface while preserving the working backup engine. No need to throw out the current setup; Borg we go again.
