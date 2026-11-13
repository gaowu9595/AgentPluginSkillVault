"""Generic catalog additions must retain fixed upstream identity checks."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("component_registry", ROOT / "scripts/validate-components.py")
REGISTRY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REGISTRY)


class RegistryTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".ui_test").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / ".ui_test", prefix="registry-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.addCleanup(patch.stopall)
        patch.object(REGISTRY, "ROOT", self.root).start()
        self.config = {
            "schemaVersion": 1, "protocolVersion": 1, "componentId": "example", "componentVersion": "1.0.0",
            "platform": "windows-x64", "upstream": {"version": "2.0.0"},
            "engine": {"version": "3.0.0", "sha256": "a" * 64},
            "sourceSnapshots": {"claude": "sources/claude", "codex": "sources/codex"},
        }
        for client in ("claude", "codex"):
            directory = self.root / "sources" / client
            directory.mkdir(parents=True)
            (directory / "SKILL.md").write_text("fixture skill", encoding="utf-8")
            (directory / "LICENSE").write_text("fixture license", encoding="utf-8")
        (self.root / "report.md").write_text("Fixture evidence only", encoding="utf-8")
        self.write("registry/artifacts.json", {"artifacts": []})
        self.write("registry/components.json", {"schemaVersion": 1, "components": [{
            "id": "example", "definition": "component.json", "recommendedVersion": "1.0.0", "releases": [{
                "componentVersion": "1.0.0", "platform": "windows-x64", "record": "registry/releases/example/1.0.0/windows-x64.json",
            }],
        }]})
        self.sync()

    def write(self, name, value):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value), encoding="utf-8")

    def sync(self):
        self.write("component.json", self.config)
        self.write("registry/releases/example/1.0.0/windows-x64.json", {
            **{key: value for key, value in self.config.items() if key != "sourceSnapshots"},
            "archive": {"filename": "example-1.0.0-windows-x64.zip", "bytes": 1, "sha256": "b" * 64},
            "manifestSha256": "c" * 64, "validation": "report.md",
        })

    def test_generic_component_can_pin_runtime_without_impeccable_specific_fields(self):
        self.assertEqual(REGISTRY.validate()["components"], 1)

    def test_existing_upstream_skill_and_license_pins_remain_enforced(self):
        for field, filename in (("skillSha256", "SKILL.md"), ("licenseSha256", "LICENSE")):
            with self.subTest(field=field):
                self.config["upstream"] = {"version": "2.0.0", field: "0" * 64}
                self.sync()
                with self.assertRaisesRegex(ValueError, "Pinned source hash mismatch"):
                    REGISTRY.validate()
                data = (self.root / "sources/claude" / filename).read_bytes()
                self.config["upstream"][field] = hashlib.sha256(data).hexdigest()
                self.sync()
                self.assertTrue(REGISTRY.validate()["ok"])

    def test_recommended_source_identity_cannot_silently_drift(self):
        self.config["engine"]["version"] = "4.0.0"
        self.write("component.json", self.config)
        with self.assertRaisesRegex(ValueError, "Recommended release differs"):
            REGISTRY.validate()


if __name__ == "__main__":
    unittest.main()
