# Docker Host Maintenance Control Plane Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a source-managed maintenance workflow that checks disk cleanup opportunities, Docker image/code update status, and per-host update policy, with central visibility and explicit guardrails for when cleanup/update actions are allowed to run.

**Architecture:** Add a maintenance policy model to home-network inventory, deploy read-only collectors to Docker hosts, publish proposed cleanup/update actions as JSON and Prometheus textfile metrics, and render a central dashboard in Network Map/Homepage. Execution is gated by per-host policy: `report_only`, `manual_approval`, or `automatic`, with automatic mode limited to pre-approved low-risk actions.

**Tech Stack:** YAML inventory, Python collectors, Docker CLI/Compose, systemd timers, node_exporter textfile collector, Prometheus/Alertmanager, Network Map static dashboard data.

---

## Requirements

### User-facing outcomes

- Show every Docker host in one place with:
  - root filesystem free/used percentage;
  - Docker image/build-cache/container/volume usage;
  - safe reclaim estimate;
  - stale/unused image list;
  - available image updates;
  - source-built service code update status;
  - current host maintenance mode;
  - last check time and last action time.
- Support a host-level decision:
  - `report_only`: check and display only; never mutate.
  - `manual_approval`: check and produce exact proposed commands; run only after Dominic says so.
  - `automatic`: run only actions explicitly marked safe for that host and action class.
- Make “automatic” literal: if a host/action is configured automatic, the timer actually executes the allowed action, records what happened, and emits success/failure metrics.
- Keep destructive operations out of automatic mode unless separately approved. No automatic volume deletion. No broad `docker system prune -a` by default. No service recreation for image/code updates unless policy allows it.

### Non-goals

- Do not auto-upgrade every container by default.
- Do not replace Watchtower-style behavior blindly.
- Do not mutate production compose files from the dashboard.
- Do not delete Docker volumes automatically.
- Do not restart critical services during normal checks unless the host/service policy explicitly allows it.

---

## Policy model

Add a maintenance section to `inventory/hosts.yml` for each Docker host.

Example:

```yaml
hosts:
  jellybase:
    maintenance:
      enabled: true
      mode: manual_approval   # report_only | manual_approval | automatic
      windows:
        preferred: "03:30-05:30"
        timezone: Europe/London
      disk_cleanup:
        mode: manual_approval
        root_free_warning_pct: 15
        root_free_critical_pct: 8
        allow_build_cache_prune: true
        allow_dangling_image_prune: true
        allow_unused_image_prune: false
        allow_stopped_container_prune: true
        allow_volume_prune: false
        automatic_max_reclaim_gb: 10
      image_updates:
        mode: report_only
        allow_pull: false
        allow_recreate: false
        excluded_services:
          - homeassistant
          - open-webui
      code_updates:
        mode: report_only
        allow_git_pull: false
        allow_rebuild: false
      notes:
        - "Root filesystem has previously fired FilesystemSpaceLow. Prefer manual cleanup first."
```

Suggested initial host policies:

- `jellybase`: `manual_approval`
  - Reason: current root filesystem pressure; many production services; cleanup should be staged.
- `jellyhome`: `report_only`
  - Reason: enough root space; service updates should remain operator-driven until dashboard is proven.
- `jellyberry`: `report_only`
  - Reason: Hermes/local services run here; avoid automatic service disruption.
- `jellybackup`: `report_only`
  - Reason: backup target; disk cleanup should not touch backup data.
- `jellysa`: `report_only`
  - Reason: remote/Tailscale host; lower cadence and no automatic mutation initially.

Automatic mode can be enabled later per host and per action after at least one successful manual run.

---

## Action classes

### Disk cleanup checks

Read-only checks:

- `df -B1 /`
- `docker system df --format json` where supported; fallback to `docker system df`
- `docker image ls --format json`
- `docker builder du --verbose` where supported
- stopped containers list
- dangling images list
- unused images list, excluding images used by running containers
- volume list and usage estimate, report only

Proposed low-risk cleanup actions:

- prune BuildKit build cache older than a configured age:
  - `docker builder prune --filter until=168h --force`
- prune dangling images only:
  - `docker image prune --force`
- prune stopped containers only:
  - `docker container prune --force`

Actions requiring explicit manual approval even in early rollout:

