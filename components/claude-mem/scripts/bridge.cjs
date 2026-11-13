'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { addAbortSignal } = require('node:stream');
const service = require('./runtime.cjs');
const { regular, normalized, readJson } = require('./connection.cjs');
const EVENTS = new Set(['context', 'session-init', 'observation', 'file-context', 'summarize', 'subagent-stop', 'session-end']);
const TOOLS = new Set(['search', 'timeline', 'get_observations', 'get_tool_uses', 'save_memory', 'important_workflow', 'dumb_search']);
const MAX_LINE = 4 * 1024 * 1024;

function protocolFilter() {
  const lists = new Set();
  const key = value => JSON.stringify(value);
  return {
    incoming(message) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('Invalid MCP message');
      if (message.method === 'tools/call' && !TOOLS.has(message.params?.name)) return { forward: false,
        response: { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32601, message: 'Tool unavailable in Vault manual memory mode' } } };
      if (message.method === 'tools/list' && message.id !== undefined) {
        if (lists.size >= 128) throw Error('Too many pending MCP tool listings');
        lists.add(key(message.id));
      }
      return { forward: true };
    },
    outgoing(message) {
      if (message.method === undefined && message.id !== undefined && lists.delete(key(message.id)) && Array.isArray(message.result?.tools))
        return { ...message, result: { ...message.result, tools: message.result.tools.filter(tool => TOOLS.has(tool.name)) } };
      return message;
    },
  };
}

async function* messages(stream) {
  let pending = Buffer.alloc(0);
  for await (const chunk of stream) {
    pending = Buffer.concat([pending, chunk]);
    let newline;
    while ((newline = pending.indexOf(10)) >= 0) {
      if (newline > MAX_LINE) throw Error('MCP line exceeds size limit');
      const line = pending.subarray(0, newline); pending = pending.subarray(newline + 1);
      if (line.length) yield JSON.parse(line.toString('utf8'));
    }
    if (pending.length > MAX_LINE) throw Error('MCP line exceeds size limit');
  }
  if (pending.length) throw Error('Incomplete MCP protocol line');
}

async function send(stream, message) {
  const bytes = Buffer.from(JSON.stringify(message) + '\n');
  if (bytes.length > MAX_LINE) throw Error('MCP response exceeds size limit');
  if (!stream.write(bytes)) await once(stream, 'drain');
}

function options(argv) {
  const input = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--mode', '--runtime', '--project', '--data-root', '--claude-home', '--event', '--observer'].includes(key) ||
        value === undefined || key in input) throw Error('Invalid bridge arguments');
    input[key] = value;
  }
  if (!['mcp', 'hook'].includes(input['--mode'])) throw Error('Specify bridge mode mcp or hook');
  if (input['--observer'] !== undefined && !['true', 'false'].includes(input['--observer'])) throw Error('Invalid observer mode');
  const opts = { mode: input['--mode'], runtime: regular(input['--runtime']), project: regular(input['--project']),
    dataRoot: regular(input['--data-root']), claudeHome: regular(input['--claude-home']),
    event: input['--event'], observer: input['--observer'] === 'true' };
  if (opts.mode === 'mcp' && (opts.observer || opts.event)) throw Error('MCP is a reader/manual bridge only');
  if (opts.mode === 'hook' && !EVENTS.has(opts.event)) throw Error('Unsupported upstream Hook action');
  return opts;
}

function enabled(opts) {
  const clients = opts.mode === 'hook' ? ['claude'] : ['claude', 'codex'];
  return clients.some(client => {
    const file = path.join(opts.project, '.agent-vault/claude-mem', client, 'project.json');
    const state = readJson(file);
    return state?.owner === 'AgentPluginSkillVault' && state.componentId === 'claude-mem' && state.protocolVersion === 1 &&
      state.enabled === true && (opts.mode !== 'hook' || state.capture === true) &&
      typeof state.runtimeRoot === 'string' && normalized(state.runtimeRoot) === normalized(opts.runtime) &&
      typeof state.dataRoot === 'string' && normalized(state.dataRoot) === normalized(opts.dataRoot) &&
      typeof state.claudeHome === 'string' && normalized(state.claudeHome) === normalized(opts.claudeHome);
  });
}

async function hookInput(stream, signal) {
  if (signal) addAbortSignal(signal, stream);
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw Error('Hook input exceeds size limit');
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);
  let value;
  try { value = JSON.parse(raw.toString('utf8')); } catch { throw Error('Invalid Hook input JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Hook input must be an object');
  return { raw, value };
}

