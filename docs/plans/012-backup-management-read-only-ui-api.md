# Backup Management Read-only UI/API Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task after Dominic approves deployment/implementation.

**Goal:** Build a read-only Backup Management view/API that shows backup policy, live backup status, restore readiness, and safe drill-down links without mutating live systems.

**Architecture:** Add a Backups view to the existing Network Map on `jellybase`. Generate one static `backup-management.json` file from repo inventory/runbooks, then combine it in the browser with existing same-origin Prometheus and Alertmanager proxy routes.

**Tech Stack:** Existing home-network repository, YAML inventory, Python or existing render scripting style, vanilla JavaScript ES modules, nginx static hosting/proxy on Network Map, Prometheus, Alertmanager, Grafana, Loki links.

---

## Non-negotiable constraints

- Do not deploy until Dominic explicitly approves deployment.
- Do not add write routes.
- Do not trigger backups or restores.
- Do not read or expose secret values.
- Keep the UI LAN/Tailnet-only.
- Missing metrics must render as `unknown`, not healthy.

## Task 1: Add static backup-management JSON generation

**Objective:** Generate a sanitized backup-management data model from repo source-of-truth files.

**Files:**
- Create: `scripts/backup-management-render`
- Create: `docker/appdata/network-map/site/data/backup-management.json` only when render runs
- Read: `inventory/hosts.yml`
- Read: `inventory/backups.yml`
- Read: `inventory/services.yml`
- Read: `docs/runbooks/*.md`
- Read: `docs/operations/*.md`

**Step 1: Implement schema draft in code**

The generated JSON must include:

```json
{
  "generated_at": "ISO-8601 timestamp",
  "schema_version": 1,
  "security_boundary": "LAN/Tailnet-only; read-only; no secrets",
  "primary_target": {},
  "hosts": [],
  "backup_classes": {},
  "restore_rules": {},
  "services": []
}
```

**Step 2: Sanitize values**

Include only inventory/doc data. Do not read `/opt/docker/.env`, `/opt/docker/.secrets`, Borg passphrase files, SSH keys, database secrets, or appdata contents.

**Step 3: Validate output**

Run:

```bash
python3 -m json.tool docker/appdata/network-map/site/data/backup-management.json >/dev/null
just backup-policy-check
git diff --check
```

Expected: all commands pass.

**Step 4: Commit**

```bash
git add scripts/backup-management-render docker/appdata/network-map/site/data/backup-management.json
git commit -m "feat: generate backup management dashboard data"
```

## Task 2: Add just target for render verification

**Objective:** Make the render command discoverable and repeatable.

**Files:**
- Modify: `justfile`
- Modify if needed: `README.md`

**Step 1: Add target**

Add a target similar to existing render targets:

```just
backup-management-render:
    scripts/backup-management-render
```

If the repo prefers grouping under Network Map, name it consistently, for example `network-map-backup-render`.

**Step 2: Verify target**

Run:

```bash
just backup-management-render
python3 -m json.tool docker/appdata/network-map/site/data/backup-management.json >/dev/null
git diff --check
```

Expected: render succeeds and JSON validates.

**Step 3: Commit**

```bash
git add justfile README.md
git commit -m "chore: add backup management render target"
```

## Task 3: Add Backups view shell in Network Map

**Objective:** Add a read-only Backups tab/page that loads the static JSON and renders degraded states.

**Files:**
- Modify: `docker/appdata/network-map/site/index.html`
- Create: `docker/appdata/network-map/site/modules/backup-management.js`
- Modify: `docker/appdata/network-map/site/styles.css`

**Step 1: Add navigation**

Add a Backups tab or section in the existing dashboard navigation. It should be clearly marked read-only.

**Step 2: Load JSON**

In `backup-management.js`, fetch:

```text
/data/backup-management.json
```

Render summary cards and host rows using only static JSON first.

**Step 3: Handle failure**

If the JSON cannot load, show a visible error card. Do not fail silently.

**Step 4: Verify browser-free basics**

Run whatever static syntax checks exist. At minimum:

```bash
git diff --check
```

If a local static server is used for manual testing, check the browser console.

**Step 5: Commit**

```bash
git add docker/appdata/network-map/site/index.html docker/appdata/network-map/site/modules/backup-management.js docker/appdata/network-map/site/styles.css
git commit -m "feat: add read-only backups dashboard shell"
```

