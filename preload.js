'use strict';

/**
 * LiberClean for uTools.
 *
 * The bridge calls the locally installed `mo` command directly. It never
 * opens a port or evaluates user input as a shell command. Explicit updates
 * run Mole's own updater. Maintenance operations expose structured review, selection,
 * confirmation and authentication actions. The macOS built-in `script` hosts
 * Mole while its own file protections and administrator checks stay in place.
 */

const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { createMaintenanceController, MAINTENANCE_OPERATIONS } = require('./maintenance.js');
const { createMoleUpdater } = require('./mole-update.js');

const HOME = os.homedir();
const LOG_FILE = path.join(HOME, 'Library', 'Logs', 'mo-utools', 'plugin.log');
const SCRIPT_BIN = '/usr/bin/script';
const MAX_OUTPUT = 2 * 1024 * 1024;
const MAX_CAPTURE = 24 * 1024 * 1024;
const SETTINGS_PREFIX = 'mole.';
const OPERATIONS = ['clean', 'uninstall', 'optimize', 'purge', 'installer'];
const ACTIVE_STATES = new Set(['running', 'cancelling']);

const ANSI_PATTERN = /\x1b\[[0-9;?]*[a-zA-Z]/g;
const URL_PATTERN = /https?:\/\/[^\s]+/g;
const CREDENTIAL_PATTERN = /(?:\bpassword\b|\bpasswd\b|密码)\s*[:：=]\s*\S+/gi;

const BASE_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

let environmentCache = null;
let environmentPromise = null;
let ptyChecked = false;
let ptyAvailable = false;

let status = { state: 'starting', snapshot: null, receivedAt: null };
let lastStatus = null;
let statusChild = null;
let statusTimer = null;
let statusGeneration = 0;
let statusListeners = new Set();

const tasks = new Map();
const runtimes = new Map();
const outputBuffers = new Map();
const outputSubs = new Map();
const taskListeners = new Set();
let activeTaskId = '';

let applicationInventory = { state: 'ready', apps: [], updatedAt: null, error: '' };
let applicationsPromise = null;
let applicationsLoadedAt = 0;

let enterAction = null;
let pluginVisible = true;
const enterListeners = new Set();

const maintenance = createMaintenanceController({ tasks, runtimes, getEnvironment: () => environmentCache, childEnv, emitTask, finishTask, killGroup, logEvent });
const updater = createMoleUpdater({
  getEnvironment: () => environmentCache,
  childEnv, killGroup, logEvent,
  assertAvailable() {
    const task = activeTask();
    if (task || applicationsPromise) {
      logEvent('mole_update.contended', { activeTaskId: task?.id || '', inventoryLoading: !!applicationsPromise });
      throw new Error('请等待当前任务或应用列表加载完成后再更新 Mole');
    }
    if (!ptyEnabled()) throw new Error('当前环境无法启动 Mole 更新，请检查本机终端权限');
  },
  beforeStart() {
    stopStatus();
    emitStatus({ state: 'starting', snapshot: status.snapshot, receivedAt: null });
  },
  refreshEnvironment() {
    applicationsLoadedAt = 0;
    environmentCache = null;
    return getEnvironment(true);
  },
  afterFinish() { if (statusListeners.size && environmentCache?.ready) startStatus(); }
});

function isoNow() {
  return new Date().toISOString();
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function safeCall(callback, value) {
  try {
    callback(value);
  } catch (error) {
    logEvent('bridge.listener_failed', { message: String(error && error.message || error).slice(0, 200) });
  }
}

function logEvent(event, fields) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const entry = JSON.stringify({ time: isoNow(), event, ...(fields || {}) });
    fs.appendFileSync(LOG_FILE, `${entry}\n`);
    const info = fs.statSync(LOG_FILE);
    if (info.size > 1024 * 1024) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // Logging must never break a maintenance operation.
  }
}

function cleanMessage(value) {
  return String(value || '')
    .replace(ANSI_PATTERN, '')
    .replace(URL_PATTERN, '[url]')
    .replace(CREDENTIAL_PATTERN, '[redacted]')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' / ')
    .slice(0, 400);
}

function getSetting(key) {
  try {
    return utools.dbStorage.getItem(SETTINGS_PREFIX + key);
  } catch {
    return undefined;
  }
}

function setSetting(key, value) {
  try {
    if (value === undefined || value === null || value === '') utools.dbStorage.removeItem(SETTINGS_PREFIX + key);
    else utools.dbStorage.setItem(SETTINGS_PREFIX + key, value);
  } catch {
    // Ignore unavailable storage; the default remains in effect.
  }
}

function childEnv(extra) {
  const segments = [];
  const seen = new Set();
  for (const segment of [...String(process.env.PATH || '').split(':'), ...BASE_PATH]) {
    if (!segment || seen.has(segment)) continue;
    seen.add(segment);
    segments.push(segment);
  }
  return {
    ...process.env,
    HOME,
    PATH: segments.join(':'),
    TERM: 'xterm-256color',
    LANG: process.env.LANG || 'zh_CN.UTF-8',
    ...(extra || {})
  };
}

function killGroup(child, signal) {
  if (!child || !child.pid) return;
  const name = signal || 'SIGTERM';
  try {
    process.kill(-child.pid, name);
    return;
  } catch {
    // Fall back to the direct child when it did not become a group leader.
  }
  try {
    child.kill(name);
  } catch {
    // The process is already gone.
  }
}

function toCamel(value) {
  if (Array.isArray(value)) return value.map(toCamel);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase())] = toCamel(item);
    }
    return result;
  }
  return value;
}

function scanStatus(value) {
  return value === 'complete' || value === 'partial' || value === 'unavailable' ? value : 'unavailable';
}

