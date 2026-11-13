const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseDesignUrl, decodePng, credentialHeaders, resultStatus } = require('./fetch_mastergo.cjs');

test('preserves long file IDs and decodes escaped URL query delimiters', () => {
  const target = parseDesignUrl('https://seerdesignmg.sangfor.com/file/202966196127495?page_id=2%3A1\\&devMode=true\\&layer_id=4%3A31387');
  assert.equal(target.fileId, '202966196127495');
  assert.equal(target.pageId, '2:1');
  assert.equal(target.layerId, '4:31387');
});

test('source layer has precedence, page-only links retain their scope', () => {
  const source = parseDesignUrl('https://mastergo.com/file/123?page_id=2%3A1&layer_id=4%3A2&source_layer_id=9%3A8');
  assert.equal(source.layerId, '9:8');
  assert.equal(parseDesignUrl('https://mastergo.com/file/123?page_id=2%3A1').layerId, '2:1');
  assert.equal(parseDesignUrl('https://mastergo.com/file/123').layerId, null);
});

test('rejects unrelated paths and URLs containing inline credentials', () => {
  assert.throws(() => parseDesignUrl('https://mastergo.com/123'));
  assert.throws(() => parseDesignUrl('https://secret@mastergo.com/file/123'));
  assert.throws(() => parseDesignUrl('file:///file/123'));
});

test('credential is added only to the design origin and stripped from other origins', () => {
  const origin = 'https://seerdesignmg.sangfor.com';
  const incoming = { accept: 'application/json', 'x-mg-useraccesstoken': 'stale' };
  assert.equal(credentialHeaders(origin + '/mcp/dsl', origin, 'test-token', incoming)['X-MG-UserAccessToken'], 'test-token');
  const remote = credentialHeaders('https://cdn.example.com/asset', origin, 'test-token', incoming);
  assert.equal(Object.keys(remote).some(key => key.toLowerCase() === 'x-mg-useraccesstoken'), false);
  assert.equal(remote.accept, 'application/json');
});

test('validates decoded PNG size and refuses HTML or truncated images', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL6sAAAAASUVORK5CYII=';
  const result = decodePng('data:image/png;base64,' + png);
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.throws(() => decodePng('data:text/html;base64,SGVsbG8='));
  assert.throws(() => decodePng('data:image/png;base64,' + Buffer.from('not png').toString('base64')));
});

test('structure success never masquerades as image success', () => {
  assert.equal(resultStatus('all', true, false), 'partial');
  assert.equal(resultStatus('all', false, true), 'partial');
  assert.equal(resultStatus('all', true, true), 'success');
  assert.equal(resultStatus('png', false, true), 'success');
  assert.equal(resultStatus('structure', true, false), 'success');
  assert.equal(resultStatus('all', false, false), 'blocked');
});

test('CLI with unavailable browser preserves failure evidence and does not reuse an old PNG', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mastergo-blocked-'));
  try {
    fs.writeFileSync(path.join(outDir, 'mastergo-123-4-2.png'), 'old artifact');
    const secret = 'test-token-must-not-appear';
    const result = spawnSync(process.execPath, [path.join(__dirname, 'fetch_mastergo.cjs'),
      '--url', 'https://mastergo.com/file/123?layer_id=4%3A2', '--out-dir', outDir,
      '--mode', 'png', '--playwright-module', path.join(outDir, secret, 'missing-module')], {
      encoding: 'utf8', env: { ...process.env, MG_MCP_TOKEN: secret },
    });
    assert.equal(result.status, 2);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.image.ok, false);
    assert.equal(manifest.nativeMcpUsed, false);
    assert.ok(manifest.attempts.some(item => item.path === 'browser' && !item.ok));
    assert.equal((result.stdout + result.stderr + JSON.stringify(manifest)).includes(secret), false);
    assert.equal(fs.readFileSync(path.join(outDir, 'mastergo-123-4-2.png'), 'utf8'), 'old artifact');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
