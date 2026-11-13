'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const io = require('./files.cjs');
const workspace = require('./project.cjs');
const native = require('./native-config.cjs');
const { owned } = require('./process.cjs');

const ID = 'playwright-test';
const ROOT = path.resolve(__dirname, '..');
const ACTIONS = ['install', 'status', 'check', 'enable', 'disable', 'uninstall'];

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--action', '--client', '--project', '--runtime-root'].includes(key) || !argv[index + 1] || key in result) throw Error('Invalid or duplicate management argument: ' + key);
    result[key] = argv[index + 1];
  }
  if (!ACTIONS.includes(result['--action']) || !['claude', 'codex'].includes(result['--client'])) throw Error('Specify a valid --action and --client');
  result['--project'] ??= process.cwd();
  if (!path.isAbsolute(result['--project']) || result['--runtime-root'] && !path.isAbsolute(result['--runtime-root'])) throw Error('Project and runtime root must be absolute paths');
  return { action: result['--action'], client: result['--client'], project: path.resolve(result['--project']), runtimeBase: result['--runtime-root'] };
}

function manifest(root) {
  const value = io.readJson(path.join(root, 'manifest.json'));
  if (!value || value.schemaVersion !== 1 || value.protocolVersion !== 1 || value.componentId !== ID || value.platform !== 'windows-x64' || !/^\d+\.\d+\.\d+$/.test(value.componentVersion)) throw Error('Unsupported Playwright component manifest');
  if (!value.files || Array.isArray(value.files)) throw Error('Missing managed file manifest');
  for (const name of Object.keys(value.files)) io.child(root, name);
  if (!value.files['bin/node.exe'] || value.files['bin/node.exe'] !== value.engine.sha256 || !value.files['skill/SKILL.md'] || !value.files['scripts/manage.cjs']) throw Error('Missing pinned component payload');
  return value;
}

function runtimeFor(source, value, base) {
  const home = base || path.join(process.env.LOCALAPPDATA || require('node:os').homedir(), 'AgentPluginSkillVault/components');
  const runtime = io.regular(path.join(home, ID, value.componentVersion));
  if (runtime !== source && (runtime.startsWith(source + path.sep) || source.startsWith(runtime + path.sep))) throw Error('Runtime installation and extracted package must be separate directories');
  return runtime;
}

