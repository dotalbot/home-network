# 009 Jellydisp Meross HA spoke and edge MQTT

## Goal

Prepare `jellydisp` to act as the always-on low-power spoke for Meross power telemetry during heat-shutdown periods.

Target flow:

```text
Meross plugs
  -> Home Assistant spoke on jellydisp with Meross LAN
  -> local edge Mosquitto on jellydisp
  -> main Home Assistant / Prometheus / VictoriaMetrics / Grafana when the main stack is online
```

This avoids treating Meross plugs as Tasmota-style MQTT-native devices. Meross-specific discovery and API handling live on the spoke; everything downstream consumes clean MQTT topics.

## Current live discovery

Observed from jellyberry on 2026-06-22:

- `jellydisp` is online via Tailscale `100.99.15.72` and LAN `192.168.1.92`.
- OS: Debian GNU/Linux 13 trixie, Raspberry Pi aarch64.
- Memory: about 2 GB.
- Root disk: about 29 GB, 25% used.
- `prometheus-node-exporter` is active.
- Docker is not installed/running yet.
- SSH works as `jellyfish` over LAN, but passwordless sudo is not available.
- Existing broker on `jellyhome:1883` was not reachable from jellydisp or jellyberry during discovery, so jellydisp should host its own edge broker for heat-resilient operation.

## Scope

In scope:

- Source-managed Docker Compose overlay for jellydisp.
- Edge Mosquitto broker on TCP/1883.
- Home Assistant spoke container on TCP/8123 using host networking.
- Host-local MQTT credentials and ACLs.
- Manual Meross LAN/HACS setup instructions.
- HA-spoke automation examples that publish normalized `homelab/power/...` MQTT JSON.

Out of scope for first pass:

- Node-RED or InfluxDB on jellydisp. With 2 GB RAM, start with HA recorder plus retained MQTT state; add an edge SQLite logger later if needed.
- Main HA control of Meross switches. The spoke is collector/bridge first; avoid duplicate control paths.
- Re-pairing Meross plugs to local MQTT.
- Exposing jellydisp HA or MQTT outside trusted LAN/Tailscale.

## Source-managed runtime shape

Files added:

- `docker/hosts/jellydisp.yaml`
- `docker/appdata/mosquitto-edge/config/mosquitto.conf`
- `docker/appdata/mosquitto-edge/config/aclfile`
- `scripts/bootstrap-jellydisp-meross-spoke`
- `docs/runbooks/jellydisp-meross-spoke.md`

Runtime paths on jellydisp:

- `/opt/docker/docker-compose.yml`
- `/opt/docker/hosts/jellydisp.yaml`
- `/opt/docker/appdata/mosquitto-edge/config`
- `/opt/docker/appdata/mosquitto-edge/data`
- `/opt/docker/appdata/homeassistant-spoke/config`
- `/opt/docker/.secrets/mosquitto-edge/passwordfile`
- `/opt/docker/.secrets/mosquitto-edge/credentials.env`

## MQTT topic contract

Preferred state topic per plug:

```text
homelab/power/<device_slug>/state
```

Payload shape:

```json
{
  "power_w": 12.3,
  "energy_kwh": 1.234,
  "voltage_v": 240.1,
  "current_a": 0.05,
  "source": "ha-spoke",
  "ts": "2026-06-22T12:34:56+01:00"
}
```

Use QoS 1 and retained messages for latest state only. Do not rely on retained MQTT for long outage history.

## Acceptance criteria

- [x] Live jellydisp facts checked before changing source.
- [x] Current jellydisp LAN IP reconciled to `192.168.1.92` in source-managed monitoring config.
- [x] Source-managed Compose overlay exists for `mqtt-edge` and `ha-spoke`.
- [x] Source-managed Mosquitto config and ACL exist.
- [x] Bootstrap script exists and keeps credentials host-local.
- [x] Operator runs bootstrap with sudo on jellydisp.
- [x] `docker compose ... config` passes on jellydisp.
- [x] `mqtt-edge` container process healthcheck is healthy and a credentialed publish/subscribe smoke test passes from jellydisp.
- [x] TCP/1883 is reachable from the trusted LAN using the `main-ha` read-only credential.
- [x] `ha-spoke` first-start wizard reachable at `http://192.168.1.92:8123`.
- [ ] Meross LAN integration installed/configured in HA-spoke.
- [ ] HA-spoke MQTT integration points at `127.0.0.1:1883` using the `ha-spoke` credential.
- [ ] At least one Meross power sensor publishes clean MQTT JSON under `homelab/power/#`.
- [ ] Main HA consumes the edge topic read-only using the `main-ha` credential.

## Rollback

1. Stop containers on jellydisp:

```bash
cd /opt/docker && docker compose --env-file .env -f docker-compose.yml -f hosts/jellydisp.yaml stop homeassistant-spoke mosquitto-edge
```

2. Preserve state by default. Do not delete `/opt/docker/appdata/homeassistant-spoke`, `/opt/docker/appdata/mosquitto-edge`, or `/opt/docker/.secrets/mosquitto-edge` unless explicitly requested.

3. Remove the main HA MQTT sensors that point to jellydisp if they were added.
