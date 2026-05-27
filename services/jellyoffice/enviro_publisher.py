#!/usr/bin/env python3
"""Jellyoffice Enviro MQTT publisher.

Native systemd Python service for Raspberry Pi Zero 2 W + Pimoroni Enviro.
No Docker, no node_exporter. Publishes environmental readings and lightweight host
health to MQTT plus Home Assistant MQTT discovery.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import paho.mqtt.client as mqtt

CONFIG_PATH = Path(os.environ.get("JELLYOFFICE_CONFIG", "/opt/jellyoffice/config.json"))
STOP = False


def _stop(signum, frame):  # noqa: ANN001
    global STOP
    STOP = True


signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)


def load_config() -> dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def read_cpu_temp_c() -> float | None:
    try:
        raw = Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()
        return round(int(raw) / 1000.0, 2)
    except Exception:
        return None


def read_disk_used_percent(path: str = "/") -> float | None:
    try:
        st = os.statvfs(path)
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        used = total - free
        return round((used / total) * 100.0, 2) if total else None
    except Exception:
        return None


def read_mem_available_percent() -> float | None:
    try:
        vals: dict[str, int] = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, val = line.split(":", 1)
            vals[key] = int(val.strip().split()[0])
        total = vals.get("MemTotal")
        avail = vals.get("MemAvailable")
        return round((avail / total) * 100.0, 2) if total and avail is not None else None
    except Exception:
        return None


def read_wifi_rssi_dbm() -> int | None:
    try:
        out = subprocess.check_output(["iw", "dev"], text=True, timeout=2)
        iface = None
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("Interface "):
                iface = line.split()[1]
                break
        if not iface:
            return None
        link = subprocess.check_output(["iw", "dev", iface, "link"], text=True, timeout=2)
        for line in link.splitlines():
            if "signal:" in line:
                return int(float(line.split("signal:", 1)[1].strip().split()[0]))
    except Exception:
        return None
    return None


@dataclass
class SensorDef:
    key: str
    name: str
    unit: str | None
    device_class: str | None
    state_class: str | None
    value_fn: Callable[[], Any]


def build_sensors(config: dict[str, Any]) -> list[SensorDef]:
    sensors: list[SensorDef] = []
    temp_offset = float(config.get("temperature_offset_c", 0.0))

    try:
        from bme280 import BME280

        bme = BME280()
        sensors.extend(
            [
                SensorDef("temperature", "Temperature", "°C", "temperature", "measurement", lambda: round(bme.get_temperature() + temp_offset, 2)),
                SensorDef("humidity", "Humidity", "%", "humidity", "measurement", lambda: round(bme.get_humidity(), 2)),
                SensorDef("pressure", "Pressure", "hPa", "pressure", "measurement", lambda: round(bme.get_pressure(), 2)),
            ]
        )
    except Exception as exc:
        print(f"BME280 unavailable: {exc}", flush=True)

    try:
        from ltr559 import LTR559

        ltr = LTR559()
        sensors.extend(
            [
                SensorDef("lux", "Light", "lx", "illuminance", "measurement", lambda: round(ltr.get_lux(), 2)),
                SensorDef("proximity", "Proximity", None, None, "measurement", lambda: int(ltr.get_proximity())),
            ]
        )
    except Exception as exc:
        print(f"LTR559 unavailable: {exc}", flush=True)

    # ADS1015 is detected at 0x23, but live channel reads currently return I/O errors
    # on jellyoffice. Keep noise out of discovery until a working channel/read path is verified.

    sensors.extend(
        [
            SensorDef("cpu_temperature", "CPU Temperature", "°C", "temperature", "measurement", read_cpu_temp_c),
            SensorDef("disk_used", "Disk Used", "%", None, "measurement", read_disk_used_percent),
            SensorDef("memory_available", "Memory Available", "%", None, "measurement", read_mem_available_percent),
            SensorDef("wifi_rssi", "WiFi RSSI", "dBm", "signal_strength", "measurement", read_wifi_rssi_dbm),
            SensorDef("uptime", "Uptime", "s", "duration", "total_increasing", lambda: int(float(Path("/proc/uptime").read_text().split()[0]))),
        ]
    )
    return sensors


def publish_discovery(client: mqtt.Client, config: dict[str, Any], sensors: list[SensorDef]) -> None:
    prefix = config.get("discovery_prefix", "homeassistant")
    topic_prefix = config["topic_prefix"].rstrip("/")
    device = config["device"]
    device_block = {
        "identifiers": [device["identifier"]],
        "name": device["name"],
        "manufacturer": device.get("manufacturer", "Pimoroni"),
        "model": device.get("model", "Enviro"),
        "configuration_url": f"ssh://{device.get('host', 'jellyoffice')}",
    }
    for sensor in sensors:
        payload: dict[str, Any] = {
            "name": sensor.name,
            "unique_id": f"{device['identifier']}_{sensor.key}",
            "state_topic": f"{topic_prefix}/{sensor.key}",
            "availability_topic": f"{topic_prefix}/status",
            "payload_available": "online",
            "payload_not_available": "offline",
            "device": device_block,
        }
        if sensor.unit:
            payload["unit_of_measurement"] = sensor.unit
        if sensor.device_class:
            payload["device_class"] = sensor.device_class
        if sensor.state_class:
            payload["state_class"] = sensor.state_class
        client.publish(f"{prefix}/sensor/jellyoffice/{sensor.key}/config", json.dumps(payload), qos=1, retain=True)


def connect_client(config: dict[str, Any]) -> mqtt.Client:
    mcfg = config["mqtt"]
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=mcfg.get("client_id", "jellyoffice-enviro"))
    client.username_pw_set(mcfg["username"], mcfg["password"])
    client.will_set(config["topic_prefix"].rstrip("/") + "/status", "offline", qos=1, retain=True)
    client.connect(mcfg["host"], int(mcfg.get("port", 1883)), keepalive=60)
    return client


def main() -> int:
    config = load_config()
    sensors = build_sensors(config)
    if not sensors:
        raise RuntimeError("No sensors available")
    interval = int(config.get("interval_seconds", 60))
    topic_prefix = config["topic_prefix"].rstrip("/")

    client = connect_client(config)
    client.loop_start()
    publish_discovery(client, config, sensors)
    client.publish(f"{topic_prefix}/status", "online", qos=1, retain=True)
    print(f"Publishing {len(sensors)} sensor/health values every {interval}s to {topic_prefix}", flush=True)

    try:
        while not STOP:
            readings: dict[str, Any] = {}
            for sensor in sensors:
                try:
                    value = sensor.value_fn()
                    if value is None:
                        continue
                    readings[sensor.key] = value
                    client.publish(f"{topic_prefix}/{sensor.key}", str(value), qos=0, retain=True)
                except Exception as exc:
                    print(f"read failed {sensor.key}: {exc}", flush=True)
            client.publish(f"{topic_prefix}/json", json.dumps(readings, sort_keys=True), qos=0, retain=True)
            client.publish(f"{topic_prefix}/last_seen", str(int(time.time())), qos=0, retain=True)
            for _ in range(interval):
                if STOP:
                    break
                time.sleep(1)
    except Exception:
        traceback.print_exc()
        return 1
    finally:
        client.publish(f"{topic_prefix}/status", "offline", qos=1, retain=True)
        client.loop_stop()
        client.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
