'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const io = require('./files.cjs');
const native = require('./native-config.cjs');
const service = require('./runtime.cjs');
const connection = require('./connection.cjs');

const ID = 'claude-mem';
const OWNER = 'AgentPluginSkillVault';
const ROOT = path.resolve(__dirname, '..');
const ACTIONS = ['install', 'status', 'check', 'enable', 'disable', 'uninstall', 'configure', 'start', 'stop', 'viewer'];

function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw Error('Management paths must be absolute paths without control characters');
  return path.resolve(value);
}
function options(argv) {
  const input = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--action','--client','--project','--runtime-root','--data-root','--claude-home','--capture'].includes(key) || value === undefined || key in input) throw Error('Invalid or duplicate management argument');
    input[key] = value;
  }
  if (!ACTIONS.includes(input['--action']) || !['claude', 'codex'].includes(input['--client'])) throw Error('Specify a valid action and client');
  if (input['--capture'] !== undefined && input['--capture'] !== 'true') throw Error('Capture must be explicitly true');
  if (input['--capture'] && input['--action'] !== 'enable') throw Error('Capture is available only with enable');
  if (['--runtime-root', '--data-root'].some(key => input[key]) && input['--action'] !== 'install') throw Error('Runtime and data roots are install options');
  if (input['--claude-home'] && !['install', 'configure'].includes(input['--action'])) throw Error('Native Claude home is an install/configure option');
  return { action: input['--action'], client: input['--client'], project: absolute(input['--project'] || process.cwd()),
    runtimeBase: input['--runtime-root'] ? absolute(input['--runtime-root']) : undefined,
    dataRoot: input['--data-root'] ? absolute(input['--data-root']) : undefined,
    claudeHome: input['--claude-home'] ? absolute(input['--claude-home']) : undefined, capture: input['--capture'] === 'true' };
}
function manifest(root) {
  const value = io.readJson(path.join(root, 'manifest.json'));
  if (!value || value.schemaVersion !== 1 || value.protocolVersion !== 1 || value.componentId !== ID || value.platform !== 'windows-x64' || !/^\d+\.\d+\.\d+$/.test(value.componentVersion)) throw Error('Unsupported claude-mem component manifest');
  if (!value.files || Array.isArray(value.files) || typeof value.files !== 'object') throw Error('Missing component payload hashes');
  // Manifest parsing is metadata-only; payload operations perform full I/O checks.
  for (const name of Object.keys(value.files))
    if (!name || /[\\:]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Unsafe managed path: ' + name);
  for (const name of ['bin/node.exe', 'bin/bun.exe', 'skill/SKILL.md', 'scripts/manage.cjs', 'plugin/scripts/worker-service.cjs', 'plugin/scripts/mcp-server.cjs'])
    if (!value.files[name]) throw Error('Missing pinned payload: ' + name);
  if (value.files['bin/node.exe'] !== value.engine.sha256) throw Error('Node executable does not match manifest');
  return value;
}
function ensureRuntime(source, target, value) {
  const stamp = { owner: OWNER, componentId: ID, componentVersion: value.componentVersion, manifestSha256: io.hashFile(path.join(source, 'manifest.json')) };
  if (fs.existsSync(target)) {
    const receipt = io.readJson(path.join(target, '.vault-runtime.json'));
    if (JSON.stringify(receipt) !== JSON.stringify(stamp)) throw Error('Existing runtime is unowned or differs from this immutable release');
    io.verify(target, value.files);
    return;
  }
  io.verify(source, value.files);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const unlock = io.lock(path.join(path.dirname(target), '.install.lock'));
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
    unlock();
  }
}
function stateAt(target) {
  const value = io.readJson(target);
  if (value && (value.owner !== OWNER || value.componentId !== ID || value.protocolVersion !== 1)) throw Error('Unowned project component state');
  return value;
}
function runtimeFor(source, version, base) {
  const target = io.regular(path.join(base || path.join(process.env.LOCALAPPDATA || os.homedir(), 'AgentPluginSkillVault/components'), ID, version));
  if (target === source || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) throw Error('Runtime cache and extracted package must be separate directories');
  return target;
}
function parameters(state, project) { return { runtime: state.runtimeRoot, project, dataRoot: state.dataRoot, claudeHome: state.claudeHome }; }

