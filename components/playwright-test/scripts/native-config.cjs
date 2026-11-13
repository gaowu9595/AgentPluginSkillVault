'use strict';

const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const toml = require('../vendor/smol-toml/index.cjs');
const { read, sha } = require('./files.cjs');

const KEY = 'vault_playwright';
const BEGIN = '# BEGIN AgentPluginSkillVault playwright-test';
const END = '# END AgentPluginSkillVault playwright-test';
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function entry(runtime, project) {
  return {
    command: path.join(runtime, 'bin/node.exe'),
    args: [path.join(runtime, 'scripts/mcp.cjs'), '--project', project],
    env: { PLAYWRIGHT_BROWSERS_PATH: path.join(runtime, 'browsers'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  };
}

function change(project, client, desired, owned) {
  const target = path.join(project, client === 'claude' ? '.mcp.json' : '.codex/config.toml');
  const before = read(target);
  const text = before ? before.toString('utf8').replace(/^\uFEFF/, '') : '';
  const data = client === 'claude' ? (text.trim() ? JSON.parse(text) : {}) : toml.parse(text);
  if (!object(data)) throw Error('Native configuration must be an object');
  const field = client === 'claude' ? 'mcpServers' : 'mcp_servers';
  if (data[field] !== undefined && !object(data[field])) throw Error('Native MCP configuration is not a table');
  const createdContainer = data[field] === undefined;
  const current = data[field]?.[KEY];
  if (owned) {
    if (!isDeepStrictEqual(current, owned.entry)) throw Error('The managed MCP entry was edited; preserve it before changing the component');
  } else if (current !== undefined) {
    throw Error('An unowned vault_playwright MCP entry already exists');
  }
  if (!desired && !owned) return { target, before, after: before, ownership: null };

  let after, block;
  if (client === 'claude') {
    data[field] ??= {};
    if (desired) data[field][KEY] = desired;
    else delete data[field][KEY];
    if (!Object.keys(data[field]).length && owned?.createdContainer) delete data[field];
    after = Buffer.from(JSON.stringify(data, null, 2) + '\n');
    if (!Object.keys(data).length && owned?.createdFile) after = null;
  } else {
    let preserved = text;
    if (owned) {
      const start = preserved.indexOf(BEGIN);
      const end = preserved.indexOf(END, start);
      if (start < 0 || end < 0 || preserved.indexOf(BEGIN, start + 1) >= 0) throw Error('Managed TOML block is missing or duplicated');
      const raw = preserved.slice(start, end + END.length);
      if (sha(Buffer.from(raw)) !== owned.blockSha256) throw Error('Managed TOML block was edited');
      preserved = preserved.slice(0, start) + preserved.slice(end + END.length);
    } else if (preserved.includes(BEGIN) || preserved.includes(END)) throw Error('Unowned TOML management markers exist');
    if (desired) {
      block = BEGIN + '\n' + toml.stringify({ [field]: { [KEY]: desired } }).trimEnd() + '\n' + END;
      const proposed = preserved + (preserved.endsWith('\n') || !preserved ? '' : '\n') + block + '\n';
      const parsed = toml.parse(proposed);
      const expected = structuredClone(data);
      expected[field] ??= {};
      expected[field][KEY] = desired;
      if (!isDeepStrictEqual(parsed, expected)) throw Error('Native TOML cannot safely append the managed entry');
      after = Buffer.from(proposed);
    } else {
      const parsed = toml.parse(preserved);
      if (parsed[field]?.[KEY] !== undefined) throw Error('Managed entry was not removed');
      after = !preserved.trim() && owned.createdFile ? null : Buffer.from(preserved);
    }
  }
  return {
    target, before, after,
    ownership: desired ? {
      entry: desired, createdFile: owned ? owned.createdFile : before === null,
      createdContainer: owned ? owned.createdContainer : createdContainer,
      ...(block ? { blockSha256: sha(Buffer.from(block)) } : {}),
    } : null,
  };
}

module.exports = { KEY, entry, change };
