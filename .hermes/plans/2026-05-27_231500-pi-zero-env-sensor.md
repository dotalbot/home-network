# Plan: Bootstrap Raspberry Pi Zero 2 W as Environmental Sensor (jellyprobe)

Created: 2026-05-27  
Status: Draft  
Related: inventory/hosts.yml, docs/step-9-considerations.md, docs/operations/docker-host-bootstrap.md

## Goal

Bootstrap a brand-new Raspberry Pi Zero 2 W as a lightweight environmental sensor node that ships data via MQTT to the existing Mosquitto broker on jellyhome. This is a 32-bit ARMv7 (armhf) device with limited RAM/CPU, so every service choice must be deliberate and minimal.

## Context and constraints

### Hardware: Raspberry Pi Zero 2 W
- **CPU**: BCM2710A1, 4-core Cortex-A53 @ 1GHz — but **32-bit OS** means armhf userland
- **RAM**: 512MB — very tight; no Docker, no heavy services
- **Storage**: MicroSD (likely 8–32GB)
- **Network**: WiFi only (no Ethernet)
- **Sensor board**: Environmental sensor hat (specific model TBD) — presumably I2C/SPI sensors (BME280/BME680/SHT40 etc.)

### Key constraint: 32-bit OS
- Docker official images increasingly drop armhf support
- Many monitoring stacks (node_exporter, Alloy) have armhf builds but they consume RAM/CPU that this device cannot spare
- Pi Zero 2 W is arm64-capable hardware; a **64-bit Raspberry Pi OS Lite** would unlock arm64 Docker images and get better software support — **strongly recommend 64-bit OS if sensor board drivers support it**

### Role decision: NOT a Docker host
- 512MB RAM rules out Docker entirely
- This is a **sensor/IoT relay node**, not a docker-host
- Services run natively via systemd or as lightweight Python scripts
- No Borg backup — sensor data goes to MQTT; config lives in the home-network repo
- No node_exporter port 9100 — too heavy; use MQTT + Prometheus pushgateway or textfile collector on a scraper host instead

## Proposed approach

### Hostname: `jellyprobe`
- Follows the `jelly-` naming convention
- Describes an IoT probe/sensor role

### Operating system: Raspberry Pi OS Lite 64-bit (recommended) or 32-bit (fallback)
- 64-bit gives arm64 Docker compatibility IF we later want tiny containers
- The user stated "32-bit OS" — if the sensor board vendor only supports 32-bit, we go armhf
- **Decision needed**: Can the sensor board run on 64-bit Pi OS? If yes, use 64-bit.

### Architecture: Thin MQTT publisher, no on-device monitoring stack

```
jellyprobe (Pi Zero 2 W)
  ├── systemd: mqtt-env-publisher.service (Python, reads sensor board, publishes to MQTT)
  ├── systemd: tailscaled (Tailscale for remote access)
  ├── systemd: node_exporter --light (minimal textfile-only mode, or skip entirely)
  └── NO Docker, NO Borg, NO Alloy

Data flow:
  Sensor board → Python script → MQTT (jellyhome:1883) → Home Assistant / Grafana
                                        ↓
                            Prometheus scrapes MQTT bridge or pushgateway
```

### Why NOT Docker on this device
- 512MB RAM — Docker daemon alone uses ~50-100MB
- Container runtime overhead + layered filesystem = wasted resources
- The sensor publisher is a single Python script — systemd is simpler and uses less RAM
- If we later need a tiny container, 64-bit OS makes this possible

### Why NOT Borg backup
- Sensor data is ephemeral and shipped to MQTT immediately
- Config (Python script, systemd units) lives in the home-network repo
- OS can be re-flashed from the bootstrap script
- Not worth the RAM/disk/CPU overhead of Borgmatic

### Why lightweight monitoring (or skip node_exporter)
- Full node_exporter with default collectors uses ~10-15MB RAM on a Pi
- 512MB device: every MB matters for sensor stability
- Options:
  1. **node_exporter with `--collector.textfile.directory` only** (skip most collectors ~5MB)
  2. **Push metrics via MQTT** (zero local monitoring — push from Python script)
  3. **Prometheus pushgateway on jellybase** (device pushes uptime/sensor stats periodically)
- **Recommendation**: Option 2 or 3 — the Python sensor script publishes health metrics alongside environmental data to MQTT. Home Assistant or a custom Prometheus MQTT exporter on jellyhome/jellybase converts to Prometheus metrics.

## Step-by-step plan

### Phase 0: OS and hardware prep (manual, on-device)

1. Flash Raspberry Pi OS Lite (64-bit preferred, 32-bit if required) to microSD
2. Enable SSH, configure WiFi (wpa_supplicant or NetworkManager)
3. Boot the Pi, SSH in as `pi` / default password
4. Change default password: `passwd`
5. Set hostname: `sudo hostnamectl set-hostname jellyprobe`
6. Update OS: `sudo apt update && sudo apt full-upgrade -y`
7. Enable I2C/SPI: `sudo raspi-config` → Interface Options → I2C → Enable, SPI → Enable
8. Verify sensor board is detected: `sudo i2cdetect -y 1` (or `0` depending on Pi revision)

