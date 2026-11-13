'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const crypto = require('node:crypto');
const connection = require('../components/claude-mem/scripts/connection.cjs');
const runtime = require('../components/claude-mem/scripts/runtime.cjs');
const bridge = require('../components/claude-mem/scripts/bridge.cjs');
const { hashFile } = require('../components/claude-mem/scripts/files.cjs');
const source = path.resolve(__dirname, '../components/claude-mem/scripts');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(process.env.VAULT_MEMORY_TEST_TMP || os.tmpdir(), 'vault-memory-runtime-'));
  const project = path.join(base, 'project with space'), home = path.join(base, 'native-home'), dataRoot = path.join(base, 'private');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true }); fs.mkdirSync(home);
  const value = { base, project, home, dataRoot, runtime: path.join(base, 'runtime'), claudeHome: home };
  t.after(async () => {
    await value.beforeCleanup?.();
    if (!process.env.VAULT_MEMORY_TEST_KEEP) fs.rmSync(base, { recursive: true, force: true });
  });
  return value;
}
function json(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
function settings(f, value) { json(path.join(f.project, '.claude/settings.local.json'), value); }
function receipt(f, client, overrides = {}) {
  json(path.join(f.project, '.agent-vault/claude-mem', client, 'project.json'), {
    owner: 'AgentPluginSkillVault', componentId: 'claude-mem', protocolVersion: 1, enabled: true, capture: false,
    runtimeRoot: f.runtime, dataRoot: f.dataRoot, claudeHome: f.home, ...overrides,
  });
}

test('native connection precedence, allowlist and redacted public facts', t => {
  const f = fixture(t);
  json(path.join(f.home, 'settings.json'), { env: { ANTHROPIC_API_KEY: 'home-secret', ANTHROPIC_MODEL: 'home' }, apiKeyHelper: 'must-not-run' });
  json(path.join(f.project, '.claude/settings.json'), { env: { ANTHROPIC_API_KEY: 'project-secret', UNRELATED_TOKEN: 'ignored' } });
  settings(f, { env: { ANTHROPIC_API_KEY: 'local-secret', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/private',
    HTTPS_PROXY: 'http://private-proxy:3128', NODE_EXTRA_CA_CERTS: 'D:/private-ca.pem' }, model: 'fixture-model[1m]' });
  const before = fs.readFileSync(path.join(f.home, 'settings.json'));
  const value = connection.resolve({ project: f.project, claudeHome: f.home, environ: { ANTHROPIC_MODEL: 'env-model' } });
  assert.equal(value.env.ANTHROPIC_API_KEY, 'local-secret');
  assert.equal(value.env.HTTPS_PROXY, 'http://private-proxy:3128'); assert.equal(value.env.NODE_EXTRA_CA_CERTS, 'D:/private-ca.pem');
  assert.equal(value.env.ANTHROPIC_MODEL, 'env-model'); assert.equal(value.env.UNRELATED_TOKEN, undefined);
  assert.equal(value.public.mode, 'gateway'); assert.equal(value.public.endpoint, 'http://127.0.0.1:1');
  assert.equal(value.public.helperIgnored, true); assert.equal(value.public.sources.length, 3);
  assert.doesNotMatch(JSON.stringify(value.public), /secret|private/);
  assert.deepEqual(fs.readFileSync(path.join(f.home, 'settings.json')), before);
});

test('subscription checks existence without parsing credentials; helpers alone do not configure', t => {
  const f = fixture(t);
  settings(f, { apiKeyHelper: 'never execute me' });
  assert.equal(connection.resolve({ project: f.project, claudeHome: f.home, environ: {} }).public.configured, false);
  fs.writeFileSync(path.join(f.home, '.credentials.json'), 'not JSON: must not be read');
  const value = connection.resolve({ project: f.project, claudeHome: f.home, environ: {} });
  assert.equal(value.public.mode, 'subscription'); assert.equal(value.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test('reject malformed native env/model and unsupported cloud auth without execution', t => {
  const f = fixture(t);
  for (const value of [{ env: [] }, { env: null }, { env: { ANYTHING: 2 } }, { model: 4 },
    { model: '' }, { env: { CLAUDE_CODE_USE_BEDROCK: '1' } }, { env: { ANTHROPIC_API_KEY: 'a\nb' } },
    { env: { ANTHROPIC_BASE_URL: 'https://user:secret@example.com/' } }]) {
    settings(f, value);
    assert.throws(() => connection.resolve({ project: f.project, claudeHome: f.home, environ: {} }));
  }
  settings(f, {});
  for (const key of ['CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'])
    assert.throws(() => connection.resolve({ project: f.project, claudeHome: f.home, environ: { [key]: 'true' } }), /unsupported/);
});

test('credential forwarding is limited to the upstream observer SDK spawn boundary', () => {
  const calls = [], fake = { spawn: (...args) => calls.push(args), spawnSync: (...args) => calls.push(args) };
  connection.installSpawnEnvironment({ VAULT_MEMORY_OBSERVER: 'true', ANTHROPIC_API_KEY: 'in-memory-only', UNRELATED_TOKEN: 'private' }, fake);
  const originalEnv = { CLAUDE_MEM_INTERNAL: '1', ANTHROPIC_API_KEY: 'upstream-stripped' };
  fake.spawn('claude.exe', [], { env: originalEnv }); fake.spawnSync('other.exe', [], { env: {} });
  assert.equal(calls[0][2].env.ANTHROPIC_API_KEY, 'in-memory-only');
  assert.equal(calls[0][2].env.UNRELATED_TOKEN, undefined);
  assert.equal(originalEnv.ANTHROPIC_API_KEY, 'upstream-stripped'); assert.deepEqual(calls[1][2].env, {});
});

test('data directory is shared per normalized project and outside Git/runtime/project', t => {
  const f = fixture(t), loc = runtime.location(f);
  assert.equal(loc.dataDirectory, path.join(f.dataRoot, 'projects', crypto.createHash('sha256').update(connection.normalized(f.project)).digest('hex')));
  assert.equal(runtime.location({ ...f, client: 'codex' }).dataDirectory, loc.dataDirectory);
  if (process.platform === 'win32') assert.equal(runtime.location({ ...f, project: f.project.toUpperCase() }).dataDirectory, loc.dataDirectory);
  assert.throws(() => runtime.location({ ...f, dataRoot: path.join(f.project, 'private') }), /outside/);
  fs.mkdirSync(path.join(f.base, '.git'));
  assert.throws(() => runtime.location(f), /outside Git/);
});

test('ownership refusal preserves existing private data; status of empty data launches nothing', async t => {
  const f = fixture(t), loc = runtime.location(f);
  assert.equal((await runtime.status(f)).status, 'stopped'); assert.equal(fs.existsSync(f.dataRoot), false);
  fs.mkdirSync(loc.dataDirectory, { recursive: true }); fs.writeFileSync(path.join(loc.dataDirectory, 'memory.db'), 'keep');
  assert.throws(() => runtime.ownership(loc, true), /Unowned/);
  assert.equal(fs.readFileSync(path.join(loc.dataDirectory, 'memory.db'), 'utf8'), 'keep');
});

test('disabled/uninstalled or mismatched receipts make retained bridges inert', async t => {
  const f = fixture(t), opts = { ...f, mode: 'hook', observer: true, event: 'observation' };
  assert.equal(await bridge.run(opts), 0); assert.equal(fs.existsSync(f.dataRoot), false);
  receipt(f, 'claude', { capture: true }); assert.equal(bridge.enabled(opts), true);
  receipt(f, 'claude', { capture: false }); assert.equal(bridge.enabled(opts), false);
  receipt(f, 'codex'); assert.equal(bridge.enabled({ ...opts, mode: 'mcp' }), true);
  receipt(f, 'codex', { dataRoot: path.join(f.base, 'other-private') });
  receipt(f, 'claude', { enabled: false, capture: true });
  assert.equal(bridge.enabled(opts), false); assert.equal(bridge.enabled({ ...opts, mode: 'mcp' }), false);
  assert.equal(await bridge.run(opts), 0); assert.equal(fs.existsSync(f.dataRoot), false);
  assert.throws(() => bridge.options(['--mode','mcp','--runtime',f.runtime,'--project',f.project,'--data-root',f.dataRoot,'--claude-home',f.home,'--observer','true']), /reader/);
});

test('Hook input preserves original bytes and rejects malformed JSON', async () => {
  const raw = Buffer.from(' { "cwd": "D:/example", "value": "unicode \\u4e2d" }\r\n');
  assert.deepEqual((await bridge.hookInput(Readable.from([raw.subarray(0, 7), raw.subarray(7)]))).raw, raw);
  await assert.rejects(bridge.hookInput(Readable.from([Buffer.from('[]')])), /object/);
  await assert.rejects(bridge.hookInput(Readable.from([Buffer.from('secret invalid JSON')])), error => !error.message.includes('secret'));
});

test('MCP proxy filters tools/list and rejects model/corpus calls before forwarding', async () => {
  const filter = bridge.protocolFilter();
  assert.equal(filter.incoming({ id: 7, method: 'tools/list' }).forward, true);
  const serverRequest = { jsonrpc: '2.0', id: 7, method: 'roots/list', params: {} };
  assert.deepEqual(filter.outgoing(serverRequest), serverRequest);
  const response = filter.outgoing({ id: 7, result: { tools: [...bridge.TOOLS, 'prime_corpus', 'query_corpus'].map(name => ({ name })) } });
  assert.deepEqual(response.result.tools.map(tool => tool.name), [...bridge.TOOLS]);
  for (const name of ['prime_corpus', 'query_corpus', 'watch', 'unknown']) {
    const decision = filter.incoming({ id: 8, method: 'tools/call', params: { name } });
    assert.equal(decision.forward, false); assert.equal(decision.response.error.code, -32601);
  }
  assert.equal(filter.incoming({ id: 9, method: 'tools/call', params: { name: 'save_memory', arguments: { text: 'local fixture' } } }).forward, true);
  const received = [];
  for await (const message of bridge.messages(Readable.from([Buffer.from('{"id":'), Buffer.from('1}\n{"id":2}\n')]))) received.push(message.id);
  assert.deepEqual(received, [1, 2]);
  await assert.rejects(async () => { for await (const message of bridge.messages(Readable.from([Buffer.alloc(4 * 1024 * 1024 + 1, 65)]))) void message; }, /size limit/);
});

test('capture revoked after startup stops a newly created observer even with manual Codex enabled', async t => {
  const f = fixture(t), opts = { ...f, mode: 'hook', observer: true, event: 'observation' };
  receipt(f, 'claude', { capture: true }); receipt(f, 'codex');
  const originalStart = runtime.start, originalStop = runtime.stop;
  let stopped;
  runtime.start = async options => {
    assert.equal(options.authorize(), true);
    receipt(f, 'claude', { enabled: false, capture: false });
    return { status: 'running', observer: true, reused: false, generation: 'owned-generation' };
  };
  runtime.stop = async options => { stopped = options.expectedToken; };
  try {
    const input = Readable.from([Buffer.from(JSON.stringify({ cwd: f.project }))]);
    assert.equal(await bridge.run(opts, undefined, input), 0);
    assert.equal(stopped, 'owned-generation');
  } finally { runtime.start = originalStart; runtime.stop = originalStop; }
});

test('reader environment cannot inherit credentials, cloud sync or enable collection; reuse does not rewrite settings', t => {
  const f = fixture(t), loc = runtime.location(f); runtime.ownership(loc, true);
  const original = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'must-not-inherit';
  try {
    const env = runtime.environment({ runtime: f.runtime, loc, port: 12345, observer: false, claudeHome: f.home });
    assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.CLAUDE_MEM_OBSERVER_ENABLED, 'false');
    assert.equal(env.CLAUDE_MEM_CHROMA_ENABLED, 'false'); assert.equal(env.CLAUDE_MEM_AUTO_UPDATE, 'false');
    assert.equal(env.CLAUDE_MEM_WORKER_AUTOSTART, 'false'); assert.equal(env.CLAUDE_CONFIG_DIR.startsWith(loc.dataDirectory), true);
    const before = fs.readFileSync(path.join(loc.dataDirectory, 'settings.json'));
    runtime.environment({ runtime: f.runtime, loc, port: 12345, observer: false, persist: false });
    assert.deepEqual(fs.readFileSync(path.join(loc.dataDirectory, 'settings.json')), before);
  } finally { if (original === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = original; }
});

test('process identity includes commandline, executable and creation time', () => {
  const identity = { pid: 123, commandLine: 'owned worker', startTime: '2026-01-01', executable: 'bun.exe' };
  assert.equal(runtime.sameIdentity(identity, { ...identity }), true);
  for (const field of Object.keys(identity)) assert.equal(runtime.sameIdentity(identity, { ...identity, [field]: 'different' }), false);
});

test('explicit observer materializes only native allowlisted dotenv fields; reader never loads that file', t => {
  const f = fixture(t), loc = runtime.location(f); runtime.ownership(loc, true);
  settings(f, { model: 'haiku[1m]', env: { ANTHROPIC_API_KEY: 'synthetic-"quoted"-key',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://proxy.invalid:123', UNRELATED_TOKEN: 'never-copy' } });
  const observer = runtime.environment({ runtime: f.runtime, loc, port: 12345, observer: true, claudeHome: f.home });
  const text = fs.readFileSync(observer.CLAUDE_MEM_ENV_FILE, 'utf8');
  const values = Object.fromEntries(text.trim().split('\n').map(line => { const index = line.indexOf('='); return [line.slice(0,index), JSON.parse(line.slice(index+1))]; }));
  assert.equal(values.ANTHROPIC_API_KEY, 'synthetic-"quoted"-key'); assert.equal(values.ANTHROPIC_MODEL, 'haiku[1m]');
  assert.equal(values.HTTPS_PROXY, 'http://proxy.invalid:123'); assert.equal(values.UNRELATED_TOKEN, undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(loc.dataDirectory, 'settings.json'), 'utf8'), /synthetic-|proxy.invalid/);
  const reader = runtime.environment({ runtime: f.runtime, loc, port: 12345, observer: false, claudeHome: f.home });
  assert.notEqual(reader.CLAUDE_MEM_ENV_FILE, observer.CLAUDE_MEM_ENV_FILE);
  assert.equal(fs.existsSync(reader.CLAUDE_MEM_ENV_FILE), false); assert.equal(reader.ANTHROPIC_API_KEY, undefined);
  assert.equal(fs.readFileSync(observer.CLAUDE_MEM_ENV_FILE, 'utf8'), text, 'reader preserves private credentials but cannot load them');
});

function windowsAcl(file) {
  const script = `$a=Get-Acl -LiteralPath $env:VAULT_MEMORY_ACL_TARGET; @{protected=$a.AreAccessRulesProtected; user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; rules=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { @{sid=$_.IdentityReference.Value; type=$_.AccessControlType.ToString(); rights=[int]$_.FileSystemRights} })} | ConvertTo-Json -Depth 4 -Compress`;
  return JSON.parse(require('node:child_process').execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: { ...process.env, VAULT_MEMORY_ACL_TARGET: file } }).replace(/^\uFEFF/, ''));
}

test('observer credential DACL is restricted before secret bytes are written, including an older file', {
  skip: process.platform !== 'win32', timeout: 45000,
}, t => {
  const f = fixture(t), directory = path.join(f.base, 'credential directory'), file = path.join(directory, 'observer.env');
  fs.mkdirSync(directory); fs.writeFileSync(file, 'old-synthetic-credential');
  require('node:child_process').execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', `$a=Get-Acl -LiteralPath $env:VAULT_MEMORY_ACL_TARGET; $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'FullControl','Allow')); Set-Acl -LiteralPath $env:VAULT_MEMORY_ACL_TARGET -AclObject $a`],
    { windowsHide: true, timeout: 15000, env: { ...process.env, VAULT_MEMORY_ACL_TARGET: file } });
  const assertRestricted = (target, protectedAcl = false) => {
    const acl = windowsAcl(target);
    if (protectedAcl) assert.equal(acl.protected, true);
    assert.ok(acl.rules.some(rule => rule.sid === acl.user));
    for (const rule of acl.rules) {
      assert.ok([acl.user, 'S-1-5-18'].includes(rule.sid), 'credential ACL contains an unrelated principal');
      assert.equal(rule.type, 'Allow'); assert.equal(rule.rights & 0x1f01ff, 0x1f01ff);
    }
  };
  const originalWrite = fs.writeFileSync, originalRename = fs.renameSync;
  let checkedBeforeWrite = false, checkedTemporary = false;
  fs.writeFileSync = function(target, ...args) {
    if (typeof target === 'string' && target.startsWith(file + '.tmp-')) {
      assertRestricted(directory, true); assertRestricted(file, true); checkedBeforeWrite = true;
    }
    return originalWrite.call(this, target, ...args);
  };
  fs.renameSync = function(from, to) {
    if (to === file) { assertRestricted(from); checkedTemporary = true; }
    return originalRename.call(this, from, to);
  };
  try { connection.writeObserverEnvironment(file, { ANTHROPIC_API_KEY: 'new-synthetic-credential' }); }
  finally { fs.writeFileSync = originalWrite; fs.renameSync = originalRename; }
  assert.equal(checkedBeforeWrite, true); assert.equal(checkedTemporary, true);
  assertRestricted(file); assert.match(fs.readFileSync(file, 'utf8'), /new-synthetic-credential/);
});

test('observer credential ACL failure writes no secrets and suppresses child diagnostics', t => {
  const f = fixture(t), file = path.join(f.base, 'observer.env');
  const dependencies = createRequire(path.join(source, 'connection.cjs')), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(source, 'connection.cjs'), 'utf8'), {
    require: name => name === 'node:child_process' ? { execFileSync() { throw Error('private-child-diagnostic'); } } : dependencies(name),
    module, exports: module.exports, process: { platform: 'win32', env: process.env }, Buffer,
  });
  assert.throws(() => module.exports.writeObserverEnvironment(file, { ANTHROPIC_API_KEY: 'synthetic-secret' }),
    error => /secure.*observer/i.test(error.message) && !error.message.includes('private-child-diagnostic'));
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(f.base).sort(), ['native-home', 'project with space']);
});

