'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const io = require('../components/claude-mem/scripts/files.cjs');
const service = require('../components/claude-mem/scripts/runtime.cjs');
const connection = require('../components/claude-mem/scripts/connection.cjs');
const manager = require('../components/claude-mem/scripts/manage.cjs');
const native = require('../components/claude-mem/scripts/native-config.cjs');
const toml = require('../components/claude-mem/vendor/smol-toml/index.cjs');

const TMP = path.resolve(process.env.VAULT_MEMORY_TEST_TMP || os.tmpdir());
const MOCK_KEY = 'fixture-credential-never-real';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

function write(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}
function writeJson(target, value) { write(target, JSON.stringify(value, null, 2) + '\n'); }
function readJson(target) { return JSON.parse(fs.readFileSync(target, 'utf8')); }
function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Snapshot bytes without following fixture junctions; refusal must leave all files intact.
function snapshot(root) {
  const result = {};
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, item.name), key = path.relative(root, target);
      if (item.isSymbolicLink()) result[key] = { link: fs.readlinkSync(target) };
      else if (item.isDirectory()) visit(target);
      else result[key] = fs.readFileSync(target).toString('base64');
    }
  }
  visit(root);
  return result;
}

function fixture(t) {
  fs.mkdirSync(TMP, { recursive: true });
  const root = fs.mkdtempSync(path.join(TMP, 'memory-management-'));
  const f = {
    root, source: path.join(root, 'source'), cache: path.join(root, 'cache'),
    project: path.join(root, "project \u4e2d\u6587 O'Brien $fixture (space)"),
    dataRoot: path.join(root, 'private data'), claudeHome: path.join(root, 'native claude'),
    codexHome: path.join(root, 'native codex'), links: [], calls: [], resolutions: [], configured: true,
  };
  fs.mkdirSync(f.project);
  fs.mkdirSync(f.codexHome);
  writeJson(path.join(f.claudeHome, 'settings.json'), {
    model: 'fixture-native-model', apiKeyHelper: 'must-not-execute-fixture-helper',
    env: { ANTHROPIC_API_KEY: MOCK_KEY },
  });
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = f.codexHome;
  t.after(() => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    assert.ok(path.resolve(root).startsWith(TMP + path.sep));
    for (const link of f.links) {
      assert.ok(contained(root, link));
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const files = {};
  for (const [name, data] of Object.entries({
    'bin/node.exe': 'fixture Node, not an executable',
    'bin/bun.exe': 'fixture Bun, not an executable',
    'scripts/manage.cjs': 'fixture packaged manager, not executed',
    'scripts/bridge.cjs': 'fixture bridge, not executed',
    'plugin/scripts/worker-service.cjs': 'fixture worker, not executed',
    'plugin/scripts/mcp-server.cjs': 'fixture upstream MCP, not executed',
    'skill/SKILL.md': '---\nname: vault-memory\ndescription: Fixture memory skill\n---\n',
  })) {
    write(path.join(f.source, name), data);
    files[name] = digest(data);
  }
  writeJson(path.join(f.source, 'manifest.json'), {
    schemaVersion: 1, protocolVersion: 1, componentId: 'claude-mem', componentVersion: '1.0.0',
    platform: 'windows-x64', engine: { sha256: files['bin/node.exe'] }, files,
  });

  f.statePath = (client = 'claude', project = f.project) => path.join(project, '.agent-vault/claude-mem', client, 'project.json');
  f.state = (client = 'claude') => readJson(f.statePath(client));
  f.configPath = client => path.join(f.project, client === 'claude' ? '.mcp.json' : '.codex/config.toml');
  f.skillPath = client => path.join(f.project, client === 'claude' ? '.claude' : '.agents', 'skills/vault-memory/SKILL.md');
  f.run = (action, client = 'claude', extra = {}) => manager.manage({
    action, client, project: f.project,
    ...(action === 'install' ? { runtimeBase: f.cache, dataRoot: f.dataRoot, claudeHome: f.claudeHome } : {}),
    ...extra,
  }, f.source);
  f.link = (target, name) => {
    const link = path.join(root, name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, 'junction');
    f.links.push(link);
    return link;
  };

  // Only external worker/credential boundaries are replaced; controller I/O stays real.
  for (const method of ['status', 'start', 'stop', 'check']) {
    t.mock.method(service, method, async options => {
      for (const name of ['runtime', 'project', 'dataRoot', 'claudeHome'])
        assert.ok(typeof options[name] === 'string' && contained(root, options[name]), 'Service escaped fixture: ' + name);
      const states = Object.fromEntries(['claude', 'codex'].map(client => {
        const file = f.statePath(client, options.project);
        return [client, fs.existsSync(file) ? readJson(file).enabled : null];
      }));
      f.calls.push({ method, options: { ...options }, states });
      return { ok: true, status: method === 'check' ? 'ready' : method === 'start' ? 'running' : 'stopped',
        dataDirectory: path.join(options.dataRoot, 'fixture-project-data'), port: null, url: null,
        observer: options.observer ?? false, pid: null,
        ...(method === 'check' ? { modelTurnSubmitted: false, check: 'fixture health/readiness' } : {}) };
    });
  }
  t.mock.method(connection, 'resolve', options => {
    assert.ok(contained(root, options.project) && contained(root, options.claudeHome));
    f.resolutions.push({ ...options });
    return { env: { ANTHROPIC_API_KEY: MOCK_KEY, CLAUDE_CONFIG_DIR: options.claudeHome },
      public: { configured: f.configured, mode: f.configured ? 'api-key' : 'unconfigured',
        claudeHome: options.claudeHome, endpoint: null, model: 'fixture-native-model', sources: [],
        helperIgnored: true, credentialPresent: f.configured, subscriptionFilePresent: false,
        validation: 'fixture configuration only' } };
  });
  return f;
}

function personalSettings() {
  return { permissions: { deny: ['Bash(fixture-command)'] }, enabledPlugins: { 'unrelated@fixture': true },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo personal-hook', timeout: 7 }] }], Notification: [] } };
}
function seedNative(f, client) {
  const data = client === 'claude'
    ? { note: 'personal config', mcpServers: { existing: { command: 'fixture-tool', args: ['one'] } } }
    : { model: 'fixture-model', mcp_servers: { existing: { command: 'fixture-tool', args: ['one'] } }, features: { shell_tool: false } };
  write(f.configPath(client), client === 'claude' ? JSON.stringify(data) : '# Personal TOML comments\n' + toml.stringify(data));
  return data;
}
function readNative(f, client) {
  const text = fs.readFileSync(f.configPath(client), 'utf8');
  return client === 'claude' ? JSON.parse(text) : toml.parse(text);
}
async function refusesUnchanged(f, action, client, extra, pattern) {
  const before = snapshot(f.root), calls = f.calls.length;
  await assert.rejects(f.run(action, client, extra), pattern);
  assert.deepEqual(snapshot(f.root), before, 'Refused action partially changed files');
  assert.equal(f.calls.length, calls, 'Refused action contacted the worker');
}

describe('claude-mem controller management', { concurrency: false }, () => {
  test('verify checks shared directories once per pass and resolves every file independently', t => {
    const f = fixture(t), root = path.join(f.root, 'verification'), files = {};
    for (let index = 0; index < 8; index++) {
      const name = `nested/shared/file-${index}.txt`, value = 'verified payload ' + index;
      write(path.join(root, name), value); files[name] = digest(value);
    }
    const counts = new Map(), resolved = new Set();
    const lstat = fs.lstatSync, realpath = fs.realpathSync.native;
    t.mock.method(fs, 'lstatSync', function(target, ...args) {
      counts.set(target, (counts.get(target) || 0) + 1);
      return lstat.call(this, target, ...args);
    });
    t.mock.method(fs.realpathSync, 'native', function(target, ...args) {
      resolved.add(target);
      return realpath.call(this, target, ...args);
    });
    io.verify(root, files);
    assert.ok([...counts.values()].every(count => count === 1), 'Repeated ancestor walks in one verification pass');
    for (const name of Object.keys(files)) {
      const target = path.join(root, name);
      assert.equal(counts.get(target), 1, 'Each file still needs its own lstat');
      assert.ok(resolved.has(target), 'Each file needs a fresh canonical path check');
    }
  });

  for (const location of ['root', 'parent', 'file']) {
    test(`verify refuses a linked ${location} even when the payload hash matches`, t => {
      const f = fixture(t), outside = path.join(f.root, 'outside-verification');
      write(path.join(outside, 'payload.txt'), 'matching payload');
      let root = path.join(f.root, 'verification'), name = 'nested/payload.txt';
      if (location === 'root') {
        root = f.link(outside, 'verification'); name = 'payload.txt';
      } else if (location === 'parent') {
        f.link(outside, 'verification/nested');
      } else {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        try { fs.symlinkSync(path.join(outside, 'payload.txt'), target, 'file'); }
        catch (error) {
          if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('File symlink privilege unavailable');
          throw error;
        }
        f.links.push(target);
      }
      assert.throws(() => io.verify(root, { [name]: digest('matching payload') }), /Linked files or directories/i);
    });
  }

  test('verify rejects a checked parent changed into a junction before the next file', t => {
    const f = fixture(t), root = path.join(f.root, 'verification');
    const parent = path.join(root, 'nested'), saved = path.join(root, 'original-parent');
    const outside = path.join(f.root, 'outside-verification');
    write(path.join(parent, 'first.txt'), 'first');
    write(path.join(parent, 'second.txt'), 'second');
    write(path.join(outside, 'second.txt'), 'second');
    const close = fs.closeSync;
    let replaced = false;
    t.mock.method(fs, 'closeSync', function(fd) {
      const result = close.call(this, fd);
      if (!replaced) {
        replaced = true;
        assert.ok(contained(f.root, parent) && contained(f.root, saved));
        fs.renameSync(parent, saved);
        f.link(outside, 'verification/nested');
      }
      return result;
    });
    assert.throws(() => io.verify(root, {
      'nested/first.txt': digest('first'), 'nested/second.txt': digest('second'),
    }), /Linked files or directories/i);
    assert.equal(replaced, true);
  });

  test('verify does not retain directory checks between operations', t => {
    const f = fixture(t), root = path.join(f.root, 'verification');
    const parent = path.join(root, 'nested'), saved = path.join(root, 'original-parent');
    const outside = path.join(f.root, 'outside-verification'), files = { 'nested/payload.txt': digest('payload') };
    write(path.join(parent, 'payload.txt'), 'payload');
    write(path.join(outside, 'payload.txt'), 'payload');
    io.verify(root, files);
    assert.ok(contained(f.root, parent) && contained(f.root, saved));
    fs.renameSync(parent, saved);
    f.link(outside, 'verification/nested');
    assert.throws(() => io.verify(root, files), /Linked files or directories/i);
  });

  test('verify hashes the entire file and rejects corrupt, missing or non-file payloads', t => {
    const f = fixture(t), root = path.join(f.root, 'verification'), target = path.join(root, 'payload');
    const payload = Buffer.alloc(2 * 1024 * 1024 + 17, 'x'), files = { payload: digest(payload) };
    write(target, payload);
    io.verify(root, files);
    payload[payload.length - 1] = 0;
    write(target, payload);
    assert.throws(() => io.verify(root, files), /Managed file changed or missing/i);
    fs.unlinkSync(target);
    assert.throws(() => io.verify(root, files));
    fs.mkdirSync(target);
    assert.throws(() => io.verify(root, files));
  });

  test('verify rejects traversal and invalid digest entries before opening payloads', t => {
    const f = fixture(t);
    for (const name of ['', '../outside', '/outside', 'nested/../outside', 'nested\\outside', 'C:/outside'])
      assert.throws(() => io.verify(f.source, { [name]: digest('payload') }), /Unsafe managed path/i);
    assert.throws(() => io.verify(f.source, { 'bin/node.exe': 'invalid' }), /Managed file changed or missing/i);
  });

  test('verify accepts ordinary Windows path casing', { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t), root = path.join(f.root, 'verification');
    write(path.join(root, 'nested/payload.txt'), 'payload');
    io.verify(root.toUpperCase(), { 'NESTED/PAYLOAD.TXT': digest('payload') });
  });

  test('verify compares targets to the canonical root for filesystem aliases', t => {
    const f = fixture(t), root = path.join(f.root, 'verification');
    const canonicalRoot = path.join(f.root, 'canonical-spelling');
    write(path.join(root, 'nested/payload.txt'), 'payload');
    const realpath = fs.realpathSync.native;
    t.mock.method(fs.realpathSync, 'native', function(target, ...args) {
      const actual = realpath.call(this, target, ...args);
      return contained(root, target) ? path.join(canonicalRoot, path.relative(root, target)) : actual;
    });
    io.verify(root, { 'nested/payload.txt': digest('payload') });
  });

  test('verify accepts a real Windows short-path root', { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t), root = path.join(f.root, 'long verification directory');
    write(path.join(root, 'nested/payload.txt'), 'payload');
    const script = [
      "$ErrorActionPreference='Stop';",
      'Add-Type -TypeDefinition \'using System; using System.Text; using System.Runtime.InteropServices; public static class VerifyShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern uint GetShortPathName(string path, StringBuilder result, uint size); }\';',
      '$buffer=[Text.StringBuilder]::new(32768);',
      "$length=[VerifyShortPath]::GetShortPathName('" + root.replace(/'/g, "''") + "', $buffer, $buffer.Capacity);",
      "if ($length -eq 0 -or $length -ge $buffer.Capacity) { throw 'GetShortPathName failed'; }",
      '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write($buffer.ToString());',
    ].join('\n');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const shortRoot = result.stdout;
    assert.ok(path.isAbsolute(shortRoot) && fs.existsSync(shortRoot));
    if (shortRoot.toLowerCase() === fs.realpathSync.native(root).toLowerCase())
      return t.skip('Fixture volume has no 8.3 alias for this path');
    io.verify(shortRoot, { 'nested/payload.txt': digest('payload') });
  });

  test('generated PowerShell Hook preserves exact UTF-8 input and quoted Windows paths', {
    skip: process.platform !== 'win32' && 'Windows PowerShell Hook command',
  }, t => {
    fs.mkdirSync(TMP, { recursive: true });
    const root = fs.mkdtempSync(path.join(TMP, 'memory-management-'));
    t.after(() => {
      assert.ok(path.resolve(root).startsWith(TMP + path.sep));
      fs.rmSync(root, { recursive: true, force: true });
    });
    const special = "\u4e2d\u6587 O'Brien $fixture (space)";
    const runtime = path.join(root, 'runtime ' + special);
    const project = path.join(root, 'project ' + special);
    const dataRoot = path.join(root, 'data ' + special);
    const claudeHome = path.join(root, 'home ' + special) + path.sep;
    const nodePath = path.join(runtime, 'bin/node.exe');
    const argvPath = path.join(runtime, 'scripts/argv.json');
    fs.mkdirSync(path.dirname(nodePath), { recursive: true });
    fs.copyFileSync(process.execPath, nodePath);
    write(path.join(runtime, 'scripts/bridge.cjs'), [
      "'use strict';",
      "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'argv.json'), JSON.stringify(process.argv.slice(2)));",
      'setTimeout(() => process.exit(124), 10000).unref();',
      'process.stdin.pipe(process.stdout);',
      '',
    ].join('\n'));
    const input = Buffer.from(JSON.stringify({
      prompt: "\u4e2d\u6587\u63d0\u793a O'Brien $fixture\n\u7b2c\u4e8c\u884c",
      tool_response: '\u8bb0\u5fc6 R\u00e9sum\u00e9',
      cwd: project, dataRoot, claudeHome,
    }) + '\r\n', 'utf8');
    const command = native.hookGroups(runtime, project, dataRoot, claudeHome).Stop.hooks[0].command;
    const match = /^(powershell\.exe) (-NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+)$/.exec(command);
    assert.ok(match, 'Expected the generated encoded PowerShell command');
    const result = spawnSync(match[1], match[2].split(' '), {
      input, cwd: root, windowsHide: true, timeout: 20000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr?.toString('utf8'));
    assert.deepEqual(result.stdout, input, 'Hook changed UTF-8 stdin bytes');
    assert.equal(result.stderr.length, 0, result.stderr.toString('utf8'));
    assert.deepEqual(readJson(argvPath), [
      '--mode', 'hook', '--runtime', runtime, '--project', project, '--data-root', dataRoot,
      '--claude-home', claudeHome, '--event', 'summarize', '--observer', 'true',
    ]);
  });

  test('install copies a verified immutable runtime without service, native config or Hook changes', async t => {
    const f = fixture(t);
    seedNative(f, 'claude'); seedNative(f, 'codex');
    writeJson(path.join(f.project, '.claude/settings.json'), personalSettings());
    writeJson(path.join(f.project, '.claude/settings.local.json'), { env: { FIXTURE: 'keep' } });
    const projectBefore = snapshot(f.project), homeBefore = snapshot(f.claudeHome);
    const result = await f.run('install');
    assert.equal(result.ok, true);
    assert.equal(result.enabled, false);
    assert.equal(result.capture, false);
    assert.equal(result.runtimeRoot, path.join(f.cache, 'claude-mem/1.0.0'));
    const state = f.state();
    assert.equal(state.runtimeRoot, result.runtimeRoot);
    assert.equal(state.dataRoot, f.dataRoot);
    assert.equal(state.claudeHome, f.claudeHome);
    assert.deepEqual(state.ownedFiles, {});
    assert.equal(state.configuration, null);
    assert.equal(state.hooks, null);
    for (const [name, hash] of Object.entries(readJson(path.join(f.source, 'manifest.json')).files))
      assert.equal(digest(fs.readFileSync(path.join(result.runtimeRoot, name))), hash);
    assert.equal(readJson(path.join(result.runtimeRoot, '.vault-runtime.json')).manifestSha256,
      digest(fs.readFileSync(path.join(f.source, 'manifest.json'))));
    for (const [name, data] of Object.entries(projectBefore))
      assert.equal(snapshot(f.project)[name], data);
    assert.deepEqual(snapshot(f.claudeHome), homeBefore);
    assert.equal(fs.existsSync(f.skillPath('claude')), false);
    assert.equal(fs.existsSync(f.dataRoot), false);
    const installed = snapshot(f.root);
    const again = await f.run('install', 'claude', { runtimeBase: undefined, dataRoot: undefined, claudeHome: undefined });
    assert.equal(again.runtimeRoot, result.runtimeRoot);
    assert.deepEqual(snapshot(f.root), installed);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.resolutions, []);
  });

  for (const client of ['claude', 'codex']) {
    test(`${client} manual enable/disable preserves unrelated config, later edits and Hooks`, async t => {
      const f = fixture(t), original = seedNative(f, client);
      const settings = path.join(f.project, '.claude/settings.json');
      writeJson(settings, personalSettings());
      const settingsBefore = fs.readFileSync(settings), homeBefore = snapshot(f.claudeHome);
      await f.run('install', client);
      const result = await f.run('enable', client);
      assert.equal(result.enabled, true);
      assert.equal(result.capture, false);
      const enabled = readNative(f, client), field = client === 'claude' ? 'mcpServers' : 'mcp_servers';
      assert.deepEqual(enabled[field].vault_memory, {
        command: path.join(f.cache, 'claude-mem/1.0.0/bin/node.exe'),
        args: [path.join(f.cache, 'claude-mem/1.0.0/scripts/bridge.cjs'), '--mode', 'mcp',
          '--runtime', path.join(f.cache, 'claude-mem/1.0.0'), '--project', f.project,
          '--data-root', f.dataRoot, '--claude-home', f.claudeHome, '--observer', 'false'],
      });
      assert.deepEqual(fs.readFileSync(f.skillPath(client)), fs.readFileSync(path.join(f.source, 'skill/SKILL.md')));
      assert.deepEqual(fs.readFileSync(settings), settingsBefore);
      const once = snapshot(f.project);
      await f.run('enable', client);
      assert.deepEqual(snapshot(f.project), once);
      if (client === 'claude') {
        enabled.personalAddedLater = { keep: true };
        writeJson(f.configPath(client), enabled);
        original.personalAddedLater = { keep: true };
      } else {
        fs.appendFileSync(f.configPath(client), '# Keep this later comment\n\n[personal_later]\nkeep = true\n');
        original.personal_later = { keep: true };
      }
      await f.run('disable', client);
      assert.deepEqual(readNative(f, client), original);
      if (client === 'codex') {
        const text = fs.readFileSync(f.configPath(client), 'utf8');
        assert.ok(text.startsWith('# Personal TOML comments\n'));
        assert.ok(text.includes('# Keep this later comment\n'));
      }
      assert.equal(fs.existsSync(f.skillPath(client)), false);
      assert.deepEqual(fs.readFileSync(settings), settingsBefore);
      assert.deepEqual(snapshot(f.claudeHome), homeBefore);
      assert.equal(f.state(client).enabled, false);
      assert.equal(f.state(client).configuration, null);
      assert.deepEqual(f.calls.map(call => call.method), ['stop']);
      assert.deepEqual(f.resolutions, []);
    });
  }

  test('Claude capture is explicit, preserves personal Hook groups and is removed before worker stop', async t => {
    const f = fixture(t), settings = path.join(f.project, '.claude/settings.json');
    const original = personalSettings(); writeJson(settings, original);
    await f.run('install'); await f.run('enable');
    await refusesUnchanged(f, 'enable', 'claude', { capture: true }, /Disable.*re-enable/i);
    await f.run('disable'); f.calls.length = 0;
    const enabled = await f.run('enable', 'claude', { capture: true });
    assert.equal(enabled.capture, true);
    assert.deepEqual(f.resolutions, [{ project: f.project, claudeHome: f.claudeHome }]);
    assert.ok(!JSON.stringify(enabled).includes(MOCK_KEY));
    const config = readJson(settings);
    assert.deepEqual(config.permissions, original.permissions);
    assert.deepEqual(config.enabledPlugins, original.enabledPlugins);
    assert.deepEqual(config.hooks.Stop[0], original.hooks.Stop[0]);
    const events = { SessionStart: 'context', UserPromptSubmit: 'session-init', PostToolUse: 'observation',
      PostToolUseFailure: 'observation', PreToolUse: 'file-context', Stop: 'summarize',
      SubagentStop: 'subagent-stop', SessionEnd: 'session-end' };
    for (const [event, action] of Object.entries(events)) {
      const hook = config.hooks[event].at(-1).hooks[0];
      assert.equal(hook.type, 'command');
      assert.ok(hook.timeout > 0 && hook.timeout <= 120);
      const match = /^powershell\.exe -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(hook.command);
      assert.ok(match, 'Hook must keep paths outside the native shell grammar');
      const script = Buffer.from(match[1], 'base64').toString('utf16le').replace(/''/g, "'");
      for (const value of [path.join(f.cache, 'claude-mem/1.0.0/bin/node.exe'),
        path.join(f.cache, 'claude-mem/1.0.0/scripts/bridge.cjs'), f.project, f.dataRoot, f.claudeHome])
        assert.ok(script.includes(value), 'Hook lost an installation path');
      assert.ok(script.includes('"--event" "' + action + '"'));
      assert.ok(script.includes('"--observer" "true"'));
    }
    assert.deepEqual(f.calls, []);
    await f.run('enable', 'claude', { capture: true });
    assert.deepEqual(readJson(settings), config, 'Repeated enable duplicated capture Hooks');
    const later = { hooks: [{ type: 'command', command: 'echo added-later' }] };
    config.hooks.Stop.push(later); writeJson(settings, config);
    await f.run('disable');
    original.hooks.Stop.push(later);
    assert.deepEqual(readJson(settings), original);
    assert.deepEqual(f.calls.map(call => call.method), ['stop']);
    assert.equal(f.calls[0].states.claude, false);
  });

  test('Codex refuses unverified automatic capture before changing any native file', async t => {
    const f = fixture(t); await f.run('install', 'codex');
    await refusesUnchanged(f, 'enable', 'codex', { capture: true }, /Codex.*manual.*capture/i);
    assert.deepEqual(f.resolutions, []);
  });

  test('capture refuses an unconfigured native connection without installing partial integration', async t => {
    const f = fixture(t); await f.run('install'); f.configured = false;
    await refusesUnchanged(f, 'enable', 'claude', { capture: true }, /credentials|connection/i);
    assert.equal(f.state().enabled, false);
    assert.equal(fs.existsSync(f.skillPath('claude')), false);
  });

  test('CLI options reject implicit capture, relative roots, duplicates and unknown arguments', () => {
    const base = ['--action', 'enable', '--client', 'claude', '--project', TMP];
    const install = ['--action', 'install', '--client', 'claude', '--project', TMP];
    assert.equal(manager.options(base).capture, false);
    assert.equal(manager.options([...base, '--capture', 'true']).capture, true);
    for (const extra of [['--capture', 'false'], ['--capture', 'yes'], ['--project', TMP], ['--unknown', 'value']])
      assert.throws(() => manager.options([...base, ...extra]));
    for (const key of ['--runtime-root', '--data-root', '--claude-home']) {
      assert.throws(() => manager.options([...install, key, 'relative']), /absolute paths/i);
      assert.throws(() => manager.options([...base, key, TMP]), /install.*option/i);
    }
    assert.throws(() => manager.options(['--action', 'install', '--client', 'claude', '--project', 'relative']), /absolute paths/i);
    assert.throws(() => manager.options([...install, '--capture', 'true']), /only with enable/i);
  });

  test('invalid direct API actions and clients cannot fall through to disabling an existing integration', async t => {
    const f = fixture(t); await f.run('install'); await f.run('enable');
    await refusesUnchanged(f, 'typo', 'claude', {}, /Invalid management action or client/i);
    await refusesUnchanged(f, 'disable', '../outside', {}, /Invalid management action or client/i);
    assert.equal(f.state().enabled, true);
    assert.equal(fs.existsSync(f.skillPath('claude')), true);
  });

  for (const client of ['claude', 'codex']) for (const location of ['home', 'project', 'local']) {
    test(`${client} rejects an original native claude-mem plugin even when disabled in ${location} settings`, async t => {
      const f = fixture(t); await f.run('install', client);
      const target = location === 'home' ? path.join(f.claudeHome, 'settings.json')
        : path.join(f.project, '.claude', location === 'local' ? 'settings.local.json' : 'settings.json');
      writeJson(target, { enabledPlugins: { 'claude-mem@original-fixture': false, 'other@fixture': true } });
      await refusesUnchanged(f, 'enable', client, {}, /native claude-mem plugin.*conflict/i);
    });
  }

  for (const [client, global] of [['claude', false], ['codex', false], ['codex', true]]) {
    test(`${client} rejects an existing ${global ? 'global' : 'project'} native mcp-search registration`, async t => {
      const f = fixture(t); await f.run('install', client);
      const target = global ? path.join(f.codexHome, 'config.toml') : f.configPath(client);
      const data = { [client === 'claude' ? 'mcpServers' : 'mcp_servers']: { 'mcp-search': { command: 'original-memory-fixture' } } };
      write(target, client === 'claude' ? JSON.stringify(data) : toml.stringify(data));
      await refusesUnchanged(f, 'enable', client, {}, /memory MCP.*conflict/i);
    });
  }

  test('Codex rejects an existing original plugin in its isolated native home', async t => {
    const f = fixture(t); await f.run('install', 'codex');
    write(path.join(f.codexHome, 'config.toml'), '[plugins."claude-mem@fixture"]\nenabled = false\n');
    await refusesUnchanged(f, 'enable', 'codex', {}, /Codex claude-mem plugin.*conflict/i);
  });

  test('existing personal memory Hooks cannot be adopted by explicit capture', async t => {
    const f = fixture(t); await f.run('install');
    writeJson(path.join(f.project, '.claude/settings.json'), {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node original-claude-mem-fixture.cjs' }] }] },
    });
    await refusesUnchanged(f, 'enable', 'claude', { capture: true }, /memory Hook.*conflict/i);
  });

  for (const client of ['claude', 'codex']) {
    test(`${client} refuses unowned Skill and MCP files without adopting matching names`, async t => {
      const f = fixture(t); await f.run('install', client);
      write(f.skillPath(client), 'personal Skill installation');
      await refusesUnchanged(f, 'enable', client, {}, /unowned.*Skill/i);
      fs.unlinkSync(f.skillPath(client));
      const data = { [client === 'claude' ? 'mcpServers' : 'mcp_servers']: { vault_memory: { command: 'personal-tool' } } };
      write(f.configPath(client), client === 'claude' ? JSON.stringify(data) : toml.stringify(data));
      await refusesUnchanged(f, 'enable', client, {}, /unowned.*MCP/i);
    });

    test(`${client} preserves malformed native configuration on enable failure`, async t => {
      const f = fixture(t); await f.run('install', client);
      write(f.configPath(client), client === 'claude' ? '{broken' : 'broken = [');
      await refusesUnchanged(f, 'enable', client, {}, /./);
    });

    test(`${client} edited owned Skill prevents enable, disable and uninstall without partial writes`, async t => {
      const f = fixture(t); await f.run('install', client); await f.run('enable', client);
      fs.appendFileSync(f.skillPath(client), '\npersonal Skill edit');
      for (const action of ['enable', 'disable', 'uninstall'])
        await refusesUnchanged(f, action, client, {}, /Managed file changed/i);
    });

    test(`${client} edited owned MCP prevents enable, disable and uninstall without partial writes`, async t => {
      const f = fixture(t); await f.run('install', client); await f.run('enable', client);
      if (client === 'claude') {
        const config = readNative(f, client); config.mcpServers.vault_memory.command = 'personal-command';
        writeJson(f.configPath(client), config);
      } else {
        const config = fs.readFileSync(f.configPath(client), 'utf8');
        write(f.configPath(client), config.replace(/^command = .*$/m, 'command = "personal-command"'));
      }
      for (const action of ['enable', 'disable', 'uninstall'])
        await refusesUnchanged(f, action, client, {}, /MCP entry was edited/i);
    });
  }

  for (const mutation of ['edited', 'duplicated', 'removed']) {
    test(`${mutation} capture Hook group prevents all destructive integration changes`, async t => {
      const f = fixture(t); await f.run('install'); await f.run('enable', 'claude', { capture: true });
      const target = path.join(f.project, '.claude/settings.json'), config = readJson(target);
      if (mutation === 'edited') config.hooks.Stop[0].hooks[0].timeout += 1;
      if (mutation === 'duplicated') config.hooks.Stop.push(structuredClone(config.hooks.Stop[0]));
      if (mutation === 'removed') delete config.hooks.Stop;
      writeJson(target, config);
      for (const action of ['enable', 'disable', 'uninstall'])
        await refusesUnchanged(f, action, 'claude', {}, /Hook.*modified|Hook.*duplicated/i);
    });
  }

  test('Codex preserves inline MCP tables and edited management-block comments on refusal', async t => {
    const f = fixture(t); await f.run('install', 'codex');
    write(f.configPath('codex'), '# keep\nmcp_servers = { other = { command = "personal-tool" } }\n');
    await refusesUnchanged(f, 'enable', 'codex', {}, /./);
    fs.unlinkSync(f.configPath('codex'));
    await f.run('enable', 'codex');
    fs.appendFileSync(f.configPath('codex'), '# outside block survives\n');
    const text = fs.readFileSync(f.configPath('codex'), 'utf8');
    write(f.configPath('codex'), text.replace('# END AgentPluginSkillVault', '# personal block edit\n# END AgentPluginSkillVault'));
    await refusesUnchanged(f, 'uninstall', 'codex', {}, /block was edited/i);
  });

  test('failed final state publication rolls back Skill, MCP and capture Hooks', async t => {
    const f = fixture(t); await f.run('install');
    seedNative(f, 'claude'); writeJson(path.join(f.project, '.claude/settings.json'), personalSettings());
    const rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => {
      if (to === f.statePath()) throw Error('Injected project-state publication failure');
      return rename(from, to);
    });
    await refusesUnchanged(f, 'enable', 'claude', { capture: true }, /Injected project-state publication failure/);
    assert.equal(f.state().enabled, false);
    assert.equal(fs.existsSync(f.skillPath('claude')), false);
  });

  test('uninstall retains private memories, native settings, personal files and a sibling runtime', async t => {
    const f = fixture(t); await f.run('install'); await f.run('install', 'codex');
    await f.run('enable'); await f.run('enable', 'codex');
    write(path.join(f.dataRoot, 'project-fixture/claude-mem.db'), 'fixture database, not a real user database');
    write(path.join(f.dataRoot, 'project-fixture/backups/retained'), 'personal backup');
    write(path.join(f.project, '.claude/skills/vault-memory/personal.md'), 'personal extension file');
    const dataBefore = snapshot(f.dataRoot), cacheBefore = snapshot(f.cache), homeBefore = snapshot(f.claudeHome);
    const siblingBefore = fs.readFileSync(f.statePath('codex'));
    await f.run('uninstall');
    assert.deepEqual(fs.readFileSync(f.statePath('codex')), siblingBefore);
    assert.equal(fs.existsSync(f.skillPath('codex')), true);
    assert.deepEqual(f.calls, [], 'Uninstall stopped a shared manual worker still used by the sibling');
    assert.equal((await f.run('status')).status, 'not-installed');
    await f.run('uninstall', 'codex');
    assert.deepEqual(snapshot(f.dataRoot), dataBefore);
    assert.deepEqual(snapshot(f.cache), cacheBefore);
    assert.deepEqual(snapshot(f.claudeHome), homeBefore);
    assert.equal(fs.readFileSync(path.join(f.project, '.claude/skills/vault-memory/personal.md'), 'utf8'), 'personal extension file');
    assert.equal(fs.existsSync(f.configPath('claude')), false);
    assert.equal(fs.existsSync(f.configPath('codex')), false);
    assert.deepEqual(f.calls.map(call => call.method), ['stop']);
    assert.deepEqual(f.calls[0].states, { claude: null, codex: null });
    const after = snapshot(f.root);
    await f.run('uninstall', 'codex');
    assert.deepEqual(snapshot(f.root), after);
    assert.equal(f.calls.length, 1);
  });

  for (const field of ['runtimeBase', 'dataRoot', 'claudeHome']) {
    test(`a sibling cannot select a different ${field} for the shared project`, async t => {
      const f = fixture(t); await f.run('install');
      await refusesUnchanged(f, 'install', 'codex', { [field]: path.join(f.root, 'different-' + field) }, /same runtime, data and native Claude home/i);
      assert.equal(fs.existsSync(f.statePath('codex')), false);
    });
  }

  test('disabled sibling installations also prevent an incompatible shared runtime upgrade', async t => {
    const f = fixture(t); await f.run('install'); await f.run('install', 'codex');
    const target = path.join(f.source, 'manifest.json'), manifest = readJson(target);
    manifest.componentVersion = '1.0.1'; writeJson(target, manifest);
    await refusesUnchanged(f, 'install', 'claude', {}, /same runtime, data and native Claude home/i);
    assert.equal(f.state().componentVersion, '1.0.0');
  });

  test('separate projects reuse identical runtime bytes and reject changed bytes for the same version', async t => {
    const f = fixture(t), first = await f.run('install');
    const project = path.join(f.root, 'second project'); fs.mkdirSync(project);
    const cacheBefore = snapshot(f.cache);
    const second = await f.run('install', 'codex', { project });
    assert.equal(second.runtimeRoot, first.runtimeRoot);
    assert.deepEqual(snapshot(f.cache), cacheBefore);
    const target = path.join(f.source, 'manifest.json'), manifest = readJson(target);
    write(path.join(f.source, 'skill/SKILL.md'), 'different payload for already installed version');
    manifest.files['skill/SKILL.md'] = digest('different payload for already installed version');
    writeJson(target, manifest);
    await refusesUnchanged(f, 'install', 'claude', {}, /immutable release/i);
    assert.deepEqual(snapshot(f.cache), cacheBefore);
  });

  test('cached valid runtime installs another project without extracted payload but rejects uncached or tampered installs', async t => {
    const f = fixture(t), first = await f.run('install');
    const manifestBefore = fs.readFileSync(path.join(f.source, 'manifest.json'));
    const cacheBefore = snapshot(f.cache);
    fs.unlinkSync(path.join(f.source, 'plugin/scripts/mcp-server.cjs'));
    const secondProject = path.join(f.root, 'cached second project'); fs.mkdirSync(secondProject);
    const second = await f.run('install', 'codex', { project: secondProject });
    assert.equal(second.runtimeRoot, first.runtimeRoot);
    assert.equal(readJson(f.statePath('codex', secondProject)).runtimeRoot, first.runtimeRoot);
    assert.deepEqual(fs.readFileSync(path.join(f.source, 'manifest.json')), manifestBefore);
    assert.deepEqual(snapshot(f.cache), cacheBefore, 'Cache reuse copied or changed payload bytes');

    const uncachedProject = path.join(f.root, 'uncached project'), runtimeBase = path.join(f.root, 'fresh cache');
    fs.mkdirSync(uncachedProject);
    await refusesUnchanged(f, 'install', 'claude', { project: uncachedProject, runtimeBase }, /ENOENT|Managed file changed or missing/i);
    assert.equal(fs.existsSync(f.statePath('claude', uncachedProject)), false);
    assert.equal(fs.existsSync(runtimeBase), false, 'Unusable source published a new runtime cache');

    await f.run('enable');
    fs.appendFileSync(path.join(first.runtimeRoot, 'plugin/scripts/worker-service.cjs'), 'tampered cache');
    const tamperedProject = path.join(f.root, 'tampered cache project'); fs.mkdirSync(tamperedProject);
    await refusesUnchanged(f, 'install', 'claude', { project: tamperedProject }, /Managed file changed or missing/i);
    assert.equal(fs.existsSync(f.statePath('claude', tamperedProject)), false);
    await refusesUnchanged(f, 'enable', 'claude', {}, /Managed file changed or missing/i);
    assert.equal(f.state().enabled, true, 'Refused idempotent enable changed the existing integration');
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.resolutions, []);
  });

  test('configure propagates the native home to both disabled clients without changing native files or data', async t => {
    const f = fixture(t); await f.run('install'); await f.run('install', 'codex');
    const selected = path.join(f.root, 'selected native home');
    writeJson(path.join(selected, 'settings.json'), { model: 'other-fixture-model', env: { ANTHROPIC_API_KEY: MOCK_KEY } });
    const nativeBefore = snapshot(f.claudeHome), selectedBefore = snapshot(selected), cacheBefore = snapshot(f.cache);
    await f.run('configure', 'claude', { claudeHome: selected });
    for (const client of ['claude', 'codex']) {
      assert.equal(f.state(client).claudeHome, selected);
      assert.equal(f.state(client).dataRoot, f.dataRoot);
      assert.equal(f.state(client).enabled, false);
      await f.run('enable', client);
      const config = readNative(f, client), entry = config[client === 'claude' ? 'mcpServers' : 'mcp_servers'].vault_memory;
      assert.equal(entry.args[entry.args.indexOf('--claude-home') + 1], selected);
    }
    assert.deepEqual(snapshot(f.claudeHome), nativeBefore);
    assert.deepEqual(snapshot(selected), selectedBefore);
    assert.deepEqual(snapshot(f.cache), cacheBefore);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.resolutions, []);
  });

  for (const enabled of ['claude', 'codex']) {
    test(`configure refuses while ${enabled} is enabled, even when the selected client is disabled`, async t => {
      const f = fixture(t); await f.run('install'); await f.run('install', 'codex'); await f.run('enable', enabled);
      const other = enabled === 'claude' ? 'codex' : 'claude';
      await refusesUnchanged(f, 'configure', other, { claudeHome: path.join(f.root, 'other-home') }, /Disable both/i);
    });
  }

  test('configure rejects data movement or runtime movement and requires an explicit native home', async t => {
    const f = fixture(t); await f.run('install');
    for (const extra of [{}, { claudeHome: f.claudeHome, dataRoot: path.join(f.root, 'other-data') },
      { claudeHome: f.claudeHome, runtimeBase: path.join(f.root, 'other-runtime') }])
      await refusesUnchanged(f, 'configure', 'claude', extra, /explicit native Claude home only/i);
  });

  test('status/check/start/viewer/stop forward the stored roots and keep explicit starts observer-disabled', async t => {
    const f = fixture(t), installed = await f.run('install');
    const before = snapshot(f.root);
    for (const action of ['status', 'check', 'start', 'viewer', 'stop']) {
      const result = await f.run(action);
      assert.equal(result.ok, true);
      assert.equal(result.service.observer, false);
      assert.ok(!JSON.stringify(result).includes(MOCK_KEY));
    }
    assert.deepEqual(f.calls.map(call => call.method), ['status', 'check', 'start', 'start', 'stop']);
    for (const call of f.calls) assert.deepEqual(call.options, {
      runtime: installed.runtimeRoot, project: f.project, dataRoot: f.dataRoot, claudeHome: f.claudeHome,
      ...(call.method === 'start' ? { observer: false } : {}),
    });
    assert.deepEqual(snapshot(f.root), before);
    assert.deepEqual(f.resolutions, []);
  });

  test('status stays metadata-only for installed and uninstalled projects with unavailable payload metadata', async t => {
    const f = fixture(t), installed = await f.run('install');
    const uninstalledProject = path.join(f.root, 'uninstalled project'); fs.mkdirSync(uninstalledProject);
    const files = Object.keys(readJson(path.join(f.source, 'manifest.json')).files), payloadPaths = new Set();
    for (const root of [f.source, installed.runtimeRoot]) {
      fs.unlinkSync(path.join(root, 'plugin/scripts/mcp-server.cjs'));
      for (const name of files)
        for (let target = path.join(root, name); target !== root; target = path.dirname(target)) payloadPaths.add(target);
    }
    const before = snapshot(f.root), lstat = fs.lstatSync;
    t.mock.method(fs, 'lstatSync', function(target, ...args) {
      if (payloadPaths.has(path.resolve(target))) {
        const error = Error('Payload metadata is unavailable during status'); error.code = 'EACCES'; throw error;
      }
      return lstat.call(this, target, ...args);
    });
    const absent = await f.run('status', 'codex', { project: uninstalledProject });
    assert.equal(absent.ok, true);
    assert.equal(absent.status, 'not-installed');
    assert.equal(absent.installedVersion, null);
    assert.equal(absent.service, undefined);
    assert.deepEqual(f.calls, []);
    const present = await f.run('status');
    assert.equal(present.ok, true);
    assert.equal(present.status, 'installed');
    assert.equal(present.installedVersion, '1.0.0');
    assert.equal(present.runtimeRoot, installed.runtimeRoot);
    assert.equal(present.service.status, 'stopped');
    assert.deepEqual(f.calls.map(call => call.method), ['status']);
    assert.deepEqual(snapshot(f.root), before, 'Status wrote files while reporting unchecked installation state');
    assert.deepEqual(f.resolutions, []);
  });

  test('corrupt source never publishes an installation and corrupt runtime cannot enable or check', async t => {
    const f = fixture(t), bun = path.join(f.source, 'bin/bun.exe'), original = fs.readFileSync(bun);
    fs.appendFileSync(bun, 'corrupt');
    await refusesUnchanged(f, 'install', 'claude', {}, /Managed file changed/i);
    assert.equal(fs.existsSync(f.statePath()), false);
    write(bun, original);
    const installed = await f.run('install');
    fs.appendFileSync(path.join(installed.runtimeRoot, 'plugin/scripts/worker-service.cjs'), 'corrupt');
    for (const action of ['enable', 'check'])
      await refusesUnchanged(f, action, 'claude', {}, /Managed file changed/i);
  });

  test('unowned runtime content cannot be overwritten or adopted', async t => {
    const f = fixture(t);
    write(path.join(f.cache, 'claude-mem/1.0.0/personal.txt'), 'personal cache contents');
    await refusesUnchanged(f, 'install', 'claude', {}, /unowned.*immutable release/i);
  });

  test('manifest traversal is rejected before copying any payload', async t => {
    const f = fixture(t), target = path.join(f.source, 'manifest.json'), manifest = readJson(target);
    manifest.files['../outside'] = '0'.repeat(64); writeJson(target, manifest);
    await refusesUnchanged(f, 'install', 'claude', {}, /Unsafe managed path/i);
  });

  test('private memory roots inside the project, extracted package or immutable runtime are rejected', async t => {
    const f = fixture(t);
    for (const dataRoot of [path.join(f.project, 'private'), path.join(f.source, 'private'),
      path.join(f.cache, 'claude-mem/1.0.0/private')])
      await refusesUnchanged(f, 'install', 'claude', { dataRoot }, /Private memory data must be outside/i);
  });

  for (const marker of ['directory', 'file']) {
    test(`install refuses a Git-owned data root before publication when .git is a ${marker}`, async t => {
      const f = fixture(t), repository = path.join(f.root, 'separate Git repository');
      if (marker === 'directory') fs.mkdirSync(path.join(repository, '.git'), { recursive: true });
      else write(path.join(repository, '.git'), 'gitdir: fixture-worktree-metadata\n');
      const dataRoot = path.join(repository, 'nested/private-memory');
      await refusesUnchanged(f, 'install', 'claude', { dataRoot }, /Memory data must be outside Git/i);
      assert.equal(fs.existsSync(f.statePath()), false);
      assert.equal(fs.existsSync(f.cache), false, 'Invalid data root published runtime payload');
      assert.equal(fs.existsSync(dataRoot), false);
    });
  }

  for (const location of ['state', 'cache', 'data', 'home']) {
    test(`install refuses a linked ${location} path before publication`, async t => {
      const f = fixture(t), outside = path.join(f.root, 'external-target'); fs.mkdirSync(outside);
      write(path.join(outside, 'personal.txt'), 'keep outside contents');
      const extra = {};
      if (location === 'state') f.link(outside, path.relative(f.root, path.join(f.project, '.agent-vault')));
      else {
        const field = { cache: 'runtimeBase', data: 'dataRoot', home: 'claudeHome' }[location];
        extra[field] = f.link(outside, 'linked-' + location);
      }
      await refusesUnchanged(f, 'install', 'claude', extra, /Linked files or directories/i);
    });
  }

  for (const client of ['claude', 'codex']) {
    test(`${client} enable refuses linked native configuration directories without writing through them`, async t => {
      const f = fixture(t); await f.run('install', client);
      const outside = path.join(f.root, 'external-native'); fs.mkdirSync(outside);
      f.link(outside, path.relative(f.root, path.join(f.project, client === 'claude' ? '.claude' : '.codex')));
      await refusesUnchanged(f, 'enable', client, {}, /Linked files or directories/i);
    });
  }
});
