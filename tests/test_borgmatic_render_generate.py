#!/usr/bin/env python3
from __future__ import annotations

import importlib.machinery
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "borgmatic-render-generate"


def load_renderer():
    loader = importlib.machinery.SourceFileLoader("borgmatic_render_generate", str(SCRIPT))
    spec = importlib.util.spec_from_loader("borgmatic_render_generate", loader)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BorgmaticRenderGenerateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.renderer = load_renderer()

    def test_render_all_writes_yaml_manifests_and_no_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "render"
            report = self.renderer.render_all(REPO_ROOT / "inventory" / "backups.yml", out, clean=True)

            self.assertEqual(report["rendered_hosts"], ["jellybase", "jellyberry", "jellyhome"])
            self.assertTrue(report["checks"]["yaml_parsed"])
            self.assertTrue(report["checks"]["secret_scan_passed"])
            self.assertFalse(report["checks"]["live_paths_mutated"])
            self.assertIn("skipping seedbox: primary destination is disabled", report["warnings"])

            config = yaml.safe_load((out / "jellybase" / "borgmatic-config.yaml").read_text())
            self.assertEqual(config["repositories"][0]["path"], "ssh://jellybackup@192.168.1.75/home/jellybackup/externaldisk/borg_jellybase")
            self.assertIn("/opt/docker", config["source_directories"])
            self.assertEqual(config["encryption_passcommand"], "cat /opt/docker/.secrets/borgmatic-passphrase")
            self.assertEqual(
                config["exclude_patterns"],
                [
                    "/opt/docker/.secrets",
                    "/opt/docker/.secrets/**",
                    "/opt/docker/appdata/*/cache",
                    "/opt/docker/appdata/*/logs",
                    "/opt/docker/appdata/*/tmp",
                    "/opt/docker/appdata/*/temp",
                    "/opt/docker/**/.cache",
                    "/opt/docker/**/node_modules",
                    "/opt/docker/**/.venv",
                ],
            )

            manifest = yaml.safe_load((out / "jellybase" / "restore-manifest.yaml").read_text())
            backup_set_ids = {item["id"] for item in manifest["backup_sets"]}
            self.assertIn("central-postgres-logical-dumps", backup_set_ids)
            self.assertEqual(manifest["mqtt"]["password_file"], "/opt/docker/.secrets/mqtt_borgmatic_password")

            validation_report = json.loads((out / "validation-report.json").read_text())
            self.assertTrue(validation_report["checks"]["secret_scan_passed"])

    def test_requested_disabled_or_missing_host_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = self.renderer.render_all(
                REPO_ROOT / "inventory" / "backups.yml",
                Path(tmp) / "render",
                requested_hosts={"seedbox", "jellyberry"},
                clean=True,
            )
            self.assertEqual(report["rendered_hosts"], ["jellyberry"])
            self.assertTrue(any("requested hosts not rendered" in warning for warning in report["warnings"]))

    def test_output_dir_refuses_live_paths_and_symlink_escape(self) -> None:
        with self.assertRaisesRegex(ValueError, "--output-dir must be under"):
            self.renderer.validate_output_dir(Path("/etc/borgmatic"))

        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            target = Path(tmp) / "target"
            target.mkdir()
            self.assertEqual(self.renderer.validate_output_dir(target), target.resolve())

            link = Path(tmp) / "etc-link"
            os.symlink("/etc", link)
            with self.assertRaisesRegex(ValueError, "--output-dir must be under"):
                self.renderer.validate_output_dir(link / "borgmatic")


if __name__ == "__main__":
    unittest.main()
