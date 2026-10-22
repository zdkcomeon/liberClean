import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUp, Battery, Boxes, Check, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Code2, Command, Cpu, Download, ExternalLink, File, Folder, HardDrive, History, Info,
  LayoutDashboard, Loader2, LockKeyhole, MemoryStick, Monitor, RefreshCw, Search, Settings2, ShieldCheck,
  Sparkles, Terminal as TerminalIcon, Trash2, TriangleAlert, WandSparkles, Wifi, X, type LucideIcon
} from 'lucide-react';
import { bytes, dateTime, duration, mole, percent, previewMode, rate, shortPath, type MoleBridge } from './api';
import logoUrl from '../logo.png';
import { MaintenancePage } from './MaintenancePage';
import { UninstallPage } from './UninstallPage';
import { MoleInstallationPrompt, MoleUpdatePanel, MoleUpdatePasswordDialog } from './MoleEnvironment';
import { PreviewControls } from './PreviewControls';
import {
  isActive, isUpdatingMole, stateLabels,
  type EnterAction, type Environment, type MaintenanceOperation, type MoleHistory, type Operation, type Page, type ScanReport,
  type Snapshot, type StatusState, type Task, type MoleUpdate
} from './types';

const operations: Record<Operation, { title: string; subtitle: string; icon: LucideIcon; color: string; description: string; impact: string; command: string }> = {
  analyze: { title: '磁盘分析', subtitle: '空间的去向，一目了然', icon: HardDrive, color: 'blue', description: '查看目录占用，逐层探索文件与文件夹。', impact: '只读取目录信息，不会修改文件。', command: 'mo analyze' },
  clean: { title: '深度清理', subtitle: '清掉积累，让空间回归', icon: Sparkles, color: 'blue', description: '清理应用缓存、日志与临时文件，并处理已卸载应用的残留。', impact: 'Mole 会清理符合规则的缓存和文件，可能清空废纸篓；部分文件会被永久删除。请先预览。', command: 'mo clean' },
  uninstall: { title: '应用卸载', subtitle: '告别应用，也告别残留', icon: Boxes, color: 'purple', description: '选择应用，先检查关联文件，再确认卸载。', impact: 'Mole 会退出正在运行的应用并移除你确认的内容；个人数据默认保留。先预览并在对话框中确认，才会执行卸载。', command: 'mo uninstall' },
  optimize: { title: '系统优化', subtitle: '为日常工作做一次维护', icon: WandSparkles, color: 'green', description: '刷新系统缓存与服务，执行适用的维护项目。', impact: '可能刷新 DNS、Finder 缓存和系统服务。需要管理员权限的步骤由 Mole 请求授权。', command: 'mo optimize' },
  purge: { title: '项目清理', subtitle: '给开发项目减一点负担', icon: Code2, color: 'orange', description: '查找并移除旧项目中的依赖目录与构建产物。', impact: '选中的依赖目录和构建产物会被永久删除，之后可能需要重新安装依赖或重新构建。', command: 'mo purge' },
  installer: { title: '安装包清理', subtitle: '安装完成，收拾一下', icon: Download, color: 'pink', description: '查找用过的安装包，勾选并确认需要清理的文件。', impact: '选中的安装包会被永久删除。请先检查文件清单，再确认所选内容。', command: 'mo installer' }
};

const nav: { page: Page; label: string; icon: LucideIcon; group: string }[] = [
  { page: 'overview', label: '系统概览', icon: LayoutDashboard, group: '概览' },
  { page: 'analyze', label: '磁盘分析', icon: HardDrive, group: '概览' },
  ...(['clean', 'uninstall', 'optimize', 'purge', 'installer'] as Operation[]).map(page => ({ page, label: operations[page].title, icon: operations[page].icon, group: '维护工具' })),
  { page: 'history', label: '操作记录', icon: History, group: '更多' },
  { page: 'settings', label: '环境设置', icon: Settings2, group: '更多' }
];

const enterPages: Record<string, Page> = {
  'mole-overview': 'overview',
  'mole-analyze': 'analyze',
  'mole-clean': 'clean',
  'mole-uninstall': 'uninstall',
  'mole-optimize': 'optimize',
  'mole-purge': 'purge',
  'mole-installer': 'installer',
  'mole-history': 'history'
};

const pageFromHash = (): Page => {
  const value = location.hash.slice(1);
  return nav.some(item => item.page === value) ? value as Page : 'overview';
};