function credentialCopy(f) {
  const loc = runtime.location(f); runtime.ownership(loc, true);
  const directory = path.join(loc.dataDirectory, 'native-empty'); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'observer.env'); fs.writeFileSync(file, 'synthetic-secret');
  return { loc, directory, file };
}

function stoppedRuntime(f, nextRows, healthy = false) {
  const loc = runtime.location(f), token = crypto.randomUUID();
  const identity = (pid, script) => ({ pid, startTime: 'fixture-time', executable: 'fixture.exe', commandLine: script });
  const state = { owner: 'agent-plugin-skill-vault', project: loc.project, dataDirectory: loc.dataDirectory,
    runtime: f.runtime, token, port: 12345, observer: true,
    worker: identity(12345, path.join(f.runtime, 'plugin/scripts/worker-service.cjs')),
    supervisor: identity(12346, path.join(f.runtime, 'scripts/supervisor.ps1') + ' ' + token) };
  json(loc.state, state);
  const dependencies = createRequire(path.join(source, 'runtime.cjs')), module = { exports: {} };
  const execFile = () => { throw Error('Unexpected callback execution'); };
  execFile[require('node:util').promisify.custom] = async () => {
    assert.equal(fs.existsSync(path.join(loc.dataDirectory, '.vault-runtime.lock')), true);
    return { stdout: JSON.stringify(nextRows(state)), stderr: '' };
  };
  vm.runInNewContext(fs.readFileSync(path.join(source, 'runtime.cjs'), 'utf8'), {
    require: name => name === 'node:child_process' ? { ...dependencies(name), execFile }
      : name === 'node:http' ? { request(options, callback) {
        const req = new EventEmitter();
        req.end = () => queueMicrotask(() => {
          if (!healthy) { req.emit('error', Error('offline fixture')); return; }
          const res = new EventEmitter(); res.statusCode = 200; callback(res);
          const body = options.path === '/api/readiness' ? { status: 'ready' }
            : { pid: state.worker.pid, workerPath: path.join(f.runtime, 'plugin/scripts/worker-service.cjs'), status: 'ok' };
          res.emit('data', Buffer.from(JSON.stringify(body))); res.emit('end');
        });
        return req;
      } } : dependencies(name),
    module, exports: module.exports, process: { platform: 'win32', env: process.env, pid: process.pid }, Buffer, setTimeout, clearTimeout,
  });
  return { service: module.exports, state };
}

