"""Opt-in upstream auto-capture fixture using synthetic loopback inference only."""

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def absolute(value):
    path = Path(value)
    if not path.is_absolute():
        raise argparse.ArgumentTypeError("Use an absolute path")
    path = path.absolute()
    for parent in (path, *path.parents):
        if parent.is_symlink() or parent.is_junction():
            raise argparse.ArgumentTypeError("Linked paths are unsupported")
    return path


class Commands:
    """Suspend each child until it belongs to our kill-on-close Windows job."""

    def __init__(self, output, cwd, env):
        import win32job
        self.output, self.cwd, self.env = output, cwd, env
        self.count = 0
        self.job = win32job.CreateJobObject(None, "")
        limits = win32job.QueryInformationJobObject(self.job, win32job.JobObjectExtendedLimitInformation)
        limits["BasicLimitInformation"]["LimitFlags"] = win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        win32job.SetInformationJobObject(self.job, win32job.JobObjectExtendedLimitInformation, limits)

    def run(self, argv, payload=b"", timeout=45):
        import msvcrt
        import win32api
        import win32con
        import win32event
        import win32job
        import win32process
        self.count += 1
        prefix = self.output / f"command-{self.count:02}"
        handles = []
        process = thread = None
        with tempfile.TemporaryFile() as incoming, prefix.with_suffix(".out").open("w+b") as out, prefix.with_suffix(".err").open("w+b") as err:
            incoming.write(payload)
            incoming.seek(0)
            startup = win32process.STARTUPINFO()
            startup.dwFlags = win32process.STARTF_USESTDHANDLES | win32process.STARTF_USESHOWWINDOW
            startup.wShowWindow = win32con.SW_HIDE
            for name, stream in (("hStdInput", incoming), ("hStdOutput", out), ("hStdError", err)):
                handle = msvcrt.get_osfhandle(stream.fileno())
                win32api.SetHandleInformation(handle, win32con.HANDLE_FLAG_INHERIT, win32con.HANDLE_FLAG_INHERIT)
                handles.append(handle)
                setattr(startup, name, handle)
            try:
                process, thread, _, _ = win32process.CreateProcess(
                    None, subprocess.list2cmdline([str(arg) for arg in argv]), None, None, True,
                    win32process.CREATE_SUSPENDED | win32process.CREATE_NO_WINDOW,
                    self.env, str(self.cwd), startup)
                win32job.AssignProcessToJobObject(self.job, process)
                win32process.ResumeThread(thread)
                if win32event.WaitForSingleObject(process, int(timeout * 1000)) == win32con.WAIT_TIMEOUT:
                    # This job contains only fixture-created commands and their descendants.
                    win32job.TerminateJobObject(self.job, 124)
                    win32event.WaitForSingleObject(process, 5000)
                    raise TimeoutError(f"Command {self.count} exceeded {timeout}s")
                code = win32process.GetExitCodeProcess(process)
                out.seek(0)
                err.seek(0)
                stdout = out.read(2 * 1024 * 1024).decode("utf-8-sig", errors="replace")
                stderr = err.read(2 * 1024 * 1024).decode("utf-8-sig", errors="replace")
                if code:
                    raise RuntimeError(f"Command {self.count} exited {code}: {(stderr or stdout)[-1500:]}")
                return stdout
            finally:
                for handle in handles:
                    win32api.SetHandleInformation(handle, win32con.HANDLE_FLAG_INHERIT, 0)
                if thread is not None:
                    thread.Close()
                if process is not None:
                    process.Close()

    def close(self):
        self.job.Close()


