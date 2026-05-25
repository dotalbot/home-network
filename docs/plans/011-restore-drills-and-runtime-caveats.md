# 011 — Restore Drills and Runtime Caveats

Status: active

## Goal

Turn “backups exist” into “restores are boring” by documenting exact service restore paths, running safe non-production restore drills, and keeping known runtime caveats visible in the roadmap.

## Scope

Initial restore coverage:

- Home Assistant on `jellybase`
- Mosquitto MQTT on `jellyhome`
- Prometheus, Alertmanager, Grafana, and Loki monitoring state on `jellybase`
- Portfolio Mission Control on `jellyberry`

This plan does not restore over production unless the operator explicitly approves a maintenance window.

## Current runtime caveats

- Alertmanager/Discord is live and verified, but depends on the host-local secret at `/opt/docker/.secrets/alertmanager/discord_webhook_url`; this file is intentionally excluded from Git and must be recreated during host rebuilds.
- `scripts/sync-docker-config` may warn that `/opt/docker/appdata/alloy/data` contains root/container-owned files whose modes cannot be updated by the operator account. This is expected runtime ownership drift and no longer blocks deployment.
- `jellybase` reports a pending OS restart after package updates; unrelated to Alertmanager, but should be planned separately.
- Retired Netdata containers are removed from the managed path; any remaining root-owned Netdata appdata should only be deleted with explicit sudo approval.
- Historical generated runtime diffs from the Alertmanager deploy were preserved on `jellybase` under `/tmp/home-network-generated-before-alertmanager-20260524221726` for short-term reconciliation.

## Restore-drill rules

- Prefer non-destructive drills: list archive, extract into `/tmp/home-network-restore-drill/<service>/`, inspect expected files, and run validation commands against scratch copies or disposable containers.
- Do not overwrite `/opt/docker/appdata/*` during a drill.
- Do not print secrets, tokens, database passwords, Home Assistant tokens, MQTT password files, or webhook URLs.
- Stop production containers only during an explicit maintenance window.
- Record archive name, source host, extracted path, validation commands, and outcome.
- If a drill reveals missing backup coverage, update `inventory/backups.yml`, service metadata, and the affected runbook before marking it complete.

## Progress checklist

- [x] Alertmanager caveats captured in the roadmap/plan.
- [x] Service-specific restore runbooks drafted for Home Assistant, Mosquitto, monitoring stack, and Portfolio Mission Control.
- [x] Pick first safe restore drill target.
- [x] Run non-destructive Borg extraction into `/tmp/home-network-restore-drill/`.
- [x] Validate restored files without touching production data.
- [x] Record drill result in the relevant runbook.
- [ ] Fix any backup policy or runbook gaps found by the drill.

## Candidate first drill

Completed first drill: Mosquitto MQTT on `jellyhome`, recorded in `docs/runbooks/mosquitto-restore.md`.

Why it was a good first target:

- Small state footprint.
- Clear config/data split.
- Easy non-destructive validation with a scratch `eclipse-mosquitto:2` container.
- Exercises the same Borg path and secret-handling discipline needed for larger services.

Recommended next drill: Prometheus config extraction on `jellybase`, after SSH/sudo access is available again.

Fallback next drill: Home Assistant config extraction on `jellybase`, validating YAML shape only and not starting a scratch Home Assistant container with production secrets.

## Acceptance criteria

- Roadmap reflects that Alertmanager is live and lists its remaining caveats.
- Restore runbooks exist for the current high-value stateful services.
- At least one safe restore drill has a dated result with exact archive, target path, and verification output.
- Production service data is untouched unless a separate approved maintenance-window restore is performed.
