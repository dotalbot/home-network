# 008 Energy telemetry and VictoriaMetrics

## Goal

Create a long-term smart-home telemetry pipeline for Meross plugs, the Sonoff Wi-Fi plug, future Zigbee2MQTT sensors/plugs, and later CSV imports.

Target architecture:

```text
Meross / Sonoff / Zigbee2MQTT devices
  -> Home Assistant device model and Energy Dashboard
  -> Home Assistant Prometheus exporter
  -> Prometheus scrape / alerting
  -> VictoriaMetrics remote_write long-term store
  -> Grafana dashboards

CSV historical data
  -> transform with source-managed metadata labels
  -> VictoriaMetrics import API
  -> Grafana long-range analysis
```

## Current discovery

Live Home Assistant inventory on jellybase found:

- Meross LAN integration is present.
- Sonoff LAN integration is present.
- Home Assistant Prometheus integration was not enabled at discovery time.
- Home Assistant recorder database contains long-term-capable statistics metadata for the key plug sensors.

Observed plug/device entities:

### Meross Main_power (`mss310 2.0.0`)

- `switch.main_power_outlet`
- `sensor.main_power_power` — W, `device_class=power`, `state_class=measurement`
- `sensor.main_power_energy` — Wh, `device_class=energy`, `state_class=total_increasing`
- `sensor.main_power_current` — A
- `sensor.main_power_voltage` — V
- `sensor.main_power_signal_strength` — %

### Meross Power strip (`mss420f 3.0.0`)

- `switch.power_strip_outlet`
- `switch.power_strip_outlet_1`
- `switch.power_strip_outlet_2`
- `switch.power_strip_outlet_3`
- `switch.power_strip_outlet_4`
- `sensor.power_strip_signal_strength` — %

No per-outlet power/energy sensors were observed for this strip yet.

### Sonoff Kettle_Co (`S60TPG`)

- `switch.kettle_co_sonoff_1002700ec0_1`
- `sensor.kettle_co_sonoff_1002700ec0_power` — W, `device_class=power`, `state_class=measurement`
- `sensor.kettle_co_sonoff_1002700ec0_current` — A
- `sensor.kettle_co_sonoff_1002700ec0_voltage` — V
- `sensor.kettle_co_sonoff_1002700ec0_energy_day` — kWh, `device_class=energy`, `state_class=total_increasing`
- `sensor.kettle_co_sonoff_1002700ec0_energy_month` — kWh, `device_class=energy`, `state_class=total_increasing`

The Sonoff day/month counters reset by design; prefer a cumulative total entity if one appears later, or create a normalized Home Assistant/template counter if needed.

## Source-managed metadata

Device-to-room/appliance mapping lives in:

- `inventory/energy-devices.yml`

This file deliberately separates physical meaning from Home Assistant entity naming. It is the source of truth for:

- room grouping
- key appliance grouping
- CSV import labels
- future recording rules/dashboard generation

Initial unknowns:

- `main_power` room/load needs confirmation.
- `power_strip` room and outlet-to-appliance mapping need confirmation.
- `kettle_co` is initially assigned to `kitchen`.

## VictoriaMetrics rollout

Single-node VictoriaMetrics is the long-term metrics store.

Runtime shape:

- Container: `victoriametrics`
- Port: `8428`, published on jellybase LAN IP `192.168.1.2` only
- Data: `/opt/docker/appdata/victoriametrics/data`
- Retention: `5y`
- Grafana datasource UID: `victoriametrics`
- Prometheus remote_write URL: `http://victoriametrics:8428/api/v1/write`

Prometheus remains the operational scraper and short-term alerting layer. VictoriaMetrics is the multi-year store and CSV backfill target.

## Home Assistant Prometheus exporter

Safe target configuration:

