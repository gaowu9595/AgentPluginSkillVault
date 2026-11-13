#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');

function parseDesignUrl(input, overrides = {}) {
  const url = new URL(String(input).trim().replace(/\\&/g, '&').replace(/&amp;/g, '&'));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Use an HTTPS design URL without inline credentials.');
  }
  const match = /^\/file\/(\d+)\/?$/.exec(url.pathname);
  if (!match) throw new Error('Expected a MasterGo /file/<fileId> URL; resolve short links first.');
  const pageId = overrides.pageId || url.searchParams.get('page_id') || null;
  const sourceLayerId = url.searchParams.get('source_layer_id');
  const layerId = overrides.layerId || sourceLayerId || url.searchParams.get('layer_id') || pageId;
  const clean = new URL(`/file/${match[1]}`, url.origin);
  clean.searchParams.set('devMode', 'true');
  if (pageId) clean.searchParams.set('page_id', pageId);
  if (layerId && layerId !== pageId) clean.searchParams.set('layer_id', layerId);
  return { fileId: match[1], pageId, layerId, origin: url.origin, url: clean.href };
}

function credentialHeaders(url, origin, token, incoming = {}) {
  const headers = Object.fromEntries(Object.entries(incoming).filter(([key]) => key.toLowerCase() !== 'x-mg-useraccesstoken'));
  if (new URL(url).origin === origin && token) {
    headers['X-MG-UserAccessToken'] = token;
  }
  return headers;
}

function decodePng(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl || '');
  if (!match) throw new Error('exportPng did not return a PNG data URL.');
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length < 45 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.subarray(12, 16).toString() !== 'IHDR') {
    throw new Error('Exported PNG has an invalid header.');
  }
  if (buffer.subarray(-12).toString('hex') !== '0000000049454e44ae426082') {
    throw new Error('Exported PNG is truncated (missing IEND).');
  }
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height) throw new Error('Exported PNG has empty dimensions.');
  return { buffer, width, height };
}

function resultStatus(mode, structureOk, imageOk) {
  if (mode === 'structure') return structureOk ? 'success' : 'blocked';
  if (mode === 'png') return imageOk ? 'success' : 'blocked';
  return structureOk && imageOk ? 'success' : structureOk || imageOk ? 'partial' : 'blocked';
}

function readOptions(argv) {
  const options = { mode: 'all', timeoutMs: 90000, ignoreHttpsErrors: false };
  const names = {
    '--url': 'url', '--out-dir': 'outDir', '--mode': 'mode', '--layer-id': 'layerId',
    '--page-id': 'pageId', '--playwright-module': 'playwrightModule', '--browser-path': 'browserPath',
    '--profile-dir': 'profileDir', '--timeout-ms': 'timeoutMs',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help') options.help = true;
    else if (flag === '--plan') options.plan = true;
    else if (flag === '--ignore-https-errors') options.ignoreHttpsErrors = true;
    else if (names[flag] && argv[i + 1] && !argv[i + 1].startsWith('--')) options[names[flag]] = argv[++i];
    else throw new Error(`Unknown option or missing value: ${flag}`);
  }
  options.timeoutMs = Number(options.timeoutMs);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 180000) {
    throw new Error('--timeout-ms must be between 1000 and 180000.');
  }
  if (!['all', 'png', 'structure'].includes(options.mode)) throw new Error('--mode must be all, png, or structure.');
  return options;
}

function resolvePlaywright(explicit) {
  if (explicit || process.env.MASTERGO_PLAYWRIGHT_MODULE) return require(explicit || process.env.MASTERGO_PLAYWRIGHT_MODULE);
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(require.resolve(name, { paths: [process.cwd(), __dirname] })); } catch {}
  }
  // Reuse an installed npx cache without depending on its machine-specific hash.
  const npmCache = process.env.npm_config_cache || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'npm-cache')
    : path.join(os.homedir(), '.npm'));
  const cacheRoot = path.join(npmCache, '_npx');
  if (fs.existsSync(cacheRoot)) {
    for (const entry of fs.readdirSync(cacheRoot)) {
      for (const name of ['playwright', 'playwright-core']) {
        const modulePath = path.join(cacheRoot, entry, 'node_modules', name);
        if (fs.existsSync(path.join(modulePath, 'package.json'))) {
          try { return require(modulePath); } catch {}
        }
      }
    }
  }
  throw new Error('Playwright not found. Reuse a bundled runtime with --playwright-module, or install playwright-core locally.');
}

