const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMaintenanceController, parseCleanPreview, resolveMoleScript, safeText, sizeBytes } = require('../maintenance.js');

function harness(t, operation = 'installer') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mole-maintenance-test-')));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'lib', 'clean'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mo'), '# fixture entry');
  fs.writeFileSync(path.join(root, 'bin', 'installer.sh'), 'MOLE_TEST_MODE collect_installers() build_installer_delete_plan() execute_installer_delete_plan()');
  fs.writeFileSync(path.join(root, 'bin', 'clean.sh'), 'CLEAN_PREVIEW_FINAL_FILE= ensure_sudo_session_with_password BASH_SOURCE[0] main()');
  fs.writeFileSync(path.join(root, 'bin', 'optimize.sh'), '--dry-run MOLE_DRY_RUN show_optimization_summary main()');
  fs.writeFileSync(path.join(root, 'bin', 'purge.sh'), 'MOLE_SKIP_MAIN clean_project_artifacts main()');
  fs.writeFileSync(path.join(root, 'lib', 'clean', 'project.sh'), 'select_purge_categories confirm_purge_cleanup item_expected_parent_ids item_expected_target_ids item_paths item_sizes PURGE_SEARCH_PATHS');
  const environment = { moPath: path.join(root, 'mo'), moVersion: '1.61.0', home: root };
  const tasks = new Map(), runtimes = new Map(), logs = [], children = [], killed = [];
  const controller = createMaintenanceController({
    tasks, runtimes, getEnvironment: () => environment, childEnv: extra => extra, emitTask: () => {},
    logEvent: (event, fields) => logs.push({ event, ...fields }),
    killGroup: child => killed.push(child),
    finishTask(task, runtime, code, signal, failure) {
      runtime.finished = true;
      clearTimeout(runtime.killTimer);
      task.state = runtime.cancelRequested ? 'cancelled' : failure || code !== 0 ? 'failed' : 'succeeded';
      task.error = failure || ''; task.exitCode = code;
      runtimes.delete(task.id);
    },
    spawnProcess(command, args, options) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdout.setEncoding = child.stderr.setEncoding = () => {};
      child.input = [];
      child.stdin = new EventEmitter(); child.stdin.writable = true; child.stdin.write = value => child.input.push(value);
      child.command = command; child.args = args; child.options = options;
      children.push(child);
      return child;
    }
  });
  let next = 0;
  function start(mode = 'preview', extra = {}) {
    const request = { operation, mode, ...(operation === 'purge' && mode === 'preview' ? { path: root } : {}), ...extra };
    const context = controller.prepare(request);
    const task = { id: `task-${++next}`, operation, mode, state: 'running', createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), endedAt: null, error: '' };
    tasks.set(task.id, task);
    controller.start(task, context);
    const runtime = runtimes.get(task.id), child = children.at(-1);
    function event(...fields) { child.stdout.emit('data', `MOLE_GUI_${runtime.token}\t${JSON.stringify(fields)}\r\n`); }
    event('hello', '1', operation, mode);
    return { task, runtime, child, event, close: (code = 0) => child.emit('close', code, null) };
  }
  function item(session, index, target, identity = `identity-${index}`, size = '1024') {
    session.event('item', String(index), target, size, 'Downloads', '', identity, 'true');
  }
  function previewFiles(targets) {
    const session = start();
    targets.forEach((target, index) => item(session, index, target));
    session.event('inventory', String(targets.length), 'complete');
    session.close();
    assert.equal(session.task.maintenance.phase, 'reviewed');
    return session;
  }
  t.after(() => {
    for (const runtime of runtimes.values()) { clearInterval(runtime.watchdog); clearTimeout(runtime.killTimer); fs.rmSync(runtime.directory, { recursive: true, force: true }); }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, environment, tasks, runtimes, logs, children, killed, controller, start, item, previewFiles };
}

test('size parsing preserves unknown sizes and rejects unsafe numeric totals', () => {
  assert.equal(sizeBytes('1.5 GB'), 1.5 * 1024 ** 3);
  assert.equal(sizeBytes('32 B'), 32);
  assert.equal(sizeBytes('2 KiB'), 2048);
  assert.equal(sizeBytes('size unknown'), null);
  assert.equal(sizeBytes('1000 EB'), null);
});

