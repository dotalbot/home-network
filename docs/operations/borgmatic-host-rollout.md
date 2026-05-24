# Borg/Borgmatic Host Rollout

Status: draft
Last updated: 2026-05-21

## Purpose

Complete Borg/Borgmatic setup across the in-scope home-network hosts and verify that primary backups land on `jellybackup` over the LAN.

## Current known facts

- Primary backup target: `jellybackup`
- Target LAN IP: `192.168.1.75`
- Backup SSH user: `jellybackup`
- Use the LAN IP in Borg/Borgmatic repository URLs.
- Do not use the FQDN for backup traffic because it resolves over Tailscale and is too taxing on the Raspberry Pi backup host.
- `ssh-copy-id` has already been completed from:
  - `jellyhome`
  - `jellybase`
  - `jellyberry`
- Destination repository directories already exist on `jellybackup`, one per server.

## In-scope hosts

Primary clients:

- `jellyhome`
- `jellybase`
- `jellyberry`

Backup server:

- `jellybackup` at `192.168.1.75`

Optional/future:

- `seedbox`, if it remains in backup scope

## Repository URL rule

Use this shape from each client:

```text
ssh://jellybackup@192.168.1.75/<absolute/path/to/server-specific/repo>
```

Do not use:

```text
ssh://<backup-user>@jellybackup.../<repo>
ssh://<backup-user>@<tailscale-name-or-magicdns>/<repo>
```

Reason: FQDN/MagicDNS paths may route over Tailscale instead of LAN and overload the Pi backup host.

## Host-by-host rollout checklist

For each client host:

1. Confirm SSH connectivity to `192.168.1.75`.
2. Confirm the server-specific destination repo path exists on `jellybackup`.
3. Confirm Borg is installed.
4. Confirm Borgmatic is installed.
5. Create or verify Borgmatic config.
6. Ensure repository URL uses `192.168.1.75`.
7. Configure retention policy.
8. Configure passphrase/credential handling outside git.
9. Run a dry-run or info check.
10. Run the first backup.
11. List archives from the client.
12. Verify the archive appears under the expected destination repo.
13. Enable and verify the timer/schedule.
14. Record the verified repo path and schedule in inventory/docs.

## Suggested per-host verification commands

Run the safe discovery helper on each client host first. It does not initialize repositories, run backups, alter configuration, or print secrets.

```bash
just borgmatic-rollout-discovery
```

Once the backup SSH user and repo path are known, run:

```bash
./scripts/borgmatic-rollout-discovery --backup-user <backup-user> --repo-path <absolute/repo/path/on/jellybackup>
```

Then run the Borg/Borgmatic checks on each client host, adjusting user and repo path once confirmed:

```bash
ssh <backup-user>@192.168.1.75 'hostname && pwd'
borg --version
borgmatic --version
borgmatic config validate
borgmatic info
borgmatic list
systemctl list-timers '*borg*' --all
```

If using system-level Borgmatic timers:

```bash
systemctl status borgmatic.timer
systemctl status borgmatic.service
```

If using user-level Borgmatic timers:

```bash
systemctl --user status borgmatic.timer
systemctl --user status borgmatic.service
```

## Repeatable inventory-driven rollout scripts

The rollout generator is generic. It reads `inventory/backups.yml`, not a hardcoded host list.

A host is eligible when all of these are true:

- `hosts.<name>.borg_enabled: true`
- `hosts.<name>.repository_path` is present and absolute
- `hosts.<name>.important_paths` is a list of absolute paths, or omitted to default to `/opt/docker`

The backup target is read from `primary_target`:

- `primary_target.lan_ip` -> Borg repository host/IP
- `primary_target.ssh_user` -> Borg SSH user

Generate staged scripts from the repository root. The generator needs Python 3 with PyYAML (`python3-yaml` on Debian/Ubuntu-style systems):

```bash
scripts/borgmatic-rollout-generate
```

This currently writes rollout directories for the inventory-backed enabled hosts with repository paths:

- `/tmp/borgmatic-rollout-jellyhome/`
- `/tmp/borgmatic-rollout-jellybase/`
- `/tmp/borgmatic-rollout-jellyberry/`