function browserExecutable(explicit) {
  if (explicit || process.env.MASTERGO_BROWSER_PATH) return explicit || process.env.MASTERGO_BROWSER_PATH;
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      for (const suffix of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
        const candidate = path.join(base, suffix);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined; // Playwright's installed Chromium on other platforms.
}

function requestJson(url, target, token, options) {
  if (new URL(url).origin !== target.origin) throw new Error('Refusing a cross-origin API request.');
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: credentialHeaders(url, target.origin, token, { Accept: 'application/json' }),
      rejectUnauthorized: !options.ignoreHttpsErrors,
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        const error = new Error(`Read-only API returned HTTP ${response.statusCode}.`);
        error.status = response.statusCode;
        reject(error); // No credential-bearing redirect or automatic auth/rate-limit retry.
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 64 * 1024 * 1024) response.destroy(new Error('API response exceeds 64 MiB.'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('API returned non-JSON content; browser export may still work.')); }
      });
      response.on('error', reject);
    });
    request.setTimeout(Math.min(options.timeoutMs, 30000), () => request.destroy(new Error('API request timed out.')));
    request.on('error', reject);
  });
}

function writeJson(outDir, filename, data) {
  fs.writeFileSync(path.join(outDir, filename), JSON.stringify(data, null, 2) + '\n', 'utf8');
  return filename;
}

function runtimeSettingsPath() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'mastergo', 'runtime.json');
}

function applySavedRuntime(options, origin) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(runtimeSettingsPath(), 'utf8')).origins?.[origin] || {}; } catch {}
  const environment = { profileDir: 'MASTERGO_BROWSER_PROFILE', playwrightModule: 'MASTERGO_PLAYWRIGHT_MODULE', browserPath: 'MASTERGO_BROWSER_PATH' };
  for (const [key, envName] of Object.entries(environment)) {
    if (!options[key] && !process.env[envName] && typeof saved[key] === 'string' && fs.existsSync(saved[key])) options[key] = saved[key];
  }
}

