'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const connection = require('./connection.cjs');
const { regular, normalized, readJson } = connection;
const { hashFile } = require('./files.cjs');
const execute = promisify(execFile);
const OWNER = 'agent-plugin-skill-vault';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const powerShell = () => path.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

function location({ project, dataRoot }) {
  project = normalized(project);
  dataRoot = regular(dataRoot);
  if (normalized(dataRoot) === project || normalized(dataRoot).startsWith(project + path.sep))
    throw Error('Memory data must be outside the project');
  for (let current = dataRoot;; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) throw Error('Memory data must be outside Git');
    if (path.dirname(current) === current) break;
  }
  const dataDirectory = regular(path.join(dataRoot, 'projects', sha(project)));
  return { project, dataRoot, dataDirectory, marker: path.join(dataDirectory, '.vault-owner.json'),
    state: path.join(dataDirectory, '.vault-worker.json'), stop: path.join(dataDirectory, '.vault-stop.json') };
}

function atomic(file, value) {
  regular(file);
  const temporary = file + '.tmp-' + crypto.randomUUID();
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function ownership(loc, create = false) {
  const expected = { owner: OWNER, componentId: 'claude-mem', schemaVersion: 1, project: loc.project };
  let marker = readJson(loc.marker);
  if (!marker && create) {
    if (fs.existsSync(loc.dataDirectory) && fs.readdirSync(loc.dataDirectory).length) throw Error('Unowned memory data directory');
    fs.mkdirSync(loc.dataDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(loc.marker, JSON.stringify(expected) + '\n', { flag: 'wx', mode: 0o600 });
    marker = expected;
  }
  if (marker && JSON.stringify(marker) !== JSON.stringify(expected)) throw Error('Memory ownership marker does not match project');
  return Boolean(marker);
}

function runtimeBinding(runtime, dataDirectory) {
  runtime = regular(runtime);
  const r = normalized(runtime), d = normalized(dataDirectory);
  if (d === r || d.startsWith(r + path.sep) || r.startsWith(d + path.sep)) throw Error('Runtime and memory data must be separate');
  const manifest = readJson(path.join(runtime, 'manifest.json'));
  if (manifest?.componentId !== 'claude-mem' || manifest.componentVersion !== '1.0.0') throw Error('Unsupported memory runtime manifest');
  const receipt = readJson(path.join(runtime, '.vault-runtime.json'));
  if (receipt?.owner !== 'AgentPluginSkillVault' || receipt.componentId !== 'claude-mem' ||
      receipt.componentVersion !== manifest.componentVersion || receipt.manifestSha256 !== hashFile(path.join(runtime, 'manifest.json')))
    throw Error('Runtime ownership stamp does not match manifest');
  return { runtime, manifest };
}

function assets(runtime, dataDirectory) {
  const binding = runtimeBinding(runtime, dataDirectory);
  runtime = binding.runtime;
  const manifest = binding.manifest;
  for (const name of ['bin/node.exe', 'bin/bun.exe', 'plugin/scripts/worker-service.cjs',
    'plugin/scripts/mcp-server.cjs', 'scripts/supervisor.ps1', 'scripts/connection.cjs']) {
    const file = regular(path.join(runtime, name));
    if (!manifest.files?.[name] || hashFile(file) !== manifest.files[name]) throw Error('Runtime file integrity failed: ' + name);
  }
  return runtime;
}

async function lock(loc, action) {
  const file = path.join(loc.dataDirectory, '.vault-runtime.lock');
  regular(file);
  const deadline = Date.now() + 65000;
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(file, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw Error('Runtime lifecycle is locked; inspect the owned lock before retrying');
      await pause(100);
    }
  }
  try { fs.writeFileSync(fd, String(process.pid)); return await action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); }
}

