import type { MoleBridge } from './api';
import type { Environment, InstalledApp, MaintenanceItem, MoleUpdate, Snapshot, StartTaskRequest, StatusState, Task } from './types';

/** Development-only fixtures. This bridge never reads or changes local files. */
export function createPreviewBridge(): MoleBridge {
  const scenario = new URLSearchParams(location.search).get('preview');
  const home = '/Users/demo';
  const gb = 1024 ** 3;
  const environment: Environment = { ready: scenario !== 'missing', installation: scenario === 'missing' ? 'missing' : 'ready', moPath: scenario === 'missing' ? '' : '/opt/homebrew/bin/mo', moVersion: scenario === 'missing' ? '' : '1.61.0', home, platform: 'darwin', pathSource: 'auto' };
  const snapshot: Snapshot = {
    host: 'My MacBook Pro', uptime: '3 天 8 小时', healthScore: 96,
    hardware: { model: 'MacBook Pro', cpuModel: 'Apple M4 Pro', totalRam: '24 GB', osVersion: 'macOS 15.6' },
    cpu: { usage: 12.4, logicalCpu: 12 }, memory: { total: 24 * gb, used: 10.8 * gb, usedPercent: 45 },
    disks: [{ mount: '/System/Volumes/Data', device: '/dev/disk3s5', used: 316.4 * gb, total: 494.4 * gb, usedPercent: 64 }],
    network: [{ name: 'Wi-Fi', rxRateMbs: 2.4, txRateMbs: 0.18 }],
    networkHistory: { rxHistory: [2, 3, 1, 4, 3, 5, 2, 3, 4, 6, 3, 2, 4, 5, 4, 7, 4, 5, 3, 4] },
    diskIo: { readRate: 3.6, writeRate: 1.2 }, batteries: [{ percent: 86, status: 'discharging' }], thermal: { cpuTemp: 42 }
  };
  const status = (): StatusState => environment.ready ? { state: 'live', snapshot, receivedAt: new Date().toISOString() } : { state: 'error', snapshot: null, receivedAt: null, error: '请先安装 Mole' };
  const names = ['Arc', 'Figma', 'Notion', 'Obsidian', 'Raycast', 'Slack', 'Spotify', 'Visual Studio Code', 'Warp', 'Zoom'];
  if (scenario === 'one') names.splice(1);
  if (scenario === 'many') {
    names.splice(0, names.length, ...Array.from({ length: 1000 }, (_, index) => `Workspace Tool ${String(index + 1).padStart(4, '0')}`));
  }
  if (scenario === 'stress') {
    names.splice(0, names.length, '🧑🏽‍💻 Developer Toolkit', 'IntelliJ IDEA Ultimate Edition 2026.3 — 项目开发与数据库管理工具', 'K', '影像调色与素材管理工作站', 'Visual Studio Code');
    snapshot.healthScore = undefined;
    snapshot.cpu = { usage: Number.NaN };
    snapshot.memory = { total: 128 * gb, used: 126 * gb, usedPercent: 98.4 };
    snapshot.network = null;
    snapshot.disks = [{ mount: '/System/Volumes/Data', device: '/dev/disk3s5', used: 7.8 * 1024 * gb, total: 8 * 1024 * gb, usedPercent: 97.5 }];
    snapshot.hardware = { model: 'Mac Studio — Design & Development Workstation', cpuModel: 'Apple M3 Ultra · 32 核中央处理器', totalRam: '128 GB', osVersion: 'macOS 15.6' };
  }
  const apps: InstalledApp[] = scenario === 'empty' ? [] : names.map((name, index) => ({ id: `preview-app-${index}`, name, bundleId: `com.example.app${index}`, path: `/Applications/${name}.app`, source: index % 3 === 0 ? 'Homebrew' : 'App', sizeLabel: `${[428, 316, 204, 185, 92, 368, 174, 512, 148, 256][index % 10]} MB`, selectable: true }));
  if (scenario === 'stress') {
    apps[0].sizeLabel = 'N/A';
    apps[1].selectable = false;
    apps[1].reason = '检测到多个同名副本，无法唯一识别。请先检查应用路径。';
  }
  let tasks: Task[] = [];
  let update: MoleUpdate = { phase: scenario === 'authorization' ? 'authorizing' : 'idle', id: 'preview-update', message: scenario === 'authorization' ? '这是权限窗口示例，请使用任意测试文字。' : '', detail: '', fromVersion: '1.61.0', toVersion: '', startedAt: null, endedAt: null, promptToken: 'preview-only' };
  const listeners = new Set<(task: Task) => void>();
  const publish = (task: Task) => {
    const next = structuredClone(task);
    tasks = [next, ...tasks.filter(item => item.id !== next.id)];
    listeners.forEach(listener => listener(next));
    return next;
  };
  const finish = (task: Task) => publish({ ...task, state: 'succeeded', endedAt: new Date().toISOString(), exitCode: 0 });

  function itemsFor(operation: StartTaskRequest['operation'], projectRoot = `${home}/Projects`): MaintenanceItem[] {
    if (scenario === 'empty') return [];
    const entries = operation === 'optimize'
      ? [['刷新 DNS 缓存', '', '网络服务', '刷新本机 DNS 解析缓存'], ['刷新 Finder 服务', '', '系统服务', '更新文件管理器缓存'], ['重建启动服务索引', '', '系统服务', '检查应用与文件的关联关系']]
      : operation === 'purge'
        ? [['node_modules', `${projectRoot}/website/node_modules`, '依赖目录', '上次修改于 90 天前'], ['.next', `${projectRoot}/dashboard/.next`, '构建产物', '可通过重新构建生成'], ['target', `${projectRoot}/order-service/target`, '构建产物', '可通过重新构建生成'], ['node_modules', `${projectRoot}/design-system/node_modules`, '依赖目录', '上次修改于 120 天前']]
        : operation === 'installer'
          ? [['Figma.dmg', `${home}/Downloads/Figma.dmg`, '磁盘映像', '已下载的安装文件'], ['Notion.dmg', `${home}/Downloads/Notion.dmg`, '磁盘映像', '已下载的安装文件'], ['Developer Tools Installer — macOS Apple Silicon Universal.pkg', `${home}/Downloads/Developer Tools Installer — macOS Apple Silicon Universal.pkg`, '安装包', '已下载的安装文件']]
          : [['应用缓存', `${home}/Library/Caches`, '缓存', '应用运行时生成的临时缓存'], ['系统日志', `${home}/Library/Logs`, '日志', '应用与系统的诊断记录'], ['浏览器缓存', `${home}/Library/Caches/Browser`, '缓存', '浏览器生成的缓存文件'], ['临时文件', `${home}/Library/TemporaryItems`, '临时文件', '不再使用的临时内容']];
    return entries.map(([title, path, group, detail], index) => ({ id: `preview-item-${index}`, title, path, group, detail, size: operation === 'optimize' ? null : [1.28, 0.64, 0.32, 0.18][index] * gb, selectable: operation === 'purge' || operation === 'installer', status: 'ready' }));
  }

  function startTask(request: StartTaskRequest): Task {
    const now = new Date().toISOString();
    const task: Task = { id: `preview-${crypto.randomUUID()}`, operation: request.operation, mode: request.mode, state: 'running', pty: false, createdAt: now, startedAt: now, endedAt: null, exitCode: null, error: '' };
    if (request.operation === 'analyze') task.path = request.path || home;
    else if (request.operation === 'uninstall') {
      task.apps = apps.filter(app => request.appIds?.includes(app.id));
      task.uninstall = { phase: 'preparing', files: [], notices: [], message: '正在生成示例检查清单…' };
    } else {
      const previous = tasks.find(item => item.id === request.previewTaskId);
      if (request.operation === 'purge') {
        task.path = request.mode === 'execute' ? previous?.path : request.path?.trim().replace(/^~(?=\/|$)/, home);
        if (!task.path) throw new Error('请先选择项目目录');
      }
      const items = request.mode === 'execute' ? previous?.maintenance?.items.filter(item => !request.itemIds || request.itemIds.includes(item.id)) || [] : itemsFor(request.operation, task.path);
      task.maintenance = { phase: 'preparing', kind: ['purge', 'installer'].includes(request.operation) ? 'files' : 'batch', items, steps: [], messages: [], selectedIds: request.itemIds || [], previewTaskId: request.previewTaskId || '', scanStatus: scenario === 'partial' ? 'partial' : 'complete', message: '正在生成示例检查清单…' };
    }
    publish(task);
    window.setTimeout(() => {
      if (tasks.find(item => item.id === task.id)?.state !== 'running') return;
      if (request.operation === 'analyze') {
        task.result = { path: task.path!, scanStatus: scenario === 'partial' ? 'partial' : 'complete', overview: false, totalSize: 98.4 * gb, totalFiles: 12486, largeFiles: [], entries: scenario === 'empty' ? [] : ['Library', 'Projects', 'Downloads', 'Documents', 'Pictures'].map((name, index) => ({ name, path: `${task.path}/${name}`, size: [42.6, 28.4, 14.8, 8.2, 4.4][index] * gb, isDir: true, scanStatus: 'complete' })) };
      } else if (task.uninstall) {
        task.uninstall = { phase: request.mode === 'execute' ? 'confirm' : 'reviewed', promptToken: 'preview-only', files: task.apps!.flatMap(app => [{ path: app.path, kind: 'app' as const, sizeLabel: app.sizeLabel }, { path: `${home}/Library/Caches/${app.bundleId}`, kind: 'related' as const, sizeLabel: '24 MB' }, { path: `${home}/Library/Application Support/${app.name}`, kind: 'kept' as const, sizeLabel: '156 MB' }]), notices: [], outcome: 'preview', message: '这是示例检查结果，不会访问或删除本机文件。' };
      } else if (task.maintenance) {
        task.maintenance = { ...task.maintenance, phase: request.mode === 'execute' ? 'confirm' : 'reviewed', promptToken: 'preview-only', outcome: 'preview', message: '示例检查已完成，可以查看清单和体验确认流程。' };
      }
      if (request.mode === 'execute') publish(task); else finish(task);
    }, 700);
    return task;
  }

  return {
    version: 1,
    getEnvironment: async () => ({ ...environment }), refreshEnvironment: async () => ({ ...environment }),
    getMoleUpdate: () => update,
    updateMole: () => (update = { ...update, phase: 'failed', message: '预览模式不会更新本机软件。' }),
    subscribeMoleUpdate: () => () => {}, authorizeMoleUpdate: () => (update = { ...update, phase: 'failed', promptToken: '', message: '权限窗口示例已关闭，没有调用本机软件。' }),
    getStatus: status,
    subscribeStatus(listener) {
      if (!environment.ready) { listener(status()); return () => {}; }
      if (scenario === 'stress') listener(status());
      else for (let index = 0; index < 24; index++) listener({ ...status(), receivedAt: new Date(Date.now() - (24 - index) * 1000).toISOString(), snapshot: { ...snapshot, cpu: { ...snapshot.cpu, usage: 12.4 + Math.sin(index * 0.7) * 6 }, memory: { ...snapshot.memory, usedPercent: 45 + Math.sin(index * 0.35) * 2 } } });
      listener(status());
      const timer = window.setInterval(() => listener(status()), 3000);
      return () => window.clearInterval(timer);
    },
    getTasks: () => tasks, getTask: id => tasks.find(task => task.id === id) || null, startTask,
    stopTask(id) {
      const task = tasks.find(item => item.id === id);
      if (!task) return null;
      return publish({ ...task, state: 'cancelled', endedAt: new Date().toISOString(), ...(task.maintenance ? { maintenance: { ...task.maintenance, phase: 'cancelled', message: '示例操作已停止。' } } : {}), ...(task.uninstall ? { uninstall: { ...task.uninstall, phase: 'cancelled', message: '示例操作已停止。' } } : {}) });
    },
    sendInput: () => false, attachTask: () => null, detachTask: () => {},
    subscribeTasks(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getApplications: async () => ({ state: 'ready', apps, updatedAt: new Date().toISOString() }),
    getApplicationIcon: async () => null,
    getHistory: async () => ({ sessions: scenario === 'empty' ? [] : [{ command: 'clean', runId: 'preview-session', startedAt: '2026-10-21 09:32', items: 24, size: '2.4 GB' }, { command: 'analyze', runId: 'preview-analysis', startedAt: '2026-10-20 16:18', items: 128, size: '98.4 GB' }], deletions: [] }),
    uninstallAction(id) {
      const task = tasks.find(item => item.id === id);
      if (!task?.uninstall) throw new Error('示例任务不存在');
      return finish({ ...task, uninstall: { ...task.uninstall, phase: 'completed', outcome: 'complete', message: '示例流程已完成，没有修改本机文件。' } });
    },
    maintenanceAction(id) {
      const task = tasks.find(item => item.id === id);
      if (!task?.maintenance) throw new Error('示例任务不存在');
      const items = task.maintenance.items.map(item => ({ ...item, status: 'removed' as const }));
      return finish({ ...task, maintenance: { ...task.maintenance, items, phase: 'completed', outcome: 'complete', message: '示例流程已完成，没有修改本机文件。', summary: { selectedCount: items.length, completedCount: items.length, failedCount: 0 } } });
    },
    pickDirectory: () => `${home}/Downloads`, chooseMoPath: async () => environment, clearMoPath: async () => environment,
    openExternal: () => {}, openLog: () => {}, getEnterAction: () => null, onEnter: () => () => {},
    getPaths: () => ({ logFile: `${home}/Library/Logs/LiberClean/plugin.log` })
  };
}