test('clean preview uses explicit sections, actual paths and opaque IDs', () => {
  const items = parseCleanPreview('# Mole Cleanup Preview - test\n=== User Caches ===\n~/Library/Caches/a # b  # 1.5 GB\n/tmp/unknown  # size unknown\n', '/Users/example');
  assert.equal(items[0].path, '/Users/example/Library/Caches/a # b');
  assert.equal(items[0].size, 1.5 * 1024 ** 3);
  assert.equal(items[0].group, '用户缓存');
  assert.equal(items[1].size, null);
  assert.equal(items[0].selectable, false);
  assert.notEqual(items[0].id, items[1].id);
  assert.throws(() => parseCleanPreview('stale data', '/Users/example'));
  assert.throws(() => parseCleanPreview('# Mole Cleanup Preview\nrelative/path  # 2 MB', '/Users/example'));
});

test('credential and URL redaction applies to native progress messages', () => {
  const redacted = safeText('\x1b[31mAuthorization: Bearer secret-value\x1b[0m\nhttps://example.com/webhook/token');
  assert(!redacted.includes('secret-value'));
  assert(!redacted.includes('example.com'));
  assert(!safeText('password=hidden').includes('hidden'));
});

test('execution requires a completed preview of the same operation', t => {
  const h = harness(t);
  assert.throws(() => h.controller.prepare({ operation: 'installer', mode: 'execute', previewTaskId: 'forged', itemIds: ['forged'] }), /先完成/);
  assert.equal(h.children.length, 0);
});

test('file inventory is saved only after a complete handshake and successful exit', t => {
  const h = harness(t);
  const preview = h.previewFiles([path.join(h.root, 'one.dmg')]);
  assert.equal(preview.task.state, 'succeeded');
  assert.equal(preview.task.maintenance.items.length, 1);
  assert(!('identity' in preview.task.maintenance.items[0]));
  assert(h.logs.some(log => log.event === 'maintenance.preview_saved'));
});

test('forged, duplicated and stale item selections never spawn a process', t => {
  const h = harness(t);
  const preview = h.previewFiles([path.join(h.root, 'one.dmg')]);
  const id = preview.task.maintenance.items[0].id;
  for (const itemIds of [['forged'], [id, id], [], [23]]) assert.throws(() => h.controller.prepare({ operation: 'installer', mode: 'execute', previewTaskId: preview.task.id, itemIds }));
  h.environment.moVersion = '1.62.0';
  assert.throws(() => h.controller.prepare({ operation: 'installer', mode: 'execute', previewTaskId: preview.task.id, itemIds: [id] }), /已过期/);
  assert.equal(h.children.length, 1);
});

test('rescan matches server-owned identities despite changed inventory order', t => {
  const h = harness(t);
  const target = path.join(h.root, 'one.dmg');
  const preview = h.previewFiles([target]);
  const execution = h.start('execute', { previewTaskId: preview.task.id, itemIds: [preview.task.maintenance.items[0].id] });
  h.item(execution, 0, path.join(h.root, 'new.dmg'), 'new');
  h.item(execution, 1, target, 'identity-0');
  execution.event('inventory', '2', 'complete');
  assert.deepEqual(execution.child.input, ['select:1\n']);
  execution.event('confirm', '1', '1024', '0');
  assert.equal(execution.task.maintenance.phase, 'confirm');
  assert.equal(execution.runtime.confirmed, false);
});

test('changed file identity and changed installer size stop execution before selection', t => {
  for (const change of ['identity', 'size']) {
    const h = harness(t);
    const target = path.join(h.root, 'one.dmg');
    const preview = h.previewFiles([target]);
    const execution = h.start('execute', { previewTaskId: preview.task.id, itemIds: [preview.task.maintenance.items[0].id] });
    h.item(execution, 0, target, change === 'identity' ? 'replaced' : 'identity-0', change === 'size' ? '2048' : '1024');
    execution.event('inventory', '1', 'complete');
    assert.deepEqual(execution.child.input, []);
    assert.equal(execution.task.maintenance.phase, 'failed');
    assert.equal(h.killed.length, 1);
  }
});

