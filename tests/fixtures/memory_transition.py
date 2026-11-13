"""Verify one real MCP session survives a reader-to-observer worker upgrade."""

import argparse
import asyncio
from datetime import timedelta
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
import mcp.types as types

from memory_capture import Commands, absolute, digest, write_json


async def exercise(args):
    if sys.platform != "win32":
        raise RuntimeError("This fixture validates the Windows owned-worker lifecycle")
    component, output = args.component, args.output
    output.mkdir(parents=True, exist_ok=False)
    report = {
        "passed": False, "kind": "developer-persistent-mcp-worker-transition",
        "component": str(component), "fixtureSha256": digest(Path(__file__)),
        "modelTurnSubmitted": False, "liveModelRequests": 0, "hooksInvoked": False,
        "mcpTransportStarts": 0, "mcpInitializations": 0, "toolCalls": [],
        "scope": "real upstream MCP and Worker; synthetic native settings; no install or model calls",
    }
    commands = None
    options = None
    started = time.monotonic()
    try:
        if any((parent / ".git").exists() for parent in (args.scratch_root, *args.scratch_root.parents)):
            raise ValueError("Private scratch root must be outside Git")
        manifest_path = component / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        manifest_hash = digest(manifest_path)
        stamp = json.loads((component / ".vault-runtime.json").read_text(encoding="utf-8-sig"))
        if (stamp.get("owner") != "AgentPluginSkillVault" or stamp.get("componentId") != "claude-mem"
                or stamp.get("componentVersion") != manifest.get("componentVersion")
                or stamp.get("manifestSha256") != manifest_hash):
            raise ValueError("Runtime ownership stamp does not match manifest")
        source_scripts = Path(__file__).resolve().parents[2] / "components/claude-mem/scripts"
        adapters = sorted(name for name in manifest["files"] if name.startswith("scripts/"))
        if not adapters:
            raise ValueError("Runtime manifest has no adapter scripts")
        report.update(manifestSha256=manifest_hash, upstream=manifest.get("upstream"), adapterHashes={})
        for name in adapters:
            expected = manifest["files"][name]
            if digest(absolute(str(component / name))) != expected or digest(source_scripts / Path(name).name) != expected:
                raise ValueError("Owned runtime differs from frozen source/manifest: " + name)
            report["adapterHashes"][name] = expected
        for name in ("bin/node.exe", "bin/bun.exe", "plugin/scripts/worker-service.cjs", "plugin/scripts/mcp-server.cjs"):
            if digest(absolute(str(component / name))) != manifest["files"][name]:
                raise ValueError("Invalid runtime payload: " + name)
        args.scratch_root.mkdir(parents=True, exist_ok=True)
        trial = Path(tempfile.mkdtemp(prefix="transition-", dir=args.scratch_root))
        project, home, data = trial / "project", trial / "native-home", trial / "data"
        for directory in (project, home, trial / "os-home", trial / "tmp", trial / "appdata", trial / "localappdata"):
            directory.mkdir()
        write_json(home / "settings.json", {
            "env": {"ANTHROPIC_API_KEY": "vault-transition-fixture-only", "ANTHROPIC_BASE_URL": "http://127.0.0.1:1"},
            "model": "haiku",
        })
        native_hash = digest(home / "settings.json")
        env = {key: value for key, value in os.environ.items() if key.upper() in {
            "SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "OS", "PROCESSOR_ARCHITECTURE", "PROGRAMFILES"}}
        env.update(USERPROFILE=str(trial / "os-home"), HOME=str(trial / "os-home"),
                   APPDATA=str(trial / "appdata"), LOCALAPPDATA=str(trial / "localappdata"),
                   TEMP=str(trial / "tmp"), TMP=str(trial / "tmp"), CLAUDE_CONFIG_DIR=str(home),
                   HTTP_PROXY="", HTTPS_PROXY="", ALL_PROXY="", NO_PROXY="127.0.0.1,localhost",
                   DISABLE_TELEMETRY="1", DISABLE_ERROR_REPORTING="1", DISABLE_AUTOUPDATER="1",
                   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1", DO_NOT_TRACK="1")
        commands = Commands(output, project, env)
        node, module = component / "bin/node.exe", component / "scripts/runtime.cjs"
        options = {"runtime": str(component), "project": str(project), "dataRoot": str(data), "claudeHome": str(home)}
        report.update(trial=str(trial), project=str(project), nativeModelEndpoint="http://127.0.0.1:1")
        write_json(project / ".agent-vault/claude-mem/claude/project.json", {
            "owner": "AgentPluginSkillVault", "componentId": "claude-mem", "protocolVersion": 1,
            "enabled": True, "capture": True, "runtimeRoot": str(component), "dataRoot": str(data), "claudeHome": str(home),
        })

        async def service(action, extra=None):
            script = ("const s=require(process.argv[1]);Promise.resolve().then(()=>s[process.argv[2]](JSON.parse(process.argv[3])))"
                      ".then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.message);process.exitCode=1})")
            raw = await asyncio.to_thread(commands.run,
                [node, "-e", script, module, action, json.dumps({**options, **(extra or {})})], timeout=100)
            return json.loads(raw)

        async def identities():
            commands.env.update(VAULT_TRANSITION_PARENT_PID=str(os.getpid()), VAULT_TRANSITION_PROJECT=str(project),
                                VAULT_TRANSITION_BRIDGE=str(component / "scripts/bridge.cjs"),
                                VAULT_TRANSITION_MCP=str(component / "plugin/scripts/mcp-server.cjs"))
            script = r"""$ErrorActionPreference='Stop'
function Fact($p) { return @{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;
  startTime=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;commandLine=$p.CommandLine} }
$bridges=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$env:VAULT_TRANSITION_PARENT_PID) |
  Where-Object {$_.CommandLine -and $_.CommandLine.Contains($env:VAULT_TRANSITION_BRIDGE) -and $_.CommandLine.Contains($env:VAULT_TRANSITION_PROJECT)})
if($bridges.Count -ne 1){throw 'Expected exactly one fixture-owned MCP bridge'}
$children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$bridges[0].ProcessId) |
  Where-Object {$_.CommandLine -and $_.CommandLine.Contains($env:VAULT_TRANSITION_MCP)})
if($children.Count -ne 1){throw 'Expected exactly one real upstream MCP child'}
@{bridge=(Fact $bridges[0]);upstream=(Fact $children[0])} | ConvertTo-Json -Compress"""
            powershell = Path(env.get("SystemRoot", env.get("SYSTEMROOT", "C:/Windows"))) / "System32/WindowsPowerShell/v1.0/powershell.exe"
            return json.loads(await asyncio.to_thread(commands.run,
                [powershell, "-NoProfile", "-NonInteractive", "-Command", script], timeout=25))

        async def roots(_):
            return types.ListRootsResult(roots=[types.Root(uri=project.as_uri(), name="fixture-project")])

        async def tool(session, name, arguments):
            # Each call is submitted once. A failed save is never replayed.
            entry = {"name": name, "arguments": arguments, "submitted": 1}
            report["toolCalls"].append(entry)
            result = await session.call_tool(name, arguments)
            entry["isError"] = bool(result.isError)
            text = "\n".join(getattr(item, "text", "") for item in result.content)
            entry["text"] = text[:16384]
            if result.isError:
                raise AssertionError("MCP tool failed: " + name + ": " + text[:1000])
            return text

        params = StdioServerParameters(command=str(node), args=[str(component / "scripts/bridge.cjs"),
            "--mode", "mcp", "--runtime", str(component), "--project", str(project), "--data-root", str(data),
            "--claude-home", str(home)], env=env, cwd=str(project))
        marker = "VAULT_TRANSITION_" + uuid.uuid4().hex
        report["marker"] = marker
        with (output / "mcp-stderr.log").open("w", encoding="utf-8") as errlog:
            report["mcpTransportStarts"] += 1
            async with stdio_client(params, errlog=errlog) as (reader, writer):
                async with ClientSession(reader, writer, read_timeout_seconds=timedelta(seconds=90), list_roots_callback=roots) as session:
                    initialized = await session.initialize()
                    report["mcpInitializations"] += 1
                    report["serverInfo"] = initialized.serverInfo.model_dump(mode="json")
                    listed = await session.list_tools()
                    report["tools"] = sorted(item.name for item in listed.tools)
                    if not {"save_memory", "search"} <= set(report["tools"]):
                        raise AssertionError("Expected manual memory tools")
                    report["reader"] = before = await service("status")
                    if before["status"] != "running" or before["observer"]:
                        raise AssertionError("MCP must initially create a reader")
                    report["mcpProcessesBefore"] = await identities()
                    await tool(session, "save_memory", {"text": marker + " saved before promotion", "title": marker + " before"})
                    if marker not in await tool(session, "search", {"query": marker}):
                        raise AssertionError("Reader search did not return the saved marker")
                    print("Reader MCP save and search passed", flush=True)
                    report["observer"] = after = await service("start", {"observer": True})
                    report["sameWorkerUrl"] = before["url"] == after["url"]
                    report["newWorkerGeneration"] = before["generation"] != after["generation"]
                    report["newWorkerPid"] = before["pid"] != after["pid"]
                    if not (after["observer"] and not after.get("reused") and report["sameWorkerUrl"]
                            and report["newWorkerGeneration"] and report["newWorkerPid"]):
                        raise AssertionError("Observer promotion did not preserve URL with a new owned worker")
                    if marker not in await tool(session, "search", {"query": marker}):
                        raise AssertionError("Persistent MCP cannot search pre-promotion memory")
                    await tool(session, "save_memory", {"text": marker + " saved after promotion", "title": marker + " after"})
                    if marker not in await tool(session, "search", {"query": marker}):
                        raise AssertionError("Persistent MCP cannot search after its second save")
                    report["mcpProcessesAfter"] = await identities()
                    report["sameMcpProcesses"] = report["mcpProcessesBefore"] == report["mcpProcessesAfter"]
                    if not report["sameMcpProcesses"]:
                        raise AssertionError("Bridge or upstream MCP process was replaced")
                    report["observerAfterTools"] = await service("status")
                    if report["observerAfterTools"]["generation"] != after["generation"]:
                        raise AssertionError("Manual MCP calls replaced the promoted observer")
                    print("Same MCP subprocess/session survived observer promotion", flush=True)
        report["nativeSettingsPreserved"] = digest(home / "settings.json") == native_hash
        report["passed"] = report["nativeSettingsPreserved"]
    except Exception as exc:
        report["error"] = type(exc).__name__ + ": " + str(exc)
    finally:
        if commands is not None and options is not None:
            try:
                report["cleanupAttempts"] = []
                for attempt in range(2):
                    try:
                        report["cleanup"] = await service("stop")
                        report["cleanupAttempts"].append({"attempt": attempt + 1, "status": report["cleanup"]["status"]})
                        break
                    except RuntimeError as exc:
                        message = str(exc)
                        report["cleanupAttempts"].append({"attempt": attempt + 1, "error": message})
                        if attempt or "Command failed:" not in message or "Get-CimInstance Win32_Process" not in message:
                            raise
                report["ownedWorkerStopped"] = report["cleanup"]["status"] == "stopped"
                private = Path(report["cleanup"]["dataDirectory"]) / "native-empty"
                report["observerEnvironmentRemoved"] = not (private / "observer.env").exists()
                report["observerEnvironmentTemporariesRemoved"] = not any(private.glob("observer.env.tmp-*"))
            except Exception as exc:
                report["cleanupError"] = type(exc).__name__ + ": " + str(exc)
                report["ownedWorkerStopped"] = False
        if commands is not None:
            commands.close()
            report["ownedCommandJobClosed"] = True
        report["passed"] = bool(report["passed"] and report.get("ownedWorkerStopped")
                                and report.get("observerEnvironmentRemoved") and report.get("observerEnvironmentTemporariesRemoved"))
        report["elapsedSeconds"] = round(time.monotonic() - started, 2)
        write_json(output / "result.json", report)
    print(json.dumps(report, indent=2), flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--component", type=absolute, required=True, help="Already owned and verified developer runtime")
    parser.add_argument("--output", type=absolute, required=True, help="New isolated report directory")
    parser.add_argument("--scratch-root", type=absolute, required=True, help="Private base outside Git")
    raise SystemExit(asyncio.run(exercise(parser.parse_args())))