- `docker image prune -a`
- deleting named images by ID
- pruning volumes
- deleting `/tmp` content beyond clearly-owned generated temp folders
- removing service appdata

### Docker image update checks

Read-only checks:

- inspect compose source for each host;
- list services and image references;
- detect floating tags such as `latest`, `stable`, `main`;
- compare local image digest with remote registry digest when possible;
- flag pinned images that are behind only when a reliable digest/tag source exists.

Execution policy:

- `report_only`: show updates only.
- `manual_approval`: propose pull/recreate commands per service.
- `automatic`: only auto-pull/recreate services that are explicitly allowlisted and not marked critical.

Default update command shape for source-managed hosts:

```bash
cd /home/jellyfish/repo/home-network
just up <service>
```

or, where `just` is not available, the equivalent host-overlay compose command documented by the collector.

### Source-built service code update checks

Read-only checks:

- inspect services with local build contexts;
- record current checkout branch and commit;
- compare with configured upstream branch;
- mark dirty checkout as blocked for any automatic update;
- verify whether runtime service version metadata matches the checkout when available.

Execution policy:

- `report_only`: show behind/dirty status only.
- `manual_approval`: propose `git fetch`, `git pull --ff-only`, rebuild, and health checks.
- `automatic`: disabled by default; only enable per service after explicit allowlist and rollback docs exist.

---

## Central visibility design

### Data artifact

Create a generated runtime JSON file:

```text
docker/appdata/network-map/data/docker-maintenance.json
```

Suggested schema:

```json
{
  "generated_at": "2026-06-08T00:00:00Z",
  "hosts": {
    "jellybase": {
      "mode": "manual_approval",
      "last_check": "2026-06-08T00:00:00Z",
      "root": {
        "size_gb": 97.9,
        "free_gb": 9.6,
        "free_pct": 9.9,
        "status": "warning"
      },
      "docker": {
        "images_gb": 46.0,
        "build_cache_gb": 12.8,
        "safe_reclaim_gb": 4.5,
        "stopped_containers": 3,
        "dangling_images": 0,
        "unused_images": [
          {"repository": "lscr.io/linuxserver/webtop", "tag": "latest", "size_gb": 3.34}
        ]
      },
      "updates": {
        "image_updates_available": 0,
        "code_updates_available": 0,
        "blocked": []
      },
      "proposed_actions": [
        {
          "id": "jellybase-builder-prune-168h",
          "risk": "low",
          "mode_required": "manual_approval",
          "estimated_reclaim_gb": 4.5,
          "command": "docker builder prune --filter until=168h --force"
        }
      ],
      "last_action": null
    }
  }
}
```

### Dashboard UI

Add a Network Map / operations route or panel named `Docker Maintenance`.

Show:

- summary cards:
  - hosts needing attention;
  - total safe reclaim estimate;
  - hosts in automatic mode;
  - blocked updates;
- per-host cards:
  - root filesystem status;
  - Docker storage breakdown;
  - top proposed cleanup actions;
  - image/code update summary;
  - policy mode badges;
- warnings:
  - automatic mode enabled;
  - destructive action disabled;
  - dirty source checkout blocks update;
  - low root filesystem space.

Do not add dashboard action buttons in the first implementation. Generate commands for review; execution remains CLI/systemd-driven until the command authorization model is explicit.

### Prometheus metrics

Emit textfile metrics such as:

```text
home_network_docker_maintenance_root_free_pct{host="jellybase"} 9.9
home_network_docker_maintenance_safe_reclaim_bytes{host="jellybase"} 4853313044
home_network_docker_maintenance_image_updates{host="jellybase"} 0
home_network_docker_maintenance_code_updates{host="jellybase"} 0
home_network_docker_maintenance_last_check_timestamp_seconds{host="jellybase"} 1780908360
home_network_docker_maintenance_automatic_enabled{host="jellybase",action="disk_cleanup"} 0
home_network_docker_maintenance_last_action_success{host="jellybase",action="disk_cleanup"} 1
```

Add conservative alerts:

- root free below warning/critical thresholds;
- maintenance check stale;
- automatic action failed;
- proposed safe reclaim exceeds threshold while root filesystem is low.

---

## Rollout phases

### Phase 1: Read-only collector and policy

Objective: collect facts without mutation.

Files:

- Create: `scripts/docker-maintenance-check`
- Create: `scripts/lib/docker_maintenance.py`
- Modify: `inventory/hosts.yml`
- Create: `docs/operations/docker-maintenance.md`
- Test: `tests/test_docker_maintenance_policy.py`
- Test: `tests/test_docker_maintenance_parse.py`

Acceptance criteria:

- Collector reads host policy from `inventory/hosts.yml`.
- Collector can run locally on a Docker host and output JSON.
- Collector never mutates in check mode.
- Parser handles current jellybase `docker system df` output.
- JSON includes root filesystem, Docker usage, proposed actions, and policy mode.

Verification:

```bash
python -m pytest tests/test_docker_maintenance_policy.py tests/test_docker_maintenance_parse.py -v
python scripts/docker-maintenance-check --host jellybase --check-only --output /tmp/docker-maintenance-jellybase.json
python -m json.tool /tmp/docker-maintenance-jellybase.json >/dev/null
```

### Phase 2: Host runtime wrapper and systemd timer

Objective: run read-only checks on each Docker host and publish metrics/data.

Files:

- Create: `scripts/install-docker-maintenance-check`
- Create: `systemd/home-network-docker-maintenance-check.service`
- Create: `systemd/home-network-docker-maintenance-check.timer`
- Modify: `scripts/sync-docker-config` if needed for script/runtime copy.
- Modify: `docs/operations/docker-maintenance.md`

Acceptance criteria:

- Timer runs read-only by default.
- Runtime JSON is written atomically.
- Textfile metrics are written with mode `0644`.
- Failed checks produce failure metrics rather than hiding stale data.
- No sudo-required mutation occurs in this phase.

Verification:

```bash
systemctl list-timers '*docker-maintenance*' --all
systemctl start home-network-docker-maintenance-check.service
systemctl status home-network-docker-maintenance-check.service --no-pager
cat /var/lib/node_exporter/textfile_collector/docker_maintenance.prom
```

### Phase 3: Central dashboard

Objective: make maintenance status visible from the existing Network Map / dashboard flow.

Files:

- Modify: `docker/appdata/network-map/` dashboard source files.
- Modify: Network Map data generation scripts as needed.
- Modify: `docs/operations/network-map-dashboard.md`.

Acceptance criteria:

- Dashboard shows one card per Docker host.
- jellybase root filesystem warning is visible.
- Proposed cleanup actions are shown as text, not buttons.
- Host policy mode is visible.
- Stale check data is obvious.

Verification:

```bash
python scripts/render-network-map-data  # or repo-specific generator command
just sync-docker-config
just up network-map
curl -fsS http://jellybase:<network-map-port>/data/docker-maintenance.json | python -m json.tool >/dev/null
```

Then browser-verify the live dashboard route.

### Phase 4: Manual execution path

Objective: allow an operator-approved cleanup/update run with exact command logging.

Files:

- Modify: `scripts/docker-maintenance-check` to add `--execute-action <id>`.
- Create: `scripts/docker-maintenance-apply` if clearer.
- Modify: tests and docs.

Acceptance criteria:

- Manual execution requires an action ID generated by the latest check.
- Action ID includes host and action class.
- Script refuses stale action plans.
- Script refuses destructive actions unless `--allow-high-risk` is passed.
- Script logs before/after disk state and command result.
- Script updates `last_action` JSON and Prometheus metrics.

Verification:

```bash
python scripts/docker-maintenance-check --host jellybase --check-only --output /tmp/plan.json
python scripts/docker-maintenance-apply --host jellybase --plan /tmp/plan.json --execute-action jellybase-builder-prune-168h --dry-run
```

Only after dry-run looks right, execute a low-risk action manually.

### Phase 5: Controlled automatic mode

Objective: make `automatic` mode real, but narrow.

Files:

- Modify: policy schema and validators.
- Modify: systemd service wrapper to execute allowed automatic actions.
- Modify: Prometheus alert rules.
- Modify: docs.

Acceptance criteria:

- Automatic actions run only inside configured maintenance windows.
- Automatic actions run only if host and action class are both `automatic`.
- Automatic disk cleanup is limited to configured low-risk actions and reclaim caps.
- Automatic image/code updates require per-service allowlists.
- Dirty checkout, missing backup, service health failure, or active critical alert blocks automatic update actions.
- Every automatic action records before/after state and emits success/failure metrics.