test('confirmation tokens are required and cannot be replayed', t => {
  const h = harness(t);
  const preview = h.previewFiles([path.join(h.root, 'one.dmg')]);
  const execution = h.start('execute', { previewTaskId: preview.task.id, itemIds: [preview.task.maintenance.items[0].id] });
  h.item(execution, 0, path.join(h.root, 'one.dmg'));
  execution.event('inventory', '1', 'complete');
  execution.event('confirm', '1', '1024', '0');
  const token = execution.task.maintenance.promptToken;
  assert.throws(() => h.controller.action(execution.task.id, { action: 'confirm', promptToken: 'forged' }));
  h.controller.action(execution.task.id, { action: 'confirm', promptToken: token });
  assert.equal(execution.child.input.at(-1), 'confirm\n');
  assert.throws(() => h.controller.action(execution.task.id, { action: 'confirm', promptToken: token }));
});

test('passwords use the control pipe, never task state, output logs or process arguments', t => {
  const h = harness(t, 'clean');
  const preview = h.start();
  fs.writeFileSync(preview.runtime.previewFile, '# Mole Cleanup Preview\n/tmp/cache  # 2 MB\n');
  preview.close();
  const execution = h.start('execute', { previewTaskId: preview.task.id });
  execution.event('confirm', 'batch', '0', '0');
  h.controller.action(execution.task.id, { action: 'confirm', promptToken: execution.task.maintenance.promptToken });
  execution.event('executing');
  execution.event('auth', 'Admin', 'Password required');
  const token = execution.task.maintenance.promptToken;
  const secret = 'test-password-not-for-logging';
  h.controller.action(execution.task.id, { action: 'password', promptToken: token, password: secret });
  assert(execution.child.input.at(-1).includes(secret));
  assert(!JSON.stringify(h.logs).includes(secret));
  assert(!JSON.stringify(execution.task).includes(secret));
  assert(!JSON.stringify(execution.child.args).includes(secret));
  assert.throws(() => h.controller.action(execution.task.id, { action: 'password', promptToken: token, password: secret }));
  execution.event('auth_rejected', 'try again');
  execution.event('auth', 'Admin', 'Password required');
  assert.notEqual(execution.task.maintenance.promptToken, token);
  h.controller.action(execution.task.id, { action: 'skip', promptToken: execution.task.maintenance.promptToken });
  assert.equal(execution.child.input.at(-1), 'skip\n');
});

test('malformed and incomplete adapter messages fail closed', t => {
  const h = harness(t);
  const session = h.start();
  session.child.stdout.emit('data', `MOLE_GUI_${session.runtime.token}\t[invalid]\n`);
  assert.equal(session.task.maintenance.phase, 'failed');
  assert.equal(h.killed.length, 1);
  assert.deepEqual(session.child.input, []);
});

test('cancelled inspections do not become executable previews', t => {
  const h = harness(t);
  const session = h.start();
  session.runtime.cancelRequested = true;
  session.close(143);
  assert.equal(session.task.state, 'cancelled');
  assert.equal(session.task.maintenance.phase, 'cancelled');
  assert.throws(() => h.controller.prepare({ operation: 'installer', mode: 'execute', previewTaskId: session.task.id, itemIds: ['forged'] }));
});

test('partial file results distinguish removed files from retained files', t => {
  const h = harness(t);
  const first = path.join(h.root, 'one.dmg'), second = path.join(h.root, 'two.dmg');
  fs.writeFileSync(first, 'fixture'); fs.writeFileSync(second, 'fixture');
  const preview = h.previewFiles([first, second]);
  const execution = h.start('execute', { previewTaskId: preview.task.id, itemIds: preview.task.maintenance.items.map(item => item.id) });
  h.item(execution, 0, first); h.item(execution, 1, second);
  execution.event('inventory', '2', 'complete'); execution.event('confirm', '2', '2048', '0');
  h.controller.action(execution.task.id, { action: 'confirm', promptToken: execution.task.maintenance.promptToken });
  execution.event('executing');
  fs.unlinkSync(first);
  execution.close();
  assert.equal(execution.task.maintenance.outcome, 'partial');
  assert.deepEqual(execution.task.maintenance.summary, { selectedCount: 2, completedCount: 1, failedCount: 1 });
  assert.equal(execution.task.maintenance.items[0].status, 'removed');
  assert.equal(execution.task.maintenance.items[1].status, 'skipped');
});