function ensureRuntime(source, target, value) {
  io.verify(source, value.files);
  const stamp = { owner: workspace.OWNER, componentId: ID, componentVersion: value.componentVersion, manifestSha256: io.hashFile(path.join(source, 'manifest.json')) };
  if (fs.existsSync(target)) {
    const receipt = io.readJson(path.join(target, '.vault-runtime.json'));
    if (!receipt || JSON.stringify(receipt) !== JSON.stringify(stamp)) throw Error('Existing runtime is unowned or differs from this immutable release');
    io.verify(target, value.files);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const release = io.lock(path.join(path.dirname(target), '.install.lock'));
  const stage = target + '.stage-' + crypto.randomUUID();
  try {
    fs.mkdirSync(stage);
    for (const name of [...Object.keys(value.files), 'manifest.json']) {
      const destination = io.child(stage, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(io.child(source, name), destination, fs.constants.COPYFILE_EXCL);
    }
    io.verify(stage, value.files);
    io.atomic(path.join(stage, '.vault-runtime.json'), io.json(stamp));
    if (fs.existsSync(target)) throw Error('Runtime appeared during installation');
    fs.renameSync(stage, target);
  } finally {
    if (fs.existsSync(stage)) fs.rmSync(io.regular(stage), { recursive: true });
    release();
  }
}

function assets(project, runtime, client) {
  const result = {};
  const prefix = client === 'claude' ? '.claude' : '.agents';
  for (const name of ['SKILL.md', 'LICENSE']) result[`${prefix}/skills/vault-playwright/${name}`] = fs.readFileSync(io.child(runtime, 'skill/' + name));
  for (const name of fs.readdirSync(path.join(runtime, 'agents'))) {
    if (!/^vault-playwright-test-(planner|generator|healer)\.md$/.test(name)) throw Error('Unexpected native agent asset');
    const data = fs.readFileSync(io.child(runtime, 'agents/' + name));
    result[`${prefix}/skills/vault-playwright/references/${name}`] = data;
    if (client === 'claude') result['.claude/agents/' + name] = data;
  }
  return Object.entries(result).map(([name, data]) => ({ target: io.child(project, name), name, data }));
}

function ownedState(target) {
  const state = io.readJson(target);
  if (state && (state.owner !== workspace.OWNER || state.componentId !== ID || state.protocolVersion !== 1)) throw Error('Unowned component state');
  return state;
}

async function manage(opts, source = ROOT) {
  const { action, client, project } = opts;
  io.regular(project);
  if (!fs.statSync(project).isDirectory()) throw Error('Project directory does not exist');
  const value = manifest(source);
  const statePath = path.join(project, '.agent-vault', ID, client, 'project.json');
  let state = ownedState(statePath);
  const result = (status, message, extra = {}) => ({ protocolVersion: 1, componentId: ID, componentVersion: value.componentVersion, installedVersion: state?.componentVersion || null, action, ok: true, status, message, client, project, ...extra });
  if (action === 'status') return result(state ? 'installed' : 'not-installed', state ? 'Installed state found; file integrity and native discovery are unchecked.' : 'Not installed for this client and project.', { enabled: Boolean(state?.enabled), installedVersion: state?.componentVersion || null, runtimeRoot: state?.runtimeRoot || null, health: 'unchecked' });
  const release = io.lock(path.join(project, '.agent-vault', ID, 'management.lock'));
  try {
    state = ownedState(statePath);
    if (action === 'install') {
      if (state?.enabled && state.componentVersion !== value.componentVersion) throw Error('Disable this client before changing the installed component version');
      const runtime = state?.componentVersion === value.componentVersion && !opts.runtimeBase ? state.runtimeRoot : runtimeFor(source, value, opts.runtimeBase);
      if (state?.enabled && state.runtimeRoot !== runtime) throw Error('Disable this client before moving its runtime');
      for (const other of ['claude', 'codex']) {
        const sibling = ownedState(path.join(project, '.agent-vault', ID, other, 'project.json'));
        if (sibling?.enabled && sibling.runtimeRoot !== runtime) throw Error('Disable the other client before updating the shared project workspace');
      }
      ensureRuntime(source, runtime, value);
      const changes = workspace.prepare(project, runtime, value.componentVersion);
      changes.push({ target: statePath, before: io.read(statePath), after: io.json({
        owner: workspace.OWNER, protocolVersion: 1, componentId: ID, componentVersion: value.componentVersion,
        runtimeRoot: runtime, enabled: Boolean(state?.enabled), ownedFiles: state?.ownedFiles || {}, configuration: state?.configuration || null,
      }) });
      io.transact(changes);
      return result('installed', 'Runtime and test workspace prepared. Use enable to load this capability in the selected native client.', { installedVersion: value.componentVersion, runtimeRoot: runtime, enabled: Boolean(state?.enabled) });
    }
    if (!state) {
      if (['disable', 'uninstall'].includes(action)) return result('not-installed', 'No managed project integration to remove.');
      throw Error('Install the component for this client/project first');
    }
    const runtime = state.runtimeRoot;
    io.regular(runtime);
    const installedManifest = manifest(runtime);
    const runtimeReceipt = io.readJson(path.join(runtime, '.vault-runtime.json'));
    if (!runtimeReceipt || runtimeReceipt.owner !== workspace.OWNER || runtimeReceipt.manifestSha256 !== io.hashFile(path.join(runtime, 'manifest.json'))) throw Error('Runtime ownership or manifest changed');
    if (action === 'check') {
      const prepared = workspace.inspect(project);
      if (path.resolve(prepared.marker.runtimeRoot) !== path.resolve(runtime) || prepared.marker.componentVersion !== state.componentVersion) throw Error('Reinstall this client to match the shared project workspace version');
      io.verify(runtime, installedManifest.files);
      const screenshot = workspace.output(project, 'checks', 'browser-' + Date.now() + '.png');
      const check = await owned(path.join(runtime, 'bin/node.exe'), [path.join(runtime, 'scripts/check.cjs'), screenshot], { cwd: project, env: process.env });
      let payload;
      try { payload = JSON.parse(check.stdout); } catch { throw Error('Browser self-check did not return valid JSON'); }
      if (check.timedOut || check.code !== 0 || !payload.ok || !fs.existsSync(screenshot)) throw Error('Browser self-check failed: ' + (payload.message || check.stderr || 'timeout'));
      return result('ready', 'File integrity, browser launch, page assertion and screenshot passed; business tests and model selection are separate.', { enabled: state.enabled, ...payload });
    }
    if (state.enabled) io.verify(project, state.ownedFiles);
    if (action === 'enable') {
      const prepared = workspace.inspect(project);
      if (path.resolve(prepared.marker.runtimeRoot) !== path.resolve(runtime) || prepared.marker.componentVersion !== state.componentVersion) throw Error('Reinstall this client to match the shared project workspace version');
      io.verify(runtime, installedManifest.files);
      if (state.enabled) {
        native.change(project, client, state.configuration.entry, state.configuration);
        return result('enabled', 'Already enabled. Native client permissions and project trust still apply.');
      }
      const incoming = assets(project, runtime, client);
      const configuration = native.change(project, client, native.entry(runtime, project), null);
      const changes = incoming.map(file => {
        const before = io.read(file.target);
        if (before !== null) throw Error('Unowned native capability file exists: ' + file.name);
        return { target: file.target, before, after: file.data };
      });
      changes.push(configuration, { target: statePath, before: io.read(statePath), after: io.json({ ...state,
        enabled: true, ownedFiles: Object.fromEntries(incoming.map(file => [file.name, io.sha(file.data)])), configuration: configuration.ownership,
      }) });
      io.transact(changes);
      return result('enabled', 'Project Skill and MCP registered. Start a new native session; Claude agents are namespaced, Codex uses the Skill workflow references. Native trust and approvals remain in force.');
    }
    const changes = [];
    if (state.enabled) {
      changes.push(native.change(project, client, null, state.configuration));
      for (const name of Object.keys(state.ownedFiles)) {
        const target = io.child(project, name);
        changes.push({ target, before: io.read(target), after: null });
      }
    }
    changes.push({ target: statePath, before: io.read(statePath), after: action === 'uninstall' ? null : io.json({ ...state, enabled: false, ownedFiles: {}, configuration: null }) });
    io.transact(changes);
    return result(action === 'uninstall' ? 'removed' : 'disabled', 'Project capability removed from future native sessions. Tests, reports, credentials, personal files and the shared runtime cache are retained.');
  } finally { release(); }
}

async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = options(argv);
    if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This component supports Windows x64 only');
    const result = await manage(opts);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ protocolVersion: 1, componentId: ID, componentVersion: '1.0.0', action: opts?.action || 'unknown', ok: false, status: 'error', message: error.message }) + '\n');
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { options, manifest, manage, ensureRuntime };