type Point = { time: string; cpu?: number; memory?: number };

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [environment, setEnvironment] = useState<Environment>();
  const [environmentError, setEnvironmentError] = useState('');
  const [moleUpdate, setMoleUpdate] = useState<MoleUpdate | undefined>(() => mole?.getMoleUpdate?.());
  const [status, setStatus] = useState<StatusState>({ state: 'starting', snapshot: null, receivedAt: null });
  const [trend, setTrend] = useState<Point[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const content = useRef<HTMLElement>(null);
  const active = tasks.find(isActive);
  const updating = isUpdatingMole(moleUpdate);
  const snapshot = status.snapshot;

  const navigate = useCallback((next: Page) => {
    if (location.hash !== `#${next}`) location.hash = next;
    setPage(next);
  }, []);

  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [page]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      document.documentElement.dataset.inputMethod = 'keyboard';
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey || event.repeat || !/^[1-9]$/.test(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable], [role="dialog"]') || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      navigate(nav[Number(event.key) - 1].page);
      content.current?.focus({ preventScroll: true });
    };
    const onPointerDown = () => { document.documentElement.dataset.inputMethod = 'pointer'; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('pointerdown', onPointerDown); };
  }, [navigate]);

  const applyStatus = useCallback((next: StatusState) => {
    setStatus(next);
    if (next.state !== 'live' || !next.receivedAt) return;
    setTrend(previous => {
      if (previous.at(-1)?.time === next.receivedAt) return previous;
      return [...previous.slice(-59), {
        time: next.receivedAt!,
        cpu: next.snapshot?.cpu?.usage,
        memory: next.snapshot?.memory?.usedPercent
      }];
    });
  }, []);

  useEffect(() => {
    if (!mole) return;
    let disposed = false;
    mole.refreshEnvironment().then(value => {
      if (!disposed) setEnvironment(value);
    }).catch(error => {
      if (!disposed) setEnvironmentError((error as Error).message);
    });
    const unsubscribe = mole.subscribeStatus(applyStatus);
    const unsubscribeTasks = mole.subscribeTasks(task => {
      setTasks(previous => [task, ...previous.filter(item => item.id !== task.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });
    const unsubscribeUpdate = mole.subscribeMoleUpdate?.(value => {
      if (disposed) return;
      setMoleUpdate(value);
      if (value.environment) { setEnvironment(value.environment); setEnvironmentError(''); }
    });
    setTasks(mole.getTasks());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeTasks();
      unsubscribeUpdate?.();
      clearInterval(timer);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [applyStatus]);

  useEffect(() => {
    if (!mole) return;
    return mole.onEnter((action: EnterAction) => {
      const next = enterPages[action?.code];
      if (next) navigate(next);
      void refreshEnvironment().catch(() => {});
    });
  }, [navigate]);

  const refreshEnvironment = useCallback(async () => {
    if (!mole) return;
    setEnvironmentError('');
    try {
      const next = await mole.refreshEnvironment();
      setEnvironment(next);
      return next;
    } catch (error) {
      setEnvironmentError((error as Error).message);
      throw error;
    }
  }, []);

  const updateMole = useCallback(() => {
    if (!mole?.updateMole) return;
    setError('');
    try { setMoleUpdate(mole.updateMole()); }
    catch (error) { setError((error as Error).message); }
  }, []);

  const startTask = useCallback((request: Parameters<MoleBridge['startTask']>[0]) => {
    if (!mole) return;
    setError('');
    try {
      const task = mole.startTask(request);
      setTasks(previous => [task, ...previous.filter(item => item.id !== task.id)]);
      if (request.operation !== 'analyze') navigate(request.operation);
    } catch (error) {
      setError((error as Error).message);
    }
  }, [navigate]);

  const stopTask = useCallback((task: Task) => {
    if (!mole) return;
    try {
      const next = mole.stopTask(task.id);
      if (next) setTasks(previous => previous.map(item => item.id === next.id ? next : item));
    } catch (error) {
      setError((error as Error).message);
    }
  }, []);

  if (!mole) {
    return <div className="plugin-fallback">
      <div className="fallback-card">
        <div className="brand-mark"><img src={logoUrl} alt="" /></div>
        <h1>请在 uTools 中打开 LiberClean</h1>
        <p>LiberClean 通过 uTools 调用本机 Mole。安装插件后，在 uTools 中搜索 LiberClean 即可使用。</p>
      </div>
    </div>;
  }

  const operation = page in operations ? page as Operation : undefined;
  const pageTask = operation ? tasks.find(task => task.operation === operation) : undefined;

  return <div className="app-shell plugin-shell">
    <a className="skip-link" href="#page-content" onClick={event => { event.preventDefault(); content.current?.focus(); }}>跳到主要内容</a>
    <header className="app-header">
      <div className="topbar">
        <div className="header-brand">
          <a className="brand" href="#overview" aria-label="LiberClean 系统概览" onClick={event => { event.preventDefault(); navigate('overview'); }}>
            <div className="brand-mark"><img src={logoUrl} alt="" /></div><span>LiberClean</span>
          </a>
          <span className={`header-caption ${previewMode ? 'preview-label' : ''}`}>{previewMode ? <><span className="preview-label-full">预览模式 · </span>示例数据</> : '让 Mac 保持轻盈'}</span>
        </div>
        <div className="topbar-right">
          <button className="machine-button" title={snapshot?.host || '查看本机环境设置'} onClick={() => navigate('settings')}>
            <span className={`connection-dot ${environment?.ready && !updating ? 'online' : ''}`} /><span>{updating ? 'Mole 更新中' : environment?.ready ? 'Mole 已就绪' : '检查运行环境'}</span>
          </button>
          <Navigation page={page} navigate={navigate} utility />
        </div>
      </div>
      <Navigation page={page} activeOperation={active?.operation} navigate={navigate} />
    </header>
    <div className="main-shell">
      <main ref={content} id="page-content" tabIndex={-1} aria-label={nav.find(item => item.page === page)?.label} className={`page-content page-${page}`}>
        {error && <Notice tone="warning">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}><X size={15} /></button></Notice>}
        {environmentError && <Notice tone="warning">{environmentError}</Notice>}
        {environment && !environment.ready && !updating && <MoleInstallationPrompt environment={environment} onRefresh={refreshEnvironment} onEnvironment={setEnvironment} />}
        {updating && page !== 'settings' && <div className="active-banner"><Loader2 size={16} className="spin" /><span>{moleUpdate?.message}</span><button onClick={() => navigate('settings')}>查看更新 <ArrowRight size={14} /></button></div>}
        {active && (page === 'overview' || page !== active.operation) && <div className="active-banner">
          <Loader2 size={16} className="spin" /><span>{operations[active.operation].title} · {stateLabels[active.state]}</span>
          <button onClick={() => navigate(active.operation)}>回到任务 <ArrowRight size={14} /></button>
        </div>}
        {page === 'overview' && environment?.ready && <Overview status={status} trend={trend} tasks={tasks} navigate={navigate} openTask={task => navigate(task.operation)} />}
        {page === 'overview' && !environment && !environmentError && <div className="overview-loading" role="status" aria-busy="true"><div className="skeleton skeleton-device" /><div className="metric-grid">{[0, 1, 2].map(index => <div className="skeleton skeleton-metric" key={index} />)}</div><div className="skeleton skeleton-storage" /><span><Loader2 size={15} className="spin" />正在连接本机，读取设备状态…</span></div>}
        {page === 'analyze' && <AnalyzePage task={pageTask} environment={environment} busy={updating || !!active && active.operation !== 'analyze'} onStart={startTask} onStop={stopTask} now={now} />}
        {page === 'uninstall' && <UninstallPage ready={!!environment?.ready && !updating} task={pageTask} active={active} onTask={task => setTasks(previous => [task, ...previous.filter(item => item.id !== task.id)])} onCancel={() => pageTask && stopTask(pageTask)} />}
        {operation && operation !== 'analyze' && operation !== 'uninstall' && <MaintenancePage key={operation} operation={operation as MaintenanceOperation} tool={operations[operation]} task={pageTask} ready={!!environment?.ready && !updating} home={environment?.home} busy={updating || !!active && active.operation !== operation} now={now} onStart={startTask} onStop={stopTask} onTask={task => setTasks(previous => [task, ...previous.filter(item => item.id !== task.id)])} />}
        {page === 'history' && <HistoryPage />}
        {page === 'settings' && <SettingsPage environment={environment} environmentError={environmentError} onRefresh={refreshEnvironment} onEnvironment={setEnvironment} update={moleUpdate} taskBusy={!!active} onUpdate={updateMole} />}
      </main>
      <footer className="page-footer">
        <span><span className={`connection-dot ${status.state === 'live' ? 'online' : ''}`} />{status.state === 'live' ? '本机数据已连接' : status.state === 'starting' ? '正在读取系统状态' : '系统状态暂不可用'}<a className="footer-version" href="https://github.com/tw93/Mole" target="_blank" rel="noreferrer" title="Mole 开源项目">Mole {environment?.moVersion || '—'}<ExternalLink size={10} /></a></span>
        <span>{previewMode ? '示例操作不会修改本机文件' : updating ? 'Mole 更新中，请等待完成' : active ? `${operations[active.operation].title}正在运行` : '本机处理 · 确认后执行'}</span>
      </footer>
    </div>
    {moleUpdate?.phase === 'authorizing' && <MoleUpdatePasswordDialog update={moleUpdate} onUpdate={setMoleUpdate} />}
    {previewMode && <PreviewControls />}
  </div>;
}

function Navigation({ page, activeOperation, navigate, utility = false }: { page: Page; activeOperation?: Operation; navigate: (page: Page) => void; utility?: boolean }) {
  const current = useRef<HTMLAnchorElement>(null);

  useEffect(() => { current.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [page]);

  return <nav className={utility ? 'utility-nav' : 'top-nav'} aria-label={utility ? '辅助导航' : '主导航'}>
    {nav.filter(item => (item.group === '更多') === utility).map(item => <a key={item.page} ref={page === item.page ? current : undefined} href={`#${item.page}`} title={`${item.label} · ⌘ / Ctrl ${nav.indexOf(item) + 1}`} aria-label={item.label} aria-keyshortcuts={`Meta+${nav.indexOf(item) + 1} Control+${nav.indexOf(item) + 1}`} aria-current={page === item.page ? 'page' : undefined} className={`top-nav-item ${page === item.page ? 'active' : ''}`} onClick={event => { event.preventDefault(); navigate(item.page); }}>
      <item.icon size={15} strokeWidth={1.8} /><span>{item.label}</span>
      {item.page === activeOperation && <span className="nav-task-dot" aria-label="任务运行中" />}
    </a>)}
  </nav>;
}

function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  return <div className={`notice ${tone}`} role="status">{tone === 'warning' ? <TriangleAlert size={17} /> : <Info size={17} />}<div>{children}</div></div>;
}

function PageTitle({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{children}</div>;
}

function StateBadge({ task }: { task: Task }) {
  return <span className={`state-badge state-${task.state}`}>{isActive(task) && <Loader2 size={12} className="spin" />}{stateLabels[task.state]}</span>;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="sparkline empty" />;
  const max = Math.max(100, ...values);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${30 - (Math.max(0, value) / max) * 28}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" /></svg>;
}

function Overview({ status, trend, tasks, navigate, openTask }: {
  status: StatusState; trend: Point[]; tasks: Task[];
  navigate: (page: Page) => void; openTask: (task: Task) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const snapshot: Snapshot | null = status.snapshot;
  const fresh = status.state === 'live' && !!status.receivedAt && Date.now() - new Date(status.receivedAt).getTime() < 15000;
  const disk = snapshot?.disks?.find(item => item.mount === '/System/Volumes/Data') || snapshot?.disks?.find(item => item.mount === '/') || snapshot?.disks?.[0];
  const free = disk ? disk.total - disk.used : undefined;
  const networks = snapshot?.network;
  const down = networks?.length && networks.every(item => item.rxRateMbs != null) ? networks.reduce((sum, item) => sum + item.rxRateMbs!, 0) : undefined;
  const up = networks?.length && networks.every(item => item.txRateMbs != null) ? networks.reduce((sum, item) => sum + item.txRateMbs!, 0) : undefined;
  const cpuTrend = trend.map(point => point.cpu).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const memoryTrend = trend.map(point => point.memory).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const battery = snapshot?.batteries?.[0];
  const usage = disk ? Math.min(100, Math.max(0, disk.usedPercent)) : undefined;
  const health = snapshot?.healthScore != null && Number.isFinite(snapshot.healthScore) ? snapshot.healthScore : undefined;
  const healthTone = health == null ? 'pending' : health >= 80 ? 'good' : 'attention';

  return <>
    {status.state === 'error' && <Notice tone="warning">{status.error || '监控暂不可用'}{snapshot && '。当前展示最近一次采集结果。'}</Notice>}
    <section className="overview-hero" aria-label="设备概况">
      <div className="device-mark"><Monitor size={28} strokeWidth={1.5} /><span className={`device-status ${fresh ? 'connected' : ''}`} /></div>
      <div className="hero-copy">
        <div className="device-heading"><h1>{snapshot?.hardware?.model || '我的 Mac'}</h1><span className={`live-pill ${fresh ? '' : 'muted'}`}><span className="live-dot" />{fresh ? '实时更新' : status.state === 'starting' ? '正在连接' : '等待更新'}</span></div>
        <div className="hardware-line"><span>{snapshot?.hardware?.cpuModel || '等待硬件信息'}</span><i /><span>{snapshot?.hardware?.totalRam || (snapshot?.memory?.total ? bytes(snapshot.memory.total) : '—')} 内存</span></div>
        <div className="hero-bottom"><span>{snapshot?.hardware?.osVersion || 'macOS'}</span><span>已运行 {snapshot?.uptime || '—'}</span><button className="device-details-toggle" aria-expanded={detailsOpen} aria-controls="system-information" onClick={() => setDetailsOpen(previous => !previous)}>更多信息<ChevronDown size={12} /></button></div>
      </div>
      <div className={`health-summary ${healthTone}`}><div className="health-ring" style={{ background: `conic-gradient(var(--health-color) ${Math.max(0, Math.min(100, health ?? 0))}%, var(--surface-subtle) 0)` }}><div className="health-number">{health ?? '—'}<small>健康评分</small></div></div><p>{health == null ? '等待采集' : health >= 80 ? <><ShieldCheck size={12} />状态良好</> : <><TriangleAlert size={12} />建议检查</>}</p></div>
      <div id="system-information" className="device-grid" hidden={!detailsOpen}>
        <div className="device-row"><span>磁盘读取</span><strong>{rate(snapshot?.diskIo?.readRate)}</strong></div>
        <div className="device-row"><span>磁盘写入</span><strong>{rate(snapshot?.diskIo?.writeRate)}</strong></div>
        <div className="device-row"><span><Battery size={13} /> 电池电量</span><strong>{battery?.percent == null ? '暂不可用' : `${battery.percent}%`}</strong></div>
        <div className="device-row"><span><Cpu size={13} /> CPU 温度</span><strong>{snapshot?.thermal?.cpuTemp ? `${snapshot.thermal.cpuTemp.toFixed(0)} °C` : '暂不可用'}</strong></div>
      </div>
    </section>
    <section className="metric-grid" aria-label="实时系统指标">
      <div className="metric-card cpu-metric"><div className="metric-title"><span><Cpu size={14} /> CPU</span><span className="metric-context">使用率</span></div><div className="metric-value">{percent(snapshot?.cpu?.usage)}</div><div className="metric-detail">{snapshot?.cpu?.logicalCpu ? `${snapshot.cpu.logicalCpu} 个逻辑核心` : '等待采集'}</div><Sparkline values={cpuTrend} color="var(--accent)" /></div>
      <div className="metric-card memory-metric"><div className="metric-title"><span><MemoryStick size={14} /> 内存</span><span className="metric-context">已使用</span></div><div className="metric-value">{percent(snapshot?.memory?.usedPercent)}</div><div className="metric-detail">{bytes(snapshot?.memory?.used)} / {bytes(snapshot?.memory?.total)}</div><Sparkline values={memoryTrend} color="var(--purple)" /></div>
      <div className="metric-card"><div className="metric-title"><span><Wifi size={14} /> 网络</span><span className="metric-context">实时速率</span></div><div className="network-metric"><ArrowDown size={14} aria-label="下载" /><strong>{rate(down)}</strong></div><div className="network-upload"><ArrowUp size={12} aria-label="上传" /> {rate(up)}</div><div className="network-bars" aria-hidden="true">{down != null && Number.isFinite(down) && snapshot?.networkHistory?.rxHistory?.slice(-20).filter(Number.isFinite).map((value, index, all) => <i key={index} style={{ height: `${Math.max(3, value / Math.max(1, ...all) * 18)}px` }} />)}</div></div>
    </section>
    <section className={`card storage-card ${usage != null && usage >= 90 ? 'storage-low' : ''}`}>
      <div className="section-heading"><h2><HardDrive size={15} /> 存储空间 <small>{disk?.mount === '/System/Volumes/Data' || disk?.mount === '/' ? 'Macintosh HD' : disk?.mount || '本机磁盘'}</small></h2><button className="text-button" onClick={() => navigate('analyze')}>分析磁盘 <ArrowRight size={14} /></button></div>
      <div className="storage-overview"><div><strong>{bytes(free)}</strong><span>可用空间</span></div><span>{usage == null ? '等待磁盘信息' : `已使用 ${usage.toFixed(0)}%`}</span></div>
      <div className="storage-meter" role="meter" aria-label="磁盘已用空间" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage} aria-valuetext={usage == null ? '等待采集' : `已使用 ${usage.toFixed(1)}%`}><span style={{ transform: `scaleX(${(usage || 0) / 100})` }} /></div>
      <div className="storage-caption"><span><i />已使用 {bytes(disk?.used)}</span><span>总容量 {bytes(disk?.total)}</span></div>
    </section>
    {tasks.length > 0 && <section className="card recent-card">
      <div className="section-heading"><h2>本次任务</h2><button className="text-button" onClick={() => navigate('history')}>操作记录 <ArrowRight size={14} /></button></div>
      {tasks.slice(0, 2).map(task => <button className="recent-row" key={task.id} onClick={() => openTask(task)}>
        <div className="recent-icon"><TerminalIcon size={15} /></div>
        <div><strong>{operations[task.operation].title}</strong><span>{task.mode === 'preview' ? '预览' : task.mode === 'scan' ? '目录扫描' : '执行'} · {dateTime(task.createdAt)}</span></div>
        <StateBadge task={task} /><ChevronRight size={14} />
      </button>)}
    </section>}
  </>;
}

function AnalyzePage({ task, environment, busy, onStart, onStop, now }: {
  task?: Task; environment?: Environment; busy: boolean; now: number;
  onStart: (request: Parameters<MoleBridge['startTask']>[0]) => void; onStop: (task: Task) => void;
}) {
  const [path, setPath] = useState('');
  const [filter, setFilter] = useState('');
  useEffect(() => { if (environment?.home) setPath(previous => previous || environment.home); }, [environment?.home]);
  useEffect(() => { if (task?.path) setPath(task.path); }, [task?.id]);
  useEffect(() => { setFilter(''); }, [task?.path]);
  const report: ScanReport | undefined = task?.result;
  const running = isActive(task);
  const entries = useMemo(() => [...(report?.entries || [])].sort((a, b) => (b.size ?? -1) - (a.size ?? -1)).filter(entry => entry.name.toLowerCase().includes(filter.toLowerCase())), [report, filter]);
  const total = Math.max(1, report?.totalSize || 0);
  const statusText = report?.scanStatus === 'complete' ? '扫描完成' : report?.scanStatus === 'partial' ? '部分目录未能完整扫描' : '无法读取目录';

  return <>
    <PageTitle title="分析目录占用" subtitle="选择目录开始扫描，点击结果中的文件夹可继续分析。" />
    <section className="card scan-controls">
      <label htmlFor="scan-path">分析目录</label>
      <form onSubmit={event => { event.preventDefault(); onStart({ operation: 'analyze', mode: 'scan', path }); }}>
        <div className="path-input"><Folder size={18} /><input id="scan-path" value={path} onChange={event => setPath(event.target.value)} placeholder="输入目录，例如 ~/Downloads" required /></div>
        <button type="button" className="secondary" onClick={() => { const picked = mole?.pickDirectory(); if (picked) setPath(picked); }}><Folder size={15} /> 选择</button>
        <button className="primary" disabled={busy || running || !path || !environment?.ready}>{running ? <Loader2 size={16} className="spin" /> : <Search size={16} />} 开始分析</button>
      </form>
      <div className="path-shortcuts">快速选择
        {[{ label: '主目录', path: environment?.home }, { label: '下载', path: environment?.home && `${environment.home}/Downloads` }, { label: '应用程序', path: '/Applications' }, { label: '外接磁盘', path: '/Volumes' }].map(item => <button key={item.label} disabled={!item.path} onClick={() => item.path && setPath(item.path)}>{item.label}</button>)}
      </div>
    </section>

    {task && <div className="task-summary">
      <div className="task-summary-heading">
        <div><StateBadge task={task} /><span className="task-mode">只读分析</span><span className="task-elapsed"><Clock3 size={13} />{duration(task, now)}</span></div>
        {running && <button className="text-button danger-text" onClick={() => onStop(task)} disabled={task.state === 'cancelling'}>停止分析</button>}
      </div>
      {task.error && <p className={task.state === 'failed' ? 'task-error' : ''}>{task.error}</p>}
      <div className="task-id"><span>任务 {task.id.slice(0, 8)}</span>{task.exitCode != null && <span>退出码 {task.exitCode}</span>}</div>
    </div>}

    {report ? <section className="card scan-results">
      <div className="section-heading">
        <div><h2>{statusText}</h2><p>{bytes(report.totalSize)} 已测量{report.totalFiles != null ? ` · ${report.totalFiles.toLocaleString()} 个文件` : ''}</p></div>
        <span className={`state-badge ${report.scanStatus === 'complete' ? 'state-succeeded' : 'state-interrupted'}`}>{report.scanStatus === 'complete' ? <Check size={13} /> : <Info size={13} />} {report.scanStatus === 'complete' ? '完整扫描' : report.scanStatus === 'partial' ? '部分扫描' : '无法读取'}</span>
      </div>
      {report.scanStatus !== 'complete' && <Notice tone="warning">当前容量是已测量的部分。权限限制或扫描中断不代表目录为空；检查权限后可再次分析。</Notice>}
      <div className="disk-breadcrumbs">
        <button aria-label="分析根目录" disabled={running} onClick={() => onStart({ operation: 'analyze', mode: 'scan', path: '/' })}><HardDrive size={15} /></button>
        {report.path.split('/').filter(Boolean).map((part, index, all) => <span key={index}><ChevronRight size={13} /><button disabled={running} onClick={() => onStart({ operation: 'analyze', mode: 'scan', path: `/${all.slice(0, index + 1).join('/')}` })}>{part}</button></span>)}
      </div>
      <div className="scan-treemap" aria-label="已测量目录容量比例">
        {entries.filter(entry => entry.size && entry.size > total * 0.015).slice(0, 8).map((entry, index) => <button key={entry.path} disabled={!entry.isDir || running} title={`${entry.name}: ${bytes(entry.size)}`} onClick={() => onStart({ operation: 'analyze', mode: 'scan', path: entry.path })} style={{ flexGrow: Math.max(1, (entry.size || 0) / total * 100), background: ['#e6edfc', '#dce9f3', '#e9e2f6', '#dcece5', '#f2e5d8', '#e3e8ee', '#e5edfb', '#eee7dc'][index] }}><Folder size={18} /><strong>{entry.name}</strong><span>{bytes(entry.size)}</span></button>)}
      </div>
      <div className="list-filter"><Search size={15} /><input aria-label="筛选当前目录" value={filter} onChange={event => setFilter(event.target.value)} placeholder="筛选当前目录…" /><span>{entries.length} 项</span></div>
      <div className="file-list">
        <div className="file-row file-head"><span>名称</span><span>已测量大小</span><span>扫描状态</span><span /></div>
        {entries.map(entry => <button className="file-row" key={entry.path} disabled={!entry.isDir || running} onClick={() => onStart({ operation: 'analyze', mode: 'scan', path: entry.path })}>
          <span>{entry.isDir ? <Folder size={18} className="folder-icon" /> : <File size={18} />}<span title={entry.path}>{entry.name}</span></span>
          <span>{bytes(entry.size)}</span>
          <span className={`scan-status ${entry.scanStatus}`}>{entry.scanStatus === 'complete' ? '完整' : entry.scanStatus === 'partial' ? '部分' : '不可用'}</span>
          <span>{entry.isDir && <ChevronRight size={14} />}</span>
        </button>)}
        {!entries.length && <div className="empty-state compact-empty"><Folder size={28} /><p>{report.scanStatus === 'complete' ? filter ? '没有匹配的项目' : '这个目录没有可显示的项目' : '尚未获得可用的目录结果'}</p></div>}
      </div>
      {!!report.largeFiles?.length && <div className="large-files"><h3>大文件</h3>{report.largeFiles.slice(0, 20).map(file => <div key={file.path}><span title={file.path}><File size={15} />{file.name}</span><strong>{bytes(file.size)}</strong></div>)}</div>}
    </section> : !running && <div className="empty-state scan-empty">
      <div className="scan-empty-art"><HardDrive size={38} /><span><Search size={17} /></span></div>
      <h2>选择一个目录开始分析</h2>
      <p>选择目录并开始分析，结果会以容量分布和文件列表展示。</p>
      <div className="empty-feature-row"><span><ShieldCheck size={14} /> 只读扫描</span><span><Folder size={14} /> 逐层探索</span><span><LockKeyhole size={14} /> 本机处理</span></div>
    </div>}
  </>;
}

function HistoryPage() {
  const [tab, setTab] = useState<'sessions' | 'deletions'>('sessions');
  const [history, setHistory] = useState<MoleHistory>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!mole) return;
    setLoading(true);
    setError('');
    try {
      setHistory(await mole.getHistory(50));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <>
    <PageTitle title="操作记录" subtitle="读取 Mole 保存的历史记录，本次任务结果可在对应工具中查看。">
      <button className="secondary compact" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> 刷新</button>
    </PageTitle>
    {error && <Notice tone="warning">{error}</Notice>}
    <div className="history-toolbar">
      <div className="segmented">
        <button className={tab === 'sessions' ? 'selected' : ''} onClick={() => setTab('sessions')}><TerminalIcon size={14} /> 命令记录 <span>{history?.sessions.length ?? 0}</span></button>
        <button className={tab === 'deletions' ? 'selected' : ''} onClick={() => setTab('deletions')}><Trash2 size={14} /> 删除记录 <span>{history?.deletions.length ?? 0}</span></button>
      </div>
    </div>
    <section className="card history-card">
      {loading && !history ? <div className="empty-state"><Loader2 className="spin" /><p>正在读取 Mole 操作记录…</p></div>
        : tab === 'sessions' ? (history?.sessions.length ? <>
          <div className="history-row history-head"><span>命令</span><span>开始时间</span><span>记录信息</span><span /></div>
          {history.sessions.map((session, index) => <div className="history-row" key={`${session.runId || 'session'}-${index}`}>
            <span><span className="small-tool-icon blue"><TerminalIcon size={17} /></span><span><strong>mo {session.command || 'unknown'}</strong><small>{session.runId || '未记录运行标识'}</small></span></span>
            <span>{session.startedAt || '—'}</span>
            <span>{session.items ?? 0} 项 · {session.size || '未记录大小'}<small>{session.failedTasks ? `${session.failedTasks} 个步骤失败` : '没有记录失败步骤'}</small></span>
            <span />
          </div>)}</> : <div className="empty-state"><History size={30} /><h2>暂无命令记录</h2><p>执行一次清理、优化或卸载后，Mole 会在这里留下记录。</p></div>)
        : (history?.deletions.length ? <>
          <div className="history-row history-head"><span>时间</span><span>模式</span><span>结果</span><span /></div>
          {history.deletions.map((item, index) => <div className="history-row" key={`${item.timestamp || 'deletion'}-${index}`}>
            <span><span className="small-tool-icon pink"><Trash2 size={17} /></span><span><strong title={item.path}>{shortPath(item.path || '未记录路径')}</strong><small>{item.timestamp || '未记录时间'}</small></span></span>
            <span>{item.mode || '—'}</span>
            <span>{item.status || '—'}<small>{item.sizeKb == null ? '大小未知' : bytes(item.sizeKb * 1024)}</small></span>
            <span />
          </div>)}</> : <div className="empty-state"><Trash2 size={30} /><h2>暂无删除记录</h2><p>Mole 会把实际删除的文件记录在本地日志中。</p></div>)}
    </section>
  </>;
}

function SettingsPage({ environment, environmentError, onRefresh, onEnvironment, update, taskBusy, onUpdate }: {
  environment?: Environment; environmentError: string; onRefresh: () => Promise<Environment | undefined>; onEnvironment: (environment: Environment) => void;
  update?: MoleUpdate; taskBusy: boolean; onUpdate: () => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const paths = mole?.getPaths();
  const updating = isUpdatingMole(update);

  async function choose() {
    if (!mole) return;
    setBusy(true); setMessage('');
    try {
      const next = await mole.chooseMoPath();
      if (next) { onEnvironment(next); setMessage(`已切换为 ${next.moPath}`); }
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function automatic() {
    if (!mole) return;
    setBusy(true); setMessage('');
    try { const next = await mole.clearMoPath(); onEnvironment(next); setMessage(next.ready ? '已恢复自动检测' : next.error || '仍未找到 mo，请检查安装'); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setMessage('');
    try { const next = await onRefresh(); setMessage(next?.ready ? '环境信息已刷新' : next?.error || '尚未检测到 Mole'); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <PageTitle title="Mole 运行环境" subtitle="管理本机命令路径、查看版本与运行日志。">
      <button className="secondary" onClick={() => void refresh()} disabled={busy || updating}><RefreshCw size={15} className={busy ? 'spin' : ''} /> 刷新信息</button>
    </PageTitle>
    {environmentError && <Notice tone="warning">{environmentError}</Notice>}
    {message && <Notice tone="info">{message}<button aria-label="关闭提示" onClick={() => setMessage('')}><X size={15} /></button></Notice>}
    <MoleUpdatePanel environment={environment} update={update} taskBusy={taskBusy || busy} onUpdate={onUpdate} />
    <section className="card settings-card">
      <div className="section-heading"><h2><TerminalIcon size={18} /> Mole CLI</h2><span className={`state-badge ${environment?.ready ? 'state-succeeded' : 'state-failed'}`}>{environment?.ready ? '已连接' : '未就绪'}</span></div>
      <dl>
        <div><dt>安装版本</dt><dd>{environment?.moVersion || '未检测到'}</dd></div>
        <div><dt>命令路径</dt><dd><code>{environment?.moPath || '未检测到'}</code></dd></div>
        <div><dt>检测方式</dt><dd>{environment?.pathSource === 'manual' ? '手动选择' : '自动检测'}</dd></div>
        <div><dt>主目录</dt><dd><code>{environment?.home || '—'}</code></dd></div>
        <div><dt>运行平台</dt><dd>{environment?.platform || '—'}</dd></div>
        <div><dt>日志文件</dt><dd><code>{paths?.logFile || '—'}</code></dd></div>
      </dl>
      {environment?.error && <Notice tone="warning">{environment.error}</Notice>}
      <div className="settings-actions">
        <button className="secondary compact" onClick={() => void choose()} disabled={busy || updating}><Folder size={14} /> 选择 mo 路径</button>
        <button className="secondary compact" onClick={() => void automatic()} disabled={busy || updating}><RefreshCw size={14} /> 恢复自动检测</button>
        <button className="secondary compact" onClick={() => mole?.openLog()}><File size={14} /> 打开日志</button>
      </div>
    </section>
    <div className="settings-grid">
      <section className="card"><div className="settings-icon"><LockKeyhole size={22} /></div><h3>只在本机运行</h3><p>插件调用本机 Mole 完成分析和维护，文件信息与运行记录保存在本机。</p></section>
      <section className="card"><div className="settings-icon"><Folder size={22} /></div><h3>文件访问权限</h3><p>部分目录需要 macOS 授权。若扫描结果不完整，请在系统设置的隐私与安全性中为 uTools 授予必要权限。</p></section>
      <section className="card"><div className="settings-icon"><Command size={22} /></div><h3>图形操作</h3><p>先检查维护范围，再勾选项目并确认。需要管理员权限时，在页面中输入 Mac 登录密码，也可以跳过需要管理员权限的步骤。</p></section>
      <section className="card"><div className="settings-icon"><CircleHelp size={22} /></div><h3>关于 LiberClean</h3><p>LiberClean 通过图形界面管理本机维护操作，清理规则、文件保护和管理员授权由已安装的 Mole 执行。</p><a href="https://github.com/zdkcomeon/liberClean" target="_blank" rel="noreferrer">项目主页 <ExternalLink size={13} /></a></section>
    </div>
    <div className="empty-feature-row settings-footnote"><span><Monitor size={14} /> uTools {environment?.platform === 'darwin' ? 'macOS' : environment?.platform || ''}</span><span><ShieldCheck size={14} /> 本机会话</span><span><Clock3 size={14} /> 打开时检测安装状态</span></div>
  </>;
}
