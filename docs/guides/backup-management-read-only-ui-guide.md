# Read-only Backup Management UI Guide

Status: implemented first read-only slice; deployment pending operator sudo
Last updated: 2026-06-01
Related spec: `docs/specs/006-backup-management-read-only-ui-api.md`

## What this is

The Backup Management UI is a read-only dashboard for backup health and restore readiness inside Network Map.

It should help you answer four questions quickly:

1. Which hosts are expected to back up?
2. Did the latest backups run successfully?
3. Where do I look when something is stale or failed?
4. Which runbook should I use before any restore work?

It is not a button panel for dangerous actions. No backup trigger. No restore button. No editing live Borgmatic config. The safest backup UI is one that does not accidentally become a "delete my weekend" button.

## Where it should live

Recommended first home:

```text
http://jellybase:8788
```

as a new Backups view inside Network Map.

Why:

- Network Map already runs on `jellybase`.
- `jellybase` hosts Prometheus, Grafana, Alertmanager, and Loki.
- The existing Network Map nginx proxy already demonstrates same-origin Prometheus/Alertmanager access.
- It stays inside the trusted LAN/Tailnet boundary.

The approved first slice is implemented for the normal Network Map/Homepage path. Deployment is pending an operator-assisted `just homepage-deploy` because syncing runtime config requires sudo in this environment. It remains read-only.

## Implemented first slice

- `scripts/backup-management-render` reads `inventory/backups.yml`, `inventory/hosts.yml`, `inventory/services.yml`, and docs/runbook paths, then writes `docker/appdata/network-map/site/data/backup-management.json`.
- `just backup-management-render` regenerates the static JSON; `just network-map-render` and `just homepage-deploy` also regenerate it.
- Network Map renders a visible `Backups` section with summary cards, per-host status/destination rows, backup set/path coverage, and a service restore readiness snapshot.
- Live Borgmatic metrics are still read through the existing Prometheus proxy; missing live data is shown as unknown/attention, not healthy.
- Add/remove is intentionally disabled. The next workflow should propose Git-reviewed `inventory/backups.yml` patches and rendered diffs only.

## What the dashboard should show

### 1. Summary cards

Expected cards:

- Backup clients: count of Borg-enabled hosts.
- Healthy: latest backup succeeded and is recent.
- Needs attention: stale, failed, unreachable, or missing metrics.
- Target: `jellybackup` at `192.168.1.75` using LAN IP, not FQDN/Tailscale.

### 2. Host status table

Expected rows:

- `jellyhome`
- `jellybase`
- `jellyberry`

Expected columns:

- state: green, amber, red, or grey;
- last run time;
- age, such as `3h ago`;
- success/failure and exit code;
- run duration;
- repository reachable;
- latest archive name if available;
- rollout status from inventory;
- links to Grafana, Loki/Grafana Explore, Alertmanager, and runbooks.

### 3. Backup policy explorer

This is the human-readable version of `inventory/backups.yml`:

- backup classes;
- includes and excludes;
- restore priority;
- destinations;
- host backup sets;
- important paths.

It must not show secret values or raw secret file contents.

### 4. Service restore readiness

For each service, show:

- service name;
- owning host;
- backup class;
- restore priority;
- restore runbook link, if one exists;
- amber warning when the service still needs a dedicated restore runbook.

### 5. Beginner next checks

For an amber or red host, show a simple ordered path:

1. Open the Grafana backup dashboard for that host.
2. Check Alertmanager for active backup/textfile alerts.
3. Open Loki/Grafana Explore filtered to Borgmatic logs for that host.
4. If the issue is a path or policy gap, change inventory on a Git branch.
5. If restore is needed, start with a scratch restore runbook. Do not restore into production paths first.

## Data sources

| Question | Source of truth | Notes |
| --- | --- | --- |
| Which hosts exist? | `inventory/hosts.yml` | Host roles, monitoring status, LAN IPs. |
| Which hosts are backed up? | `inventory/backups.yml` | `hosts.<name>.borg_enabled`, destinations, repository paths, backup sets. |
| Which services depend on backups? | `inventory/services.yml` | Service ownership, backup classes, URLs, and runbook metadata. |
| Did backups run? | Prometheus `borgmatic_*` metrics | Sanitized metrics from node_exporter textfile collector. |
| Are alerts firing? | Alertmanager `/api/v2/alerts` | Backup failure/staleness/textfile scrape alerts. |
| What happened in logs? | Grafana/Loki links | Link out first; do not inline raw logs in v1. |
| How do I restore safely? | `docs/runbooks/*.md` and `docs/operations/*.md` | Start with scratch restore drills. |

## Safe state meanings