class ModelFixture:
    def __init__(self, marker):
        self.marker = marker
        self.requests = []
        self.seen = threading.Event()
        self.release = threading.Event()
        self.errors = []
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 0 < size <= 8 * 1024 * 1024:
                        self.send_error(413)
                        return
                    body = json.loads(self.rfile.read(size))
                    if self.path.split("?")[0].endswith("/messages/count_tokens"):
                        self.respond({"input_tokens": 100})
                        return
                    if self.path.split("?")[0] != "/v1/messages":
                        self.send_error(404)
                        return
                    prompt = json.dumps(body.get("messages", []))
                    summary = "ONLY accepted root tag is <summary>" in prompt
                    fixture.requests.append({
                        "path": self.path, "model": body.get("model"), "stream": body.get("stream", False),
                        "markerInPrompt": fixture.marker in prompt,
                        "syntheticAuth": self.headers.get("x-api-key") == "vault-capture-fixture-only"
                        or self.headers.get("Authorization") == "Bearer vault-capture-fixture-only",
                        "userAgent": self.headers.get("User-Agent"), "summary": summary,
                        "sdkVersion": self.headers.get("x-stainless-package-version"),
                    })
                    fixture.seen.set()
                    fixture.release.wait(25)
                    text = (f"<summary><request>Read fixture marker</request><investigated>marker.txt</investigated>"
                            f"<learned>{fixture.marker}</learned><completed>Marker observed</completed>"
                            "<next_steps>None</next_steps><notes>Loopback fixture</notes></summary>") if summary else (
                        "<observation><type>discovery</type><title>Vault loopback automatic observation</title>"
                        f"<subtitle>Synthetic Read tool result</subtitle><facts><fact>{fixture.marker}</fact></facts>"
                        "<narrative>The synthetic Read returned the fixture marker.</narrative>"
                        "<concepts><concept>how-it-works</concept></concepts>"
                        "<files_read><file>marker.txt</file></files_read><files_modified></files_modified></observation>")
                    message = {"id": "msg_" + uuid.uuid4().hex, "type": "message", "role": "assistant",
                               "model": body.get("model"), "content": [{"type": "text", "text": text}],
                               "stop_reason": "end_turn", "stop_sequence": None,
                               "usage": {"input_tokens": 100, "output_tokens": 100}}
                    if not body.get("stream"):
                        self.respond(message)
                        return
                    events = [
                        ("message_start", {"message": {**message, "content": [], "stop_reason": None}}),
                        ("content_block_start", {"index": 0, "content_block": {"type": "text", "text": ""}}),
                        ("content_block_delta", {"index": 0, "delta": {"type": "text_delta", "text": text}}),
                        ("content_block_stop", {"index": 0}),
                        ("message_delta", {"delta": {"stop_reason": "end_turn", "stop_sequence": None},
                                           "usage": {"output_tokens": 100}}),
                        ("message_stop", {}),
                    ]
                    payload = "".join("event: " + kind + "\ndata: " + json.dumps({"type": kind, **data}) + "\n\n"
                                      for kind, data in events).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception as exc:
                    fixture.errors.append(type(exc).__name__ + ": " + str(exc))
                    self.send_error(500)

            def respond(self, value):
                payload = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return f"http://127.0.0.1:{self.server.server_port}"

    def close(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)


def observation(data, marker):
    for db in data.rglob("*.db"):
        try:
            with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True, timeout=1) as connection:
                names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if "observations" not in names:
                    continue
                columns = {row[1] for row in connection.execute("PRAGMA table_info(observations)")}
                if not {"id", "title", "narrative", "facts"} <= columns:
                    continue
                row = connection.execute(
                    "SELECT id,title,narrative,facts FROM observations WHERE facts LIKE ? OR narrative LIKE ?",
                    ("%" + marker + "%", "%" + marker + "%")).fetchone()
                if row:
                    return {"database": str(db), "table": "observations", "id": row[0], "title": row[1],
                            "markerPersisted": marker in str(row[2:])}
        except sqlite3.Error:
            continue
    return None


def ingestion_counts(data):
    database = data / "claude-mem.db"
    if not database.exists():
        return {"databaseExists": False}
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=2) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        return {"databaseExists": True, **{
            table: connection.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
            for table in ("sdk_sessions", "user_prompts", "pending_messages", "observations") if table in tables}}