async function identities(pids) {
  if (process.platform !== 'win32') throw Error('Owned worker lifecycle requires Windows x64');
  if (!pids.every(pid => Number.isInteger(pid) && pid > 0)) throw Error('Invalid worker PID');
  const filter = pids.map(pid => 'ProcessId = ' + pid).join(' OR ');
  const script = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { @{pid=[int]$_.ProcessId; startTime=$_.CreationDate.ToUniversalTime().ToString('o'); commandLine=$_.CommandLine; executable=$_.ExecutablePath} }) | ConvertTo-Json -Compress`;
  const { stdout } = await execute(powerShell(), ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 8000, maxBuffer: 64 * 1024 });
  const rows = stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : [];
  return Array.isArray(rows) ? rows : [rows];
}

function sameIdentity(saved, live) {
  return live && saved.pid === live.pid && saved.startTime === live.startTime &&
    saved.commandLine === live.commandLine && saved.executable === live.executable;
}

function stateFor(loc) {
  const state = readJson(loc.state);
  if (!state) return null;
  if (state.owner !== OWNER || state.project !== loc.project || state.dataDirectory !== loc.dataDirectory ||
      !/^[a-f0-9-]{36}$/.test(state.token || '') || !Number.isInteger(state.port) || state.port < 1024 || state.port > 65535 ||
      typeof state.observer !== 'boolean' || !state.worker || !state.supervisor) throw Error('Invalid owned worker receipt');
  regular(state.runtime);
  if (!state.worker.commandLine?.includes(path.join(state.runtime, 'plugin/scripts/worker-service.cjs')) ||
      !state.supervisor.commandLine?.includes(path.join(state.runtime, 'scripts/supervisor.ps1')) ||
      !state.supervisor.commandLine.includes(state.token)) throw Error('Worker receipt command does not match runtime');
  return state;
}

function request(port, endpoint, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: endpoint, method, timeout: 2500 }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 256 * 1024) req.destroy(Error('Worker response exceeds limit')); else chunks.push(chunk); });
      res.on('end', () => {
        try { resolve({ code: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { reject(Error('Worker did not return JSON')); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Error('Worker request timed out')));
    req.on('error', reject); req.end();
  });
}

function facts(loc, state, status, extra = {}) {
  return { ok: true, status, dataDirectory: loc.dataDirectory, port: state?.port || null,
    url: state ? `http://127.0.0.1:${state.port}` : null, observer: state?.observer || false,
    pid: state?.worker.pid || null, generation: state?.token || null, ...extra };
}

async function inspect(loc) {
  if (!ownership(loc)) return { state: null, status: 'stopped' };
  const state = stateFor(loc);
  if (!state) {
    if (fs.existsSync(regular(path.join(loc.dataDirectory, 'worker.pid')))) throw Error('Worker PID file exists without Vault ownership receipt');
    return { state: null, status: 'stopped' };
  }
  const rows = await identities([state.worker.pid, state.supervisor.pid]);
  const worker = rows.find(row => row.pid === state.worker.pid), supervisor = rows.find(row => row.pid === state.supervisor.pid);
  if (worker && !sameIdentity(state.worker, worker) || supervisor && !sameIdentity(state.supervisor, supervisor))
    throw Error('Worker process identity changed; refusing ownership');
  if (!worker && !supervisor) return { state, status: 'stopped' };
  if (!worker || !supervisor) throw Error('Incomplete worker ownership; supervisor/worker missing');
  const health = await request(state.port, '/api/health');
  if (health.code !== 200 || health.body.pid !== state.worker.pid ||
      normalized(health.body.workerPath) !== normalized(path.join(state.runtime, 'plugin/scripts/worker-service.cjs')))
    throw Error('Worker health does not match owned process');
  return { state, status: 'running', health: { status: health.body.status, version: health.body.version,
    initialized: health.body.initialized, mcpReady: health.body.mcpReady } };
}

async function status(options) {
  const loc = location(options), current = await inspect(loc);
  return facts(loc, current.state, current.status, { health: current.health || null });
}