function normalizeScan(raw) {
  const data = toCamel(raw);
  const entries = (Array.isArray(data.entries) ? data.entries : []).map(entry => ({
    name: String(entry.name || ''),
    path: String(entry.path || ''),
    size: typeof entry.size === 'number' ? entry.size : null,
    isDir: !!entry.isDir,
    scanStatus: scanStatus(entry.scanStatus)
  }));
  const largeFiles = (Array.isArray(data.largeFiles) ? data.largeFiles : []).map(entry => ({
    name: String(entry.name || ''),
    path: String(entry.path || ''),
    size: typeof entry.size === 'number' ? entry.size : null,
    isDir: !!entry.isDir,
    scanStatus: scanStatus(entry.scanStatus)
  }));
  let totalSize = typeof data.totalSize === 'number' ? data.totalSize : null;
  if (totalSize === null) {
    const sizes = entries.map(entry => entry.size).filter(size => typeof size === 'number');
    totalSize = sizes.length ? sizes.reduce((sum, size) => sum + size, 0) : null;
  }
  return {
    path: String(data.path || ''),
    scanStatus: scanStatus(data.scanStatus),
    overview: !!data.overview,
    entries,
    largeFiles,
    totalSize,
    totalFiles: typeof data.totalFiles === 'number' ? data.totalFiles : null
  };
}

function parseMoleJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Mole 没有返回数据');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Fall through to the shared error below.
      }
    }
    throw new Error('Mole 返回的数据格式无法解析');
  }
}

function probeMo(candidate) {
  if (!candidate) return null;
  let exists = false;
  try {
    const info = fs.statSync(candidate);
    if (!info.isFile()) return null;
    exists = true;
    fs.accessSync(candidate, fs.constants.X_OK);
    const output = execFileSync(candidate, ['--version'], {
      cwd: HOME,
      env: childEnv(),
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const match = /(?:Mole version|mole)\s+v?(\d+\.\d+\.\d+[^\s]*)/i.exec(String(output || ''));
    if (!match) return { path: candidate, version: '', error: '命令未返回可识别的 Mole 版本' };
    return { path: candidate, version: match[1] };
  } catch {
    return exists ? { path: candidate, version: '', error: '发现 mo 文件但无法运行，请检查文件权限或重新安装 Mole' } : null;
  }
}

function findMo() {
  const override = getSetting('moPath');
  const candidates = [];
  if (override) candidates.push(String(override));
  const pathEntries = String(process.env.PATH || '').split(':');
  for (const directory of pathEntries) {
    if (directory) candidates.push(path.join(directory, 'mo'));
  }
  candidates.push('/opt/homebrew/bin/mo', '/usr/local/bin/mo', path.join(HOME, '.local', 'bin', 'mo'), path.join(HOME, 'bin', 'mo'), '/usr/bin/mo');

  const seen = new Set();
  let firstIssue = '';
  let issuePath = '';
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const result = probeMo(candidate);
    if (result && result.version) {
      return {
        ready: true,
        installation: 'ready',
        moPath: result.path,
        moVersion: result.version,
        home: HOME,
        platform: process.platform,
        pathSource: override && candidate === String(override) ? 'manual' : 'auto',
        error: ''
      };
    }
    if (result && result.error && !firstIssue) { firstIssue = result.error; issuePath = result.path; }
  }
  return {
    ready: false,
    installation: firstIssue ? 'unavailable' : 'missing',
    moPath: issuePath,
    moVersion: '',
    home: HOME,
    platform: process.platform,
    pathSource: override ? 'manual' : 'auto',
    error: firstIssue || '未找到可执行的 mo，请安装 Mole 或手动选择命令路径'
  };
}

function getEnvironment(force) {
  if (environmentPromise) return environmentPromise;
  if (!force && environmentCache) return Promise.resolve(environmentCache);
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  logEvent('environment.detection_started', { id, force: !!force });
  environmentPromise = Promise.resolve().then(() => {
    environmentCache = findMo();
    logEvent('environment.detected', { id, ready: environmentCache.ready, installation: environmentCache.installation, pathSource: environmentCache.pathSource, version: environmentCache.moVersion, elapsedMs: Date.now() - startedAt });
    return environmentCache;
  }).catch(error => {
    logEvent('environment.detection_failed', { id, elapsedMs: Date.now() - startedAt, error: cleanMessage(error.stack || error.message) });
    throw error;
  }).finally(() => { environmentPromise = null; });
  return environmentPromise;
}

function ensureEnvironment() {
  return getEnvironment(false);
}

function ptyEnabled() {
  if (ptyChecked) return ptyAvailable;
  ptyChecked = true;
  try {
    // macOS script requires a real pipe on stdin. Node creates socketpairs for
    // stdio pipes, so bash process substitution provides a genuine pipe while
    // cat forwards terminal input from the plugin.
    execFileSync('/bin/bash', ['-c', `exec 3< <(cat); ${SCRIPT_BIN} -q /dev/null /bin/sh -c 'exit 0' <&3`], {
      cwd: HOME,
      env: childEnv(),
      timeout: 4000,
      stdio: 'ignore'
    });
    ptyAvailable = true;
  } catch {
    ptyAvailable = false;
  }
  logEvent('terminal.pty_probe', { available: ptyAvailable });
  return ptyAvailable;
}

function emitStatus(next) {
  status = next;
  lastStatus = next;
  for (const listener of statusListeners) safeCall(listener, next);
}

function stopStatus() {
  statusGeneration++;
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  const child = statusChild;
  statusChild = null;
  if (child) killGroup(child);
}

function startStatus() {
  if (statusChild || statusListeners.size === 0 || updater.busy() || !pluginVisible) return;
  const environment = environmentCache;
  if (!environment || !environment.ready) {
    emitStatus({ state: 'error', snapshot: lastStatus ? lastStatus.snapshot : null, receivedAt: lastStatus ? lastStatus.receivedAt : null, error: (environment && environment.error) || '正在检测 Mole' });
    return;
  }
  let child;
  try {
    child = spawn(environment.moPath, ['status', '--watch', '--interval', '2s'], {
      cwd: HOME,
      env: childEnv(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    emitStatus({ state: 'error', snapshot: null, receivedAt: null, error: cleanMessage(error.message) });
    return;
  }
  statusChild = child;
  const generation = ++statusGeneration;
  if (!lastStatus || lastStatus.state !== 'live') emitStatus({ state: 'starting', snapshot: lastStatus ? lastStatus.snapshot : null, receivedAt: lastStatus ? lastStatus.receivedAt : null });
  logEvent('status.started', { pid: child.pid });

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    try {
      const snapshot = toCamel(JSON.parse(trimmed));
      emitStatus({ state: 'live', snapshot, receivedAt: isoNow() });
    } catch {
      // Ignore a malformed sample and wait for the next one.
    }
  });
  let stderrTail = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderrTail = `${stderrTail}${chunk}`.slice(-2000);
  });
  child.on('error', error => {
    logEvent('status.error', { message: cleanMessage(error.message) });
  });
  child.on('close', (code, signal) => {
    lines.close();
    if (generation !== statusGeneration) return;
    if (statusChild === child) statusChild = null;
    logEvent('status.exited', { code, signal, error: cleanMessage(stderrTail).slice(0, 200) });
    if (statusListeners.size === 0) return;
    emitStatus({
      state: 'error',
      snapshot: lastStatus ? lastStatus.snapshot : null,
      receivedAt: lastStatus ? lastStatus.receivedAt : null,
      error: '系统监控已中断，正在重新连接'
    });
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusTimer = null;
      startStatus();
    }, 3000);
  });
}