Enabled hosts without `repository_path` are skipped with a warning. That keeps the generator useful while a future host is still being designed.

To write somewhere other than `/tmp`:

```bash
BORG_ROLLOUT_OUTPUT_DIR=/path/to/output scripts/borgmatic-rollout-generate
```

To test a different inventory file:

```bash
BORG_ROLLOUT_INVENTORY=/path/to/backups.yml scripts/borgmatic-rollout-generate
```

## Adding another server, for example `jellypi`

Add a host entry to `inventory/backups.yml`:

```yaml
hosts:

  jellypi:
    borg_enabled: true
    role: raspberry-pi-lightweight-node
    repository_path: /home/jellybackup/externaldisk/borg_jellypi
    important_paths:
      - /opt/docker
    notes:
      - Example future host; generator will create /tmp/borgmatic-rollout-jellypi.
```

Before running stages on `jellypi`, make sure the backup target has the destination directory and SSH access for the runtime user that will run Borgmatic, usually root if the systemd service runs as root:

```bash
ssh jellybackup@192.168.1.75 'install -d /home/jellybackup/externaldisk/borg_jellypi'
```

Then regenerate:

```bash
scripts/borgmatic-rollout-generate
```

Expected new output:

```text
/tmp/borgmatic-rollout-jellypi
```

Copy or sync that directory to `jellypi` if it was generated elsewhere, then run stages manually on `jellypi`.

## Operator-controlled stage sequence

Each generated directory contains staged scripts to run in order on the matching host. Run each one with `sudo`; the scripts refuse to run on the wrong host.

1. `stage-00-bootstrap-host.sh`
   - Creates local base directories only:
     - `/opt/docker`
     - `/opt/docker/appdata`
     - `/opt/docker/hosts`
     - `/opt/docker/.secrets`
     - `/var/lib/home-network/backup-status`
     - `/var/log/home-network-borgmatic`
     - `/var/lib/node_exporter/textfile_collector`
   - Creates `/opt/docker/.home-network-backup-sentinel` if absent so a brand-new host has a small known file for restore testing.
   - Does not install packages, alter SSH keys, initialize repos, enable timers, or deploy services.

2. `stage-01-preflight.sh`
   - Checks `borg` and `borgmatic` are installed.
   - Warns if configured source paths are missing.
   - Checks SSH connectivity to `primary_target.lan_ip` as `primary_target.ssh_user`.
   - Checks the server-side repo path exists.

3. `stage-02-secrets.sh`
   - Creates `/opt/docker/.secrets/borgmatic-passphrase` if absent.
   - Never replaces an existing passphrase file.
   - Prints only file paths and permissions, not secret contents.

4. `stage-03-init-repo.sh`
   - Initializes the host-specific Borg repo only if it is not already initialized.

5. `stage-04-export-key.sh`
   - Exports the Borg repo key to `/opt/docker/.secrets/borg-<host>-repokey.txt` if absent.
   - Never replaces an existing exported key.
   - Store this key outside the host as a recovery artifact.

6. `stage-05-configure-borgmatic.sh`
   - Writes `/etc/borgmatic/config.yaml` from inventory paths.
   - Refuses to overwrite an existing config unless explicitly approved:

```bash
sudo ALLOW_OVERWRITE_BORGMATIC_CONFIG=1 ./stage-05-configure-borgmatic.sh
```

7. `stage-06-manual-backup.sh`
   - Runs the first manual `borgmatic create --stats`.
   - Writes a sanitized status JSON file and Prometheus textfile metrics including success, timestamp, duration, latest archive name, and repository reachability.
   - Publishes compact MQTT `start` and final `success`/`failure` event/state messages for hosts enabled in `borgmatic_mqtt.enabled_hosts`.
   - If Borg reports a relocated repository and you have verified the repo path is correct, rerun with:

```bash
sudo BORG_RELOCATED_REPO_ACCESS_IS_OK=yes ./stage-06-manual-backup.sh
```

