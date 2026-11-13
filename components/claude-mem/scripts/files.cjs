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
  root = path.resolve(root);
  const directories = new Set(), buffer = Buffer.alloc(1024 * 1024);
  const identity = target => process.platform === 'win32'
    ? path.toNamespacedPath(path.normalize(target)).toLowerCase() : path.normalize(target);
  function directory(target) {
    for (let current = target; !directories.has(current); current = path.dirname(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw Error('Linked files or directories are not supported: ' + current);
      if (!stat.isDirectory()) throw Error('Managed directory changed or missing: ' + current);
      directories.add(current);
      if (path.dirname(current) === current) break;
    }
  }
  function hashChecked(target) {
    const hash = crypto.createHash('sha256'), fd = fs.openSync(target, 'r');
    try { for (let size; (size = fs.readSync(fd, buffer)) > 0;) hash.update(buffer.subarray(0, size)); }
    finally { fs.closeSync(fd); }
    return hash.digest('hex');
  }
  directory(root);
  const canonicalRoot = fs.realpathSync.native(root);
  for (const [name, expected] of Object.entries(files)) {
    if (!/^[a-f0-9]{64}$/.test(expected)) throw Error('Managed file changed or missing: ' + name);
    if (!name || /[\\:]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..'))
      throw Error('Unsafe managed path: ' + name);
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) throw Error('Managed path escaped its root');
    directory(path.dirname(target));
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw Error('Linked files or directories are not supported: ' + target);
    if (!stat.isFile()) throw Error('Managed file changed or missing: ' + name);
    // Cached directories may have become junctions since the previous file.
    if (identity(fs.realpathSync.native(target)) !== identity(path.join(canonicalRoot, name)))
      throw Error('Linked files or directories are not supported: ' + target);
    if (hashChecked(target) !== expected)
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
