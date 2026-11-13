'use strict';

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

function owned(command, args, options, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const { inherit = false, ...spawnOptions } = options;
    const child = spawn(command, args, { ...spawnOptions, windowsHide: true, detached: process.platform !== 'win32', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const limit = 256 * 1024;
    child.stdout?.on('data', bytes => { stdout = (stdout + bytes.toString('utf8')).slice(-limit); });
    child.stderr?.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-limit); });
    function stop() {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform === 'win32') spawnSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }
    const timer = timeout === null ? null : setTimeout(() => { timedOut = true; stop(); }, timeout);
    const interrupted = () => { timedOut = true; stop(); };
    process.once('SIGINT', interrupted);
    process.once('SIGTERM', interrupted);
    function cleanup() { clearTimeout(timer); process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted); }
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); resolve({ code, stdout, stderr, timedOut }); });
  });
}
module.exports = { owned };
