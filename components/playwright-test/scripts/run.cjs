'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspect, output } = require('./project.cjs');
const { regular } = require('./files.cjs');
const { owned } = require('./process.cjs');

function summarize(report, exitCode) {
  const stats = report?.stats;
  if (!stats || !['expected', 'unexpected', 'flaky', 'skipped'].every(key => Number.isInteger(stats[key]) && stats[key] >= 0))
    return { ok: false, status: 'incomplete', message: 'No valid test results were produced', exitCode: exitCode || 2 };
  const counts = { passed: stats.expected, failed: stats.unexpected, flaky: stats.flaky, skipped: stats.skipped };
  const total = Object.values(counts).reduce((sum, number) => sum + number, 0);
  const ok = exitCode === 0 && total > 0 && counts.passed === total && !report.errors?.length;
  return { ok, status: ok ? 'passed' : 'failed', ...counts, total, exitCode: ok ? 0 : (exitCode || 2) };
}

function verifyEvidence(report, evidenceDir) {
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) tests.push({ title: spec.title, test });
    for (const nested of suite.suites || []) visit(nested);
  }
  for (const suite of report.suites || []) visit(suite);
  if (!tests.length || tests.length !== report.stats?.expected) throw Error('Test records disagree with the passed test count');
  const root = fs.realpathSync(evidenceDir) + path.sep;
  const artifacts = [];
  for (const item of tests) {
    const result = item.test.results?.at(-1);
    if (item.test.expectedStatus !== 'passed' || item.test.status !== 'expected' || result?.status !== 'passed' || item.test.results.length !== 1 || result.retry)
      throw Error('Acceptance requires one genuine passing attempt per test: ' + item.title);
    for (const type of ['screenshot', 'video', 'trace']) {
      const attachment = result.attachments?.find(file => file.name === type && file.path);
      if (!attachment) throw Error('Missing ' + type + ' evidence for ' + item.title);
      const file = path.resolve(attachment.path);
      regular(file);
      if (!fs.realpathSync(file).startsWith(root) || fs.statSync(file).size === 0) throw Error('Evidence is empty or outside the run directory');
      artifacts.push({ test: item.title, type, path: file });
    }
  }
  return artifacts;
}

async function run(argv = process.argv.slice(2)) {
  const separator = argv.indexOf('--');
  const head = separator < 0 ? argv : argv.slice(0, separator);
  const extra = separator < 0 ? [] : argv.slice(separator + 1);
  if (head.length !== 2 || head[0] !== '--project' || !path.isAbsolute(head[1])) throw Error('Usage: run.cjs --project <absolute-project> -- [test-file-or-filter]');
  if (extra.some(arg => /^(-c$|--(?:config|reporter|output|list|ui|debug|only-changed|update-snapshots|last-failed)(?:=|$))/.test(arg)))
    throw Error('Use the managed configuration and evidence outputs; listing/debugging is separate from an acceptance run');
  const project = path.resolve(head[1]);
  const { root, marker } = inspect(project);
  const runtime = path.resolve(__dirname, '..');
  if (path.resolve(marker.runtimeRoot) !== runtime) throw Error('Project references another runtime');
  const id = 'run-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const evidenceDir = output(project, 'runs', id);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const env = { ...process.env, VAULT_TEST_RUN_ID: id, PLAYWRIGHT_BROWSERS_PATH: path.join(runtime, 'browsers'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', PLAYWRIGHT_HTML_OPEN: 'never' };
  const child = await owned(process.execPath, [path.join(runtime, 'runtime/node_modules/playwright/cli.js'), 'test', '--config', path.join(root, 'playwright.config.cjs'), '--grep-invert', '^setup seed -', ...extra], { cwd: project, env, inherit: true }, null);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'results.json'), 'utf8')); } catch { }
  const result = { ...summarize(report, child.timedOut ? 130 : child.code ?? 1), runId: id, selection: extra, evidenceDir, report: path.join(evidenceDir, 'html/index.html') };
  if (child.timedOut) { result.status = 'interrupted'; result.message = 'The owned test process was interrupted'; }
  if (result.ok) {
    try {
      result.artifacts = verifyEvidence(report, evidenceDir);
      if (!fs.existsSync(result.report)) throw Error('HTML report is missing');
    } catch (error) {
      result.ok = false; result.status = 'incomplete'; result.exitCode = 2; result.message = error.message;
    }
  }
  regular(evidenceDir);
  fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result) + '\n');
  return result.exitCode;
}

if (require.main === module) {
  run().then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
module.exports = { summarize, verifyEvidence, run };