function subscribeStatus(listener) {
  if (typeof listener !== 'function') return () => {};
  statusListeners.add(listener);
  if (lastStatus) safeCall(listener, lastStatus);
  ensureEnvironment().then(environment => {
    if (statusListeners.size === 0) return;
    if (environment.ready) startStatus();
    else emitStatus({ state: 'error', snapshot: null, receivedAt: null, error: environment.error });
  });
  return () => {
    statusListeners.delete(listener);
    if (statusListeners.size === 0) stopStatus();
  };
}

function publicTask(task) {
  if (!task) return null;
  return { ...task };
}

function getTask(id) {
  return publicTask(tasks.get(id));
}

function getTasks() {
  return [...tasks.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30).map(publicTask);
}

function emitTask(task) {
  for (const listener of taskListeners) safeCall(listener, publicTask(task));
}

function emitOutput(id, chunk) {
  if (!chunk) return;
  const buffer = outputBuffers.get(id);
  if (buffer) {
    buffer.chunks.push(chunk);
    buffer.size += chunk.length;
    while (buffer.size > MAX_OUTPUT && buffer.chunks.length > 1) {
      const dropped = buffer.chunks.shift();
      buffer.size -= dropped.length;
      buffer.truncated = true;
    }
  }
  const subscribers = outputSubs.get(id);
  if (subscribers) for (const listener of subscribers) safeCall(listener, chunk);
}

function activeTask() {
  const task = tasks.get(activeTaskId);
  return task && ACTIVE_STATES.has(task.state) ? task : null;
}

function finishTask(task, runtime, code, signal, failure) {
  if (runtime.finished) return;
  runtime.finished = true;
  if (runtime.killTimer) clearTimeout(runtime.killTimer);
  let exitCode = typeof code === 'number' ? code : null;
  if (runtime.exitFile) {
    try {
      const recorded = Number(fs.readFileSync(runtime.exitFile, 'utf8').trim());
      if (Number.isInteger(recorded) && recorded >= 0 && recorded <= 255) exitCode = recorded;
    } catch {
      // The wrapper was killed before it could record a status.
    }
    try { fs.unlinkSync(runtime.exitFile); } catch {}
  }
  task.endedAt = isoNow();
  task.exitCode = exitCode;
  let state = runtime.cancelRequested ? 'cancelled' : exitCode === 0 ? 'succeeded' : 'failed';
  if (failure && state === 'succeeded') state = 'failed';
  if (task.operation === 'analyze' && !task.result && state === 'succeeded') state = 'failed';
  task.state = state;
  if (state === 'failed') {
    const detail = failure ? cleanMessage(failure) : cleanMessage(runtime.stderrTail);
    task.error = detail || (signal ? `进程被信号 ${signal} 中断` : `命令退出码 ${exitCode}`);
  } else {
    task.error = '';
  }
  runtimes.delete(task.id);
  if (activeTaskId === task.id) activeTaskId = '';
  const elapsedMs = Math.max(0, new Date(task.endedAt).getTime() - new Date(task.startedAt).getTime());
  logEvent('task.exited', { id: task.id, operation: task.operation, mode: task.mode, state: task.state, code: task.exitCode, elapsedMs });
  emitTask(task);
}

function pruneFinishedTasks() {
  const finished = [...tasks.values()]
    .filter(item => !ACTIVE_STATES.has(item.state))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const item of finished.slice(12)) {
    tasks.delete(item.id);
    outputBuffers.delete(item.id);
    outputSubs.delete(item.id);
  }
}

