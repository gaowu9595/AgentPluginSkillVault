"""Validate component records and an optional offline ZIP without installing."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def local_path(value):
    path = ROOT / value
    path.resolve().relative_to(ROOT)
    if not path.exists():
        raise ValueError(f"Missing repository path: {value}")
    return path


def validate(archive=None):
    artifacts = read(ROOT / "registry/artifacts.json")["artifacts"]
    if len({item["id"] for item in artifacts}) != len(artifacts):
        raise ValueError("Duplicate source artifact ID")
    for item in artifacts:
        path = local_path(item["path"])
        if item["type"].endswith("plugin"):
            expected = item["vaultVersion"] if item["type"] == "codex-plugin" else item["upstreamVersion"]
            if read(path / item["versionSource"])["version"] != expected:
                raise ValueError(f"Plugin version mismatch: {item['id']}")
    catalog = read(ROOT / "registry/components.json")
    if catalog["schemaVersion"] != 1:
        raise ValueError("Unsupported component catalog schema")
    ids, records = set(), []
    for item in catalog["components"]:
        if item["id"] in ids:
            raise ValueError("Duplicate component ID")
        ids.add(item["id"])
        config = read(local_path(item["definition"]))
        if config["componentId"] != item["id"]:
            raise ValueError("Component ID mismatch")
        keys = set()
        for release in item["releases"]:
            key = release["componentVersion"], release["platform"]
            if key in keys or not re.fullmatch(r"\d+\.\d+\.\d+", key[0]):
                raise ValueError("Duplicate or invalid component version")
            keys.add(key)
            expected_path = f"registry/releases/{item['id']}/{key[0]}/{key[1]}.json"
            if release["record"] != expected_path:
                raise ValueError("Unexpected release record path")
            record = read(local_path(release["record"]))
            if (record["componentVersion"], record["platform"]) != key or record["componentId"] != item["id"]:
                raise ValueError("Release identity mismatch")
            if record["schemaVersion"] != 1 or record["protocolVersion"] != 1:
                raise ValueError("Unsupported release schema/protocol")
            for checksum in (record["archive"]["sha256"], record["manifestSha256"], record["engine"]["sha256"]):
                if not re.fullmatch(r"[0-9a-f]{64}", checksum):
                    raise ValueError("Invalid release checksum")
            if record["archive"]["bytes"] <= 0 or record["archive"]["filename"] != f"{item['id']}-{key[0]}-{key[1]}.zip":
                raise ValueError("Invalid archive identity")
            if not record["upstream"]["version"] or not record["engine"]["version"]:
                raise ValueError("Missing pinned version")
            local_path(record["validation"])
            if key[0] == item["recommendedVersion"]:
                for field in ("componentVersion", "upstream", "engine", "protocolVersion", "platform"):
                    if record[field] != config[field]:
                        raise ValueError(f"Recommended release differs from source: {field}")
                for source in config["sourceSnapshots"].values():
                    source_root = local_path(source)
                    for filename, expected in (("SKILL.md", "skillSha256"), ("LICENSE", "licenseSha256")):
                        if hashlib.sha256((source_root / filename).read_bytes()).hexdigest() != config["upstream"][expected]:
                            raise ValueError("Pinned source hash mismatch")
            records.append(record)
        if not any(key[0] == item["recommendedVersion"] for key in keys):
            raise ValueError("Recommended version has no release record")
    if archive:
        matches = [r for r in records if r["archive"]["filename"] == archive.name]
        if len(matches) != 1:
            raise ValueError("Archive must match exactly one release")
        record = matches[0]
        if archive.stat().st_size != record["archive"]["bytes"] or hashlib.sha256(archive.read_bytes()).hexdigest() != record["archive"]["sha256"]:
            raise ValueError("Archive checksum/size mismatch")
        with zipfile.ZipFile(archive) as package:
            manifest_bytes = package.read("manifest.json")
            if hashlib.sha256(manifest_bytes).hexdigest() != record["manifestSha256"]:
                raise ValueError("Manifest checksum mismatch")
            manifest = json.loads(manifest_bytes)
            names = package.namelist()
            if len(names) != len(set(names)) or set(names) != set(manifest["files"]) | {"manifest.json"}:
                raise ValueError("Archive file list mismatch")
            for name, expected in manifest["files"].items():
                if "\\" in name or ":" in name or name.startswith("/") or any(p in ("..", ".") for p in name.split("/")):
                    raise ValueError("Unsafe archive path")
                if hashlib.sha256(package.read(name)).hexdigest() != expected:
                    raise ValueError(f"Archive member checksum mismatch: {name}")
    return {"sourceArtifacts": len(artifacts), "components": len(ids), "releases": len(records),
            "archiveChecked": archive.name if archive else None, "ok": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    print(json.dumps(validate(parser.parse_args().archive)))
