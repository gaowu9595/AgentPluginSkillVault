"""Build a pinned, self-contained Windows component without network access."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def tree(root):
    result = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or getattr(path.stat(), "st_file_attributes", 0) & 0x400:
            raise ValueError(f"Links are not allowed: {path.name}")
        if path.is_file():
            result[path.relative_to(root).as_posix()] = path.read_bytes()
    return result


def build(engine, output, root=ROOT, here=HERE):
    config = json.loads((here / "component.json").read_text(encoding="utf-8"))
    if not re.fullmatch(r"\d+\.\d+\.\d+", config["componentVersion"]):
        raise ValueError("A component SemVer is required")
    snapshots = [tree(root / p) for p in config["sourceSnapshots"].values()]
    if snapshots[0] != snapshots[1]:
        raise ValueError("Claude and Codex upstream snapshots differ")
    source = snapshots[0]
    for name, expected in (("SKILL.md", "skillSha256"), ("LICENSE", "licenseSha256")):
        if digest(source[name]) != config["upstream"][expected]:
            raise ValueError(f"Pinned upstream {name} does not match")
    if source["scripts/VERSION"].decode().strip() != config["engine"]["version"]:
        raise ValueError("Launcher and engine versions differ")
    if engine.is_symlink() or getattr(engine.stat(), "st_file_attributes", 0) & 0x400:
        raise ValueError("Engine links are not allowed")
    binary = engine.read_bytes()
    if digest(binary) != config["engine"]["sha256"]:
        raise ValueError("Engine SHA256 does not match the pinned release")
    files = {"skill/" + name: data for name, data in source.items()}
    files["skill/scripts/bin/windows-x64/impeccable.exe"] = binary
    for name in ("manage.ps1", "README.md", "component.json"):
        files[name] = (here / name).read_bytes()
    manifest = {**config, "files": {name: digest(data) for name, data in sorted(files.items())}}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    files["manifest.json"] = manifest_bytes
    output.mkdir(parents=True, exist_ok=True)
    name = f"impeccable-{config['componentVersion']}-{config['platform']}.zip"
    archive = output / name
    temporary = archive.with_suffix(".zip.tmp")
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as package:
            for filename, data in sorted(files.items()):
                entry = zipfile.ZipInfo(filename, (2020, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                package.writestr(entry, data, compresslevel=9)
        checksum = digest(temporary.read_bytes())
        record = {
            "schemaVersion": 1,
            "componentId": config["componentId"],
            "componentVersion": config["componentVersion"],
            "platform": config["platform"],
            "protocolVersion": config["protocolVersion"],
            "upstream": config["upstream"],
            "engine": config["engine"],
            "archive": {"filename": name, "bytes": temporary.stat().st_size, "sha256": checksum},
            "manifestSha256": digest(manifest_bytes),
            "downloadUrls": [],
            "validation": "docs/reports/2026-11-13-impeccable-component.md",
        }
        release_path = root / "registry/releases/impeccable" / config["componentVersion"] / (config["platform"] + ".json")
        if release_path.exists():
            previous = json.loads(release_path.read_text(encoding="utf-8"))
            if previous["archive"] != record["archive"] or previous["manifestSha256"] != record["manifestSha256"]:
                raise ValueError("Released bytes changed; bump componentVersion instead of overwriting")
        temporary.replace(archive)
        archive.with_suffix(".zip.sha256").write_text(checksum + "  " + name + "\n", encoding="ascii")
        archive.with_suffix(".json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return record
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, required=True, help="Verified upstream native executable")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/components/impeccable")
    args = parser.parse_args()
    print(json.dumps(build(args.engine, args.output), ensure_ascii=False))
