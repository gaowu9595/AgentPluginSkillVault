'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTask, toggleTask } = require('../examples/playwright-regression/task-model.js');
const { startDemoServer } = require('../examples/playwright-regression/server.cjs');
const { parseArgs, readResults, verifyResults, inspectEvidence } = require('../examples/playwright-regression/demo.cjs');

test('fixed task rule rejects empty and Unicode whitespace without creating a task', () => {
  for (const title of ['', '   ', '\t', '\u3000 \t\u00a0']) {
    assert.deepEqual(createTask(title), { ok: false, error: '请输入任务名称' });
  }
});

test('repair trims only surrounding whitespace and preserves literal user content', () => {
  const result = createTask('  核对  <发布清单>  ');
  assert.equal(result.ok, true);
  assert.equal(result.task.title, '核对  <发布清单>');
  assert.equal(result.task.completed, false);
  assert.equal(typeof result.task.id, 'string');
  assert.notEqual(result.task.id, createTask('另一项任务').task.id);
});

test('the deliberate defect accepts whitespace, while the repaired rule rejects it', () => {
  assert.equal(createTask('   ', 'broken').ok, true);
  assert.equal(createTask('   ', 'broken').task.title, '   ');
  assert.equal(createTask('   ', 'fixed').ok, false);
  assert.equal(createTask('', 'broken').ok, false);
  assert.throws(() => createTask('任务', 'typo'), /mode/i);
});

test('completion is reversible and does not mutate task identity or its original state', () => {
  const task = createTask('发布检查').task;
  const completed = toggleTask(task);
  assert.equal(task.completed, false);
  assert.equal(completed.id, task.id);
  assert.equal(completed.title, task.title);
  assert.equal(completed.completed, true);
  assert.deepEqual(toggleTask(completed), task);
});

test('loopback server serves the actual app in both modes and closes its owned listener', async () => {
  for (const mode of ['broken', 'fixed']) {
    const server = await startDemoServer({ mode });
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      const page = await fetch(server.url);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-type'), /text\/html/);
      assert.match(await page.text(), /任务清单/);
      const config = await fetch(new URL('app-mode.js', server.url));
      assert.match(await config.text(), new RegExp(JSON.stringify(mode)));
      const model = await fetch(new URL('task-model.js', server.url));
      assert.match(await model.text(), /createTask/);
      assert.equal((await fetch(new URL('styles.css', server.url))).status, 200);
      assert.equal((await fetch(new URL('assets/mark.svg', server.url))).status, 200);
      assert.equal((await fetch(new URL('app.js', server.url), { method: 'HEAD' })).status, 200);
      for (const name of ['demo.cjs', 'cases.md', '%2e%2e%2fAGENTS.md', 'missing']) {
        assert.equal((await fetch(new URL(name, server.url))).status, 404);
      }
      assert.equal((await fetch(server.url, { method: 'POST' })).status, 405);
    } finally {
      await server.close();
    }
    await assert.rejects(fetch(server.url));
  }
});

test('server can use a copied project app without exposing adjacent user files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-demo-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'index.html'), '<title>Copied app</title>');
  await fs.writeFile(path.join(root, 'private.txt'), 'not public');
  const server = await startDemoServer({ root, mode: 'fixed' });
  try {
    assert.equal(await (await fetch(server.url)).text(), '<title>Copied app</title>');
    assert.equal((await fetch(new URL('private.txt', server.url))).status, 404);
  } finally {
    await server.close();
  }
});

function reportFor(failedIds = []) {
  const specs = Array.from({ length: 7 }, (_, index) => {
    const id = `TC${String(index + 1).padStart(2, '0')}`;
    const failed = failedIds.includes(id);
    return {
      title: `${id} business case`,
      tests: [{
        expectedStatus: 'passed',
        status: failed ? 'unexpected' : 'expected',
        results: [{ status: failed ? 'failed' : 'passed', retry: 0,
          ...(failed ? { error: { message: 'Error: expect(received).toBe(expected)' } } : {}) }],
      }],
    };
  });
  return { errors: [], stats: { expected: 7 - failedIds.length, unexpected: failedIds.length,
    skipped: 0, flaky: 0 }, suites: [{ suites: [{ specs }] }] };
}

