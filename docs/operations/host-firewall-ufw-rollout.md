# Host firewall / UFW rollout runbook

Status: draft. Do not run live firewall changes until the spec is reviewed and approved.

Related spec: `docs/specs/007-host-firewall-ufw-hardening.md`

## Safety rule

Never enable UFW from a single LAN SSH session. First open and verify a separate Tailscale SSH or console session with rollback ability.

## Preflight per host

```bash
hostname -s
ip -o -4 addr
tailscale status
sudo ufw status verbose
sudo -n true || echo 'sudo password required'
docker ps --format '{{.Names}} {{.Ports}}'
ss -ltnup
```

Record:

- current LAN IP
- Tailnet IP / MagicDNS name
- current UFW state
- running Docker-published ports
- required service URLs

## Tailscale SSH backdoor setup

Before any UFW changes, Tailscale SSH must be enabled and tested on each target host.

Inspect-only check, run on each host:

```bash
cd ~/repo/home-network 2>/dev/null || cd /home/jellybot/home-network
scripts/tailscale-ssh-backdoor-check
```

Enable Tailscale SSH, run locally on the target host so the operator can enter sudo if prompted:

```bash
cd ~/repo/home-network 2>/dev/null || cd /home/jellybot/home-network
scripts/tailscale-ssh-backdoor-check --enable
```

Expected successful output includes:

```text
run-ssh=true
status=ok
```

## Emergency access test

From an operator machine, open a separate session over Tailnet using Tailscale SSH:

```bash
tailscale ssh <user>@<host>.cheetah-iwato.ts.net 'hostname -s && ip -o -4 addr show tailscale0 || true'
```

Keep that session open during UFW enablement.

### Verified Tailscale SSH evidence

2026-05-28: User verified from Windows PowerShell that Tailscale SSH returns `hostname -s; whoami` successfully for:

```text
jellyhome   jellyfish@jellyhome   -> jellyhome / jellyfish
jellybase   jellyfish@jellybase   -> jellybase / jellyfish
jellyberry  jellybot@jellyberry   -> jellyberry / jellybot
jellyoffice jellyfish@jellyoffice -> jellyoffice / jellyfish
```

This satisfies the Tailnet emergency shell prerequisite for `jellyhome`, `jellybase`, and `jellyberry`. Keep LAN SSH as the backdoor-for-the-backdoor. `jellyoffice` is verified too, but remains outside the main Docker-host UFW rollout and should use a separate Pi-safe firewall profile if hardened later.

## Generic rollback

Run from Tailscale SSH or local console:

```bash
sudo ufw disable
sudo ufw reset
```

If the host remains reachable and only one rule is wrong:

```bash
sudo ufw status numbered
sudo ufw delete <number>
```

## Rule-building pattern

1. Reset only during an explicit maintenance window.
2. Set defaults.
3. Add Tailnet/emergency allow first.
4. Add LAN SSH/admin allow.
5. Add service allow rules.
6. Add scraper/source-restricted rules.
7. Enable UFW.
8. Verify positive and negative paths.

Skeleton:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 comment 'Tailnet emergency/operator access'
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp comment 'LAN SSH admin'
# host-specific rules go here
sudo ufw enable
sudo ufw status verbose
```

## Positive checks after enablement

```bash
# from operator host
curl -fsS http://<host-or-ip>:<port>/ || true
ssh <host> hostname -s

