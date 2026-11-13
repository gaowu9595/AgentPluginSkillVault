"""Build an independent Windows claude-mem ZIP offline with fixed DEFLATE level 6."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PureWindowsPath
import re
import stat
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CHUNK = 1024 * 1024
COMPRESSION_LEVEL = 6
RUNTIME_PREFIXES = ("plugin/", "LICENSES/")
RUNTIME_BINARIES = ("bin/node.exe", "bin/bun.exe")
REQUIRED_SOURCES = ("component.json", "UPSTREAM.json", "LICENSE", "NOTICE", "THIRD-PARTY.md",
                    "licenses/SOURCE-REFERENCES.json", "licenses/LGPL-2.0.txt",
                    "licenses/LGPL-2.1.txt", "licenses/LGPL-3.0.txt", "licenses/GPL-2.0.txt",
                    "licenses/GPL-3.0.txt", "licenses/MPL-1.1.txt",
                    "licenses/WebKit-JavaScriptCore-COPYING.LIB",
                    "licenses/libvips-8.18.7-LICENSE.txt", "manage.ps1",
                    "scripts/manage.cjs", "scripts/files.cjs", "scripts/native-config.cjs",
                    "scripts/runtime.cjs", "scripts/bridge.cjs", "scripts/connection.cjs",
                    "scripts/supervisor.ps1",
                    "vendor/smol-toml/index.cjs", "vendor/smol-toml/LICENSE")
GENERATED_DIRS = {"__pycache__", ".git", ".cache", ".pytest_cache", ".ui_test",
                  "build", "dist", "node_modules"}
IMMUTABLE_FIELDS = ("schemaVersion", "componentId", "componentVersion", "platform",
                    "protocolVersion", "upstream", "engine", "dependencies", "profile",
                    "runtimeArchive", "dependencyLockSha256", "archive", "manifestSha256")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stream_digest(stream):
    checksum = hashlib.sha256()
    while chunk := stream.read(CHUNK):
        checksum.update(chunk)
    return checksum.hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(data):
    return json.loads(data, object_pairs_hook=unique_pairs)


def check_path(path):
    """Check before resolving so directory junctions cannot hide source links."""
    path = Path(path).absolute()
    for part in reversed((path, *path.parents)):
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError(f"Links/reparse points are not allowed: {part}")
    return path.lstat()


def safe_name(name):
    parts = name.split("/")
    if (not name or any(c in name for c in '\\:<>"|?*') or any(ord(c) < 32 for c in name)
            or any(p in ("", ".", "..") or p.endswith((".", " ")) for p in parts)
            or any(re.fullmatch(r"CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3]",
                                p.split(".")[0].rstrip(" "), re.I)
                   for p in parts)):
        raise ValueError(f"Unsafe member path: {name!r}")
    return name


def check_names(names):
    seen = set()
    for name in names:
        key = safe_name(name).casefold()
        if key in seen:
            raise ValueError(f"Duplicate member/path collision: {name}")
        seen.add(key)
    for name in seen:
        parts = name.split("/")
        if any("/".join(parts[:i]) in seen for i in range(1, len(parts))):
            raise ValueError(f"File/directory path collision: {name}")


def snapshot_path(root, relative):
    message = "Source snapshots must be repository-relative paths within ROOT"
    if (not isinstance(relative, str) or not relative or PureWindowsPath(relative).drive
            or PureWindowsPath(relative).root):
        raise ValueError(message)
    try:
        safe_name(relative)
    except ValueError as error:
        raise ValueError(message) from error
    path = root / relative
    check_path(path)
    try:
        path.resolve(strict=True).relative_to(root.resolve(strict=True))
    except ValueError as error:
        raise ValueError("Source snapshot resolves outside ROOT") from error
    return path


def check_source_name(relative):
    name = relative.rsplit("/", 1)[-1].casefold()
    private_env = (name == ".env" or name.startswith(".env.")) and not name.endswith(".example")
    while re.search(r"\.(?:bak|backup|old|orig|tmp)$|~$", name):
        name = re.sub(r"\.(?:bak|backup|old|orig|tmp)$|~$", "", name)
    if (private_env or name in ("auth.json", "settings.local.json")
            or re.search(r"\.(?:db|sqlite3?)(?:-(?:wal|shm|journal))?$|\.(?:pem|key)$", name)):
        raise ValueError(f"Private/user data source file is not allowed: {relative}")


def tree(root, component=False, excluded=None):
    if not stat.S_ISDIR(check_path(root).st_mode):
        raise ValueError(f"Source directory required: {root}")
    result = {}

    def visit(directory):
        for path in sorted(directory.iterdir()):
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
                raise ValueError(f"Links/reparse points are not allowed: {path}")
            if excluded is not None and path == excluded:
                continue
            relative = path.relative_to(root).as_posix()
            if stat.S_ISDIR(info.st_mode):
                if path.name not in GENERATED_DIRS:
                    visit(path)
            elif stat.S_ISREG(info.st_mode):
                if component and (relative == "build.py" or path.suffix in (".pyc", ".pyo")):
                    continue
                check_source_name(relative)
                if component and relative.split("/", 1)[0].casefold() in ("bin", "plugin", "skill"):
                    raise ValueError(f"Component source uses a reserved runtime/Skill namespace: {relative}")
                result[safe_name(relative)] = path
            else:
                raise ValueError(f"Source must be a regular file: {path}")

    visit(root)
    check_names(result)
    return result


def equal_files(left, right):
    with left.open("rb") as a, right.open("rb") as b:
        while True:
            chunk = a.read(CHUNK)
            if chunk != b.read(CHUNK):
                return False
            if not chunk:
                return True


def check_config(config):
    if not re.fullmatch(r"\d+\.\d+\.\d+", config["componentVersion"]):
        raise ValueError("A component SemVer is required")
    if config["componentId"] != "claude-mem":
        raise ValueError("Unexpected component identity")
    if config["platform"] != "windows-x64":
        raise ValueError("Platform must be windows-x64")
    if config["schemaVersion"] != 1 or config["protocolVersion"] != 1:
        raise ValueError("Unsupported schema/protocol version")
    for checksum in (config["runtimeArchive"]["sha256"], config["engine"]["sha256"],
                     config["dependencies"]["bun"]["sha256"], config["dependencyLockSha256"],
                     config["upstream"]["noticeSha256"]):
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ValueError("A pinned SHA256 is required")
    if type(config["runtimeArchive"]["bytes"]) is not int or config["runtimeArchive"]["bytes"] <= 0:
        raise ValueError("A pinned runtime archive size is required")
    if not re.fullmatch(r"[0-9a-f]{40}", config["upstream"]["commit"]):
        raise ValueError("A pinned upstream commit is required")


def verify_runtime(package, config):
    infos = package.infolist()
    for info in infos:
        safe_name(info.orig_filename)
        if info.orig_filename != info.filename:
            raise ValueError("Unsafe truncated archive path")
        kind = stat.S_IFMT(info.external_attr >> 16)
        if info.external_attr & 0x400:
            raise ValueError(f"Archive reparse flags are not allowed: {info.filename}")
        if info.is_dir() or info.external_attr & 0x10 or kind not in (0, stat.S_IFREG):
            raise ValueError(f"Archive member must be a regular file (no links): {info.filename}")
        if info.flag_bits & 1:
            raise ValueError("Encrypted runtime members are not supported")
    check_names(info.filename for info in infos)
    entries = {info.filename: info for info in infos}
    if "manifest.json" not in entries:
        raise ValueError("Runtime manifest is missing")
    manifest = read_json(package.read(entries["manifest.json"]))
    if not isinstance(manifest, dict):
        raise ValueError("Invalid runtime manifest")
    if manifest.get("format") != 1 or manifest.get("platform") != config["platform"]:
        raise ValueError("Runtime manifest format/platform mismatch")
    if manifest.get("version") != config["upstream"]["version"]:
        raise ValueError("Runtime manifest upstream version mismatch")
    if manifest.get("profile") != config["profile"]:
        raise ValueError("Runtime manifest profile mismatch")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ValueError("Invalid runtime manifest file list")
    check_names(files)
    if "manifest.json" in files or set(entries) != set(files) | {"manifest.json"}:
        raise ValueError("Runtime manifest file list mismatch")
    for name, expected in files.items():
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise ValueError(f"Invalid manifest SHA256: {name}")
        with package.open(entries[name]) as stream:
            if stream_digest(stream) != expected:
                raise ValueError(f"Runtime member checksum mismatch: {name}")
    if files.get("bin/node.exe") != config["engine"]["sha256"]:
        raise ValueError("Node engine SHA256 does not match the pinned release")
    if files.get("bin/bun.exe") != config["dependencies"]["bun"]["sha256"]:
        raise ValueError("Bun SHA256 does not match the pinned release")
    if files.get("plugin/package-lock.json") != config["dependencyLockSha256"]:
        raise ValueError("Runtime dependency lock SHA256 mismatch")
    required = ("UPSTREAM.json", "LICENSES/claude-mem.txt", "LICENSES/node.txt", "LICENSES/bun.txt",
                "plugin/.claude-plugin/plugin.json")
    if any(name not in entries for name in required):
        raise ValueError("Runtime upstream provenance/license is missing")
    upstream = read_json(package.read(entries["UPSTREAM.json"]))
    for field in ("repository", "commit"):
        if upstream.get(field) != config["upstream"][field]:
            raise ValueError(f"Runtime upstream {field} mismatch")
    expected = {"nodeVersion": config["engine"]["version"],
                "bunVersion": config["dependencies"]["bun"]["version"],
                "pluginVersion": config["upstream"]["version"], "profile": config["profile"],
                "dependencyLockSha256": config["dependencyLockSha256"]}
    for field, value in expected.items():
        if upstream.get(field) != value:
            raise ValueError(f"Runtime upstream {field} mismatch")
    plugin = read_json(package.read(entries["plugin/.claude-plugin/plugin.json"]))
    for field in ("version", "license"):
        if plugin.get(field) != config["upstream"][field]:
            raise ValueError(f"Runtime plugin upstream {field} mismatch")
    return entries, files


def open_payload(source, package):
    if isinstance(source, bytes):
        return io.BytesIO(source)
    if isinstance(source, zipfile.ZipInfo):
        return package.open(source)
    if not stat.S_ISREG(check_path(source).st_mode):
        raise ValueError(f"Source must be a regular file: {source}")
    return source.open("rb")


def temporary_path(output, name):
    descriptor, filename = tempfile.mkstemp(prefix="." + name + "-", suffix=".tmp", dir=output)
    os.close(descriptor)
    return Path(filename)


def build(runtime_archive, output, root=ROOT, here=HERE):
    root, here = Path(root).absolute(), Path(here).absolute()
    runtime_archive, output = Path(runtime_archive).absolute(), Path(output).absolute()
    check_path(here / "component.json")
    config = read_json((here / "component.json").read_bytes())
    check_config(config)
    sources = tree(here, component=True, excluded=output)
    for name in REQUIRED_SOURCES:
        if name not in sources:
            raise ValueError(f"Required component source is missing: {name}")
    with sources["NOTICE"].open("rb") as notice:
        if stream_digest(notice) != config["upstream"]["noticeSha256"]:
            raise ValueError("NOTICE SHA256 does not match the pinned upstream attribution")
    snapshots = [tree(snapshot_path(root, config["sourceSnapshots"][client]))
                 for client in ("claude", "codex")]
    if (not snapshots[0] or "SKILL.md" not in snapshots[0] or snapshots[0].keys() != snapshots[1].keys()
            or any(not equal_files(path, snapshots[1][name]) for name, path in snapshots[0].items())):
        raise ValueError("Claude and Codex source snapshots differ")
    info = check_path(runtime_archive)
    if not stat.S_ISREG(info.st_mode):
        raise ValueError("Runtime archive must be a regular file")
    if info.st_size != config["runtimeArchive"]["bytes"]:
        raise ValueError("Runtime archive size does not match the pinned release")
    with runtime_archive.open("rb") as raw:
        if stream_digest(raw) != config["runtimeArchive"]["sha256"]:
            raise ValueError("Runtime archive SHA256 does not match the pinned release")
        raw.seek(0)
        with zipfile.ZipFile(raw) as package:
            runtime, runtime_hashes = verify_runtime(package, config)
            payload = {name: entry for name, entry in runtime.items()
                       if name.startswith(RUNTIME_PREFIXES) or name in RUNTIME_BINARIES}
            generated = {"RUNTIME-UPSTREAM.json": runtime["UPSTREAM.json"]}
            skills = {"skill/" + name: path for name, path in snapshots[0].items()}
            check_names([*payload, *generated, *sources, *skills, "manifest.json"])
            payload.update(generated)
            payload.update(sources)
            payload.update(skills)
            hashes = {}
            for name, source in sorted(payload.items()):
                if isinstance(source, zipfile.ZipInfo):
                    hashes[name] = runtime_hashes[source.filename]
                else:
                    with open_payload(source, package) as stream:
                        hashes[name] = stream_digest(stream)
            manifest_bytes = json_bytes({**config, "files": hashes})
            payload["manifest.json"] = manifest_bytes
            hashes["manifest.json"] = digest(manifest_bytes)
            output.mkdir(parents=True, exist_ok=True)
            check_path(output)
            name = f"{config['componentId']}-{config['componentVersion']}-{config['platform']}.zip"
            archive = output / name
            temporary = temporary_path(output, name)
            sidecars = []
            try:
                with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED,
                                     compresslevel=COMPRESSION_LEVEL) as destination:
                    for filename, source in sorted(payload.items()):
                        entry = zipfile.ZipInfo(filename, (2020, 1, 1, 0, 0, 0))
                        entry.create_system = 3
                        entry.external_attr = 0o100644 << 16
                        entry.compress_type = zipfile.ZIP_DEFLATED
                        entry._compresslevel = COMPRESSION_LEVEL
                        checksum = hashlib.sha256()
                        with open_payload(source, package) as incoming, destination.open(entry, "w") as outgoing:
                            while chunk := incoming.read(CHUNK):
                                checksum.update(chunk)
                                outgoing.write(chunk)
                        if checksum.hexdigest() != hashes[filename]:
                            raise ValueError(f"Payload changed while building: {filename}")
                with temporary.open("rb") as stream:
                    checksum = stream_digest(stream)
                record = {
                    "schemaVersion": config["schemaVersion"],
                    "componentId": config["componentId"],
                    "componentVersion": config["componentVersion"],
                    "platform": config["platform"],
                    "protocolVersion": config["protocolVersion"],
                    "upstream": config["upstream"],
                    "engine": config["engine"],
                    "dependencies": config["dependencies"],
                    "profile": config["profile"],
                    "runtimeArchive": config["runtimeArchive"],
                    "dependencyLockSha256": config["dependencyLockSha256"],
                    "archive": {"filename": name, "bytes": temporary.stat().st_size, "sha256": checksum},
                    "manifestSha256": digest(manifest_bytes),
                    "downloadUrls": [],
                    "validation": "docs/reports/2026-11-13-claude-mem-independent.md",
                }
                release = (root / "registry/releases" / config["componentId"] /
                           config["componentVersion"] / (config["platform"] + ".json"))
                if release.exists():
                    check_path(release)
                    previous = read_json(release.read_bytes())
                    if any(previous.get(field) != record[field] for field in IMMUTABLE_FIELDS):
                        raise ValueError("Released bytes changed; bump componentVersion instead of overwriting")
                for target, data in ((archive.with_suffix(".zip.sha256"),
                                      (checksum + "  " + name + "\n").encode("ascii")),
                                     (archive.with_suffix(".json"), json_bytes(record))):
                    staged = temporary_path(output, target.name)
                    sidecars.append((staged, target))
                    staged.write_bytes(data)
                temporary.replace(archive)
                for staged, target in sidecars:
                    staged.replace(target)
                return record
            finally:
                temporary.unlink(missing_ok=True)
                for staged, _ in sidecars:
                    staged.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-archive", type=Path, required=True,
                        help="Explicit path to the verified, prepared runtime ZIP")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/components/claude-mem")
    args = parser.parse_args()
    print(json.dumps(build(args.runtime_archive, args.output), ensure_ascii=False))
