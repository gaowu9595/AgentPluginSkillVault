'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { regular } = require('./files.cjs');

async function check(output) {
  regular(output);
  const root = path.resolve(__dirname, '..');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, 'browsers');
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
  const { chromium } = require(path.join(root, 'runtime/node_modules/playwright'));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: 20000 });
    const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
    page.setDefaultTimeout(10000);
    await page.goto('data:text/html,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><title>Vault browser check</title><h1>Playwright offline check</h1><p id="status">Browser is ready.</p>'));
    if (await page.locator('#status').innerText() !== 'Browser is ready.') throw Error('Browser page assertion failed');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    regular(output);
    await page.screenshot({ path: output });
    return { ok: true, nodeVersion: process.versions.node, playwrightVersion: require(path.join(root, 'runtime/node_modules/playwright/package.json')).version, browserVersion: browser.version(), screenshot: output };
  } finally { if (browser) await browser.close(); }
}
if (require.main === module) {
  check(path.resolve(process.argv[2])).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(error => {
    process.stdout.write(JSON.stringify({ ok: false, message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
module.exports = { check };
