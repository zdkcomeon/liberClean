const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMoleUpdater } = require('../mole-update.js');

function harness(options = {}) {
  let environment = { ready: true, moPath: '/path with spaces/mo', moVersion: '1.61.0', home: '/Users/fixture' };
  const children = [], logs = [], killed = [], events = [];
  let restarted = 0, refreshes = 0;
  const controller = createMoleUpdater({
    getEnvironment: () => environment,
    assertAvailable: options.assertAvailable || (() => {}),
    beforeStart: () => {},
    afterFinish: () => { restarted++; },
    async refreshEnvironment() { refreshes++; return options.refresh ? options.refresh() : environment; },
    childEnv: extra => ({ PATH: '/fixture/bin', ...extra }),
    killGroup: child => killed.push(child),
    logEvent: (event, fields) => logs.push({ event, ...fields }),
    timeoutMs: options.timeoutMs,
    spawnProcess(command, args, processOptions) {
      if (options.spawnError) throw options.spawnError;
      const child = new EventEmitter();
      child.pid = 123;
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdout.setEncoding = child.stderr.setEncoding = () => {};
      child.stdin = new EventEmitter();
      child.input = [];
      child.stdin.write = value => child.input.push(value);
      Object.assign(child, { command, args, options: processOptions });
      children.push(child);
      return child;
    }
  });
  controller.subscribe(state => events.push(state));
  return {
    controller, children, logs, killed, events,
    get restarted() { return restarted; }, get refreshes() { return refreshes; },
    environment: value => { environment = { ...environment, ...value }; },
    output: text => children.at(-1).stdout.emit('data', text),
    async close(code = 0) { children.at(-1).emit('close', code, null); await new Promise(resolve => setImmediate(resolve)); return controller.getState(); }
  };
}

test('updates use the selected executable as argv and never a shell-interpolated path', async () => {
  const h = harness();
  const state = h.controller.start(), child = h.children[0];
  assert.equal(state.phase, 'checking');
  assert.equal(child.command, '/bin/bash');
  assert.equal(child.args.at(-2), '/path with spaces/mo');
  assert(!child.args[1].includes('/path with spaces'));
  assert(child.args[1].includes('stty -echo'));
  assert(child.args[1].includes('"$1" update'));
  assert.equal(child.options.env.HOMEBREW_NO_INSTALL_CLEANUP, '1');
  assert.equal(h.controller.start().id, state.id);
  assert.equal(h.children.length, 1);
  h.output('Already on latest version, 1.61.0\n');
  const result = await h.close();
  assert.equal(result.phase, 'succeeded');
  assert.match(result.message, /已是最新版本 1.61.0/);
  assert.equal(h.refreshes, 1);
  assert.equal(h.restarted, 1);
});

test('busy maintenance and missing installation never start an updater', () => {
  const busy = harness({ assertAvailable() { throw new Error('task busy'); } });
  assert.throws(() => busy.controller.start(), /task busy/);
  assert.equal(busy.children.length, 0);
  const missing = harness();
  missing.environment({ ready: false, error: 'not installed' });
  assert.throws(() => missing.controller.start(), /not installed/);
  assert.equal(missing.children.length, 0);
});

test('native progress is translated and a new version is verified after success', async () => {
  const h = harness();
  const initial = h.controller.start();
  h.output('Updating Homebrew...\r\n');
  assert.match(h.controller.getState().message, /Homebrew/);
  h.output('Upgrading Mole...\n');
  assert.match(h.controller.getState().message, /正在安装/);
  h.environment({ moVersion: '1.62.0' });
  h.output('Updated to latest version, 1.62.0\n');
  // The shell relays script's exit status before terminating its process group.
  h.output(`MOLE_UPDATE_EXIT_${initial.id}:0\n`);
  const result = await h.close(null);
  assert.equal(result.phase, 'succeeded');
  assert.equal(result.toVersion, '1.62.0');
  assert.equal(result.environment.moVersion, '1.62.0');
  assert(h.logs.some(log => log.event === 'mole_update.verification_finished' && log.ready));
});

test('zero exit without update evidence is not reported as up to date', async () => {
  const h = harness(); h.controller.start();
  h.output('Usage: mo update\n');
  const result = await h.close();
  assert.equal(result.phase, 'failed');
  assert.match(result.message, /未能确认更新结果/);
});

test('network failure is visible, sanitized and restartable', async () => {
  const h = harness(); h.controller.start();
  h.output('Unable to check for updates\nAuthorization: Bearer fixture-secret\nhttps://example.test/private/token\n');
  const result = await h.close(1);
  assert.equal(result.phase, 'failed');
  assert.match(result.message, /网络或权限/);
  assert(!JSON.stringify(h.logs).includes('fixture-secret'));
  assert(!JSON.stringify(h.logs).includes('example.test'));
  assert(!result.detail.includes('fixture-secret'));
  const retry = h.controller.start();
  assert.equal(retry.phase, 'checking');
  assert.notEqual(retry.id, result.id);
  await h.close(1);
});

