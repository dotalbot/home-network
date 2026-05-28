# Docker DOCKER-USER firewall hardening

Status: staged; apply host-by-host only after reviewing dry-run output.

Related baseline: `docs/operations/host-firewall-ufw-rollout.md`

## Why this exists

UFW is now active and positively verified on the Docker hosts, but Docker-published ports can bypass normal host INPUT policy because Docker DNAT/forwarding rules are applied before UFW sees some traffic.

`DOCKER-USER` is Docker's supported operator chain for filtering forwarded Docker traffic before Docker's own accept rules.

## Scope

This hardening targets only sensitive Docker-published ports:

- metrics/agent endpoints
- central database endpoint
- log aggregation endpoint where broad LAN exposure is unnecessary

It intentionally does not restrict user-facing LAN/Tailnet apps such as Homepage, Grafana, Prometheus UI, Network Map, Home Assistant, Jellyfood, Hindsight, Manyfold, MQTT, or jellyhome package/dev ports `8888`/`8889`.

## Source-managed helper

```bash
scripts/firewall/apply-docker-user-hardening          # dry-run
scripts/firewall/apply-docker-user-hardening --apply  # apply locally with sudo
```

Run it on each Docker host:

1. `jellyberry`
2. `jellyhome`
3. `jellybase`

The helper resolves current container IPs at runtime. Re-run after recreating restricted containers, because DOCKER-USER rules match container IPs after Docker DNAT.

## Policy by host

### jellyberry

Restricted Docker-published ports:

- `dozzle-agent:7007`: allow only `192.168.1.1/32` (`jellyhome` Dozzle UI)
- `alloy:12345`: allow only `192.168.1.2/32` (`jellybase` Prometheus)

2026-05-28 apply result:

- User applied `scripts/firewall/apply-docker-user-hardening --apply` on jellyberry after root-mode bug fix.
- Follow-up checks confirmed HTTP 200 for Mission Control `8787`, SC-401 Study Hub `8791`, and Image Pastebin `8792`.
- Prometheus `up` remained `1` for `jellyberry:9100` node_exporter and `jellyberry:12345` Alloy.
- Dozzle UI on jellyhome `8080` remained reachable. Direct HTTP probing of `jellyberry:7007` returned remote close, which is expected for the Dozzle agent protocol and not treated as service failure.
- Alertmanager still showed only the two pre-existing jellybase warning alerts (`HomeNetworkScheduledOpsCheckFailed`, `HostSystemdFailedUnits`).

### jellyhome

Restricted Docker-published ports:

- `alloy:12345`: allow only `192.168.1.2/32` (`jellybase` Prometheus)

2026-05-28 apply result:

- User applied `scripts/firewall/apply-docker-user-hardening --apply` on jellyhome.
- Follow-up checks confirmed HTTP 200 for Homepage `80`, Dozzle `8080`, Portainer `9443`, 3dprint-loader `8793`, Hindsight API `18888`, and Hindsight UI `9999`.
- Manyfold `3214` remained reachable but returned the known application redirect loop, indicating transport was not blocked.
- Package/dev delivery ports `8888` and `8889` accepted TCP connections and remain available.
- Prometheus `up` remained `1` for `jellyhome:9100` node_exporter and `jellyhome:12345` Alloy.
- Alertmanager still showed only the two pre-existing jellybase warning alerts (`HomeNetworkScheduledOpsCheckFailed`, `HostSystemdFailedUnits`).

Not restricted here:

- `8888` and `8889` must remain open from LAN/Tailnet for package delivery/dev workflows.
- Mosquitto, Homepage, Portainer UI, Dozzle UI, Manyfold, 3dprint-loader, and Hindsight stay governed by the UFW LAN/Tailnet allowlist.

### jellybase

Restricted Docker-published ports:

- `central-postgres:5432`: allow `192.168.1.1/32` and `192.168.1.2/32`
- `dozzle-agent:7007`: allow `192.168.1.1/32`
- `portainer-agent:9001`: allow `192.168.1.1/32`
- `loki:3100`: allow `192.168.1.1/32`, `192.168.1.159/32`, `192.168.1.2/32`, `100.64.0.0/10`, and `172.16.0.0/12`
- `mqtt-exporter:9000`: allow `172.16.0.0/12`
- `alloy:12345`: allow `172.16.0.0/12` and `192.168.1.2/32`

Tailnet is allowed for Loki because remote Alloy containers currently resolve `jellybase` to the jellybase Tailscale IP via `extra_hosts`.

2026-05-28 apply result:

- User applied `scripts/firewall/apply-docker-user-hardening --apply` on jellybase.
- Follow-up checks confirmed HTTP 200/ready responses for Homepage `80`, Grafana `3001`, Prometheus `9090`, Alertmanager `9093`, Network Map `8788`, Home Assistant `8123`, Jellyfood web `8793`, Jellyfood API `8794`, and Loki `3100`.
- Direct `mqtt-exporter:9000` from jellyberry timed out, but Prometheus still scraped mqtt-exporter successfully with `up=1`, which confirms the approved local Docker scrape path still works while non-approved LAN access is blocked.
- Prometheus `up` remained `1` for all node_exporter targets (`jellybase`, `jellyhome`, `jellyberry`) and all Alloy targets (`jellybase`, `jellyhome`, `jellyberry`).
- Negative checks from non-approved `jellyberry` to jellybase restricted ports timed out as intended: `5432`, `7007`, `9001`, `12345`, and `9000`.
- Alertmanager still showed only the two pre-existing jellybase warning alerts (`HomeNetworkScheduledOpsCheckFailed`, `HostSystemdFailedUnits`).

## Apply sequence

For each host:

1. Confirm Tailscale SSH and LAN SSH still work.
2. Run dry-run:

```bash
cd ~/repo/home-network 2>/dev/null || cd /home/jellybot/home-network
scripts/firewall/apply-docker-user-hardening
```

3. Apply:

```bash
scripts/firewall/apply-docker-user-hardening --apply
```

4. Verify positives:

```bash
curl -fsS http://192.168.1.2:9090/-/ready
curl -fsS 'http://192.168.1.2:9090/api/v1/query?query=up'
```

5. Verify no new Alertmanager alerts.
6. Negative-check from a non-approved LAN client when available.

## Rollback

Fast rollback on the affected host:

```bash
sudo iptables -F DOCKER-USER
```

Optional Docker chain refresh if needed:

```bash
sudo systemctl restart docker
```

Restarting Docker interrupts containers, so prefer flushing `DOCKER-USER` first.

## Known caveats

- DOCKER-USER rules are not made reboot-persistent by this helper yet. Add a systemd unit or iptables-persistent after the policy is verified.
- Rules match current container IPs. Re-run after container recreation or replace with a persistent generated apply unit.
- Negative tests require a non-approved source; positive tests alone prove no breakage, not full isolation.