async function manage(opts, source = ROOT) {
  const { action, client } = opts, project = absolute(opts.project);
  if (!ACTIONS.includes(action) || !['claude', 'codex'].includes(client)) throw Error('Invalid management action or client');
  io.regular(project);
  if (!fs.statSync(project).isDirectory()) throw Error('Project directory does not exist');
  const value = manifest(source);
  const statePath = path.join(project, '.agent-vault', ID, client, 'project.json');
  let state = stateAt(statePath);
  const result = (status, message, extra = {}) => ({ protocolVersion: 1, componentId: ID, componentVersion: value.componentVersion,
    action, ok: true, status, message, client, project, installedVersion: state?.componentVersion || null,
    enabled: Boolean(state?.enabled), capture: Boolean(state?.capture), ...extra });
  if (action === 'status') return result(state ? 'installed' : 'not-installed', state ? 'Project integration found; native discovery is a separate check.' : 'Not installed for this client/project.',
    state ? { runtimeRoot: state.runtimeRoot, dataRoot: state.dataRoot, service: await service.status(parameters(state, project)) } : {});
  const unlock = io.lock(path.join(project, '.agent-vault', ID, 'management.lock'));
  try {
    state = stateAt(statePath);
    const sibling = stateAt(path.join(project, '.agent-vault', ID, client === 'claude' ? 'codex' : 'claude', 'project.json'));
    if (action === 'install') {
      if (state?.enabled) {
        if (state.componentVersion !== value.componentVersion || opts.runtimeBase || opts.dataRoot || opts.claudeHome) throw Error('Disable the client before changing its installation');
        io.verify(state.runtimeRoot, manifest(state.runtimeRoot).files);
        return result('installed', 'Already installed; existing enablement preserved.');
      }
      const runtime = state?.componentVersion === value.componentVersion && !opts.runtimeBase ? state.runtimeRoot : runtimeFor(source, value.componentVersion, opts.runtimeBase);
      const dataRoot = io.regular(absolute(opts.dataRoot || state?.dataRoot || sibling?.dataRoot || path.join(process.env.LOCALAPPDATA || os.homedir(), 'AgentPluginSkillVault/data/claude-mem')));
      const claudeHome = io.regular(absolute(opts.claudeHome || state?.claudeHome || sibling?.claudeHome || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')));
      if (sibling && (sibling.runtimeRoot !== runtime || sibling.dataRoot !== dataRoot || sibling.claudeHome !== claudeHome)) throw Error('Both clients in a project must use the same runtime, data and native Claude home');
      if ([project, runtime, source].some(root => dataRoot === root || dataRoot.startsWith(root + path.sep))) throw Error('Private memory data must be outside the project, extracted package and immutable runtime');
      service.location({ project, dataRoot });
      ensureRuntime(source, runtime, value);
      io.transact([{ target: statePath, before: io.read(statePath), after: io.json({ owner: OWNER, protocolVersion: 1, componentId: ID,
        componentVersion: value.componentVersion, runtimeRoot: runtime, dataRoot, claudeHome, enabled: false, capture: false, ownedFiles: {}, configuration: null, hooks: null }) }]);
      return result('installed', 'Runtime installed. No model call, collection or background service was started. Enable explicitly for this project.', { installedVersion: value.componentVersion, runtimeRoot: runtime, dataRoot, enabled: false, capture: false });
    }
    if (!state) {
      if (['disable', 'uninstall', 'stop'].includes(action)) return result('not-installed', 'No managed project integration exists.');
      throw Error('Install this component for the selected client/project first');
    }
    const runtime = io.regular(absolute(state.runtimeRoot)), installed = manifest(runtime);
    const receipt = io.readJson(path.join(runtime, '.vault-runtime.json'));
    if (!receipt || receipt.owner !== OWNER || receipt.manifestSha256 !== io.hashFile(path.join(runtime, 'manifest.json')) || installed.componentVersion !== state.componentVersion) throw Error('Installed runtime ownership or version changed');
    const params = parameters(state, project);
    if (action === 'stop') return result('stopped', 'Stopped only the owned project worker; enabled Hooks or MCP can start it again.', { service: await service.stop(params) });
    if (action === 'configure') {
      if (state.enabled || sibling?.enabled) throw Error('Disable both project clients before changing the native connection');
      if (!opts.claudeHome || opts.dataRoot || opts.runtimeBase) throw Error('Configure accepts an explicit native Claude home only; data movement requires a separate migration');
      const claudeHome = io.regular(absolute(opts.claudeHome));
      const changes = [{ target: statePath, before: io.read(statePath), after: io.json({ ...state, claudeHome }) }];
      if (sibling) {
        const siblingPath = path.join(project, '.agent-vault', ID, client === 'claude' ? 'codex' : 'claude', 'project.json');
        changes.push({ target: siblingPath, before: io.read(siblingPath), after: io.json({ ...sibling, claudeHome }) });
      }
      io.transact(changes);
      return result('configured', 'Native Claude home selected. No settings, account or model connection was modified.', { claudeHome });
    }
    if (['start', 'viewer', 'check'].includes(action)) {
      io.verify(runtime, installed.files);
      if (action === 'check') return result('ready', 'Component integrity and upstream local worker check passed; no model turn was submitted.', { service: await service.check(params) });
      const facts = await service.start({ ...params, observer: false });
      return result('running', 'Owned local worker available. Viewer is loopback-only; automatic capture remains separately controlled.', { service: facts,
        ...(action === 'viewer' ? { viewerUrl: facts.url + '/viewer' } : {}) });
    }
    if (state.enabled) io.verify(project, state.ownedFiles);
    if (action === 'enable') {
      if (client === 'codex' && opts.capture) throw Error('Codex supports manual save/retrieval in this release; automatic capture is not verified');
      native.conflicts(project, state.claudeHome, state.hooks, client);
      io.verify(runtime, installed.files);
      if (state.enabled) {
        if (opts.capture && !state.capture) throw Error('Disable and re-enable with Capture to change collection mode');
        native.change(project, client, state.configuration.entry, state.configuration);
        if (state.capture) native.hooks(project, state.hooks.groups, state.hooks);
        return result('enabled', 'Already enabled. Native trust and permissions remain in force.');
      }
      if (opts.capture) {
        const resolved = connection.resolve({ project, claudeHome: state.claudeHome });
        if (!resolved.public.configured) throw Error('No reusable native Claude credentials found; configure Claude Code before enabling capture. Credential helpers are never executed.');
      }
      const skillName = (client === 'claude' ? '.claude' : '.agents') + '/skills/vault-memory/SKILL.md';
      const skill = { target: io.child(project, skillName), before: io.read(io.child(project, skillName)), after: fs.readFileSync(io.child(runtime, 'skill/SKILL.md')) };
      if (skill.before !== null) throw Error('An unowned vault-memory Skill exists');
      const configuration = native.change(project, client, native.entry(runtime, project, state.dataRoot, state.claudeHome), null);
      const hookChange = opts.capture ? native.hooks(project, native.hookGroups(runtime, project, state.dataRoot, state.claudeHome), null) : null;
      io.transact([skill, configuration, ...(hookChange ? [hookChange] : []), { target: statePath, before: io.read(statePath), after: io.json({ ...state,
        enabled: true, capture: Boolean(opts.capture), ownedFiles: { [skillName]: io.sha(skill.after) }, configuration: configuration.ownership, hooks: hookChange?.ownership || null }) }]);
      return result('enabled', opts.capture ? 'Claude project Hooks explicitly enabled. New sessions can collect using the selected native Claude connection.' : 'Project Skill and MCP enabled for manual save/search. No capture Hooks or model request was started.', { enabled: true, capture: Boolean(opts.capture) });
    }
    const changes = [];
    if (state.enabled) {
      changes.push(native.change(project, client, null, state.configuration));
      if (state.capture) changes.push(native.hooks(project, null, state.hooks));
      for (const name of Object.keys(state.ownedFiles)) changes.push({ target: io.child(project, name), before: io.read(io.child(project, name)), after: null });
    }
    changes.push({ target: statePath, before: io.read(statePath), after: action === 'uninstall' ? null : io.json({ ...state, enabled: false, capture: false, ownedFiles: {}, configuration: null, hooks: null }) });
    io.transact(changes);
    // Commit disabling before stopping so stale native Hooks cannot respawn this worker.
    if (state.capture || !sibling?.enabled) await service.stop(params);
    return result(action === 'uninstall' ? 'removed' : 'disabled', 'Native integration removed. Private memories, shared runtime and unrelated configuration are retained.', { enabled: false, capture: false, dataRoot: state.dataRoot });
  } finally { unlock(); }
}
async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = options(argv);
    if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This release supports Windows x64 only');
    process.stdout.write(JSON.stringify(await manage(opts)) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ protocolVersion: 1, componentId: ID, componentVersion: '1.0.0', action: opts?.action || 'unknown', ok: false, status: 'error', message: error.message }) + '\n');
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { options, manifest, manage, ensureRuntime };