8. `stage-07-check-and-restore-test.sh`
   - Runs `borgmatic check`.
   - Extracts a small known file from the latest archive into `/tmp/borgmatic-restore-test-<host>-<timestamp>` and diffs it with the live file.
   - Candidate restore files include `/opt/docker/hosts/<host>.yaml`, `/opt/docker/docker-compose.yml`, and the bootstrap sentinel.

9. `stage-08-enable-timer.sh`
   - Installs a managed host-specific wrapper and systemd timer:
     - `/usr/local/sbin/home-network-borgmatic-run-<host>`
     - `/etc/systemd/system/home-network-borgmatic-<host>.service`
     - `/etc/systemd/system/home-network-borgmatic-<host>.timer`
   - The wrapper runs `create`, `prune`, `compact`, and `check`, then refreshes the sanitized JSON, textfile metrics, and MQTT event/state topics on every scheduled run.
   - Refuses to overwrite an existing managed wrapper/service/timer unless explicitly approved:

```bash
sudo ALLOW_OVERWRITE_MANAGED_BORGMATIC_TIMER=1 ./stage-08-enable-timer.sh
```

   - Refuses to disable an existing stock `borgmatic.timer` unless explicitly approved:

```bash
sudo ALLOW_DISABLE_STOCK_BORGMATIC_TIMER=1 ./stage-08-enable-timer.sh
```

10. `stage-09-status-summary.sh`
    - Prints the sanitized status JSON.
    - Rewrites Prometheus textfile metrics from the latest status.

## Light-touch design rules

- Inventory drives generation; shell scripts remain host-specific and easy to inspect.
- Nothing runs automatically just because it was generated.
- Operators provide sudo at each stage and can stop between stages.
- Generated scripts refuse to run if `hostname -s` does not match the expected host.
- Existing secrets, repo keys, configs, and timers are not silently replaced.
- Inventory values are validated against a strict safe-character policy before shell scripts are generated.
- Borg secrets stay under `/opt/docker/.secrets` and are excluded from backups.
- Prometheus, Grafana, Hermes, and Discord consume only sanitized status, never Borg passphrases or exported keys.

## Backup result telemetry

Root remains responsible for running Borgmatic. Automation exposes sanitized status to non-root consumers instead of sharing secrets.

Status file for Hermes/Discord summaries:

```text
/var/lib/home-network/backup-status/<host>.json
```

Prometheus textfile metrics:

```text
/var/lib/node_exporter/textfile_collector/borgmatic_<host>.prom
```

The generator now creates `/var/lib/node_exporter/textfile_collector` in `stage-00-bootstrap-host.sh`, so later backup/status stages can write `.prom` files. Node exporter still has to be installed/running and configured to read that directory.

Telemetry flow:

```text
Borgmatic/root wrapper
  -> /var/lib/home-network/backup-status/<host>.json
  -> /var/lib/node_exporter/textfile_collector/borgmatic_<host>.prom
  -> node_exporter :9100/metrics
  -> Prometheus scrape
  -> Grafana/alerts
  -> MQTT event/state topics
  -> Hermes/Discord bridge
```

MQTT backup event topics, when `borgmatic_mqtt` is enabled for the host:

```text
home-network/backups/<host>/borgmatic/event       non-retained start/success/failure event
home-network/backups/<host>/borgmatic/state       retained latest summarized state
```

If the broker requires authentication, `inventory/backups.yml` can set `borgmatic_mqtt.username` and `borgmatic_mqtt.password_file`. The generated Borgmatic stages read the password from the local root-readable file, for example `/opt/docker/.secrets/mqtt_borgmatic_password`, and never print it. MQTT publish failures are warnings only and must not fail backups.

MQTT payloads are compact, secret-free JSON. They must not include passphrases, repo keys, repository URLs, source file paths, raw Borg/Borgmatic logs, credentials, or environment dumps.

For the current jellyhome broker, backup event/state topics use the dedicated `borgmatic` MQTT user. Store the password in `/opt/docker/.secrets/mqtt_borgmatic_password` on each Borgmatic host. On the Hermes bridge host, install a service-readable root-owned copy at `/etc/home-network/mqtt_borgmatic_password` for the `jellybot` systemd service, owned `root:jellybot` with mode `0640`; do not print either file in logs or shell history.

