'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAINTENANCE_OPERATIONS = new Set(['clean', 'optimize', 'purge', 'installer']);
const FILE_OPERATIONS = new Set(['purge', 'installer']);
const MAX_ITEMS = 5000;
const MAX_CAPTURE = 24 * 1024 * 1024;
const PREVIEW_TTL = 30 * 60 * 1000;
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Z0-9])/g;
const STEP_NAMES = {
  'User Caches': '用户缓存', 'User-level Cleanup': '用户文件清理', 'System Caches': '系统缓存',
  'System-level Cleanup': '系统文件清理', 'Application Caches': '应用缓存', 'Browser Caches': '浏览器缓存',
  'Developer Tools': '开发工具缓存', 'Trash': '废纸篓', 'Logs': '运行日志',
  'User essentials': '用户文件与缓存', 'App caches': '应用缓存', 'Browsers': '浏览器缓存',
  'Cloud & Office': '云服务与办公应用', 'Developer tools': '开发工具缓存', 'Apps & utilities': '应用与工具缓存',
  'Virtualization': '虚拟化缓存', 'Application Support': '应用支持文件', 'App leftovers': '应用残留',
  'Apple Silicon updates': 'Apple Silicon 更新文件', 'Device backups & firmware': '设备备份与固件',
  'Time Machine': 'Time Machine 快照', 'Large files': '大文件提示', 'Project artifacts': '项目构建产物提示',
  'Finder Cache Refresh': '刷新 Finder 缓存', 'App State Cleanup': '清理应用恢复状态',
  'Broken Config Repair': '修复损坏配置', 'Network Cache Refresh': '刷新网络缓存', 'Database Optimization': '优化数据库',
  'Prevent Finder .DS_Store': 'Finder 元数据设置', 'Legacy Overrides': '旧版配置检查', 'Network Stack Refresh': '刷新网络服务',
  'Permission Repair': '检查文件权限', 'Spotlight Optimization': '优化 Spotlight 索引', 'Spotlight Orphan Rules': '清理失效索引规则',
  'Periodic Maintenance': '执行定期维护', 'Shared File Lists': '清理共享文件列表', 'Disk Health': '磁盘健康检查',
  'Login Items': '登录项检查', 'Quarantine Database Cleanup': '清理隔离记录数据库', 'Launch Agents Cleanup': '清理失效启动代理',
  'Notifications': '通知设置检查', 'Usage Data': '使用记录检查',
  'DNS Cache': 'DNS 缓存', 'DNS cache': 'DNS 缓存', 'Launch Services': '应用启动服务',
  'Spotlight Index': 'Spotlight 索引', 'Finder': 'Finder', 'System Maintenance': '系统维护'
};

function sizeBytes(value) {
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([KMGTPE]?)(?:i?B)$/i.exec(String(value).trim());
  if (!match) return null;
  const bytes = Number(match[1]) * 1024 ** (' KMGTPE'.indexOf(match[2].toUpperCase()) < 0 ? 0 : ' KMGTPE'.indexOf(match[2].toUpperCase()));
  return Number.isSafeInteger(Math.round(bytes)) ? Math.round(bytes) : null;
}

function safeText(value) {
  return String(value || '').replace(ANSI, '').replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/\b(authorization|cookie|password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\r\n]+/gi, '$1=[redacted]')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, 2000);
}