Initial automatic candidate:

- Build cache prune older than 7 days on a non-critical host after at least one manual success.

Do not initially enable automatic image/code updates.

---

## Decision matrix

### Disk cleanup

| Condition | report_only | manual_approval | automatic |
| --- | --- | --- | --- |
| Root free above warning | Show only | Show proposed cleanup | Optional no-op |
| Root free below warning | Show warning | Propose low-risk cleanup | Run allowlisted low-risk cleanup if configured |
| Root free below critical | Alert | Propose urgent cleanup | Run allowlisted low-risk cleanup, alert if still critical |
| Volume prune proposed | Show disabled | Require explicit command and confirmation | Never by default |

### Docker image updates

| Service class | Default | Automatic allowed? |
| --- | --- | --- |
| Monitoring stack | manual_approval | Later, per-service only |
| Home Assistant | report_only | No by default |
| Databases | report_only | No |
| Webtop/desktop services | manual_approval | Possible later |
| Small stateless dashboards | manual_approval | Possible after health checks |

### Code updates

| State | Decision |
| --- | --- |
| Clean checkout, behind origin | Propose update |
| Dirty checkout | Block; show dirty files |
| Branch not expected branch | Block; show branch |
| Build context missing | Block |
| Health check missing | Manual only |
| Backup/rollback missing for stateful service | Manual only |

---

## Immediate jellybase recommendation

Current live state from 2026-06-08 check:

- `/` on jellybase is 90% used with ~9.7 GiB free.
- Prometheus alert `FilesystemSpaceLow` is firing.
- Docker reports:
  - images: ~46.0 GB;
  - build cache: ~12.8 GB;
  - reclaimable images: ~7.9 GB;
  - reclaimable build cache: ~4.5 GB.

Recommended first manual cleanup candidate:

1. Run read-only collector once.
2. If plan matches the current evidence, manually prune old build cache.
3. Recheck `df -hT /` and Prometheus alert state.
4. Review unused images separately before removing any image used by a recently retired service.

Do not run broad `docker system prune -a` as the first step.

---

## Safety and rollback

- Every mutating action must record:
  - host;
  - user;
  - timestamp;
  - exact command;
  - before/after disk state;
  - before/after container list;
  - exit code;
  - log excerpt.
- Never print secrets or environment files.
- Do not delete volumes automatically.
- Do not auto-update stateful services without backup and restore docs.
- Use `docker compose up -d <service>` rather than `restart` when image/env/mounts change.
- If an update recreates a service, verify health endpoint and/or expected reachable HTTP status.
- Rollback for image updates should include previous image ID and compose command to redeploy it where practical.

---

## Implementation checklist

- [ ] Add maintenance policy schema to `inventory/hosts.yml`.
- [ ] Add unit tests for policy parsing and action gating.
- [ ] Add read-only Docker maintenance collector.
- [ ] Validate collector on jellybase without mutation.
- [ ] Add textfile Prometheus metrics.
- [ ] Add systemd service/timer templates.
- [ ] Deploy read-only checks to one host first: jellybase.
- [ ] Add central `docker-maintenance.json` aggregation.
- [ ] Add Network Map / dashboard view.
- [ ] Add Prometheus alerts for stale check and low root space with reclaimable cleanup.
- [ ] Add manual action execution by action ID.
- [ ] Manually execute one low-risk jellybase build-cache prune.
- [ ] Recheck root filesystem and alert state.
- [ ] Decide whether any host graduates from `report_only` to `manual_approval`.
- [ ] Decide whether any low-risk action graduates to `automatic`.
- [ ] Keep image/code updates in report-only until per-service policies and health checks are proven.

---

## Open questions for Dominic

These are not blockers for Phase 1 read-only work, but they control later automation:

1. Which hosts, if any, should start in `manual_approval` besides jellybase?
2. Should old build cache pruning be allowed automatically after one successful manual run?
3. Which services are acceptable candidates for automatic image pull/recreate later?
4. Should image update checks include floating-tag warnings only, or also registry digest comparison?
5. Should the dashboard live inside Network Map, Homepage, or a separate Maintenance page?

Default if no answer: implement Phase 1-3 as read-only/reporting, with jellybase in `manual_approval` for proposed cleanup only.