function environment({ runtime, loc, port, observer, claudeHome, persist = true }) {
  const allowed = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'OS', 'PROCESSOR_ARCHITECTURE',
    'PATH', 'PATHEXT', 'PROGRAMFILES', 'ProgramFiles', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA'];
  const env = Object.fromEntries(allowed.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const privateHome = path.join(loc.dataDirectory, 'native-empty');
  fs.mkdirSync(privateHome, { recursive: true, mode: 0o700 });
  const temporary = path.join(loc.dataDirectory, 'tmp');
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const resolved = observer ? connection.resolve({ project: loc.project, claudeHome }) : null;
  if (observer && !resolved.public.configured) throw Error('Observer requires native Claude connection; helpers are not executed');
  // Upstream resolves credentials before SDK spawn. Use its supported private
  // dotenv input only for explicitly authorized observation, never for readers.
  const envFile = path.join(privateHome, observer ? 'observer.env' : 'disabled.env');
  if (observer && persist) connection.writeObserverEnvironment(envFile, resolved.env);
  const nativeHome = resolved?.public.claudeHome || privateHome;
  const settings = {
    CLAUDE_MEM_DATA_DIR: loc.dataDirectory, CLAUDE_MEM_WORKER_HOST: '127.0.0.1', CLAUDE_MEM_WORKER_PORT: String(port),
    CLAUDE_MEM_OBSERVER_ENABLED: String(observer), CLAUDE_MEM_CHROMA_ENABLED: 'false', CLAUDE_MEM_AUTO_UPDATE: 'false',
    CLAUDE_MEM_TELEMETRY: 'false', CLAUDE_MEM_TELEMETRY_ERRORS: 'false', CLAUDE_MEM_QUEUE_ENGINE: 'sqlite',
    CLAUDE_MEM_RUNTIME: 'worker', CLAUDE_MEM_PROVIDER: 'claude', CLAUDE_MEM_PROVIDER_BY_SOURCE: '',
    CLAUDE_MEM_CLAUDE_AUTH_METHOD: resolved?.public.mode === 'gateway' ? 'gateway' : resolved?.public.mode === 'api-key' ? 'api-key' : 'subscription',
    CLAUDE_MEM_CLAUDE_CONFIG_DIR: nativeHome, CLAUDE_MEM_OBSERVER_CLAUDE_CONFIG_DIR: nativeHome,
    CLAUDE_MEM_MEDIA_CAPTURE_ENABLED: 'false', CLAUDE_MEM_MEDIA_INFERENCE_ENABLED: 'false',
    CLAUDE_MEM_TRANSCRIPTS_ENABLED: 'false', CLAUDE_MEM_CODEX_TRANSCRIPT_INGESTION: 'false',
    CLAUDE_MEM_CODEX_SUBAGENT_INGESTION: 'false', CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED: 'false',
    CLAUDE_MEM_WORKER_AUTOSTART: 'false', CLAUDE_MEM_CLOUD_SYNC_TOKEN: '', CLAUDE_MEM_MEMORY_WATCH_ROOTS: '',
    CLAUDE_MEM_LOG_LEVEL: 'WARN', CLAUDE_MEM_LOG_RETENTION_DAYS: '3',
  };
  if (resolved?.env.ANTHROPIC_MODEL) settings.CLAUDE_MEM_MODEL = resolved.env.ANTHROPIC_MODEL;
  if (persist) {
    const saved = readJson(path.join(loc.dataDirectory, 'settings.json')) || {};
    atomic(path.join(loc.dataDirectory, 'settings.json'), { ...saved, ...settings });
  }
  return { ...env, ...resolved?.env, ...settings, CLAUDE_CONFIG_DIR: nativeHome,
    TEMP: temporary, TMP: temporary,
    CLAUDE_PLUGIN_ROOT: path.join(runtime, 'plugin'), PLUGIN_ROOT: path.join(runtime, 'plugin'),
    CLAUDE_MEM_ENV_FILE: envFile,
    BUN: path.join(runtime, 'bin/bun.exe'), BUN_PATH: path.join(runtime, 'bin/bun.exe'),
    PATH: path.join(runtime, 'bin') + path.delimiter + (env.PATH || ''),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DO_NOT_TRACK: '1',
    VAULT_MEMORY_PRELOAD: '1', VAULT_MEMORY_OBSERVER: String(observer) };
}

async function unusedPort(preferred = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(preferred, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function cleanStoppedObserverEnvironment(loc, token) {
  const pending = readJson(path.join(loc.dataDirectory, '.vault-starting.json'));
  if (pending && pending.token !== token)
    throw Error('Worker startup termination is unconfirmed; retaining observer credentials');
  const directory = regular(path.join(loc.dataDirectory, 'native-empty'));
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    if (name === 'observer.env' || /^observer\.env\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name))
      fs.unlinkSync(regular(path.join(directory, name)));
  }
}

async function stopLocked(loc, expectedToken) {
  const state = stateFor(loc);
  if (!state) {
    if (fs.existsSync(regular(path.join(loc.dataDirectory, 'worker.pid'))))
      throw Error('Worker PID file exists without Vault ownership receipt');
    cleanStoppedObserverEnvironment(loc);
    return facts(loc, null, 'stopped');
  }
  if (expectedToken && state.token !== expectedToken) return facts(loc, state, 'running', { reused: true, cleanupSkipped: true });
  const rows = await identities([state.worker.pid, state.supervisor.pid]);
  for (const saved of [state.worker, state.supervisor]) {
    const live = rows.find(row => row.pid === saved.pid);
    if (live && !sameIdentity(saved, live)) throw Error('Process identity changed; refusing stop');
  }
  if (!rows.length) { cleanStoppedObserverEnvironment(loc, state.token); return facts(loc, state, 'stopped'); }
  if (!rows.some(row => row.pid === state.supervisor.pid)) throw Error('Supervisor missing; refusing to kill an unowned process tree');
  // The verified supervisor owns the job. Its tokenized stop request closes that
  // job even if HTTP is wedged; no process-name lookup or unverified PID kill.
  atomic(loc.stop, { token: state.token });
  try {
    const health = await request(state.port, '/api/health');
    if (health.body.pid === state.worker.pid) await request(state.port, '/api/admin/shutdown', 'POST');
  } catch { /* The supervisor remains the bounded cleanup authority. */ }
  const deadline = Date.now() + 12000;
  while ((await identities([state.worker.pid, state.supervisor.pid])).some(row =>
    [state.worker, state.supervisor].some(saved => sameIdentity(saved, row)))) {
    if (Date.now() > deadline) throw Error('Owned supervisor did not stop within deadline');
    await pause(200);
  }
  cleanStoppedObserverEnvironment(loc, state.token);
  return facts(loc, state, 'stopped');
}

async function stop(options) {
  const loc = location(options);
  if (!ownership(loc)) return facts(loc, null, 'stopped');
  return lock(loc, () => stopLocked(loc, options.expectedToken));
}

async function start(options) {
  const loc = location(options);
  ownership(loc, true);
  return lock(loc, () => startLocked(loc, options));
}

async function startLocked(loc, options) {
  const observer = options.observer ?? false;
  if (typeof observer !== 'boolean') throw Error('observer must be boolean');
  const runtime = regular(options.runtime);
  const pending = regular(path.join(loc.dataDirectory, '.vault-starting.json'));
  if (fs.existsSync(pending)) throw Error('Prior worker startup cancellation is unconfirmed; inspect the owned pending startup marker before retrying');
    if (observer && options.authorize && !options.authorize()) return facts(loc, null, 'disabled');
    const current = await inspect(loc);
    runtimeBinding(runtime, loc.dataDirectory);
    let upgradePort;
    if (current.status === 'running') {
      if (normalized(current.state.runtime) !== normalized(runtime)) throw Error('Another runtime version owns this project worker');
      if (!observer || current.state.observer) return facts(loc, current.state, 'running', { reused: true });
      // An explicit observer start may upgrade a reader; reads never downgrade it.
      if (!connection.resolve({ project: loc.project, claudeHome: options.claudeHome }).public.configured)
        throw Error('Native Claude connection required');
      // Existing MCP subprocesses pin this URL. Never move an upgraded worker
      // to a different port or adopt another listener that took its place.
      upgradePort = current.state.port;
      await stopLocked(loc);
    }
    // Large payload verification happens only on startup. Manager install/check/
    // enable verify the complete manifest; running Hook/MCP reuse stays bounded.
    assets(runtime, loc.dataDirectory);
    const port = await unusedPort(upgradePort), token = crypto.randomUUID();
    if (observer && options.authorize && !options.authorize()) return facts(loc, null, 'disabled');
    const env = environment({ runtime, loc, port, observer, claudeHome: options.claudeHome });
    const launchClosed = regular(path.join(loc.dataDirectory, '.vault-launch-closed.json'));
    for (const file of [loc.state, loc.stop, launchClosed, path.join(loc.dataDirectory, '.vault-supervisor-error.json'),
      path.join(loc.dataDirectory, '.vault-supervisor.log')]) { regular(file); if (fs.existsSync(file)) fs.unlinkSync(file); }
    atomic(pending, { owner: OWNER, project: loc.project, runtime, token });
    let child;
    try {
    child = spawn(powerShell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(runtime, 'scripts/supervisor.ps1'), '-Runtime', runtime, '-Project', loc.project,
      '-DataDirectory', loc.dataDirectory, '-Port', String(port), '-Token', token, '-Observer', String(observer), '-LaunchOwner'],
    { env, cwd: loc.project, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
      const deadline = Date.now() + 45000;
      let lastFailure = 'readiness unavailable';
      while (Date.now() < deadline) {
        const failure = readJson(path.join(loc.dataDirectory, '.vault-supervisor-error.json'));
        if (failure) throw Error('Owned supervisor startup failed: ' + JSON.stringify(failure));
        if (child.exitCode !== null) throw Error('Owned supervisor exited before readiness; inspect .vault-supervisor.log');
        const state = stateFor(loc);
        if (state?.token === token) {
          try {
            const ready = await request(port, '/api/readiness');
            if (ready.code === 200 && ready.body.status === 'ready') {
              const current = await inspect(loc);
              if (current.status !== 'running') throw Error('Owned worker is not running');
              atomic(path.join(loc.dataDirectory, '.vault-running.json'), { token });
              if (observer && options.authorize && !options.authorize()) {
                await stopLocked(loc, token);
                fs.unlinkSync(pending);
                return facts(loc, null, 'disabled');
              }
              fs.unlinkSync(pending);
              return facts(loc, state, 'running', { reused: false, health: current.health });
            }
          } catch (error) { lastFailure = error.message; }
        }
        await pause(250);
      }
      throw Error('Worker did not become ready; inspect private upstream logs: ' + lastFailure);
    } catch (error) {
      try { atomic(loc.stop, { token }); } catch { /* Still cancel through the exact child handle. */ }
      let cancelled = !child || child.pid === undefined;
      const cancelDeadline = Date.now() + 10000;
      // The launcher closes its exact supervisor handle, then acknowledges the
      // generation. Its own exit alone cannot prove a launched owner is gone.
      while (!cancelled && Date.now() < cancelDeadline) {
        cancelled = readJson(launchClosed)?.token === token;
        if (!cancelled) await pause(100);
      }
      if (cancelled) { if (fs.existsSync(pending)) fs.unlinkSync(pending); }
      else throw Error('Worker startup failed and supervisor cancellation is unconfirmed; pending ownership blocks retry');
      throw error;
    }
}

async function check(options) {
  const loc = location(options);
  ownership(loc, true);
  return lock(loc, async () => {
    let running;
    try {
      running = await startLocked(loc, { ...options, observer: false });
      const health = await request(running.port, '/api/health'), ready = await request(running.port, '/api/readiness');
      if (health.code !== 200 || ready.code !== 200 || ready.body.status !== 'ready') throw Error('Worker selfcheck failed');
      return { ...running, status: 'ready', check: 'health/readiness only', modelTurnSubmitted: false,
        existingObserverPreserved: running.reused === true && running.observer };
    } finally {
      if (running?.reused === false) await stopLocked(loc, running.generation);
    }
  });
}

module.exports = { start, stop, status, check, location, environment, identities, sameIdentity,
  request, atomic, stateFor, ownership, assets, facts, runtimeBinding };
