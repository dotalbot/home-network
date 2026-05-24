#!/usr/bin/env python3
"""Small Alertmanager-to-Discord webhook bridge.

The Discord webhook URL is read from a file-mounted secret. It is never logged.
The bridge accepts Alertmanager webhook JSON and posts compact, grouped messages
suitable for a wake-me-up Discord thread.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

HOST = os.environ.get("BRIDGE_HOST", "0.0.0.0")
PORT = int(os.environ.get("BRIDGE_PORT", "9094"))
WEBHOOK_FILE = os.environ.get("DISCORD_WEBHOOK_FILE", "/run/secrets/discord_webhook_url")
MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", "1048576"))
MAX_DISCORD_CHARS = 1900


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_webhook_url() -> str:
    with open(WEBHOOK_FILE, encoding="utf-8") as handle:
        return handle.read().strip()


def compact_labels(labels: dict[str, Any]) -> str:
    interesting = ["host", "instance", "category", "service", "device", "mountpoint"]
    parts = []
    for key in interesting:
        value = labels.get(key)
        if value:
            parts.append(f"{key}={value}")
    return ", ".join(parts)


def alert_line(alert: dict[str, Any]) -> str:
    labels = alert.get("labels") or {}
    annotations = alert.get("annotations") or {}
    name = labels.get("alertname", "unknown-alert")
    severity = labels.get("severity", "unknown")
    summary = annotations.get("summary") or name
    details = compact_labels(labels)
    if details:
        return f"- {severity}: {summary} ({details})"
    return f"- {severity}: {summary}"


def format_message(payload: dict[str, Any], route: str) -> str:
    status = payload.get("status", "unknown")
    alerts = payload.get("alerts") or []
    group_labels = payload.get("groupLabels") or {}
    common_labels = payload.get("commonLabels") or {}
    common_annotations = payload.get("commonAnnotations") or {}

    severity = common_labels.get("severity") or route or "unknown"
    emoji = {
        ("firing", "critical"): "🚨",
        ("resolved", "critical"): "✅",
        ("firing", "warning"): "⚠️",
        ("resolved", "warning"): "✅",
        ("firing", "info"): "ℹ️",
        ("resolved", "info"): "✅",
    }.get((status, severity), "🔔" if status == "firing" else "✅")

    alertname = group_labels.get("alertname") or common_labels.get("alertname") or "home-network alert"
    count = len(alerts)
    title = f"{emoji} {status.upper()} {severity}: {alertname}"
    if count:
        title += f" ({count})"

    lines = [title]
    summary = common_annotations.get("summary")
    if summary and summary != alertname:
        lines.append(str(summary))

    for alert in alerts[:10]:
        lines.append(alert_line(alert))
    if len(alerts) > 10:
        lines.append(f"- ...and {len(alerts) - 10} more")

    generator = payload.get("externalURL")
    if generator:
        lines.append(f"Alertmanager: {generator}")
    lines.append("Grafana/Prometheus are source of truth; Discord is the wake-up path.")

    text = "\n".join(lines)
    if len(text) > MAX_DISCORD_CHARS:
        text = text[: MAX_DISCORD_CHARS - 20].rstrip() + "\n…truncated"
    return text


def post_discord(message: str) -> tuple[int, str]:
    webhook_url = load_webhook_url()
    body = json.dumps({"content": message}).encode("utf-8")
    request = urllib.request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "home-network-alertmanager-discord-bridge/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read(200).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read(200).decode("utf-8", "replace")
        return exc.code, detail
    except urllib.error.URLError as exc:
        return 599, str(exc.reason)
    except TimeoutError as exc:
        return 598, str(exc)


class Handler(BaseHTTPRequestHandler):
    server_version = "AlertmanagerDiscordBridge/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{now()} {self.address_string()} {fmt % args}", flush=True)

    def send_text(self, code: int, text: str) -> None:
        encoded = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/healthz", "/readyz"}:
            try:
                url = load_webhook_url()
                if not url.startswith("https://"):
                    raise ValueError("webhook URL must be https")
            except Exception as exc:  # noqa: BLE001
                self.send_text(503, f"not ready: {exc}\n")
                return
            self.send_text(200, "ok\n")
            return
        self.send_text(404, "not found\n")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/alertmanager":
            self.send_text(404, "not found\n")
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_text(413, "invalid body length\n")
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as exc:
            self.send_text(400, f"invalid json: {exc}\n")
            return
        route = urllib.parse.parse_qs(parsed.query).get("route", ["warning"])[0]
        message = format_message(payload, route)
        status, detail = post_discord(message)
        if 200 <= status < 300:
            self.send_text(200, "sent\n")
            return
        print(f"{now()} warning: Discord webhook returned HTTP {status}: {detail}", file=sys.stderr, flush=True)
        self.send_text(502, f"discord http {status}\n")


def main() -> int:
    print(f"{now()} starting alertmanager-discord-bridge on {HOST}:{PORT}", flush=True)
    # Fail fast if the secret is missing/malformed; container restart policy will retry.
    url = load_webhook_url()
    if not url.startswith("https://"):
        print("not good: Discord webhook URL secret must start with https://", file=sys.stderr)
        return 1
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
