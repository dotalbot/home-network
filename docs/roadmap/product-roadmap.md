# Home Network Platform Roadmap

Status: draft
Last updated: 2026-05-21

## North star

A dead machine should be an inconvenience, not a disaster.

The platform should make the home lab understandable, reproducible, observable, and recoverable through Git-backed inventory, Docker Compose source-of-truth files, clear runbooks, scheduled checks, and verified backups.

## Completed so far

These stages are considered completed or substantially in place:

1. Repo structure
   - Standard repo layout exists: `inventory/`, `docker/`, `scripts/`, `docs/`, `bootstrap/`, and `justfile`.
   - Root `README.md` documents the operator model.

2. Host inventory
   - Host metadata is tracked in `inventory/hosts.yml`.
   - Known platform hosts include `jellyhome`, `jellybase`, `jellyberry`, `jellybackup`, and `seedbox`.

3. Deployrr-style Docker layout
   - Shared base Compose file: `docker/docker-compose.yml`.
   - Host overlays: `docker/hosts/<hostname>.yaml`.
   - Runtime path convention: `/opt/docker`.
   - Sync tooling: `scripts/sync-docker-config` and `just sync-docker-config`.

4. Shared management stack
   - Homepage, Dozzle, Portainer, Netdata, Prometheus, and Grafana are represented in service inventory and Compose/runtime docs.

5. Homepage generation
   - `scripts/homepage-render` renders Homepage config from inventory.
   - `just homepage-deploy` renders, syncs, and deploys.

6. Network Map generation
   - Network Map is rendered from inventory into `docker/appdata/network-map/site/`.
   - Operational docs exist in `docs/operations/network-map-dashboard.md` and `docs/operations/safe-network-discovery.md`.

7. Drift detection
   - `scripts/drift-check` and `just drift-check-strict` compare expected vs running containers.

8. Backup policy
   - `inventory/backups.yml` defines backup classes and host backup policy.
   - `scripts/backup-policy-check` validates backup policy.

9. Initial Borg/Borgmatic integration
   - `scripts/borg-check` exists.
   - Restore templates and rebuild runbooks exist under `docs/runbooks/`.
   - Scheduled backup verification and restore drills remain roadmap items.

## Gap register

| Gap | Why it matters | Target artifact |
| --- | --- | --- |
| Service restore coverage | Stateful services need exact restore steps | `docs/runbooks/<service>-restore.md` or completed service templates |
| Scheduled operations | Drift/backup/status checks are manual unless scheduled elsewhere | cron/systemd timers plus docs |
| Alerting | Failed checks should notify instead of waiting for manual review | Discord/Hermes alert path or monitoring alerts |
| Netdata streaming design | Parent/child topology is not yet fully documented | `docs/specs/netdata-streaming-spec.md` or operations doc |
| Reverse proxy + TLS | Needed before safe broader access | proxy/TLS spec, Compose changes, rollback notes |
| Metadata maturity | Inventory needs richer fields for automation | inventory schema notes and validation checks |
| Database-aware backups | Databases need dump/restore discipline, not only volume backup | backup spec and service runbooks |
| Dev orchestration | Dev/service operations need structured commands and boundaries | `just` targets and docs |
| Hermes operational integration | Hermes should assist with checks/runbooks without becoming hidden state | Hermes operations doc and explicit scheduled jobs |
| Full rebuild drills | Recovery is only real when tested | dated drill plan and drill report |

## Phase 1 — Documentation consolidation and source-of-truth cleanup

Goal: make the current state obvious before more changes happen.

Actions:

1. Keep this roadmap and `docs/specs/home-network-platform-spec.md` current.
2. Keep `docs/README.md` as the docs index.
3. Reconcile old setup notes with current state:
   - `docs/home-network-setup-steps.md`
   - `docs/step-4-management-stack-fixes.md`
   - `docs/step-9-considerations.md`
4. Ensure every active service in `inventory/services.yml` has:
   - display name;
   - category;
   - mode;
   - host placement;
   - container names;
   - primary URL or explicit `pending`;
   - backup class;
   - status;
   - restore/runbook link if stateful;
   - source metadata if the service is built from a local or external source tree.
5. Confirm backup classes stay aligned between `inventory/services.yml` and `inventory/backups.yml` when new services are added.

Acceptance criteria:

- README links to the spec and roadmap.
- No service references an undefined backup class.
- Stateful services have restore coverage or a tracked gap.

## Phase 2 — Scheduled operations

Goal: turn manual health checks into predictable platform hygiene.

Actions:

1. Define scheduled checks:
   - status snapshot;
   - drift check;
   - backup policy check;
   - Borg check;
   - optional dashboard render validation.
2. Choose timer mechanism:
   - systemd user/system timers for host-local checks; or
   - Hermes cron jobs for assistant-readable summaries.
3. Add lock handling so recurring jobs cannot overlap.
4. Write check results atomically to a known state directory.
5. Route failures to a useful alert channel.

Acceptance criteria:

- Scheduled checks run without overlap.
- Failures produce an actionable alert.
- Success state is inspectable from CLI.
- Docs explain how to pause, resume, and troubleshoot the schedule.

