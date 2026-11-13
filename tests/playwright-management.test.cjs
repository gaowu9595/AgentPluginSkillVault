'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const io = require('../components/playwright-test/scripts/files.cjs');
const native = require('../components/playwright-test/scripts/native-config.cjs');
const manager = require('../components/playwright-test/scripts/manage.cjs');
const { summarize, verifyEvidence } = require('../components/playwright-test/scripts/run.cjs');
const { guard } = require('../components/playwright-test/scripts/mcp.cjs');
const { owned } = require('../components/playwright-test/scripts/process.cjs');
const projectWorkspace = require('../components/playwright-test/scripts/project.cjs');
const toml = require('../components/playwright-test/vendor/smol-toml/index.cjs');

const TMP = path.resolve(__dirname, '../.ui_test');
fs.mkdirSync(TMP, { recursive: true });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(TMP, 'playwright-management-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(TMP + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const source = path.join(root, 'source'), project = path.join(root, 'project 中文 space'), cache = path.join(root, 'cache');
  fs.mkdirSync(project, { recursive: true });
  const files = {};
  for (const [name, data] of Object.entries({
    'bin/node.exe': 'fixture engine, not an executable', 'scripts/manage.cjs': 'fixture manager',
    'skill/SKILL.md': 'fixture skill', 'skill/LICENSE': 'fixture license',
    'agents/vault-playwright-test-planner.md': 'fixture planner',
    'agents/vault-playwright-test-generator.md': 'fixture generator',
    'agents/vault-playwright-test-healer.md': 'fixture healer',
  })) {
    const target = io.child(source, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data); files[name] = io.sha(Buffer.from(data));
  }
  io.atomic(path.join(source, 'manifest.json'), io.json({ schemaVersion: 1, protocolVersion: 1, componentId: 'playwright-test', componentVersion: '1.0.0', platform: 'windows-x64', engine: { sha256: files['bin/node.exe'] }, files }));
  const opts = { action: 'install', client: 'claude', project, runtimeBase: cache };
  return { root, source, project, cache, opts, run: (action, client = 'claude') => manager.manage({ ...opts, action, client }, source) };
}

test('install is isolated and idempotent, prepares no native MCP/agent settings', async t => {
  const f = fixture(t);
  const result = await f.run('install');
  assert.equal(result.enabled, false);
  assert.equal(fs.existsSync(path.join(f.project, '.mcp.json')), false);
  assert.equal(fs.existsSync(path.join(f.project, '.claude')), false);
  assert.equal(fs.existsSync(path.join(result.runtimeRoot, '.vault-runtime.json')), true);
  assert.equal((await f.run('install')).runtimeRoot, result.runtimeRoot);
  assert.equal((await f.run('status')).health, 'unchecked');
});

for (const client of ['claude', 'codex']) {
  test(`${client} native enable/disable preserves unrelated configuration and user evidence`, async t => {
    const f = fixture(t);
    const config = path.join(f.project, client === 'claude' ? '.mcp.json' : '.codex/config.toml');
    const original = client === 'claude' ? { other: 'retain', mcpServers: { existing: { command: 'my-local-tool', args: ['one'] } } } : { model: 'fixture-model', mcp_servers: { existing: { command: 'my-local-tool', args: ['one'] } } };
    io.atomic(config, Buffer.from(client === 'claude' ? JSON.stringify(original) : '# My comments stay\n' + toml.stringify(original)));
    await f.run('install', client);
    await f.run('enable', client);
    const content = fs.readFileSync(config, 'utf8');
    const enabled = client === 'claude' ? JSON.parse(content) : toml.parse(content);
    assert.ok(enabled[client === 'claude' ? 'mcpServers' : 'mcp_servers'].vault_playwright.command.includes('node.exe'));
    const personal = path.join(f.project, '.agent-vault-tests/tests/custom.spec.ts');
    fs.writeFileSync(personal, 'personal regression');
    const evidence = path.join(f.project, '.agent-vault-tests/runs/previous/trace.zip');
    fs.mkdirSync(path.dirname(evidence), { recursive: true }); fs.writeFileSync(evidence, 'fixture trace');
    await f.run('enable', client);
    await f.run('disable', client);
    const after = fs.readFileSync(config, 'utf8');
    assert.deepEqual(client === 'claude' ? JSON.parse(after) : toml.parse(after), original);
    if (client === 'codex') assert.ok(after.startsWith('# My comments stay\n'));
    await f.run('enable', client);
    await f.run('uninstall', client);
    assert.equal(fs.readFileSync(personal, 'utf8'), 'personal regression');
    assert.equal(fs.readFileSync(evidence, 'utf8'), 'fixture trace');
    assert.equal((await f.run('status', client)).status, 'not-installed');
    assert.equal((await f.run('uninstall', client)).status, 'not-installed');
  });
}