function rememberRuntime(origin, settings) {
  const filename = runtimeSettingsPath();
  let data = { schemaVersion: 1, origins: {} };
  try { data = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch {}
  data.origins ||= {};
  data.origins[origin] = settings;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function fetchStructure(target, token, options, manifest) {
  if (!token) {
    manifest.attempts.push({ path: 'read-only-api', ok: false, error: 'No environment token; trying the browser profile.' });
    return false;
  }
  for (const endpoint of ['design-sections', 'dsl']) {
    const url = new URL(`/mcp/${endpoint}`, target.origin);
    url.searchParams.set('fileId', target.fileId);
    url.searchParams.set('layerId', target.layerId);
    try {
      const data = await requestJson(url.href, target, token, options);
      if (!data || data.error || data.success === false || (data.code && ![0, 200, '0', '200'].includes(data.code))) {
        throw new Error('API returned an error envelope; trying browser runtime extraction.');
      }
      const value = data.data || data;
      if (typeof value !== 'object' || !['nodes', 'sections', 'results', 'root', 'dsl', 'totalSections'].some(key => key in value)) {
        throw new Error('API returned no recognizable design structure.');
      }
      const file = writeJson(options.outDir, `${endpoint}.json`, data);
      manifest.structure = { ok: true, file, path: `read-only-api:/mcp/${endpoint}`, coverage: 'response scope; design-sections may be an index only' };
      manifest.attempts.push({ path: `read-only-api:/mcp/${endpoint}`, ok: true });
      return true;
    } catch (error) {
      manifest.attempts.push({ path: `read-only-api:/mcp/${endpoint}`, ok: false, error: error.message });
      if (![404, 501].includes(error.status)) break;
    }
  }
  return false;
}

async function browserExport(target, token, options, manifest) {
  const { chromium } = resolvePlaywright(options.playwrightModule);
  const codexRoot = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const originKey = crypto.createHash('sha256').update(target.origin).digest('hex').slice(0, 12);
  const profileDir = path.resolve(options.profileDir || process.env.MASTERGO_BROWSER_PROFILE || path.join(codexRoot, 'mastergo-browser', originKey));
  const executablePath = browserExecutable(options.browserPath);
  const browser = await chromium.launchPersistentContext(profileDir, {
    executablePath, headless: true,
    ignoreHTTPSErrors: options.ignoreHttpsErrors, viewport: { width: 1800, height: 1200 },
  });
  try {
    // Extra context headers would leak the token to third-party assets: scope each request.
    await browser.route('**/*', route => route.continue({
      headers: credentialHeaders(route.request().url(), target.origin, token, route.request().headers()),
    }));
    const page = browser.pages()[0] || await browser.newPage();
    const failures = [];
    page.on('response', response => {
      if (response.status() >= 400 && failures.length < 12) {
        const url = new URL(response.url());
        failures.push({ origin: url.origin, path: url.pathname, status: response.status() });
      }
    });
    const navigation = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    manifest.browserNavigation = { status: navigation && navigation.status(), origin: new URL(page.url()).origin };
    try {
      await page.waitForFunction(() => window.mg && window.mg.document && window.mg.getNodeById, null, { timeout: options.timeoutMs });
    } catch {
      manifest.browserDiagnostics = { failedResponses: failures, runtimeAvailable: await page.evaluate(() => !!window.mg), title: await page.title() };
      throw new Error('MasterGo runtime did not load. See browserDiagnostics for HTTP, login or resource failures.');
    }
    if (!target.layerId) {
      const pages = await page.evaluate(() => Array.from(window.mg.document.children || []).map(node => ({
        id: node.id, name: node.name, children: Array.from(node.children || []).map(child => ({ id: child.id, name: child.name, type: child.type })),
      })));
      manifest.catalog = { file: writeJson(options.outDir, 'pages.json', pages), path: 'browser:window.mg.document' };
      return;
    }
    await page.waitForFunction(id => {
      const node = window.mg.getNodeById(id);
      return node && (node.type !== 'PAGE' || (node.children || []).length > 0);
    }, target.layerId, { timeout: options.timeoutMs });
    const runtime = await page.evaluate(id => {
      const seen = new Set(), texts = [];
      function walk(node) {
        if (seen.has(node.id)) return null;
        seen.add(node.id);
        const value = { id: node.id, name: node.name, type: node.type, x: node.x, y: node.y, width: node.width, height: node.height, visible: node.visible };
        if (node.type === 'TEXT' && node.characters) {
          value.text = node.characters;
          texts.push({ id: node.id, name: node.name, text: node.characters });
        }
        value.children = Array.from(node.children || []).map(walk).filter(Boolean);
        return value;
      }
      return { root: walk(window.mg.getNodeById(id)), texts, nodeCount: seen.size };
    }, target.layerId);
    const file = writeJson(options.outDir, 'runtime-structure.json', runtime);
    manifest.structure = { ok: true, file, path: 'browser:window.mg', coverage: 'selected subtree', nodeCount: runtime.nodeCount };
    manifest.texts = { file: writeJson(options.outDir, 'texts.json', runtime.texts), count: runtime.texts.length };
    manifest.attempts.push({ path: 'browser:window.mg', ok: true });
    if (options.mode !== 'structure') {
      await page.waitForFunction(() => typeof window.mg.exportPng === 'function', null, { timeout: options.timeoutMs });
      const dataUrl = await page.evaluate(async id => {
        const result = await Promise.race([
          window.mg.exportPng(window.mg.getNodeById(id)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('exportPng timed out.')), 90000)),
        ]);
        return result;
      }, target.layerId);
      const png = decodePng(dataUrl);
      const filename = `mastergo-${target.fileId}-${target.layerId.replace(/[^a-zA-Z0-9_-]/g, '-')}.png`;
      fs.writeFileSync(path.join(options.outDir, filename), png.buffer);
      manifest.image = {
        ok: true, file: filename, path: 'browser:window.mg.exportPng', name: runtime.root.name,
        width: png.width, height: png.height, bytes: png.buffer.length,
        sha256: crypto.createHash('sha256').update(png.buffer).digest('hex'),
      };
      manifest.attempts.push({ path: 'browser:window.mg.exportPng', ok: true });
    }
    // Save non-secret paths only after a real successful export/extraction.
    try {
      rememberRuntime(target.origin, {
        profileDir, ...(executablePath ? { browserPath: executablePath } : {}),
        ...((options.playwrightModule || process.env.MASTERGO_PLAYWRIGHT_MODULE) ? { playwrightModule: options.playwrightModule || process.env.MASTERGO_PLAYWRIGHT_MODULE } : {}),
      });
      manifest.runtimeRemembered = true;
    } catch { manifest.runtimeRemembered = false; }
  } finally {
    await browser.close();
  }
}