function resolvePurgePath(value, home) {
  let target = typeof value === 'string' ? value.trim() : '';
  if (!target) throw new Error('请选择要检查的项目目录');
  if (/[\x00-\x1f\x7f]/.test(target)) throw new Error('项目目录不能包含控制字符');
  if (target === '~') target = home;
  else if (target.startsWith('~/')) target = path.join(home, target.slice(2));
  if (!path.isAbsolute(target)) throw new Error('请输入项目目录的绝对路径，或使用 ~/ 开头的路径');
  let resolved;
  try {
    resolved = fs.realpathSync(target);
    if (!fs.statSync(resolved).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('无法访问项目目录，请检查路径与权限');
  }
  if (resolved === path.parse(resolved).root) throw new Error('请选择项目目录或项目的上级目录，不能选择磁盘根目录');
  return resolved;
}

function parseCleanPreview(text, home) {
  if (!text.startsWith('# Mole Cleanup Preview')) throw new Error('没有取得完整的 Mole 清理清单，请重新检查');
  let group = '清理项目';
  const items = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const section = /^=== (.+) ===$/.exec(line);
    if (section) { group = STEP_NAMES[section[1]] || safeText(section[1]); continue; }
    if (!line || line.startsWith('#')) continue;
    const delimiter = line.lastIndexOf('  # ');
    if (delimiter < 0) continue;
    const target = line.slice(0, delimiter);
    const absolute = target.startsWith('~/') ? path.join(home, target.slice(2)) : target;
    if (!path.isAbsolute(absolute) || /[\x00-\x1f\x7f]/.test(absolute)) throw new Error('Mole 返回了无法识别的清理路径');
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    const detail = safeText(line.slice(delimiter + 4));
    const match = /^([0-9.]+\s*[KMGTPE]?i?B)(?:\s|$)/i.exec(detail);
    items.push({ id: crypto.randomUUID(), title: path.basename(absolute), path: absolute, group, size: match ? sizeBytes(match[1]) : null, detail, selectable: false, status: 'ready' });
    if (items.length > MAX_ITEMS) throw new Error('清理清单过长，请先缩小 Mole 的检查范围');
  }
  return items;
}

function resolveMoleScript(environment, operation) {
  if (!MAINTENANCE_OPERATIONS.has(operation)) throw new Error('不支持的维护工具');
  const entry = fs.realpathSync(environment.moPath);
  const directory = path.dirname(entry);
  const candidates = [path.join(directory, `${operation}.sh`), path.join(directory, 'bin', `${operation}.sh`), path.join(directory, '..', 'libexec', 'bin', `${operation}.sh`)];
  const script = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!script) throw new Error('找不到本机 Mole 的维护组件，请在环境设置中检查安装路径');
  const source = fs.readFileSync(script, 'utf8');
  const required = {
    clean: ['CLEAN_PREVIEW_FINAL_FILE=', 'ensure_sudo_session_with_password', 'BASH_SOURCE[0]', 'main()'],
    optimize: ['--dry-run', 'MOLE_DRY_RUN', 'show_optimization_summary', 'main()'],
    purge: ['MOLE_SKIP_MAIN', 'clean_project_artifacts', 'main()'],
    installer: ['MOLE_TEST_MODE', 'collect_installers()', 'build_installer_delete_plan()', 'execute_installer_delete_plan()']
  }[operation];
  if (required.some(token => !source.includes(token))) throw new Error('当前 Mole 版本的交互方式暂不兼容，请更新 Mole 后重新检查');
  if (operation === 'purge') {
    const library = fs.readFileSync(path.join(path.dirname(script), '..', 'lib', 'clean', 'project.sh'), 'utf8');
    if (['select_purge_categories', 'confirm_purge_cleanup', 'item_expected_parent_ids', 'item_expected_target_ids', 'item_paths', 'item_sizes', 'PURGE_SEARCH_PATHS'].some(token => !library.includes(token))) {
      throw new Error('当前 Mole 的项目检查组件暂不兼容，请更新 Mole 后重试');
    }
  }
  const signature = crypto.createHash('sha256').update(`${entry}\0${environment.moVersion}\0${source}`).digest('hex');
  return { script: fs.realpathSync(script), signature };
}