async function relay(opts, running, raw, signal) {
  const loc = service.location(opts);
  const env = service.environment({ runtime: opts.runtime, loc, port: running.port, observer: opts.mode === 'hook' && opts.observer,
    claudeHome: opts.claudeHome, persist: false });
  // Upstream MCP calls ensureWorkerStarted on entry. Its URL is pinned to the
  // already owned worker and autostart is disabled; never delegate spawning to it.
  env.CLAUDE_MEM_WORKER_URL = running.url;
  env.CLAUDE_MEM_WORKER_AUTOSTART = 'false';
  // A pinned loopback URL must not select upstream's token-gated remote spool.
  if (opts.mode === 'hook') env.CLAUDE_MEM_HOOK_SPOOL_TRANSPORT = 'filesystem';
  const executable = path.join(opts.runtime, 'bin', opts.mode === 'hook' ? 'bun.exe' : 'node.exe');
  const args = opts.mode === 'hook' ? [path.join(opts.runtime, 'plugin/scripts/worker-service.cjs'), 'hook', 'claude-code', opts.event]
    : [path.join(opts.runtime, 'plugin/scripts/mcp-server.cjs')];
  const child = spawn(executable, args, { cwd: opts.project, env, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], signal, killSignal: 'SIGTERM' });
  let outputBytes = 0;
  const outputLimit = opts.mode === 'hook' ? 2 * 1024 * 1024 : Infinity;
  const stdout = chunk => {
    outputBytes += chunk.length;
    if (outputBytes > outputLimit) child.kill();
    else if (!process.stdout.write(chunk)) child.stdout.pause();
  };
  if (opts.mode === 'hook') child.stdout.on('data', stdout);
  const drain = () => child.stdout.resume();
  process.stdout.on('drain', drain);
  // Drain private diagnostics without contaminating MCP stdout or copying secrets.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  const close = () => child.kill();
  process.once('SIGTERM', close); process.once('SIGINT', close);
  const pumps = [];
  if (opts.mode === 'hook') child.stdin.end(raw);
  else {
    const filter = protocolFilter();
    pumps.push((async () => {
      for await (const message of messages(process.stdin)) {
        const decision = filter.incoming(message);
        if (decision.forward) await send(child.stdin, message);
        else await send(process.stdout, decision.response);
      }
      child.stdin.end();
    })());
    pumps.push((async () => {
      for await (const message of messages(child.stdout)) await send(process.stdout, filter.outgoing(message));
    })());
  }
  try {
    const finished = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => outputBytes > outputLimit ? reject(Error('Hook output exceeds size limit')) : resolve(code ?? 1));
    });
    for (const pump of pumps) pump.catch(() => child.kill());
    const code = await finished;
    if (opts.mode === 'mcp') process.stdin.destroy();
    const results = await Promise.allSettled(pumps);
    if (results.some(result => result.status === 'rejected')) throw Error('MCP proxy protocol failed');
    return code;
  } finally {
    process.off('SIGTERM', close); process.off('SIGINT', close);
    process.stdin.unpipe(child.stdin);
    process.stdout.off('drain', drain);
    if (child.exitCode === null) child.kill();
  }
}

async function run(opts, signal, inputStream = process.stdin) {
  // Old native sessions retain commands after disable/uninstall. Receipt absence
  // is an inert Hook, not an authorization to resurrect a worker.
  if (!enabled(opts)) return 0;
  let input;
  if (opts.mode === 'hook') {
    input = await hookInput(inputStream, signal);
    if (typeof input.value.cwd !== 'string') throw Error('Hook input requires cwd');
    const cwd = normalized(input.value.cwd), project = normalized(opts.project);
    if (cwd !== project && !cwd.startsWith(project + path.sep)) return 0;
  }
  if (!enabled(opts)) return 0;
  const observer = opts.mode === 'hook' && opts.observer;
  const running = await service.start({ ...opts, observer,
    ...(observer ? { authorize: () => enabled(opts) } : {}) });
  if (running.status === 'disabled') return 0;
  if (!enabled(opts)) {
    if (!running.reused && (observer || !enabled({ ...opts, mode: 'mcp' })))
      await service.stop({ ...opts, expectedToken: running.generation });
    return 0;
  }
  signal?.throwIfAborted();
  return relay(opts, running, input?.raw, signal);
}

async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = options(argv);
    if (opts.mode !== 'hook') return await run(opts);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 115000);
    timer.unref();
    try { return await run(opts, controller.signal); } finally { clearTimeout(timer); }
  } catch {
    process.stderr.write('Vault memory bridge failed; inspect private runtime health/logs.\n');
    return opts?.mode === 'hook' ? 0 : 1;
  }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { options, enabled, hookInput, relay, run, main, EVENTS, TOOLS, protocolFilter, messages };
