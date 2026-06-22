# Jellydisp Zigbee2MQTT runbook

## Purpose

`jellydisp` runs Zigbee2MQTT beside the local `mqtt-edge` broker and HA-spoke. This keeps Zigbee plugs and temperature/humidity sensors available even when larger homelab hosts are shut down for heat.

Design rule:

```text
SONOFF USB dongle is owned by Zigbee2MQTT only.
Do not enable ZHA for this dongle.
```

## Runtime URLs

```text
Zigbee2MQTT frontend: http://192.168.1.92:8080
HA-spoke:             http://192.168.1.92:8123
MQTT edge broker:     mqtt://192.168.1.92:1883
```

## Bootstrap

From the `home-network` checkout on jellydisp:

```bash
cd /home/jellyfish/repo/home-network
sudo ./scripts/bootstrap-jellydisp-meross-spoke --start
```

The shared bootstrap now prepares the Meross HA-spoke, local MQTT broker, and Zigbee2MQTT. It:

- seeds `/opt/docker/appdata/zigbee2mqtt/data/configuration.yaml` only when missing
- preserves Zigbee2MQTT runtime files such as `database.db`, `state.json`, logs, `secret.yaml`, and UI-mutated `configuration.yaml`
- creates/updates the MQTT `zigbee2mqtt` user
- writes `/opt/docker/appdata/zigbee2mqtt/data/secret.yaml`, including MQTT and frontend-auth secrets
- starts/recreates `mqtt-edge` and `zigbee2mqtt`

## Source-managed config

```text
docker/hosts/jellydisp.yaml
docker/appdata/zigbee2mqtt/data/configuration.yaml
docker/appdata/mosquitto-edge/config/aclfile
```

Runtime secrets:

```text
/opt/docker/.secrets/mosquitto-edge/credentials.env
/opt/docker/.secrets/mosquitto-edge/passwordfile
/opt/docker/appdata/zigbee2mqtt/data/secret.yaml
```

Do not paste or commit these values.

The Zigbee2MQTT frontend auth token is stored host-locally in `credentials.env` as:

```text
ZIGBEE2MQTT_FRONTEND_AUTH_TOKEN=...
```

`configuration.yaml` is seeded from Git before first start, then treated as runtime-owned. Zigbee2MQTT/frontend operations may write friendly names, device options, groups, and other runtime state there. If the source template changes later, port only safe changes to the runtime file deliberately.

## Coordinator

Current stable device path:

```text
/dev/serial/by-id/usb-Itead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_966928559f78f011ae4fa8e70ba521c7-if00-port0
```

Container mapping:

```text
host by-id path -> /dev/zigbee
```

Zigbee2MQTT serial config:

```yaml
serial:
  port: /dev/zigbee
  adapter: ember
  rtscts: false
```

## Verification

On jellydisp:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellydisp.yaml ps
docker logs --tail=80 zigbee2mqtt
ss -ltnp | grep -E ':1883|:8080|:8123'
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
```

From another LAN host:

```bash
nc -vz 192.168.1.92 8080
```

MQTT read smoke test from jellydisp:

```bash
. /opt/docker/.secrets/mosquitto-edge/credentials.env
mosquitto_sub -h 127.0.0.1 -p 1883 -u "$ZIGBEE2MQTT_MQTT_USERNAME" -P "$ZIGBEE2MQTT_MQTT_PASSWORD" -t 'zigbee2mqtt/bridge/state' -C 1 -W 10
```

## Pairing workflow

1. Open `http://192.168.1.92:8080`.
2. Enable permit join temporarily.
3. Pair one mains-powered plug first. Mains devices usually help route the mesh.
4. Pair one temperature/humidity sensor.
5. Rename devices to stable friendly names before building dashboards.
6. Disable permit join again.
7. Confirm HA-spoke sees the devices through MQTT discovery.

Recommended naming pattern:

```text
room_device_kind
office_heater_plug
lounge_temperature_sensor
kitchen_fridge_plug
```

## Main HA / central Mosquitto bridge later

Do not add the central bridge until local Zigbee2MQTT is stable.

Future bridge direction:

```text
edge -> central: zigbee2mqtt/#, homeassistant/#, homelab/power/#, ha-spoke/status/#
central -> edge: zigbee2mqtt/+/set, zigbee2mqtt/bridge/request/#, homeassistant/status
```

Never bridge `#` both ways.

## Rollback

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellydisp.yaml stop zigbee2mqtt
```

Preserve `/opt/docker/appdata/zigbee2mqtt/data`; it contains coordinator/device state.
