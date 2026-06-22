# Jellydisp Meross HA spoke runbook

## Purpose

`jellydisp` runs a low-power Home Assistant spoke and local edge MQTT broker so Meross plug telemetry can continue while larger homelab servers are shut down for heat.

Design rule:

```text
Meross-specific work stays on jellydisp HA-spoke.
Everything else consumes MQTT.
```

## Bootstrap

Prerequisites:

- Run from a `home-network` checkout on jellydisp.
- Use the `jellyfish` operator account.
- Sudo is required for package install, `/opt/docker`, Docker service setup, and host-local secrets.

Run this only on jellydisp. The script has a hostname guard and will refuse to run elsewhere unless `JELLYDISP_BOOTSTRAP_FORCE=1` is explicitly set for a deliberate test host.

First dry-run:

```bash
sudo ./scripts/bootstrap-jellydisp-meross-spoke --dry-run
```

Install Docker, create `/opt/docker`, generate MQTT credentials, sync source-managed config, and start the two containers:

```bash
sudo ./scripts/bootstrap-jellydisp-meross-spoke --start
```

If Docker group membership changes, log out/in before using Docker as the operator. Sudo can still be used for immediate verification.

## Runtime verification

On jellydisp:

```bash
cd /opt/docker
docker compose --env-file .env -f docker-compose.yml -f hosts/jellydisp.yaml ps
docker logs --tail=50 mqtt-edge
docker logs --tail=50 ha-spoke
ss -ltnp | grep -E ':1883|:8123'
```

The `mqtt-edge` container healthcheck only checks the Mosquitto process, so it is not coupled to ACLs or secret file readability. Run a separate credentialed smoke test after startup:

```bash
. /opt/docker/.secrets/mosquitto-edge/credentials.env
mosquitto_sub -h 127.0.0.1 -p 1883 -u "$HA_SPOKE_MQTT_USERNAME" -P "$HA_SPOKE_MQTT_PASSWORD" -t ha-spoke/status/bootstrap -C 1 -W 10 &
sleep 1
mosquitto_pub -h 127.0.0.1 -p 1883 -u "$HA_SPOKE_MQTT_USERNAME" -P "$HA_SPOKE_MQTT_PASSWORD" -t ha-spoke/status/bootstrap -m ok
wait
```

From another LAN host:

```bash
nc -vz 192.168.1.92 1883
nc -vz 192.168.1.92 8123
```

Open the HA-spoke first-start UI:

```text
http://192.168.1.92:8123
```

## Credentials

Generated credentials live only on jellydisp:

```text
/opt/docker/.secrets/mosquitto-edge/credentials.env
/opt/docker/.secrets/mosquitto-edge/passwordfile
```

Do not commit or paste these values. Use them to configure:

- HA-spoke MQTT integration: user `ha-spoke`, host `127.0.0.1`, port `1883`.
- Main HA MQTT integration/sensors: user `main-ha`, host `192.168.1.92`, port `1883`.
- Optional future edge logger: user `edge-logger`.

## Home Assistant spoke setup

1. Complete HA first-start wizard.
2. Install HACS if it is not already available.
3. Install the Meross LAN custom integration.
4. Add Meross LAN to HA-spoke.
5. Prefer local/direct LAN communication first. Use Meross cloud fallback only if a plug/model needs it.
6. Add MQTT integration pointing to the local edge broker:
   - broker: `127.0.0.1`
   - port: `1883`
   - username: `ha-spoke`
   - password: from `credentials.env`

Keep HA-spoke collector-only at first. Do not duplicate Meross switch-control automations in both main HA and HA-spoke.

## Example HA-spoke automation

Adjust entity IDs after Meross LAN discovers the actual entities.

```yaml
alias: Publish main power plug to edge MQTT
mode: queued
trigger:
  - platform: state
    entity_id:
      - sensor.main_power_power
      - sensor.main_power_energy
      - sensor.main_power_voltage
      - sensor.main_power_current
action:
  - service: mqtt.publish
    data:
      topic: homelab/power/main_power/state
      qos: 1
      retain: true
      payload: >
        {
          "power_w": {{ states('sensor.main_power_power') | float(0) }},
          "energy_kwh": {{ (states('sensor.main_power_energy') | float(0)) / 1000 }},
          "voltage_v": {{ states('sensor.main_power_voltage') | float(0) }},
          "current_a": {{ states('sensor.main_power_current') | float(0) }},
          "source": "ha-spoke",
          "ts": "{{ now().isoformat() }}"
        }
```

Note: existing main HA discovery showed `sensor.main_power_energy` in Wh, so this example normalizes it to kWh.

## Main Home Assistant read-only MQTT sensors

Example for main HA once the edge broker is reachable:

```yaml
mqtt:
  sensor:
    - name: Server Plug Power
      state_topic: homelab/power/main_power/state
      value_template: "{{ value_json.power_w }}"
      unit_of_measurement: W
      device_class: power
      state_class: measurement

    - name: Server Plug Energy
      state_topic: homelab/power/main_power/state
      value_template: "{{ value_json.energy_kwh }}"
      unit_of_measurement: kWh
      device_class: energy
      state_class: total_increasing

    - name: Server Plug Voltage
      state_topic: homelab/power/main_power/state
      value_template: "{{ value_json.voltage_v }}"
      unit_of_measurement: V
      device_class: voltage
      state_class: measurement
```

## DNS / addressing

Current live LAN IP discovered for jellydisp is `192.168.1.92`; Tailscale IP is `100.99.15.72`.

Recommended next operator action: create a router DHCP reservation and DNS alias such as:

```text
mqtt.lan -> 192.168.1.92
ha-spoke.lan -> 192.168.1.92
```

Do not rely on the previous stale inventory IP `192.168.1.140`.

## Edge history

First pass uses retained MQTT state plus HA-spoke recorder. If heat-shutdown history needs to survive HA restarts or be exported independently, add a small MQTT-to-SQLite logger later using the `edge-logger` credential.
