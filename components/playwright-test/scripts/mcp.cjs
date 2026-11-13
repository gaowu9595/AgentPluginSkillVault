'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { inspect } = require('./project.cjs');
const { regular } = require('./files.cjs');

function guard(tool, workspace, directory, extension) {
  const original = tool.handle;
  tool.schema.type = 'action';
  tool.handle = async (context, params, signal) => {
    const name = params.fileName;
    if (typeof name !== 'string' || path.isAbsolute(name) || /[\\:]/.test(name)) throw Error('Use a relative project test path');
    const target = path.resolve(context.rootPath, name);
    const root = path.join(workspace, directory);
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !extension.test(target))
      throw Error('Output must be inside the managed ' + directory + ' directory');
    regular(target);
    const { marker } = inspect(path.dirname(workspace));
    const managedName = path.relative(workspace, target).split(path.sep).join('/');
    const identity = name => process.platform === 'win32' ? name.toLowerCase() : name;
    if (Object.keys(marker.files).some(name => identity(name) === identity(managedName)))
      throw Error('Managed bootstrap files cannot be overwritten by generation tools');
    return original(context, params, signal);
  };
}

function adapt(runtime, workspace) {
  const library = path.join(runtime, 'runtime/node_modules/playwright/lib/mcp/test');
  const planner = require(path.join(library, 'plannerTools.js'));
  const generator = require(path.join(library, 'generatorTools.js'));
  guard(planner.saveTestPlan, workspace, 'specs', /\.md$/i);
  guard(generator.generatorWriteTest, workspace, 'tests', /\.(?:spec|test)\.[cm]?[jt]sx?$/i);
  planner.setupPage.schema.type = 'action';
  generator.setupPage.schema.type = 'action';
  const tests = require(path.join(library, 'testTools.js'));
  tests.runTests.schema.type = 'action';
  tests.debugTest.schema.type = 'action';
}

function start(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--project' || !path.isAbsolute(argv[1])) throw Error('Usage: mcp.cjs --project <absolute-project>');
  const project = regular(path.resolve(argv[1]));
  const { root, marker } = inspect(project);
  const runtime = path.resolve(__dirname, '..');
  if (path.resolve(marker.runtimeRoot) !== runtime) throw Error('Project references a different component runtime');
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(runtime, 'browsers');
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  process.env.VAULT_TEST_RUN_ID = 'mcp-' + Date.now() + '-' + process.pid;
  process.chdir(project);
  adapt(runtime, root);
  const cli = path.join(runtime, 'runtime/node_modules/playwright/cli.js');
  process.argv = [process.execPath, cli, 'run-test-mcp-server', '--headless', '--config', path.join(root, 'playwright.config.cjs')];
  require(cli);
}

if (require.main === module) {
  try { start(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { guard, adapt, start };
