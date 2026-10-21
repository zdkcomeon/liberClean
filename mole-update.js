'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { safeText } = require('./maintenance.js');

const ACTIVE_PHASES = new Set(['checking', 'updating', 'authorizing', 'verifying']);
const SUCCESS_MESSAGE = /(?:already on (?:the )?latest|updated to (?:the )?latest|successfully updated|update complete|updated successfully)/i;

function failureMessage(output) {
  if (/installed via Nix|Nix-managed|Self-update is disabled/i.test(output)) return '当前 Mole 由 Nix 管理，请通过 Nix 更新后重新检测';
  if (/admin access denied|admin access cannot|authentication failure|permission denied|update aborted/i.test(output)) return 'Mole 更新未获授权，请检查安装目录权限后重试';
  if (/Homebrew upgrade failed/i.test(output)) return 'Homebrew 未能完成 Mole 更新，请检查下方说明后重试';
  return 'Mole 更新失败，请检查网络或权限后重试';
}

/** Runs the invoked installation's stable updater, without changing its install channel or owning its credentials. */
function createMoleUpdater(options) {
  const listeners = new Set();
  let state = { phase: 'idle', id: '', message: '', detail: '', fromVersion: '', toVersion: '', startedAt: null, endedAt: null, promptToken: '' };
  let runtime = null;
  const snapshot = () => JSON.parse(JSON.stringify(state));
  const busy = () => ACTIVE_PHASES.has(state.phase);
  const log = (event, fields = {}) => options.logEvent(`mole_update.${event}`, { id: state.id, elapsedMs: runtime ? Date.now() - runtime.startedAt : 0, ...fields });
  function publish(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      try { listener(snapshot()); } catch { /* A view cannot interrupt an update. */ }
    }
  }

  async function finish(current, code, signal, failure) {
    if (current.finished) return;
    current.finished = true;
    clearTimeout(current.timer);
    if (current.line.trim()) log('output', { text: safeText(current.line).slice(-1000) });
    publish({ phase: 'verifying', promptToken: '', message: '正在重新检查 Mole 安装与版本…' });
    log('verification_started', { code, signal: signal || '', fromVersion: state.fromVersion });
    let environment;
    try {
      environment = await options.refreshEnvironment();
      log('verification_finished', { ready: environment.ready, version: environment.moVersion, path: environment.moPath });
    } catch (error) {
      failure = failure || '更新后无法检测 Mole，请重新检测运行环境';
      log('verification_failed', { error: safeText(error.stack || error.message) });
    }
    const exitCode = current.exitCode ?? code;
    const confirmed = environment?.ready && (SUCCESS_MESSAGE.test(current.output) || environment.moVersion !== state.fromVersion);
    const succeeded = !failure && !current.cancelled && exitCode === 0 && confirmed;
    const message = current.cancelled ? '已取消本次更新，请重新检测安装状态'
      : failure || (exitCode !== 0 ? failureMessage(current.output)
        : !environment?.ready ? '更新后未检测到可用的 Mole，请检查安装路径'
          : !confirmed ? '命令已结束，但未能确认更新结果，请查看日志'
            : environment.moVersion === state.fromVersion ? `Mole 已是最新版本 ${environment.moVersion}` : `Mole 已更新至 ${environment.moVersion}`);
    const detail = succeeded ? '' : current.output.split('\n').filter(line => line.trim() && !line.includes(current.exitMarker) && !line.includes(current.passwordMarker)).slice(-3).map(line => safeText(line)).join(' / ').slice(-600);
    log(succeeded ? 'succeeded' : 'failed', { code: exitCode, fromVersion: state.fromVersion, toVersion: environment?.moVersion || '', cancelled: current.cancelled, message, detail });
    runtime = null;
    publish({ phase: succeeded ? 'succeeded' : 'failed', message, detail, toVersion: environment?.moVersion || '', endedAt: new Date().toISOString(), promptToken: '', ...(environment ? { environment } : {}) });
    options.afterFinish();
  }

  function append(current, chunk) {
    if (current.finished) return;
    // The PTY disables echo before invoking Mole. Password input is never copied into this buffer or a log.
    const text = String(chunk).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\r/g, '\n');
    current.output = `${current.output}${text}`.slice(-32000);
    const exit = new RegExp(`${current.exitMarker}:(\\d+)`).exec(current.output);
    if (exit) current.exitCode = Number(exit[1]);
    current.line += text;
    const lines = current.line.split('\n');
    current.line = lines.pop().slice(-4000);
    for (const line of lines) {
      if (line.trim() && !line.includes(current.exitMarker) && !line.includes(current.passwordMarker)) log('output', { text: safeText(line).slice(-1000) });
    }
    const authCount = current.output.split(current.passwordMarker).length - 1;
    if (authCount > current.authCount) {
      current.authCount = authCount;
      const promptToken = crypto.randomUUID();
      log('authorization_requested', { attempt: authCount });
      publish({ phase: 'authorizing', promptToken, message: authCount > 1 ? '密码验证未通过，请重新输入 Mac 登录密码' : '更新安装目录需要管理员权限，请输入 Mac 登录密码' });
    } else if (state.phase !== 'authorizing') {
      const output = current.output;
      const message = /(?:Installing update|Installing stable|Repairing Mole|Upgrading Mole)/i.test(output) ? '正在安装 Mole 更新…'
        : /Downloading/i.test(output) ? '正在下载 Mole 更新…'
          : /Updating Homebrew/i.test(output) ? '正在刷新 Homebrew 并检查 Mole 更新…' : '正在检查 Mole 最新版本…';
      if (message !== state.message) publish({ phase: 'updating', message });
    }
  }

  function start() {
    if (busy()) return snapshot();
    options.assertAvailable();
    const environment = options.getEnvironment();
    if (!environment?.ready) throw new Error(environment?.error || '尚未安装 Mole，请先安装后再更新');
    const id = crypto.randomUUID();
    const current = { startedAt: Date.now(), finished: false, cancelled: false, output: '', line: '', authCount: 0, child: null, exitCode: null, passwordMarker: `MOLE_UPDATE_PASSWORD_${id}:`, exitMarker: `MOLE_UPDATE_EXIT_${id}` };
    runtime = current;
    state = { phase: 'checking', id, message: '正在检查 Mole 最新版本…', detail: '', fromVersion: environment.moVersion, toVersion: '', startedAt: new Date().toISOString(), endedAt: null, promptToken: '' };
    log('requested', { path: environment.moPath, fromVersion: environment.moVersion, args: ['update'] });
    publish({});
    try {
      options.beforeStart();
      // bash supplies a real input pipe to macOS script. The fixed inner script disables echo and only executes argv.
      const wrapper = 'exec 3< <(cat); /usr/bin/script -q /dev/null /bin/sh -c \'stty -echo; exec "$@"\' mole "$1" update <&3; code=$?; printf "\\n%s:%s\\n" "$2" "$code"; kill 0';
      const child = (options.spawnProcess || spawn)('/bin/bash', ['-c', wrapper, 'mole-update', environment.moPath, current.exitMarker], {
        cwd: environment.home,
        env: options.childEnv({ SUDO_PROMPT: current.passwordMarker, LC_ALL: 'C', HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_ANALYTICS: '1' }),
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      current.child = child;
      log('process_started', { pid: child.pid, target: environment.moPath });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => append(current, chunk));
      child.stderr.on('data', chunk => append(current, chunk));
      child.stdin.on('error', error => {
        log('input_failed', { error: safeText(error.stack || error.message) });
        options.killGroup(child);
        void finish(current, null, null, '更新进程连接已中断，请重试');
      });
      child.on('error', error => {
        log('process_failed', { target: environment.moPath, error: safeText(error.stack || error.message) });
        void finish(current, null, null, '无法启动 Mole 更新，请检查命令路径与权限');
      });
      child.on('close', (code, signal) => { void finish(current, code, signal); });
      current.timer = setTimeout(() => {
        log('timed_out');
        options.killGroup(child);
        void finish(current, null, null, '更新等待超时，请检查网络后重试');
      }, options.timeoutMs || 15 * 60 * 1000);
      current.timer.unref?.();
    } catch (error) {
      log('process_failed', { target: environment.moPath, error: safeText(error.stack || error.message) });
      void finish(current, null, null, '无法启动 Mole 更新，请检查运行环境');
    }
    return snapshot();
  }

  function authorize(request) {
    if (!runtime || runtime.finished || state.phase !== 'authorizing' || !request?.promptToken || request.promptToken !== state.promptToken) throw new Error('认证步骤已变化，请等待页面更新');
    if (request.action === 'cancel') {
      runtime.cancelled = true;
      log('authorization_cancelled');
      options.killGroup(runtime.child);
      void finish(runtime, null, null);
      return snapshot();
    }
    const password = request.password;
    if (request.action !== 'password' || typeof password !== 'string' || !password || password.length > 256 || /[\u0000-\u001f\u007f]/.test(password)) throw new Error('请输入有效的 Mac 登录密码');
    log('authorization_submitted');
    publish({ phase: 'updating', promptToken: '', message: '正在验证管理员权限并继续更新…' });
    const current = runtime;
    try {
      if (current.child.stdin.destroyed || current.child.stdin.writable === false) throw new Error('update input is closed');
      current.child.stdin.write(`${password}\n`);
    } catch (error) {
      log('input_failed', { error: safeText(error.stack || error.message) });
      options.killGroup(current.child);
      void finish(current, null, null, '更新进程连接已中断，请重试');
    }
    return snapshot();
  }

  return {
    start, authorize, busy, getState: snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    shutdown() { if (runtime?.child) options.killGroup(runtime.child); }
  };
}

module.exports = { createMoleUpdater };
