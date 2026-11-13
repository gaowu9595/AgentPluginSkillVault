'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { startDemoServer } = require('./server.cjs');

const CASE_IDS = ['TC01', 'TC02', 'TC03', 'TC04', 'TC05', 'TC06', 'TC07'];
const SPEC = 'task-regression.spec.ts';
const APP_FILES = ['index.html', 'styles.css', 'app.js', 'app-mode.js', 'task-model.js', 'assets/mark.svg'];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--component', '--output'].includes(key) || !argv[index + 1] || argv[index + 1].startsWith('--'))
      throw new Error('Usage: demo.cjs --component <absolute-component-root> --output <new-absolute-directory>');
    const name = key.slice(2);
    if (options[name]) throw new Error(`Duplicate argument: ${key}`);
    if (!path.isAbsolute(argv[index + 1])) throw new Error(`${key} must be an absolute path`);
    options[name] = path.resolve(argv[index + 1]);
  }
  if (!options.component || !options.output) throw new Error('Both --component and --output are required');
  return options;
}

function readResults(report) {
  const cases = [];
  function visit(suite) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) cases.push({ title: spec.title, ...test });
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites || []) visit(suite);
  const counts = { total: cases.length, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const item of cases) {
    const results = item.results || [];
    if (results.length !== 1 || results[0]?.retry > 0) counts.flaky++;
    const status = results.at(-1)?.status;
    if (status === 'passed') counts.passed++;
    else if (status === 'skipped') counts.skipped++;
    else counts.failed++;
  }
  return { cases, counts, stats: report.stats, errors: report.errors || [] };
}

