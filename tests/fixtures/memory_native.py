"""Discover the installed memory Skill/MCP with native clients, without a turn.

Development Python needs claude-agent-sdk and pywin32. Only extracted component
inputs and new synthetic homes are used; evidence and scratch data are retained.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
from importlib import metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib
from types import SimpleNamespace
from urllib.request import urlopen


_SPEC = importlib.util.spec_from_file_location(
    "vault_native_helpers", Path(__file__).with_name("playwright_native.py")
)
helpers = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(helpers)

SERVER = "vault_memory"
SKILL = "vault-memory"
RUN_TIMEOUT = 4500
require = helpers.require


def outside_git(directory):
    return not any((parent / ".git").exists()
                   for parent in (directory, *directory.parents))


async def manager(args, result, project, action, client="claude"):
    argv = [args.component / "bin/node.exe", args.component / "scripts/manage.cjs",
            "--action", action, "--client", client, "--project", project]
    if action == "install":
        argv.extend(["--runtime-root", args.runtime_root,
                     "--data-root", args._run_root / "private",
                     "--claude-home", Path(os.environ["CLAUDE_CONFIG_DIR"])])
    value = json.loads(await helpers.command(args, result, argv, project, timeout=900))
    require(value.get("ok") is True and value.get("componentId") == "claude-mem"
            and value.get("protocolVersion") == 1, f"Management failed: {value}")
    require(value.get("capture") is not True, "Native fixture must never enable capture")
    result.setdefault("management", []).append(value)
    return value


async def management(args, result, project):
    for name, executable in (("node", args.component / "bin/node.exe"),
                             ("claude", args.claude_cli), ("codex", args.codex_cli)):
        result["versions"][name] = (await helpers.command(
            args, result, [executable, "--version"], project)).strip()
    git = os.environ.get("VAULT_FIXTURE_GIT")
    if git:
        template = args._run_root / "empty-git-template"
        template.mkdir()
        await helpers.command(args, result, [git, "init", "--quiet",
                              f"--template={template}", project], project)
    for client in ("claude", "codex"):
        for action in ("install", "enable"):
            await manager(args, result, project, action, client)
    state = await manager(args, result, project, "status")
    require(state["service"]["status"] == "stopped", "Install/enable started a worker")
    require(not (project / ".claude/settings.json").exists(),
            "Manual enable unexpectedly wrote Claude Hooks/settings")
    for directory in (".claude", ".agents"):
        require((project / directory / "skills" / SKILL / "SKILL.md").is_file(),
                f"Managed Skill missing from {directory}")
    return {"status": "passed", "clients": ["claude", "codex"],
            "gitRoot": bool(git), "capture": False, "workerStarted": False}


async def claude_discovery(args, result, project):
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

    require(not list(Path(os.environ["CLAUDE_CONFIG_DIR"]).iterdir()),
            "Claude home must start empty")
    # Consent is confined to this synthetic project; MCP still comes from .mcp.json.
    (project / ".claude/settings.json").write_text(
        json.dumps({"enabledMcpjsonServers": [SERVER]}) + "\n", encoding="utf-8")
    diagnostics = []
    evidence = {"status": "running", "api": "connect/get_server_info/get_mcp_status",
                "settingSources": ["project"], "projectMcpApproval": [SERVER],
                "modelTurnSubmitted": False, "stderr": diagnostics}
    result["checks"]["claude"] = evidence

    def stderr(line):
        if len(diagnostics) < 50:
            diagnostics.append(line[:2000])

    options = ClaudeAgentOptions(cli_path=str(args.claude_cli), cwd=str(project),
                                setting_sources=["project"], env=dict(os.environ), stderr=stderr)
    async with ClaudeSDKClient(options=options) as client:
        # __aenter__ connects. get_server_info returns that initialize response;
        # no query, user prompt, model turn or tool invocation is submitted.
        info = await client.get_server_info()
        require(isinstance(info, dict), "Claude initialize returned no discovery information")
        commands = helpers.names(info.get("commands", []))
        evidence["commands"] = commands
        require(SKILL in commands, f"Native Claude slash command missing: {SKILL}")
        deadline = time.monotonic() + 75
        while True:
            servers = (await client.get_mcp_status()).get("mcpServers", [])
            server = next((item for item in servers if item.get("name") == SERVER), None)
            evidence["mcpServer"] = server
            if server and server.get("status") != "pending":
                break
            require(time.monotonic() < deadline, "Timed out waiting for native memory MCP")
            await asyncio.sleep(0.5)
        require(server and server.get("status") == "connected", f"Claude MCP failed: {server}")
        tools = helpers.names(server.get("tools", []))
        evidence["tools"] = tools
        require({"save_memory", "search", "get_observations"} <=
                {name.split("__")[-1] for name in tools}, f"Memory MCP tools missing: {tools}")
        state = await manager(args, result, project, "status")
        require(state["service"]["status"] == "running" and
                state["service"]["observer"] is False, "Native MCP enabled an observer")
        evidence["worker"] = state["service"]
    return {**evidence, "status": "passed"}


async def manager_exit_survival(args, result, project):
    # command() waits for the real Node manager to exit before returning. Probe
    # from Python so a same-process lifecycle test cannot hide console ownership.
    running = (await manager(args, result, project, "start"))["service"]
    require(running["status"] == "running" and running["observer"] is False,
            "Short-lived manager did not start a reader worker")
    probes = []

    def health():
        with urlopen(running["url"] + "/api/health", timeout=5) as response:
            require(response.status == 200, "Worker health failed after manager exit")
            return json.load(response)

    for delay in (0, 2):
        await asyncio.sleep(delay)
        value = await asyncio.to_thread(health)
        require(value.get("pid") == running["pid"], "Worker generation changed after manager exit")
        probes.append({"delaySeconds": delay, "pid": value["pid"], "status": value.get("status")})
    state = await manager(args, result, project, "status")
    require(state["service"]["status"] == "running" and state["service"]["pid"] == running["pid"],
            "Owned worker did not survive its short-lived Node manager")
    return {"status": "passed", "managerExited": True, "observer": False,
            "probes": probes, "worker": running,
            "nativeDiscoveryUses": "reader started by the exited manager"}


async def codex_config(args, result, project):
    expected = helpers.read_json(project / ".mcp.json")["mcpServers"][SERVER]
    config_path = project / ".codex/config.toml"
    parsed = tomllib.loads(config_path.read_text(encoding="utf-8"))
    require(parsed["mcp_servers"][SERVER] == expected, "Client MCP registrations differ")
    home_config = Path(os.environ["CODEX_HOME"]) / "config.toml"
    require(not home_config.exists(), "Codex home must start without configuration")
    home_config.write_text(f"[projects.{json.dumps(str(project))}]\ntrust_level = \"trusted\"\n",
                           encoding="utf-8")
    value = json.loads(await helpers.command(args, result,
        [args.codex_cli, "-C", project, "mcp", "get", SERVER, "--json"], project))
    require(value.get("name") == SERVER and value.get("enabled") is True,
            "Native Codex did not load enabled project memory MCP")
    transport = value.get("transport", {})
    require(transport.get("type") == "stdio" and
            helpers.same_path(transport.get("command", ""), expected["command"]) and
            transport.get("args") == expected["args"] and
            transport.get("env") == expected.get("env"), "Codex MCP transport differs")
    return {"status": "passed", "source": "native codex mcp get --json",
            "projectConfig": str(config_path), "response": value,
            "projectConfigSha256": hashlib.sha256(config_path.read_bytes()).hexdigest(),
            "homeConfigContains": "synthetic project trust only"}


async def codex_skills(args, result, project):
    evidence = {"status": "running", "requests": [], "notifications": 0,
                "modelTurnSubmitted": False}
    result["checks"]["codexSkills"] = evidence
    process = await asyncio.create_subprocess_exec(
        str(args.codex_cli), "-C", str(project), "app-server", cwd=project,
        env=dict(os.environ), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, limit=4 * 1024 * 1024,
        creationflags=subprocess.CREATE_NO_WINDOW)
    diagnostic = asyncio.create_task(helpers.capture(process.stderr))

    async def send(payload):
        process.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
        await process.stdin.drain()

    async def request(number, method, params):
        evidence["requests"].append(method)
        await send({"jsonrpc": "2.0", "id": number, "method": method, "params": params})
        for _ in range(200):
            line = await process.stdout.readline()
            require(line, f"Codex exited before responding to {method}")
            value = json.loads(line)
            if value.get("id") == number and "method" not in value:
                require("error" not in value, f"Codex {method} failed: {value}")
                return value
            if "id" in value and "method" in value:
                await send({"jsonrpc": "2.0", "id": value["id"], "error": {
                    "code": -32601, "message": "Fixture supports discovery only"}})
            else:
                evidence["notifications"] += 1
        raise AssertionError("Codex discovery message bound exceeded")

    try:
        evidence["initialize"] = await request(1, "initialize", {
            "clientInfo": {"name": "vault_memory_fixture", "title": "Vault memory fixture",
                           "version": "1.0.0"}, "capabilities": {"experimentalApi": True}})
        await send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
        response = await request(2, "skills/list", {"cwds": [str(project)], "forceReload": True})
        evidence["skillsResponse"] = response
        rows = response.get("result", {}).get("data")
        require(isinstance(rows, list), "Unrecognized Codex skills/list response")
        matches = [row for row in rows if helpers.same_path(row.get("cwd", ""), project)]
        require(len(matches) == 1 and not matches[0].get("errors"),
                "Native Codex could not load requested project Skills")
        expected = project / ".agents/skills" / SKILL / "SKILL.md"
        skills = matches[0].get("skills", [])
        require(any(item.get("name") == SKILL and
                    helpers.same_path(item.get("path", ""), expected) and
                    item.get("enabled", item.get("isEnabled")) is not False for item in skills),
                "Native Codex did not discover the enabled project memory Skill")
        evidence["discoveredNames"] = helpers.names(skills)
        evidence["status"] = "passed"
        return evidence
    finally:
        try:
            await helpers.close_process(process)
            text, discarded = await asyncio.wait_for(diagnostic, 5)
            evidence.update({"stderr": text, "stderrDiscardedBytes": discarded,
                             "exitCode": process.returncode})
        finally:
            if not diagnostic.done():
                diagnostic.cancel()
            await asyncio.gather(diagnostic, return_exceptions=True)


async def worker(args):
    result = helpers.read_json(args.output / "native-result.json")
    project = args._run_root / "project"
    project.mkdir()
    result["project"] = str(project)
    result["versions"]["claude-agent-sdk"] = metadata.version("claude-agent-sdk")
    checks = result["checks"]

    async def check(name, operation, timeout):
        checks[name] = {"status": "running"}
        helpers.save(args.output, result)
        try:
            checks[name] = await asyncio.wait_for(operation, timeout)
        except Exception as error:
            checks[name].update({"status": "failed", "error": helpers.error_text(error)})
        helpers.save(args.output, result)
        return checks[name]["status"] == "passed"

    try:
        if await check("management", management(args, result, project), 3700):
            if await check("managerExitSurvival", manager_exit_survival(args, result, project), 1000):
                await check("claude", claude_discovery(args, result, project), 150)
            else:
                checks["claude"] = {"status": "blocked", "reason": "Worker did not survive manager exit"}
            await check("codexConfig", codex_config(args, result, project), 45)
            await check("codexSkills", codex_skills(args, result, project), 60)
        else:
            for name in ("managerExitSurvival", "claude", "codexConfig", "codexSkills"):
                checks[name] = {"status": "blocked", "reason": "Management preparation failed"}
    except Exception as error:
        result["errors"].append(helpers.error_text(error))
    finally:
        async def cleanup():
            for client in ("claude", "codex"):
                await manager(args, result, project, "disable", client)
            await manager(args, result, project, "stop")
            state = await manager(args, result, project, "status")
            require(state.get("service", {}).get("status") in (None, "stopped"),
                    "Owned worker remained after cleanup")
            return {"status": "passed", "workerStopped": True, "dataRetained": True}

        await check("cleanup", cleanup(), 90)
    current_manifest = hashlib.sha256((args.component / "manifest.json").read_bytes()).hexdigest()
    if current_manifest != result["source"]["manifestSha256"]:
        result["errors"].append("Component manifest changed during the native fixture")
    result["counts"] = dict(Counter(item["status"] for item in checks.values()))
    result["passed"] = not result["errors"] and all(
        item["status"] == "passed" for item in checks.values())
    result["status"] = "passed" if result["passed"] else "failed"
    result["finishedUtc"] = datetime.now(timezone.utc).isoformat()
    helpers.save(args.output, result)
    return 0 if result["passed"] else 1


def supervise(args, result, environment):
    import win32api
    import win32con
    import win32event
    import win32job
    import win32process

    job = win32job.CreateJobObject(None, "")
    process = thread = None
    try:
        limits = win32job.QueryInformationJobObject(job, win32job.JobObjectExtendedLimitInformation)
        limits["BasicLimitInformation"]["LimitFlags"] |= win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        win32job.SetInformationJobObject(job, win32job.JobObjectExtendedLimitInformation, limits)
        argv = [sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--_worker"]
        for name, value in (("component", args.component), ("output", args.output),
                            ("scratch-root", args.scratch_root), ("claude-cli", args.claude_cli),
                            ("codex-cli", args.codex_cli), ("_run-root", args._run_root),
                            ("runtime-root", args.runtime_root)):
            argv.extend(["--" + name, str(value)])
        result["supervision"] = {"mechanism": "Windows Job Object; kill on close",
                                 "assignedToJob": False, "jobClosed": False,
                                 "timeoutSeconds": RUN_TIMEOUT}
        helpers.save(args.output, result)
        process, thread, pid, _ = win32process.CreateProcess(
            sys.executable, subprocess.list2cmdline(argv), None, None, False,
            win32con.CREATE_SUSPENDED | win32con.CREATE_NO_WINDOW, environment,
            str(args._run_root), win32process.STARTUPINFO())
        win32job.AssignProcessToJobObject(job, process)
        result["supervision"].update({"workerPid": pid, "assignedToJob": True})
        helpers.save(args.output, result)
        win32process.ResumeThread(thread)
        require(win32event.WaitForSingleObject(process, RUN_TIMEOUT * 1000) == win32event.WAIT_OBJECT_0,
                "Native fixture exceeded its supervised deadline")
        return win32process.GetExitCodeProcess(process)
    finally:
        try:
            if process and win32process.GetExitCodeProcess(process) == win32con.STILL_ACTIVE:
                win32process.TerminateProcess(process, 1)
        finally:
            win32api.CloseHandle(job)
            try:
                latest = helpers.read_json(args.output / "native-result.json")
                latest["supervision"]["jobClosed"] = True
                if process:
                    win32event.WaitForSingleObject(process, 5000)
                    latest["supervision"]["workerExitCode"] = win32process.GetExitCodeProcess(process)
                helpers.save(args.output, latest)
            finally:
                if process:
                    win32api.CloseHandle(process)
                if thread:
                    win32api.CloseHandle(thread)


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--component", type=helpers.absolute, required=True)
    parser.add_argument("--output", type=helpers.absolute, required=True)
    parser.add_argument("--scratch-root", type=helpers.absolute,
                        default=Path(tempfile.gettempdir()) / "AgentVaultMemoryTestRuns")
    parser.add_argument("--runtime-root", type=helpers.absolute,
                        help="Optional existing owned runtime cache base; never deleted")
    parser.add_argument("--claude-cli", type=helpers.absolute, required=True)
    parser.add_argument("--codex-cli", type=helpers.absolute, required=True)
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--_run-root", type=helpers.absolute, help=argparse.SUPPRESS)
    return parser.parse_args()


def main():
    args = arguments()
    require(sys.platform == "win32", "Native memory fixture requires Windows")
    if args._worker:
        require(args._run_root is not None and args.runtime_root is not None,
                "Missing supervised scratch directory or runtime cache base")
        return asyncio.run(worker(args))
    args.scratch_root = helpers.absolute(str(args.scratch_root))
    require(not args.output.exists(), "--output must be a new evidence directory")
    repository = Path(__file__).resolve().parents[2]
    require(outside_git(args.output) or args.output.is_relative_to(repository / ".ui_test"),
            "Evidence must be outside Git or in this repository's ignored .ui_test")
    require(outside_git(args.scratch_root), "--scratch-root must be outside Git")
    require(not args.output.is_relative_to(args.component) and
            not args.component.is_relative_to(args.output), "Component and evidence must be separate")
    for executable in (args.claude_cli, args.codex_cli, args.component / "bin/node.exe"):
        helpers.native_executable(executable)
    source = helpers.package_info(args.component, "claude-mem")
    require((args.component / "scripts/manage.cjs").is_file(), "Missing component manager")
    args.scratch_root.mkdir(parents=True, exist_ok=True)
    args._run_root = Path(tempfile.mkdtemp(prefix="native-", dir=args.scratch_root))
    args.runtime_root = args.runtime_root or args._run_root / "runtimes"
    args.output.mkdir(parents=True)
    git = shutil.which("git")
    environment = helpers.isolated_environment(
        SimpleNamespace(output=args._run_root, component=args.component), git or str(args.component / "bin/git.exe"))
    if not git:
        environment.pop("VAULT_FIXTURE_GIT", None)
    result = {"schemaVersion": 1, "status": "running", "passed": False,
              "startedUtc": datetime.now(timezone.utc).isoformat(), "modelTurnSubmitted": False,
              "source": source, "scratchDirectory": str(args._run_root),
              "runtimeBase": str(args.runtime_root),
              "versions": {"python": sys.version, "pythonExecutable": sys.executable,
                           "pywin32": metadata.version("pywin32")},
              "commands": [], "checks": {}, "errors": [],
              "limits": ["Native initialization, Skill discovery and MCP connection only",
                         "No query, model turn, automatic capture or business-system request",
                         "Codex configuration discovery is separate from model tool selection"]}
    helpers.save(args.output, result)
    try:
        code = supervise(args, result, environment)
        result = helpers.read_json(args.output / "native-result.json")
        require(result["status"] != "running", "Worker exited without completing evidence")
    except BaseException as error:
        result = helpers.read_json(args.output / "native-result.json")
        result.update({"status": "failed", "passed": False})
        result["errors"].append(helpers.error_text(error))
        code = 1
    result["fixtureExitCode"] = code
    helpers.save(args.output, result)
    print(json.dumps({"status": result["status"], "counts": result.get("counts", {}),
                      "modelTurnSubmitted": False,
                      "result": str(args.output / "native-result.json")}))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