Useful MQTT checks:

```bash
pw="$(sudo cat /opt/docker/.secrets/mqtt_borgmatic_password)"

mosquitto_sub -h jellyhome -p 1883 -u borgmatic -P "$pw" \
  -v -t 'home-network/backups/+/borgmatic/#'

mosquitto_pub -h jellyhome -p 1883 \
  -u borgmatic -P "$pw" \
  -t 'home-network/backups/jellybase/borgmatic/event' \
  -m '{"schema_version":1,"component":"borgmatic","host":"jellybase","status":"test"}'

unset pw
```

Generated metric names:

- `borgmatic_last_run_timestamp_seconds{host="<host>"}`
- `borgmatic_last_run_success{host="<host>"}`
- `borgmatic_last_run_exit_code{host="<host>"}`
- `borgmatic_last_run_duration_seconds{host="<host>"}`
- `borgmatic_repository_reachable{host="<host>"}`
- `borgmatic_last_archive_info{host="<host>",archive_name="<archive>"}`

Prometheus remains the source of truth for stale/missed backups. MQTT is a low-latency event/state bus only; retained state can become stale if a host dies mid-run.

## Current rollout result

Last checked during rollout:

- `jellyberry`, `jellyhome`, and `jellybase` are present in `inventory/backups.yml` and have `borg_enabled: true` plus host-specific repository paths.
- The generic generator emits staged rollout directories for all three hosts.
- `jellyhome` and `jellybase` manual backups and restore tests completed successfully.
- `jellyhome` has the managed timer `home-network-borgmatic-jellyhome.timer` enabled.
- Generated manual/status/timer stages now include repository reachability and latest archive metadata in sanitized JSON/textfile output. Earlier runs skipped Prometheus textfile metrics on hosts where `/var/lib/node_exporter/textfile_collector` was missing; new generated rollouts create that directory in `stage-00-bootstrap-host.sh`.

## Acceptance criteria

- Every in-scope client uses `192.168.1.75` in Borg/Borgmatic repository URLs.
- Every in-scope client can connect to `jellybackup` without password prompts from the runtime user that runs Borgmatic.
- Every in-scope client has Borg and Borgmatic installed.
- Every in-scope client has validated Borgmatic config.
- Every in-scope client has completed one successful backup.
- Every in-scope client can list its archives.
- Every in-scope client has a restore test that extracts and compares a known file.
- Every in-scope client has a timer/schedule enabled or an explicitly documented reason not to.
- Every in-scope client writes sanitized status JSON with success, timestamp, duration, latest archive name, and repository reachability.
- Every in-scope client can write Prometheus textfile metrics with the same non-secret status once node_exporter is configured.
- `just borg-check` or a host-specific equivalent passes.

## Next action

Before enabling node_exporter across all hosts, verify the generated stages on each host and then configure node_exporter to scrape `/var/lib/node_exporter/textfile_collector`.


## Optional Borgmatic Loki hook

`inventory/backups.yml` may contain a `borgmatic_loki` block. The rollout generator uses it to render Borgmatic's native `loki:` monitoring hook into `stage-05-configure-borgmatic.sh` only for hosts listed in `borgmatic_loki.enabled_hosts`.

Current first-wave policy: `jellyberry`, `jellybase`, and `jellyhome` are enabled and verified. Keep future hosts disabled until a real Borgmatic run is visible in Loki and existing Prometheus textfile metrics continue to update.

Keep labels low-cardinality and secret-free. Acceptable labels are `job`, `host`, `instance`, `environment`, and `backup_profile`. Do not add repository URLs, archive names, file paths, passphrases, exported keys, or raw error strings as labels.

Verification after applying the config and running Borgmatic:

```bash
curl -fsS http://jellybase:3100/ready
curl -fsG \
  --data-urlencode 'query={job="borgmatic",host="jellyberry"}' \
  http://jellybase:3100/loki/api/v1/query_range
```
