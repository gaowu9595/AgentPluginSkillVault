'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { child, read, readJson, sha, json, verify } = require('./files.cjs');

const OWNER = 'agent-plugin-skill-vault';
const DIRECTORY = '.agent-vault-tests';
function location(project) { return path.join(project, DIRECTORY); }

function files(runtime) {
  const runtimeRequire = JSON.stringify(path.join(runtime, 'runtime/package.json'));
  const runtimePackage = JSON.stringify(path.join(runtime, 'runtime/node_modules/@playwright/test'));
  return {
    'playwright.config.cjs': Buffer.from(
      `const { defineConfig } = require(${runtimePackage});\n` +
      `const path = require('node:path');\n` +
      `const fs = require('node:fs');\n` +
      `const localPath = path.join(__dirname, 'environment.local.json');\n` +
      `const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')) : {};\n` +
      `const run = process.env.VAULT_TEST_RUN_ID || 'mcp-session';\n` +
      `if (!/^[a-zA-Z0-9_-]+$/.test(run)) throw Error('Invalid test run identifier');\n` +
      `process.env.PLAYWRIGHT_BROWSERS_PATH = ${JSON.stringify(path.join(runtime, 'browsers'))};\n` +
      `process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';\n` +
      `module.exports = defineConfig({ testDir: './tests', forbidOnly: true, workers: 1, retries: 0,\n` +
      `  outputDir: path.join(__dirname, 'runs', run, 'test-results'),\n` +
      `  reporter: [['list'], ['json', { outputFile: path.join(__dirname, 'runs', run, 'results.json') }],\n` +
      `    ['html', { outputFolder: path.join(__dirname, 'runs', run, 'html'), open: 'never' }]],\n` +
      `  use: { headless: true, baseURL: process.env.VAULT_TEST_BASE_URL || local.baseURL, trace: 'on', screenshot: 'on', video: 'on' }\n` +
      `});\n`),
    'tests/fixtures.ts': Buffer.from(
      `import { createRequire } from 'node:module';\n` +
      `const runtimeRequire = createRequire(${runtimeRequire});\n` +
      `const playwright = runtimeRequire('@playwright/test');\n` +
      `export const test: typeof import('@playwright/test').test = playwright.test;\n` +
      `export const expect: typeof import('@playwright/test').expect = playwright.expect;\n`),
    'tests/seed.spec.ts': Buffer.from(
      `import { test } from './fixtures';\n` +
      `test('setup seed - not a business acceptance case', async ({ page }) => {\n` +
      `  const url = test.info().project.use.baseURL;\n` +
      `  if (!url) throw Error('Set VAULT_TEST_BASE_URL or environment.local.json baseURL to the authorized application URL');\n` +
      `  await page.goto(url);\n` +
      `});\n`),
    '.gitignore': Buffer.from('runs/\n.auth/\n.env\n.env.*\nenvironment.local.json\n'),
  };
}

function prepare(project, runtime, version) {
  const root = location(project);
  const markerPath = path.join(root, '.vault-workspace.json');
  const marker = readJson(markerPath);
  if (fs.existsSync(root) && !marker) throw Error('An unowned .agent-vault-tests directory already exists');
  if (marker && (marker.owner !== OWNER || marker.componentId !== 'playwright-test')) throw Error('Unowned test workspace marker');
  if (marker) verify(root, marker.files);
  const incoming = files(runtime);
  const changes = [];
  for (const [name, content] of Object.entries(incoming)) {
    const target = child(root, name);
    const before = read(target);
    if (before && !marker?.files?.[name]) throw Error('Managed workspace file conflicts with personal file: ' + name);
    changes.push({ target, before, after: content });
  }
  changes.push({ target: markerPath, before: read(markerPath), after: json({
    owner: OWNER, componentId: 'playwright-test', componentVersion: version, runtimeRoot: runtime,
    files: Object.fromEntries(Object.entries(incoming).map(([name, content]) => [name, sha(content)])),
  }) });
  return changes;
}

function inspect(project) {
  const root = location(project);
  const marker = readJson(path.join(root, '.vault-workspace.json'));
  if (!marker || marker.owner !== OWNER || marker.componentId !== 'playwright-test') throw Error('No managed test workspace; install the component for this project first');
  verify(root, marker.files);
  return { root, marker };
}

function output(project, directory, name) {
  if (!['runs', 'checks'].includes(directory)) throw Error('Unknown evidence directory');
  const { root } = inspect(project);
  return child(root, directory + '/' + name);
}

module.exports = { OWNER, DIRECTORY, location, prepare, inspect, output };
