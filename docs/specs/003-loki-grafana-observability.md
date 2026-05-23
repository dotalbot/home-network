# Spec 003 — Loki + Grafana Observability

Status: first-pass implemented; Borgmatic log shipping/dashboard follow-up
Roadmap area: V5 — Logs and Grafana Observability
Plan: `docs/plans/009-loki-grafana-observability.md`

## Goal

Add lightweight, source-managed log visibility to the home-network platform while keeping Grafana as the main observability UI.

## Strategic direction

- Prometheus and node_exporter remain the metrics and alert-state layer.
- Loki is the log-history layer on `jellybase`.
- Grafana is the shared UI for metrics and logs.
- MQTT/Hermes/Discord may carry notifications, but they are not the long-term log store.
- Netdata has been retired from the managed Compose/inventory/dashboard/status path; existing containers/appdata are cleanup-only.

## Initial scope

1. Deploy self-hosted Loki on `jellybase` beside Prometheus and Grafana. [implemented]
2. Provision Loki as a Grafana datasource through repo-managed config. [implemented]
3. Send Borgmatic run logs to Loki using Borgmatic's Loki monitoring hook. [follow-up]
4. Keep labels low-cardinality: host, job, instance, backup_profile, and environment are acceptable; archive names, file paths, repo URLs, and error strings belong in log content.
5. Add a source-managed Grafana dashboard or panels for Borgmatic log search and backup-run context.

## Non-goals

- Public exposure of Grafana or Loki.
- Replacing Prometheus metrics with logs.
- Building a Netdata parent/child streaming topology.
- Shipping every system/container log before Borgmatic logs are working and verified.

## Acceptance criteria

- [x] Loki is reachable from the trusted monitoring path on `jellybase`.
- [x] Grafana lists a provisioned Loki datasource.
- [ ] At least one Borgmatic run produces queryable Loki entries with expected host/job labels.
- [x] Documentation explains rollback and how to verify Loki from CLI and Grafana; Borgmatic log verification remains follow-up.
- [x] No secrets, repository URLs with credentials, or raw passphrases appear in labels or committed config.