def main(args):
    if sys.platform != "win32":
        raise RuntimeError("This fixture validates the Windows owned worker lifecycle")
    source_component, output = args.component, args.output
    output.mkdir(parents=True, exist_ok=False)
    source_manifest = source_component / "manifest.json"
    manifest = json.loads(source_manifest.read_text(encoding="utf-8-sig"))
    # Stable payload files can share disk blocks; adapters are independent copies.
    # All writes, including the development ownership stamp, target our clone.
    component = source_component if args.use_existing_runtime else output / "runtime"
    if not args.use_existing_runtime:
        component.mkdir()
        for name in [*manifest["files"], "manifest.json"]:
            relative = Path(name)
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Unsafe manifest path")
            incoming, copied = source_component / relative, component / relative
            if incoming.is_symlink() or incoming.is_junction():
                raise ValueError("Linked payload file")
            copied.parent.mkdir(parents=True, exist_ok=True)
            if name.startswith("scripts/") or name == "manifest.json":
                shutil.copyfile(incoming, copied)
            else:
                os.link(incoming, copied)
    scratch = args.scratch_root
    if any((parent / ".git").exists() for parent in (scratch, *scratch.parents)):
        raise ValueError("Scratch root must be outside Git")
    scratch.mkdir(parents=True, exist_ok=True)
    trial = Path(tempfile.mkdtemp(prefix="capture-", dir=scratch))
    project, home, data = trial / "project", trial / "native-home", trial / "data"
    for directory in (project, home, trial / "os-home", trial / "tmp", trial / "appdata", trial / "localappdata"):
        directory.mkdir()
    manifest_file = component / "manifest.json"
    stamp = {"owner": "AgentPluginSkillVault", "componentId": "claude-mem",
             "componentVersion": "1.0.0", "manifestSha256": digest(manifest_file)}
    stamp_path = component / ".vault-runtime.json"
    if stamp_path.exists():
        if json.loads(stamp_path.read_text(encoding="utf-8-sig")) != stamp:
            raise ValueError("Existing runtime stamp does not match the stage")
    else:
        with stamp_path.open("x", encoding="utf-8") as stream:
            json.dump(stamp, stream, indent=2)
    marker = "VAULT_CAPTURE_" + uuid.uuid4().hex
    model = ModelFixture(marker)
    endpoint = model.start()
    native_settings = {"model": "haiku", "env": {"ANTHROPIC_BASE_URL": endpoint,
                       "ANTHROPIC_API_KEY": "vault-capture-fixture-only",
                       "ANTHROPIC_DEFAULT_HAIKU_MODEL": "fixture-memory-model"}}
    write_json(home / "settings.json", native_settings)
    settings_before = digest(home / "settings.json")
    env = {key: value for key, value in os.environ.items() if key.upper() in {
        "SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "OS", "PROCESSOR_ARCHITECTURE", "PROGRAMFILES"}}
    env.update(USERPROFILE=str(trial / "os-home"), HOME=str(trial / "os-home"),
               APPDATA=str(trial / "appdata"), LOCALAPPDATA=str(trial / "localappdata"),
               TEMP=str(trial / "tmp"), TMP=str(trial / "tmp"), CLAUDE_CONFIG_DIR=str(home),
               HTTP_PROXY="", HTTPS_PROXY="", ALL_PROXY="", NO_PROXY="127.0.0.1,localhost",
               DISABLE_TELEMETRY="1", DISABLE_ERROR_REPORTING="1", DISABLE_AUTOUPDATER="1",
               CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1", DO_NOT_TRACK="1")
    commands = Commands(output, project, env)
    powershell = Path(env.get("SystemRoot", env.get("SYSTEMROOT", "C:/Windows"))) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    options = {"runtime": str(component), "project": str(project), "dataRoot": str(data), "claudeHome": str(home)}
    node = component / "bin/node.exe"
    module = component / "scripts/runtime.cjs"
    report = {"passed": False, "kind": "developer-loopback-capture", "liveModelRequests": 0,
              "trial": str(trial), "component": str(component), "manifestSha256": stamp["manifestSha256"],
              "sourceComponent": str(source_component),
              "upstream": manifest.get("upstream"), "events": [], "scope": "synthetic native Hook bridge; no UI validation"}
    running = None

    def service(action, extra=None, timeout=80):
        script = "const s=require(process.argv[1]);Promise.resolve().then(()=>{const o=JSON.parse(process.argv[3]);return process.argv[2]==='ownership'?s.ownership(s.location(o),true):s[process.argv[2]](o)}).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.message);process.exitCode=1});"
        return json.loads(commands.run([node, "-e", script, module, action, json.dumps({**options, **(extra or {})})], timeout=timeout))

    def hook(event, action, fields):
        payload = {"session_id": session, "cwd": str(project), "hook_event_name": event, **fields}
        argv = [node, component / "scripts/bridge.cjs", "--mode", "hook", "--runtime", component,
                "--project", project, "--data-root", data, "--claude-home", home,
                "--event", action, "--observer", "true"]
        started = time.monotonic()
        result = commands.run(argv, json.dumps(payload).encode(), timeout=125)
        report["events"].append({"event": event, "action": action, "seconds": round(time.monotonic() - started, 2),
                                 "output": result[:4096]})
        print(event + " completed", flush=True)

    def observer_acl(directory):
        commands.env["VAULT_CAPTURE_ACL_DIRECTORY"] = str(directory)
        script = r"""$ErrorActionPreference='Stop'
function Facts([string]$target) {
  $acl=Get-Acl -LiteralPath $target
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {
    @{sid=$_.IdentityReference.Value; inherited=$_.IsInherited; type=[string]$_.AccessControlType; rights=[long]$_.FileSystemRights}
  })
  return @{protected=$acl.AreAccessRulesProtected; rules=$rules}
}
@{currentSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
  directory=(Facts $env:VAULT_CAPTURE_ACL_DIRECTORY);
  file=(Facts (Join-Path $env:VAULT_CAPTURE_ACL_DIRECTORY 'observer.env'))} | ConvertTo-Json -Depth 6 -Compress"""
        facts = json.loads(commands.run([powershell, "-NoProfile", "-NonInteractive", "-Command", script], timeout=20))
        allowed = {facts["currentSid"], "S-1-5-18"}
        if not facts["directory"]["protected"]:
            raise AssertionError("Observer environment parent DACL inherits outside access")
        for label in ("directory", "file"):
            rules = facts[label]["rules"]
            if {rule["sid"] for rule in rules} != allowed or len(rules) != len(allowed):
                raise AssertionError("Unexpected observer environment ACL principals")
            if any(rule["type"] != "Allow" or rule["rights"] & 0x1F01FF != 0x1F01FF for rule in rules):
                raise AssertionError("Unexpected observer environment ACL permissions")
            if label == "directory" and any(rule["inherited"] for rule in rules):
                raise AssertionError("Observer environment parent has inherited ACL entries")
        return facts

    def stop_owned():
        report["cleanupAttempts"] = []
        for attempt in range(2):
            try:
                stopped = service("stop")
                report["cleanupAttempts"].append({"attempt": attempt + 1, "status": stopped["status"]})
                return stopped
            except RuntimeError as exc:
                message = str(exc)
                report["cleanupAttempts"].append({"attempt": attempt + 1, "error": message})
                if attempt or "Command failed:" not in message or "Get-CimInstance Win32_Process" not in message:
                    raise

    try:
        # Verify only the files exercised here; this is not an install/release verification.
        checked = []
        adapters = sorted(name for name in manifest["files"] if name.startswith("scripts/"))
        for name in ("bin/node.exe", "bin/bun.exe", "plugin/scripts/worker-service.cjs", *adapters):
            if digest(component / name) != manifest["files"][name]:
                raise ValueError("Stage changed or has invalid file: " + name)
            checked.append(name)
        report["verifiedFixtureFiles"] = checked
        report["adapterHashes"] = {name: manifest["files"][name] for name in adapters}
        worker_source = (component / "plugin/scripts/worker-service.cjs").read_text(encoding="utf-8")
        sdk = re.search(r'CLAUDE_AGENT_SDK_VERSION\|\|\([^=]*="([^"]+)"', worker_source)
        report["embeddedSdkVersion"] = sdk.group(1) if sdk else "unresolved"
        del worker_source
        report["nodeVersion"] = commands.run([node, "--version"]).strip()
        report["bunVersion"] = commands.run([component / "bin/bun.exe", "--version"]).strip()
        receipt = {"owner": "AgentPluginSkillVault", "componentId": "claude-mem", "protocolVersion": 1,
                   "enabled": True, "capture": True, "runtimeRoot": str(component),
                   "dataRoot": str(data), "claudeHome": str(home)}
        write_json(project / ".agent-vault/claude-mem/claude/project.json", receipt)
        loc = service("location")
        service("ownership")
        if args.claude_cli:
            write_json(Path(loc["dataDirectory"]) / "settings.json", {"CLAUDE_CODE_PATH": str(args.claude_cli)})
        running = service("start", {"observer": True})
        report["worker"] = running
        actual_settings = json.loads((Path(running["dataDirectory"]) / "settings.json").read_text(encoding="utf-8-sig"))
        report["workerConnectionFacts"] = {key: actual_settings.get(key) for key in (
            "CLAUDE_MEM_DATA_DIR", "CLAUDE_CODE_PATH", "CLAUDE_MEM_MODEL", "CLAUDE_MEM_PROVIDER",
            "CLAUDE_MEM_OBSERVER_ENABLED", "CLAUDE_MEM_CLAUDE_AUTH_METHOD", "CLAUDE_MEM_CLAUDE_CONFIG_DIR")}
        report["cliSelection"] = "explicit upstream settings path" if args.claude_cli else "upstream native discovery"
        report["observerEnvironmentAcl"] = observer_acl(Path(running["dataDirectory"]) / "native-empty")
        report["observerParentAclProtected"] = True
        if running.get("reused") or not running.get("observer"):
            raise AssertionError("Expected a new isolated observer")
        if model.requests:
            raise AssertionError("Worker startup unexpectedly submitted a model turn")
        session = str(uuid.uuid4())
        marker_file = project / "marker.txt"
        marker_file.write_text(marker + "\n", encoding="utf-8")
        hook("SessionStart", "context", {"source": "startup"})
        hook("UserPromptSubmit", "session-init", {"prompt": "Read marker.txt and remember the synthetic marker for this fixture."})
        hook("PostToolUse", "observation", {"tool_name": "Read", "tool_use_id": "toolu_fixture",
             "tool_input": {"file_path": str(marker_file)}, "tool_response": {"file": {"filePath": str(marker_file), "content": marker}}})
        report["ingestionAfterHooks"] = ingestion_counts(Path(running["dataDirectory"]))
        if not model.seen.wait(args.observation_timeout):
            raise TimeoutError("No loopback observer model request after PostToolUse")
        ps = (f"$rows=@();$parents=@({running['pid']});for($i=0;$i -lt 5 -and $parents.Count;$i++)"
              "{$next=@();foreach($p in $parents){$children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$p));"
              "$rows+=@($children | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine);"
              "$next+=@($children | ForEach-Object {$_.ProcessId})};$parents=$next};ConvertTo-Json -InputObject @($rows) -Compress")
        report["observerProcesses"] = json.loads(commands.run([powershell, "-NoProfile", "-NonInteractive", "-Command", ps], timeout=20))
        model.release.set()
        deadline = time.monotonic() + args.observation_timeout
        while time.monotonic() < deadline:
            found = observation(Path(running["dataDirectory"]), marker)
            if found:
                report["automaticObservation"] = found
                break
            time.sleep(0.5)
        else:
            raise TimeoutError("Observer request completed but no matching SQLite observation persisted")
        hook("Stop", "summarize", {"last_assistant_message": "Synthetic marker read successfully.", "stop_hook_active": False})
        report["health"] = json.loads(urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
            running["url"] + "/api/health", timeout=5).read())
        observed = [row for row in report["observerProcesses"] if "--output-format" in (row.get("CommandLine") or "")]
        if not observed:
            raise AssertionError("No actual observer CLI process identity captured")
        report["actualCli"] = observed
        for row in observed:
            executable = Path(row["ExecutablePath"])
            if executable.name.lower() == "claude.exe":
                report["actualCliVersion"] = commands.run([executable, "--version"], timeout=20).strip()
                break
        if not all(request["syntheticAuth"] for request in model.requests):
            raise AssertionError("Observer did not use synthetic native-home credentials")
        if not any(request["markerInPrompt"] for request in model.requests):
            raise AssertionError("Synthetic tool result was absent from observer prompts")
        report["nativeSettingsPreserved"] = digest(home / "settings.json") == settings_before
        report["passed"] = report["nativeSettingsPreserved"] and not model.errors
    except Exception as exc:
        report["error"] = type(exc).__name__ + ": " + str(exc)
    finally:
        model.release.set()
        if running:
            try:
                report["ingestionFinal"] = ingestion_counts(Path(running["dataDirectory"]))
            except sqlite3.Error as exc:
                report["ingestionDiagnosticError"] = type(exc).__name__
        try:
            # Every generation in this unique private directory belongs to this run.
            report["cleanup"] = stop_owned()
            report["ownedWorkerStopped"] = report["cleanup"]["status"] == "stopped"
            report["sameWorkerGeneration"] = bool(running and report["cleanup"].get("generation") == running["generation"])
            private_directory = Path(report["cleanup"]["dataDirectory"]) / "native-empty"
            report["observerEnvironmentRemoved"] = not (private_directory / "observer.env").exists()
            report["observerEnvironmentTemporariesRemoved"] = not any(private_directory.glob("observer.env.tmp-*"))
        except Exception as exc:
            report["cleanupError"] = type(exc).__name__ + ": " + str(exc)
            report["ownedWorkerStopped"] = False
        commands.close()
        model.close()
        report.update(localModelRequests=len(model.requests), modelTurnSubmitted=bool(model.requests),
                      modelRequests=model.requests, fixtureErrors=model.errors,
                      cleanupJobClosed=True, elapsedSeconds=round(time.monotonic() - args.started, 2))
        report["passed"] = bool(report["passed"] and report["ownedWorkerStopped"] and report.get("sameWorkerGeneration")
                                and report.get("observerParentAclProtected") and report.get("observerEnvironmentRemoved")
                                and report.get("observerEnvironmentTemporariesRemoved"))
        write_json(output / "result.json", report)
    print(json.dumps(report, indent=2), flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="Explicitly authorize synthetic local model turns")
    parser.add_argument("--component", type=absolute, required=True)
    parser.add_argument("--output", type=absolute, required=True)
    parser.add_argument("--scratch-root", type=absolute, required=True, help="Private base outside every Git tree")
    parser.add_argument("--claude-cli", type=absolute, help="Optional explicit native CLI; default tests upstream discovery")
    parser.add_argument("--use-existing-runtime", action="store_true", help="Use an explicitly owned developer runtime directly; creates only its development stamp if absent")
    parser.add_argument("--observation-timeout", type=int, default=75, choices=range(10, 121), metavar="10..120")
    arguments = parser.parse_args()
    if not arguments.run:
        parser.error("Explicit --run is required; this submits synthetic loopback model turns")
    arguments.started = time.monotonic()
    raise SystemExit(main(arguments))