function startAnalyze(task) {
  const environment = environmentCache;
  let child;
  try {
    child = spawn(environment.moPath, ['analyze', '--json', task.path], {
      cwd: HOME,
      env: childEnv(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const runtime = { finished: false, cancelRequested: false, stderrTail: '' };
    runtimes.set(task.id, runtime);
    task.error = cleanMessage(error.message);
    finishTask(task, runtime, 1, null, task.error);
    return;
  }
  const runtime = { child, finished: false, cancelRequested: false, stderrTail: '', stdout: [], captureSize: 0 };
  runtimes.set(task.id, runtime);
  child.stdout.on('data', buffer => {
    runtime.captureSize += buffer.length;
    if (runtime.captureSize > MAX_CAPTURE) {
      runtime.cancelRequested = true;
      killGroup(child, 'SIGKILL');
      return;
    }
    runtime.stdout.push(buffer);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    runtime.stderrTail = `${runtime.stderrTail}${chunk}`.slice(-4000);
  });
  child.on('error', error => {
    finishTask(task, runtime, 1, null, error.message);
  });
  child.on('close', (code, signal) => {
    if (runtime.finished) return;
    if (runtime.cancelRequested) {
      finishTask(task, runtime, code, signal, null);
      return;
    }
    if (code !== 0) {
      finishTask(task, runtime, code, signal, null);
      return;
    }
    try {
      const raw = Buffer.concat(runtime.stdout).toString('utf8');
      task.result = normalizeScan(parseMoleJson(raw));
    } catch (error) {
      logEvent('analyze.parse_failed', { id: task.id, message: cleanMessage(error.message).slice(0, 200) });
      finishTask(task, runtime, 1, signal, error.message);
      return;
    }
    finishTask(task, runtime, code, signal, null);
  });
}

function parseJsonArray(text) {
  const trimmed = String(text || '').trim();
  try {
    const value = JSON.parse(trimmed);
    if (Array.isArray(value)) return value;
  } catch {
    // Fall through to a tolerant slice for commands that print a banner.
  }
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start >= 0 && end > start) {
    const value = JSON.parse(trimmed.slice(start, end + 1));
    if (Array.isArray(value)) return value;
  }
  throw new Error('Mole 返回的应用列表格式无法解析');
}

function publicApp(app) {
  return {
    id: app.id,
    name: app.name,
    bundleId: app.bundleId,
    path: app.path,
    source: app.source,
    sizeLabel: app.sizeLabel,
    selectable: app.selectable,
    ...(app.reason ? { reason: app.reason } : {})
  };
}

function safeAppName(name) {
  return !!name && name.length <= 256 && !name.startsWith('-') && !/[\r\n\u0000\u001b\t|\\*?\[\]]/.test(name);
}

function decodeApplications(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Mole 未返回有效的应用列表');
  if (rows.length > 5000) throw new Error('应用数量超过容量限制');
  const apps = [];
  const seenPaths = new Set();
  for (const row of rows) {
    const name = String(row.name || '');
    const bundleId = String(row.bundle_id || '');
    const source = String(row.source || '');
    const appPath = String(row.path || '');
    const sizeLabel = String(row.size || '');
    if (!name || !path.isAbsolute(appPath) || path.extname(appPath).toLowerCase() !== '.app' || seenPaths.has(appPath)) {
      throw new Error('Mole 应用记录包含无效名称或路径');
    }
    seenPaths.add(appPath);
    const id = crypto.createHash('sha256').update(`${appPath}\0${bundleId}`).digest('hex').slice(0, 32);
    apps.push({ id, name, bundleId, path: appPath, source, sizeLabel, selectable: false, matchName: '' });
  }
  for (const app of apps) {
    const candidates = [app.name, path.basename(app.path, path.extname(app.path))];
    for (const candidate of candidates) {
      if (!safeAppName(candidate)) continue;
      let matches = 0;
      for (const other of apps) {
        const directory = path.basename(other.path, path.extname(other.path));
        if (other.name.toLowerCase() === candidate.toLowerCase() || directory.toLowerCase() === candidate.toLowerCase()) matches++;
      }
      if (matches === 1) {
        app.selectable = true;
        app.matchName = candidate;
        break;
      }
    }
    if (!app.selectable) app.reason = 'Mole 无法唯一识别此应用，请检查是否有同名副本';
  }
  return apps;
}

function getApplications(refresh) {
  if (updater.busy()) return Promise.reject(new Error('Mole 正在更新，请在更新完成后刷新应用列表'));
  return ensureEnvironment().then(environment => {
    if (updater.busy()) throw new Error('Mole 正在更新，请在更新完成后刷新应用列表');
    if (!environment.ready) throw new Error(environment.error || 'Mole 暂不可用');
    if (!refresh && applicationInventory.state === 'ready' && applicationInventory.updatedAt && Date.now() - applicationsLoadedAt < 60000) {
      return { ...applicationInventory, apps: applicationInventory.apps.map(publicApp) };
    }
    if (applicationsPromise) return applicationsPromise;
    applicationsPromise = (async () => {
      const started = Date.now();
      logEvent('apps.loading');
      try {
        const output = await runCapture(environment.moPath, ['uninstall', '--list'], 90000, 8 * 1024 * 1024);
        applicationInventory = { state: 'ready', apps: decodeApplications(parseJsonArray(output)), updatedAt: isoNow(), error: '' };
        applicationsLoadedAt = Date.now();
        logEvent('apps.loaded', { count: applicationInventory.apps.length, elapsedMs: Date.now() - started });
      } catch (error) {
        applicationInventory = {
          state: 'error',
          apps: applicationInventory.apps || [],
          updatedAt: applicationInventory.updatedAt,
          error: `读取应用列表失败：${cleanMessage(error.message)}`
        };
        logEvent('apps.load_failed', { message: cleanMessage(error.message).slice(0, 200), elapsedMs: Date.now() - started });
      } finally {
        applicationsPromise = null;
      }
      return { ...applicationInventory, apps: applicationInventory.apps.map(publicApp) };
    })();
    return applicationsPromise;
  });
}

function resolveApps(ids) {
  if (applicationInventory.state !== 'ready') throw new Error('请等待应用列表加载完成后再试');
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('请选择需要卸载的应用');
  if (ids.length > 20) throw new Error('一次最多选择 20 个应用');
  const unique = [...new Set(ids.map(String))];
  const apps = [];
  for (const id of unique) {
    const app = applicationInventory.apps.find(item => item.id === id);
    if (!app) throw new Error('应用列表已变化，请刷新并重新选择');
    if (!app.selectable) throw new Error(app.reason || '此应用无法唯一识别');
    apps.push(app);
  }
  return apps;
}

const TERMINAL_ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Z0-9])/g;
const PLAN_SIZE = /^(.*?)\s+,\s+([0-9.]+\s*[KMGTPE]?i?B)$/;
const MATCHED_COUNT = /Matched ([0-9]+) app\(s\):/;
const NATIVE_PASSWORD = /(?:^|[\r\n])(?:\[sudo\] )?(?:password(?: for [^:\r\n]+)?):\s*$/i;
const REMOVED_COUNT = /Removed ([0-9]+) apps?(?:,|\s|$)/;

function stripTerminal(value) {
  return String(value || '').replace(/\r/g, '\n').replace(TERMINAL_ESCAPES, '');
}

