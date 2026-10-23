const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createMaintenanceController } = require('../maintenance.js');

const installerFixture = `#!/bin/bash
MOLE_CURRENT_COMMAND=installer
collect_installers() {
  if [[ "\${MOLE_GUI_FIXTURE_SCAN_STATUS:-0}" != 0 ]]; then
    INSTALLER_PATHS=(); INSTALLER_SIZES=(); INSTALLER_SOURCES=()
    if [[ "$MOLE_GUI_FIXTURE_SCAN_STATUS" == 1 ]]; then echo '✓ Great! No installer files to clean'; return 1; fi
    INSTALLER_SCAN_FAILURE_PATH="$MOLE_GUI_FIXTURE_DIR/restricted"
    echo "find: $INSTALLER_SCAN_FAILURE_PATH: Permission denied" >&2
    return "$MOLE_GUI_FIXTURE_SCAN_STATUS"
  fi
  INSTALLER_PATHS=("$MOLE_GUI_FIXTURE_DIR/a \\\"β\\\" \\\\ sample.dmg" "$MOLE_GUI_FIXTURE_DIR/keep.dmg")
  INSTALLER_SIZES=(4 4)
  INSTALLER_SOURCES=(Downloads Downloads)
}
mole_deletion_identity() { /usr/bin/stat -f '%d:%i:%z' "$1"; }
build_installer_delete_plan() {
  INSTALLER_DELETE_PATHS=(); INSTALLER_DELETE_SIZES=(); INSTALLER_DELETE_IDENTITIES=()
  local i
  for i in "$@"; do
    INSTALLER_DELETE_PATHS+=("\${INSTALLER_PATHS[i]}")
    INSTALLER_DELETE_SIZES+=("\${INSTALLER_SIZES[i]}")
    INSTALLER_DELETE_IDENTITIES+=("$(mole_deletion_identity "\${INSTALLER_PATHS[i]}")")
  done
}
reset_installer_delete_results() { total_deleted=0; total_delete_failed=0; }
execute_installer_delete_plan() {
  local target
  for target in "\${INSTALLER_DELETE_PATHS[@]}"; do
    case "$target" in "$MOLE_GUI_FIXTURE_DIR"/*) /bin/rm -- "$target" ;; *) return 1 ;; esac
    total_deleted=$((total_deleted + 1))
  done
}
show_summary() { echo 'Installers cleaned'; }
main() { return 99; }
if [[ "\${MOLE_TEST_MODE:-0}" != 1 ]]; then main "$@"; fi
`;
const purgeFixture = `#!/bin/bash
source "$(dirname "\${BASH_SOURCE[0]}")/../lib/clean/project.sh"
main() {
  [[ "\${1:-}" != --dry-run ]] || export MOLE_DRY_RUN=1
  clean_project_artifacts
}
if [[ "\${MOLE_SKIP_MAIN:-0}" == 1 ]]; then return 0; fi
main "$@"
`;
const projectFixture = `PURGE_SEARCH_PATHS=("/outside-fixture-scope")
clean_project_artifacts() {
  [[ "\${PURGE_SEARCH_PATHS[0]}" == "$MOLE_GUI_FIXTURE_DIR" ]] || return 65
  local -a item_paths=("$MOLE_GUI_FIXTURE_DIR/a \\\"β\\\" \\\\ sample.dmg" "$MOLE_GUI_FIXTURE_DIR/keep.dmg")
  local -a item_sizes=(4 4) item_size_unknown_flags=(false false)
  local -a item_project_paths=(project-a project-b) item_age_labels=('30 days' '30 days') item_cloud_flags=(false false)
  local -a item_expected_parent_ids=(parent parent) item_expected_target_ids=(target-a target-b)
  PURGE_RUN_OUTCOME=completed
  if ! select_purge_categories; then PURGE_RUN_OUTCOME=cancelled; return 0; fi
  local -a selected_indices=()
  IFS=',' read -r -a selected_indices <<< "$PURGE_SELECTION_RESULT"
  confirm_purge_cleanup "\${#selected_indices[@]}" 4 0 0
  local i target
  for i in "\${selected_indices[@]}"; do
    target="\${item_paths[i]}"
    case "$target" in "$MOLE_GUI_FIXTURE_DIR"/*) /bin/rm -- "$target" ;; *) return 1 ;; esac
  done
}
`;
const cleanFixture = `#!/bin/bash
CLEAN_PREVIEW_FINAL_FILE=''
request_sudo_access_with_password() { [[ "$1" == fixture-password ]]; }
ensure_sudo_session_with_password() { request_sudo_access_with_password "$1"; }
main() {
  if [[ "\${1:-}" == --dry-run ]]; then
    printf '# Mole Cleanup Preview\\n=== User caches ===\\n%s  # 4 B\\n' "$MOLE_GUI_FIXTURE_DIR/keep.dmg" > "$CLEAN_PREVIEW_FINAL_FILE"
    echo '➤ User caches'; echo '✓ Preview available'
  else
    request_sudo_access
    printf complete > "$MOLE_GUI_FIXTURE_DIR/batch-completed"
    echo '➤ User caches'; echo '✓ Cache checked'; echo 'Cleanup complete'
  fi
  exit 0
}
if [[ "\${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
`;
const optimizeFixture = `#!/bin/bash
request_sudo_access_with_password() { [[ "$1" == fixture-password ]]; }
show_optimization_summary() { :; }
MOLE_OPTIMIZE_RESULT_ACTIONS=(); MOLE_OPTIMIZE_RESULT_OUTCOMES=()
MOLE_OPTIMIZE_TASK_OUTCOME=applied
optimize_catalog_health_name_for() { echo 'Finder Cache Refresh'; }
optimize_task_finish() {
  MOLE_OPTIMIZE_RESULT_ACTIONS+=("$1")
  MOLE_OPTIMIZE_RESULT_OUTCOMES+=("$MOLE_OPTIMIZE_TASK_OUTCOME")
  MOLE_OPTIMIZE_TASK_OUTCOME=''
}
main() {
  MOLE_OPTIMIZE_RESULT_ACTIONS=(); MOLE_OPTIMIZE_RESULT_OUTCOMES=()
  MOLE_OPTIMIZE_TASK_OUTCOME=applied
  if [[ "\${1:-}" == --dry-run ]]; then
    export MOLE_DRY_RUN=1
    echo '➤ Finder Cache Refresh'; echo '✓ Would refresh Finder'
    optimize_task_finish finder_refresh
    echo 'Dry Run Complete, No Changes Made'
  else
    [[ "\${MOLE_DRY_RUN:-0}" != 1 ]] || return 1
    request_sudo_access
    printf complete > "$MOLE_GUI_FIXTURE_DIR/batch-completed"
    echo '➤ Finder Cache Refresh'; echo '✓ Refreshed Finder'
    optimize_task_finish finder_refresh
    echo 'Optimization Complete'
  fi
}
main "$@"
`;