## Task 4: Add live Prometheus backup status

**Objective:** Combine static inventory context with live Borgmatic metrics.

**Files:**
- Modify: `docker/appdata/network-map/site/modules/api.js`
- Modify: `docker/appdata/network-map/site/modules/backup-management.js`

**Step 1: Query metrics**

Use existing Prometheus proxy for:

```promql
borgmatic_last_run_timestamp_seconds{job="node_exporter"}
borgmatic_last_run_success{job="node_exporter"}
borgmatic_last_run_exit_code{job="node_exporter"}
borgmatic_last_run_duration_seconds{job="node_exporter"}
borgmatic_repository_reachable{job="node_exporter"}
borgmatic_last_archive_info{job="node_exporter"}
node_textfile_scrape_error{job="node_exporter"}
```

**Step 2: Map metrics to hosts**

Prefer a stable `host` label. If a metric only has `instance`, map known instances from inventory/Network Map conventions.

**Step 3: Apply state rules**

- Green: latest run success, repository reachable, not stale.
- Amber: stale or missing expected data.
- Red: failed, unreachable, textfile scrape error, or critical alert.
- Grey: disabled/planned/not monitored.

**Step 4: Verify degraded states**

Temporarily test with missing/fake metric responses where practical, or inject a mocked response in local browser testing.

**Step 5: Commit**

```bash
git add docker/appdata/network-map/site/modules/api.js docker/appdata/network-map/site/modules/backup-management.js
git commit -m "feat: show live borgmatic backup status"
```

## Task 5: Add Alertmanager and drill-down links

**Objective:** Surface backup-related alerts and safe external links.

**Files:**
- Modify: `docker/appdata/network-map/site/modules/backup-management.js`
- Modify: `docker/appdata/network-map/site/styles.css`

**Step 1: Load alerts**

Use existing route:

```text
/api/alerts
```

Filter client-side for backup/Borg/textfile-related alerts and host labels.

**Step 2: Add links**

Per host, link to:

- Grafana backup dashboard;
- Grafana Explore/Loki query for `{job="borgmatic", host="<host>"}` or deployed labels;
- Alertmanager filtered view if supported;
- relevant restore runbook or docs index.

**Step 3: Verify no write actions**

Search the UI for buttons/forms/routes that imply mutation. Replace dangerous verbs with documentation links.

**Step 4: Commit**

```bash
git add docker/appdata/network-map/site/modules/backup-management.js docker/appdata/network-map/site/styles.css
git commit -m "feat: add backup alert and runbook drilldowns"
```

## Task 6: Documentation and verification

**Objective:** Update docs and prove the read-only surface is safe and understandable.

**Files:**
- Modify: `docs/specs/006-backup-management-read-only-ui-api.md`
- Modify: `docs/guides/backup-management-read-only-ui-guide.md`
- Modify: `docs/README.md`
- Modify if needed: `README.md`

**Step 1: Update docs**

Document exact render command, deployment status, data-source mapping, and safe operator workflow.

**Step 2: Run verification**

Before committing:

```bash
just backup-policy-check
just network-map-render
just backup-management-render
python3 -m json.tool docker/appdata/network-map/site/data/backup-management.json >/dev/null
git diff --check
```

After approved deployment only:

```bash
curl -fsS http://jellybase:8788/data/backup-management.json | python3 -m json.tool >/dev/null
curl -fsS 'http://jellybase:8788/api/prometheus/query?query=borgmatic_last_run_success'
curl -fsS http://jellybase:8788/api/alerts | python3 -m json.tool >/dev/null
```

**Step 3: Browser verification**

Check:

- Backups view loads.
- No console errors.
- Missing metrics show unknown.
- Alerts influence state.
- Links open Grafana/Alertmanager/runbooks.
- No secrets appear in network responses or page source.

**Step 4: Commit**

```bash
git add docs/specs/006-backup-management-read-only-ui-api.md docs/guides/backup-management-read-only-ui-guide.md docs/README.md README.md
git commit -m "docs: document backup management UI operations"
```

## Final review checklist

- [ ] No deployment occurred without approval.
- [ ] No write actions exist.
- [ ] No secrets are read or exposed.
- [ ] LAN/Tailnet-only boundary is documented.
- [ ] Static JSON validates.
- [ ] Backup policy checker passes.
- [ ] Browser verification passes.
- [ ] Docs explain beginner operator flow.