function parseUninstallPlan(text, apps) {
  const marker = 'Files to be removed:';
  const begin = text.lastIndexOf(marker);
  if (begin < 0) throw new Error('Mole 尚未提供文件清单');
  const section = text.slice(begin + marker.length);
  const files = [];
  const seen = new Set();
  const expected = new Map();
  for (const app of apps) expected.set(path.normalize(app.path), false);
  let kept = false;
  for (let line of section.split('\n')) {
    line = line.trim();
    if (!line) continue;
    if (line === 'Personal data kept:') {
      kept = true;
      continue;
    }
    let kind = kept ? 'kept' : 'related';
    if (line.includes('Review only: ')) {
      kind = 'reviewOnly';
      line = line.slice(line.indexOf('Review only: ') + 'Review only: '.length);
    }
    if (line.includes('System: ')) {
      kind = 'system';
      line = line.slice(line.indexOf('System: ') + 'System: '.length);
    }
    let start = -1;
    for (let index = 0; index < line.length; index++) {
      if ((line[index] === '/' || line.startsWith('~/', index)) && (index === 0 || line[index - 1] === ' ')) {
        start = index;
        break;
      }
    }
    if (start < 0) continue;
    let value = line.slice(start);
    let size = '';
    const match = PLAN_SIZE.exec(value);
    if (match) {
      value = match[1];
      size = match[2];
    }
    if (value.startsWith('~/')) value = path.join(HOME, value.slice(2));
    if (!path.isAbsolute(value) || /[\u0000\x1b\r\n]/.test(value)) throw new Error('文件清单包含无法识别的路径');
    value = path.normalize(value);
    if (expected.has(value)) {
      expected.set(value, true);
      kind = 'app';
    }
    if (path.extname(value).toLowerCase() === '.app' && kind !== 'kept' && kind !== 'reviewOnly' && kind !== 'app') {
      throw new Error('Mole 返回了未选择的应用，请刷新列表后重新预览');
    }
    const key = `${kind}\0${value}`;
    if (!seen.has(key)) {
      files.push({ path: value, sizeLabel: size, kind });
      seen.add(key);
    }
    if (files.length > 1500) throw new Error('文件清单过长，请减少所选应用后重试');
  }
  for (const present of expected.values()) {
    if (!present) throw new Error('Mole 的应用路径与当前选择不一致，请刷新列表后重试');
  }
  if (expected.size === 0) throw new Error('没有选择应用');
  return files;
}

function updateGuidedFlow(task, patch) {
  task.uninstall = { ...(task.uninstall || {}), ...patch };
  emitTask(task);
}

function writeGuided(runtime, data) {
  try {
    if (runtime.child && runtime.child.stdin && !runtime.child.stdin.destroyed) runtime.child.stdin.write(data);
  } catch {
    // The process may have exited between the prompt and the write.
  }
}

function rejectGuided(task, runtime, message) {
  if (runtime.unsupported) return;
  runtime.unsupported = message;
  updateGuidedFlow(task, { phase: 'failed', message, promptToken: '' });
  logEvent('uninstall.protocol_rejected', { id: task.id, reason: cleanMessage(message).slice(0, 200) });
  stopTask(task.id);
}

function parseGuidedOutput(task, runtime) {
  runtime.lastOutputAt = Date.now();
  if (runtime.unsupported || runtime.finished) return;
  if (runtime.truncated) {
    rejectGuided(task, runtime, 'Mole 返回的数据超过容量限制，已停止本次操作');
    return;
  }
  const text = stripTerminal(runtime.buffer).trim();
  if (runtime.stage === 'selection' && text.endsWith('Proceed with uninstallation? [y/N]')) {
    const match = MATCHED_COUNT.exec(text);
    if (!match || Number(match[1]) !== task.apps.length) {
      rejectGuided(task, runtime, 'Mole 匹配到的应用数量与当前选择不一致，已停止本次操作');
      return;
    }
    runtime.stage = 'inspecting';
    logEvent('uninstall.selection_verified', { id: task.id, appCount: task.apps.length });
    writeGuided(runtime, 'y\n');
    return;
  }
  if (runtime.stage === 'inspecting' && text.endsWith('Enter confirm, ESC cancel:')) {
    let files;
    try {
      files = parseUninstallPlan(text, task.apps);
    } catch (error) {
      rejectGuided(task, runtime, error.message);
      return;
    }
    runtime.promptAt = Date.now();
    logEvent('uninstall.plan_ready', { id: task.id, fileCount: files.length });
    if (task.mode === 'preview') {
      runtime.previewReady = true;
      runtime.stage = 'previewClosing';
      updateGuidedFlow(task, { files, message: '已取得 Mole 的文件清单，正在结束只读预览' });
      setTimeout(() => {
        if (!runtime.finished && runtime.stage === 'previewClosing') writeGuided(runtime, 'q');
      }, 150);
    } else {
      runtime.stage = 'review';
      updateGuidedFlow(task, {
        phase: 'confirm',
        files,
        promptToken: crypto.randomUUID(),
        message: '请核对这次重新检查的应用与文件，确认后才会卸载'
      });
    }
    return;
  }
  if (['executing', 'authWaiting', 'auth'].includes(runtime.stage) && NATIVE_PASSWORD.test(text) && runtime.buffer.length > runtime.authOffset) {
    if (runtime.stage === 'auth') return;
    runtime.stage = 'auth';
    updateGuidedFlow(task, {
      phase: 'authorizing',
      promptToken: crypto.randomUUID(),
      message: text.includes('Sorry, try again') ? '密码未通过认证，请重试。也可以停止本次操作' : 'Mole 需要管理员认证，请输入当前 Mac 账户的密码'
    });
    logEvent('uninstall.authentication_requested', { id: task.id });
  }
}