function verifyResults(result, mode, exitCode) {
  const { counts, cases, stats, errors } = result;
  const prefix = `${mode}: total=${counts.total} passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} flaky=${counts.flaky}`;
  function requireCondition(condition, message) {
    if (!condition) throw new Error(`${prefix}; ${message}`);
  }
  requireCondition(counts.total === CASE_IDS.length, 'Expected exactly seven business cases');
  const ids = cases.map(item => item.title.match(/^(TC\d{2})\b/)?.[1]).sort();
  requireCondition(JSON.stringify(ids) === JSON.stringify(CASE_IDS), 'Missing or duplicated business case IDs');
  requireCondition(!errors.length, 'Report contains infrastructure errors');
  requireCondition(counts.skipped === 0 && counts.flaky === 0, 'No skips, missing attempts or retries allowed');
  requireCondition(cases.every(item => item.expectedStatus === 'passed' &&
    item.status === (item.results[0].status === 'passed' ? 'expected' : 'unexpected')),
    'Business tests must expect success without annotations changing the outcome');
  requireCondition(stats && stats.expected === counts.passed && stats.unexpected === counts.failed && stats.skipped === 0 && stats.flaky === 0,
    'Reporter statistics disagree with actual test results');
  if (mode === 'broken') {
    requireCondition(exitCode === 1 && counts.passed === 5 && counts.failed === 2, 'Expected genuine initial failure');
    const failed = cases.filter(item => item.results[0].status !== 'passed');
    requireCondition(JSON.stringify(failed.map(item => item.title.slice(0, 4)).sort()) === JSON.stringify(['TC04', 'TC05']),
      'Only TC04 and TC05 should fail');
    requireCondition(failed.every(item => item.results[0].status === 'failed' && /expect\(/.test(item.results[0].error?.message || '')),
      'Initial failures must be business assertion failures');
  } else {
    requireCondition(mode === 'fixed' && exitCode === 0 && counts.passed === 7 && counts.failed === 0,
      'The repaired application must pass every case');
  }
}

function parseSummary(stdout) {
  try { return JSON.parse(stdout.trim()); } catch { /* The list reporter precedes the final JSON line. */ }
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* Reporter text is preserved in the log, not treated as a summary. */ }
  }
  throw new Error('The installed CLI did not print a JSON summary');
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function hashFile(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function inspectEvidence(summary, project) {
  if (typeof summary.evidenceDir !== 'string' || !path.isAbsolute(summary.evidenceDir))
    throw new Error('Run summary is missing an absolute evidenceDir');
  const runsRoot = await fs.realpath(path.join(project, '.agent-vault-tests', 'runs'));
  const evidenceDir = await fs.realpath(summary.evidenceDir);
  if (!inside(runsRoot, evidenceDir) || path.dirname(evidenceDir) !== runsRoot)
    throw new Error('Evidence must be a unique direct child of this project runs directory');
  const reportPath = path.join(evidenceDir, 'results.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const result = readResults(report);
  const media = { screenshots: 0, videos: 0, traces: 0 };
  const signatures = {
    screenshots: Buffer.from('89504e470d0a1a0a', 'hex'),
    videos: Buffer.from('1a45dfa3', 'hex'),
    traces: Buffer.from('504b0304', 'hex'),
  };
  async function requireFile(file) {
    const actual = await fs.realpath(file);
    if (!inside(evidenceDir, actual)) throw new Error('Evidence file escapes its run directory');
    const stat = await fs.stat(actual);
    if (!stat.isFile() || stat.size === 0) throw new Error(`Missing or empty evidence: ${file}`);
    return actual;
  }
  const htmlReport = await requireFile(path.join(evidenceDir, 'html', 'index.html'));
  if (!/<!doctype html/i.test(await fs.readFile(htmlReport, 'utf8')))
    throw new Error('The HTML report is not an HTML document');
  for (const item of result.cases) {
    const seen = new Set();
    for (const attempt of item.results || []) {
      for (const attachment of attempt.attachments || []) {
        const name = attachment.path || '';
        const kind = /\.png$/i.test(name) ? 'screenshots' : /\.webm$/i.test(name) ? 'videos'
          : attachment.name === 'trace' && /\.zip$/i.test(name) ? 'traces' : null;
        if (!kind) continue;
        const file = await requireFile(path.isAbsolute(name) ? name : path.resolve(project, name));
        const handle = await fs.open(file, 'r');
        try {
          const signature = signatures[kind];
          const bytes = Buffer.alloc(signature.length);
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
          if (bytesRead !== bytes.length || !bytes.equals(signature)) throw new Error(`Invalid ${kind} artifact: ${file}`);
        } finally {
          await handle.close();
        }
        seen.add(kind);
        media[kind]++;
      }
    }
    if (seen.size !== 3) throw new Error(`${item.title}: screenshot, video and trace are all required`);
  }
  return { evidenceDir, jsonReport: reportPath, htmlReport, media, ...result };
}

async function stopOwnedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    // Only this invocation's PID tree is eligible; never terminate by executable name.
    await new Promise(resolve => {
      const killer = spawn(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', resolve);
      killer.once('close', resolve);
    });
  } else child.kill('SIGTERM');
}

async function runCommand(node, script, args, { cwd, env, logPrefix, signal, timeoutMs = 240000 }) {
  const stdout = [];
  const stderr = [];
  let size = 0;
  let problem;
  const child = spawn(node, [script, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = reason => {
    problem ||= reason;
    void stopOwnedChild(child);
  };
  const onAbort = () => stop('Demo interrupted');
  const timer = setTimeout(() => stop(`CLI timeout after ${timeoutMs}ms`), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  function collect(chunks, data) {
    size += data.length;
    if (size <= 16 * 1024 * 1024) chunks.push(data);
    else stop('CLI output exceeded 16 MiB');
  }
  child.stdout.on('data', data => collect(stdout, data));
  child.stderr.on('data', data => collect(stderr, data));
  try {
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, terminatedBy) => resolve(code ?? (terminatedBy ? 1 : 2)));
    });
    const output = Buffer.concat(stdout).toString('utf8');
    const diagnostics = Buffer.concat(stderr).toString('utf8');
    await fs.writeFile(`${logPrefix}.stdout.log`, output);
    await fs.writeFile(`${logPrefix}.stderr.log`, diagnostics);
    if (problem) throw new Error(problem);
    return { exitCode, summary: parseSummary(output) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    await stopOwnedChild(child);
  }
}

async function runDemo({ component, output }) {
  if (!path.isAbsolute(component) || !path.isAbsolute(output)) throw new Error('Component and output paths must be absolute');
  component = await fs.realpath(component);
  output = path.resolve(output);
  output = path.join(await fs.realpath(path.dirname(output)), path.basename(output));
  if (inside(component, output) || component === output)
    throw new Error('Output must be outside the supplied component');
  const sourceNode = path.join(component, 'bin', 'node.exe');
  for (const file of [sourceNode, path.join(component, 'scripts', 'manage.cjs'), path.join(component, 'scripts', 'run.cjs')]) {
    if (!(await fs.stat(file)).isFile()) throw new Error(`Missing component entry point: ${file}`);
  }
  // mkdir is exclusive: a previous demo or personal directory is never reused or erased.
  await fs.mkdir(output);
  const project = path.join(output, '任务 工作区');
  const runtimeBase = path.join(output, 'runtime');
  const summary = { schemaVersion: 1, ok: false, component, project, runtimeBase,
    scope: 'local-browser-regression-only', installCount: 0, runs: {} };
  const abort = new AbortController();
  const onSignal = () => abort.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'package.json'), '{"private":true,"type":"module"}\n');
    const appRoot = path.join(project, 'app');
    for (const name of APP_FILES) {
      await fs.mkdir(path.dirname(path.join(appRoot, name)), { recursive: true });
      await fs.copyFile(path.join(__dirname, name), path.join(appRoot, name));
    }
    await fs.copyFile(path.join(__dirname, 'cases.md'), path.join(project, 'cases.md'));
    const install = await runCommand(sourceNode, path.join(component, 'scripts', 'manage.cjs'),
      ['--action', 'install', '--client', 'claude', '--project', project, '--runtime-root', runtimeBase],
      { cwd: output, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
        logPrefix: path.join(output, 'install'), signal: abort.signal });
    summary.install = install.summary;
    summary.installCount = 1;
    if (install.exitCode !== 0 || install.summary.ok !== true) throw new Error('Component installation failed');
    if (install.summary.enabled !== false) throw new Error('Demo preparation must not enable the native capability');
    if (typeof install.summary.runtimeRoot !== 'string' || !path.isAbsolute(install.summary.runtimeRoot))
      throw new Error('Installation must return its absolute runtimeRoot');
    const runtime = await fs.realpath(install.summary.runtimeRoot);
    const installedBase = await fs.realpath(runtimeBase);
    if (runtime !== installedBase && !inside(installedBase, runtime)) throw new Error('Installed runtime escaped the explicit isolated root');
    summary.runtimeRoot = runtime;
    const node = path.join(runtime, 'bin', 'node.exe');
    const runner = path.join(runtime, 'scripts', 'run.cjs');
    const testFile = path.join(project, '.agent-vault-tests', 'tests', SPEC);
    // This business spec is a user file, added after install and outside the ownership receipt.
    await fs.copyFile(path.join(__dirname, SPEC), testFile, fs.constants.COPYFILE_EXCL);
    const ownership = JSON.parse(await fs.readFile(path.join(project, '.agent-vault-tests', '.vault-workspace.json'), 'utf8'));
    if (ownership.files?.[`tests/${SPEC}`]) throw new Error('Business spec must remain a user-owned file');
    const testSha256 = await hashFile(testFile);
    summary.userTestFile = testFile;
    summary.testSha256 = testSha256;
    summary.casesSha256 = await hashFile(path.join(project, 'cases.md'));
    if (testSha256 !== await hashFile(path.join(__dirname, SPEC))) throw new Error('Spec copy changed bytes');
    for (const mode of ['broken', 'fixed']) {
      const server = await startDemoServer({ root: appRoot, mode });
      try {
        const run = await runCommand(node, runner, ['--project', project, '--', SPEC, '--workers=1', '--retries=0'], {
          cwd: project, env: { ...process.env, VAULT_TEST_BASE_URL: server.url, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
          logPrefix: path.join(output, mode), signal: abort.signal,
        });
        summary.runs[mode] = { mode, exitCode: run.exitCode, cli: run.summary };
        const countFields = ['total', 'passed', 'failed', 'skipped', 'flaky'];
        if (countFields.every(key => Number.isInteger(run.summary[key]) && run.summary[key] >= 0))
          summary.runs[mode].counts = Object.fromEntries(countFields.map(key => [key, run.summary[key]]));
        const evidence = await inspectEvidence(run.summary, project);
        Object.assign(summary.runs[mode], { counts: evidence.counts, evidenceDir: evidence.evidenceDir,
          jsonReport: evidence.jsonReport, htmlReport: evidence.htmlReport, media: evidence.media,
          failedCases: evidence.cases.filter(item => item.results.at(-1)?.status !== 'passed').map(item => item.title),
          testSha256: await hashFile(testFile) });
        verifyResults(evidence, mode, run.exitCode);
        if (summary.runs[mode].testSha256 !== testSha256 || await hashFile(path.join(__dirname, SPEC)) !== testSha256)
          throw new Error('Business tests changed during the replay');
        if (mode === 'fixed' && evidence.evidenceDir === summary.runs.broken.evidenceDir)
          throw new Error('Broken and fixed runs reused an evidence directory');
      } finally {
        await server.close();
      }
    }
    summary.ok = true;
  } catch (error) {
    summary.error = error.message;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    summary.summaryPath = path.join(output, 'demo-summary.json');
    await fs.writeFile(summary.summaryPath, JSON.stringify(summary, null, 2) + '\n');
  }
  return summary;
}

if (require.main === module) {
  (async () => {
    try {
      const summary = await runDemo(parseArgs(process.argv.slice(2)));
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      process.exitCode = summary.ok ? 0 : 1;
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
      process.exitCode = 1;
    }
  })();
}

module.exports = { parseArgs, readResults, verifyResults, inspectEvidence, runDemo };