test('unowned native capability files are not overwritten', async t => {
  const f = fixture(t); await f.run('install');
  const file = path.join(f.project, '.claude/skills/vault-playwright/SKILL.md');
  io.atomic(file, Buffer.from('manual installation'));
  await assert.rejects(f.run('enable'), /Unowned native capability/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'manual installation');
  assert.equal(fs.existsSync(path.join(f.project, '.mcp.json')), false);
  assert.equal((await f.run('status')).enabled, false);
});

test('unowned MCP entry rejects adoption without touching original bytes', async t => {
  const f = fixture(t); await f.run('install');
  const config = path.join(f.project, '.mcp.json');
  const before = io.json({ mcpServers: { vault_playwright: { command: 'external-owner' } } });
  io.atomic(config, before);
  await assert.rejects(f.run('enable'), /unowned.*MCP/);
  assert.deepEqual(fs.readFileSync(config), before);
});

test('edited MCP entry prevents disable and leaves all managed files intact', async t => {
  const f = fixture(t); await f.run('install'); await f.run('enable');
  const config = path.join(f.project, '.mcp.json');
  const data = io.readJson(config); data.mcpServers.vault_playwright.command = 'user-edited'; io.atomic(config, io.json(data));
  await assert.rejects(f.run('disable'), /MCP entry was edited/);
  assert.equal(fs.existsSync(path.join(f.project, '.claude/skills/vault-playwright/SKILL.md')), true);
  assert.equal((await f.run('status')).enabled, true);
});

test('modified managed Skill blocks uninstall, additional personal files survive', async t => {
  const f = fixture(t); await f.run('install'); await f.run('enable');
  const skill = path.join(f.project, '.claude/skills/vault-playwright/SKILL.md');
  fs.appendFileSync(skill, '\nuser changes');
  await assert.rejects(f.run('uninstall'), /Managed file changed/);
  assert.ok(fs.readFileSync(skill, 'utf8').includes('user changes'));
});

test('corrupt source or runtime never becomes installed/ready', async t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.source, 'bin/node.exe'), 'corruption');
  await assert.rejects(f.run('install'), /Managed file changed/);
  assert.equal((await f.run('status')).status, 'not-installed');
});

test('unowned runtime cache and workspace are preserved', async t => {
  const f = fixture(t);
  const cache = path.join(f.cache, 'playwright-test/1.0.0'); fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(path.join(cache, 'personal'), 'keep');
  await assert.rejects(f.run('install'), /runtime is unowned/);
  assert.equal(fs.readFileSync(path.join(cache, 'personal'), 'utf8'), 'keep');
  const g = fixture(t); fs.mkdirSync(path.join(g.project, '.agent-vault-tests'));
  await assert.rejects(g.run('install'), /unowned .agent-vault-tests/);
});

test('both clients share immutable runtime but disable independently', async t => {
  const f = fixture(t);
  const left = await f.run('install', 'claude'), right = await f.run('install', 'codex');
  assert.equal(left.runtimeRoot, right.runtimeRoot);
  await f.run('enable', 'claude'); await f.run('enable', 'codex');
  await f.run('uninstall', 'claude');
  assert.equal((await f.run('status', 'codex')).enabled, true);
  assert.ok(toml.parse(fs.readFileSync(path.join(f.project, '.codex/config.toml'), 'utf8')).mcp_servers.vault_playwright);
});

test('native JSON/TOML parsing rejects malformed configuration before mutation', t => {
  const f = fixture(t);
  for (const [client, name, text] of [['claude', '.mcp.json', '{broken'], ['codex', '.codex/config.toml', 'broken = [']]) {
    io.atomic(path.join(f.project, name), Buffer.from(text));
    assert.throws(() => native.change(f.project, client, native.entry(f.cache, f.project), null));
    assert.equal(fs.readFileSync(path.join(f.project, name), 'utf8'), text);
  }
});