function startGuidedUninstall(task, apps) {
  const environment = environmentCache;
  const args = ['uninstall', ...(task.mode === 'preview' ? ['--dry-run'] : []), ...apps.map(app => app.matchName)];
  let child;
  let exitFile = '';
  try {
    exitFile = path.join(os.tmpdir(), `mole-utools-${task.id}.code`);
    try { fs.unlinkSync(exitFile); } catch {}
    const wrapper = [
      'exec 3< <(cat)',
      `/usr/bin/script -q /dev/null /bin/sh -c "$1" mole "$2" "$3" "$4" "\${@:5}" <&3`,
      'code=$?',
      `printf '%s' "$code" > "$MOLE_EXIT_FILE"`,
      'kill 0'
    ].join('; ');
    const inner = 'stty rows "$1" cols "$2" 2>/dev/null; shift 2; exec "$@"';
    child = spawn('/bin/bash', ['-c', wrapper, 'bash', inner, '60', '240', environment.moPath, ...args], {
      cwd: HOME,
      env: childEnv({ MOLE_EXIT_FILE: exitFile }),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    const runtime = { finished: false, cancelRequested: false, stderrTail: '', exitFile: '' };
    runtimes.set(task.id, runtime);
    finishGuided(task, runtime, 1, null, error.message);
    return;
  }
  const runtime = {
    child,
    exitFile,
    finished: false,
    cancelRequested: false,
    stderrTail: '',
    buffer: '',
    truncated: false,
    stage: 'selection',
    lastOutputAt: Date.now(),
    promptAt: 0,
    authOffset: 0,
    unsupported: '',
    previewReady: false,
    watchdog: null,
    guided: true
  };
  runtimes.set(task.id, runtime);
  const append = chunk => {
    emitOutput(task.id, chunk);
    runtime.buffer += chunk;
    if (runtime.buffer.length > MAX_OUTPUT) {
      runtime.buffer = runtime.buffer.slice(-MAX_OUTPUT);
      runtime.truncated = true;
    }
    parseGuidedOutput(task, runtime);
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', append);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    runtime.stderrTail = `${runtime.stderrTail}${chunk}`.slice(-4000);
    append(chunk);
  });
  child.on('error', error => finishGuided(task, runtime, 1, null, error.message));
  child.on('close', (code, signal) => finishGuided(task, runtime, code, signal, null));
  child.stdin.on('error', () => {});
  runtime.watchdog = setInterval(() => {
    if (runtime.finished) return;
    const idle = Date.now() - runtime.lastOutputAt;
    if (runtime.stage === 'review' || runtime.stage === 'auth') {
      if (idle > 10 * 60 * 1000) rejectGuided(task, runtime, '等待确认或认证已超时，已停止本次操作');
    } else if (runtime.stage === 'executing' || runtime.stage === 'authWaiting') {
      if (idle > 60 * 1000) rejectGuided(task, runtime, 'Mole 长时间未返回结果，或遇到暂不支持的交互。已停止本次操作，请刷新后重试');
    } else if (idle > 90 * 1000) {
      rejectGuided(task, runtime, '应用检查超时或 Mole 返回了暂不支持的交互，已停止本次操作');
    }
  }, 1000);
}

function finishGuided(task, runtime, code, signal, failure) {
  if (runtime.finished) return;
  runtime.finished = true;
  if (runtime.watchdog) clearInterval(runtime.watchdog);
  let exitCode = typeof code === 'number' ? code : null;
  if (runtime.exitFile) {
    try {
      const recorded = Number(fs.readFileSync(runtime.exitFile, 'utf8').trim());
      if (Number.isInteger(recorded) && recorded >= 0 && recorded <= 255) exitCode = recorded;
    } catch {
      // The wrapper was killed before it could record a status.
    }
    try { fs.unlinkSync(runtime.exitFile); } catch {}
  }
  task.endedAt = isoNow();
  task.exitCode = exitCode;
  const text = stripTerminal(runtime.buffer);
  const flow = { ...(task.uninstall || {}), promptToken: '' };
  if (runtime.unsupported) {
    flow.phase = 'failed';
    flow.outcome = 'failed';
    flow.message = runtime.unsupported;
  } else if (runtime.cancelRequested) {
    flow.phase = 'cancelled';
    flow.message = '任务已停止；已经完成的操作不会撤销';
  } else if (failure || exitCode !== 0) {
    flow.phase = 'failed';
    flow.outcome = 'failed';
    flow.message = failure ? cleanMessage(failure) : 'Mole 未能完成本次操作，请查看下方说明并检查文件权限';
  } else if (task.mode === 'preview' && runtime.previewReady) {
    flow.phase = 'reviewed';
    flow.outcome = 'preview';
    flow.message = '预览完成。应用及关联文件均未删除，个人数据默认保留';
  } else if (task.mode === 'execute' && text.includes('Uninstall incomplete')) {
    flow.phase = 'completed';
    flow.outcome = 'partial';
    flow.message = '部分内容未能卸载，请查看 Mole 的结果说明';
  } else if (task.mode === 'execute' && text.includes('Uninstall complete') && REMOVED_COUNT.test(text)) {
    flow.phase = 'completed';
    flow.outcome = 'complete';
    flow.message = 'Mole 已完成卸载。需要手动处理的内容请查看结果说明';
  } else {
    flow.phase = 'completed';
    flow.outcome = 'unknown';
    flow.message = '命令已结束，但未取得完整的卸载结果；请刷新应用列表核实';
  }
  const notices = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    for (const needle of ['Removed ', 'Failed:', 'Admin access denied', 'No applications were uninstalled', 'Background item still running', 'System extensions may remain', 'Kept ', 'Could not finish', 'Uninstall stopped', 'permission denied', 'Still running during uninstall']) {
      if (trimmed.includes(needle)) {
        notices.push(cleanMessage(trimmed).slice(0, 1000));
        break;
      }
    }
  }
  flow.notices = notices.slice(-20);
  task.uninstall = flow;
  task.state = flow.phase === 'cancelled' ? 'cancelled' : flow.phase === 'failed' ? 'failed' : 'succeeded';
  task.error = flow.phase === 'failed' ? flow.message : '';
  runtimes.delete(task.id);
  if (activeTaskId === task.id) activeTaskId = '';
  const elapsedMs = Math.max(0, new Date(task.endedAt).getTime() - new Date(task.startedAt).getTime());
  logEvent('uninstall.finished', { id: task.id, phase: flow.phase, outcome: flow.outcome, code: exitCode, elapsedMs });
  emitTask(task);
}

