# Spec 006: Jellyoffice — Pi Zero 2 W Environmental Sensor Node

Status: partially deployed (Phases 0-3 live)  
Number: 006  
Created: 2026-05-27  
Updated: 2026-05-27  

## Goal

Bootstrap a Raspberry Pi Zero 2 W with a Pimoroni Enviro board as a lightweight environmental sensor node (`jellyoffice`) that ships data via MQTT to the existing Mosquitto broker on jellyhome. The device integrates with Home Assistant via MQTT auto-discovery and feeds metrics into Prometheus via an MQTT-exporter bridge on jellybase. No Docker runs on this device.

## Context

### Hardware

| Component | Detail |
|-----------|--------|
| Board | Raspberry Pi Zero 2 W |
| CPU | BCM2710A1, 4-core Cortex-A53 @ 1GHz |
| RAM | 512MB |
| OS | Raspberry Pi OS Lite 32-bit (armhf) |
| Network | WiFi only (no Ethernet) |
| Sensor hat | [Pimoroni Enviro](https://shop.pimoroni.com/products/enviro?variant=31155658489939) (PIM486, £30) |

### Pimoroni Enviro sensors (NOT Enviro+)

| Sensor | Measures | Notes |
|--------|----------|-------|
| BME280 | Temperature, pressure, humidity | Pi heat affects readings — use GPIO extender cable (£5-6) to isolate |
| LTR-559 | Light (lux), proximity | |
| ADS1015/ADS1115 | ADC for noise microphone | Auto-detected by Pimoroni library |
| MEMS microphone (SPH0645LM4H) | Noise level (amplitude) | Not decibel-calibrated |

**Not present on Enviro (vs Enviro+):**
- No MICS6814 gas sensor (oxidising, reducing, NH₃)
- No PMS5003 particulate matter connector
- No air quality sensing capability beyond the above

I2C verification on jellyoffice shows `0x23` (ADS1015) and `0x76` (BME280) which matches Enviro hardware.

### Key constraints

- **512MB RAM**: No Docker, no node_exporter, no Alloy, no Borg. Every service must be native and minimal.
- **32-bit armhf OS**: Limits available packages; Pimoroni library supports this architecture.
- **WiFi only**: Less reliable than Ethernet; needs reconnection logic and watchdog.
- **Known BME280 heat issue**: Temperature readings are inflated by Pi CPU heat. Mitigation: GPIO extender cable to physically separate the Enviro from the Pi, plus software offset.
- **ADS1015/noise status**: ADS1015 is detected at `0x23`, but live channel reads currently return I/O errors. Noise is deferred until the channel/read path is verified.

## Host: jellyoffice

```yaml
# inventory/hosts.yml
jellyoffice:
  description: Raspberry Pi Zero 2 W environmental sensor node with Pimoroni Enviro
  lan_ip: TBD
  tailscale_ip: 100.120.3.77
  roles:
    - pi
    - iot-sensor
    - mqtt-publisher
    - tailscale-node
  monitoring:
    node_exporter:
      enabled: false
      note: >
        Too resource-intensive for 512MB device.
        Health metrics (uptime, CPU temp, disk, memory) published via MQTT
        and bridged to Prometheus through mqtt-exporter on jellybase.
  backup:
    class: none
    note: >
      No Borg backup. Sensor data ships to MQTT immediately.
      Config lives in the home-network repo (systemd units, Python script).
      Recovery: re-flash OS → bootstrap → pull config from git.
  notes:
    - 512MB RAM, no Docker; runs sensor Python script natively via systemd
    - 32-bit Pi OS Lite (armhf)
    - Enviro has known BME280 temperature offset from Pi heat; use GPIO extender cable
    - ADS1015 detected at 0x23, but noise channel reads currently return I/O errors; noise publishing deferred
```

## Architecture

```
┌─────────────────┐         MQTT          ┌──────────────────┐
│   jellyoffice   │──────────────────────│  jellyhome        │
│  Pi Zero 2 W    │  home/sensors/       │  Mosquitto:1883  │
│  Enviro board   │  jellyoffice/#       │                  │
│                 │                      │  Home Assistant  │
│  systemd:       │                      │  (auto-discovery)│
│  enviro-        │                      └──────────────────┘
│  publisher svc  │                               │
│                 │                               │ MQTT
└─────────────────┘                               │
                                                  ▼
                                          ┌──────────────────┐
                                          │  jellybase        │
                                          │  mqtt-exporter    │
                                          │  :9000/metrics    │
                                          │                  │
                                          │  Prometheus      │
                                          │  scrapes mqtt-   │
                                          │  exporter        │
                                          └──────────────────┘
```

### Data flow

1. `enviro-publisher.py` reads sensors every 60 seconds
2. Publishes JSON and individual topics to `home/sensors/jellyoffice/#` on Mosquitto (jellyhome:1883)
3. Home Assistant auto-discovers sensors via MQTT discovery messages on `homeassistant/sensor/jellyoffice/#`
4. `mqtt-exporter` on jellybase subscribes to `home/sensors/jellyoffice/#` and exposes Prometheus metrics on `:9000`
5. Prometheus scrapes `mqtt-exporter` alongside other targets

### What runs on jellyoffice

| Service | Method | RAM estimate |
|---------|--------|-------------|
| Tailscale | systemd | ~15MB |
| enviro-publisher.py | systemd (Python venv) | ~25-30MB |
| sshd | systemd | ~5MB |
| **Total** | | **~45-50MB** |

### What does NOT run on jellyoffice

| Excluded | Reason |
|----------|--------|
| Docker | 512MB RAM; not needed for a single Python script |
| node_exporter | 10-15MB RAM too heavy; health via MQTT instead |
| Alloy / log shipping | No RAM; check logs via Tailscale SSH |
| Borg / Borgmatic | No data worth backing up locally; config in git |
| Dozzle agent | No Docker containers to log |

## MQTT topic structure

All sensor data is published under `home/sensors/jellyoffice/`:

```text
home/sensors/jellyoffice/temperature          # °C (float)
home/sensors/jellyoffice/humidity             # % (float)
home/sensors/jellyoffice/pressure             # hPa (float)
home/sensors/jellyoffice/lux                  # lux (float)
# noise is deferred: ADS1015 is detected at 0x23, but channel reads currently return I/O errors
home/sensors/jellyoffice/proximity            # raw proximity (float)
home/sensors/jellyoffice/health              # JSON: uptime, cpu_temp, disk_used_pct, mem_avail_mb
```

### MQTT message format

Individual topics use plain float values with retain flag:

```text
home/sensors/jellyoffice/temperature → 21.3
home/sensors/jellyoffice/humidity    → 54.2
```

Health topic uses JSON:

```json
{
  "uptime_seconds": 86400,
  "cpu_temp_c": 42.1,
  "disk_used_pct": 35,
  "mem_avail_mb": 180,
  "sensor_board_connected": true,
  "wifi_rssi_dbm": -52
}
```

## Home Assistant MQTT auto-discovery

The publisher sends MQTT discovery config messages on startup to `homeassistant/sensor/jellyoffice/<sensor_id>/config`. This means Home Assistant will automatically create all sensor entities without manual YAML configuration.

Discovery payload example (per sensor):

```json
{
  "unique_id": "jellyoffice_temperature",
  "name": "Jellyoffice Temperature",
  "state_topic": "home/sensors/jellyoffice/temperature",
  "unit_of_measurement": "°C",
  "device_class": "temperature",
  "device": {
    "identifiers": ["jellyoffice"],
    "name": "Jellyoffice Enviro",
    "manufacturer": "Pimoroni",
    "model": "Enviro",
    "sw_version": "1.0.0"
  },
  "expire_after": 300
}
```

This is sent for each sensor dimension (temperature, humidity, pressure, lux, proximity) plus lightweight host-health values (CPU temperature, disk used, memory available, Wi-Fi RSSI, uptime).

Before first run, the user needs to:
1. Enable the Mosquitto broker integration in Home Assistant (or add the HA MQTT integration if not already configured)
2. Add MQTT credentials if Mosquitto is configured with authentication (the current jellyhome Mosquitto appears to run without auth on LAN)

## Prometheus bridge: mqtt-exporter

Run `mqtt-exporter` (https://github.com/kpetremann/mqtt-exporter) on jellybase as a Docker container alongside Prometheus.

### Container definition (for docker/hosts/jellybase.yaml)

```yaml
mqtt-exporter:
  image: kpetremann/mqtt-exporter:latest
  container_name: mqtt-exporter
  restart: unless-stopped
  ports:
    - "9000:9000"
  environment:
    MQTT_HOST: mosquitto-host
    MQTT_PORT: "1883"
    MQTT_TOPIC: "home/sensors/#"
    PROMETHEUS_PORT: "9000"
    ZMQ_TOPIC: "home/sensors"
  extra_hosts:
    - "mosquitto-host=192.168.1.1"
```

Note: Mosquitto runs on jellyhome (192.168.1.1), not inside Docker. The `extra_hosts` maps `mosquitto-host` to the LAN IP. Alternatively, run mqtt-exporter on jellyhome alongside Mosquitto.

### Prometheus scrape config

Add to the existing Prometheus config on jellybase:

```yaml
- job_name: mqtt-exporter
  scrape_interval: 60s
  static_configs:
    - targets: ['mqtt-exporter:9000']
```

## Python sensor publisher

### Directory structure on jellyoffice

```text
/opt/jellyoffice/
├── .venv/                          # Python virtual environment
├── enviro_publisher.py            # Main sensor publisher script
├── requirements.txt               # Python dependencies
└── config.json                    # MQTT broker, interval, sensor config
```

### Requirements

```text
# requirements.txt
paho-mqtt>=2.0
smbus2
pimoroni-bme280
ltr559
ads1015
gpiod
gpiodevice
i2cdevice
```

Note: Do **not** install the full `enviroplus` meta-package on jellyoffice. On Raspberry Pi OS 13 / Python 3.13 / armv6 it pulls display/audio dependencies and attempts to build `numpy` from source via `st7735`, which is too heavy for the Pi Zero 2 W. Use the lightweight sensor-specific libraries above instead. Live testing on jellyoffice confirmed:

- BME280 readings via `pimoroni-bme280`
- LTR559 lux/proximity readings via `ltr559`
- ADS1015 object detection via `ads1015`

### Key design decisions

- **Pimoroni examples as reference**: Use Pimoroni's Enviro examples only as references for sensor usage and MQTT reconnect logic. The deployed jellyoffice publisher uses lightweight sensor-specific libraries, not the full Pimoroni meta-package/example stack.
  - Home Assistant MQTT auto-discovery payloads
  - Health metrics alongside environmental data
  - Config-driven topic prefix and broker address
  - Systemd service with proper restart/retry
  - Temperature compensation offset (configurable, defaults to -3°C for Pi heat)
- **Temperature compensation**: Apply a configurable offset (default -3°C) to BME280 readings to partially compensate for Pi CPU heat. Document that a GPIO extender cable is the proper hardware fix.
- **PMS5003**: Not applicable — Enviro does not have a PMS5003 connector. This is an Enviro+ feature only.
- **Noise**: Deferred. ADS1015 is detected at `0x23`, but live channel reads currently return I/O errors.
- **Interval**: Default 60 seconds. Can be overridden in config.
- **Retain**: Publish sensor values with `retain=True` so HA always has the last reading.
- **Last will**: Set MQTT last-will message on `home/sensors/jellyoffice/availability` → `offline` to detect device disconnection.

## Bootstrap script: `scripts/bootstrap-pi-zero-sensor`

A new bootstrap script for Pi Zero / IoT sensor nodes. Creates the `jellybot` operator user, installs packages, sets up Tailscale, I2C/SPI, and Python dependencies.

### What the script installs

```text
Essential:
  git, python3, python3-pip, python3-venv, python3-dev
  jq, yq, vim, tmux, curl, rsync, ca-certificates
  i2c-tools, python3-smbus, libgpiod3
  
Tailscale:
  tailscale (via official install script)
  
Skip (not needed on this host):
  docker-ce, docker-compose-plugin, borgbackup, node_exporter
```

### What the script configures

1. Creates or updates the chosen operator user (for example `jellyfish`)
2. Adds the operator user only to sensor/access groups: `i2c`, `spi`, `gpio`
3. Sets hostname to `jellyoffice`
4. Enables I2C and SPI via `raspi-config` nonint
5. Copies SSH authorized keys if provided later
6. Installs Tailscale and authenticates
7. Creates `/opt/jellyoffice` for the native Python service
8. Sets timezone to `Europe/London`
9. Sets locale to `en_GB.UTF-8`
10. Creates the Python venv at `/opt/jellyoffice/.venv`
11. Creates systemd unit for `enviro-publisher`
12. Enables and starts the publisher

### What the script does NOT do

- Does not install Docker
- Does not create `/opt/docker`
- Does not create `dockerops`
- Does not add the operator user to Docker-related groups
- Does not install Borg/Borgmatic
- Does not configure backups
- Does not auto-start Mosquitto (runs on jellyhome, not this device)

## Systemd service

```ini
[Unit]
Description=Jellyoffice Enviro MQTT publisher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=jellybot
Group=jellybot
WorkingDirectory=/opt/jellyoffice
ExecStart=/opt/jellyoffice/.venv/bin/python3 /opt/jellyoffice/enviro_publisher.py
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

## Inventory changes

### hosts.yml — add jellyoffice

(See host definition above)

### services.yml — add jellyoffice-env-sensor and mqtt-exporter

```yaml
jellyoffice-env-sensor:
  display_name: Jellyoffice Enviro
  icon: mdi-thermometer
  category: IoT
  mode: native-systemd
  hosts:
    - jellyoffice
  systemd_units:
    jellyoffice:
      - enviro-publisher.service
  urls:
    mqtt_topics: mqtt://jellyhome:1883/home/sensors/jellyoffice/#
  description: >
    Environmental sensor publisher (temperature, humidity, pressure,
    light, proximity, host health) on Pi Zero 2 W | Pimoroni Enviro |
    ships data via MQTT to Mosquitto on jellyhome | Home Assistant auto-discovery
  source:
    type: git
    local_path: /home/jellybot/home-network/scripts/jellyoffice
    remote: git@github.com:dotalbot/home-network.git
  backup: none
  status: planned

mqtt-exporter:
  display_name: MQTT Exporter
  icon: mdi-transit-connection-variant
  category: Monitoring
  mode: single-primary-home-network-compose
  hosts:
    - jellybase
  containers:
    jellybase:
      - mqtt-exporter
  urls:
    metrics: http://jellybase:9000/metrics
  description: >
    Prometheus MQTT-to-metrics bridge | subscribes to home/sensors/# on Mosquitto (jellyhome)
    and exposes metrics for Prometheus scraping on jellybase
  backup: none
  status: planned
```

### Mosquitto service — add jellyoffice as publisher

Update the existing mosquitto entry in services.yml to include:

```yaml
mqtt_publishers:
  - jellyoffice
```

Alternatively, this can be tracked via the mqtt topic structure rather than a formal list.

## Implementation phases

### Phase 0: OS flash and hardware prep (manual, on-device) ✅

**Status**: Complete and verified on jellyoffice.

**Objective**: Get Pi Zero 2 W booted with I2C/SPI working and Enviro detected.

**Tasks**:
1. Flash Raspberry Pi OS Lite 32-bit (Trixie armhf) to microSD
2. Enable SSH, configure WiFi (wpa_supplicant or NetworkManager)
3. Boot the Pi, SSH in as `pi`
4. Change default password: `passwd`
5. Set hostname: `sudo hostnamectl set-hostname jellyoffice`
6. Update OS: `sudo apt update && sudo apt full-upgrade -y`
7. Enable I2C and SPI: `sudo raspi-config` → Interface Options
8. Verify sensor board: `sudo i2cdetect -y 1` → verified `0x23` ADS1015 and `0x76` BME280
9. Install GPIO extender cable to mitigate BME280 heat offset (recommended)

**Acceptance**:
- Pi boots, connects to WiFi, SSH accessible
- `i2cdetect` shows Enviro sensors: `0x23` ADS1015 and `0x76` BME280
- Hostname is `jellyoffice`

### Phase 1: Bootstrap and Tailscale (scripted) ✅

**Status**: Complete and verified. Tailscale IP: `100.120.3.77`.

**Objective**: Run the bootstrap script to set up the operator user, packages, and network.

**Tasks**:
1. Create `scripts/bootstrap-pi-zero-sensor` based on existing `bootstrap-jellybot-operator`
2. Transfer script to jellyoffice via `scp` or `curl` from git
3. Run: `sudo ./scripts/bootstrap-pi-zero-sensor --user jellyfish`
4. Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`
5. Record the Tailscale IP in inventory/hosts.yml
6. Verify: `tailscale status`, SSH via Tailscale

**Acceptance**:
- Operator user exists and is in `i2c`, `spi`, and `gpio` groups
- `/opt/jellyoffice` exists and is owned by the operator user
- No Docker/Docker directories/groups are created on jellyoffice
- Tailscale connected and SSH works
- I2C and SPI kernel modules loaded

### Phase 2: Sensor publisher service ✅

**Status**: Complete and verified. `enviro-publisher.service` is active; MQTT retained values verified.

**Objective**: Deploy the Python sensor publisher that reads Enviro data and publishes to MQTT.

**Tasks**:
1. Create `services/jellyoffice/enviro_publisher.py`
2. Create `services/jellyoffice/requirements.txt`
3. Create `services/jellyoffice/config.example.json`; runtime secret config lives only at `/opt/jellyoffice/config.json`
4. Create `services/jellyoffice/enviro-publisher.service` (systemd unit)
5. Transfer to jellyoffice: `/opt/jellyoffice/`
6. Create venv: `python3 -m venv /opt/jellyoffice/.venv`
7. Install deps: `/opt/jellyoffice/.venv/bin/pip install -r requirements.txt`
8. Install and start systemd unit
9. Verify: `mosquitto_sub -h jellyhome -t 'home/sensors/jellyoffice/#' -v` shows data

**Acceptance**:
- `systemctl status enviro-publisher` shows active/running
- MQTT topics `home/sensors/jellyoffice/temperature`, etc. appear in Mosquitto on jellyhome
- Script reconnects automatically after MQTT broker disconnect (handled by systemd restart and MQTT client reconnect path)
- Script reconnects automatically after WiFi dropout (systemd restart/backoff; future hardening can add explicit loop reconnect)

### Phase 3: Home Assistant auto-discovery ✅

**Status**: MQTT discovery payloads are retained and verified. Home Assistant UI confirmation remains an operator check because HA access is not fully configured for Hermes yet.

**Objective**: Configure Home Assistant to auto-discover jellyoffice sensors from MQTT.

**Prerequisites**:
- Home Assistant running on jellyhome (user needs to confirm/set up)
- Mosquitto broker integration enabled in HA
- MQTT integration configured in HA (if not already)

**Tasks**:
1. Ensure Mosquitto broker is configured in Home Assistant (Settings → Devices & Services → MQTT)
2. Configure Home Assistant's MQTT integration with Mosquitto credentials that can read `homeassistant/#` and `home/sensors/#`
3. The `enviro_publisher.py` sends discovery payloads on startup to `homeassistant/sensor/jellyoffice/<sensor>/config`
4. Wait for HA to process discovery messages (typically <30 seconds)
5. Verify: HA → Settings → Devices & Services → MQTT → "Jellyoffice Enviro" device appears with sensor and health entities
6. Optionally: Add HA dashboard cards for the new sensors

**Acceptance**:
- HA shows "Jellyoffice Enviro" as a device with sensor and health entities
- Temperature, humidity, pressure readings display correctly
- Sensor values update every 60 seconds
- Sensors use MQTT availability topic `home/sensors/jellyoffice/status`; alerting/exporter timeout rules remain Phase 4 work

### Phase 4: Prometheus bridge (mqtt-exporter)

**Objective**: Bridge MQTT sensor data into Prometheus for long-term storage and alerting.

**Tasks**:
1. Add `mqtt-exporter` to `docker/hosts/jellybase.yaml`
2. Add `mqtt-exporter` to `inventory/services.yml`
3. Add Prometheus scrape config for `mqtt-exporter:9000`
4. Run `just sync-docker-config && just up mqtt-exporter` on jellybase
5. Verify: `curl http://jellybase:9000/metrics | grep jellyoffice`

**Acceptance**:
- `mqtt-exporter` container running on jellybase
- Prometheus scraping metrics from mqtt-exporter
- Grafana can query jellyoffice environmental metrics

### Phase 5: Homepage and Network Map integration

**Objective**: Make jellyoffice visible in the homelab dashboards.

**Tasks**:
1. Add jellyoffice to Homepage config (via `scripts/homepage-render`)
2. Add jellyoffice to Network Map topology as a sensor/IoT node
3. Update `inventory/hosts.yml` with final LAN and Tailscale IPs
4. Optionally: Add Grafana dashboard panel for environmental data

**Acceptance**:
- Homepage shows jellyoffice with Enviro sensor link
- Network Map shows jellyoffice as a sensor node
- All documentation updated

## Temperature compensation

### The problem

The BME280 temperature sensor on the Enviro board sits directly above the Raspberry Pi CPU. The Pi Zero 2 W generates noticeable heat, causing temperature readings 3-7°C too high. This also affects relative humidity and pressure (which are temperature-dependent).

### Mitigations (in order of effectiveness)

1. **GPIO extender cable** (recommended): A 40-pin ribbon cable moves the Enviro board away from the Pi, dramatically reducing heat transfer. ~£5-6 from Pimoroni.
2. **Software temperature offset**: Apply a configurable offset to BME280 readings. The publisher defaults to `-3°C` but this can be tuned per installation. Document that this is approximate.
3. **CPU temperature subtraction**: Read Pi CPU temperature and estimate a correction. Simplest formula: `real_temp ≈ BME280_temp - k * (CPU_temp - ambient)`. This requires calibration and is fragile.

## Temperature compensation (continued)

- The publisher will implement a configurable offset (default -3°C) and document the GPIO extender cable as the recommended hardware fix.

## Rollback

- Stop the publisher: `sudo systemctl stop enviro-publisher`
- Remove from HA: Delete the device from HA MQTT integration
- Remove mqtt-exporter: `docker stop mqtt-exporter && docker rm mqtt-exporter`
- Remove from Prometheus scrape config
- Reset the Pi: Re-flash the microSD card and re-run bootstrap

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| BME280 temperature offset from Pi heat | High | Medium | Software offset default -3°C; recommend GPIO extender cable |
| WiFi disconnection | Medium | Medium | Systemd restarts on failure; MQTT last-will marks device offline |
| 32-bit OS compatibility issues | Low | Medium | Pimoroni library supports armhf; test on actual hardware first |
| 512MB RAM pressure under load | Low | High | No Docker, no monitoring stack; total estimated usage ~45-50MB |
| Mosquitto auth not configured | Expected | Low | LAN-only access; consider adding auth if Mosquitto is exposed beyond LAN |

## Open questions (resolved)

1. ~~Sensor board?~~ → Pimoroni Enviro (PIM486, £30) — NOT Enviro+; BME280 + LTR-559 + ADS1015 + MEMS mic only
2. ~~32-bit vs 64-bit?~~ → 32-bit (armhf) as specified by user
3. ~~Hostname?~~ → `jellyoffice`
4. ~~MQTT→Prometheus bridge?~~ → Use existing `mqtt-exporter` (kpetremann/mqtt-exporter) on jellybase
5. ~~Home Assistant integration?~~ → Auto-discovery via MQTT config payloads
6. ~~Node monitoring?~~ → Health metrics via MQTT (not node_exporter); bridged to Prometheus via mqtt-exporter
7. ~~I2C confirmed?~~ → Yes: 0x23 (ADS1015) and 0x76 (BME280) detected on bus 1

## Host-local filesystem policy

`jellyoffice` intentionally does not use the `/opt/docker` runtime layout. Its host-local state is:

```text
/opt/jellyoffice/
├── .venv/
├── enviro_publisher.py
├── config.json
└── logs only via journald/systemd
```

This keeps the Pi Zero clearly separate from Docker hosts (`jellyhome`, `jellybase`, `jellyberry`) and avoids accidentally treating it as a container runtime target.

## Files to create or modify

| File | Action | Description |
|------|--------|-------------|
| `scripts/bootstrap-pi-zero-sensor` | CREATE | Bootstrap script for Pi Zero sensor nodes |
| `scripts/jellyoffice/enviro_publisher.py` | CREATE | Python sensor → MQTT publisher with HA auto-discovery |
| `scripts/jellyoffice/requirements.txt` | CREATE | Python dependencies |
| `scripts/jellyoffice/config.json` | CREATE | MQTT broker, topic prefix, interval, temperature offset |
| `scripts/jellyoffice/enviro-publisher.service` | CREATE | Systemd unit for the publisher |
| `inventory/hosts.yml` | MODIFY | Add jellyoffice host entry |
| `inventory/services.yml` | MODIFY | Add jellyoffice-env-sensor and mqtt-exporter entries |
| `docker/hosts/jellybase.yaml` | MODIFY | Add mqtt-exporter container |
| `docs/operations/jellyoffice-ops.md` | CREATE | Operational runbook for jellyoffice |
| `docs/roadmap/product-roadmap.md` | MODIFY | Add V4.6 or update V4 for jellyoffice monitoring |