# from Prometheus host or API
curl -fsG --data-urlencode 'query=up' http://192.168.1.2:9090/api/v1/query
```

Watch for new alerts:

```bash
curl -fsS http://192.168.1.2:9093/api/v2/alerts | jq '.[] | {labels, status}'
```

## Negative checks

From a non-approved LAN host where possible:

```bash
nc -vz <target> 9100
nc -vz <target> 12345
nc -vz <target> 7007
nc -vz <target> 9001
nc -vz <target> 5432
```

Expected restricted ports should fail from non-approved sources.

## Host order

1. `jellyberry`
2. `jellyhome`
3. `jellybase`

Do not continue to the next host until the previous host has stable positive checks and no unexpected Alertmanager noise.

## jellyberry staged script

Source-managed dry-run/apply helper:

```bash
scripts/firewall/apply-jellyberry-ufw          # print intended commands
scripts/firewall/apply-jellyberry-ufw --apply  # apply locally with sudo
```

Preflight observed before script creation:

- LAN IP: `192.168.1.159`
- Tailnet IP: `100.68.81.120`
- Tailscale SSH: verified by user; local prefs show `RunSSH=true`
- Listening ports include: `22`, `7007`, `8787`, `8791`, `8792`, `9100`, `12345`
- Docker services include: `portfolio-mission-control-v2`, `sc401-study-hub`, `image-pastebin`, `dozzle-agent`, `alloy`

Important Docker caveat: Docker-published ports can bypass plain UFW via Docker iptables/NAT paths. The jellyberry script establishes a safe host UFW baseline and management fallback, but service-port hardening must be verified separately with DOCKER-USER rules or bind-address changes before claiming Docker-published ports are fully restricted.

2026-05-28 apply result:

- User ran `scripts/firewall/apply-jellyberry-ufw --apply` as root on jellyberry.
- UFW became active with default deny incoming / allow outgoing / deny routed.
- Management rules present: `tailscale0` emergency access and LAN SSH from `192.168.1.0/24`.
- LAN app rules present for `8787`, `8791`, `8792`.
- Monitoring/peer rules present for jellybase to `9100`/`12345` and jellyhome to `7007`.
- User reported all checks worked.
- Follow-up checks from Hermes confirmed HTTP 200 on `192.168.1.159:8787`, `:8791`, and `:8792`; Prometheus `up` remained `1` for `jellyberry:9100` node_exporter and `jellyberry:12345` Alloy.

## jellyhome staged script

Source-managed dry-run/apply helper:

```bash
scripts/firewall/apply-jellyhome-ufw          # print intended commands
scripts/firewall/apply-jellyhome-ufw --apply  # apply locally with sudo
```

Rule intent is derived from `docker/hosts/jellyhome.yaml` and inventory service URLs:

- Management: Tailnet emergency access on `tailscale0`, LAN SSH from `192.168.1.0/24`.
- LAN/Tailnet services: `80`, `8080`, `9443`, `1883`, `9001`, `3214`, `8793`, `8888`, `8889`, `18888`, `9999`. Ports `8888` and `8889` are intentionally left available for temporary package delivery/dev workflows.
- Monitoring: jellybase `192.168.1.2` to `9100` and `12345`.

Important Docker caveat applies here too: Docker-published ports can bypass plain UFW via Docker iptables/NAT paths. This script establishes the safe host firewall baseline first; deeper Docker-published service restriction needs DOCKER-USER or bind-address follow-up.

2026-05-28 apply result:

- User ran jellyhome UFW apply after adding package/dev delivery ports `8888` and `8889`.
- User reported completion.
- Follow-up checks from Hermes confirmed HTTP 200 on Homepage `80`, Dozzle `8080`, Portainer `9443`, 3dprint-loader `8793`, Hindsight API `18888`, and Hindsight UI `9999`.
- Manyfold `3214` was reachable but returned an application redirect loop, indicating transport was not blocked.
- Prometheus `up` remained `1` for `jellyhome:9100` node_exporter and `jellyhome:12345` Alloy.

## jellybase staged script

Source-managed dry-run/apply helper:

```bash
scripts/firewall/apply-jellybase-ufw          # print intended commands
scripts/firewall/apply-jellybase-ufw --apply  # apply locally with sudo
```

Rule intent is derived from `docker/hosts/jellybase.yaml`, Prometheus scrape config, and inventory service URLs:

- Management: Tailnet emergency access on `tailscale0`, LAN SSH from `192.168.1.0/24`.
- LAN/Tailnet services: `80`, `3001`, `9090`, `9093`, `8788`, `8793`, `8794`, `8123`.
- Service peers: jellyhome to `5432`, `7007`, `9001`; jellyhome/jellyberry to Loki `3100` if LAN push/query paths are used.
- Local Prometheus scrape paths: Docker bridge ranges to `9100`, `12345`, and `9000` for host.docker.internal / mqtt-exporter scrape paths.

Important Docker caveat applies here too: Docker-published ports can bypass plain UFW via Docker iptables/NAT paths. This script establishes the safe host firewall baseline first; deeper Docker-published service restriction needs DOCKER-USER or bind-address follow-up.

2026-05-28 apply result:

- User ran jellybase UFW apply and reported completion.
- Follow-up checks from Hermes confirmed HTTP 200/ready responses for Homepage `80`, Grafana `3001`, Prometheus `9090`, Alertmanager `9093`, Network Map `8788`, Home Assistant `8123`, Jellyfood web `8793`, and Jellyfood API `8794`.
- Prometheus `up` remained `1` for all node_exporter targets: `host.docker.internal:9100` / jellybase, `jellyhome:9100`, and `jellyberry:9100`.
- Prometheus `up` remained `1` for all Alloy targets: `host.docker.internal:12345` / jellybase, `jellyhome:12345`, and `jellyberry:12345`.
- Prometheus, Loki, and mqtt-exporter scrape checks remained `up=1`.
- Alertmanager still showed only the two pre-existing jellybase warning alerts (`HomeNetworkScheduledOpsCheckFailed`, `HostSystemdFailedUnits`); no new firewall/scrape outage alert was observed.
