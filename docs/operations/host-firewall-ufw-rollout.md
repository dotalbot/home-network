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

## Emergency access test

From an operator machine, open a separate session over Tailnet:

```bash
ssh <user>@<host>.cheetah-iwato.ts.net 'hostname -s && ip -o -4 addr show tailscale0 || true'
```

Keep that session open during UFW enablement.

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
