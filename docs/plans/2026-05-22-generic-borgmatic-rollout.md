# Generic Borgmatic Rollout Implementation Plan

> **For Hermes:** Use repository-development-discipline for changes. Keep rollout operator-controlled and stage-based.

**Goal:** Make Borg/Borgmatic rollout generic for any host declared in `inventory/backups.yml`, including future hosts such as `jellypi`.

**Architecture:** The repo inventory is the source of truth. `scripts/borgmatic-rollout-generate` reads `primary_target` and `hosts` from `inventory/backups.yml`, then writes one `/tmp/borgmatic-rollout-<host>/stage-*.sh` directory per enabled host with a `repository_path`. Each stage is explicit and safe to run manually with sudo; scripts refuse to run on the wrong host.

**Tech Stack:** Python 3, PyYAML, Bash, Borg, Borgmatic, systemd timers, node_exporter textfile collector.

---

## Acceptance criteria

- Adding a new host only requires a `hosts.<name>` entry with `borg_enabled: true`, `repository_path`, and `important_paths`.
- Hosts without `repository_path` are skipped with a clear warning instead of failing all generation.
- Generated scripts include a bootstrap stage that can create `/opt/docker`, `/opt/docker/appdata`, `/opt/docker/hosts`, `/opt/docker/.secrets`, backup-status, log, and node_exporter textfile directories.
- Operators still control every step by running each stage manually with sudo.
- Existing safeguards remain: wrong-host refusal, no secret printing, no passphrase replacement, no config overwrite without explicit env override, no stock timer replacement without explicit env override.
- Documentation explains inventory fields, stage sequence, Prometheus/node_exporter telemetry, and how to onboard `jellypi`-style hosts.

## Task 1: Inspect generator assumptions

**Files:**
- Read: `scripts/borgmatic-rollout-generate`
- Read: `inventory/backups.yml`

**Result:** The existing generator hardcoded only `jellyhome` and `jellybase`, so it was not generic.

## Task 2: Make generator inventory-driven

**Files:**
- Modify: `scripts/borgmatic-rollout-generate`

**Steps:**
1. Replace hardcoded `HOSTS` with YAML loading from `inventory/backups.yml`.
2. Read `primary_target.lan_ip` and `primary_target.ssh_user`.
3. Generate scripts for every `hosts.*` entry where `borg_enabled: true` and `repository_path` is present.
4. Use `important_paths` directly as Borgmatic `source_directories`.
5. Keep `/opt/docker` first when present and preserve any extra important paths.
6. Emit warnings for enabled hosts missing `repository_path`.

## Task 3: Add light-touch bootstrap and telemetry stage

**Files:**
- Modify: `scripts/borgmatic-rollout-generate`

**Steps:**
1. Add `stage-00-bootstrap-host.sh`.
2. Create required directories only; do not install packages, alter SSH keys, initialize repos, or deploy services.
3. Create `/var/lib/node_exporter/textfile_collector` so generated status stages can write Prometheus textfile metrics.
4. Keep preflight as validation after bootstrap.

## Task 4: Document operator workflow

**Files:**
- Modify: `docs/operations/borgmatic-host-rollout.md`

**Steps:**
1. Explain generic inventory-driven generation.
2. Add a future-host example for `jellypi`.
3. Document stage order and override env vars.
4. Document Prometheus metric path and node_exporter scrape flow.

## Task 5: Verify

Run:

```bash
python3 -m py_compile scripts/borgmatic-rollout-generate
./scripts/borgmatic-rollout-generate
bash -n /tmp/borgmatic-rollout-jellyhome/stage-*.sh
bash -n /tmp/borgmatic-rollout-jellybase/stage-*.sh
bash -n /tmp/borgmatic-rollout-jellyberry/stage-*.sh
./scripts/backup-policy-check
```

Expected:
- Generator writes rollout directories for jellyhome, jellybase, and jellyberry.
- Enabled hosts lacking repository path are skipped with warning.
- All generated shell scripts pass `bash -n`.
- Backup policy check passes.
