const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const matched = '\x1b[34m✓\x1b[0m Matched 1 app(s):\r\n1. ToDesk  100 MB\r\n';
const plan = '\r\nFiles to be removed:\r\n✓ ToDesk , 100 MB\r\n  ✓ /Applications/ToDesk.app , 100 MB\r\n  ✓ ~/Library/Caches/com.fixture.ToDesk , 4 MB\r\n\r\nPersonal data kept:\r\n  · ~/Library/Application Support/ToDesk\r\n\r\n';
const review = '➤ Remove 1 app, 104 MB  \x1b[32mEnter\x1b[0m confirm, \x1b[90mESC\x1b[0m cancel: ';

/** Drive the real preload API with terminal output; never launch Mole or touch installed apps. */
function harness(t) {
  const logs = [], writes = [], children = [], intervals = new Set();
  const fakeFs = {
    constants: fs.constants,
    statSync(target) {
      if (target.endsWith('plugin.log')) return { size: 0 };
      if (target !== '/fixture/bin/mo') throw new Error('missing');
      return { isFile: () => true };
    },
    accessSync() {}, mkdirSync() {}, unlinkSync() {},
    readFileSync() { throw new Error('no recorded exit code'); },
    appendFileSync(_target, entry) { logs.push(JSON.parse(entry)); }
  };
  const context = {
    require(name) {
      if (name === 'node:fs') return fakeFs;
      if (name === 'node:os') return { homedir: () => '/Users/fixture', tmpdir: () => '/tmp' };
      if (name === 'node:child_process') return {
        execFileSync: () => 'Mole version 1.62.0\n',
        spawn(target, args) {
          const child = new EventEmitter();
          child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
          child.pid = 100 + children.length;
          child.closed = new Promise(resolve => { child.close = (code = 0, signal = null) => { child.emit('close', code, signal); resolve(); }; });
          if (target === '/fixture/bin/mo') {
            assert.deepEqual(Array.from(args), ['uninstall', '--list']);
            queueMicrotask(() => {
              child.stdout.end(JSON.stringify([{ name: 'ToDesk', bundle_id: 'com.fixture.ToDesk', path: '/Applications/ToDesk.app', source: 'App', size: '100 MB' }]));
              child.close();
            });
          } else {
            assert.equal(target, '/bin/bash');
            child.stdin.on('data', chunk => { writes.push(String(chunk)); if (String(chunk) === 'q') child.close(); });
            children.push(child);
          }
          return child;
        }
      };
      if (name.startsWith('./')) return require(path.resolve(__dirname, '..', name));
      return require(name);
    },
    process: {
      platform: 'darwin', env: { PATH: '/fixture/bin' }, on() {},
      kill(pid, signal) { queueMicrotask(() => children.find(child => child.pid === -pid)?.close(null, signal)); }
    },
    window: {}, utools: { dbStorage: { getItem() {} }, onPluginEnter() {}, onPluginOut() {} },
    setTimeout, clearTimeout,
    setInterval(fn, delay) { const timer = setInterval(fn, delay); intervals.add(timer); return timer; },
    clearInterval, Buffer, console
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '..', 'preload.js'), 'utf8'), context, { filename: 'preload.js' });
  t.after(() => { children.forEach(child => child.close()); intervals.forEach(clearInterval); });
  return {
    bridge: context.window.mole, logs, writes,
    get child() { return children.at(-1); },
    async start(mode = 'preview') {
      const inventory = await this.bridge.getApplications();
      return this.bridge.startTask({ operation: 'uninstall', mode, appIds: [inventory.apps[0].id] });
    }
  };
}

test('current Mole review without an initial confirmation completes a read-only preview', async t => {
  const h = harness(t), task = await h.start();
  h.child.stdout.write(matched + plan + review.slice(0, 40));
  assert.equal(h.bridge.getTask(task.id).uninstall.files, null);
  h.child.stdout.write(review.slice(40));
  const files = h.bridge.getTask(task.id).uninstall.files;
  assert.equal(files?.length, 3, 'The final review must be recognized without the removed y/N prompt');
  assert.equal(files[2].kind, 'kept');
  assert.equal(h.writes.length, 0, 'Read-only preview must never confirm removal');
  await h.child.closed;
  assert.equal(h.bridge.getTask(task.id).uninstall.phase, 'reviewed');
  assert.deepEqual(h.writes, ['q']);
  assert(h.logs.some(entry => entry.event === 'uninstall.plan_ready' && entry.id === task.id));
});

test('older Mole still receives its initial selection answer before the file review', async t => {
  const h = harness(t), task = await h.start();
  h.child.stdout.write(matched + 'Proceed with uninstallation? [y/N] ');
  assert.deepEqual(h.writes, ['y\n']);
  h.child.stdout.write(plan + review);
  await h.child.closed;
  assert.equal(h.bridge.getTask(task.id).uninstall.phase, 'reviewed');
  assert.deepEqual(h.writes, ['y\n', 'q']);
});

test('current Mole execution waits for a one-use confirmation after validating the reviewed paths', async t => {
  const h = harness(t), task = await h.start('execute');
  h.child.stdout.write(matched + plan + review);
  const flow = h.bridge.getTask(task.id).uninstall;
  assert.equal(flow.phase, 'confirm');
  assert.equal(flow.files.length, 3);
  assert.deepEqual(h.writes, []);
  assert.throws(() => h.bridge.uninstallAction(task.id, { action: 'confirm', promptToken: 'stale' }), /状态已变化/);
  await new Promise(resolve => setTimeout(resolve, 160));
  h.bridge.uninstallAction(task.id, { action: 'confirm', promptToken: flow.promptToken });
  assert.deepEqual(h.writes, ['\n']);
  assert.throws(() => h.bridge.uninstallAction(task.id, { action: 'confirm', promptToken: flow.promptToken }), /状态已变化/);
  h.child.stdout.write('\r\nUninstall complete\r\nRemoved 1 app, 104 MB\r\n');
  h.child.close();
  assert.equal(h.bridge.getTask(task.id).uninstall.outcome, 'complete');
});

for (const mismatch of ['count', 'path']) {
  test(`current Mole rejects a mismatched application ${mismatch} without sending confirmation`, { timeout: 2000 }, async t => {
    const h = harness(t), task = await h.start('execute');
    h.child.stdout.write((mismatch === 'count' ? matched.replace('Matched 1', 'Matched 2') : matched) + (mismatch === 'path' ? plan.replace('/Applications/ToDesk.app', '/Applications/Other.app') : plan) + review);
    await h.child.closed;
    assert.equal(h.bridge.getTask(task.id).uninstall.phase, 'failed');
    assert.deepEqual(h.writes, []);
  });
}
