#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "lib" / "docker_maintenance.py"


def load_module():
    spec = importlib.util.spec_from_file_location("docker_maintenance", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DockerMaintenanceParseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mod = load_module()

    def test_parse_size_to_bytes_supports_docker_units(self) -> None:
        self.assertEqual(self.mod.parse_size_to_bytes("0B"), 0)
        self.assertEqual(self.mod.parse_size_to_bytes("1kB"), 1000)
        self.assertEqual(self.mod.parse_size_to_bytes("1MB"), 1000**2)
        self.assertEqual(self.mod.parse_size_to_bytes("1.5GB"), int(1.5 * 1000**3))
        self.assertEqual(self.mod.parse_size_to_bytes("1GiB"), 1024**3)

    def test_parse_docker_system_df_table(self) -> None:
        text = """
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          26        22        46.04GB   7.928GB (17%)
Containers      23        20        504MB     54.29MB (10%)
Local Volumes   6         3         1.336GB   149.8MB (11%)
Build Cache     139       0         12.78GB   4.517GB
"""
        parsed = self.mod.parse_docker_system_df(text)
        self.assertEqual(parsed["images"]["total"], 26)
        self.assertEqual(parsed["images"]["active"], 22)
        self.assertEqual(parsed["images"]["size_bytes"], int(46.04 * 1000**3))
        self.assertEqual(parsed["images"]["reclaimable_bytes"], int(7.928 * 1000**3))
        self.assertEqual(parsed["local_volumes"]["total"], 6)
        self.assertEqual(parsed["build"]["reclaimable_bytes"], int(4.517 * 1000**3))

    def test_proposed_actions_respect_manual_policy(self) -> None:
        policy = self.mod.deep_merge(
            self.mod.DEFAULT_POLICY,
            {"enabled": True, "mode": "manual_approval", "disk_cleanup": {"mode": "manual_approval"}},
        )
        docker = {
            "system_df": {"build": {"reclaimable_bytes": 5 * 1024**3}, "images": {"reclaimable_bytes": 3 * 1024**3}},
            "dangling_images": [{"Repository": "<none>"}],
            "stopped_containers": [{"Names": "old"}],
            "unused_images": [{"Repository": "unused"}],
        }
        actions = self.mod.proposed_actions("demo", policy, docker)
        ids = {item["id"] for item in actions}
        self.assertIn("demo-builder-prune-168h", ids)
        self.assertIn("demo-dangling-image-prune", ids)
        self.assertIn("demo-stopped-container-prune", ids)
        self.assertNotIn("demo-unused-image-prune-review", ids)
        self.assertFalse(any(item["automatic_allowed"] for item in actions))

    def test_metrics_include_safe_reclaim_and_timestamp(self) -> None:
        report = {
            "generated_at": "2026-06-08T00:00:00Z",
            "host": "demo",
            "mode": "report_only",
            "root": {"free_pct": 12.5},
            "docker": {"safe_reclaim_bytes": 1234, "stopped_containers_count": 2},
        }
        metrics = self.mod.metrics_for_report(report)
        self.assertIn('home_network_docker_maintenance_root_free_pct{host="demo"} 12.5', metrics)
        self.assertIn('home_network_docker_maintenance_safe_reclaim_bytes{host="demo"} 1234', metrics)
        self.assertIn('home_network_docker_maintenance_check_success{host="demo"} 1', metrics)
        self.assertIn('home_network_docker_maintenance_automatic_enabled{host="demo",action="disk_cleanup"} 0', metrics)

    def test_metrics_escape_host_label(self) -> None:
        report = {
            "generated_at": "2026-06-08T00:00:00Z",
            "host": 'bad"host\\name\nnext',
            "mode": "report_only",
            "root": {"free_pct": 12.5},
            "docker": {"safe_reclaim_bytes": 1234, "stopped_containers_count": 2},
        }
        metrics = self.mod.metrics_for_report(report)
        self.assertIn('host="bad\\"host\\\\name\\nnext"', metrics)


if __name__ == "__main__":
    unittest.main()
