# Spec 007: Host Firewall / UFW Hardening

Status: planned — do not apply live firewall changes until explicitly approved  
Number: 007  
Created: 2026-05-28

## Goal

Move the main home-network hosts from "UFW inactive / LAN-open service ports" to a staged host-firewall posture without losing access.

The first target is not maximum lockdown. The first target is controlled, documented, reversible hardening:

1. Keep operator access working over LAN and Tailnet.
2. Keep required LAN services reachable.
3. Keep Prometheus/node_exporter scraping working.
4. Restrict broad host-agent ports such as node_exporter `9100` to approved scraper paths.
5. Apply host-by-host with rollback.

## Non-goals

- Do not enable UFW automatically from this spec.
- Do not change router/firewall rules.
- Do not expose services beyond LAN/Tailnet.
- Do not replace the future reverse-proxy/TLS/auth design.
- Do not firewall `jellyoffice` as part of the Docker-host rollout; it is a low-RAM Wi-Fi sensor node and needs a separate Pi-safe baseline if required.

## Scope

Initial UFW hardening hosts:

| Host | LAN IP | Role | Notes |
| --- | --- | --- | --- |
| jellyhome | 192.168.1.1 | main Docker/dev server, Mosquitto, Home Assistant, Dozzle UI, Portainer, Manyfold, Hindsight | many user-facing LAN services |
| jellybase | 192.168.1.2 | monitoring/database server, Prometheus, Grafana, Loki, Alertmanager, Network Map, Postgres | Prometheus scraper host; most sensitive to monitoring breakage |
| jellyberry | 192.168.1.159 | Hermes/lightweight services, Dozzle agent, portfolio dashboards | current operator/Hermes host |

Deferred/handled separately:

| Host | Reason |
| --- | --- |
| jellybackup | Borg target; define backup-specific SSH/Borg allowlist separately |
| jellyoffice | Pi Zero sensor node; Wi-Fi-only/headless constraints; Tailscale/SSH and MQTT publisher only |
| seedbox | remote host; not on LAN UFW rollout |

## Current service exposure baseline

Derived from source-managed Compose and inventory.

### jellyhome

Expected LAN/Tailnet service ports:

| Port | Service | Intended access |
| --- | --- | --- |
| 22/tcp | SSH | LAN admin + Tailscale SSH/back-door |
| 80/tcp | Homepage | LAN/Tailnet dashboard |
| 8080/tcp | Dozzle UI | LAN/Tailnet operator UI |
| 9443/tcp | Portainer UI | LAN/Tailnet operator UI; sensitive |
| 1883/tcp | Mosquitto MQTT | LAN IoT/MQTT clients; restrict tighter later with broker ACLs already in place |
| 9001/tcp | Mosquitto websocket | LAN only if required by HA/operators |
| 3214/tcp | Manyfold | LAN/Tailnet app UI |
| 8793/tcp | 3dprint-loader web | LAN/Tailnet app UI |
| 18888/tcp | Hindsight API | LAN/Tailnet only; sensitive |
| 9999/tcp | Hindsight UI/control plane | LAN/Tailnet only; sensitive |
| 12345/tcp | Alloy metrics | Prometheus/jellybase only |
| 9100/tcp | node_exporter | Prometheus/jellybase only |

### jellybase

Expected LAN/Tailnet service ports:

| Port | Service | Intended access |
| --- | --- | --- |
| 22/tcp | SSH | LAN admin + Tailscale SSH/back-door |
| 80/tcp | Homepage | LAN/Tailnet dashboard |
| 3001/tcp | Grafana | LAN/Tailnet operator UI; auth-sensitive |
| 3100/tcp | Loki | Grafana/Alloy/Prometheus paths only where possible |
| 9090/tcp | Prometheus | LAN/Tailnet operator UI; sensitive |
| 9093/tcp | Alertmanager | LAN/Tailnet operator UI; sensitive |
| 8788/tcp | Network Map | LAN/Tailnet dashboard |
| 9000/tcp | mqtt-exporter metrics | Prometheus/local only where possible |
| 5432/tcp | central Postgres | jellybase + jellyhome only; app-layer pg_hba already restricts too |
| 8793/tcp | Jellyfood web | LAN/Tailnet app UI |
| 8794/tcp | Jellyfood API | LAN/Tailnet app API |
| 7007/tcp | Dozzle agent | jellyhome Dozzle UI only |
| 9001/tcp | Portainer agent | jellyhome Portainer server only |
| 12345/tcp | Alloy metrics | Prometheus/local only |
| 9100/tcp | node_exporter | Prometheus/local only; jellybase self-scrape may use Docker host-gateway |

### jellyberry

Expected LAN/Tailnet service ports:

| Port | Service | Intended access |
| --- | --- | --- |
| 22/tcp | SSH | LAN admin + Tailscale SSH/back-door |
| 8787/tcp | Portfolio Mission Control | LAN/Tailnet dashboard |
| 8791/tcp | SC-401 Study Hub | LAN/Tailnet app UI |
| 8792/tcp | Image Pastebin | LAN/Tailnet helper; unauthenticated, keep LAN/Tailnet only |
| 7007/tcp | Dozzle agent | jellyhome Dozzle UI only |
| 12345/tcp | Alloy metrics | Prometheus/jellybase only |
| 9100/tcp | node_exporter | Prometheus/jellybase only |