function uninstallAction(id, action) {
  const task = tasks.get(id);
  if (!task || !task.uninstall) throw new Error('图形卸载任务不存在');
  const runtime = runtimes.get(id);
  if (task.state !== 'running' || !action || !action.promptToken || task.uninstall.promptToken !== action.promptToken) {
    throw new Error('此操作已处理或状态已变化，请等待页面更新');
  }
  if (action.action === 'confirm') {
    if (task.uninstall.phase !== 'confirm' || task.mode !== 'execute' || action.password) throw new Error('当前步骤不接受卸载确认');
    if (runtime && Date.now() - runtime.promptAt < 150) throw new Error('文件检查刚完成，请稍后确认');
    if (runtime) {
      runtime.stage = 'executing';
      writeGuided(runtime, '\n');
    }
    updateGuidedFlow(task, { phase: 'executing', message: 'Mole 正在卸载所选应用，请保持页面打开', promptToken: '' });
  } else if (action.action === 'password') {
    const password = String(action.password || '');
    if (task.uninstall.phase !== 'authorizing' || !runtime || runtime.stage !== 'auth' || !password || password.length > 256 || /[\u0000-\u001f\u007f]/.test(password)) {
      throw new Error('请在认证步骤输入有效密码');
    }
    runtime.authOffset = runtime.buffer.length;
    runtime.stage = 'authWaiting';
    writeGuided(runtime, `${password}\n`);
    updateGuidedFlow(task, { phase: 'executing', message: '正在等待 Mole 验证管理员权限', promptToken: '' });
  } else {
    throw new Error('不支持的卸载操作');
  }
  logEvent('uninstall.action_submitted', { id, action: action.action });
  return publicTask(task);
}

function resolveAnalyzePath(input) {
  let target = String(input || '').trim();
  if (!target) throw new Error('请输入要分析的目录');
  if (target === '~') target = HOME;
  else if (target.startsWith('~/')) target = path.join(HOME, target.slice(2));
  if (!path.isAbsolute(target)) throw new Error('请输入绝对目录路径');
  let info;
  try {
    info = fs.statSync(target);
  } catch {
    throw new Error('无法访问该目录，请检查路径与权限');
  }
  if (!info.isDirectory()) throw new Error('分析目标必须是一个目录');
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function startTask(request) {
  if (updater.busy()) throw new Error('Mole 正在更新，请等待更新完成后再操作');
  const input = request || {};
  const operation = String(input.operation || '');
  const mode = operation === 'analyze' ? 'scan' : String(input.mode || '');
  if (operation !== 'analyze' && !OPERATIONS.includes(operation)) throw new Error('不支持的操作');
  if (operation !== 'analyze' && mode !== 'preview' && mode !== 'execute') throw new Error('不支持的任务模式');

  const current = activeTask();
  if (current) {
    logEvent('maintenance.task_contended', { operation, mode, activeTaskId: current.id, activeOperation: current.operation });
    const error = new Error(`已有正在运行的任务：${current.operation}`);
    error.taskId = current.id;
    throw error;
  }
  const environment = environmentCache;
  if (!environment || !environment.ready) throw new Error((environment && environment.error) || 'Mole 暂不可用');

  const maintenanceContext = MAINTENANCE_OPERATIONS.has(operation) ? maintenance.prepare(input) : null;
  const selectedApps = operation === 'uninstall' ? resolveApps(input.appIds) : [];
  const guidedPty = operation !== 'analyze' && ptyEnabled();
  if (operation !== 'analyze' && !guidedPty) throw new Error('当前环境无法启动 Mole 图形交互，请检查本机终端权限');

  const id = crypto.randomUUID();
  const pty = guidedPty;
  const cols = pty ? 240 : 0;
  const rows = pty ? 60 : 0;
  const task = {
    id,
    operation,
    mode,
    state: 'running',
    pty,
    cols,
    rows,
    createdAt: isoNow(),
    startedAt: isoNow(),
    endedAt: null,
    exitCode: null,
    error: '',
    path: operation === 'analyze' ? resolveAnalyzePath(input.path) : undefined,
    ...(operation === 'uninstall' ? {
      apps: selectedApps.map(publicApp),
      uninstall: { phase: 'preparing', files: null, notices: [], message: '正在检查应用与关联文件' }
    } : {})
  };
  tasks.set(id, task);
  outputBuffers.set(id, { chunks: [], size: 0, truncated: false });
  outputSubs.set(id, new Set());
  pruneFinishedTasks();
  activeTaskId = id;
  logEvent('task.started', { id, operation, mode, pty, ...(operation === 'uninstall' ? { appCount: selectedApps.length } : {}) });
  emitTask(task);

  if (operation === 'analyze') startAnalyze(task);
  else if (operation === 'uninstall') startGuidedUninstall(task, selectedApps);
  else maintenance.start(task, maintenanceContext);

  return publicTask(task);
}

function sendInput(id, data) {
  const task = tasks.get(id);
  if (!task || !ACTIVE_STATES.has(task.state)) return false;
  const runtime = runtimes.get(id);
  if (!runtime || runtime.maintenance || !runtime.child || !runtime.child.stdin || runtime.child.stdin.destroyed) return false;
  let text = String(data || '');
  if (!text) return false;
  if (text.length > 8192) text = text.slice(0, 8192);
  if (!task.pty) {
    if (text.includes('\x03')) {
      stopTask(id);
      return true;
    }
    text = text.replace(/\r/g, '\n');
  }
  try {
    runtime.child.stdin.write(text);
    return true;
  } catch {
    return false;
  }
}

function stopTask(id) {
  const task = tasks.get(id);
  if (!task) return null;
  if (!ACTIVE_STATES.has(task.state)) return publicTask(task);
  task.state = 'cancelling';
  emitTask(task);
  const runtime = runtimes.get(id);
  if (runtime && runtime.child) {
    runtime.cancelRequested = true;
    killGroup(runtime.child, 'SIGTERM');
    if (runtime.killTimer) clearTimeout(runtime.killTimer);
    runtime.killTimer = setTimeout(() => {
      if (!runtime.finished) killGroup(runtime.child, 'SIGKILL');
    }, 4000);
  }
  logEvent('task.stop_requested', { id, operation: task.operation });
  return publicTask(task);
}

function attachTask(id, listener) {
  const task = tasks.get(id);
  if (!task) return null;
  const subscribers = outputSubs.get(id);
  if (subscribers && typeof listener === 'function') subscribers.add(listener);
  const buffer = outputBuffers.get(id);
  return {
    task: publicTask(task),
    output: buffer ? buffer.chunks.join('') : '',
    truncated: !!(buffer && buffer.truncated)
  };
}

function detachTask(id, listener) {
  const subscribers = outputSubs.get(id);
  if (subscribers && typeof listener === 'function') subscribers.delete(listener);
}

function subscribeTasks(listener) {
  if (typeof listener !== 'function') return () => {};
  taskListeners.add(listener);
  return () => taskListeners.delete(listener);
}

function runCapture(command, args, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd: HOME, env: childEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    const chunks = [];
    let size = 0;
    let stderrTail = '';
    let settled = false;
    const settle = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(() => {
      killGroup(child, 'SIGKILL');
      settle(new Error('命令执行超时'));
    }, timeoutMs);
    child.stdout.on('data', buffer => {
      size += buffer.length;
      if (size > maxBytes) {
        killGroup(child, 'SIGKILL');
        settle(new Error('命令输出过大'));
        return;
      }
      chunks.push(buffer);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4096);
    });
    child.on('error', error => settle(error));
    child.on('close', code => {
      if (code === 0) settle(null);
      else settle(new Error(cleanMessage(stderrTail) || `命令退出码 ${code}`));
    });
  });
}

