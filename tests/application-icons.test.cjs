const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';

/** Exercise the real preload API, without reading local apps or running Mole. */
function harness(iconApi = {}, rows = [{ name: 'Figma', bundle_id: 'com.figma.Desktop', path: '/Applications/Figma.app', source: 'App', size: '316 MB' }]) {
  const logs = [];
  const fakeFs = {
    constants: fs.constants,
    statSync(target) {
      if (target.endsWith('plugin.log')) return { size: 0 };
      if (target !== '/fixture/bin/mo') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isFile: () => true };
    },
    accessSync() {}, mkdirSync() {},
    appendFileSync(target, entry) { logs.push(JSON.parse(entry)); }
  };
  const context = {
    require(name) {
      if (name === 'node:fs') return fakeFs;
      if (name === 'node:os') return { homedir: () => '/Users/fixture' };
      if (name === 'node:child_process') return {
        execFileSync: () => 'Mole version 1.61.0\n',
        spawn(command, args) {
          assert.equal(command, '/fixture/bin/mo');
          assert.deepEqual(Array.from(args), ['uninstall', '--list']);
          const child = new EventEmitter();
          child.stdout = new PassThrough(); child.stderr = new PassThrough();
          queueMicrotask(() => { child.stdout.end(JSON.stringify(rows)); child.stderr.end(); child.emit('close', 0); });
          return child;
        }
      };
      if (name.startsWith('./')) return require(path.resolve(__dirname, '..', name));
      return require(name);
    },
    process: { platform: 'darwin', env: { PATH: '/fixture/bin' }, on() {} },
    window: {},
    utools: { dbStorage: { getItem() {}, setItem() {}, removeItem() {} }, onPluginEnter() {}, onPluginOut() {}, ...iconApi },
    setTimeout, clearTimeout, setInterval, clearInterval, Buffer, console
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '..', 'preload.js'), 'utf8'), context, { filename: 'preload.js' });
  return { bridge: context.window.mole, logs };
}

test('icons load only on demand from the inventoried app path and share concurrent requests', async () => {
  const calls = [];
  const h = harness({ getFileIcon(target) { calls.push(target); return PNG; } });
  const inventory = await h.bridge.getApplications();
  assert.equal(calls.length, 0);
  const id = inventory.apps[0].id;
  assert.deepEqual(await Promise.all([h.bridge.getApplicationIcon(id), h.bridge.getApplicationIcon(id)]), [PNG, PNG]);
  assert.equal(await h.bridge.getApplicationIcon(id), PNG);
  assert.deepEqual(calls, ['/Applications/Figma.app']);
  const event = h.logs.find(log => log.event === 'apps.icon_loaded');
  assert.equal(event.id, id);
  assert.equal(event.path, '/Applications/Figma.app');
  assert.equal(typeof event.elapsedMs, 'number');
  assert.equal(JSON.stringify(h.logs).includes(PNG), false);
});

test('the asynchronous native icon API takes priority when available', async () => {
  let calls = 0;
  const h = harness({ getFileIconAsync: async target => { calls++; assert.equal(target, '/Applications/Figma.app'); return PNG; }, getFileIcon() { assert.fail('legacy API should not be called'); } });
  const { apps } = await h.bridge.getApplications();
  assert.deepEqual(await Promise.all([h.bridge.getApplicationIcon(apps[0].id), h.bridge.getApplicationIcon(apps[0].id)]), [PNG, PNG]);
  assert.equal(calls, 1);
});

test('unknown IDs and arbitrary paths never reach the native icon API', async () => {
  const h = harness({ getFileIcon() { assert.fail('unlisted paths must not be read'); } });
  assert.equal(await h.bridge.getApplicationIcon('/private/secret.app'), null);
  await h.bridge.getApplications();
  assert.equal(await h.bridge.getApplicationIcon('/Applications/Figma.app'), null);
  assert.equal(await h.bridge.getApplicationIcon('unknown'), null);
});

test('hosts without a native icon API keep application discovery available', async () => {
  const h = harness();
  const inventory = await h.bridge.getApplications();
  assert.equal(inventory.state, 'ready');
  assert.equal(await h.bridge.getApplicationIcon(inventory.apps[0].id), null);
});

test('failed, empty, malformed and remote icons fall back without repeated reads', async () => {
  for (const result of [new Error('missing application icon'), null, '', 'https://example.com/icon.png', 'data:image/png;base64,invalid!']) {
    let calls = 0;
    const h = harness({ getFileIconAsync: async () => { calls++; if (result instanceof Error) throw result; return result; } });
    const { apps } = await h.bridge.getApplications();
    assert.equal(await h.bridge.getApplicationIcon(apps[0].id), null);
    assert.equal(await h.bridge.getApplicationIcon(apps[0].id), null);
    assert.equal(calls, 1);
    assert.equal((await h.bridge.getApplications()).state, 'ready');
    assert.ok(h.logs.some(log => log.event === 'apps.icon_failed' && log.id === apps[0].id && typeof log.elapsedMs === 'number'));
  }
});

test('refreshing the inventory invalidates cached icons', async () => {
  let calls = 0;
  const h = harness({ getFileIcon: () => { calls++; return PNG; } });
  const { apps } = await h.bridge.getApplications();
  await h.bridge.getApplicationIcon(apps[0].id);
  await h.bridge.getApplications();
  await h.bridge.getApplicationIcon(apps[0].id);
  assert.equal(calls, 1);
  await h.bridge.getApplications(true);
  await h.bridge.getApplicationIcon(apps[0].id);
  assert.equal(calls, 2);
});

test('same-name app bundles resolve icons by their individual installation paths', async () => {
  const paths = ['/Applications/Figma.app', '/Users/fixture/Applications/Figma.app'];
  const calls = [];
  const h = harness({ getFileIcon: target => { calls.push(target); return PNG; } }, paths.map(target => ({ name: 'Figma', path: target })));
  const { apps } = await h.bridge.getApplications();
  assert.equal(apps[0].selectable, false);
  assert.equal(apps[1].selectable, false);
  await Promise.all(apps.map(app => h.bridge.getApplicationIcon(app.id)));
  assert.deepEqual(calls, paths);
});