test('project cleanup requires an existing directory and resolves home aliases and symlinks', t => {
  const h = harness(t, 'purge');
  for (const target of [undefined, '/', 'relative/project', path.join(h.root, 'missing'), h.environment.moPath, `${h.root}/bad\npath`]) {
    assert.throws(() => h.controller.prepare({ operation: 'purge', mode: 'preview', path: target }), /项目目录|绝对路径|控制字符/);
  }
  const project = path.join(h.root, 'project');
  fs.mkdirSync(project);
  fs.symlinkSync(project, path.join(h.root, 'project-link'));
  const context = h.controller.prepare({ operation: 'purge', mode: 'preview', path: '~/project-link' });
  assert.equal(context.scanPath, project);
  assert.equal(h.children.length, 0);
  assert(h.logs.some(log => log.event === 'maintenance.scan_path_failed' && log.requestId && log.stack));
});

test('project cleanup execution keeps the reviewed directory despite a different request path', t => {
  const h = harness(t, 'purge');
  const project = path.join(h.root, 'project "β" $(false)');
  fs.mkdirSync(project);
  const preview = h.start('preview', { path: project });
  h.item(preview, 0, path.join(project, 'node_modules'));
  preview.event('inventory', '1', 'complete');
  preview.close();
  assert.equal(preview.task.path, project);
  assert.equal(preview.task.maintenance.phase, 'reviewed');
  const execution = h.start('execute', { previewTaskId: preview.task.id, itemIds: [preview.task.maintenance.items[0].id], path: h.root });
  assert.equal(execution.task.path, project);
  assert.equal(execution.child.args.at(-1), project);
  assert(h.logs.some(log => log.event === 'maintenance.request_validated' && log.requestId === execution.runtime.context.requestId && log.scanPath === project));
  execution.close(1);
});

test('project cleanup rejects native inventory entries outside the selected directory', t => {
  const h = harness(t, 'purge');
  const preview = h.start();
  h.item(preview, 0, path.join(path.dirname(h.root), 'outside-project', 'node_modules'));
  preview.close();
  assert.equal(preview.task.maintenance.phase, 'failed');
  assert.match(preview.task.error, /超出所选目录/);
  assert.equal(preview.task.maintenance.items.length, 0);
});

test('empty purge results succeed only with an explicit no-candidates result', t => {
  const h = harness(t, 'purge');
  const empty = h.start(); empty.event('finished', '0', 'no_candidates'); empty.close();
  assert.equal(empty.task.maintenance.phase, 'reviewed');
  assert.equal(empty.task.maintenance.items.length, 0);
  const incomplete = h.start(); incomplete.close();
  assert.equal(incomplete.task.maintenance.phase, 'failed');
});

test('Mole installation probing is read-only and recognizes the installed component layout', () => {
  if (!fs.existsSync('/opt/homebrew/bin/mo')) return;
  for (const operation of ['clean', 'optimize', 'purge', 'installer']) {
    const native = resolveMoleScript({ moPath: '/opt/homebrew/bin/mo', moVersion: 'installed' }, operation);
    assert(native.script.endsWith(`/${operation}.sh`));
  }
});


test('expired previews require a new inspection', t => {
  const h = harness(t);
  const preview = h.previewFiles([path.join(h.root, 'one.dmg')]);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 31 * 60 * 1000);
  assert.throws(() => h.controller.prepare({ operation: 'installer', mode: 'execute', previewTaskId: preview.task.id, itemIds: [preview.task.maintenance.items[0].id] }), /已过期/);
});

test('failed native execution still reports already removed and preserved files', t => {
  const h = harness(t);
  const first = path.join(h.root, 'one.dmg'), second = path.join(h.root, 'two.dmg');
  fs.writeFileSync(first, 'fixture'); fs.writeFileSync(second, 'fixture');
  const preview = h.previewFiles([first, second]);
  const execution = h.start('execute', { previewTaskId: preview.task.id, itemIds: preview.task.maintenance.items.map(item => item.id) });
  h.item(execution, 0, first); h.item(execution, 1, second);
  execution.event('inventory', '2', 'complete'); execution.event('confirm', '2', '2048', '0');
  h.controller.action(execution.task.id, { action: 'confirm', promptToken: execution.task.maintenance.promptToken });
  execution.event('executing');
  fs.unlinkSync(first);
  execution.event('finished', '1', '1', '1');
  execution.close(1);
  assert.equal(execution.task.state, 'failed');
  assert.equal(execution.task.maintenance.outcome, 'partial');
  assert.deepEqual(execution.task.maintenance.summary, { selectedCount: 2, completedCount: 1, failedCount: 1 });
  assert(fs.existsSync(second));
});
