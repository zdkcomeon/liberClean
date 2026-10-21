const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** Executes the real bridge's detection against an in-memory filesystem, without invoking the installed Mole. */
function harness() {
  const files = new Map(), settings = new Map(), calls = [];
  const fakeFs = {
    constants: fs.constants,
    statSync(target) {
      if (target.endsWith('plugin.log')) return { size: 0 };
      if (!files.has(target)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isFile: () => true };
    },
    accessSync(target) { if (files.get(target)?.denied) throw new Error('permission denied'); },
    mkdirSync() {}, appendFileSync() {}
  };
  const context = {
    require(name) {
      if (name === 'node:fs') return fakeFs;
      if (name === 'node:os') return { homedir: () => '/Users/fixture' };
      if (name === 'node:child_process') return {
        execFileSync(target, args) {
          calls.push({ target, args });
          const file = files.get(target);
          if (!file || file.failure) throw new Error('command failed');
          return file.output || `Mole version ${file.version || '1.61.0'}\n`;
        },
        spawn() { throw new Error('tests must not spawn commands'); }
      };
      if (name.startsWith('./')) return require(path.resolve(__dirname, '..', name));
      return require(name);
    },
    process: { platform: 'darwin', env: { PATH: '/fixture/bin' }, on() {} },
    window: {},
    utools: {
      dbStorage: { getItem: key => settings.get(key), setItem: (key, value) => settings.set(key, value), removeItem: key => settings.delete(key) },
      onPluginEnter() {}, onPluginOut() {}
    },
    setTimeout, clearTimeout, setInterval, clearInterval, Buffer, console
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '..', 'preload.js'), 'utf8'), context, { filename: 'preload.js' });
  return { files, settings, calls, bridge: context.window.mole };
}

test('opening with no Mole installation returns an explicit missing state', async () => {
  const h = harness();
  const environment = await h.bridge.refreshEnvironment();
  assert.equal(environment.ready, false);
  assert.equal(environment.installation, 'missing');
  assert.match(environment.error, /请安装 Mole/);
  assert.equal(h.calls.length, 0);
});

test('a user-local Mole installation is detected outside the GUI process PATH', async () => {
  const h = harness(); h.files.set('/Users/fixture/.local/bin/mo', { version: '1.62.0' });
  const environment = await h.bridge.refreshEnvironment();
  assert.equal(environment.ready, true);
  assert.equal(environment.moPath, '/Users/fixture/.local/bin/mo');
  assert.equal(environment.moVersion, '1.62.0');
});

test('a non-executable or invalid command is reported as unavailable instead of missing', async () => {
  for (const file of [{ denied: true }, { failure: true }, { output: 'a different command' }]) {
    const h = harness(); h.files.set('/fixture/bin/mo', file);
    const environment = await h.bridge.refreshEnvironment();
    assert.equal(environment.ready, false);
    assert.equal(environment.installation, 'unavailable');
    assert.equal(environment.moPath, '/fixture/bin/mo');
  }
});

test('rechecking after installation or removal bypasses the previous environment cache', async () => {
  const h = harness();
  assert.equal((await h.bridge.refreshEnvironment()).ready, false);
  h.files.set('/opt/homebrew/bin/mo', { version: '1.61.0' });
  assert.equal((await h.bridge.getEnvironment()).ready, false);
  assert.equal((await h.bridge.refreshEnvironment()).ready, true);
  h.files.clear();
  assert.equal((await h.bridge.refreshEnvironment()).installation, 'missing');
});

test('concurrent installation checks share one version probe', async () => {
  const h = harness(); h.files.set('/fixture/bin/mo', { version: '1.61.0' });
  const [first, second] = await Promise.all([h.bridge.refreshEnvironment(), h.bridge.refreshEnvironment()]);
  assert.equal(first.moVersion, second.moVersion);
  assert.equal(h.calls.length, 1);
});