async function getHistory(limit) {
  const environment = await ensureEnvironment();
  if (!environment.ready) throw new Error(environment.error || 'Mole 暂不可用');
  const count = clamp(limit, 1, 200, 50);
  const started = Date.now();
  logEvent('history.loading', { limit: count });
  const output = await runCapture(environment.moPath, ['history', '--json', '--limit', String(count)], 30000, 8 * 1024 * 1024);
  const data = toCamel(parseMoleJson(output));
  const history = {
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    deletions: Array.isArray(data.deletions) ? data.deletions : [],
    limit: typeof data.limit === 'number' ? data.limit : count
  };
  logEvent('history.loaded', { limit: count, sessions: history.sessions.length, deletions: history.deletions.length, elapsedMs: Date.now() - started });
  return history;
}

function openExternal(url) {
  const value = String(url || '');
  if (!/^https?:\/\//i.test(value)) return;
  try {
    utools.shellOpenExternal(value);
  } catch {
    // Ignore a blocked external link.
  }
}

function openLog() {
  try {
    if (fs.existsSync(LOG_FILE)) utools.shellOpenPath(LOG_FILE);
    else utools.shellShowItemInFolder(path.dirname(LOG_FILE));
  } catch {
    // Ignore an unavailable file manager action.
  }
}

function pickDirectory() {
  try {
    const result = utools.showOpenDialog({ title: '选择要分析的目录', properties: ['openDirectory', 'createDirectory'], buttonLabel: '选择' });
    return result && result.length ? result[0] : null;
  } catch {
    return null;
  }
}

function chooseMoPath() {  let result;
  if (updater.busy()) return Promise.reject(new Error('Mole 正在更新，暂时无法切换路径'));
  try {
    result = utools.showOpenDialog({ title: '选择 mo 可执行文件', properties: ['openFile'], buttonLabel: '选择' });
  } catch {
    result = null;
  }
  if (!result || !result.length) return Promise.resolve(null);
  const candidate = result[0];
  const probed = probeMo(candidate);
  if (!probed || !probed.version) return Promise.reject(new Error('所选文件不是可用的 mo 命令'));
  setSetting('moPath', candidate);
  stopStatus();
  environmentCache = null;
  return getEnvironment(true).then(environment => {
    if (statusListeners.size && environment.ready) startStatus();
    return environment;
  });
}

function clearMoPath() {
  if (updater.busy()) return Promise.reject(new Error('Mole 正在更新，暂时无法切换路径'));
  setSetting('moPath', null);
  stopStatus();
  environmentCache = null;
  return getEnvironment(true).then(environment => {
    if (statusListeners.size && environment.ready) startStatus();
    return environment;
  });
}

function refreshEnvironment() {
  if (updater.busy()) return environmentPromise || Promise.resolve(environmentCache);
  stopStatus();
  return getEnvironment(true).then(environment => {
    if (statusListeners.size && environment.ready) startStatus();
    return environment;
  });
}

function killAllTasks() {
  updater.shutdown();
  for (const runtime of runtimes.values()) {
    runtime.cancelRequested = true;
    if (runtime.child) killGroup(runtime.child, 'SIGTERM');
  }
}

function onEnter(listener) {
  if (typeof listener !== 'function') return () => {};
  enterListeners.add(listener);
  if (enterAction) safeCall(listener, enterAction);
  return () => enterListeners.delete(listener);
}

if (typeof utools !== 'undefined' && utools) {
  try {
    utools.onPluginEnter(action => {
      pluginVisible = true;
      enterAction = action;
      for (const listener of enterListeners) safeCall(listener, action);
      if (statusListeners.size) {
        refreshEnvironment().then(environment => {
          if (environment.ready && statusListeners.size) startStatus();
        }).catch(error => {
          emitStatus({ state: 'error', snapshot: null, receivedAt: null, error: cleanMessage(error.message) });
        });
      }
    });
    utools.onPluginOut(isKill => {
      pluginVisible = false;
      if (isKill) {
        stopStatus();
        killAllTasks();
      } else {
        // The plugin is only hidden. Pause sampling; running tasks continue.
        stopStatus();
      }
    });
  } catch {
    // Running outside uTools (for example a plain browser) has no events.
  }
}

process.on('exit', killAllTasks);

window.mole = {
  version: 3,
  getEnvironment: () => getEnvironment(false),
  refreshEnvironment,
  getMoleUpdate: updater.getState,
  updateMole: updater.start,
  subscribeMoleUpdate: updater.subscribe,
  authorizeMoleUpdate: updater.authorize,
  subscribeStatus,
  getStatus: () => status,
  getTasks,
  getTask,
  startTask,
  stopTask,
  sendInput,
  attachTask,
  detachTask,
  subscribeTasks,
  getApplications,
  getHistory,
  uninstallAction,
  maintenanceAction: (id, action) => publicTask(maintenance.action(id, action)),
  pickDirectory,
  chooseMoPath,
  clearMoPath,
  openExternal,
  openLog,
  getEnterAction: () => enterAction,
  onEnter,
  getPaths: () => ({ logFile: LOG_FILE })
};

logEvent('plugin.loaded', { name: 'LiberClean', version: '0.1.1' });
