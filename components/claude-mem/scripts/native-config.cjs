'use strict';

const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const toml = require('../vendor/smol-toml/index.cjs');
const { read, sha } = require('./files.cjs');

const KEY = 'vault_memory';
const BEGIN = '# BEGIN AgentPluginSkillVault claude-mem';
const END = '# END AgentPluginSkillVault claude-mem';
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function entry(runtime, project, dataRoot, claudeHome) {
  return {
    command: path.join(runtime, 'bin/node.exe'),
    args: [path.join(runtime, 'scripts/bridge.cjs'), '--mode', 'mcp', '--runtime', runtime,
      '--project', project, '--data-root', dataRoot, '--claude-home', claudeHome, '--observer', 'false'],
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
    throw Error('An unowned vault_memory MCP entry already exists');
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

function quotePS(value) { return "'" + value.replace(/'/g, "''") + "'"; }
function quoteWindows(value) { return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"'; }

function hookGroups(runtime, project, dataRoot, claudeHome) {
  const actions = {
    SessionStart: ['startup|resume|clear|compact', 'context', 60, false],
    UserPromptSubmit: [null, 'session-init', 30, false],
    PostToolUse: ['*', 'observation', 120, true],
    PostToolUseFailure: ['*', 'observation', 120, true],
    PreToolUse: ['Read|^read_file$|^Bash$|^Grep$|^Glob$|^memory_search$|^memory$|^mcp__.+__memory_search$', 'file-context', 30, false],
    Stop: [null, 'summarize', 120, true],
    SubagentStop: [null, 'subagent-stop', 30, true],
    SessionEnd: [null, 'session-end', 30, true],
  };
  return Object.fromEntries(Object.entries(actions).map(([name, [matcher, event, timeout, async]]) => {
    // Encoded PowerShell keeps project paths out of the native Hook shell grammar.
    const args = [path.join(runtime, 'scripts/bridge.cjs'), '--mode', 'hook', '--runtime', runtime,
      '--project', project, '--data-root', dataRoot, '--claude-home', claudeHome,
      '--event', event, '--observer', 'true'];
    const code = "$ErrorActionPreference='Stop'; $p=[Diagnostics.Process]::new(); " +
      '$p.StartInfo.FileName=' + quotePS(path.join(runtime, 'bin/node.exe')) + '; ' +
      '$p.StartInfo.Arguments=' + quotePS(args.map(quoteWindows).join(' ')) + '; ' +
      '$p.StartInfo.UseShellExecute=$false; $p.StartInfo.CreateNoWindow=$true; $p.StartInfo.RedirectStandardInput=$true; ' +
      '[void]$p.Start(); [Console]::OpenStandardInput().CopyTo($p.StandardInput.BaseStream); ' +
      '$p.StandardInput.Close(); $p.WaitForExit(); $code=$p.ExitCode; $p.Dispose(); exit $code';
    const command = 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from(code, 'utf16le').toString('base64');
    return [name, { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout, ...(async ? { async: true } : {}) }] }];
  }));
}

function hooks(project, desired, owned) {
  const target = path.join(project, '.claude/settings.json');
  const before = read(target);
  const data = before ? JSON.parse(before.toString('utf8').replace(/^\uFEFF/, '')) : {};
  if (!object(data) || data.hooks !== undefined && !object(data.hooks)) throw Error('Native Hooks configuration must be an object');
  const createdContainer = data.hooks === undefined;
  data.hooks ??= {};
  const createdEvents = [...(owned?.createdEvents || [])];
  if (owned) {
    for (const [event, group] of Object.entries(owned.groups)) {
      const list = data.hooks[event];
      if (!Array.isArray(list) || list.filter(item => isDeepStrictEqual(item, group)).length !== 1)
        throw Error('Managed memory Hook was modified or duplicated: ' + event);
      list.splice(list.findIndex(item => isDeepStrictEqual(item, group)), 1);
      if (!list.length && createdEvents.includes(event)) delete data.hooks[event];
    }
  }
  if (desired) {
    for (const [event, group] of Object.entries(desired)) {
      if (data.hooks[event] !== undefined && !Array.isArray(data.hooks[event])) throw Error('Native Hook event must be an array: ' + event);
      if (data.hooks[event] === undefined && !createdEvents.includes(event)) createdEvents.push(event);
      data.hooks[event] ??= [];
      data.hooks[event].push(group);
    }
  }
  if (!Object.keys(data.hooks).length && (owned?.createdContainer ?? createdContainer)) delete data.hooks;
  return { target, before, after: !Object.keys(data).length && owned?.createdFile ? null : Buffer.from(JSON.stringify(data, null, 2) + '\n'),
    ownership: desired ? { groups: desired, createdFile: owned?.createdFile ?? before === null,
      createdContainer: owned?.createdContainer ?? createdContainer, createdEvents } : null };
}

function conflicts(project, claudeHome, ownership, client = 'claude') {
  const candidates = [path.join(claudeHome, 'settings.json'), path.join(project, '.claude/settings.local.json'), path.join(project, '.claude/settings.json')];
  for (const target of candidates) {
    const buffer = read(target);
    if (!buffer) continue;
    const data = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    if (!object(data)) throw Error('Native settings must be an object');
    if (Object.keys(data.enabledPlugins || {}).some(key => /claude[-_]mem/i.test(key)))
      throw Error('Existing native claude-mem plugin entry conflicts with the Vault integration; keep one installation owner.');
    for (const [event, groups] of Object.entries(data.hooks || {})) {
      if (!Array.isArray(groups)) throw Error('Native Hook event must be an array');
      for (const group of groups) {
        if (target === path.join(project, '.claude/settings.json') && isDeepStrictEqual(group, ownership?.groups?.[event])) continue;
        if (/claude[-_]mem|vault_memory/i.test(JSON.stringify(group))) throw Error('An existing memory Hook conflicts with the Vault integration.');
      }
    }
  }
  const configs = client === 'codex' ? [path.join(process.env.CODEX_HOME || path.join(require('node:os').homedir(), '.codex'), 'config.toml'), path.join(project, '.codex/config.toml')]
    : [path.join(project, '.mcp.json')];
  for (const target of configs) {
    const buffer = read(target);
    if (!buffer) continue;
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const data = client === 'codex' ? toml.parse(text) : JSON.parse(text);
    const servers = data[client === 'codex' ? 'mcp_servers' : 'mcpServers'] || {};
    if (Object.keys(servers).some(key => key !== KEY && /^(?:mcp-search|claude[-_]mem(?:ory)?)$/i.test(key)))
      throw Error('An existing native memory MCP conflicts with the Vault integration.');
    if (client === 'codex' && Object.keys(data.plugins || {}).some(key => /claude[-_]mem/i.test(key)))
      throw Error('An existing Codex claude-mem plugin conflicts with the Vault integration.');
  }
}

module.exports = { KEY, entry, change, hookGroups, hooks, conflicts };