test('stopped credential cleanup removes only generated env copies and preserves memories', async t => {
  const f = fixture(t), { loc, directory, file } = credentialCopy(f);
  const temporary = file + '.tmp-' + crypto.randomUUID(); fs.writeFileSync(temporary, 'synthetic-secret');
  fs.writeFileSync(path.join(directory, 'observer.env.user'), 'keep');
  fs.writeFileSync(path.join(loc.dataDirectory, 'memory.db'), 'keep-memory');
  assert.equal((await runtime.stop(f)).status, 'stopped');
  assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(temporary), false);
  assert.equal(fs.readFileSync(path.join(directory, 'observer.env.user'), 'utf8'), 'keep');
  assert.equal(fs.readFileSync(path.join(loc.dataDirectory, 'memory.db'), 'utf8'), 'keep-memory');
  assert.equal((await runtime.stop(f)).status, 'stopped');
});

test('credential cleanup preserves an unpublished startup until termination can be confirmed', async t => {
  const f = fixture(t), { loc, file } = credentialCopy(f);
  json(path.join(loc.dataDirectory, '.vault-starting.json'), { token: crypto.randomUUID() });
  await assert.rejects(runtime.stop(f), /startup.*unconfirmed/i);
  assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic-secret');
});

test('credential cleanup refuses an unowned worker PID without a receipt', async t => {
  const f = fixture(t), { loc, file } = credentialCopy(f);
  fs.writeFileSync(path.join(loc.dataDirectory, 'worker.pid'), '12345');
  await assert.rejects(runtime.stop(f), /PID file.*without Vault ownership receipt/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic-secret');
});

test('credential cleanup follows confirmed stop and already-dead receipts, but preserves replacement generations', async t => {
  const f = fixture(t), { loc, file } = credentialCopy(f);
  let probes = 0;
  const { service, state } = stoppedRuntime(f, saved => ++probes === 1 ? [saved.worker, saved.supervisor] : []);
  assert.equal((await service.stop({ ...f, expectedToken: 'old-generation' })).cleanupSkipped, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic-secret');
  json(path.join(loc.dataDirectory, '.vault-starting.json'), { token: state.token });
  assert.equal((await service.stop({ ...f, expectedToken: state.token })).status, 'stopped');
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, 'second-synthetic-secret');
  assert.equal((await service.stop(f)).status, 'stopped');
  assert.equal(fs.existsSync(file), false);
});

test('credential cleanup refuses changed process identity and unowned data', async t => {
  const f = fixture(t), { loc, file } = credentialCopy(f);
  const { service } = stoppedRuntime(f, state => [{ ...state.worker, startTime: 'replacement' }, state.supervisor]);
  await assert.rejects(service.stop(f), /identity changed/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic-secret');
  fs.unlinkSync(loc.marker);
  assert.equal((await runtime.stop(f)).status, 'stopped');
  assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic-secret');
});

test('reader reuse and selfcheck preserve credentials of a live authorized observer', async t => {
  const f = fixture(t), { file } = credentialCopy(f);
  receipt(f, 'claude', { capture: true });
  json(path.join(f.runtime, 'manifest.json'), { componentId: 'claude-mem', componentVersion: '1.0.0' });
  json(path.join(f.runtime, '.vault-runtime.json'), { owner: 'AgentPluginSkillVault', componentId: 'claude-mem', componentVersion: '1.0.0',
    manifestSha256: hashFile(path.join(f.runtime, 'manifest.json')) });
  const { service } = stoppedRuntime(f, state => [state.worker, state.supervisor], true);
  assert.equal((await service.start({ ...f, observer: false })).reused, true);
  assert.equal((await service.check(f)).existingObserverPreserved, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic-secret');
});

function sealPackage(f) {
  const files = {};
  for (const name of ['bin/node.exe', 'bin/bun.exe', 'scripts/supervisor.ps1', 'scripts/connection.cjs', 'plugin/scripts/worker-service.cjs','plugin/scripts/mcp-server.cjs'])
    files[name] = hashFile(path.join(f.runtime, name));
  json(path.join(f.runtime, 'manifest.json'), { componentId: 'claude-mem', componentVersion: '1.0.0', files });
  json(path.join(f.runtime, '.vault-runtime.json'), { owner: 'AgentPluginSkillVault', componentId: 'claude-mem', componentVersion: '1.0.0', manifestSha256: hashFile(path.join(f.runtime, 'manifest.json')) });
}

function fakePackage(f) {
  fs.mkdirSync(path.join(f.runtime, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(f.runtime, 'scripts')); fs.mkdirSync(path.join(f.runtime, 'plugin/scripts'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(f.runtime, 'bin/node.exe'));
  fs.copyFileSync(process.env.VAULT_MEMORY_TEST_BUN, path.join(f.runtime, 'bin/bun.exe'));
  for (const name of ['connection.cjs', 'supervisor.ps1']) fs.copyFileSync(path.join(source, name), path.join(f.runtime, 'scripts', name));
  fs.writeFileSync(path.join(f.runtime, 'plugin/scripts/worker-service.cjs'), `
const http = require('node:http'); const fs = require('node:fs');
const state = {status:'ok',pid:process.pid,workerPath:__filename,version:'local-fixture',initialized:true,mcpReady:true};
const dir=process.env.CLAUDE_MEM_DATA_DIR; let healthCount=0;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');
if(req.url==='/api/health') {
  if(++healthCount===2 && fs.existsSync(dir+'/fixture-pause-check')) {
    fs.writeFileSync(dir+'/fixture-probe-entered','');
    const timer=setInterval(()=>{if(fs.existsSync(dir+'/fixture-release-probe')){clearInterval(timer);res.end(JSON.stringify(state));}},25);
  } else res.end(JSON.stringify(state));
}
else if(req.url==='/api/readiness') res.end(JSON.stringify({status:'ready',mcpReady:true}));
else if(req.url==='/api/admin/shutdown'){res.end(JSON.stringify({status:'shutting_down'})); setTimeout(()=>process.exit(0),50);}
else {res.statusCode=404;res.end('{}');}}).listen(Number(process.env.CLAUDE_MEM_WORKER_PORT),'127.0.0.1');
`);
  fs.writeFileSync(path.join(f.runtime, 'plugin/scripts/mcp-server.cjs'), 'process.stdin.resume();');
  sealPackage(f);
}

test('real local reader upgrades to observer on the same port with a new generation and no duplicate', {
  skip: process.platform !== 'win32' || !process.env.VAULT_MEMORY_TEST_BUN ? 'Set VAULT_MEMORY_TEST_BUN for the real local upgrade fixture' : false,
  timeout: 120000,
}, async t => {
  const f = fixture(t); fakePackage(f);
  f.beforeCleanup = () => runtime.stop(f);
  const reader = await runtime.start(f), loc = runtime.location(f), previous = runtime.stateFor(loc);
  assert.equal(reader.observer, false);
  settings(f, { env: { ANTHROPIC_API_KEY: 'unused-local-fixture-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } });
  const observer = await runtime.start({ ...f, observer: true });
  assert.equal(observer.port, reader.port); assert.equal(observer.url, reader.url);
  assert.notEqual(observer.generation, reader.generation);
  assert.equal(observer.observer, true); assert.equal(observer.reused, false);
  assert.equal((await runtime.request(reader.port, '/api/health')).body.pid, observer.pid);
  const oldProcesses = await runtime.identities([previous.worker.pid, previous.supervisor.pid]);
  assert.equal(oldProcesses.some(live => [previous.worker, previous.supervisor].some(saved => runtime.sameIdentity(saved, live))), false);
  const repeated = await runtime.start({ ...f, observer: true }), reused = await runtime.start(f);
  for (const running of [repeated, reused]) {
    assert.equal(running.reused, true); assert.equal(running.generation, observer.generation);
    assert.equal(running.pid, observer.pid); assert.equal(running.observer, true);
  }
});

test('real local observer upgrade rejects an occupied reader port without fallback or adopting the listener', {
  skip: process.platform !== 'win32' || !process.env.VAULT_MEMORY_TEST_BUN ? 'Set VAULT_MEMORY_TEST_BUN for the real local port conflict fixture' : false,
  timeout: 120000,
}, async t => {
  const f = fixture(t); fakePackage(f);
  const net = require('node:net'), http = require('node:http'), originalCreateServer = net.createServer;
  let received = 0;
  const competing = http.createServer((req, res) => {
    received++; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ready', pid: process.pid, unrelatedListener: true }));
  });
  f.beforeCleanup = async () => {
    net.createServer = originalCreateServer;
    try { await runtime.stop(f); }
    finally { if (competing.listening) await new Promise((resolve, reject) => competing.close(error => error ? reject(error) : resolve())); }
  };
  const reader = await runtime.start(f), loc = runtime.location(f), previous = runtime.stateFor(loc), attempts = [];
  settings(f, { env: { ANTHROPIC_API_KEY: 'unused-local-fixture-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } });
  net.createServer = function(...args) {
    const probe = originalCreateServer.apply(this, args), listen = probe.listen;
    probe.listen = function(port, host, ...rest) {
      attempts.push(port);
      if (port !== reader.port) return listen.call(this, port, host, ...rest);
      // Interpose a real competing listener only after the reader has stopped.
      competing.once('error', error => probe.emit('error', error));
      competing.listen(port, host, () => listen.call(probe, port, host, ...rest));
      return this;
    };
    return probe;
  };
  try { await assert.rejects(runtime.start({ ...f, observer: true }), error => error.code === 'EADDRINUSE'); }
  finally { net.createServer = originalCreateServer; }
  assert.deepEqual(attempts, [reader.port], 'upgrade must try only the already pinned reader port');
  assert.equal(received, 0, 'upgrade must not probe or adopt the unrelated HTTP listener');
  assert.equal(runtime.stateFor(loc).token, previous.token);
  assert.equal(runtime.stateFor(loc).observer, false);
  assert.equal(fs.existsSync(path.join(loc.dataDirectory, '.vault-starting.json')), false);
  assert.equal(fs.existsSync(path.join(loc.dataDirectory, 'native-empty/observer.env')), false);
  assert.equal((await runtime.status(f)).status, 'stopped');
  assert.equal((await runtime.request(reader.port, '/api/health')).body.unrelatedListener, true);
  await runtime.stop(f);
  assert.equal((await runtime.request(reader.port, '/api/health')).body.unrelatedListener, true);
});

function mockedStartup(f, closes) {
  for (const name of ['bin/node.exe', 'bin/bun.exe', 'scripts/supervisor.ps1', 'scripts/connection.cjs', 'plugin/scripts/worker-service.cjs', 'plugin/scripts/mcp-server.cjs']) {
    const file = path.join(f.runtime, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'synthetic');
  }
  sealPackage(f);
  const calls = { spawned: 0, killed: 0, closed: false };
  const dependencies = createRequire(path.join(source, 'runtime.cjs'));
  const module = { exports: {} };
  const spawn = () => {
    calls.spawned++;
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdout.unref = child.stderr.unref = child.unref = () => {};
    child.exitCode = null; child.pid = 12345;
    child.kill = () => {
      calls.killed++;
      if (closes) setTimeout(() => { calls.closed = true; child.exitCode = 1; child.emit('close', 1); }, 50);
      return closes;
    };
    queueMicrotask(() => {
      const loc = runtime.location(f);
      json(path.join(loc.dataDirectory, '.vault-supervisor-error.json'), { kind: 'fixture-before-receipt' });
      if (closes) {
        const watch = setInterval(() => {
          if (!fs.existsSync(loc.stop)) return;
          clearInterval(watch);
          child.kill();
          setTimeout(() => json(path.join(loc.dataDirectory, '.vault-launch-closed.json'), connection.readJson(loc.stop)), 75);
        }, 20);
      }
      child.emit('spawn');
    });
    return child;
  };
  vm.runInNewContext(fs.readFileSync(path.join(source, 'runtime.cjs'), 'utf8'), {
    require: name => name === 'node:child_process' ? { ...dependencies(name), spawn } : dependencies(name),
    module, exports: module.exports, process, Buffer, setTimeout, clearTimeout,
  }, { filename: path.join(source, 'runtime.cjs') });
  return { service: module.exports, calls };
}

test('startup failure awaits exact supervisor closure before releasing lifecycle ownership', async t => {
  const f = fixture(t), { service, calls } = mockedStartup(f, true);
  await assert.rejects(service.start(f), /fixture-before-receipt/);
  assert.equal(calls.killed, 1); assert.equal(calls.closed, true);
  const loc = runtime.location(f);
  assert.equal(fs.existsSync(path.join(loc.dataDirectory, '.vault-starting.json')), false);
  assert.ok(connection.readJson(loc.stop).token, 'the cancellation token remains until a confirmed new startup');
});

test('unconfirmed startup cancellation preserves pending marker and stop token and blocks retries', { timeout: 15000 }, async t => {
  const f = fixture(t), { service, calls } = mockedStartup(f, false);
  await assert.rejects(service.start(f), /cancellation is unconfirmed/);
  const loc = runtime.location(f), token = fs.readFileSync(loc.stop, 'utf8');
  assert.equal(fs.existsSync(path.join(loc.dataDirectory, '.vault-starting.json')), true);
  await assert.rejects(service.start(f), /pending startup marker/);
  assert.equal(calls.spawned, 1); assert.equal(fs.readFileSync(loc.stop, 'utf8'), token);
});

test('check retains one lifecycle lock through creation, probing and cleanup before a competing MCP reader starts', {
  skip: process.platform !== 'win32' || !process.env.VAULT_MEMORY_TEST_BUN ? 'Set VAULT_MEMORY_TEST_BUN for the real local lifecycle fixture' : false,
  timeout: 90000,
}, async t => {
  const f = fixture(t); fakePackage(f);
  const loc = runtime.location(f); runtime.ownership(loc, true);
  fs.writeFileSync(path.join(loc.dataDirectory, 'fixture-pause-check'), '');
  const http = require('node:http'), originalRequest = http.request;
  http.request = (options, callback) => originalRequest({ ...options, timeout: 20000 }, callback);
  let checking, reading;
  try {
    checking = runtime.check(f); checking.catch(() => {});
    const deadline = Date.now() + 45000;
    while (!fs.existsSync(path.join(loc.dataDirectory, 'fixture-probe-entered'))) {
      if (Date.now() > deadline) throw Error('check did not reach the paused health probe');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    reading = runtime.start(f); reading.catch(() => {});
    await Promise.race([reading, new Promise(resolve => setTimeout(resolve, 4000))]);
    fs.writeFileSync(path.join(loc.dataDirectory, 'fixture-release-probe'), '');
    assert.equal((await checking).status, 'ready');
    const reader = await reading;
    assert.equal(reader.reused, false, 'MCP must acquire its worker after check cleans up its own generation');
    assert.equal((await runtime.status(f)).pid, reader.pid);
    assert.equal((await runtime.status(f)).status, 'running');
  } finally {
    fs.writeFileSync(path.join(loc.dataDirectory, 'fixture-release-probe'), '');
    await Promise.allSettled([checking, reading]);
    http.request = originalRequest;
    await runtime.stop(f);
  }
});

test('atomic Job Object assignment owns a suspended worker before supervisor can be terminated', {
  skip: process.platform !== 'win32' || !process.env.VAULT_MEMORY_TEST_BUN ? 'Set VAULT_MEMORY_TEST_BUN for Windows atomic process creation' : false,
  timeout: 45000,
}, async t => {
  const f = fixture(t); fakePackage(f);
  const loc = runtime.location(f); runtime.ownership(loc, true);
  const supervisor = path.join(f.runtime, 'scripts/supervisor.ps1');
  const original = fs.readFileSync(supervisor, 'utf8');
  assert.ok(original.includes('UpdateProcThreadAttribute'));
  assert.doesNotMatch(original, /AssignProcessToJobObject/);
  // Only this fixture copy pauses, after publishing the suspended process's
  // identity and before ResumeThread. Production has no testing switch.
  fs.writeFileSync(supervisor, original.replace('if ([VaultMemoryJob]::ResumeThread', "Start-Sleep -Seconds 60\n    if ([VaultMemoryJob]::ResumeThread"));
  const { spawn } = require('node:child_process');
  const token = crypto.randomUUID();
  const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',supervisor,
      '-Runtime',f.runtime,'-Project',loc.project,'-DataDirectory',loc.dataDirectory,'-Port','12345','-Token',token,'-Observer','false'],
    { windowsHide: true, stdio: 'ignore', env: runtime.environment({ runtime: f.runtime, loc, port: 12345, observer: false }) });
  const closed = new Promise(resolve => child.once('close', resolve));
  let state;
  try {
    const deadline = Date.now() + 20000;
    while (!(state = runtime.stateFor(loc))) {
      if (child.exitCode !== null) throw Error('Atomic supervisor exited before publishing suspended identity: ' + JSON.stringify(connection.readJson(path.join(loc.dataDirectory, '.vault-supervisor-error.json'))));
      if (Date.now() > deadline) throw Error('Suspended worker receipt timed out');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const rows = await runtime.identities([state.supervisor.pid]);
    assert.equal(runtime.sameIdentity(state.supervisor, rows[0]), true);
    child.kill(); await closed;
    const cleanupDeadline = Date.now() + 10000;
    while ((await runtime.identities([state.worker.pid])).length && Date.now() < cleanupDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await runtime.identities([state.worker.pid])).length, 0, 'a never-resumed worker must die with its atomically assigned job');
  } finally { child.kill(); await closed; }
});

test('owned daemon survives a short-lived management Node process and remains healthy after thirty seconds', {
  skip: process.platform !== 'win32' || !process.env.VAULT_MEMORY_TEST_BUN ? 'Set VAULT_MEMORY_TEST_BUN for independent daemon lifetime verification' : false,
  timeout: 120000,
}, async t => {
  const f = fixture(t); fakePackage(f);
  const { execFile } = require('node:child_process');
  const execute = require('node:util').promisify(execFile);
  try {
    const script = 'require(process.argv[1]).start(JSON.parse(process.argv[2])).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.message);process.exitCode=1})';
    const { stdout } = await execute(process.execPath, ['-e', script, path.join(source, 'runtime.cjs'), JSON.stringify(f)],
      { timeout: 70000, windowsHide: true });
    const started = JSON.parse(stdout);
    assert.equal((await runtime.request(started.port, '/api/health')).body.pid, started.pid, 'health must survive management process exit');
    await new Promise(resolve => setTimeout(resolve, 30000));
    assert.equal((await runtime.request(started.port, '/api/health')).body.pid, started.pid);
    assert.equal((await runtime.start(f)).pid, started.pid);
    assert.equal((await runtime.check(f)).reused, true);
    assert.equal((await runtime.status(f)).status, 'running');
  } finally { await runtime.stop(f); }
});

test('real owned Windows supervisor lifecycle against local HTTP fixture, observer reuse and abrupt cleanup', {
  skip: process.platform !== 'win32' || !process.env.VAULT_MEMORY_TEST_BUN ? 'Set VAULT_MEMORY_TEST_BUN to prepared bundled Bun for Windows lifecycle verification' : false,
  timeout: 150000,
}, async t => {
  const f = fixture(t); fakePackage(f);
  f.beforeCleanup = async () => {
    try { await runtime.stop(f); }
    catch {
      const loc = runtime.location(f), state = runtime.stateFor(loc);
      if (state) {
        const rows = await runtime.identities([state.worker.pid]);
        if (runtime.sameIdentity(state.worker, rows[0])) process.kill(state.worker.pid);
      }
    }
  };
  let started;
  try { started = await runtime.start(f); }
  catch (error) {
    t.diagnostic(f.base);
    const log = path.join(runtime.location(f).dataDirectory, '.vault-supervisor.log');
    if (fs.existsSync(log)) t.diagnostic(fs.readFileSync(log, 'utf8'));
    throw error;
  }
  assert.equal(started.observer, false); assert.equal(started.status, 'running');
  assert.equal((await runtime.start(f)).pid, started.pid);
  const loc = runtime.location(f), state = runtime.stateFor(loc);
  assert.equal(state.worker.pid, started.pid); assert.ok(state.worker.startTime); assert.ok(state.supervisor.startTime);
  // A PID reuse mismatch must never trigger a signal or an HTTP shutdown.
  runtime.atomic(loc.state, { ...state, worker: { ...state.worker, startTime: 'mismatch' } });
  await assert.rejects(runtime.stop(f), /identity changed/);
  runtime.atomic(loc.state, state);
  assert.equal((await runtime.status(f)).status, 'running');
  await runtime.stop(f); assert.equal((await runtime.status(f)).status, 'stopped');
  settings(f, { env: { ANTHROPIC_API_KEY: 'fake-unused', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } });
  receipt(f, 'claude', { capture: true }); receipt(f, 'codex');
  const hook = { ...f, mode: 'hook', observer: true, event: 'observation' };
  const lock = path.join(loc.dataDirectory, '.vault-runtime.lock');
  fs.writeFileSync(lock, 'test-held');
  const waiting = runtime.start({ ...f, observer: true, authorize: () => bridge.enabled(hook) });
  receipt(f, 'claude', { enabled: false, capture: false });
  fs.unlinkSync(lock);
  assert.equal((await waiting).status, 'disabled', 'capture revoked while waiting must prevent an observer despite enabled Codex');
  assert.equal((await runtime.status(f)).status, 'stopped');
  fs.writeFileSync(lock, 'test-held');
  const observing = runtime.start({ ...f, observer: true });
  const checking = runtime.check(f);
  checking.catch(() => {});
  fs.unlinkSync(lock);
  const observed = await observing;
  await checking;
  assert.equal((await runtime.status(f)).pid, observed.pid, 'check must not stop an observer generation it reused');
  await runtime.stop({ ...f, expectedToken: 'different-generation' });
  assert.equal((await runtime.status(f)).pid, observed.pid, 'cleanup for an older generation must not stop a replacement');
  const reused = await runtime.start({ ...f, observer: false });
  assert.equal(reused.pid, observed.pid); assert.equal(reused.observer, true);
  assert.equal((await runtime.check(f)).existingObserverPreserved, true);
  const own = runtime.stateFor(loc), identities = await runtime.identities([own.supervisor.pid]);
  assert.equal(runtime.sameIdentity(own.supervisor, identities[0]), true);
  process.kill(own.supervisor.pid);
  const deadline = Date.now() + 15000;
  while ((await runtime.identities([own.worker.pid])).length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal((await runtime.identities([own.worker.pid])).length, 0, 'closing supervisor must kill its worker Job Object');
});
