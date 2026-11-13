"""Development-only native discovery and MCP checks; never submit model turns.

Run with Git and a development Python containing claude_agent_sdk, mcp and pywin32.
Inputs are extracted release packages and native executables, not host sources.
The output directory must be new. Evidence and isolated client homes are retained
there, including on failure. An explicitly supplied runtime base may be shared
between isolated fixture runs; it is never deleted by this fixture.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import tomllib


SERVER = "vault_playwright"
SKILL = "vault-playwright"
AGENTS = {f"vault-playwright-test-{role}" for role in ("planner", "generator", "healer")}
WRITE_TOOLS = {"planner_setup_page", "planner_save_plan", "generator_setup_page",
               "generator_write_test", "test_run", "test_debug"}
CAPTURE_LIMIT = 256 * 1024
RUN_TIMEOUT = 900


def require(condition, message):
    # Do not let python -O turn a failed discovery check into a pass.
    if not condition:
        raise AssertionError(message)


def absolute(value):
    path = Path(value)
    if not path.is_absolute():
        raise argparse.ArgumentTypeError("An absolute path is required")
    for part in (path, *path.parents):
        if part.is_symlink() or part.is_junction():
            raise argparse.ArgumentTypeError("Linked input/output paths are not supported")
    return path.resolve()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def save(output, result):
    temporary = output / "native-result.json.tmp"
    temporary.write_text(json.dumps(result, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output / "native-result.json")


def error_text(error):
    nested = getattr(error, "exceptions", ())
    text = f"{type(error).__name__}: {error}"
    if nested:
        text += " [" + "; ".join(error_text(item) for item in nested) + "]"
    return text[:12000]


def package_info(root, component_id):
    manifest_path = root / "manifest.json"
    manifest = read_json(manifest_path)
    require(manifest.get("componentId") == component_id, f"Wrong component at {root}")
    require(manifest.get("componentVersion") == "1.0.0", "This fixture targets component 1.0.0")
    require(manifest.get("protocolVersion") == 1, "Unsupported management protocol")
    return {
        "path": str(root), "componentId": component_id,
        "version": manifest["componentVersion"],
        "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "manifestFileCount": len(manifest["files"]),
        "engine": manifest.get("engine"), "upstream": manifest.get("upstream"),
    }


def native_executable(path):
    require(path.is_file() and path.suffix.lower() == ".exe", f"Native .exe required: {path}")
    with path.open("rb") as stream:
        require(stream.read(2) == b"MZ", f"Not a native Windows executable: {path}")


def isolated_environment(args, git):
    base = args.output
    # Inherit only Windows runtime essentials, never credentials or client flags.
    allowed = {"SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "OS",
               "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "PROGRAMFILES",
               "PROGRAMFILES(X86)", "COMMONPROGRAMFILES"}
    env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    system = Path(env.get("SYSTEMROOT", "C:/Windows"))
    profile = base / "profile"
    directories = {
        "HOME": profile, "USERPROFILE": profile,
        "APPDATA": base / "appdata", "LOCALAPPDATA": base / "localappdata",
        "TEMP": base / "tmp", "TMP": base / "tmp",
        "CLAUDE_CONFIG_DIR": base / "claude-home", "CODEX_HOME": base / "codex-home",
        "XDG_CONFIG_HOME": base / "xdg-config", "XDG_CACHE_HOME": base / "xdg-cache",
        "XDG_DATA_HOME": base / "xdg-data",
    }
    for key, directory in directories.items():
        directory.mkdir(parents=True, exist_ok=True)
        env[key] = str(directory)
    env.update({
        "HOMEDRIVE": profile.drive, "HOMEPATH": str(profile)[len(profile.drive):],
        "PATH": os.pathsep.join(map(str, (args.component / "bin", Path(git).parent, system / "System32",
                                          system, system / "System32/WindowsPowerShell/v1.0"))),
        "ANTHROPIC_API_KEY": "isolated-unused-fixture-key",
        "ANTHROPIC_BASE_URL": "http://127.0.0.1:1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "DISABLE_AUTOUPDATER": "1",
        "DISABLE_TELEMETRY": "1", "DISABLE_ERROR_REPORTING": "1",
        "CLAUDE_CODE_ENABLE_TELEMETRY": "0", "DO_NOT_TRACK": "1",
        "OPENAI_BASE_URL": "http://127.0.0.1:1", "OTEL_SDK_DISABLED": "true",
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1", "NO_PROXY": "127.0.0.1,localhost",
        "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_TERMINAL_PROMPT": "0", "VAULT_FIXTURE_GIT": str(git),
        "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1",
    })
    return env


async def capture(stream):
    chunks = bytearray()
    discarded = 0
    while block := await stream.read(16384):
        kept = block[:max(0, CAPTURE_LIMIT - len(chunks))]
        chunks.extend(kept)
        discarded += len(block) - len(kept)
    return chunks.decode("utf-8", errors="replace"), discarded


async def close_process(process):
    if process.stdin:
        process.stdin.close()
    try:
        await asyncio.wait_for(process.wait(), 3)
        return
    except TimeoutError:
        pass
    # PID-scoped escalation only. The outer Job Object also catches descendants
    # whose direct parent already exited, including SDK/MCP cancellation failures.
    killer = await asyncio.create_subprocess_exec(
        str(Path(os.environ["SYSTEMROOT"]) / "System32/taskkill.exe"),
        "/PID", str(process.pid), "/T", "/F",
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    try:
        await asyncio.wait_for(killer.wait(), 5)
    except TimeoutError:
        killer.kill()
        await asyncio.wait_for(killer.wait(), 3)
    if process.returncode is None:
        process.kill()
    await asyncio.wait_for(process.wait(), 5)


async def command(args, result, argv, cwd, timeout=30):
    entry = {"argv": list(map(str, argv)), "cwd": str(cwd), "timeoutSeconds": timeout}
    result["commands"].append(entry)
    save(args.output, result)
    started = time.monotonic()
    process = await asyncio.create_subprocess_exec(
        *entry["argv"], cwd=cwd, env=dict(os.environ),
        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    readers = [asyncio.create_task(capture(process.stdout)), asyncio.create_task(capture(process.stderr))]
    try:
        await asyncio.wait_for(process.wait(), timeout)
        output = await asyncio.wait_for(asyncio.gather(*readers), 5)
        entry.update({"exitCode": process.returncode, "stdout": output[0][0], "stderr": output[1][0],
                      "discardedBytes": output[0][1] + output[1][1]})
        require(entry["discardedBytes"] == 0, "Command output exceeded the evidence limit")
        require(process.returncode == 0, f"Command failed: {entry['argv']}; {entry['stderr']}; {entry['stdout']}")
        return entry["stdout"]
    except TimeoutError:
        entry["timedOut"] = True
        raise
    finally:
        try:
            await close_process(process)
        finally:
            for task in readers:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*readers, return_exceptions=True)
            entry["durationSeconds"] = round(time.monotonic() - started, 3)
            save(args.output, result)


async def management(args, result, project):
    node = args.component / "bin/node.exe"
    versions = result["versions"]
    for name, executable in (("node", node), ("claude", args.claude_cli), ("codex", args.codex_cli)):
        if executable:
            versions[name] = (await command(args, result, [executable, "--version"], project)).strip()
    # A real empty Git root keeps native ancestor discovery inside this fixture.
    template = args.output / "empty-git-template"
    template.mkdir()
    await command(args, result, [os.environ["VAULT_FIXTURE_GIT"], "init", "--quiet",
                                f"--template={template}", project], project)
    for client in ("claude", "codex"):
        for action in ("install", "enable"):
            argv = [node, args.component / "scripts/manage.cjs", "--action", action,
                    "--client", client, "--project", project, "--runtime-root", args.runtime_root]
            payload = json.loads(await command(args, result, argv, project, timeout=180))
            require(payload.get("ok") is True and payload.get("protocolVersion") == 1,
                    f"Management failed: {payload}")
            require(payload.get("componentId") == "playwright-test", "Wrong management response")
            result.setdefault("management", []).append(payload)
        if args.impeccable_component:
            powershell = Path(os.environ["SYSTEMROOT"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
            payload = json.loads(await command(args, result, [
                powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                args.impeccable_component / "manage.ps1", "-Action", "install", "-Client", client,
                "-Scope", "project", "-Project", project,
            ], project, timeout=90))
            require(payload.get("ok") is True and payload.get("componentId") == "impeccable",
                    f"Impeccable install failed: {payload}")
            result.setdefault("management", []).append(payload)
    return {"status": "passed", "clients": ["claude", "codex"],
            "impeccableInstalled": bool(args.impeccable_component)}


def names(rows):
    return [row if isinstance(row, str) else row.get("name", "") for row in rows]


def same_path(value, expected):
    try:
        return os.path.samefile(value, expected)
    except (OSError, ValueError):
        return False


async def claude_discovery(args, result, project):
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

    require(not list(Path(os.environ["CLAUDE_CONFIG_DIR"]).iterdir()), "Claude config must start empty")
    settings = project / ".claude/settings.json"
    settings.write_text(json.dumps({"enabledMcpjsonServers": [SERVER]}) + "\n", encoding="utf-8")
    diagnostics = []

    def stderr(line):
        if len(diagnostics) < 50:
            diagnostics.append(line[:2000])

    options = ClaudeAgentOptions(
        cli_path=str(args.claude_cli), cwd=str(project), setting_sources=["project"],
        env=dict(os.environ), stderr=stderr,
    )
    evidence = {"status": "running", "source": "native Claude CLI / SDK initialize and mcp_status",
                "settingSources": ["project"], "projectMcpApproval": [SERVER], "stderr": diagnostics}
    result["checks"]["claude"] = evidence
    async with ClaudeSDKClient(options=options) as client:
        # No query(), prompt, receive_response(), or model-directed tool call.
        info = await client.get_server_info()
        require(isinstance(info, dict), "SDK initialization returned no discovery information")
        commands, agents = names(info.get("commands", [])), names(info.get("agents", []))
        source_counts = Counter(row.get("source", "unspecified") if isinstance(row, dict)
                                else "unspecified" for row in info.get("commands", []))
        evidence.update({"commandCount": len(commands), "agentCount": len(agents),
                         "commandSourceCounts": dict(source_counts),
                         "commands": commands, "agents": agents})
        require(SKILL in commands, f"Native Claude command missing: {SKILL}")
        require(set(name for name in agents if name.startswith("vault-playwright-test-")) == AGENTS,
                "Native Claude namespaced agent set does not match the three installed roles")
        if args.impeccable_component:
            require("impeccable" in commands, "Native Claude command missing: impeccable")
        deadline = time.monotonic() + 45
        while True:
            servers = (await client.get_mcp_status()).get("mcpServers", [])
            server = next((row for row in servers if row.get("name") == SERVER), None)
            evidence["mcpServer"] = server
            if server and server.get("status") != "pending":
                break
            require(time.monotonic() < deadline, "Timed out waiting for native MCP connection")
            await asyncio.sleep(0.25)
        require(server and server.get("status") == "connected", f"Native MCP failed: {server}")
        tools = names(server.get("tools", []))
        evidence["mcpToolCount"] = len(tools)
        require(WRITE_TOOLS <= {name.split("__")[-1] for name in tools},
                f"Native MCP tools missing: {tools}")
    return {**evidence, "status": "passed"}


async def write_protocol(args, result, project, settings):
    from mcp import ClientSession, StdioServerParameters, types
    from mcp.client.stdio import stdio_client

    roots_requested = 0

    async def roots(_context):
        nonlocal roots_requested
        roots_requested += 1
        return types.ListRootsResult(roots=[types.Root(uri=project.as_uri())])

    evidence = {"status": "running", "source": "mcp stdio_client / ClientSession", "roots": [project.as_uri()]}
    result["checks"]["mcpProtocol"] = evidence
    parameters = StdioServerParameters(
        command=settings["command"], args=settings["args"],
        env={**os.environ, **settings.get("env", {})}, cwd=str(project),
    )
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write, list_roots_callback=roots) as client:
            initialized = await client.initialize()
            evidence["initialize"] = initialized.model_dump(mode="json", by_alias=True, exclude_none=True)
            tools = {}
            cursor = None
            for _ in range(20):
                page = await client.list_tools(cursor=cursor)
                tools.update((tool.name, tool) for tool in page.tools)
                cursor = page.nextCursor
                if not cursor:
                    break
            require(not cursor, "MCP tool pagination exceeded the fixture bound")
            evidence.update({"toolCount": len(tools), "tools": sorted(tools), "annotations": {}})
            for name in sorted(WRITE_TOOLS):
                require(name in tools, f"Missing MCP tool: {name}")
                annotations = tools[name].annotations
                evidence["annotations"][name] = annotations.model_dump(by_alias=True) if annotations else None
                require(annotations is not None and annotations.readOnlyHint is False,
                        f"MCP write tool must have readOnlyHint=False: {name}")
            plan = {"name": "Native protocol fixture", "overview": "Local protocol only; no business acceptance", "suites": []}
            outside, inside = project / "denied-plan.md", project / ".agent-vault-tests/specs/protocol.md"
            require(not outside.exists() and not inside.exists(), "Plan probes must start absent")
            denied = await client.call_tool("planner_save_plan", {**plan, "fileName": outside.name})
            evidence["outsideWrite"] = denied.model_dump(mode="json", by_alias=True, exclude_none=True)
            require(denied.isError is True and not outside.exists(), "Plan write outside specs was not denied")
            allowed = await client.call_tool("planner_save_plan", {
                **plan, "fileName": ".agent-vault-tests/specs/protocol.md",
            })
            evidence["insideWrite"] = allowed.model_dump(mode="json", by_alias=True, exclude_none=True)
            require(not allowed.isError and inside.is_file() and inside.stat().st_size > 0,
                    "Plan write inside managed specs failed")
            seed = project / ".agent-vault-tests/tests/seed.spec.ts"
            before = seed.read_bytes()
            schema = tools["generator_write_test"].inputSchema
            evidence["generatorInputSchema"] = schema
            properties = schema.get("properties", {})
            code_field = next((name for name in ("code", "testCode")
                               if properties.get(name, {}).get("type") == "string"), None)
            if (not code_field or properties.get("fileName", {}).get("type") != "string"
                    or not set(schema.get("required", [])) <= {"fileName", code_field}):
                evidence.update({"status": "unsupported", "rootsCallbackCount": roots_requested,
                                 "reason": "Cannot construct a valid seed overwrite probe from the returned generator schema"})
                return evidence
            arguments = {"fileName": ".agent-vault-tests/tests/seed.spec.ts",
                         code_field: before.decode("utf-8-sig") + "\n// Fixture overwrite probe; must be rejected.\n"}
            rejected = await client.call_tool("generator_write_test", arguments)
            after = seed.read_bytes()
            message = " ".join(getattr(item, "text", "") for item in rejected.content)
            evidence["managedSeedWrite"] = {
                "status": "running", "fileName": arguments["fileName"],
                "beforeSha256": hashlib.sha256(before).hexdigest(),
                "afterSha256": hashlib.sha256(after).hexdigest(),
                "response": rejected.model_dump(mode="json", by_alias=True, exclude_none=True),
            }
            require(rejected.isError is True and "bootstrap files" in message.lower(),
                    "Seed overwrite was not rejected by the managed bootstrap guard")
            require(before == after, "Managed seed was altered by generator_write_test")
            evidence["managedSeedWrite"]["status"] = "passed"
    evidence["rootsCallbackCount"] = roots_requested
    require(roots_requested > 0, "MCP server never requested the provided project roots")
    return {**evidence, "status": "passed"}


async def codex_config(args, result, project, settings):
    config_path = project / ".codex/config.toml"
    parsed = tomllib.loads(config_path.read_text(encoding="utf-8"))
    require(parsed["mcp_servers"][SERVER] == settings, "Client MCP registrations differ")
    # This HOME contains trust only. Never inject an MCP table or use -c overrides:
    # mcp get must consume the actual project TOML written by the package manager.
    home_config = Path(os.environ["CODEX_HOME"]) / "config.toml"
    require(not home_config.exists(), "Codex home must start without configuration")
    home_config.write_text(f"[projects.{json.dumps(str(project))}]\ntrust_level = \"trusted\"\n", encoding="utf-8")
    payload = json.loads(await command(args, result, [args.codex_cli, "-C", project,
                                                   "mcp", "get", SERVER, "--json"], project))
    evidence = {"status": "running", "source": "native codex mcp get --json",
                "homeConfigContains": "temporary project trust only", "projectConfig": str(config_path),
                "projectConfigSha256": hashlib.sha256(config_path.read_bytes()).hexdigest(), "response": payload}
    result["checks"]["codexConfig"] = evidence
    require(payload.get("name") == SERVER and payload.get("enabled") is True, "Codex did not load the enabled project MCP")
    transport = payload.get("transport", {})
    require(transport.get("type") == "stdio", "Codex MCP transport is not stdio")
    require(same_path(transport.get("command", ""), settings["command"]),
            "Codex loaded a different MCP command")
    require(transport.get("args") == settings["args"], "Codex loaded different MCP arguments")
    require(transport.get("env") == settings.get("env"), "Codex loaded different MCP environment")
    return {**evidence, "status": "passed"}


async def codex_skills(args, result, project):
    argv = [str(args.codex_cli), "-C", str(project), "app-server"]
    evidence = {"status": "running", "source": "native Codex app-server JSON RPC",
                "argv": argv, "requests": [], "notificationCount": 0, "serverRequestCount": 0}
    result["checks"]["codexSkills"] = evidence
    process = await asyncio.create_subprocess_exec(
        *argv, cwd=project, env=dict(os.environ), stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        limit=4 * 1024 * 1024, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    stderr_task = asyncio.create_task(capture(process.stderr))

    async def send(payload):
        evidence["requests"].append(payload)
        process.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
        await process.stdin.drain()

    async def request(request_id, method, params):
        await send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        for _ in range(200):
            line = await process.stdout.readline()
            require(line, f"Codex app-server closed before responding to {method}")
            message = json.loads(line)
            if message.get("id") == request_id and "method" not in message:
                return message
            if "id" in message and "method" in message:
                evidence["serverRequestCount"] += 1
                await send({"jsonrpc": "2.0", "id": message["id"], "error": {
                    "code": -32601, "message": "Fixture supports discovery only",
                }})
            else:
                evidence["notificationCount"] += 1
        raise AssertionError("Codex app-server message bound exceeded")

    try:
        initialized = await request(1, "initialize", {
            "clientInfo": {"name": "vault_native_fixture", "title": "Vault native fixture", "version": "1.0.0"},
            "capabilities": {"experimentalApi": True},
        })
        evidence["initialize"] = initialized
        if initialized.get("error", {}).get("code") == -32601:
            evidence.update({"status": "unsupported", "reason": "Native app-server has no initialize method"})
            return evidence
        require("error" not in initialized, f"Codex initialization failed: {initialized}")
        await send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
        response = await request(2, "skills/list", {"cwds": [str(project)], "forceReload": True})
        evidence["skillsResponse"] = response
        if response.get("error", {}).get("code") == -32601:
            evidence.update({"status": "unsupported", "reason": "Native app-server has no skills/list method"})
            return evidence
        require("error" not in response, f"Native skills/list failed: {response}")
        rows = response.get("result", {}).get("data")
        require(isinstance(rows, list), "Unrecognized native skills/list response; see recorded protocol")
        project_rows = [row for row in rows if same_path(row.get("cwd", ""), project)]
        require(len(project_rows) == 1, "Native skills/list did not return the requested project")
        row = project_rows[0]
        require(not row.get("errors"), f"Native skill loading errors: {row.get('errors')}")
        skills = row.get("skills", [])
        evidence.update({"skillCount": len(skills), "sourceCounts": dict(Counter(item.get("scope", "unknown") for item in skills)),
                         "discoveredNames": names(skills)})
        for name in ([SKILL, "impeccable"] if args.impeccable_component else [SKILL]):
            matches = [item for item in skills if item.get("name") == name]
            expected = project / ".agents/skills" / name / "SKILL.md"
            require(any(same_path(item.get("path", ""), expected)
                        and item.get("enabled", item.get("isEnabled")) is not False
                        for item in matches), f"Native enabled project skill not discovered: {name}")
        evidence["status"] = "passed"
        return evidence
    finally:
        await close_process(process)
        try:
            diagnostic, discarded = await asyncio.wait_for(stderr_task, 5)
            evidence.update({"stderr": diagnostic, "stderrDiscardedBytes": discarded, "exitCode": process.returncode})
        finally:
            if not stderr_task.done():
                stderr_task.cancel()
            await asyncio.gather(stderr_task, return_exceptions=True)


async def worker(args):
    result = read_json(args.output / "native-result.json")
    project = args.output / "project"
    project.mkdir()
    (project / ".claude").mkdir()
    result["project"] = str(project)
    checks = result["checks"]

    def audit(event, values):
        if event == "subprocess.Popen":
            executable, argv, cwd, _environment = values
            launches = result.setdefault("processLaunches", [])
            if len(launches) < 200:
                launches.append({"executable": os.fsdecode(executable) if executable is not None else None,
                                 "argv": argv if isinstance(argv, str) else list(map(os.fsdecode, argv)),
                                 "cwd": os.fsdecode(cwd) if cwd is not None else None})

    # Record the SDK's actual subprocess arguments without recording its env.
    sys.addaudithook(audit)

    async def check(name, operation, timeout):
        checks[name] = {"status": "running"}
        save(args.output, result)
        try:
            checks[name] = await asyncio.wait_for(operation, timeout)
        except Exception as error:
            checks[name].update({"status": "failed", "error": error_text(error)})
        save(args.output, result)
        return checks[name]["status"] == "passed"

    try:
        import claude_agent_sdk
        import mcp

        result["versions"].update({
            "claude-agent-sdk": metadata.version("claude-agent-sdk"), "mcp": metadata.version("mcp"),
            "pywin32": metadata.version("pywin32"),
            "sdkModule": str(Path(claude_agent_sdk.__file__).resolve()), "mcpModule": str(Path(mcp.__file__).resolve()),
        })
        ready = await check("management", management(args, result, project), 600)
        if ready:
            settings = read_json(project / ".mcp.json")["mcpServers"][SERVER]
            await check("claude", claude_discovery(args, result, project), 120)
            await check("mcpProtocol", write_protocol(args, result, project, settings), 60)
            if args.codex_cli:
                await check("codexConfig", codex_config(args, result, project, settings), 45)
                await check("codexSkills", codex_skills(args, result, project), 60)
            else:
                checks["codexConfig"] = checks["codexSkills"] = {"status": "not-requested", "reason": "No --codex-cli supplied"}
        else:
            for name in ("claude", "mcpProtocol", "codexConfig", "codexSkills"):
                checks[name] = {"status": "blocked", "reason": "Component preparation failed"}
    except Exception as error:
        result["errors"].append(error_text(error))
    statuses = [item["status"] for item in checks.values()]
    result["counts"] = dict(Counter(statuses))
    failed = bool(result["errors"]) or any(status in {"failed", "blocked", "running"} for status in statuses)
    result["status"] = "failed" if failed else "partial" if "unsupported" in statuses else "passed"
    result["passed"] = result["status"] == "passed"
    result["finishedUtc"] = datetime.now(timezone.utc).isoformat()
    save(args.output, result)
    return 0 if result["passed"] else 2 if result["status"] == "partial" else 1


def supervise(args, result, environment):
    # Start suspended so no child can escape ownership before job assignment.
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
        argv = [sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--_worker",
                "--component", str(args.component), "--output", str(args.output),
                "--claude-cli", str(args.claude_cli), "--runtime-root", str(args.runtime_root)]
        for option, value in (("--codex-cli", args.codex_cli), ("--impeccable-component", args.impeccable_component)):
            if value:
                argv.extend([option, str(value)])
        result["supervision"] = {"argv": argv, "timeoutSeconds": RUN_TIMEOUT, "mechanism": "Windows Job Object; kill on close"}
        save(args.output, result)
        process, thread, pid, _ = win32process.CreateProcess(
            sys.executable, subprocess.list2cmdline(argv), None, None, False,
            win32con.CREATE_SUSPENDED | win32con.CREATE_NO_WINDOW, environment,
            str(args.output), win32process.STARTUPINFO(),
        )
        win32job.AssignProcessToJobObject(job, process)
        result["supervision"].update({"workerPid": pid, "assignedToJob": True})
        save(args.output, result)
        win32process.ResumeThread(thread)
        outcome = win32event.WaitForSingleObject(process, RUN_TIMEOUT * 1000)
        if outcome != win32event.WAIT_OBJECT_0:
            raise TimeoutError(f"Native fixture worker {pid} exceeded {RUN_TIMEOUT}s")
        return win32process.GetExitCodeProcess(process)
    finally:
        # Also clean up if assignment/resume failed while the worker was suspended.
        try:
            if process and win32process.GetExitCodeProcess(process) == win32con.STILL_ACTIVE:
                win32process.TerminateProcess(process, 1)
        finally:
            try:
                win32api.CloseHandle(job)
                latest = read_json(args.output / "native-result.json")
                latest["supervision"]["jobClosed"] = True
                if process:
                    win32event.WaitForSingleObject(process, 5000)
                    latest["supervision"]["workerExitCode"] = win32process.GetExitCodeProcess(process)
                save(args.output, latest)
            finally:
                if process:
                    win32api.CloseHandle(process)
                if thread:
                    win32api.CloseHandle(thread)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--component", type=absolute, required=True, help="Extracted Playwright component root")
    parser.add_argument("--output", type=absolute, required=True, help="New isolated absolute evidence directory")
    parser.add_argument("--claude-cli", type=absolute, required=True, help="Native claude.exe, never an npm wrapper")
    parser.add_argument("--codex-cli", type=absolute, help="Native codex.exe; omit to record Codex as not requested")
    parser.add_argument("--runtime-root", type=absolute, help="Explicit shared isolated runtime base")
    parser.add_argument("--impeccable-component", type=absolute, help="Optional extracted Impeccable 1.0.0 package root")
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    require(sys.platform == "win32", "This fixture requires Windows native clients")
    args.runtime_root = args.runtime_root or args.output / "runtimes"
    if args._worker:
        return asyncio.run(worker(args))
    require(not args.output.exists(), "--output must be a new directory, never an existing project or home")
    require(not args.component.is_relative_to(args.output), "Output cannot contain the component input")
    require(not args.output.is_relative_to(args.component), "Output must be separate from the component input")
    for executable in (args.claude_cli, args.codex_cli, args.component / "bin/node.exe"):
        if executable:
            native_executable(executable)
    git = shutil.which("git")
    require(git, "A development Git executable is required to isolate native project discovery")
    source = {"playwright": package_info(args.component, "playwright-test")}
    require((args.component / "scripts/manage.cjs").is_file(), "Missing package management script")
    if args.impeccable_component:
        require(not args.impeccable_component.is_relative_to(args.output)
                and not args.output.is_relative_to(args.impeccable_component), "Output must be separate from Impeccable input")
        source["impeccable"] = package_info(args.impeccable_component, "impeccable")
        require((args.impeccable_component / "manage.ps1").is_file(), "Missing Impeccable management script")
    args.output.mkdir(parents=True)
    result = {
        "schemaVersion": 1, "status": "running", "passed": False,
        "startedUtc": datetime.now(timezone.utc).isoformat(), "modelTurnSubmitted": False,
        "source": source, "versions": {"python": sys.version, "pythonExecutable": sys.executable},
        "invocation": [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]],
        "runtimeBase": str(args.runtime_root), "commands": [], "checks": {}, "errors": [],
        "supervision": {"jobClosed": False, "assignedToJob": False},
        "limits": ["Initialization/discovery and local MCP protocol only; no model selection or UI acceptance",
                   "No company systems, credentials, business cases, or live model services",
                   "Codex mcp get proves project configuration consumption, not a Codex model tool invocation"],
    }
    save(args.output, result)
    try:
        code = supervise(args, result, isolated_environment(args, git))
        result = read_json(args.output / "native-result.json")
        if result["status"] == "running":
            raise RuntimeError(f"Worker exited {code} before completing its evidence")
    except BaseException as error:
        result = read_json(args.output / "native-result.json")
        result.update({"status": "failed", "passed": False})
        result["errors"].append(error_text(error))
        code = 1
    result["fixtureExitCode"] = code
    save(args.output, result)
    print(json.dumps({"status": result["status"], "passed": result["passed"],
                      "modelTurnSubmitted": False, "counts": result.get("counts", {}),
                      "result": str(args.output / "native-result.json")}, ensure_ascii=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
