"""Exercise a real offline memory worker/MCP without any model turn."""
import argparse
import asyncio
from contextlib import suppress
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.request import urlopen

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def exercise(component, output, scratch_root):
    output.mkdir(parents=True)
    scratch_root.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="memory-smoke-", dir=scratch_root) as temporary:
        root = Path(temporary)
        project, home, codex_home = root / "project", root / "claude", root / "codex"
        for directory in (project, home, codex_home):
            directory.mkdir()
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith(("ANTHROPIC_", "CLAUDE_", "CODEX_", "VAULT_MEMORY_"))}
        env.update(CLAUDE_CONFIG_DIR=str(home), CODEX_HOME=str(codex_home), USERPROFILE=str(root), HOME=str(root),
                   DO_NOT_TRACK="1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1")

        def manage(action, client="claude", install=False):
            args = [str(component / "bin/node.exe"), str(component / "scripts/manage.cjs"), "--action", action,
                    "--client", client, "--project", str(project)]
            if install:
                args += ["--runtime-root", str(root / "cache"), "--data-root", str(root / "private"), "--claude-home", str(home)]
            entry = {"action": action, "client": client, "status": "running"}
            facts.setdefault("commands", []).append(entry)
            (output / "result.json").write_text(json.dumps(facts, indent=2), encoding="utf-8")
            run = subprocess.run(args, cwd=project, env=env, capture_output=True, text=True, encoding="utf-8", timeout=900)
            value = json.loads(run.stdout)
            entry.update(status="passed" if value.get("ok") else "failed", response=value)
            (output / "result.json").write_text(json.dumps(facts, indent=2), encoding="utf-8")
            if run.returncode or not value.get("ok"):
                raise RuntimeError(f"Management {action}/{client}: {value}")
            return value

        facts = {"scope": "real local worker, no model", "output": str(output), "checks": results}
        try:
            for client in ("claude", "codex"):
                manage("install", client, True)
                manage("enable", client)
            results.append("both-clients-installed-and-manual-enabled")
            checked = manage("check")
            assert checked["service"]["modelTurnSubmitted"] is False
            assert manage("status")["service"]["status"] == "stopped"
            results.append("readonly-selfcheck-stops-only-its-worker")
            viewed = manage("viewer")
            running = viewed["service"]
            assert running["observer"] is False
            with urlopen(viewed["viewerUrl"], timeout=10) as response:
                html = response.read().decode("utf-8")
                assert response.status == 200 and "<html" in html.lower()
            results.append("real-viewer-html-and-observer-disabled")
            facts["worker"] = running
            entry = json.loads((project / ".mcp.json").read_text(encoding="utf-8"))["mcpServers"]["vault_memory"]
            params = StdioServerParameters(command=entry["command"], args=entry["args"], env=env, cwd=str(project))
            async with stdio_client(params) as (reader, writer):
                async with ClientSession(reader, writer) as session:
                    await session.initialize()
                    listed = await session.list_tools()
                    names = {tool.name for tool in listed.tools}
                    assert {"save_memory", "search", "get_observations"} <= names, names
                    facts["tools"] = sorted(names)
                    token = "VAULT_MEMORY_SMOKE_20261113"
                    saved = await session.call_tool("save_memory", {"text": token + " reusable synthetic fact", "title": token})
                    assert not saved.isError, saved
                    searched = await session.call_tool("search", {"query": token})
                    assert not searched.isError, searched
                    text = "\n".join(getattr(item, "text", "") for item in searched.content)
                    assert token in text, text
                    (output / "mcp-search.json").write_text(searched.model_dump_json(indent=2), encoding="utf-8")
            results.append("real-mcp-save-and-sqlite-fts-search")
            assert manage("status")["service"]["pid"] == running["pid"]
            results.append("mcp-reuses-owned-project-worker")
            data = Path(running["dataDirectory"])
            databases = list(data.rglob("*.db")) + list(data.rglob("*.sqlite"))
            assert databases, data
            manage("disable", "claude")
            manage("disable", "codex")
            manage("stop")
            assert manage("status")["service"]["status"] == "stopped"
            results.append("both-clients-disabled-and-owned-processes-stopped")
            for client in ("claude", "codex"):
                manage("uninstall", client)
            assert all(file.exists() for file in databases)
            assert not (project / ".mcp.json").exists()
            results.append("uninstall-retains-memory-and-removes-owned-integration")
            facts["ok"] = True
            return facts
        finally:
            # All data/processes here are synthetic and owned by this fixture.
            with suppress(Exception):
                manage("stop")
            (output / "result.json").write_text(json.dumps(facts, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--component", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scratch-root", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(exercise(args.component.resolve(), args.output.resolve(), args.scratch_root.resolve()))))