function createMaintenanceController({ tasks, runtimes, getEnvironment, childEnv, emitTask, finishTask, killGroup, logEvent, spawnProcess = spawn }) {
  const plans = new Map();
  const helper = path.join(__dirname, 'maintenance-helper.sh');
  const update = (task, patch) => { task.maintenance = { ...task.maintenance, ...patch }; emitTask(task); };
  const elapsed = runtime => Date.now() - runtime.started;
  const log = (task, runtime, event, fields = {}) => logEvent(`maintenance.${event}`, { id: task.id, requestId: runtime.context.requestId, operation: task.operation, mode: task.mode, scanPath: safeText(runtime.context.scanPath), step: runtime.stage, elapsedMs: elapsed(runtime), ...fields });

  function prepare(request) {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    logEvent('maintenance.request_received', { requestId, operation: request.operation, mode: request.mode, path: safeText(request.path), previewTaskId: request.previewTaskId || '', itemCount: Array.isArray(request.itemIds) ? request.itemIds.length : 0 });
    const environment = getEnvironment();
    const native = resolveMoleScript(environment, request.operation);
    const context = { ...native, requestId, scanPath: '', selected: [], sourceTaskId: '', fileMode: FILE_OPERATIONS.has(request.operation) };
    if (request.mode === 'execute') {
      const previous = tasks.get(request.previewTaskId);
      const plan = plans.get(request.previewTaskId);
      if (!previous || previous.operation !== request.operation || previous.mode !== 'preview' || previous.state !== 'succeeded' || previous.maintenance?.phase !== 'reviewed' || !plan) throw new Error('请先完成当前工具的检查，再选择需要处理的项目');
      if (Date.now() - plan.createdAt > PREVIEW_TTL || plan.signature !== native.signature) throw new Error('检查结果已过期或 Mole 已更新，请重新检查');
      context.sourceTaskId = previous.id;
      context.scanPath = plan.scanPath || '';
      if (context.fileMode) {
        if (!Array.isArray(request.itemIds) || request.itemIds.length === 0 || request.itemIds.length > MAX_ITEMS || request.itemIds.some(id => typeof id !== 'string') || new Set(request.itemIds).size !== request.itemIds.length) throw new Error('请选择有效的清理项目');
        context.selected = request.itemIds.map(id => {
          const item = plan.items.find(item => item.id === id);
          if (!item || !item.selectable || !item.identity) throw new Error('所选项目已变化，请重新检查后再选择');
          return item;
        });
      } else context.selected = plan.items;
    }
    if (request.operation === 'purge') {
      const requestedPath = request.mode === 'execute' ? context.scanPath : request.path;
      try {
        const resolved = resolvePurgePath(requestedPath, environment.home || os.homedir());
        if (request.mode === 'execute' && resolved !== context.scanPath) throw new Error('检查目录已变化，请重新检查');
        context.scanPath = resolved;
      } catch (error) {
        logEvent('maintenance.scan_path_failed', { requestId, operation: request.operation, mode: request.mode, target: native.script, path: safeText(requestedPath), elapsedMs: Date.now() - started, message: safeText(error.message), stack: safeText(error.stack) });
        throw error;
      }
    }
    logEvent('maintenance.request_validated', { requestId, operation: request.operation, mode: request.mode, previewTaskId: context.sourceTaskId, scanPath: safeText(context.scanPath), selectedCount: context.selected.length, target: native.script, elapsedMs: Date.now() - started });
    return context;
  }

  function reject(task, runtime, message) {
    if (runtime.failure || runtime.finished) return;
    runtime.failure = message;
    runtime.waiting = '';
    update(task, { phase: 'failed', promptToken: '', message });
    log(task, runtime, 'protocol_rejected', { reason: safeText(message) });
    killGroup(runtime.child, 'SIGTERM');
    runtime.killTimer = setTimeout(() => { if (!runtime.finished) killGroup(runtime.child, 'SIGKILL'); }, 4000);
  }

  function start(task, context) {
    if (task.operation === 'purge') task.path = context.scanPath;
    for (const id of plans.keys()) if (!tasks.has(id)) plans.delete(id);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mole-gui-'));
    fs.chmodSync(directory, 0o700);
    const runtime = { child: null, directory, previewFile: path.join(directory, 'clean-preview.txt'), exitFile: path.join(directory, 'exit-code'), started: Date.now(), lastOutputAt: Date.now(), stage: 'inspecting', waiting: '', finished: false, cancelRequested: false, stderrTail: '', buffer: '', text: '', captureSize: 0, token: crypto.randomUUID(), items: [], steps: [], messages: [], inventoryReady: false, confirmed: false, hello: false, context, maintenance: true };
    runtimes.set(task.id, runtime);
    task.maintenance = { phase: 'preparing', kind: context.fileMode ? 'files' : 'batch', items: context.selected.map(publicItem), steps: [], messages: [], selectedIds: context.selected.map(item => item.id), previewTaskId: context.sourceTaskId, message: task.mode === 'preview' ? '正在检查可处理项目，请稍候' : '正在重新核对所选项目', scanStatus: 'complete' };
    emitTask(task);
    const wrapper = [
      'exec 3< <(cat)',
      '/usr/bin/script -q /dev/null /bin/bash "$1" "$2" "$3" "$4" "$5" "$6" "$7" <&3',
      'code=$?', 'printf \'%s\' "$code" > "$MOLE_EXIT_FILE"', 'kill 0'
    ].join('; ');
    try {
      runtime.child = spawnProcess('/bin/bash', ['-c', wrapper, 'bash', helper, context.script, task.operation, task.mode, runtime.token, runtime.previewFile, context.scanPath], {
        cwd: path.dirname(directory), env: childEnv({ MOLE_EXIT_FILE: runtime.exitFile, MOLE_TEST_MODE: '0', MOLE_TEST_NO_AUTH: '0', MOLE_PURGE_YES: '0', MO_DEBUG: '0', BASH_ENV: '', ENV: '' }), detached: true, stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) { complete(task, runtime, 1, null, error.message); return; }
    log(task, runtime, 'process_started', { target: context.script, pid: runtime.child.pid, selectedCount: context.selected.length });
    const append = chunk => {
      if (runtime.finished) return;
      runtime.lastOutputAt = Date.now();
      runtime.captureSize += Buffer.byteLength(chunk);
      if (runtime.captureSize > MAX_CAPTURE) { reject(task, runtime, 'Mole 返回的检查信息过多，已停止本次操作'); return; }
      runtime.buffer += chunk.replace(/\r/g, '\n');
      let newline;
      while ((newline = runtime.buffer.indexOf('\n')) >= 0) {
        const line = runtime.buffer.slice(0, newline);
        runtime.buffer = runtime.buffer.slice(newline + 1);
        consume(task, runtime, line);
      }
      if (runtime.buffer.length > 65536) reject(task, runtime, 'Mole 返回了无法解析的信息，请重新检查');
    };
    runtime.child.stdout.setEncoding('utf8');
    runtime.child.stderr.setEncoding('utf8');
    runtime.child.stdout.on('data', append);
    runtime.child.stderr.on('data', chunk => { runtime.stderrTail = `${runtime.stderrTail}${safeText(chunk)}`.slice(-4000); append(chunk); });
    runtime.child.stdin.on('error', () => {});
    runtime.child.on('error', error => complete(task, runtime, 1, null, error.message));
    runtime.child.on('close', (code, signal) => complete(task, runtime, code, signal));
    runtime.watchdog = setInterval(() => {
      if (runtime.finished) return;
      const timeout = runtime.waiting ? 10 * 60 * 1000 : 3 * 60 * 1000;
      if (Date.now() - runtime.lastOutputAt > timeout) reject(task, runtime, runtime.waiting ? '等待确认或认证已超时，请重新开始检查' : 'Mole 长时间未返回检查进度，已停止任务，请检查目录权限后重试');
    }, 1000);
  }

  function publicItem(item) {
    const { identity, index, ...display } = item;
    return display;
  }

  function consume(task, runtime, raw) {
    const marker = `MOLE_GUI_${runtime.token}\t`;
    const index = raw.indexOf(marker);
    if (index >= 0) {
      try {
        const event = JSON.parse(raw.slice(index + marker.length));
        if (!Array.isArray(event) || event.length > 12 || event.some(value => typeof value !== 'string' || value.length > 16384)) throw new Error('invalid event');
        handleEvent(task, runtime, event);
      } catch (error) {
        log(task, runtime, 'response_parse_failed', { message: safeText(error.message), stack: safeText(error.stack) });
        reject(task, runtime, `Mole 图形交互数据不完整，请重新检查。${safeText(error.message)}`);
      }
      return;
    }
    const line = safeText(raw);
    if (!line) return;
    runtime.text = `${runtime.text}\n${line}`.slice(-2 * 1024 * 1024);
    const heading = /^[➤➜▶]\s+(.+)$/.exec(line);
    if (heading) {
      const current = runtime.steps.at(-1);
      if (current) {
        if (current.status === 'running') current.status = 'completed';
        log(task, runtime, 'step_finished', { title: current.title, status: current.status, stepElapsedMs: Date.now() - runtime.stepStartedAt });
      }
      runtime.stepStartedAt = Date.now();
      const title = heading[1].trim();
      runtime.steps.push({ id: crypto.randomUUID(), title: STEP_NAMES[title] || title, detail: '', status: 'running' });
      if (runtime.steps.length > 120) runtime.steps.shift();
      update(task, { steps: runtime.steps.map(item => ({ ...item })), message: `正在检查：${STEP_NAMES[title] || title}` });
      log(task, runtime, 'step_started', { title });
    } else if (/^[✓✔✗✘⚠]|\b(?:failed|denied|skipped|unavailable|incomplete|would apply|applied \d|removed \d)\b/i.test(line)) {
      const tone = /^[✗✘⚠]|\bfailed|denied|incomplete\b/i.test(line) ? 'warning' : 'info';
      runtime.messages.push({ id: crypto.randomUUID(), tone, text: line });
      runtime.messages = runtime.messages.slice(-60);
      const step = runtime.steps.at(-1);
      if (step) { step.detail = line; if (tone === 'warning') step.status = 'warning'; }
      update(task, { messages: runtime.messages.slice(), steps: runtime.steps.map(item => ({ ...item })) });
      log(task, runtime, 'step_reported', { tone, response: line });
    }
  }

  function handleEvent(task, runtime, [type, ...values]) {
    if (runtime.failure || runtime.finished) return;
    if (type !== 'hello' && !runtime.hello) throw new Error('missing handshake');
    if (type === 'hello') {
      if (runtime.hello || values[0] !== '1' || values[1] !== task.operation || values[2] !== task.mode) throw new Error('invalid handshake');
      runtime.hello = true;
      log(task, runtime, 'adapter_connected');
    } else if (type === 'item') {
      if (runtime.inventoryReady || runtime.items.length >= MAX_ITEMS || !runtime.context.fileMode) throw new Error('unexpected item');
      const [index, target, size, group, detail, identity, selectable] = values;
      if (!/^\d+$/.test(index) || Number(index) !== runtime.items.length || !path.isAbsolute(target) || target === '/' || /[\x00-\x1f\x7f]/.test(target) || (size && (!/^\d+$/.test(size) || !Number.isSafeInteger(Number(size))))) throw new Error('invalid item');
      if (task.operation === 'purge') {
        const relative = path.relative(runtime.context.scanPath, target);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('项目检查结果超出所选目录，请重新检查');
      }
      const previous = runtime.context.selected.find(item => item.path === target);
      runtime.items.push({ id: previous?.id || crypto.randomUUID(), index: Number(index), title: task.operation === 'purge' ? `${path.basename(path.dirname(target))} / ${path.basename(target)}` : path.basename(target), path: target, size: size ? Number(size) : null, group: safeText(group), detail: safeText(detail), identity, selectable: selectable === 'true' && !!identity, status: 'ready' });
      log(task, runtime, 'item_loaded', { target, size: size || null, selectable: selectable === 'true' });
    } else if (type === 'inventory') {
      if (runtime.inventoryReady || !runtime.context.fileMode || Number(values[0]) !== runtime.items.length) throw new Error('invalid inventory');
      runtime.inventoryReady = true;
      const partial = values[1] === 'incomplete';
      if (task.mode === 'execute') {
        const selected = runtime.context.selected.map(expected => {
          const fresh = runtime.items.find(item => item.path === expected.path);
          if (!fresh || !fresh.selectable || fresh.identity !== expected.identity || (task.operation === 'installer' && fresh.size !== expected.size)) throw new Error('所选文件已变化，请重新检查后再选择');
          return fresh;
        });
        runtime.selected = selected;
        update(task, { items: selected.map(publicItem), selectedIds: selected.map(item => item.id), scanStatus: partial ? 'partial' : 'complete' });
        write(task, runtime, `select:${selected.map(item => item.index).join(',')}\n`);
      } else update(task, { items: runtime.items.map(publicItem), scanStatus: partial ? 'partial' : 'complete', message: '检查已完成，正在整理结果' });
      log(task, runtime, 'inventory_validated', { count: runtime.items.length, selectedCount: runtime.selected?.length || 0, partial });
    } else if (type === 'confirm') {
      if (task.mode !== 'execute' || runtime.confirmed || runtime.waiting || (runtime.context.fileMode && (!runtime.inventoryReady || Number(values[0]) !== runtime.selected?.length))) throw new Error('unexpected confirmation');
      runtime.waiting = 'confirm';
      runtime.stage = 'review';
      update(task, { phase: 'confirm', promptToken: crypto.randomUUID(), cloudCount: Number(values[2]) || 0, message: runtime.context.fileMode ? '已重新核对所选文件，请确认本次清理范围' : '检查已完成，请确认执行本次维护。实际范围以 Mole 执行时的检查为准' });
      log(task, runtime, 'confirmation_requested', { count: runtime.selected?.length || runtime.context.selected.length, cloudCount: Number(values[2]) || 0 });
    } else if (type === 'executing') {
      if (!runtime.confirmed) throw new Error('unconfirmed execution');
      runtime.stage = 'executing';
      update(task, { phase: 'executing', message: 'Mole 正在处理，请等待结果' });
    } else if (type === 'auth') {
      if (!runtime.confirmed || task.mode !== 'execute' || runtime.waiting) throw new Error('unexpected authentication');
      runtime.stage = 'authorizing';
      runtime.waiting = 'password';
      update(task, { phase: 'authorizing', promptToken: crypto.randomUUID(), allowSkip: true, message: runtime.authRejected ? '密码验证失败，请重新输入，也可以跳过管理员步骤' : safeText(values[1]) });
      log(task, runtime, 'authentication_requested');
    } else if (type === 'auth_rejected') {
      runtime.authRejected = true;
      log(task, runtime, 'authentication_rejected');
    } else if (type === 'auth_accepted' || type === 'auth_skipped') {
      runtime.authRejected = false;
      runtime.stage = 'executing';
      update(task, { phase: 'executing', allowSkip: false, message: type === 'auth_accepted' ? '权限验证通过，正在继续维护' : '已跳过管理员步骤，正在继续处理其他项目' });
      log(task, runtime, type === 'auth_accepted' ? 'authentication_succeeded' : 'authentication_skipped');
    } else if (type === 'reset_steps') {
      if (!runtime.confirmed) throw new Error('unexpected step reset');
      runtime.steps = [];
      runtime.text = '';
      update(task, { steps: [] });
    } else if (type === 'finished') {
      if (runtime.nativeResult) throw new Error('duplicate completion');
      runtime.nativeResult = values;
      log(task, runtime, 'native_result_received', { status: values });
    } else throw new Error('unsupported event');
  }

  function write(task, runtime, data) {
    if (!runtime.child?.stdin || runtime.child.stdin.destroyed || !runtime.child.stdin.writable) throw new Error('Mole 交互连接已结束，请重新检查');
    runtime.child.stdin.write(data);
    runtime.lastOutputAt = Date.now();
  }

  function action(id, input) {
    const task = tasks.get(id);
    const runtime = runtimes.get(id);
    if (!task?.maintenance || !runtime?.maintenance || runtime.finished || runtime.failure || task.state !== 'running' || !input?.promptToken || input.promptToken !== task.maintenance.promptToken) throw new Error('此步骤已处理或任务状态已变化，请等待页面更新');
    let data;
    if (input.action === 'confirm' && runtime.waiting === 'confirm' && task.mode === 'execute' && !input.password) {
      data = 'confirm\n';
    } else if (input.action === 'password' && runtime.waiting === 'password') {
      if (typeof input.password !== 'string' || !input.password || Buffer.byteLength(input.password) > 256 || /[\x00-\x1f\x7f]/.test(input.password)) throw new Error('请输入有效的 Mac 登录密码');
      data = `password:${input.password}\n`;
    } else if (input.action === 'skip' && runtime.waiting === 'password' && task.maintenance.allowSkip && !input.password) data = 'skip\n';
    else throw new Error('当前步骤不接受此操作');
    write(task, runtime, data);
    if (input.action === 'confirm') runtime.confirmed = true;
    runtime.waiting = '';
    runtime.stage = 'executing';
    update(task, { phase: 'executing', promptToken: '', allowSkip: false, message: input.action === 'password' ? '正在验证管理员权限' : '正在继续处理，请稍候' });
    log(task, runtime, 'action_submitted', { action: input.action });
    return task;
  }

  function complete(task, runtime, code, signal, failure) {
    if (runtime.finished) return;
    clearInterval(runtime.watchdog);
    if (runtime.buffer.trim()) { consume(task, runtime, runtime.buffer); runtime.buffer = ''; }
    let nativeCode = code;
    try { const recorded = Number(fs.readFileSync(runtime.exitFile, 'utf8').trim()); if (Number.isInteger(recorded) && recorded >= 0 && recorded <= 255) nativeCode = recorded; } catch {}
    const flow = { ...task.maintenance, promptToken: '', allowSkip: false };
    let problem = runtime.failure || failure || '';
    if (!runtime.hello && !runtime.cancelRequested) problem ||= 'Mole 图形交互组件未能启动，请检查本机安装';
    if (runtime.cancelRequested) {
      flow.phase = 'cancelled'; flow.outcome = 'cancelled'; flow.message = runtime.confirmed ? '操作已停止，已经完成的处理不会撤销' : '检查已停止，没有执行清理';
    } else if (problem || nativeCode !== 0) {
      flow.phase = 'failed'; flow.outcome = runtime.confirmed ? 'partial' : 'failed'; flow.message = safeText(problem) || 'Mole 未能完成本次操作，请检查结果说明与目录权限';
    } else if (task.mode === 'preview') {
      try {
        if (runtime.context.fileMode) {
          if (!runtime.inventoryReady && !(task.operation === 'purge' && runtime.nativeResult?.[1] === 'no_candidates')) throw new Error('未取得完整的文件检查结果，请重试');
          flow.items = runtime.items.map(publicItem);
        } else if (task.operation === 'clean') {
          const stat = fs.lstatSync(runtime.previewFile);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CAPTURE) throw new Error('清理清单无法读取，请重新检查');
          flow.items = parseCleanPreview(fs.readFileSync(runtime.previewFile, 'utf8'), os.homedir());
        } else {
          if (!/Dry Run Complete.*No Changes Made/i.test(runtime.text) || !runtime.steps.length) throw new Error('没有取得完整的优化检查结果，请重试');
          flow.items = runtime.steps.map(step => ({ id: step.id, title: step.title, path: '', group: '系统优化', size: null, detail: step.detail, selectable: false, status: 'ready' }));
        }
        flow.phase = 'reviewed'; flow.outcome = 'preview'; flow.message = flow.items.length ? '检查完成，本次没有修改文件或系统设置' : '检查完成，没有发现需要处理的项目';
        plans.set(task.id, { signature: runtime.context.signature, scanPath: runtime.context.scanPath, createdAt: Date.now(), items: runtime.context.fileMode ? runtime.items : flow.items });
        log(task, runtime, 'preview_saved', { count: flow.items.length, scanStatus: flow.scanStatus });
      } catch (error) { problem = error.message; flow.phase = 'failed'; flow.outcome = 'failed'; flow.message = problem; }
    } else if (!runtime.confirmed) {
      problem = '本次操作没有取得有效确认，请重新检查'; flow.phase = 'failed'; flow.outcome = 'failed'; flow.message = problem;
    } else {
      flow.phase = 'completed';
      if (runtime.context.fileMode) {
        flow.outcome = runtime.nativeResult ? 'complete' : 'unknown';
        flow.message = runtime.nativeResult ? '已完成所选项目的清理' : '命令已结束，但没有取得完整处理结果，请重新检查';
      } else {
        const known = task.operation === 'optimize' ? /Optimization Complete/i.test(runtime.text) : /(?:Cleanup|Clean) Complete|Cleanup finished/i.test(runtime.text);
        const partial = /(?:cleanup|optimization) incomplete|\b[1-9]\d* failed\b|need attention|permission denied/i.test(runtime.text);
        flow.outcome = partial ? 'partial' : known ? 'complete' : 'unknown';
        flow.message = partial ? '部分维护项目需要检查，请查看结果说明' : known ? 'Mole 已完成本次维护，请查看各步骤结果' : '命令已结束，请检查 Mole 返回的结果说明';
      }
    }
    if (runtime.confirmed && runtime.context.fileMode) {
      flow.items = (runtime.selected || []).map(item => {
        let status = 'skipped';
        try { fs.lstatSync(item.path); } catch (error) { if (error.code === 'ENOENT') status = 'removed'; }
        return { ...publicItem(item), selectable: false, status };
      });
      const completedCount = flow.items.filter(item => item.status === 'removed').length;
      flow.summary = { selectedCount: flow.items.length, completedCount, failedCount: flow.items.length - completedCount };
      if (flow.phase === 'completed' && flow.summary.failedCount) {
        flow.outcome = 'partial';
        flow.message = '部分项目未能清理，请查看仍保留的项目后重新检查';
      }
    }
    for (const step of runtime.steps) if (step.status === 'running') step.status = flow.phase === 'failed' || flow.phase === 'cancelled' ? 'warning' : 'completed';
    const finalStep = runtime.steps.at(-1);
    if (finalStep) log(task, runtime, 'step_finished', { title: finalStep.title, status: finalStep.status, stepElapsedMs: Date.now() - runtime.stepStartedAt });
    flow.steps = runtime.steps.map(item => ({ ...item }));
    flow.messages = runtime.messages.slice();
    task.maintenance = flow;
    log(task, runtime, 'finished', { phase: flow.phase, outcome: flow.outcome, code: nativeCode, count: flow.items.length, summary: flow.summary || null });
    finishTask(task, runtime, nativeCode, signal, flow.phase === 'failed' ? flow.message : undefined);
    try { fs.rmSync(runtime.directory, { recursive: true, force: true }); } catch {}
  }

  return { prepare, start, action };
}

module.exports = { createMaintenanceController, parseCleanPreview, resolveMoleScript, safeText, sizeBytes, MAINTENANCE_OPERATIONS };