## Access policy model

Define explicit source groups before any rules are applied.

| Group | CIDR / source | Purpose |
| --- | --- | --- |
| LAN | 192.168.1.0/24 | trusted home LAN clients and services |
| Tailnet | 100.64.0.0/10 or interface `tailscale0` | emergency/operator access and Tailnet dashboards |
| Prometheus scraper | jellybase: 192.168.1.2, plus jellybase local/Docker host-gateway path | scrape node_exporter, Alloy, exporters |
| Docker bridge/local | host-specific bridge/host-gateway ranges | required only where local containers scrape host services |
| Service peer: jellyhome | 192.168.1.1 | Dozzle/Portainer/MQTT app/service peer |
| Service peer: jellybase | 192.168.1.2 | monitoring/database/service peer |

## Proposed UFW defaults

Per host:

```bash
ufw default deny incoming
ufw default allow outgoing
```

Always add allow rules before enabling:

```bash
ufw allow in on tailscale0 comment 'Tailnet emergency/operator access'
ufw allow from 192.168.1.0/24 to any port 22 proto tcp comment 'LAN SSH admin'
```

Then add host-specific service allows.

Do not use broad `ufw allow 9100/tcp`; use source-restricted rules for node_exporter and agent metrics.

## Host-specific rule intent

### jellyhome

Allow from LAN/Tailnet:

- 22, 80, 8080, 9443, 1883, 9001, 3214, 8793, 18888, 9999

Restrict to jellybase / monitoring source:

- 9100 node_exporter
- 12345 Alloy metrics

### jellybase

Allow from LAN/Tailnet:

- 22, 80, 3001, 9090, 9093, 8788, 8793, 8794

Restrict to service peers:

- 5432 Postgres: allow from jellyhome and jellybase only
- 7007 Dozzle agent: allow from jellyhome only
- 9001 Portainer agent: allow from jellyhome only
- 3100 Loki: allow Grafana/local, Alloy senders (`jellyhome`, `jellyberry`, `jellybase`) if direct LAN/Tailnet push remains required
- 9000 mqtt-exporter: allow Prometheus/local only
- 9100 node_exporter: allow Prometheus/local/Docker host-gateway path only
- 12345 Alloy metrics: allow Prometheus/local only

### jellyberry

Allow from LAN/Tailnet:

- 22, 8787, 8791, 8792

Restrict to service peers:

- 7007 Dozzle agent: allow from jellyhome only
- 9100 node_exporter: allow from jellybase only
- 12345 Alloy metrics: allow from jellybase only

## Rollout sequence

Apply one host at a time. Recommended order:

1. jellyberry — lower blast radius, but current Hermes host; verify Hermes/gateway first.
2. jellyhome — many user-facing services; verify Mosquitto/HA/Dozzle/Portainer/Manyfold/Hindsight.
3. jellybase — monitoring and database host; do last after lessons from the first two.

Per host:

1. Preflight snapshot:
   - `hostname -s`
   - `ip -o -4 addr`
   - `tailscale status`
   - `sudo ufw status verbose`
   - `docker ps --format '{{.Names}} {{.Ports}}'`
   - `ss -ltnup`
2. Tailscale SSH emergency access is verified on `jellyhome`, `jellybase`, and `jellyberry` from an operator machine; LAN SSH remains allowed as the backdoor-for-the-backdoor.
3. Generate staged rule script for that host.
4. Review script in terminal before execution.
5. Apply allow rules while UFW is still inactive.
6. Enable UFW.
7. Verify positive paths.
8. Verify restricted paths fail from a non-approved source.
9. Commit evidence into rollout notes.
10. Proceed to next host only after the first is stable.

## Positive verification checklist

After enabling on a host:

- LAN SSH still works from an operator machine.
- Tailscale SSH still works.
- Required dashboard/app URLs return expected HTTP status.
- Prometheus `up` remains `1` for affected scrape jobs.
- Network Map still shows host health.
- Alertmanager has no new target-down alerts after the scrape interval settles.
- Dozzle/Portainer agent links still work where relevant.

## Negative verification checklist

From a non-scraper LAN client where possible:

- `9100/tcp` should not connect to node_exporter.
- `12345/tcp` should not connect to Alloy metrics.
- Dozzle/Portainer agent ports should not connect except from their central UI/server host.
- Postgres `5432` should not connect except approved service peers.

## Rollback

From Tailscale SSH or local console:

```bash
sudo ufw disable
sudo ufw reset
```

If only a single bad rule was added:

```bash
sudo ufw status numbered
sudo ufw delete <number>
```

Keep the current LAN and Tailnet URLs documented so service recovery can be tested quickly.

## Open decisions before live application

- Confirm whether all LAN clients should access Grafana/Prometheus/Alertmanager, or only admin/operator devices.
- Confirm whether Hindsight API/UI should remain LAN-visible or become Tailnet/admin-only.
- Confirm whether Image Pastebin should remain unauthenticated LAN-wide.
- Confirm source IPs for operator/admin devices if narrowing SSH beyond `192.168.1.0/24`.
- Confirm exact Docker bridge/host-gateway scrape path for jellybase self node_exporter before restricting `9100`.

## Status

This spec is ready for operator review. No live firewall changes have been made by this spec.
