"""Offline builder contract checks using tiny, synthetic runtime archives."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
import warnings
import zipfile


ROOT = Path(__file__).resolve().parents[1]
BUILD_PATH = ROOT / "components/playwright-test/build.py"
SPEC = importlib.util.spec_from_file_location("playwright_build", BUILD_PATH)
BUILDER = importlib.util.module_from_spec(SPEC) if BUILD_PATH.exists() else None
if BUILDER:
    SPEC.loader.exec_module(BUILDER)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


class PlaywrightBuildTests(unittest.TestCase):
    def setUp(self):
        # Keep rename-sensitive tests on the repository's volume, not system TEMP.
        temporary_root = ROOT / ".ui_test/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.work = tempfile.TemporaryDirectory(prefix="playwright-build-", dir=temporary_root)
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.here = self.root / "components/playwright-test"
        self.runtime = self.root / "prepared runtime.zip"
        self.config = {
            "schemaVersion": 1,
            "protocolVersion": 1,
            "componentId": "playwright-test",
            "componentVersion": "1.0.0",
            "platform": "windows-x64",
            "engine": {"version": "24.11.1", "sha256": digest(b"fixture node")},
            "runtimeArchive": {"filename": self.runtime.name, "sha256": "", "bytes": 0},
            "upstream": {
                "repository": "https://github.com/microsoft/playwright",
                "version": "1.60.0", "license": "Apache-2.0",
            },
            "sourceSnapshots": {
                "claude": "claude-code/skills/vault-playwright/1.0.0",
                "codex": "codex/skills/vault-playwright/1.0.0",
            },
        }
        self.upstream = {
            **self.config["upstream"],
            "node": copy.deepcopy(self.config["engine"]),
            "packages": {"playwright": {"version": "1.60.0", "license": "Apache-2.0"}},
            "adaptation": ["Original host plugin metadata must remain intact."],
        }
        self.payload = {
            "bin/node.exe": b"fixture node",
            "runtime/node_modules/playwright/package.json": b'{"version":"1.60.0"}',
            "browsers/chromium-1223/chrome.exe": b"fixture browser",
            "LICENSES/playwright.txt": b"Apache License\nVersion 2.0\nfixture license\n",
            "UPSTREAM.json": encoded(self.upstream),
            "plugin/agents/host-only.md": b"host-specific plugin; must be omitted",
            "scripts/selfcheck.cjs": b"host selfcheck; must be omitted",
        }
        self.sources = {
            "manage.ps1": b"# synthetic adapter\n",
            "README.md": b"Synthetic component\n",
            "LICENSE": b"Apache-2.0 fixture component source license\n",
            "UPSTREAM.json": b'{"adapter":"separate Vault adapter"}\n',
            "scripts/manage.cjs": b"// synthetic manager\n",
            "scripts/nested/helper.cjs": b"// nested adapter\n",
            "vendor/toml/parser.cjs": b"// vendored parser\n",
            "vendor/toml/LICENSE": b"fixture BSD-3-Clause\n",
            "agents/planner.md": b"fixture planner\n",
            "extra/source.txt": b"include regular source files recursively\n",
        }
        for name, data in self.sources.items():
            save(self.here / name, data)
        save(self.here / "build.py", b"must not ship builder\n")
        for name in ("__pycache__/junk.pyc", "dist/old.zip", "build/generated.txt"):
            save(self.here / name, b"generated; do not ship")
        for snapshot in self.config["sourceSnapshots"].values():
            save(self.root / snapshot / "SKILL.md", b"---\nname: vault-playwright\n---\n")
            save(self.root / snapshot / "references/workflow.md", b"fixture workflow\r\n")
        self.write_runtime()

    def write_runtime(self, payload=None, manifest=None, extra=()):
        payload = self.payload if payload is None else payload
        if manifest is None:
            manifest = {
                "format": 1, "platform": "windows-x64", "version": "1.60.0-switchai.1",
                "files": {name: digest(data) for name, data in payload.items()},
            }
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.runtime, "w", zipfile.ZIP_DEFLATED) as archive:
                for name, data in payload.items():
                    archive.writestr(name, data)
                archive.writestr("manifest.json", encoded(manifest))
                for name, data in extra:
                    archive.writestr(name, data)
        self.config["runtimeArchive"].update(
            sha256=digest(self.runtime.read_bytes()), bytes=self.runtime.stat().st_size)
        self.save_config()

    def save_config(self):
        save(self.here / "component.json", encoded(self.config))

    def build(self, output="out"):
        self.assertIsNotNone(BUILDER, "Task 2 requires the independent Playwright builder")
        return BUILDER.build(self.runtime, self.root / output, self.root, self.here)

    def rejected(self, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            self.build()
        self.assertFalse(list((self.root / "out").glob("*.zip")))

    def release_path(self):
        return self.root / "registry/releases/playwright-test/1.0.0/windows-x64.json"

    def test_payload_selection_sources_manifest_and_provenance(self):
        record = self.build()
        name = record["archive"]["filename"]
        archive_path = self.root / "out" / name
        expected_runtime = {name: data for name, data in self.payload.items()
                            if name.startswith(("bin/", "runtime/", "browsers/", "LICENSES/"))}
        expected = {
            **expected_runtime, **self.sources,
            "component.json": encoded(self.config),
            "RUNTIME-UPSTREAM.json": self.payload["UPSTREAM.json"],
            "skill/SKILL.md": b"---\nname: vault-playwright\n---\n",
            "skill/references/workflow.md": b"fixture workflow\r\n",
        }
        with zipfile.ZipFile(archive_path) as archive:
            self.assertEqual(set(archive.namelist()), set(expected) | {"manifest.json"})
            for member, data in expected.items():
                self.assertEqual(archive.read(member), data, member)
            manifest_bytes = archive.read("manifest.json")
            manifest = json.loads(manifest_bytes)
            self.assertEqual(manifest["files"], {n: digest(b) for n, b in expected.items()})
            for field, value in self.config.items():
                self.assertEqual(manifest[field], value)
        self.assertEqual(record["manifestSha256"], digest(manifest_bytes))
        self.assertEqual(record["archive"]["sha256"], digest(archive_path.read_bytes()))
        self.assertEqual(record["archive"]["bytes"], archive_path.stat().st_size)
        self.assertEqual(record["validation"], "docs/reports/2026-11-13-playwright-independent.md")
        self.assertEqual(record["downloadUrls"], [])
        for field in ("schemaVersion", "componentId", "componentVersion", "platform",
                      "protocolVersion", "upstream", "engine"):
            self.assertEqual(record[field], self.config[field])
        self.assertEqual(json.loads(archive_path.with_suffix(".json").read_bytes()), record)
        self.assertEqual(archive_path.with_suffix(".zip.sha256").read_text().strip(),
                         record["archive"]["sha256"] + "  " + name)

    def test_deterministic_sorted_fixed_metadata_across_source_mtimes(self):
        first = self.build()
        for path in self.here.rglob("*"):
            os.utime(path, (1234567890, 1234567890))
        second = self.build("again")
        self.assertEqual(first, second)
        with zipfile.ZipFile(self.root / "out" / first["archive"]["filename"]) as archive:
            self.assertEqual(archive.namelist(), sorted(archive.namelist()))
            for entry in archive.infolist():
                self.assertEqual(entry.date_time, (2020, 1, 1, 0, 0, 0))
                self.assertEqual(entry.external_attr, 0o100644 << 16)
                self.assertEqual(entry.create_system, 3)
        self.assertFalse(list((self.root / "out").glob("*.tmp")))

    def test_input_archive_hash_and_size_are_both_required(self):
        for field, value, message in (("sha256", "0" * 64, "SHA256"), ("bytes", 1, "size")):
            with self.subTest(field=field):
                before = copy.deepcopy(self.config)
                self.config["runtimeArchive"][field] = value
                self.save_config()
                self.rejected(message)
                self.config = before

    def test_every_manifest_member_is_verified_including_omitted_host_files(self):
        manifest = {"format": 1, "platform": "windows-x64",
                    "files": {name: digest(data) for name, data in self.payload.items()}}
        for member in ("bin/node.exe", "plugin/agents/host-only.md", "scripts/selfcheck.cjs"):
            with self.subTest(member=member):
                changed = {**self.payload, member: b"corrupt bytes"}
                self.write_runtime(changed, manifest)
                self.rejected("checksum|SHA256")

    def test_missing_extra_and_manifest_self_members_are_rejected(self):
        for change in ("missing", "extra", "self"):
            with self.subTest(change=change):
                files = {name: digest(data) for name, data in self.payload.items()}
                if change == "missing":
                    files["runtime/missing.cjs"] = "0" * 64
                elif change == "extra":
                    del files["plugin/agents/host-only.md"]
                else:
                    files["manifest.json"] = "0" * 64
                self.write_runtime(manifest={"format": 1, "platform": "windows-x64", "files": files})
                self.rejected("file list|manifest")

    def test_unsafe_archive_and_manifest_paths_are_rejected(self):
        for name in ("../escape", "/absolute", "bin/../escape", "bin\\escape", "C:/escape",
                     "bin/node.exe:stream", "bin//escape", "bin/./escape", "bin/trailing.",
                     "bin/CON", "bin/nul\x00hidden"):
            with self.subTest(name=name):
                self.write_runtime({**self.payload, name: b"bad"})
                self.rejected("[Uu]nsafe|[Ii]nvalid")

    def test_duplicate_case_alias_and_file_directory_collisions_are_rejected(self):
        for name in ("bin/node.exe", "BIN/NODE.EXE", "manifest.json", "bin"):
            with self.subTest(name=name):
                self.write_runtime(extra=[(name, b"duplicate or collision")])
                self.rejected("[Dd]uplicate|collision")

    def test_raw_archive_backslashes_are_rejected_even_with_a_safe_manifest(self):
        unsafe = zipfile.ZipInfo("plugin/invalid")
        # ZipInfo normalizes separators on Windows at construction time. Set the
        # serialized name explicitly to exercise the archive path, not just JSON.
        unsafe.filename = "plugin\\invalid"
        self.write_runtime(extra=[(unsafe, b"unsafe path in central/local headers")])
        self.rejected("[Uu]nsafe")

    def test_zip_symlinks_special_files_and_reparse_flags_are_rejected(self):
        for attributes in ((stat.S_IFLNK | 0o777) << 16,
                           (stat.S_IFIFO | 0o644) << 16, (stat.S_IFREG | 0o644) << 16 | 0x400):
            with self.subTest(attributes=attributes):
                link = zipfile.ZipInfo("plugin/omitted-link")
                link.external_attr = attributes
                self.write_runtime(extra=[(link, b"target")])
                self.rejected("[Ll]ink|[Rr]eparse|regular")

    def test_invalid_manifest_hash_and_duplicate_json_keys_are_rejected(self):
        manifest = {"format": 1, "platform": "windows-x64",
                    "files": {name: digest(data) for name, data in self.payload.items()}}
        manifest["files"]["bin/node.exe"] = "not-a-sha256"
        self.write_runtime(manifest=manifest)
        self.rejected("hash|SHA256|checksum")
        self.write_runtime()
        with zipfile.ZipFile(self.runtime, "r") as archive:
            entries = [(i, archive.read(i)) for i in archive.infolist()]
        with zipfile.ZipFile(self.runtime, "w") as archive:
            for info, data in entries:
                if info.filename == "manifest.json":
                    data = b'{"files":{},"files":{}}'
                archive.writestr(info, data)
        self.config["runtimeArchive"].update(
            sha256=digest(self.runtime.read_bytes()), bytes=self.runtime.stat().st_size)
        self.save_config()
        self.rejected("[Dd]uplicate")

    def test_pinned_node_hash_and_runtime_metadata_must_match_config(self):
        for change in ("node hash", "node version", "upstream version", "platform"):
            with self.subTest(change=change):
                config = copy.deepcopy(self.config)
                if change == "node hash":
                    self.config["engine"]["sha256"] = "0" * 64
                elif change == "node version":
                    self.config["engine"]["version"] = "24.11.2"
                elif change == "upstream version":
                    self.config["upstream"]["version"] = "1.61.0"
                else:
                    self.config["platform"] = "linux-x64"
                self.save_config()
                self.rejected("[Ee]ngine|[Nn]ode|[Uu]pstream|[Pp]latform")
                self.config = config

    def test_mirrors_require_exact_file_sets_and_bytes(self):
        mirror = self.root / self.config["sourceSnapshots"]["codex"]
        for name, data in (("references/workflow.md", b"fixture workflow\n"),
                           ("extra.md", b"extra snapshot member")):
            with self.subTest(name=name):
                path = mirror / name
                original = path.read_bytes() if path.exists() else None
                save(path, data)
                self.rejected("snapshots differ")
                if original is None:
                    path.unlink()
                else:
                    path.write_bytes(original)

    def test_snapshot_roots_must_be_relative_and_contained_in_repository(self):
        outside_work = tempfile.TemporaryDirectory(prefix="playwright-outside-", dir=self.root.parent)
        self.addCleanup(outside_work.cleanup)
        outside = Path(outside_work.name)
        original = copy.deepcopy(self.config["sourceSnapshots"])
        shutil.copytree(self.root / original["claude"], outside, dirs_exist_ok=True)
        for client in ("claude", "codex"):
            for value in (str(self.root / original[client]), str(outside),
                          "../" + outside.name):
                with self.subTest(client=client, value=value):
                    self.config["sourceSnapshots"] = {**original, client: value}
                    self.save_config()
                    self.rejected("repository-relative|outside.*ROOT")
        self.config["sourceSnapshots"] = original

    def test_private_component_source_filenames_abort_packaging(self):
        for name in (".env", "settings.local.json", "scripts/.env.local", "scripts/.env.production",
                     "vendor/auth.json", "vendor/Auth.JSON", "local/session.db", "local/session.sqlite",
                     "local/session.sqlite3", "keys/server.pem", "keys/client.key", "keys/CLIENT.KEY",
                     "local/session.db-wal", "local/session.sqlite-shm"):
            with self.subTest(name=name):
                path = self.here / name
                save(path, b"synthetic private data; no credentials")
                self.rejected("Private/user data source")
                path.unlink()

    def test_env_examples_remain_regular_component_sources(self):
        examples = {".env.example": b"PUBLIC_URL=http://127.0.0.1\n",
                    "examples/.env.production.example": b"PUBLIC_URL=\n",
                    "examples/auth.json.example": b"{}\n"}
        for name, data in examples.items():
            save(self.here / name, data)
        record = self.build()
        with zipfile.ZipFile(self.root / "out" / record["archive"]["filename"]) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            for name, data in examples.items():
                self.assertEqual(archive.read(name), data)
                self.assertEqual(manifest["files"][name], digest(data))

    def test_private_files_in_mirrored_skills_also_abort_packaging(self):
        for snapshot in self.config["sourceSnapshots"].values():
            save(self.root / snapshot / "references/auth.json", b"synthetic private config")
        self.rejected("Private/user data source")

    def test_source_collisions_cannot_replace_verified_runtime_or_manifest(self):
        for name in ("bin/node.exe", "RUNTIME-UPSTREAM.json", "manifest.json", "skill/SKILL.md",
                     "SKILL/SKILL.md"):
            with self.subTest(name=name):
                path = self.here / name
                save(path, b"source must not replace verified or generated payload")
                self.rejected("[Dd]uplicate|collision|reserved")
                path.unlink()

    def test_changed_payload_at_recorded_version_preserves_existing_outputs(self):
        record = self.build()
        save(self.release_path(), encoded(record))
        archive_path = self.root / "out" / record["archive"]["filename"]
        outputs = {path: path.read_bytes() for path in (
            archive_path, archive_path.with_suffix(".json"), archive_path.with_suffix(".zip.sha256"))}
        save(self.here / "scripts/manage.cjs", b"changed behavior")
        with self.assertRaisesRegex(ValueError, "Released bytes changed"):
            self.build()
        for path, data in outputs.items():
            self.assertEqual(path.read_bytes(), data)
        self.assertFalse(list((self.root / "out").glob("*.tmp")))

    def test_all_generic_release_identity_fields_are_immutable(self):
        record = self.build()
        for field in ("schemaVersion", "componentId", "componentVersion", "platform",
                      "protocolVersion", "upstream", "engine", "archive", "manifestSha256"):
            with self.subTest(field=field):
                changed = copy.deepcopy(record)
                changed[field] = "changed"
                save(self.release_path(), encoded(changed))
                with self.assertRaisesRegex(ValueError, "Released bytes changed"):
                    self.build("rejected-release")

    def test_download_urls_and_validation_evidence_do_not_change_payload_identity(self):
        record = self.build()
        previous = {**record, "downloadUrls": ["https://example.invalid/real-release.zip"],
                    "validation": "docs/reports/additional-check.md", "evidence": {"check": "local"}}
        save(self.release_path(), encoded(previous))
        self.assertEqual(record, self.build("same-release"))
        self.assertEqual(json.loads(self.release_path().read_bytes()), previous)

    def test_symlink_sources_snapshots_and_archive_are_rejected(self):
        target = self.root / "outside.txt"
        target.write_bytes(b"outside")
        link = self.here / "source-link.txt"
        try:
            link.symlink_to(target)
        except OSError as error:
            code = getattr(error, "winerror", error.errno)
            self.skipTest(f"OS did not permit symlink creation (error {code})")
        self.rejected("[Ll]ink|[Rr]eparse")
        link.unlink()
        snapshot_link = self.root / self.config["sourceSnapshots"]["claude"] / "link.txt"
        snapshot_link.symlink_to(target)
        self.rejected("[Ll]ink|[Rr]eparse")
        snapshot_link.unlink()
        archive_link = self.root / "runtime-link.zip"
        archive_link.symlink_to(self.runtime)
        with self.assertRaisesRegex(ValueError, "[Ll]ink|[Rr]eparse"):
            BUILDER.build(archive_link, self.root / "out", self.root, self.here)

    @unittest.skipUnless(os.name == "nt", "Windows junction check")
    def test_source_directory_and_snapshot_root_junctions_are_rejected(self):
        outside = self.root / "outside"
        outside.mkdir()
        save(outside / "private.txt", b"must not follow junction")
        for link in (self.here / "junction", self.root / "linked-snapshot"):
            with self.subTest(link=link.name):
                run = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(outside)],
                                     capture_output=True, timeout=10)
                self.assertEqual(run.returncode, 0, run.stderr)
                if link.name == "linked-snapshot":
                    original = self.config["sourceSnapshots"]["claude"]
                    self.config["sourceSnapshots"]["claude"] = "linked-snapshot"
                    self.save_config()
                self.rejected("[Ll]ink|[Rr]eparse")
                if link.name == "linked-snapshot":
                    self.config["sourceSnapshots"]["claude"] = "linked-snapshot/../" + original
                    self.save_config()
                    self.rejected("[Ll]ink|[Rr]eparse|repository-relative")
                link.rmdir()

    def test_missing_required_sources_and_invalid_version_do_not_build(self):
        self.config["componentVersion"] = "../1.0.0"
        self.save_config()
        self.rejected("SemVer|version")
        self.config["componentVersion"] = "1.0.0"
        self.save_config()
        for name in ("UPSTREAM.json", "LICENSE", "README.md"):
            with self.subTest(name=name):
                path = self.here / name
                original = path.read_bytes()
                path.unlink()
                with self.assertRaises((ValueError, FileNotFoundError)):
                    self.build()
                path.write_bytes(original)

    def test_cli_requires_explicit_archive_and_has_independent_output_default(self):
        run = subprocess.run([shutil.which("python"), "-B", str(BUILD_PATH)],
                             capture_output=True, timeout=10)
        self.assertEqual(run.returncode, 2)
        self.assertIn(b"--runtime-archive", run.stderr)
        help_run = subprocess.run([shutil.which("python"), "-B", str(BUILD_PATH), "--help"],
                                  capture_output=True, timeout=10)
        self.assertEqual(help_run.returncode, 0)
        self.assertNotIn(b"SwitchAI", help_run.stdout)


if __name__ == "__main__":
    unittest.main()
