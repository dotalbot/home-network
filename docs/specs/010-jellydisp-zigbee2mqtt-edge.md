# 010 Jellydisp Zigbee2MQTT edge gateway

## Goal

Run the SONOFF Zigbee 3.0 USB Dongle Plus V2 attached to `jellydisp` as a single Zigbee coordinator via Zigbee2MQTT, using the local `mqtt-edge` broker and HA-spoke for heat-resilient control/monitoring.

Target flow:

```text
Zigbee plugs / temperature / humidity sensors
  -> SONOFF coordinator on jellydisp
  -> Zigbee2MQTT on jellydisp
  -> local mqtt-edge broker on jellydisp
  -> HA-spoke via MQTT discovery/control
  -> main HA / Grafana / VictoriaMetrics later when central hosts are online
```

## Live discovery

Observed on 2026-06-22:

```text
/dev/serial/by-id/usb-Itead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_966928559f78f011ae4fa8e70ba521c7-if00-port0 -> ../../ttyUSB0
```

This is treated as a SONOFF ZBDongle-E / Silicon Labs class coordinator, so Zigbee2MQTT uses:

```yaml
serial:
  port: /dev/zigbee
  adapter: ember
  rtscts: false
```

## Scope

In scope:

- Source-managed Zigbee2MQTT service on jellydisp.
- Persistent data at `/opt/docker/appdata/zigbee2mqtt/data`.
- Host-local Zigbee2MQTT MQTT credential in `secret.yaml`.
- Zigbee2MQTT MQTT ACLs for `zigbee2mqtt/#` and Home Assistant discovery.
- Zigbee2MQTT frontend on `http://192.168.1.92:8080`.
- `permit_join: false` by default.

Out of scope for this pass:

- Pairing all Zigbee devices.
- Central jellyhome MQTT bridge. Do this after local devices are stable.
- ZHA. The USB coordinator must be owned by exactly one stack; Zigbee2MQTT is the owner.
- Long-term metrics/CSV import. VictoriaMetrics remains the later metrics archive path.

## Topic and ownership model

Zigbee2MQTT is the single Zigbee device writer:

```text
zigbee2mqtt/<friendly_name>
zigbee2mqtt/<friendly_name>/set
zigbee2mqtt/bridge/#
homeassistant/#
```

HA-spoke consumes MQTT discovery and can send control commands. Main HA should consume via a later bridge or direct broker access, but must not run ZHA against this dongle.

## Acceptance criteria

- [x] SONOFF dongle by-id path discovered on jellydisp.
- [x] Source-managed Zigbee2MQTT configuration exists with `adapter: ember` and by-id device mapping.
- [x] Mosquitto ACL includes `zigbee2mqtt` and HA/main consumers for Zigbee topics.
- [x] Bootstrap generates host-local Zigbee2MQTT MQTT credentials and `secret.yaml`.
- [x] Docker Compose config validates with the jellydisp overlay.
- [x] Operator runs bootstrap with sudo on jellydisp after this spec lands.
- [x] `zigbee2mqtt` container starts and reports coordinator connection.
- [x] Zigbee2MQTT frontend is reachable at `http://192.168.1.92:8080`.
- [x] MQTT smoke test publishes/subscribes on `zigbee2mqtt/bridge/state` or another Zigbee2MQTT topic.
- [ ] One plug and one temperature/humidity sensor are paired and visible in HA-spoke.

## Future central bridge

After local pairing is stable, add a telemetry-first bridge from jellydisp `mqtt-edge` to jellyhome central Mosquitto:

```text
edge -> central: zigbee2mqtt/#, homeassistant/#, homelab/power/#, ha-spoke/status/#
central -> edge: zigbee2mqtt/+/set, zigbee2mqtt/bridge/request/#, homeassistant/status
```

Do not bridge `#` both ways.

## Rollback

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellydisp.yaml stop zigbee2mqtt
```

Preserve `/opt/docker/appdata/zigbee2mqtt/data` by default. It contains coordinator/device state and should not be deleted unless intentionally rebuilding the Zigbee network.