test('managed installations and rejected permissions show actionable update errors', async () => {
  for (const [output, expected] of [['Mole was installed via Nix. Self-update is disabled.', /Nix/], ['Homebrew upgrade failed', /Homebrew/], ['Update aborted, admin access denied', /授权/]]) {
    const h = harness(); h.controller.start(); h.output(output);
    assert.match((await h.close(1)).message, expected);
  }
});

test('split password prompts produce one-use challenges without storing credentials', async () => {
  const h = harness(); h.controller.start();
  const marker = h.children[0].options.env.SUDO_PROMPT;
  h.output(marker.slice(0, 13)); h.output(marker.slice(13));
  const challenge = h.controller.getState();
  assert.equal(challenge.phase, 'authorizing');
  assert(challenge.promptToken);
  assert.throws(() => h.controller.authorize({ action: 'password', promptToken: 'forged', password: 'fixture-password' }));
  assert.throws(() => h.controller.authorize({ action: 'password', promptToken: challenge.promptToken, password: 'invalid\n' }));
  h.controller.authorize({ action: 'password', promptToken: challenge.promptToken, password: 'fixture-password' });
  assert.deepEqual(h.children[0].input, ['fixture-password\n']);
  assert.throws(() => h.controller.authorize({ action: 'password', promptToken: challenge.promptToken, password: 'fixture-password' }));
  h.output(`Sorry, try again.\n${marker}`);
  const retry = h.controller.getState();
  assert.notEqual(retry.promptToken, challenge.promptToken);
  assert.match(retry.message, /验证未通过/);
  h.controller.authorize({ action: 'password', promptToken: retry.promptToken, password: 'fixture-password-2' });
  h.output('Updated to latest version, 1.61.0\n');
  await h.close();
  assert(!JSON.stringify(h.logs).includes('fixture-password'));
  assert(!JSON.stringify(h.events).includes('fixture-password'));
});

test('cancelling authorization stops its process and rechecks the installation', async () => {
  const h = harness(); h.controller.start();
  h.output(h.children[0].options.env.SUDO_PROMPT);
  const state = h.controller.getState();
  h.controller.authorize({ action: 'cancel', promptToken: state.promptToken });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.killed.length, 1);
  assert.equal(h.controller.getState().phase, 'failed');
  assert.match(h.controller.getState().message, /取消/);
  assert.equal(h.refreshes, 1);
  assert.equal(h.restarted, 1);
});

test('a closed credential pipe fails promptly instead of waiting for an update timeout', async () => {
  const h = harness(); h.controller.start();
  h.output(h.children[0].options.env.SUDO_PROMPT);
  const state = h.controller.getState();
  h.children[0].stdin.destroyed = true;
  h.controller.authorize({ action: 'password', promptToken: state.promptToken, password: 'fixture-password' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.controller.getState().phase, 'failed');
  assert.match(h.controller.getState().message, /连接已中断/);
  assert(!JSON.stringify(h.logs).includes('fixture-password'));
});

test('an unavailable installation after the updater exits is an error', async () => {
  const h = harness(); h.controller.start();
  h.output('Updated to latest version\n');
  h.environment({ ready: false, moVersion: '' });
  assert.equal((await h.close()).phase, 'failed');
});

test('verification keeps the update exclusive and refresh errors are actionable', async () => {
  let resolve;
  const h = harness({ refresh: () => new Promise(value => { resolve = value; }) });
  const state = h.controller.start(); h.output('Already on latest version\n');
  h.children[0].emit('close', 0, null);
  assert.equal(h.controller.getState().phase, 'verifying');
  assert.equal(h.controller.start().id, state.id);
  assert.equal(h.children.length, 1);
  resolve({ ready: true, moPath: '/mo', moVersion: '1.61.0' });
  await new Promise(value => setImmediate(value));
  assert.equal(h.controller.busy(), false);
  const failed = harness({ refresh() { throw new Error('fixture detection failure'); } });
  failed.controller.start(); failed.output('Updated to latest version\n');
  assert.match((await failed.close()).message, /无法检测 Mole/);
  assert.equal(failed.restarted, 1);
});

test('spawn errors and repeated close notifications finish only once', async () => {
  const h = harness({ spawnError: new Error('fixture spawn failure') });
  h.controller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.controller.getState().phase, 'failed');
  assert.equal(h.restarted, 1);
  const duplicate = harness(); duplicate.controller.start();
  duplicate.children[0].emit('error', new Error('fixture error'));
  await duplicate.close(1);
  assert.equal(duplicate.refreshes, 1);
  assert.equal(duplicate.restarted, 1);
});

test('a timed out updater is stopped and releases its state', async () => {
  const h = harness({ timeoutMs: 20 }); h.controller.start();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(h.killed.length, 1);
  assert.equal(h.controller.getState().phase, 'failed');
  assert.match(h.controller.getState().message, /超时/);
  assert(h.logs.some(log => log.event === 'mole_update.timed_out'));
});
