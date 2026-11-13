'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ALLOWED = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
const CLOUD = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
const active = value => typeof value === 'string' && value !== '' && !['0', 'false'].includes(value.toLowerCase());

function regular(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('An absolute path is required');
  const resolved = path.resolve(value);
  if (/[\x00-\x1f]/u.test(value) || process.platform === 'win32' &&
      (resolved.startsWith('\\\\') || /[. ](?:\\|$)|:/u.test(resolved.slice(2))))
    throw Error('Unsupported Windows path alias');
  for (let current = resolved;; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('Linked paths are not supported'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
  return resolved;
}

function readJson(file) {
  regular(file);
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).size > 1024 * 1024) throw Error('Configuration exceeds the size limit');
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw Error('Invalid JSON configuration: ' + path.basename(file)); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Configuration must be an object');
  return value;
}

function normalized(value) {
  const resolved = regular(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function resolve({ project, claudeHome, environ = process.env }) {
  project = regular(project);
  claudeHome = regular(claudeHome || environ.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
  const env = {}, sources = [];
  const files = [path.join(claudeHome, 'settings.json'), path.join(project, '.claude/settings.json'),
    path.join(project, '.claude/settings.local.json')];
  let model;
  let helperPresent = false;
  for (const file of files) {
    const settings = readJson(file);
    if (!settings) continue;
    sources.push(file);
    helperPresent ||= Boolean(settings.apiKeyHelper);
    if (settings.env !== undefined && (!settings.env || typeof settings.env !== 'object' || Array.isArray(settings.env)))
      throw Error('Native settings env must be an object');
    if (settings.model !== undefined && (typeof settings.model !== 'string' || !settings.model.trim()))
      throw Error('Native settings model must be a nonempty string');
    if (typeof settings.model === 'string' && settings.model.trim()) model = settings.model.trim();
    for (const [key, value] of Object.entries(settings.env || {})) {
      if (typeof value !== 'string') throw Error('Native environment values must be strings');
      if (CLOUD.includes(key) && active(value)) throw Error('Bedrock, Vertex and Foundry native auth are unsupported in this release');
      if (ALLOWED.has(key)) env[key] = value;
    }
  }
  for (const key of CLOUD) if (active(environ[key])) throw Error('Bedrock, Vertex and Foundry native auth are unsupported in this release');
  for (const key of ALLOWED) if (environ[key] !== undefined) {
    if (typeof environ[key] !== 'string') throw Error('Native environment values must be strings');
    env[key] = environ[key];
  }
  if (model && !env.ANTHROPIC_MODEL) env.ANTHROPIC_MODEL = model;
  for (const value of Object.values(env)) if (/[\r\n\0]/u.test(value)) throw Error('Invalid native connection value');
  let endpoint = null;
  if (env.ANTHROPIC_BASE_URL) {
    let url;
    try { url = new URL(env.ANTHROPIC_BASE_URL); } catch { throw Error('Invalid native model base URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw Error('Native model base URL must be HTTP(S) without credentials, query or fragment');
    endpoint = url.origin;
  }
  // Existence only: OAuth contents, keychains and arbitrary helpers belong to the native CLI.
  const credentials = path.join(claudeHome, '.credentials.json');
  regular(credentials);
  const subscriptionAvailable = fs.existsSync(credentials) && fs.statSync(credentials).isFile();
  const keyAvailable = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const mode = keyAvailable ? (endpoint ? 'gateway' : 'api-key') : subscriptionAvailable ? 'subscription' : 'unconfigured';
  const publicFacts = { configured: keyAvailable || subscriptionAvailable, mode, claudeHome,
    endpoint, model: env.ANTHROPIC_MODEL || null, sources, helperIgnored: helperPresent,
    credentialPresent: keyAvailable, subscriptionFilePresent: subscriptionAvailable,
    validation: 'configuration only; native authentication and model availability untested' };
  return { env: { ...env, CLAUDE_CONFIG_DIR: claudeHome }, public: publicFacts };
}

function publicConnection(options) { return resolve(options).public; }

function secureObserverDirectory(file) {
  if (process.platform !== 'win32') return;
  const windows = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:/Windows';
  const script = `$ErrorActionPreference='Stop'
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$principals=@($user,'S-1-5-18' | Select-Object -Unique)
function Secure([string]$target,[bool]$directory) {
  if ($directory) { $acl=[Security.AccessControl.DirectorySecurity]::new(); $flags='OICI' }
  else { $acl=[Security.AccessControl.FileSecurity]::new(); $flags='' }
  $entries=($principals | ForEach-Object { '(A;'+$flags+';FA;;;'+$_+')' }) -join ''
  $acl.SetSecurityDescriptorSddlForm('O:'+$user+'D:P'+$entries)
  Set-Acl -LiteralPath $target -AclObject $acl
  $actual=Get-Acl -LiteralPath $target
  $rules=@($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if (-not $actual.AreAccessRulesProtected -or $rules.Count -ne $principals.Count) { throw 'Private ACL unavailable' }
  foreach ($rule in $rules) {
    if ($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $principals -notcontains $rule.IdentityReference.Value -or
        ($rule.FileSystemRights -band 0x1f01ff) -ne 0x1f01ff) { throw 'Private ACL mismatch' }
  }
}
Secure $env:VAULT_MEMORY_ENV_DIRECTORY $true
if ([IO.File]::Exists($env:VAULT_MEMORY_ENV_FILE)) { Secure $env:VAULT_MEMORY_ENV_FILE $false }`;
  try {
    execFileSync(path.join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, stdio: 'pipe',
        env: { SystemRoot: windows, VAULT_MEMORY_ENV_DIRECTORY: path.dirname(file), VAULT_MEMORY_ENV_FILE: file } });
  } catch { throw Error('Cannot secure private observer environment storage'); }
}

function writeObserverEnvironment(file, env) {
  regular(file);
  // Windows mode bits do not restrict the DACL. Secure inheritance before any secret write.
  secureObserverDirectory(file);
  const temporary = file + '.tmp-' + crypto.randomUUID();
  const text = [...ALLOWED].filter(key => env[key] !== undefined)
    .map(key => key + '=' + JSON.stringify(env[key])).join('\n') + '\n';
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

// The pinned worker removes inherited API credentials in Sg()/i5t(). Reapply only
// our allowlist at its SDK observer spawn boundary; preflight uses the private env file.
function installSpawnEnvironment(environ = process.env, childProcess = require('node:child_process')) {
  if (environ.VAULT_MEMORY_OBSERVER !== 'true' || environ.CLAUDE_MEM_INTERNAL === '1') return;
  const provider = Object.fromEntries([...ALLOWED].filter(key => environ[key] !== undefined).map(key => [key, environ[key]]));
  for (const method of ['spawn', 'spawnSync']) {
    const original = childProcess[method];
    childProcess[method] = function(command, args, options) {
      if (options?.env?.CLAUDE_MEM_INTERNAL === '1') options = { ...options, env: { ...options.env, ...provider } };
      return original.call(this, command, args, options);
    };
  }
}

if (process.env.VAULT_MEMORY_PRELOAD === '1') installSpawnEnvironment();
module.exports = { resolve, publicConnection, regular, readJson, normalized, ALLOWED, installSpawnEnvironment, writeObserverEnvironment };
