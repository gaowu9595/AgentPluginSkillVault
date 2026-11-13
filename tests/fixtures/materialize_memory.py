"""Materialize verified developer payload without a ZIP/release claim."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("memory_builder", ROOT / "components/claude-mem/build.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


def materialize(archive, output):
    here = ROOT / "components/claude-mem"
    config = BUILDER.read_json((here / "component.json").read_bytes())
    BUILDER.check_config(config)
    BUILDER.check_path(archive)
    if output.exists():
        raise ValueError("Choose a new output directory; existing data is never replaced")
    BUILDER.check_path(next(parent for parent in output.parents if parent.exists()))
    if archive.stat().st_size != config["runtimeArchive"]["bytes"]:
        raise ValueError("Prepared archive size mismatch")
    with archive.open("rb") as stream:
        if BUILDER.stream_digest(stream) != config["runtimeArchive"]["sha256"]:
            raise ValueError("Prepared archive checksum mismatch")
    sources = BUILDER.tree(here, component=True)
    snapshots = [BUILDER.tree(BUILDER.snapshot_path(ROOT, config["sourceSnapshots"][client])) for client in ("claude", "codex")]
    if snapshots[0].keys() != snapshots[1].keys() or any(not BUILDER.equal_files(p, snapshots[1][n]) for n, p in snapshots[0].items()):
        raise ValueError("Client Skill snapshots differ")
    with zipfile.ZipFile(archive) as package:
        entries, _ = BUILDER.verify_runtime(package, config)
        payload = {n: p for n, p in entries.items() if n.startswith(BUILDER.RUNTIME_PREFIXES) or n in BUILDER.RUNTIME_BINARIES}
        payload["RUNTIME-UPSTREAM.json"] = entries["UPSTREAM.json"]
        skills = {"skill/" + n: p for n, p in snapshots[0].items()}
        BUILDER.check_names([*payload, *sources, *skills, "manifest.json"])
        payload.update(sources)
        payload.update(skills)
        output.mkdir(parents=True)
        BUILDER.check_path(output)
        hashes = {}
        for name, source in sorted(payload.items()):
            destination = output / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with BUILDER.open_payload(source, package) as incoming, destination.open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
            with destination.open("rb") as copied:
                hashes[name] = BUILDER.stream_digest(copied)
        (output / "manifest.json").write_bytes(BUILDER.json_bytes({**config, "files": hashes}))
    return {"ok": True, "kind": "developer-staging-not-release", "output": str(output), "files": len(hashes)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(materialize(args.runtime_archive.absolute(), args.output.absolute())))
