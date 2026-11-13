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
from unittest import mock
import warnings
import zipfile


ROOT = Path(__file__).resolve().parents[1]
BUILD_PATH = ROOT / "components/claude-mem/build.py"
SPEC = importlib.util.spec_from_file_location("memory_build", BUILD_PATH)
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


class MemoryBuildTests(unittest.TestCase):
    def setUp(self):
        # Keep rename-sensitive tests on the repository's volume, not system TEMP.
        temporary_root = ROOT / ".ui_test/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.work = tempfile.TemporaryDirectory(prefix="memory-build-", dir=temporary_root)
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.here = self.root / "components/claude-mem"
        self.runtime = self.root / "prepared runtime.zip"
        self.config = {
            "schemaVersion": 1,
            "protocolVersion": 1,
            "componentId": "claude-mem",
            "componentVersion": "1.0.0",
            "platform": "windows-x64",
            "engine": {"version": "24.11.1", "sha256": digest(b"fixture node")},
            "dependencies": {"bun": {"version": "1.4.4", "sha256": digest(b"fixture bun")}},
            "profile": "sqlite-fts",
            "dependencyLockSha256": digest(b"fixture dependency lock"),
            "runtimeArchive": {"filename": self.runtime.name, "sha256": "", "bytes": 0},
            "upstream": {
                "repository": "https://github.com/thedotmack/claude-mem",
                "version": "15.17.0", "license": "Apache-2.0",
                "commit": "6b779c06796138aeb4b0ee2fa7dbd25912e4f7fb",
                "noticeSha256": digest(b"fixture upstream attribution notice\n"),
            },
            "sourceSnapshots": {
                "claude": "claude-code/skills/vault-memory/1.0.0",
                "codex": "codex/skills/vault-memory/1.0.0",
            },
        }
        self.upstream = {
            **self.config["upstream"],
            "nodeVersion": "24.11.1",
            "bunVersion": "1.4.4",
            "pluginVersion": "15.17.0",
            "profile": "sqlite-fts",
            "dependencyLockSha256": self.config["dependencyLockSha256"],
            "adaptation": ["Original host plugin metadata must remain intact."],
        }
        self.payload = {
            "bin/node.exe": b"fixture node",
            "bin/bun.exe": b"fixture bun",
            "bin/claude-mem.exe": b"host-specific launcher; must be omitted",
            "plugin/.claude-plugin/plugin.json": encoded({"version": "15.17.0", "license": "Apache-2.0"}),
            "plugin/package-lock.json": b"fixture dependency lock",
            "plugin/scripts/worker-service.cjs": b"fixture worker; not executable",
            "plugin/node_modules/fixture/dist/code.cjs": b"preserve upstream nested generated-looking paths",
            "LICENSES/claude-mem.txt": b"Apache License\nVersion 2.0\nfixture license\n",
            "LICENSES/node.txt": b"fixture Node license",
            "LICENSES/bun.txt": b"fixture Bun license",
            "UPSTREAM.json": encoded(self.upstream),
            "other/omitted.txt": b"unselected archive content; still verify",
        }
        self.sources = {
            "manage.ps1": b"# synthetic adapter\n",
            "README.md": b"Synthetic component\n",
            "LICENSE": b"Apache-2.0 fixture component source license\n",
            "NOTICE": b"fixture upstream attribution notice\n",
            "THIRD-PARTY.md": b"fixture third-party license/source/relink references\n",
            "licenses/SOURCE-REFERENCES.json": encoded({"fixture": "synthetic source references"}),
            "licenses/LGPL-2.0.txt": b"fixture LGPL-2.0 full text placeholder\n",
            "licenses/LGPL-2.1.txt": b"fixture LGPL-2.1 full text placeholder\n",
            "licenses/LGPL-3.0.txt": b"fixture LGPL-3.0 full text placeholder\n",
            "licenses/GPL-2.0.txt": b"fixture GPL-2.0 full text placeholder\n",
            "licenses/GPL-3.0.txt": b"fixture GPL-3.0 full text placeholder\n",
            "licenses/MPL-1.1.txt": b"fixture MPL-1.1 full text placeholder\n",
            "licenses/WebKit-JavaScriptCore-COPYING.LIB": b"fixture WebKit license placeholder\n",
            "licenses/libvips-8.18.7-LICENSE.txt": b"fixture libvips license placeholder\n",
            "licenses/bun/LGPL-2.1.txt": b"fixture LGPL text; not a legal completeness claim\n",
            "licenses/sharp/source-and-relink.md": b"fixture source and relink references\n",
            "UPSTREAM.json": b'{"adapter":"separate Vault adapter"}\n',
            "scripts/manage.cjs": b"// synthetic manager\n",
            "scripts/supervisor.ps1": b"# synthetic owned worker supervisor\n",
            "scripts/nested/helper.cjs": b"// nested adapter\n",
            "vendor/smol-toml/index.cjs": b"// vendored parser\n",
            "vendor/smol-toml/LICENSE": b"fixture BSD-3-Clause\n",
            "extra/source.txt": b"include regular source files recursively\n",
        }
        for name in ("files", "native-config", "runtime", "bridge", "connection"):
            self.sources[f"scripts/{name}.cjs"] = b"// synthetic adapter source\n"
        for name, data in self.sources.items():
            save(self.here / name, data)
        save(self.here / "build.py", b"must not ship builder\n")
        for name in ("__pycache__/junk.pyc", "dist/old.zip", "build/generated.txt"):
            save(self.here / name, b"generated; do not ship")
        for snapshot in self.config["sourceSnapshots"].values():
            save(self.root / snapshot / "SKILL.md", b"---\nname: vault-memory\n---\n")
            save(self.root / snapshot / "LICENSE", self.sources["LICENSE"])
            save(self.root / snapshot / "references/workflow.md", b"fixture workflow\r\n")
        self.write_runtime()

    def write_runtime(self, payload=None, manifest=None, extra=()):
        payload = self.payload if payload is None else payload
        if manifest is None:
            manifest = {
                "format": 1, "platform": "windows-x64", "version": "15.17.0", "profile": "sqlite-fts",
                "files": {name: digest(data) for name, data in payload.items()},
            }
        else:
            manifest = {"version": "15.17.0", "profile": "sqlite-fts", **manifest}
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
        self.assertIsNotNone(BUILDER, "Task 2 requires the independent memory builder")
        return BUILDER.build(self.runtime, self.root / output, self.root, self.here)

    def rejected(self, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            self.build()
        self.assertFalse(list((self.root / "out").glob("*.zip")))

    def release_path(self):
        return self.root / "registry/releases/claude-mem/1.0.0/windows-x64.json"

    def test_payload_selection_sources_manifest_and_provenance(self):
        record = self.build()
        name = record["archive"]["filename"]
        archive_path = self.root / "out" / name
        expected_runtime = {name: data for name, data in self.payload.items()
                            if name.startswith(("plugin/", "LICENSES/")) or name in ("bin/node.exe", "bin/bun.exe")}
        expected = {
            **expected_runtime, **self.sources,
            "component.json": encoded(self.config),
            "RUNTIME-UPSTREAM.json": self.payload["UPSTREAM.json"],
            "skill/SKILL.md": b"---\nname: vault-memory\n---\n",
            "skill/LICENSE": self.sources["LICENSE"],
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
        self.assertEqual(record["validation"], "docs/reports/2026-11-13-claude-mem-independent.md")
        self.assertEqual(record["downloadUrls"], [])
        for field in ("schemaVersion", "componentId", "componentVersion", "platform",
                      "protocolVersion", "upstream", "engine", "dependencies", "profile",
                      "runtimeArchive", "dependencyLockSha256"):
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

    def test_missing_notice_and_supplemental_license_sources_do_not_publish(self):
        names = ["NOTICE", "THIRD-PARTY.md", "licenses/SOURCE-REFERENCES.json",
                 "licenses/LGPL-2.0.txt", "licenses/LGPL-2.1.txt", "licenses/LGPL-3.0.txt",
                 "licenses/GPL-2.0.txt", "licenses/GPL-3.0.txt", "licenses/MPL-1.1.txt",
                 "licenses/WebKit-JavaScriptCore-COPYING.LIB", "licenses/libvips-8.18.7-LICENSE.txt"]
        for name in names:
            with self.subTest(source=name):
                target = self.here / name
                target.unlink()
                try:
                    self.rejected("Required component source is missing: " + name)
                finally:
                    save(target, self.sources[name])

    def test_changed_notice_cannot_publish_against_pinned_upstream_hash(self):
        save(self.here / "NOTICE", b"changed or truncated upstream attribution\n")
        self.rejected("NOTICE SHA256")

    def test_every_manifest_member_is_verified_including_omitted_host_files(self):
        manifest = {"format": 1, "platform": "windows-x64",
                    "files": {name: digest(data) for name, data in self.payload.items()}}
        for member in ("bin/node.exe", "bin/bun.exe", "plugin/scripts/worker-service.cjs",
                       "bin/claude-mem.exe", "other/omitted.txt"):
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
                    del files["bin/claude-mem.exe"]
                else:
                    files["manifest.json"] = "0" * 64
                self.write_runtime(manifest={"format": 1, "platform": "windows-x64", "files": files})
                self.rejected("file list|manifest")

    def test_required_runtime_provenance_binaries_lock_and_licenses_cannot_be_missing(self):
        for member in ("UPSTREAM.json", "bin/node.exe", "bin/bun.exe", "plugin/package-lock.json",
                       "plugin/.claude-plugin/plugin.json", "LICENSES/claude-mem.txt",
                       "LICENSES/node.txt", "LICENSES/bun.txt"):
            with self.subTest(member=member):
                self.write_runtime({name: data for name, data in self.payload.items() if name != member})
                self.rejected("missing|SHA256")

    def test_plugin_declared_license_must_match_the_component_provenance(self):
        payload = {**self.payload, "plugin/.claude-plugin/plugin.json":
                   encoded({"version": "15.17.0", "license": "different-license"})}
        self.write_runtime(payload)
        self.rejected("upstream license mismatch")

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
        for change in ("node hash", "node version", "bun hash", "bun version", "upstream version",
                       "commit", "lock", "profile", "platform"):
            with self.subTest(change=change):
                config = copy.deepcopy(self.config)
                if change == "node hash":
                    self.config["engine"]["sha256"] = "0" * 64
                elif change == "node version":
                    self.config["engine"]["version"] = "24.11.2"
                elif change == "upstream version":
                    self.config["upstream"]["version"] = "15.18.0"
                elif change == "bun hash":
                    self.config["dependencies"]["bun"]["sha256"] = "0" * 64
                elif change == "bun version":
                    self.config["dependencies"]["bun"]["version"] = "1.4.5"
                elif change == "commit":
                    self.config["upstream"]["commit"] = "0" * 40
                elif change == "lock":
                    self.config["dependencyLockSha256"] = "0" * 64
                elif change == "profile":
                    self.config["profile"] = "changed-profile"
                else:
                    self.config["platform"] = "linux-x64"
                self.save_config()
                self.rejected("[Ee]ngine|[Nn]ode|[Bb]un|[Uu]pstream|[Pp]latform|[Pp]rofile|[Ll]ock")
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
        outside_work = tempfile.TemporaryDirectory(prefix="memory-outside-", dir=self.root.parent)
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

    def test_review_source_namespaces_cannot_extend_verified_runtime_or_skill(self):
        for name in ("bin/claude-mem.exe", "bin/other.exe", "plugin/injected.cjs",
                     "skill/unmirrored.md", "SKILL/unmirrored.md"):
            with self.subTest(name=name):
                path = self.here / name
                save(path, b"synthetic injection into an owned runtime or Skill namespace")
                self.rejected("reserved|collision")
                path.unlink()

    def test_review_private_file_backups_are_rejected(self):
        for name in ("auth.json.bak", "settings.local.json.backup", "session.sqlite.old",
                     "session.db-wal.bak", "private.key~", "private.pem.orig", "AUTH.JSON.tmp"):
            with self.subTest(name=name):
                path = self.here / "local" / name
                save(path, b"synthetic private backup; no credentials")
                self.rejected("Private/user data source")
                path.unlink()

    def test_review_windows_invalid_names_and_device_aliases_are_rejected(self):
        for name in ('plugin/a?b', 'plugin/a*b', 'plugin/a|b', 'plugin/a"b', 'plugin/a<b',
                     'plugin/CONIN$', 'plugin/CONOUT$', 'plugin/COM\u00b9.txt', 'plugin/CON .txt'):
            with self.subTest(name=name):
                self.write_runtime({**self.payload, name: b"synthetic unusable Windows path"})
                self.rejected("[Uu]nsafe")

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

    def test_source_mutation_during_packaging_aborts_without_publishing(self):
        source = self.here / "scripts/connection.cjs"
        original_open = BUILDER.open_payload
        reads = 0

        def changing_source(item, package):
            nonlocal reads
            if item == source:
                reads += 1
                if reads == 2:
                    source.write_bytes(b"changed after manifest hash; do not publish")
            return original_open(item, package)

        with mock.patch.object(BUILDER, "open_payload", side_effect=changing_source):
            self.rejected("Payload changed while building")
        self.assertFalse(list((self.root / "out").glob("*.tmp")))
        self.assertFalse(list((self.root / "out").glob("*.json")))

    def test_all_generic_release_identity_fields_are_immutable(self):
        record = self.build()
        for field in ("schemaVersion", "componentId", "componentVersion", "platform",
                      "protocolVersion", "upstream", "engine", "archive", "manifestSha256",
                      "dependencies", "profile", "runtimeArchive", "dependencyLockSha256"):
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
        for name in ("UPSTREAM.json", "LICENSE", "manage.ps1", "scripts/manage.cjs",
                     "scripts/connection.cjs", "scripts/supervisor.ps1", "vendor/smol-toml/LICENSE"):
            with self.subTest(name=name):
                path = self.here / name
                original = path.read_bytes()
                path.unlink()
                self.rejected("Required component source is missing: " + name)
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