for (const [operation, scanStatus] of [['installer', 0], ['purge', 0], ['clean', 0], ['optimize', 0], ['installer', 1], ['installer', 4]]) {
  test(`native helper ${operation}: ${scanStatus ? `scan status ${scanStatus}` : 'preview, explicit confirmation and selected execution'}`, { skip: process.platform !== 'darwin', timeout: 20000 }, async t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mole-helper-integration-')));
    fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'lib', 'clean'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mo'), '# fixture');
    fs.writeFileSync(path.join(root, 'bin', `${operation}.sh`), { installer: installerFixture, purge: purgeFixture, clean: cleanFixture, optimize: optimizeFixture }[operation]);
    fs.writeFileSync(path.join(root, 'lib', 'clean', 'project.sh'), projectFixture);
    const first = path.join(root, 'a "β" \\ sample.dmg'), keep = path.join(root, 'keep.dmg');
    fs.writeFileSync(first, 'test'); fs.writeFileSync(keep, 'test');
    const tasks = new Map(), runtimes = new Map(), logs = [], output = [], waiters = [];
    const notify = () => { for (const resolve of waiters.splice(0)) resolve(); };
    const killGroup = child => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
    const controller = createMaintenanceController({ tasks, runtimes, getEnvironment: () => ({ moPath: path.join(root, 'mo'), moVersion: 'fixture' }), childEnv: extra => ({ ...process.env, ...extra, MOLE_GUI_FIXTURE_DIR: root, MOLE_GUI_FIXTURE_SCAN_STATUS: String(scanStatus) }), killGroup, logEvent: (event, fields) => logs.push({ event, ...fields }), emitTask: notify,
      spawnProcess(...args) { const child = spawn(...args); child.stdout.on('data', chunk => output.push(String(chunk))); return child; },
      finishTask(task, runtime, code, signal, failure) { runtime.finished = true; clearTimeout(runtime.killTimer); task.state = runtime.cancelRequested ? 'cancelled' : failure || code !== 0 ? 'failed' : 'succeeded'; task.error = failure; runtimes.delete(task.id); notify(); }
    });
    t.after(() => { for (const runtime of runtimes.values()) { clearInterval(runtime.watchdog); clearTimeout(runtime.killTimer); killGroup(runtime.child); fs.rmSync(runtime.directory, { recursive: true, force: true }); } fs.rmSync(root, { recursive: true, force: true }); });
    function start(mode, extra = {}) {
      const context = controller.prepare({ operation, mode, ...(operation === 'purge' && mode === 'preview' ? { path: root } : {}), ...extra });
      const task = { id: crypto.randomUUID(), operation, mode, state: 'running', createdAt: new Date().toISOString(), startedAt: new Date().toISOString() };
      tasks.set(task.id, task); controller.start(task, context); return task;
    }
    async function until(predicate, task) {
      const deadline = Date.now() + 15000;
      while (!predicate()) {
        if (task?.state === 'failed') assert.fail(`${task.error}\n${output.join('')}`);
        if (Date.now() > deadline) assert.fail(`Timed out: ${JSON.stringify(task?.maintenance)}\n${output.join('')}`);
        await Promise.race([new Promise(resolve => waiters.push(resolve)), new Promise(resolve => setTimeout(resolve, 30))]);
      }
    }
    const preview = start('preview');
    await until(() => preview.state !== 'running', preview);
    if (scanStatus) {
      assert.equal(preview.maintenance.phase, scanStatus === 1 ? 'reviewed' : 'failed', output.join(''));
      assert.equal(preview.maintenance.items.length, 0);
      if (scanStatus === 4) {
        assert.match(preview.maintenance.message, /安装包扫描失败.*restricted/);
        assert(preview.maintenance.messages.some(message => message.text.includes('Permission denied')));
      }
      assert(fs.existsSync(first)); assert(fs.existsSync(keep));
      return;
    }
    assert.equal(preview.maintenance.phase, 'reviewed', output.join(''));
    assert(fs.existsSync(first)); assert(fs.existsSync(keep));
    const fileMode = operation === 'installer' || operation === 'purge';
    const selected = preview.maintenance.items.find(item => item.path === first);
    if (fileMode) assert(selected, JSON.stringify(preview.maintenance.items));
    const execution = start('execute', { previewTaskId: preview.id, ...(fileMode ? { itemIds: [selected.id] } : {}) });
    await until(() => execution.maintenance?.phase === 'confirm', execution);
    assert(fs.existsSync(first)); assert(fs.existsSync(keep));
    assert(!fs.existsSync(path.join(root, 'batch-completed')));
    controller.action(execution.id, { action: 'confirm', promptToken: execution.maintenance.promptToken });
    if (!fileMode) {
      await until(() => execution.maintenance?.phase === 'authorizing', execution);
      assert(!fs.existsSync(path.join(root, 'batch-completed')));
      controller.action(execution.id, { action: 'password', promptToken: execution.maintenance.promptToken, password: 'fixture-password' });
    }
    await until(() => execution.state !== 'running', execution);
    assert.equal(execution.maintenance.outcome, 'complete', JSON.stringify(execution.maintenance));
    if (operation === 'optimize') {
      assert.equal(execution.maintenance.items[0].result, 'applied');
      assert.equal(execution.maintenance.resultCounts.applied, 1);
      assert.equal(execution.maintenance.resultCounts.unknown, 0);
    }
    assert(fs.existsSync(keep), 'Unselected fixture must be preserved');
    if (fileMode) assert(!fs.existsSync(first)); else assert(fs.existsSync(path.join(root, 'batch-completed')));
    assert(!JSON.stringify(logs).includes('fixture-password'));
    assert(!output.join('').includes('fixture-password'), 'Terminal echo must never expose passwords');
  });
}