async function main(argv) {
  const options = readOptions(argv);
  if (options.help) {
    console.log('Usage: node fetch_mastergo.cjs --url HTTPS_URL --out-dir DIRECTORY [--mode all|png|structure]');
    console.log('Options: --layer-id ID --page-id ID --playwright-module PATH --browser-path PATH --profile-dir DIRECTORY --timeout-ms N --ignore-https-errors --plan');
    console.log('Credentials: MG_MCP_TOKEN or MASTERGO_API_TOKEN. No token command-line argument.');
    return 0;
  }
  if (!options.url) throw new Error('--url is required.');
  const target = parseDesignUrl(options.url, options);
  if (options.plan) { console.log(JSON.stringify({ target, mode: options.mode })); return 0; }
  applySavedRuntime(options, target.origin);
  if (!options.outDir) throw new Error('--out-dir is required.');
  options.outDir = path.resolve(options.outDir);
  fs.mkdirSync(options.outDir, { recursive: true });
  const token = process.env.MG_MCP_TOKEN || process.env.MASTERGO_API_TOKEN || '';
  const manifest = {
    schemaVersion: 1, fetchedAt: new Date().toISOString(), source: target, mode: options.mode,
    nativeMcpUsed: false, tlsVerification: !options.ignoreHttpsErrors,
    structure: { ok: false }, image: { ok: false }, attempts: [],
  };
  if (target.layerId && options.mode !== 'png') await fetchStructure(target, token, options, manifest);
  if (options.mode !== 'structure' || !manifest.structure.ok) {
    try { await browserExport(target, token, options, manifest); }
    catch (error) {
      manifest.attempts.push({ path: 'browser', ok: false, error: String(error.message).replaceAll(token || '\u0000', '[REDACTED]').slice(0, 1200) });
    }
  }
  manifest.status = manifest.catalog ? 'needs_target' : resultStatus(options.mode, manifest.structure.ok, manifest.image.ok);
  manifest.sourceFingerprint = manifest.image.sha256 || (manifest.structure.file
    ? crypto.createHash('sha256').update(fs.readFileSync(path.join(options.outDir, manifest.structure.file))).digest('hex') : null);
  const manifestFile = writeJson(options.outDir, 'manifest.json', manifest);
  console.log(JSON.stringify({ status: manifest.status, structure: manifest.structure.ok, image: manifest.image.ok, manifest: path.join(options.outDir, manifestFile), attempts: manifest.attempts }));
  return manifest.status === 'success' ? 0 : 2;
}

module.exports = { parseDesignUrl, decodePng, credentialHeaders, resultStatus, main };
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  const token = process.env.MG_MCP_TOKEN || process.env.MASTERGO_API_TOKEN || '';
  console.error(String(error.message).replaceAll(token || '\u0000', '[REDACTED]'));
  process.exitCode = 1;
});