test('TOML inline-table incompatibility and edited block fail without losing comments', t => {
  const f = fixture(t); const target = path.join(f.project, '.codex/config.toml');
  io.atomic(target, Buffer.from('# preserve\nmcp_servers = { other = { command = "other" } }\n'));
  assert.throws(() => native.change(f.project, 'codex', native.entry(f.cache, f.project), null));
  assert.ok(fs.readFileSync(target, 'utf8').startsWith('# preserve'));
  fs.unlinkSync(target);
  const created = native.change(f.project, 'codex', native.entry(f.cache, f.project), null); io.transact([created]);
  fs.appendFileSync(target, '# comment outside block\n');
  const removed = native.change(f.project, 'codex', null, created.ownership);
  assert.ok(removed.after.toString().includes('# comment outside block'));
  const edited = fs.readFileSync(target, 'utf8').replace('# END AgentPluginSkillVault', '# extra\n# END AgentPluginSkillVault'); fs.writeFileSync(target, edited);
  assert.throws(() => native.change(f.project, 'codex', null, created.ownership), /block was edited/);
});

test('manifest traversal and linked paths are rejected before copying', async t => {
  const f = fixture(t); const data = io.readJson(path.join(f.source, 'manifest.json')); data.files['../escape'] = '0'.repeat(64); io.atomic(path.join(f.source, 'manifest.json'), io.json(data));
  await assert.rejects(f.run('install'), /Unsafe managed path/);
  const g = fixture(t);
  const outside = path.join(g.root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(g.project, '.agent-vault'), 'junction');
  await assert.rejects(g.run('install'), /Linked files or directories/);
});

test('MCP write tools reject traversal and directories outside managed plans/tests', async t => {
  const f = fixture(t); await f.run('install'); let invoked = false;
  const tool = { schema: { type: 'readOnly' }, handle: async () => { invoked = true; return 'saved'; } };
  guard(tool, path.join(f.project, '.agent-vault-tests'), 'specs', /\.md$/i);
  assert.equal(tool.schema.type, 'action');
  for (const name of ['../outside.md', '.agent-vault-tests/tests/other.md', '.agent-vault-tests/specs/../../../outside.md', 'C:/escape.md'])
    await assert.rejects(tool.handle({ rootPath: f.project }, { fileName: name }));
  assert.equal(invoked, false);
  assert.equal(await tool.handle({ rootPath: f.project }, { fileName: '.agent-vault-tests/specs/case.md' }), 'saved');
});

test('MCP generation cannot overwrite managed seed while allowing user-owned tests', async t => {
  const f = fixture(t); await f.run('install'); let invoked = false;
  const tool = { schema: {}, handle: async () => { invoked = true; return 'generated'; } };
  guard(tool, path.join(f.project, '.agent-vault-tests'), 'tests', /\.(?:spec|test)\.[cm]?[jt]sx?$/i);
  await assert.rejects(tool.handle({ rootPath: f.project }, { fileName: '.agent-vault-tests/tests/seed.spec.ts' }), /bootstrap files/);
  if (process.platform === 'win32')
    await assert.rejects(tool.handle({ rootPath: f.project }, { fileName: '.agent-vault-tests/tests/SEED.spec.ts' }), /bootstrap files/);
  assert.equal(invoked, false);
  assert.ok(projectWorkspace.inspect(f.project).marker.files['tests/seed.spec.ts']);
  assert.equal(await tool.handle({ rootPath: f.project }, { fileName: '.agent-vault-tests/tests/business.spec.ts' }), 'generated');
});

test('run and self-check evidence paths reject junctions before any output is written', async t => {
  const f = fixture(t); await f.run('install');
  const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  for (const directory of ['runs', 'checks']) {
    fs.symlinkSync(outside, path.join(f.project, '.agent-vault-tests', directory), 'junction');
    assert.throws(() => projectWorkspace.output(f.project, directory, 'test-output'), /Linked files or directories/);
  }
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('shared workspace upgrades reject stale native client enable/check', async t => {
  const f = fixture(t); await f.run('install', 'claude'); await f.run('install', 'codex');
  const file = path.join(f.source, 'manifest.json'), data = io.readJson(file); data.componentVersion = '1.0.1'; io.atomic(file, io.json(data));
  await f.run('install', 'claude'); await f.run('enable', 'claude');
  await assert.rejects(f.run('enable', 'codex'), /Reinstall this client/);
  await assert.rejects(f.run('check', 'codex'), /Reinstall this client/);
  assert.equal((await f.run('status', 'codex')).enabled, false);
});

test('summary never calls empty, skipped, flaky, missing or nonzero runs passed', () => {
  const good = { stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 0 }, errors: [] };
  assert.equal(summarize(good, 0).ok, true);
  for (const [report, exit] of [[null, 0], [{ stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 } }, 0], [{ stats: { ...good.stats, skipped: 1 } }, 0], [{ stats: { ...good.stats, flaky: 1 } }, 0], [good, 1], [{ ...good, errors: [{ message: 'setup failed' }] }, 0]]) {
    assert.equal(summarize(report, exit).ok, false);
    assert.notEqual(summarize(report, exit).exitCode, 0);
  }
});