### Phase 1: Bootstrap the host (scripted)

Create `scripts/bootstrap-pi-zero-sensor` which does:

1. Create `jellybot` operator user with dockerops group (consistent with other hosts)
2. Set up SSH authorized_keys for inter-host deployment access
3. Install essential packages:
   - `git`, `python3`, `python3-pip`, `python3-venv`
   - `jq`, `yq`, `vim`, `tmux`, `curl`, `rsync`
   - `i2c-tools`, `python3-smbus` (for I2C sensor access)
   - Skip: `docker-ce`, `docker-compose-plugin`, `borgbackup`
4. Create /opt/docker structure (for future consistency, even without Docker)
5. Set timezone: `Europe/London`
6. Configure locale: `en_GB.UTF-8`
7. Set up Tailscale (see Phase 2)

### Phase 2: Tailscale

1. Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`
2. Authenticate: `sudo tailscale up`
3. Record the Tailscale IP in inventory/hosts.yml
4. Enable Tailscale SSH for remote management: `sudo tailscale up --ssh`
5. Verify: `tailscale status`, `tailscale ip`

### Phase 3: MQTT environmental sensor publisher

1. Create Python project at `/opt/jellyprobe/env-sensor/`
2. Create a venv: `python3 -m venv /opt/jellyprobe/env-sensor/.venv`
3. Install sensor libraries (depending on board):
   - `paho-mqtt` (MQTT client)
   - Sensor board library (e.g., `bme280`, `sht30`, `bme680` — TBD based on actual board)
4. Write `env_sensor_publisher.py`:
   - Reads sensor data on a configurable interval (default 60s)
   - Publishes to MQTT topics:
     - `home/sensors/jellyprobe/temperature`
     - `home/sensors/jellyprobe/humidity`
     - `home/sensors/jellyprobe/pressure`
     - `home/sensors/jellyprobe/air_quality` (if available)
     - `home/sensors/jellyprobe/health` (uptime, CPU temp, disk usage)
   - Retains last message for Home Assistant discovery
   - Reconnects automatically on MQTT broker disconnect
5. Create systemd unit `mqtt-env-publisher.service`
6. Enable and start: `sudo systemctl enable --now mqtt-env-publisher`

### Phase 4: Home inventory registration

1. Add `jellyprobe` to `inventory/hosts.yml`:
   ```yaml
   jellyprobe:
     description: Raspberry Pi Zero 2 W environmental sensor node
     lan_ip: TBD (after WiFi/DHCP assignment)
     roles:
       - pi
       - iot-sensor
       - mqtt-publisher
       - tailscale-node
     monitoring:
       node_exporter:
         enabled: false  # Too resource-intensive; health via MQTT
         note: Health metrics published via MQTT, not Prometheus scrape
     notes:
       - 512MB RAM, no Docker; runs sensor Python script natively via systemd
       - No Borg backup; sensor data ships to MQTT, config in home-network repo
       - 32-bit Pi OS if sensor board requires it; 64-bit otherwise
   ```

2. Add `jellyprobe` to `inventory/services.yml` under the existing `mosquitto` service:
   ```yaml
   # Add to mosquitto service:
   mqtt_publishers:
     - jellyprobe
   ```

3. Create a new service entry:
   ```yaml
   jellyprobe-env-sensor:
     display_name: Jellyprobe Environmental Sensor
     icon: mdi-thermometer
     category: IoT
     mode: native-systemd
     hosts:
       - jellyprobe
     systemd_units:
       jellyprobe:
         - mqtt-env-publisher.service
     urls:
       mqtt_topics: mqtt://jellyhome:1883/home/sensors/jellyprobe/#
     description: Environmental sensor publisher (temperature, humidity, pressure) on Pi Zero 2 W | ships data via MQTT to Mosquitto on jellyhome
     source:
       type: git
       local_path: /home/jellybot/home-network/scripts/jellyprobe
       remote: git@github.com:dotalbot/home-network.git
     backup: none
     status: planned
   ```

### Phase 5: Home Assistant / Grafana integration

1. Home Assistant (on jellyhome) auto-discovery or manual MQTT sensor config for jellyprobe topics
2. Grafana dashboard panel for environmental data (add to existing host dashboard or create a new IoT dashboard)
3. Optional: PrometheusMQTT exporter on jellyhome/jellybase to bridge MQTT → Prometheus metrics

### Phase 6: Monitoring approach (NOT node_exporter)

For a 512MB Pi Zero, skip traditional monitoring. Instead:

1. The Python sensor script publishes a health message every cycle:
   ```json
   {
     "uptime_seconds": 86400,
     "cpu_temp_c": 42.1,
     "disk_used_percent": 35,
     "mem_available_mb": 180,
     "sensor_board_connected": true
   }
   ```
   To topic: `home/sensors/jellyprobe/health`

2. A lightweight MQTT-to-Prometheus bridge on jellyhome or jellybase converts these to Prometheus metrics
3. Alert rules: device offline >10min (MQTT last-seen), sensor reading stale >5min

### Phase 7: Homepage and Network Map integration

1. Add jellyprobe to Homepage config (via `scripts/homepage-render`) as an IoT/Sensor item
2. Add jellyprobe to Network Map topology as a sensor node with MQTT health status
3. Update Network Map inventory data (`inventory/hosts.yml` or `data/` JSON)

## Files likely to change

| File | Change |
|------|--------|
| `scripts/bootstrap-pi-zero-sensor` | **NEW** — bootstrap script for Pi Zero sensor nodes |
| `scripts/jellyprobe/env_sensor_publisher.py` | **NEW** — Python sensor → MQTT publisher |
| `scripts/jellyprobe/requirements.txt` | **NEW** — Python dependencies |
| `scripts/jellyprobe/mqtt-env-publisher.service` | **NEW** — systemd unit file |
| `inventory/hosts.yml` | **MODIFY** — add `jellyprobe` entry |
| `inventory/services.yml` | **MODIFY** — add jellyprobe service, update mosquitto publishers |
| `docs/operations/jellyprobe-ops.md` | **NEW** — operational runbook |
| `docs/step-9-considerations.md` | **MODIFY** — add Pi Zero/IoT sensor considerations |

## Validation and testing

1. **Bootstrap**: Script runs idempotently on fresh Pi Zero 2 W
2. **Sensor board**: `i2cdetect` shows the sensor at expected address
3. **MQTT publish**: `mosquitto_sub -h jellyhome -t 'home/sensors/jellyprobe/#' -v` shows live data
4. **Tailscale**: `tailscale status` shows connected, `tailscale ssh` works from admin host
5. **Systemd**: `systemctl status mqtt-env-publisher` shows active/running
6. **Home Assistant**: Sensor entities appear with live data
7. **Reboot resilience**: Service starts after reboot, data resumes

## Risks, tradeoffs, and open questions

### Risks
| Risk | Mitigation |
|------|------------|
| 32-bit OS limits software availability | Use 64-bit Pi OS Lite if sensor board supports it |
| 512MB RAM is very tight | No Docker, no node_exporter, minimal Python venv |
| WiFi-only networking is less reliable | Tailscale + systemd watchdog for MQTT reconnection |
| Sensor board driver compatibility | Verify I2C detection before writing publisher; board may need specific kernel modules |
| No local backup | Config is in git; sensor data is ephemeral via MQTT |

### Tradeoffs
- **No Docker**: Simpler, less RAM, but services are harder to isolate and update
- **No Borg**: Sensor data lives in MQTT; config in git. Recovery is re-flash + bootstrap + pull
- **No node_exporter**: Health metrics via MQTT, not Prometheus scrape. Needs MQTT→Prometheus bridge
- **No Alloy/Dozzle**: No log shipping from this device. Journald log can be checked via Tailscale SSH

### Open questions
1. **What sensor board?** (BME280? BME680? SHT40? Custom hat?) — affects Python library choice
2. **32-bit vs 64-bit OS?** — strongly recommend 64-bit if sensor board kernel modules support it
3. **What metrics matter?** — temperature, humidity, pressure, air quality? All of the above?
4. **MQTT→Prometheus bridge**: Use an existing project (e.g., `mqtt2prom`, `mqtt-exporter`) or build a simple one?
5. **Home Assistant integration**: Auto-discovery or manual sensor configuration?
6. **Hostname confirmation**: Is `jellyprobe` acceptable, or does the user prefer something else?
7. **WiFi reliability**: Is a USB Ethernet adapter available for more stable networking, or WiFi only?

## Dependency on other work

- **MQTT Mosquitto** on jellyhome — already running and configured
- **Home Assistant** on jellyhome — for sensor dashboard/display
- **Prometheus on jellybase** — for long-term metric storage (needs MQTT→Prometheus bridge)
- **Network Map dashboard** — will show jellyprobe as a sensor node once added to inventory

## Execution priority

1. Phase 0: OS flash and sensor board verification (manual, on-device)
2. Phase 1: Bootstrap script (create and test)
3. Phase 2: Tailscale (as part of bootstrap or immediately after)
4. Phase 3: MQTT publisher (core value — environmental data flowing)
5. Phase 4: Inventory registration (git commit)
6. Phase 5: HA/Grafana integration (once data flows)
7. Phase 6: Monitoring bridge (once MQTT data confirmed)
8. Phase 7: Homepage / Network Map (cosmetic, last)