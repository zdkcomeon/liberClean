import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Boxes, Check, CheckCircle2, ChevronDown, ChevronRight, File, Folder, Info, Loader2, LockKeyhole, Package, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { dateTime, mole } from './api';
import { isActive, type ApplicationInventory, type InstalledApp, type Task, type UninstallFile } from './types';

type Props = { ready: boolean; task?: Task; active?: Task; onTask: (task: Task) => void; onCancel: () => void };
const sourceLabel = (source: string) => source === 'Homebrew' ? 'Homebrew' : '应用程序';
const availableSize = (value: string) => !value || value.startsWith('N/A') || value === 'Unknown' ? '大小暂不可用' : value;
const colors = ['violet', 'blue', 'green', 'orange', 'rose'];

export function UninstallPage({ ready, task, active, onTask, onCancel }: Props) {
  const [inventory, setInventory] = useState<ApplicationInventory>();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [hiddenTask, setHiddenTask] = useState('');
  const [password, setPassword] = useState('');
  const [showKept, setShowKept] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const reviewPanel = useRef<HTMLElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const refreshedResult = useRef('');
  const flow = task?.uninstall;
  const running = !!task && isActive(task);
  const visibleTask = task && task.id !== hiddenTask && (running || !!flow && (flow.phase !== 'reviewed' || !!flow.files?.length));
  const canSelect = !active && !busy && ready && inventory?.state === 'ready';

  const load = useCallback(async (refresh = false) => {
    if (!mole) return;
    setInventory(previous => previous ? { ...previous, state: 'loading' } : { state: 'loading', apps: [], updatedAt: null });
    try { setInventory(await mole.getApplications(refresh)); setError(''); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { if (ready) void load(); }, [ready, load]);
  useEffect(() => {
    if (inventory?.state === 'ready') setSelected(previous => new Set([...previous].filter(id => inventory.apps.some(a => a.id === id && a.selectable))));
  }, [inventory]);
  useEffect(() => {
    if (flow?.phase === 'confirm' && running) setReviewOpen(true);
    if (!running) { setReviewOpen(false); setPassword(''); }
  }, [flow?.phase, running]);
  useEffect(() => { if (reviewOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [reviewOpen]);
  useEffect(() => { if (task?.uninstall) reviewPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [task?.id]);
  useEffect(() => { setPassword(''); if (flow?.phase === 'authorizing') passwordInput.current?.focus(); }, [flow?.promptToken]);

  const apps = useMemo(() => [...(inventory?.apps || [])].filter(app => {
    const match = `${app.name} ${app.bundleId} ${app.path}`.toLowerCase().includes(query.trim().toLowerCase());
    return match && (source === 'all' || source === app.source);
  }).sort((a, b) => (sort === 'source' ? a.source.localeCompare(b.source) : 0) || a.name.localeCompare(b.name, 'zh-CN')), [inventory, query, source, sort]);
  const selectedApps = inventory?.apps.filter(app => selected.has(app.id)) || [];
  const allVisibleSelected = apps.some(a => a.selectable) && apps.filter(a => a.selectable).every(a => selected.has(a.id));
  const files = flow?.files || [];
  const removable = files.filter(f => !['kept', 'reviewOnly'].includes(f.kind));
  const kept = files.filter(f => ['kept', 'reviewOnly'].includes(f.kind));
  const targetApps = task?.apps || [];
  const selectionMatchesTask = selectedApps.length === targetApps.length && selectedApps.every(a => targetApps.some(t => t.id === a.id));
  const showSelectionBar = selectedApps.length > 0 && (!visibleTask || !selectionMatchesTask || !flow || ['failed', 'cancelled', 'completed'].includes(flow.phase));
  useEffect(() => {
    if (task?.mode === 'execute' && task.uninstall && !isActive(task) && refreshedResult.current !== task.id) {
      refreshedResult.current = task.id; setSelected(new Set()); void load(true);
    }
  }, [task?.id, task?.state, load]);

  function toggle(app: InstalledApp) {
    if (!canSelect || !app.selectable) return;
    setSelected(previous => { const next = new Set(previous); if (next.has(app.id)) next.delete(app.id); else if (next.size < 20) next.add(app.id); return next; });
  }
  function toggleAll() {
    setSelected(previous => {
      const next = new Set(previous);
      if (allVisibleSelected) apps.forEach(a => next.delete(a.id));
      else apps.filter(a => a.selectable).forEach(a => { if (next.size < 20) next.add(a.id); });
      return next;
    });
  }
  async function create(mode: 'preview' | 'execute') {
    const appIds = mode === 'preview' ? selectedApps.map(a => a.id) : targetApps.map(a => a.id);
    if (!appIds.length || busy) return;
    setBusy(true); setError(''); setHiddenTask('');
    try {
      if (!mole) return;
      const value = mole.startTask({ operation: 'uninstall', mode, appIds });
      onTask(value);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function act(action: 'confirm' | 'password') {
    if (!task || !flow?.promptToken || busy) return;
    const secret = password; setPassword('');
    setBusy(true); setError('');
    try {
      if (!mole) return;
      const value = mole.uninstallAction(task.id, { action, promptToken: flow.promptToken, ...(action === 'password' ? { password: secret } : {}) });
      onTask(value); setReviewOpen(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function dismiss() { if (task) setHiddenTask(task.id); setSelected(new Set()); void load(true); }

  return <div className="uninstall-page">
    <div className="page-heading"><div><h1>选择要卸载的应用</h1><p>勾选应用后检查关联文件，确认后再卸载。</p></div><button className="secondary compact" onClick={() => void load(true)} disabled={!ready || inventory?.state === 'loading' || busy || !!active}><RefreshCw size={15} className={inventory?.state === 'loading' ? 'spin' : ''}/> 刷新列表</button></div>
    {error && <div className="notice warning" role="alert"><AlertCircle size={17}/><div>{error}</div><button aria-label="关闭卸载错误" onClick={() => setError('')}><X size={16}/></button></div>}
    {inventory?.error && <div className="notice warning" role="status"><AlertCircle size={17}/><div>{inventory.error}<button className="text-button" onClick={() => void load(true)}>重新加载</button></div></div>}

    {visibleTask && <section ref={reviewPanel} className="card uninstall-review" aria-label="卸载进度与结果">
      <div className="uninstall-review-head"><div className={`review-state-icon ${flow?.outcome === 'complete' || flow?.phase === 'reviewed' ? 'success' : flow?.phase === 'failed' ? 'warning' : ''}`}>{running ? <Loader2 size={23} className="spin"/> : flow?.outcome === 'partial' || flow?.outcome === 'failed' || flow?.outcome === 'unknown' ? <AlertCircle size={23}/> : <CheckCircle2 size={23}/>}</div><div><h2>{flow?.phase === 'reviewed' ? '卸载内容已备好' : flow?.phase === 'confirm' ? '请确认本次卸载内容' : flow?.phase === 'authorizing' ? '需要管理员认证' : flow?.phase === 'failed' ? '本次操作未完成' : flow?.phase === 'cancelled' ? '已停止卸载' : flow?.phase === 'completed' ? flow.outcome === 'complete' ? '卸载已完成' : '请检查卸载结果' : '正在检查应用与关联文件'}</h2><p>{flow?.message || '正在由 Mole 检查，请稍候。不会自动卸载应用。'}</p></div>{running ? <button className="text-button danger-text" onClick={onCancel} disabled={task.state === 'cancelling'}>停止操作</button> : <button className="icon-button" aria-label="收起卸载结果" onClick={dismiss}><X size={17}/></button>}</div>
      {!!targetApps.length && <div className="review-app-chips">{targetApps.map(app => <span key={app.id}><Package size={14}/>{app.name}</span>)}</div>}
      {task.error && <div className="uninstall-message"><AlertCircle size={15}/>{task.error}</div>}
      {!!files.length && <><div className="review-files-title"><h3>应用与关联文件 <span>{removable.length} 项</span></h3><span>来自 Mole 的实际检查</span></div><div className="review-file-list">{removable.map(file => <FileRow key={`${file.kind}-${file.path}`} file={file}/>)}</div>{kept.length > 0 && <div className="kept-files"><button onClick={() => setShowKept(!showKept)} aria-expanded={showKept}>{showKept ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}将保留的个人数据与系统项目 <span>{kept.length} 项</span><ShieldCheck size={15}/></button>{showKept && <div className="review-file-list">{kept.map(file => <FileRow key={`${file.kind}-${file.path}`} file={file}/>)}</div>}</div>}</>}
      {(flow?.notices || []).map((notice, i) => <div className="uninstall-message" key={i}><Info size={15}/><span>{notice}</span></div>)}
      {flow?.phase === 'authorizing' && running && <form className="uninstall-auth" onSubmit={e => { e.preventDefault(); void act('password'); }}><LockKeyhole size={22}/><div><label htmlFor="uninstall-password">Mac 登录密码</label><p>直接交给 Mole 验证，输入内容不会保存。</p><div><input ref={passwordInput} id="uninstall-password" type="password" autoComplete="off" value={password} maxLength={256} onChange={e => setPassword(e.target.value)} placeholder="输入当前账户的密码" disabled={busy}/><button className="primary" type="submit" disabled={busy || !password}>{busy ? <Loader2 size={15} className="spin"/> : <LockKeyhole size={15}/>} 验证权限</button></div></div></form>}
      <div className="review-footer"><span><ShieldCheck size={15}/>{task.mode === 'preview' ? '此次仅预览，没有删除文件' : '默认移到废纸篓，个人数据默认保留'}</span>{flow?.phase === 'reviewed' && !running && files.length > 0 && <button className="danger-button" disabled={busy || !!active} onClick={() => void create('execute')}>{busy ? <Loader2 size={15} className="spin"/> : <Trash2 size={15}/>} 继续卸载 <ArrowRight size={15}/></button>}{flow?.phase === 'confirm' && running && <button className="danger-button" onClick={() => setReviewOpen(true)}>查看并确认 <ArrowRight size={15}/></button>}{!running && flow?.phase !== 'reviewed' && <button className="secondary compact" onClick={dismiss}><RefreshCw size={14}/> 更新应用列表</button>}</div>
    </section>}

    <section className="card application-library" aria-label="已安装的应用">
      <div className="application-library-heading"><div><div className="library-title"><h2>已安装的应用</h2>{inventory?.updatedAt && <span className="app-count">{inventory.apps.length}</span>}</div><p>{inventory?.state === 'loading' ? inventory.updatedAt ? '正在重新检查本机应用…' : '正在读取本机应用，首次加载可能需要一些时间…' : inventory?.updatedAt ? `由 Mole 扫描 · 更新于 ${dateTime(inventory.updatedAt)}` : '进入页面后自动读取应用列表'}</p></div><span className="library-readonly"><ShieldCheck size={14}/> 只读检查</span></div>
      <div className="app-library-controls"><div className="app-search"><Search size={17}/><input aria-label="搜索应用" placeholder="搜索应用名称、标识或路径" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button onClick={() => setQuery('')} aria-label="清空应用搜索"><X size={15}/></button>}</div><select aria-label="应用来源" value={source} onChange={e => setSource(e.target.value)}><option value="all">全部来源</option><option value="App">应用程序</option><option value="Homebrew">Homebrew</option></select><select aria-label="应用排序" value={sort} onChange={e => setSort(e.target.value)}><option value="name">按名称排序</option><option value="source">按来源排序</option></select></div>
      <div className="app-list-head"><label><input type="checkbox" aria-label="选择当前列表" checked={allVisibleSelected} disabled={!canSelect || !apps.some(a => a.selectable)} onChange={toggleAll}/><span>应用名称 <small>{query || source !== 'all' ? `${apps.length} 个结果` : ''}</small></span></label><span>来源</span><span>应用大小</span></div>
      {inventory?.state === 'loading' && !inventory.apps.length ? <div className="app-loading" role="status"><div className="app-loading-icon"><Boxes size={30}/><Loader2 size={17} className="spin"/></div><h3>正在整理你的应用列表</h3><p>正在读取应用名称、来源和大小，请稍候。</p><div className="app-skeletons">{[0, 1, 2].map(n => <div key={n}><i/><span/><b/></div>)}</div></div> : !apps.length ? <div className="app-loading"><Search size={29}/><h3>{inventory?.state === 'error' ? '暂时无法读取应用' : query || source !== 'all' ? '没有找到匹配的应用' : inventory?.state === 'ready' ? '没有可显示的应用' : '等待 Mole 就绪'}</h3><p>{query ? '试试其他名称，或清空搜索条件。' : '可以刷新列表重新检查。'}</p></div> : <div className="app-list">{apps.map((app, i) => <div className={`application-row ${selected.has(app.id) ? 'selected' : ''} ${!app.selectable ? 'unselectable' : ''}`} key={app.id}>
        <label className="application-select"><input type="checkbox" aria-label={`选择 ${app.name}`} checked={selected.has(app.id)} disabled={!canSelect || !app.selectable || selected.size >= 20 && !selected.has(app.id)} onChange={() => toggle(app)}/><div className={`application-icon ${colors[i % colors.length]}`}>{app.name.slice(0, 1).toUpperCase()}</div><div className="application-text"><strong>{app.name}</strong><span title={app.path}>{app.path}</span>{!app.selectable && <small>{app.reason}</small>}</div></label><span className={`app-source ${app.source === 'Homebrew' ? 'brew' : ''}`}>{sourceLabel(app.source)}</span><span className="app-size">{availableSize(app.sizeLabel)}</span>
      </div>)}</div>}
      <div className="library-footnote"><Info size={14}/><span>列表仅包含 Mole 支持的应用。应用大小不包含关联文件；同名副本无法唯一识别时会禁止选择。</span></div>
    </section>
    {showSelectionBar && <div className="app-selection-bar"><div><span className="selected-count">{selectedApps.length}</span><div><strong>已选择 {selectedApps.length} 个应用</strong><span>{selectedApps.map(a => a.name).join('、')}</span></div><button className="text-button" onClick={() => setSelected(new Set())} disabled={!canSelect}>清空</button></div><button className="primary" onClick={() => void create('preview')} disabled={!canSelect}>{busy ? <Loader2 size={16} className="spin"/> : <Search size={16}/>} 检查卸载内容 <ArrowRight size={16}/></button></div>}
    <dialog className="confirm-dialog uninstall-dialog" ref={dialog} onCancel={e => { e.preventDefault(); if (!busy) setReviewOpen(false); }}><div className="confirm-icon"><Trash2 size={25}/></div><h2>确认卸载 {targetApps.length} 个应用</h2><p>请核对 Mole 最新检查的内容。应用默认移到废纸篓；系统文件与关联项目的处理范围如下。</p><div className="dialog-apps">{targetApps.map(app => <div key={app.id}><Package size={18}/><div><strong>{app.name}</strong><span>{app.path}</span></div></div>)}</div><div className="dialog-file-summary"><span>计划处理 <strong>{removable.length}</strong> 项</span><span>保留 <strong>{kept.length}</strong> 项</span></div><div className="dialog-file-preview">{removable.map(file => <FileRow key={file.path} file={file}/>)}</div><div className="confirm-note"><ShieldCheck size={17}/><span>个人数据默认保留。Mole 可能退出正在运行的应用，继续前请保存工作。</span></div><div className="dialog-actions"><button className="secondary" onClick={() => setReviewOpen(false)} disabled={busy}><ArrowLeft size={15}/> 返回核对</button><button className="danger-button" disabled={busy || flow?.phase !== 'confirm' || !running} onClick={() => void act('confirm')}>{busy ? <Loader2 size={15} className="spin"/> : <Trash2 size={15}/>} 确认卸载</button></div></dialog>
  </div>;
}

function FileRow({ file }: { file: UninstallFile }) { return <div className="review-file-row">{file.kind === 'app' ? <Package size={16}/> : file.kind === 'kept' || file.kind === 'reviewOnly' ? <ShieldCheck size={16}/> : <Folder size={16}/>}<span title={file.path}>{file.path}</span>{file.kind === 'system' && <small>系统项目</small>}{file.kind === 'reviewOnly' && <small>仅供检查</small>}<strong>{file.sizeLabel || '大小未知'}</strong></div>; }