test('report validation requires exact cases, initial business failures and fixed all-pass', () => {
  const broken = readResults(reportFor(['TC04', 'TC05']));
  assert.deepEqual(broken.counts, { total: 7, passed: 5, failed: 2, skipped: 0, flaky: 0 });
  verifyResults(broken, 'broken', 1);
  const fixed = readResults(reportFor());
  verifyResults(fixed, 'fixed', 0);
  assert.throws(() => verifyResults(fixed, 'broken', 0), /broken.*total=7.*passed=7.*failed=0/);
  assert.throws(() => verifyResults(broken, 'fixed', 1), /fixed.*total=7.*passed=5.*failed=2/);
  assert.throws(() => verifyResults(readResults(reportFor(['TC01', 'TC04'])), 'broken', 1), /TC04.*TC05/);
});

test('empty, skipped, retried, duplicated, missing and infrastructure failures cannot turn green', () => {
  const empty = { ...reportFor(), suites: [] };
  assert.throws(() => verifyResults(readResults(empty), 'fixed', 0), /total=0/);
  for (const mutate of [
    report => { report.suites[0].suites[0].specs[0].tests[0].results[0].status = 'skipped'; },
    report => { report.suites[0].suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 }); },
    report => { report.suites[0].suites[0].specs[0].tests[0].expectedStatus = 'failed'; },
    report => { report.suites[0].suites[0].specs[0].tests[0].status = 'unexpected'; },
    report => { report.suites[0].suites[0].specs[0].title = 'TC02 duplicate'; },
    report => { report.suites[0].suites[0].specs.pop(); },
    report => { report.errors.push({ message: 'browser could not launch' }); },
    report => { report.stats.skipped = 1; },
  ]) {
    const report = reportFor();
    mutate(report);
    assert.throws(() => verifyResults(readResults(report), 'fixed', 0));
  }
  const infrastructure = reportFor(['TC04', 'TC05']);
  infrastructure.suites[0].suites[0].specs[3].tests[0].results[0].error.message = 'browserType.launch failed';
  assert.throws(() => verifyResults(readResults(infrastructure), 'broken', 1), /assertion/i);
});

test('evidence guards reject an external directory, missing HTML and absent per-case media', async t => {
  // Synthetic report data exercises rejection only; it is never replay evidence.
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-demo-evidence-unit-'));
  t.after(() => fs.rm(project, { recursive: true, force: true }));
  const evidenceDir = path.join(project, '.agent-vault-tests', 'runs', 'unit-negative');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, 'results.json'), JSON.stringify(reportFor()));
  await assert.rejects(inspectEvidence({ evidenceDir: project }, project), /unique direct child/);
  await assert.rejects(inspectEvidence({ evidenceDir }, project), /ENOENT/);
  await fs.mkdir(path.join(evidenceDir, 'html'));
  await fs.writeFile(path.join(evidenceDir, 'html', 'index.html'), '<!doctype html><title>Unit rejection fixture</title>');
  await assert.rejects(inspectEvidence({ evidenceDir }, project), /screenshot, video and trace are all required/);
  const report = reportFor();
  report.suites[0].suites[0].specs[0].tests[0].results[0].attachments = [
    { name: 'screenshot', path: path.join(evidenceDir, 'not-an-image.png') },
  ];
  await fs.writeFile(path.join(evidenceDir, 'not-an-image.png'), 'invalid image');
  await fs.writeFile(path.join(evidenceDir, 'results.json'), JSON.stringify(report));
  await assert.rejects(inspectEvidence({ evidenceDir }, project), /Invalid screenshots artifact/);
});

test('CLI requires explicit isolated locations and rejects typos and duplicate arguments', () => {
  const component = path.join(os.tmpdir(), 'vault-component');
  const output = path.join(os.tmpdir(), 'vault-demo-new');
  assert.deepEqual(parseArgs(['--component', component, '--output', output]), {
    component, output,
  });
  for (const args of [[], ['--component'], ['--component', component], ['--out', output],
    ['--component', component, '--component', component, '--output', output],
    ['--component', component, '--output', 'relative-output']]) {
    assert.throws(() => parseArgs(args));
  }
});
