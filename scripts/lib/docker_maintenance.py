#!/usr/bin/env python3
"""Read-only Docker host maintenance collector helpers."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore[assignment]

VALID_MODES = {"report_only", "manual_approval", "automatic"}
BYTES_UNITS = {
    "b": 1,
    "kb": 1000,
    "kib": 1024,
    "mb": 1000**2,
    "mib": 1024**2,
    "gb": 1000**3,
    "gib": 1024**3,
    "tb": 1000**4,
    "tib": 1024**4,
}


def prometheus_label_value(value: str) -> str:
    """Escape a Prometheus text exposition label value."""
    return value.replace("\\", r"\\").replace("\n", r"\n").replace('"', r'\"')


DEFAULT_POLICY: dict[str, Any] = {
    "enabled": False,
    "mode": "report_only",
    "windows": {"preferred": "03:30-05:30", "timezone": "Europe/London"},
    "disk_cleanup": {
        "mode": "report_only",
        "root_free_warning_pct": 15,
        "root_free_critical_pct": 8,
        "allow_build_cache_prune": True,
        "allow_dangling_image_prune": True,
        "allow_unused_image_prune": False,
        "allow_stopped_container_prune": True,
        "allow_volume_prune": False,
        "automatic_max_reclaim_gb": 10,
    },
    "image_updates": {
        "mode": "report_only",
        "allow_pull": False,
        "allow_recreate": False,
        "excluded_services": [],
    },
    "code_updates": {"mode": "report_only", "allow_git_pull": False, "allow_rebuild": False},
    "notes": [],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for key, value in base.items():
        if isinstance(value, dict):
            merged[key] = deep_merge(value, {})
        elif isinstance(value, list):
            merged[key] = list(value)
        else:
            merged[key] = value
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def validate_mode(value: str, field: str) -> None:
    if value not in VALID_MODES:
        raise ValueError(f"{field} must be one of {sorted(VALID_MODES)}; got {value!r}")


def validate_policy(policy: dict[str, Any], host: str) -> None:
    validate_mode(str(policy.get("mode", "report_only")), f"hosts.{host}.maintenance.mode")
    for section in ("disk_cleanup", "image_updates", "code_updates"):
        cfg = policy.get(section) or {}
        if not isinstance(cfg, dict):
            raise ValueError(f"hosts.{host}.maintenance.{section} must be a mapping")
        validate_mode(str(cfg.get("mode", policy["mode"])), f"hosts.{host}.maintenance.{section}.mode")
    disk = policy.get("disk_cleanup") or {}
    warning = float(disk.get("root_free_warning_pct", 15))
    critical = float(disk.get("root_free_critical_pct", 8))
    if not (0 < critical <= warning < 100):
        raise ValueError(f"hosts.{host}.maintenance.disk_cleanup thresholds must satisfy 0 < critical <= warning < 100")
    if bool(disk.get("allow_volume_prune")) and str(disk.get("mode")) == "automatic":
        raise ValueError(f"hosts.{host}: automatic volume prune is intentionally refused")


def load_hosts_inventory(path: Path) -> dict[str, Any]:
    if yaml is None:  # pragma: no cover
        raise RuntimeError("python3-yaml is required")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    hosts = data.get("hosts") or {}
    if not isinstance(hosts, dict):
        raise ValueError("inventory/hosts.yml must contain a hosts mapping")
    return data


def maintenance_policy(inventory: dict[str, Any], host: str) -> dict[str, Any]:
    hosts = inventory.get("hosts") or {}
    if host not in hosts:
        raise ValueError(f"host {host!r} not found in inventory")
    raw = (hosts[host] or {}).get("maintenance") or {}
    if not isinstance(raw, dict):
        raise ValueError(f"hosts.{host}.maintenance must be a mapping")
    policy = deep_merge(DEFAULT_POLICY, raw)
    for section in ("disk_cleanup", "image_updates", "code_updates"):
        policy[section]["mode"] = policy[section].get("mode") or policy["mode"]
    validate_policy(policy, host)
    return policy


def parse_size_to_bytes(raw: str) -> int:
    text = raw.strip()
    if text in {"", "-"}:
        return 0
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)([A-Za-z]+)?", text)
    if not match:
        raise ValueError(f"cannot parse size {raw!r}")
    number = float(match.group(1))
    unit = (match.group(2) or "B").lower()
    if unit not in BYTES_UNITS:
        raise ValueError(f"unknown size unit in {raw!r}")
    return int(number * BYTES_UNITS[unit])


def bytes_to_gb(value: int) -> float:
    return round(value / 1024**3, 2)


def parse_docker_system_df(text: str) -> dict[str, dict[str, Any]]:
    """Parse the table output from `docker system df`.

    Docker's JSON output is not available on every installed version, so the
    collector treats the table as the compatibility source.
    """
    rows: dict[str, dict[str, Any]] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("TYPE"):
            continue
        parts = re.split(r"\s+", line)
        if len(parts) < 5:
            continue
        type_name = parts[0].lower()
        if type_name == "local" and len(parts) >= 6 and parts[1].lower() == "volumes":
            type_name = "local_volumes"
            total, active, size, reclaimable = parts[2], parts[3], parts[4], parts[5]
        elif type_name == "build" and len(parts) >= 6 and parts[1].lower() == "cache":
            type_name = "build"
            total, active, size, reclaimable = parts[2], parts[3], parts[4], parts[5]
        else:
            total, active, size, reclaimable = parts[1], parts[2], parts[3], parts[4]
        reclaim_size = reclaimable.split("(", 1)[0]
        rows[type_name] = {
            "total": int(total) if total.isdigit() else total,
            "active": int(active) if active.isdigit() else active,
            "size_bytes": parse_size_to_bytes(size),
            "reclaimable_bytes": parse_size_to_bytes(reclaim_size),
            "raw": line,
        }
    return rows


class CommandResult:
    def __init__(self, command: list[str], exit_code: int, stdout: str, stderr: str) -> None:
        self.command = command
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr


def run_command(command: list[str], timeout: int = 20) -> CommandResult:
    try:
        proc = subprocess.run(command, text=True, capture_output=True, timeout=timeout, check=False)
        return CommandResult(command, proc.returncode, proc.stdout, proc.stderr)
    except FileNotFoundError as exc:
        return CommandResult(command, 127, "", str(exc))
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "timeout")
        return CommandResult(command, 124, stdout, stderr)


def collect_root(path: Path = Path("/")) -> dict[str, Any]:
    usage = shutil.disk_usage(path)
    free_pct = (usage.free / usage.total) * 100 if usage.total else 0
    return {
        "mountpoint": str(path),
        "size_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "size_gb": bytes_to_gb(usage.total),
        "used_gb": bytes_to_gb(usage.used),
        "free_gb": bytes_to_gb(usage.free),
        "free_pct": round(free_pct, 2),
        "used_pct": round(100 - free_pct, 2),
    }


def docker_json_lines(command: list[str]) -> tuple[list[dict[str, Any]], CommandResult]:
    result = run_command(command)
    items: list[dict[str, Any]] = []
    if result.exit_code != 0:
        return items, result
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return items, result


def collect_docker() -> dict[str, Any]:
    df_result = run_command(["docker", "system", "df"])
    parsed_df = parse_docker_system_df(df_result.stdout) if df_result.exit_code == 0 else {}
    images, images_result = docker_json_lines(["docker", "image", "ls", "--format", "{{json .}}"])
    containers, containers_result = docker_json_lines(["docker", "container", "ls", "-a", "--format", "{{json .}}"])
    dangling, dangling_result = docker_json_lines(["docker", "image", "ls", "--filter", "dangling=true", "--format", "{{json .}}"])
    stopped = [item for item in containers if str(item.get("State", "")).lower() != "running"]
    used_image_ids = {str(item.get("ImageID") or item.get("Image") or "") for item in containers if str(item.get("State", "")).lower() == "running"}
    unused_images = [item for item in images if str(item.get("ID") or "") not in used_image_ids and str(item.get("Containers", "")) in {"0", ""}]
    return {
        "available": df_result.exit_code == 0,
        "system_df": parsed_df,
        "images": images,
        "containers": containers,
        "dangling_images": dangling,
        "stopped_containers": stopped,
        "unused_images": unused_images,
        "commands": {
            "system_df": df_result.__dict__,
            "images": images_result.__dict__,
            "containers": containers_result.__dict__,
            "dangling_images": dangling_result.__dict__,
        },
    }


def root_status(root: dict[str, Any], policy: dict[str, Any]) -> str:
    disk = policy["disk_cleanup"]
    free = float(root["free_pct"])
    if free <= float(disk["root_free_critical_pct"]):
        return "critical"
    if free <= float(disk["root_free_warning_pct"]):
        return "warning"
    return "ok"


def proposed_actions(host: str, policy: dict[str, Any], docker: dict[str, Any]) -> list[dict[str, Any]]:
    if not bool(policy.get("enabled")):
        return []
    disk = policy["disk_cleanup"]
    mode = str(disk.get("mode") or policy["mode"])
    system_df = docker.get("system_df") or {}
    actions: list[dict[str, Any]] = []
    build_reclaim = int((system_df.get("build") or {}).get("reclaimable_bytes") or 0)
    image_reclaim = int((system_df.get("images") or {}).get("reclaimable_bytes") or 0)
    if disk.get("allow_build_cache_prune") and build_reclaim > 0:
        actions.append({
            "id": f"{host}-builder-prune-168h",
            "class": "disk_cleanup",
            "risk": "low",
            "mode_required": mode,
            "estimated_reclaim_bytes": build_reclaim,
            "estimated_reclaim_gb": bytes_to_gb(build_reclaim),
            "command": "docker builder prune --filter until=168h --force",
            "automatic_allowed": mode == "automatic" and build_reclaim <= int(float(disk.get("automatic_max_reclaim_gb", 10)) * 1024**3),
        })
    if disk.get("allow_dangling_image_prune") and docker.get("dangling_images"):
        actions.append({
            "id": f"{host}-dangling-image-prune",
            "class": "disk_cleanup",
            "risk": "low",
            "mode_required": mode,
            "estimated_reclaim_bytes": image_reclaim,
            "estimated_reclaim_gb": bytes_to_gb(image_reclaim),
            "command": "docker image prune --force",
            "automatic_allowed": mode == "automatic",
        })
    if disk.get("allow_stopped_container_prune") and docker.get("stopped_containers"):
        actions.append({
            "id": f"{host}-stopped-container-prune",
            "class": "disk_cleanup",
            "risk": "low",
            "mode_required": mode,
            "estimated_reclaim_bytes": 0,
            "estimated_reclaim_gb": 0,
            "command": "docker container prune --force",
            "automatic_allowed": mode == "automatic",
        })
    if disk.get("allow_unused_image_prune") and docker.get("unused_images"):
        actions.append({
            "id": f"{host}-unused-image-prune-review",
            "class": "disk_cleanup",
            "risk": "medium",
            "mode_required": "manual_approval",
            "estimated_reclaim_bytes": image_reclaim,
            "estimated_reclaim_gb": bytes_to_gb(image_reclaim),
            "command": "docker image prune -a --force",
            "automatic_allowed": False,
        })
    return actions


def collect(host: str, inventory_path: Path) -> dict[str, Any]:
    inventory = load_hosts_inventory(inventory_path)
    policy = maintenance_policy(inventory, host)
    root = collect_root(Path("/"))
    docker = collect_docker()
    root["status"] = root_status(root, policy)
    actions = proposed_actions(host, policy, docker)
    safe_reclaim = sum(int(action.get("estimated_reclaim_bytes") or 0) for action in actions if action.get("risk") == "low")
    return {
        "generated_at": now_iso(),
        "host": host,
        "mode": policy["mode"],
        "policy": policy,
        "root": root,
        "docker": {
            "available": docker["available"],
            "system_df": docker["system_df"],
            "images_count": len(docker["images"]),
            "containers_count": len(docker["containers"]),
            "stopped_containers_count": len(docker["stopped_containers"]),
            "dangling_images_count": len(docker["dangling_images"]),
            "unused_images": docker["unused_images"][:25],
            "safe_reclaim_bytes": safe_reclaim,
            "safe_reclaim_gb": bytes_to_gb(safe_reclaim),
        },
        "updates": {"image_updates_available": None, "code_updates_available": None, "blocked": ["update detection not implemented in phase 1"]},
        "proposed_actions": actions,
        "last_action": None,
    }


def metrics_for_report(report: dict[str, Any]) -> str:
    host = prometheus_label_value(str(report["host"]))
    root = report["root"]
    docker = report["docker"]
    ts = int(datetime.fromisoformat(report["generated_at"].replace("Z", "+00:00")).timestamp())
    automatic = 1 if report.get("mode") == "automatic" else 0
    lines = [
        "# HELP home_network_docker_maintenance_root_free_pct Root filesystem free percentage.",
        "# TYPE home_network_docker_maintenance_root_free_pct gauge",
        f'home_network_docker_maintenance_root_free_pct{{host="{host}"}} {root["free_pct"]}',
        "# HELP home_network_docker_maintenance_safe_reclaim_bytes Low-risk Docker reclaim estimate.",
        "# TYPE home_network_docker_maintenance_safe_reclaim_bytes gauge",
        f'home_network_docker_maintenance_safe_reclaim_bytes{{host="{host}"}} {docker["safe_reclaim_bytes"]}',
        "# HELP home_network_docker_maintenance_stopped_containers Stopped Docker containers found.",
        "# TYPE home_network_docker_maintenance_stopped_containers gauge",
        f'home_network_docker_maintenance_stopped_containers{{host="{host}"}} {docker["stopped_containers_count"]}',
        "# HELP home_network_docker_maintenance_last_check_timestamp_seconds Last successful check time.",
        "# TYPE home_network_docker_maintenance_last_check_timestamp_seconds gauge",
        f'home_network_docker_maintenance_last_check_timestamp_seconds{{host="{host}"}} {ts}',
        "# HELP home_network_docker_maintenance_automatic_enabled Whether host maintenance mode is automatic.",
        "# TYPE home_network_docker_maintenance_automatic_enabled gauge",
        f'home_network_docker_maintenance_automatic_enabled{{host="{host}",action="disk_cleanup"}} {automatic}',
    ]
    return "\n".join(lines) + "\n"


def atomic_write(path: Path, content: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            tmp.write(content)
        os.chmod(tmp_name, mode)
        os.replace(tmp_name, path)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
