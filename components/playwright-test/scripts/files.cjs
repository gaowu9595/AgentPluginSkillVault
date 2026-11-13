'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function regular(target) {
  for (let current = path.resolve(target);; current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw Error('Linked files or directories are not supported: ' + current);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
  return target;
}

function child(root, relative) {
  if (!relative || /[\\:]/.test(relative) || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..'))
    throw Error('Unsafe managed path: ' + relative);
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw Error('Managed path escaped its root');
  return regular(target);
}

function sha(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function hashFile(target) {
  regular(target);
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(target, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try { for (let size; (size = fs.readSync(fd, buffer)) > 0;) hash.update(buffer.subarray(0, size)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function read(target) { regular(target); return fs.existsSync(target) ? fs.readFileSync(target) : null; }
function readJson(target) { const data = read(target); return data ? JSON.parse(data.toString('utf8').replace(/^\uFEFF/, '')) : null; }
function json(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function equal(left, right) { return left === null ? right === null : right !== null && left.equals(right); }

function atomic(target, data) {
  regular(target);
  if (data === null) { if (fs.existsSync(target)) fs.unlinkSync(target); return; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.tmp-' + crypto.randomUUID();
  try {
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

// Validate the full transaction before replacing any file, and roll back partial writes.
function transact(changes) {
  for (const change of changes)
    if (!equal(read(change.target), change.before)) throw Error('File changed during management: ' + change.target);
  const applied = [];
  try {
    for (const change of changes) {
      if (equal(change.before, change.after)) continue;
      if (!equal(read(change.target), change.before)) throw Error('Concurrent file change: ' + change.target);
      atomic(change.target, change.after);
      applied.push(change);
    }
  } catch (error) {
    const failed = [];
    for (const change of applied.reverse()) {
      try {
        if (!equal(read(change.target), change.after)) throw Error('Concurrent edit during rollback');
        atomic(change.target, change.before);
      } catch { failed.push(change.target); }
    }
    if (failed.length) throw Error(error.message + '; rollback requires manual review: ' + failed.join(', '));
    throw error;
  }
}

function verify(root, files) {
  for (const [name, expected] of Object.entries(files)) {
    if (!/^[a-f0-9]{64}$/.test(expected) || hashFile(child(root, name)) !== expected)
      throw Error('Managed file changed or missing: ' + name);
  }
}

function lock(target) {
  regular(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let fd;
  try { fd = fs.openSync(target, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw Error('Another management action holds the lock: ' + target);
    throw error;
  }
  fs.writeFileSync(fd, String(process.pid));
  return () => { fs.closeSync(fd); fs.unlinkSync(target); };
}

module.exports = { regular, child, sha, hashFile, read, readJson, json, equal, atomic, transact, verify, lock };