```yaml
prometheus:
  filter:
    include_entities:
      - sensor.main_power_power
      - sensor.main_power_energy
      - sensor.main_power_current
      - sensor.main_power_voltage
      - sensor.main_power_signal_strength
      - switch.main_power_outlet
      - sensor.power_strip_signal_strength
      - switch.power_strip_outlet
      - switch.power_strip_outlet_1
      - switch.power_strip_outlet_2
      - switch.power_strip_outlet_3
      - switch.power_strip_outlet_4
      - sensor.kettle_co_sonoff_1002700ec0_power
      - sensor.kettle_co_sonoff_1002700ec0_current
      - sensor.kettle_co_sonoff_1002700ec0_voltage
      - sensor.kettle_co_sonoff_1002700ec0_energy_day
      - sensor.kettle_co_sonoff_1002700ec0_energy_month
      - switch.kettle_co_sonoff_1002700ec0_1
```

Do not set `requires_auth: false` unless the operator explicitly accepts unauthenticated LAN metrics exposure. Preferred path: keep authentication enabled and provide Prometheus a Home Assistant long-lived access token via a host-local secret.

## Prometheus HA scrape target

After a Home Assistant long-lived token is installed on jellybase, add this scrape job:

```yaml
  - job_name: homeassistant
    metrics_path: /api/prometheus
    scrape_interval: 30s
    authorization:
      type: Bearer
      credentials_file: /run/secrets/homeassistant_prometheus_token
    static_configs:
      - targets:
          - 192.168.1.2:8123
        labels:
          monitored_host: jellybase
          service: homeassistant
```

Prometheus Compose must mount the same secret file read-only before this job is enabled.

## Zigbee2MQTT impact

When the Sonoff Zigbee coordinator/Pi is added:

- Use Zigbee2MQTT with Home Assistant MQTT discovery enabled.
- Use a dedicated MQTT user and ACL for `zigbee2mqtt/#` and Home Assistant discovery topics.
- Publish `last_seen` in Zigbee2MQTT for health dashboards.
- Use Home Assistant metrics for user-facing sensors/energy where possible.
- Add a direct Zigbee2MQTT/MQTT metrics bridge later for link quality, coordinator health, and fields that Home Assistant does not expose cleanly.

## CSV import plan

CSV historical data should be imported into VictoriaMetrics, not Home Assistant, unless the goal is specifically to repair Home Assistant Energy Dashboard history.

Import process:

1. Review CSV schema and timestamp timezone.
2. Map each column to canonical metric names and `inventory/energy-devices.yml` labels.
3. Transform to VictoriaMetrics CSV import format or Prometheus exposition samples.
4. Import into VictoriaMetrics test metric names first.
5. Validate in Grafana.
6. Re-import with final metric names if needed.

Recommended labels:

- `room`
- `appliance`
- `device`
- `source`
- `site=home-network`
- `import_batch` only for temporary validation, not permanent dashboards

Avoid high-cardinality labels such as raw timestamps, message IDs, or arbitrary JSON attributes.

## Acceptance criteria

- [x] Current Meross and Sonoff entities inventoried without exposing secrets.
- [x] Source-managed energy metadata file created.
- [x] VictoriaMetrics service source-managed.
- [x] Prometheus remote_write source-managed.
- [x] Grafana VictoriaMetrics datasource source-managed.
- [x] VictoriaMetrics deployed and health-checked live.
- [x] Prometheus remote_write verified by querying recent `up` samples from VictoriaMetrics.
- [x] Home Assistant Prometheus exporter enabled with filtered entities.
- [x] Home Assistant `/api/prometheus` reachable with authentication (`401 Unauthorized` without token).
- [x] Prometheus Home Assistant scrape target enabled after token secret is installed.
- [x] Grafana energy dashboard v1 created after Home Assistant metrics are flowing.
- [ ] Room/appliance assignments confirmed for `main_power` and `power_strip`.

## Rollback

VictoriaMetrics rollout rollback:

1. Remove or comment `remote_write` in Prometheus config.
2. Recreate/reload Prometheus.
3. Stop VictoriaMetrics: `docker compose ... stop victoriametrics`.
4. Preserve `/opt/docker/appdata/victoriametrics/data` unless the operator explicitly requests deletion.

Home Assistant exporter rollback:

1. Remove the `prometheus:` block from `/opt/docker/appdata/homeassistant/config/configuration.yaml`.
2. Run Home Assistant config check.
3. Recreate/restart Home Assistant.

Do not delete Home Assistant recorder data as part of this rollout.