| State | Meaning | First action |
| --- | --- | --- |
| green | Latest backup succeeded, repository reachable, not stale. | No action. |
| amber | Stale, missing metrics, planned/partial rollout, or documentation gap. | Open Grafana, then check inventory/runbook. |
| red | Failed backup, repository unreachable, critical backup alert, or scrape/textfile error. | Open Alertmanager and Loki/Grafana; inspect owning host. |
| grey | Disabled, planned, or intentionally not monitored. | Confirm inventory says this is expected. |

Never turn missing data into green. Unknown means unknown.

## Security rules

The UI must stay LAN/Tailnet-only unless a later authenticated reverse-proxy design is approved.

Do not expose:

- Borg passphrases;
- exported Borg repo keys;
- SSH private keys;
- database passwords;
- MQTT passwords;
- `.env` values;
- `/opt/docker/.secrets` contents;
- raw appdata listings that reveal private user data.

It is OK to show non-secret paths and statuses, for example:

```text
Repository path: /home/jellybackup/externaldisk/borg_jellybase
Passphrase file: /opt/docker/.secrets/borgmatic-passphrase exists? unknown/not checked
```

Do not read or display the passphrase content.

## Beginner-friendly implementation sequence

This is the recommended safe path for a future implementer.

### Step 1: Build a static inventory model

Create a render helper that reads:

```text
inventory/hosts.yml
inventory/backups.yml
inventory/services.yml
docs/runbooks/
docs/operations/
```

and writes:

```text
docker/appdata/network-map/site/data/backup-management.json
```

The JSON should contain only sanitized inventory and doc links.

Verification:

```bash
python3 -m json.tool docker/appdata/network-map/site/data/backup-management.json >/dev/null
just backup-policy-check
git diff --check
```

### Step 2: Add the Backups view to Network Map

Add a static Backups tab/page that loads:

```text
/data/backup-management.json
/api/prometheus/query?query=...
/api/alerts
```

Keep it dependency-free like the current Network Map modules.

### Step 3: Render degraded states first

Before making it pretty, prove it handles:

- missing Prometheus metrics;
- missing Alertmanager data;
- a host in inventory but no Borg metrics;
- a service without a restore runbook;
- a disabled/planned destination.

### Step 4: Add links, not dangerous buttons

Add links to:

- Grafana backup dashboard;
- Grafana Explore/Loki query;
- Alertmanager;
- service restore runbooks;
- Network Map host detail.

Do not add write actions.

### Step 5: Verify locally and in browser

Suggested checks after implementation:

```bash
just backup-policy-check
just network-map-render
git diff --check
```

Then, after approved deployment only:

```bash
curl -fsS http://jellybase:8788/data/backup-management.json | python3 -m json.tool >/dev/null
curl -fsS 'http://jellybase:8788/api/prometheus/query?query=borgmatic_last_run_success'
curl -fsS http://jellybase:8788/api/alerts | python3 -m json.tool >/dev/null
```

Browser checks:

- Backups view loads without JavaScript console errors.
- Host statuses show real green/amber/red/grey states.
- Missing data is visible as unknown.
- Grafana/Alertmanager/Loki/runbook links work.
- No secrets appear in page source, network responses, or console logs.

## Operator response guide

### If a host is amber because the backup is stale

1. Open Grafana backup dashboard for that host.
2. Confirm the last timestamp and scheduled backup expectation.
3. Check the managed timer on the owning host:

```bash
systemctl list-timers 'home-network-borgmatic*' --all --no-pager
systemctl status home-network-borgmatic-$(hostname -s).timer --no-pager
```

4. Check Loki/Grafana for Borgmatic logs.
5. Do not edit live config directly; update inventory/docs on a branch if policy changed.

### If a host is red because the backup failed

1. Open Alertmanager and Grafana.
2. Check Loki/Grafana for recent Borgmatic logs.
3. On the owning host, inspect Borgmatic status without printing secrets.
4. Confirm repository reachability to `jellybackup@192.168.1.75`.
5. Fix the root cause, run a manual backup only when appropriate, and record the outcome.

### If a restore is requested

1. Find the service restore runbook.
2. Prefer a scratch restore drill.
3. Never restore directly into live `/opt/docker`, live database paths, or media libraries without explicit production-restore approval.
4. Record archive, paths, validators, result, and cleanup.

## Design guardrails for future write workflows

When editable workflows are eventually added, keep them staged:

1. User requests a path/policy change.
2. UI validates the request locally.
3. UI generates a proposed patch or branch.
4. Human reviews the Git diff.
5. Rollout scripts are generated for inspection.
6. Operator runs approved stages manually with `sudo` on the matching host.

The UI should never become the only source of truth. Git remains the authority; the dashboard is the window. Yes, windows are read-only too unless you throw a brick through them.