## Phase 3 — Alerting and observability maturity

Goal: make outages, backup failures, and drift visible before they become archaeology.

Actions:

1. Define alert severity levels.
2. Decide alert destinations for:
   - service down;
   - container drift;
   - backup stale/failing;
   - host unreachable;
   - disk pressure;
   - certificate expiry once TLS exists.
3. Extend `scripts/status` or add a separate alert summarizer.
4. Connect alerts to Discord/Hermes or monitoring-native alerts.
5. Document noise control and acknowledgement expectations.

Acceptance criteria:

- Critical failures are reported automatically.
- Alerts include host, service, failed check, and suggested next command.
- Known/ignored drift stays explicit in inventory.

## Phase 4 — Netdata streaming design

Goal: clarify how host-level monitoring rolls up across the network.

Actions:

1. Decide parent/child topology.
2. Document which hosts are Netdata parents and which stream as children.
3. Keep ports LAN/Tailnet-only unless proxy/auth is added.
4. Add backup/restore notes for Netdata config.
5. Verify dashboards after changes.

Acceptance criteria:

- Netdata topology is documented.
- Each monitored host has expected Netdata placement in inventory.
- Streaming and firewall/Tailnet assumptions are documented.

## Phase 5 — Reverse proxy and TLS

Goal: provide clean internal URLs and prepare safe access patterns.

Actions:

1. Pick a reverse proxy approach.
2. Define internal DNS/hostnames.
3. Define TLS source:
   - internal CA;
   - DNS challenge; or
   - Tailscale certs, where appropriate.
4. Add auth requirements for sensitive dashboards.
5. Document rollback to direct ports.

Acceptance criteria:

- No unauthenticated sensitive service is exposed beyond LAN/Tailnet.
- Proxy config is Git-managed.
- TLS renewal path is documented and testable.

## Phase 6 — Backup and restore maturity

Goal: make every stateful service restorable from documented steps.

Actions:

1. Normalize backup classes.
2. Add database-aware backup steps for database-backed services.
3. Create service restore runbooks for:
   - Home Assistant;
   - Mosquitto;
   - Prometheus;
   - Grafana;
   - Portfolio Mission Control;
   - any media/library services before they become important.
4. Run at least one restore test to a safe target.
5. Record restore timing and gotchas.

Acceptance criteria:

- Every active stateful service has a restore path.
- Restore docs identify source data, target paths, commands, verification, and rollback.
- One restore drill has been completed and documented.

## Phase 7 — Metadata and automation maturity

Goal: make inventory rich enough to drive checks and docs with less hand-editing.

Actions:

1. Define required inventory fields for hosts, services, devices, and backups.
2. Add validation scripts for missing/unknown fields.
3. Add runbook links to service metadata.
4. Add ownership/trust-boundary fields where useful.
5. Decide which generated files are tracked artifacts vs runtime-only outputs.

Acceptance criteria:

- Inventory validation fails on missing required fields.
- Generated dashboard data does not hide collection/API errors.
- Docs explain which generated files belong in git.

## Phase 8 — Dev orchestration

Goal: make routine development and platform operations repeatable.

Actions:

1. Add or refine `just` targets for common workflows.
2. Keep dangerous commands explicit and non-default.
3. Add dry-run or verify modes where possible.
4. Document feature-branch workflow and verification commands.
5. Consider a local operator dashboard/status report if CLI checks become too noisy.

Acceptance criteria:

- Common operations have named commands.
- Operators do not need to remember long Compose incantations.
- Dangerous actions require deliberate command names and are documented.

## Phase 9 — Hermes operational integration

Goal: let Hermes help operate the platform while Git remains the authority.

Actions:

1. Document what Hermes may run automatically vs only on request.
2. Add scheduled Hermes summaries only for useful signals.
3. Keep runtime scripts in this repo; copy/sync explicitly where needed.
4. Ensure generated state is atomic and not accidentally committed.
5. Add a restore/verifier path for Hermes-related secrets and env dependencies.

Acceptance criteria:

- Hermes checks are reproducible from repo scripts.
- Scheduled summaries cite the same source-of-truth commands a human can run.
- Hermes does not become a hidden database of infrastructure truth.

## Phase 10 — Full rebuild drills

Goal: prove the platform can survive host failure.

Actions:

1. Select a low-risk target host or disposable test VM/Pi.
2. Bootstrap the host.
3. Clone `home-network`.
4. Sync `/opt/docker` config.
5. Restore one config-only service.
6. Restore one stateful service from backup.
7. Run health, drift, and backup checks.
8. Document timing, manual steps, missing secrets, and fixes.

Acceptance criteria:

- At least one rebuild drill has a dated report.
- Missing documentation found during the drill is fixed.
- Recovery confidence is based on evidence, not vibes. Vibes are terrible backups.

## Suggested immediate next actions

1. Add service restore runbooks for Home Assistant and Mosquitto.
2. Add scheduled drift/backup checks.
3. Draft reverse proxy/TLS spec before exposing anything new.
4. Define Netdata streaming topology.
5. Add inventory validation for required service metadata.
