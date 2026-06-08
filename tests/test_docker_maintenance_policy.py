#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "lib" / "docker_maintenance.py"


def load_module():
    spec = importlib.util.spec_from_file_location("docker_maintenance", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DockerMaintenancePolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mod = load_module()

    def test_inventory_policies_have_safe_initial_modes(self) -> None:
        inventory = self.mod.load_hosts_inventory(REPO_ROOT / "inventory" / "hosts.yml")
        expected_modes = {
            "jellybase": "manual_approval",
            "jellyhome": "report_only",
            "jellyberry": "report_only",
            "jellybackup": "report_only",
            "jellysa": "report_only",
        }
        for host, expected_mode in expected_modes.items():
            policy = self.mod.maintenance_policy(inventory, host)
            self.assertTrue(policy["enabled"], host)
            self.assertEqual(policy["mode"], expected_mode, host)
            self.assertFalse(policy["disk_cleanup"]["allow_volume_prune"], host)
            self.assertEqual(policy["image_updates"]["mode"], "report_only", host)
            self.assertFalse(policy["code_updates"]["allow_git_pull"], host)

    def test_invalid_mode_is_rejected(self) -> None:
        inventory = {"hosts": {"demo": {"maintenance": {"enabled": True, "mode": "YOLO"}}}}
        with self.assertRaisesRegex(ValueError, "mode must be one of"):
            self.mod.maintenance_policy(inventory, "demo")

    def test_automatic_volume_prune_is_rejected(self) -> None:
        inventory = {
            "hosts": {
                "demo": {
                    "maintenance": {
                        "enabled": True,
                        "mode": "automatic",
                        "disk_cleanup": {"mode": "automatic", "allow_volume_prune": True},
                    }
                }
            }
        }
        with self.assertRaisesRegex(ValueError, "automatic volume prune"):
            self.mod.maintenance_policy(inventory, "demo")

    def test_disabled_policy_generates_no_actions(self) -> None:
        policy = self.mod.deep_merge(self.mod.DEFAULT_POLICY, {"enabled": False})
        docker = {"system_df": {"build": {"reclaimable_bytes": 10 * 1024**3}}, "dangling_images": [{}], "stopped_containers": [{}]}
        self.assertEqual(self.mod.proposed_actions("demo", policy, docker), [])

    def test_atomic_write_creates_parent_and_replaces_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nested" / "out.txt"
            self.mod.atomic_write(path, "first\n")
            self.mod.atomic_write(path, "second\n")
            self.assertEqual(path.read_text(), "second\n")
            self.assertEqual(oct(path.stat().st_mode & 0o777), "0o644")


if __name__ == "__main__":
    unittest.main()