test('transaction preflight prevents partial config/file writes on stale inputs', t => {
  const f = fixture(t); const first = path.join(f.project, 'one'), second = path.join(f.project, 'two');
  io.atomic(first, Buffer.from('before')); io.atomic(second, Buffer.from('concurrent'));
  assert.throws(() => io.transact([{ target: first, before: Buffer.from('before'), after: Buffer.from('after') }, { target: second, before: Buffer.from('old'), after: Buffer.from('new') }]), /File changed/);
  assert.equal(fs.readFileSync(first, 'utf8'), 'before');
});

test('evidence gate checks actual records and rejects expected failures or retries', t => {
  const f = fixture(t);
  const report = { stats: { expected: 1 }, suites: [{ specs: [{ title: 'business case', tests: [{ expectedStatus: 'failed', status: 'expected', results: [{ status: 'failed', retry: 0 }] }] }] }] };
  assert.throws(() => verifyEvidence(report, f.project), /genuine passing attempt/);
  report.suites[0].specs[0].tests[0] = { expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 1 }] };
  assert.throws(() => verifyEvidence(report, f.project), /genuine passing attempt/);
  report.stats.expected = 2;
  assert.throws(() => verifyEvidence(report, f.project), /records disagree/);
});

test('passing report without actual per-case media cannot satisfy the evidence gate', t => {
  const f = fixture(t);
  const report = { stats: { expected: 1 }, suites: [{ specs: [{ title: 'business case', tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, attachments: [] }] }] }] }] };
  assert.throws(() => verifyEvidence(report, f.project), /Missing screenshot/);
  const attachments = ['screenshot', 'video', 'trace'].map(name => {
    const file = path.join(f.project, name); fs.writeFileSync(file, 'unit-test-only artifact'); return { name, path: file };
  });
  report.suites[0].specs[0].tests[0].results[0].attachments = attachments;
  assert.equal(verifyEvidence(report, f.project).length, 3);
  fs.writeFileSync(attachments[0].path, '');
  assert.throws(() => verifyEvidence(report, f.project), /empty or outside/);
});

test('reinstall preserves an explicit runtime location and upgrades retain personal scenarios', async t => {
  const f = fixture(t);
  const initial = await f.run('install');
  const again = await manager.manage({ ...f.opts, runtimeBase: undefined }, f.source);
  assert.equal(again.runtimeRoot, initial.runtimeRoot);
  const custom = path.join(f.project, '.agent-vault-tests/tests/personal.spec.ts'); fs.writeFileSync(custom, 'keep my scenario');
  await f.run('enable');
  const manifestPath = path.join(f.source, 'manifest.json'), data = io.readJson(manifestPath);
  data.componentVersion = '1.0.1'; io.atomic(manifestPath, io.json(data));
  await assert.rejects(f.run('install'), /Disable this client/);
  await f.run('disable');
  const upgraded = await f.run('install');
  assert.equal(upgraded.installedVersion, '1.0.1');
  assert.notEqual(upgraded.runtimeRoot, initial.runtimeRoot);
  assert.equal(fs.existsSync(initial.runtimeRoot), true);
  assert.equal(fs.readFileSync(custom, 'utf8'), 'keep my scenario');
});

test('rollback preserves an intervening personal edit and reports manual recovery', t => {
  const f = fixture(t), first = path.join(f.project, 'one'), second = path.join(f.project, 'two');
  io.atomic(first, Buffer.from('before')); io.atomic(second, Buffer.from('before'));
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === second) { fs.writeFileSync(first, 'concurrent user edit'); throw Error('Injected second-file failure'); }
    return rename(from, to);
  });
  assert.throws(() => io.transact([{ target: first, before: Buffer.from('before'), after: Buffer.from('after') }, { target: second, before: Buffer.from('before'), after: Buffer.from('after') }]), /manual review/);
  assert.equal(fs.readFileSync(first, 'utf8'), 'concurrent user edit');
  assert.equal(fs.readFileSync(second, 'utf8'), 'before');
});

test('bounded self-check children are stopped by their owned PID on timeout', async () => {
  const result = await owned(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: process.env }, 100);
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
});
