"""Isolated component lifecycle checks; no personal homes or model calls."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT / "components/impeccable"
SPEC = importlib.util.spec_from_file_location("component_build", HERE / "build.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)
PS = shutil.which("powershell.exe")


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


@unittest.skipUnless(os.name == "nt" and PS, "Windows PowerShell is required")
class ComponentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(prefix="vault-build-")
        cls.addClassCleanup(cls.work.cleanup)
        cls.root = Path(cls.work.name)
        cls.here = cls.root / "source"
        cls.here.mkdir()
        for name in ("manage.ps1", "README.md"):
            shutil.copy2(HERE / name, cls.here / name)
        cls.config = json.loads((HERE / "component.json").read_text(encoding="utf-8"))
        cls.config["sourceSnapshots"] = {k: str(ROOT / v) for k, v in cls.config["sourceSnapshots"].items()}
        cls.engine = cls.root / "fixture-engine.exe"
        cls.engine.write_bytes(b"fixture engine; not executable or a real model")
        cls.config["engine"]["sha256"] = BUILDER.digest(cls.engine.read_bytes())
        save(cls.here / "component.json", cls.config)
        cls.record = BUILDER.build(cls.engine, cls.root / "out", cls.root, cls.here)
        cls.archive = cls.root / "out" / cls.record["archive"]["filename"]
        cls.template = cls.root / "template"
        with zipfile.ZipFile(cls.archive) as archive:
            archive.extractall(cls.template)

    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix="vault-test-")
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.project = self.root / "project with spaces"
        self.project.mkdir()
        self.bundle = self.root / "bundle"
        shutil.copytree(self.template, self.bundle)

    def run_action(self, action, client="claude", bundle=None, success=True, **options):
        command = [PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                   str((bundle or self.bundle) / "manage.ps1"), "-Action", action,
                   "-Client", client, "-Project", str(self.project)]
        for key, value in options.items():
            command += ["-" + key] if value is True else ["-" + key, str(value)]
        process = subprocess.run(command, capture_output=True, timeout=45)
        output = process.stdout.decode("utf-8-sig", errors="replace").strip()
        result = json.loads(output)
        self.assertEqual(process.returncode == 0, success, (result, process.stderr.decode(errors="replace")))
        self.assertEqual(result["ok"], success)
        self.assertEqual(result["protocolVersion"], 1)
        return result

    def target(self, client="claude"):
        return self.project / (".claude" if client == "claude" else ".agents") / "skills/impeccable"

    def newer_bundle(self, version, additions=None):
        target = self.root / ("bundle-" + version)
        shutil.copytree(self.bundle, target)
        manifest_path = target / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["componentVersion"] = version
        for relative, data in (additions or {}).items():
            path = target / "skill" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            manifest["files"]["skill/" + relative] = BUILDER.digest(data)
        save(manifest_path, manifest)
        return target

    def test_reproducible_build_and_immutable_release(self):
        record = BUILDER.build(self.engine, self.root / "again", self.__class__.root, self.here)
        self.assertEqual(record["archive"], self.record["archive"])
        release = self.root / "registry/releases/impeccable/1.0.0/windows-x64.json"
        release.parent.mkdir(parents=True)
        bad = copy.deepcopy(record)
        bad["archive"]["sha256"] = "0" * 64
        save(release, bad)
        with self.assertRaisesRegex(ValueError, "Released bytes changed"):
            BUILDER.build(self.engine, self.root / "changed", self.root, self.here)

    def test_wrong_engine_is_rejected(self):
        bad = self.root / "wrong.exe"
        bad.write_bytes(b"wrong engine")
        with self.assertRaisesRegex(ValueError, "Engine SHA256"):
            BUILDER.build(bad, self.root / "bad", self.__class__.root, self.here)

    def test_changed_mirror_is_rejected(self):
        here = self.root / "source"
        shutil.copytree(self.here, here)
        config = copy.deepcopy(self.config)
        mirror = self.root / "different"
        shutil.copytree(Path(config["sourceSnapshots"]["codex"]), mirror)
        (mirror / "SKILL.md").write_text("changed", encoding="utf-8")
        config["sourceSnapshots"]["codex"] = str(mirror)
        save(here / "component.json", config)
        with self.assertRaisesRegex(ValueError, "snapshots differ"):
            BUILDER.build(self.engine, self.root / "bad", self.__class__.root, here)

    def test_both_project_clients_and_repeat_install(self):
        for client in ("claude", "codex"):
            with self.subTest(client=client):
                self.assertEqual(self.run_action("status", client)["status"], "not-installed")
                self.assertTrue(self.run_action("install", client)["changed"])
                self.assertFalse(self.run_action("install", client)["changed"])
                self.assertEqual(self.run_action("status", client)["details"]["health"], "unchecked")
                self.assertTrue((self.target(client) / "scripts/bin/windows-x64/impeccable.exe").is_file())

    def test_user_scope_is_explicit_and_preserves_config(self):
        self.run_action("install", Scope="user", success=False)
        for client in ("claude", "codex"):
            home = self.root / (client + " home")
            home.mkdir()
            config = home / ("settings.json" if client == "claude" else "config.toml")
            config.write_bytes(b"user configuration must remain unchanged")
            self.run_action("install", client, Scope="user", ClientHome=home)
            self.assertEqual(config.read_bytes(), b"user configuration must remain unchanged")
            self.assertTrue((home / "skills/impeccable/SKILL.md").is_file())

    def test_unicode_project_path_round_trips_through_json(self):
        self.project = self.root / "project-\u9879\u76ee"
        self.project.mkdir()
        result = self.run_action("install")
        self.assertEqual(Path(result["target"]), self.target())
        self.run_action("uninstall")

    def test_unmanaged_skill_is_never_overwritten(self):
        self.target().mkdir(parents=True)
        skill = self.target() / "SKILL.md"
        skill.write_bytes(b"personal skill")
        self.assertEqual(self.run_action("status")["status"], "unmanaged")
        self.run_action("install", success=False)
        self.run_action("uninstall", success=False)
        self.assertEqual(skill.read_bytes(), b"personal skill")

    def test_user_edits_block_reinstall_and_uninstall(self):
        self.run_action("install")
        skill = self.target() / "SKILL.md"
        skill.write_bytes(b"my edits")
        self.run_action("install", success=False)
        self.run_action("uninstall", success=False)
        self.assertEqual(skill.read_bytes(), b"my edits")

    def test_corrupt_bundle_is_rejected_before_install(self):
        (self.bundle / "skill/SKILL.md").write_bytes(b"corrupt")
        self.run_action("install", success=False)
        self.assertFalse(self.target().exists())

    def test_manifest_escape_is_rejected(self):
        path = self.bundle / "manifest.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["files"]["../escaped"] = "0" * 64
        save(path, manifest)
        self.run_action("install", success=False)
        self.assertFalse(self.target().exists())

    def test_upgrade_preserves_personal_files_and_rotates_one_backup(self):
        self.run_action("install")
        (self.target() / "my-notes.md").write_bytes(b"personal notes")
        result = self.run_action("install", bundle=self.newer_bundle("1.0.1"))
        backup = Path(result["details"]["backup"])
        self.assertTrue((backup / "SKILL.md").is_file())
        self.assertNotIn("skills", backup.relative_to(self.project).parts)
        self.assertEqual((self.target() / "my-notes.md").read_bytes(), b"personal notes")
        self.run_action("install", bundle=self.newer_bundle("1.0.2"))
        receipt = json.loads((backup / ".vault-install.json").read_text())
        self.assertEqual(receipt["componentVersion"], "1.0.1")
        self.assertFalse(list(backup.parent.glob("retired-*")))

    def test_new_version_cannot_replace_a_personal_file(self):
        self.run_action("install")
        personal = self.target() / "new-file.md"
        personal.write_bytes(b"mine")
        newer = self.newer_bundle("1.0.1", {"new-file.md": b"upstream"})
        self.run_action("install", bundle=newer, success=False)
        self.assertEqual(personal.read_bytes(), b"mine")

    def test_modified_backup_is_preserved(self):
        self.run_action("install")
        result = self.run_action("install", bundle=self.newer_bundle("1.0.1"))
        extra = Path(result["details"]["backup"]) / "new-personal-note.md"
        extra.write_bytes(b"keep this")
        self.run_action("install", bundle=self.newer_bundle("1.0.2"), success=False)
        self.assertEqual(extra.read_bytes(), b"keep this")

    def test_downgrade_requires_explicit_request(self):
        self.run_action("install", bundle=self.newer_bundle("1.0.1"))
        self.run_action("install", success=False)
        self.assertTrue(self.run_action("install", AllowDowngrade=True)["changed"])

    def test_uninstall_retains_personal_files(self):
        self.run_action("install")
        personal = self.target() / "personal.txt"
        personal.write_bytes(b"keep")
        self.run_action("uninstall")
        self.assertTrue(personal.exists())
        self.assertFalse((self.target() / "SKILL.md").exists())
        self.assertFalse((self.target() / ".vault-install.json").exists())

    def test_clean_uninstall_is_idempotent(self):
        self.run_action("install")
        self.run_action("uninstall")
        self.assertEqual(self.run_action("uninstall")["status"], "not-installed")

    def test_check_does_not_claim_invalid_engine_is_ready(self):
        self.run_action("install")
        self.run_action("check", success=False)

    def test_junction_in_target_parent_is_rejected(self):
        outside = self.root / "outside"
        outside.mkdir()
        junction = self.project / ".claude"
        created = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(junction), str(outside)], capture_output=True)
        self.assertEqual(created.returncode, 0)
        self.run_action("install", success=False)
        self.assertFalse((outside / "skills").exists())


@unittest.skipUnless(os.name == "nt" and PS and os.environ.get("VAULT_IMPECCABLE_ENGINE"),
                     "Set VAULT_IMPECCABLE_ENGINE for the real pinned native check")
class NativeEngineTests(unittest.TestCase):
    def test_real_engine_and_local_detector_for_both_clients(self):
        with tempfile.TemporaryDirectory(prefix="vault-native-") as directory:
            root = Path(directory)
            record = BUILDER.build(Path(os.environ["VAULT_IMPECCABLE_ENGINE"]), root / "out")
            bundle = root / "bundle"
            with zipfile.ZipFile(root / "out" / record["archive"]["filename"]) as archive:
                archive.extractall(bundle)
            for client in ("claude", "codex"):
                project = root / (client + " project")
                project.mkdir()
                script = bundle / "manage.ps1"
                for action in ("install", "check"):
                    run = subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script),
                                          "-Action", action, "-Client", client, "-Project", str(project)], capture_output=True, timeout=45)
                    self.assertEqual(run.returncode, 0, run.stdout.decode(errors="replace"))
                    self.assertTrue(json.loads(run.stdout.decode("utf-8-sig"))["ok"])
                skill = project / (".claude" if client == "claude" else ".agents") / "skills/impeccable"
                fixture = project / "sample.css"
                fixture.write_text("button { color: #fff; background: #fff; font-size: 8px; }\n", encoding="utf-8")
                env = {**os.environ, "VAULT_TEST_LAUNCHER": str(skill / "scripts/impeccable.cmd"),
                       "VAULT_TEST_TARGET": str(fixture), "HTTP_PROXY": "http://127.0.0.1:9",
                       "HTTPS_PROXY": "http://127.0.0.1:9", "IMPECCABLE_HOME": str(root / "empty-cache")}
                env.pop("IMPECCABLE_BIN", None)
                run = subprocess.run([PS, "-NoProfile", "-Command",
                    "& $env:VAULT_TEST_LAUNCHER detect --no-config --json $env:VAULT_TEST_TARGET; exit $LASTEXITCODE"],
                    cwd=project, env=env, capture_output=True, timeout=45)
                self.assertIn(run.returncode, (0, 1), run.stderr.decode(errors="replace"))
                json.loads(run.stdout.decode("utf-8-sig"))
                self.assertFalse((root / "empty-cache").exists(), "Bundled engine should need no cache download")


if __name__ == "__main__":
    unittest.main()
