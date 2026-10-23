import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, ChevronDown, CircleStop, Clock3, File, Folder, Info, Loader2, LockKeyhole, RefreshCw, Search, ShieldCheck, Trash2, X, type LucideIcon } from 'lucide-react';
import { bytes, duration, mole, shortPath, type MoleBridge } from './api';
import { isActive, type MaintenanceActionRequest, type MaintenanceItem, type MaintenanceOperation, type MaintenanceResult, type Task } from './types';

interface Props {
  operation: MaintenanceOperation;
  tool: { title: string; description: string; impact: string; icon: LucideIcon; color: string };
  task?: Task;
  home?: string;
  ready: boolean;
  busy: boolean;
  now: number;
  onStart: (request: Parameters<MoleBridge['startTask']>[0]) => void;
  onStop: (task: Task) => void;
  onTask: (task: Task) => void;
}

const emptyItems: MaintenanceItem[] = [];
const resultLabels: Record<MaintenanceResult | 'unknown', string> = { applied: '已优化', unchanged: '无需更改', skipped: '已跳过', unavailable: '不适用', attention: '需处理', failed: '失败', unknown: '未返回明细' };

export function MaintenancePage({ operation, tool, task, home, ready, busy, now, onStart, onStop, onTask }: Props) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(200);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [projectPath, setProjectPath] = useState(task?.path || '');
  const dialog = useRef<HTMLDialogElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const flow = task?.maintenance;
  const items = flow?.items || emptyItems;
  const running = isActive(task);
  const projectMode = operation === 'purge';
  const scopeChanged = projectMode && !!task && projectPath.trim() !== task.path;
  const fileMode = projectMode || operation === 'installer';
  const compatible = typeof mole?.maintenanceAction === 'function';
  const previewReady = task?.mode === 'preview' && task.state === 'succeeded' && flow?.phase === 'reviewed';
  const reviewed = previewReady && !scopeChanged;
  const canSelect = reviewed && ready && !busy && !submitting;
  const executingResults = task?.mode === 'execute' && !!flow && ['executing', 'authorizing', 'completed', 'failed', 'cancelled'].includes(flow.phase);
  const groups = useMemo(() => [...new Set(items.map(item => item.group).filter(Boolean))], [items]);
  const filtered = useMemo(() => {
    const matches = items.filter(item => {
      const matchesResult = resultFilter === 'all' || (resultFilter === 'issues' ? ['attention', 'failed'].includes(item.result || '') : (item.result || 'unknown') === resultFilter);
      return (group === 'all' || item.group === group) && matchesResult && `${item.title} ${item.path} ${item.group} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase());
    });
    return executingResults && !fileMode ? matches.sort((a, b) => Number(['attention', 'failed'].includes(b.result || '')) - Number(['attention', 'failed'].includes(a.result || ''))) : matches;
  }, [items, group, query, resultFilter, executingResults, fileMode]);
  const selectable = filtered.filter(item => item.selectable);
  const selectedItems = items.filter(item => selected.has(item.id));
  const allSelected = selectable.length > 0 && selectable.every(item => selected.has(item.id));
  const partlySelected = !allSelected && selectable.some(item => selected.has(item.id));
  const totalSize = selectedItems.reduce((sum, item) => sum + (item.size || 0), 0);
  const unknownSize = selectedItems.some(item => item.size == null);
  const waitingConfirmation = running && flow?.phase === 'confirm';
  const completed = flow?.phase === 'completed';
  const warning = flow?.phase === 'failed' || flow?.phase === 'cancelled' || flow?.outcome === 'partial' || flow?.outcome === 'unknown';

  useEffect(() => { setSelected(new Set()); setError(''); setQuery(''); setGroup('all'); setResultFilter('all'); }, [task?.id]);
  useEffect(() => { if (projectMode && task?.path) setProjectPath(task.path); }, [projectMode, task?.id, task?.path]);
  useEffect(() => { setVisibleCount(200); }, [query, group, resultFilter, task?.id]);
  useEffect(() => { if (waitingConfirmation) setReviewOpen(true); else setReviewOpen(false); }, [waitingConfirmation, flow?.promptToken]);
  useEffect(() => {
    if (reviewOpen) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); reviewTrigger.current?.focus({ preventScroll: true }); }
  }, [reviewOpen]);
  useEffect(() => {
    setPassword('');
    if (flow?.phase === 'authorizing') passwordInput.current?.focus();
  }, [flow?.promptToken]);

  function toggle(item: MaintenanceItem) {
    if (!canSelect || !item.selectable) return;
    setSelected(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
  }

  function toggleAll() {
    if (!canSelect) return;
    setSelected(previous => {
      const next = new Set(previous);
      selectable.forEach(item => { if (allSelected) next.delete(item.id); else next.add(item.id); });
      return next;
    });
  }

  function inspect() {
    setError('');
    if (projectMode && !projectPath.trim()) { setError('请先选择或输入项目目录'); return; }
    onStart({ operation, mode: 'preview', ...(projectMode ? { path: projectPath.trim() } : {}) });
  }

  function chooseProjectDirectory() {
    const picked = mole?.pickDirectory();
    if (picked) { setProjectPath(picked); setSelected(new Set()); setError(''); }
  }

  function execute() {
    if (!task || !reviewed || busy || submitting || fileMode && !selectedItems.length) return;
    setError('');
    onStart({ operation, mode: 'execute', previewTaskId: task.id, ...(fileMode ? { itemIds: selectedItems.map(item => item.id) } : {}) });
  }

  function act(action: MaintenanceActionRequest['action']) {
    if (!task || !flow?.promptToken || submitting || !mole) return;
    const secret = password;
    setPassword(''); setSubmitting(true); setError('');
    try {
      const next = mole.maintenanceAction(task.id, { action, promptToken: flow.promptToken, ...(action === 'password' ? { password: secret } : {}) });
      onTask(next);
      if (action === 'confirm') setReviewOpen(false);
    } catch (failure) { setError((failure as Error).message); }
    finally { setSubmitting(false); }
  }

  const emptyTitle = projectMode ? '选择项目目录' : operation === 'optimize' ? '检查系统维护项目' : operation === 'installer' ? '查找安装包' : '查找可清理的文件';
  const inspectButton = <button className={task ? 'secondary' : 'primary'} onClick={inspect} disabled={!ready || !compatible || running || busy || submitting || projectMode && !projectPath.trim()}><RefreshCw size={14} className={running && task?.mode === 'preview' ? 'spin' : ''} />{task ? '重新检查' : '开始检查'}</button>;

  return <div className="maintenance-page list-workspace">
    <div className="list-workspace-body">
      <div className="page-heading maintenance-heading">
        <div className="maintenance-title"><h1>{tool.title}</h1>{previewReady && <span className={`state-badge ${scopeChanged ? 'state-interrupted' : 'state-succeeded'}`} role="status">{scopeChanged ? '目录已更改，请重新检查' : '检查完成'}</span>}</div>
        {task && inspectButton}
      </div>
      {projectMode && <form className="project-scope" onSubmit={event => { event.preventDefault(); if (ready && compatible && !running && !busy && !submitting) inspect(); }}>
        <label className="path-input"><Folder size={15} /><span className="sr-only">项目目录</span><input aria-label="项目目录" value={projectPath} onChange={event => { setProjectPath(event.target.value); setSelected(new Set()); }} disabled={running || busy || submitting} placeholder="项目目录或上级目录，如 ~/devProjects" required /></label>
        <button type="button" className="secondary compact" onClick={chooseProjectDirectory} disabled={!ready || running || busy || submitting}><Folder size={14} />选择目录</button>
      </form>}
      {!compatible && <div className="notice warning" role="status"><AlertCircle size={15} /><span>图形交互组件需要更新，请重新加载插件后再试。</span></div>}
      {error && <div className="notice warning" role="alert"><AlertCircle size={15} /><div>{error}</div><button aria-label="关闭维护错误" onClick={() => setError('')}><X size={14} /></button></div>}
      {busy && <div className="notice" role="status"><Info size={15} /><span>其他维护任务正在运行，请先完成或停止当前任务。</span></div>}
      {flow && !previewReady && <section className={`maintenance-status ${warning ? 'warning' : completed ? 'success' : ''}`} role="status">
        <div className="maintenance-status-icon">{running ? <Loader2 size={20} className="spin" /> : warning ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}</div>
        <div><strong>{running ? flow.phase === 'authorizing' ? flow.message || '需要管理员权限' : waitingConfirmation ? '等待确认' : task?.mode === 'preview' ? '正在检查' : '正在处理' : flow.message}</strong></div>
        {task && <span className="maintenance-elapsed"><Clock3 size={12} />{duration(task, now)}</span>}
        {flow.phase === 'failed' && task?.exitCode != null && <span className="maintenance-exit-code">退出码 {task.exitCode}</span>}
        {flow.phase === 'failed' && <button className="text-button" onClick={() => mole?.openLog()}>打开日志</button>}
        {running && task && <button className="text-button danger-text" onClick={() => onStop(task)} disabled={task.state === 'cancelling'}><CircleStop size={13} />停止</button>}
      </section>}
      {flow?.phase === 'authorizing' && running && <form className="maintenance-auth" onSubmit={event => { event.preventDefault(); act('password'); }}>
        <LockKeyhole size={18} /><div><label htmlFor="maintenance-password">Mac 登录密码</label><p>直接交给 Mole 验证，密码不会保存。</p><div><input ref={passwordInput} id="maintenance-password" type="password" value={password} onChange={event => setPassword(event.target.value)} maxLength={256} autoComplete="off" placeholder="输入当前账户的密码" disabled={submitting} /><button className="primary" disabled={submitting || !password}>验证权限</button>{flow.allowSkip && <button className="secondary" type="button" disabled={submitting} onClick={() => act('skip')}>跳过管理员步骤</button>}</div></div>
      </form>}
      {flow?.scanStatus === 'partial' && <div className="notice warning"><Info size={15} /><span>部分目录未能完整检查。当前列表只包含已取得的项目，可检查目录权限后重新扫描。</span></div>}
      {flow?.summary && <div className="maintenance-result-counts"><span><CheckCircle2 size={14} />已清理 <strong>{flow.summary.completedCount}</strong> 项</span><span><Info size={14} />仍保留 <strong>{flow.summary.failedCount}</strong> 项</span></div>}
      {(items.length > 0 || running || reviewed) ? <section className="card maintenance-library" aria-label={fileMode ? '文件清单' : operation === 'optimize' ? '维护项目' : '文件与目录'}>
        {items.length > 0 && <div className="maintenance-filters"><label className="app-search"><Search size={14} /><input aria-label="搜索维护项目" value={query} onChange={event => setQuery(event.target.value)} placeholder={fileMode ? '搜索名称或路径' : executingResults ? '搜索执行结果' : '筛选检查结果'} />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={13} /></button>}</label>{executingResults && !fileMode ? <select aria-label="按执行结果筛选" value={resultFilter} onChange={event => setResultFilter(event.target.value)}><option value="all">全部结果</option><option value="issues">仅看需处理项</option>{Object.entries(resultLabels).filter(([result]) => items.some(item => (item.result || 'unknown') === result)).map(([result, label]) => <option key={result} value={result}>{label}</option>)}</select> : <select aria-label="按类别筛选" value={group} onChange={event => setGroup(event.target.value)}><option value="all">全部类别</option>{groups.map(value => <option key={value} value={value}>{shortPath(value, home)}</option>)}</select>}</div>}
        <div className={`maintenance-list-head ${fileMode ? 'with-selection' : ''}`}>
          {fileMode && <input type="checkbox" ref={element => { if (element) element.indeterminate = partlySelected; }} aria-label={`全选当前筛选结果 ${selectable.length} 项`} checked={allSelected} disabled={!canSelect || !selectable.length} onChange={toggleAll} />}
          <span>{fileMode ? '名称与位置' : executingResults ? '执行项目' : '检查项目'} <small className="list-count">{filtered.length.toLocaleString()}{filtered.length !== items.length ? ` / ${items.length.toLocaleString()}` : ''} 项</small></span><span>{executingResults ? '执行结果' : operation === 'optimize' ? '检查结果' : '大小 / 状态'}</span>
        </div>
        <div className="maintenance-items">
          {filtered.slice(0, visibleCount).map(item => <div key={item.id} className={`maintenance-row ${fileMode ? 'with-selection' : ''} ${selected.has(item.id) ? 'selected' : ''} result-${item.result || 'unknown'}`}>
            {fileMode && <input id={`maintenance-${item.id}`} type="checkbox" aria-label={`选择 ${item.title}`} checked={task?.mode === 'execute' ? flow?.selectedIds.includes(item.id) : selected.has(item.id)} disabled={!canSelect || !item.selectable} onChange={() => toggle(item)} />}
            <label className="maintenance-item-title" htmlFor={fileMode ? `maintenance-${item.id}` : undefined}>
              <span className={`maintenance-item-icon ${tool.color}`}>{['attention', 'failed'].includes(item.result || '') ? <AlertCircle size={17} /> : operation === 'optimize' ? item.result === 'skipped' || item.result === 'unavailable' || executingResults && !item.result ? <Info size={17} /> : <CheckCircle2 size={17} /> : fileMode && operation === 'installer' ? <File size={17} /> : <Folder size={17} />}</span>
              <span><strong title={item.title}>{item.title}</strong><small title={item.path || item.detail}>{item.path ? shortPath(item.path, home) : item.detail || item.group}</small>{item.detail && item.path && <em title={item.detail}>{item.detail}</em>}</span>
            </label>
            <span className={`maintenance-item-state ${item.result || item.status}`}>{item.status === 'removed' ? <><Check size={12} />已清理</> : item.status === 'skipped' ? '仍保留' : item.result ? item.result === 'applied' && !executingResults ? '可优化' : resultLabels[item.result] : executingResults ? running ? '处理中' : '未返回明细' : item.size != null ? bytes(item.size) : operation === 'optimize' ? '已检查' : '未测量'}</span>
          </div>)}
          {filtered.length > visibleCount && <button className="maintenance-load-more" onClick={() => setVisibleCount(value => value + 200)}>显示更多项目（还有 {filtered.length - visibleCount} 项）</button>}
          {!filtered.length && <div className="maintenance-list-empty">{running ? <><Loader2 size={24} className="spin" /><strong>{fileMode ? '正在查找文件' : executingResults ? '正在读取执行结果' : '正在读取检查结果'}</strong></> : <><Search size={24} /><strong>{scopeChanged ? '目录已更改，请重新检查' : query || group !== 'all' || resultFilter !== 'all' ? '没有匹配的项目' : operation === 'installer' ? '未发现可清理的安装包' : projectMode ? '未找到可清理的项目' : '没有需要处理的项目'}</strong>{projectMode && !scopeChanged && !query && group === 'all' && <p>可改选上级目录，查找依赖与构建产物。</p>}{(query || group !== 'all' || resultFilter !== 'all') && <button className="text-button" onClick={() => { setQuery(''); setGroup('all'); setResultFilter('all'); }}>清除筛选条件</button>}</>}</div>}
        </div>
      </section> : !flow && <section className="maintenance-empty"><span className="maintenance-empty-icon"><tool.icon size={34} strokeWidth={1.4} /></span><h2>{emptyTitle}</h2>{!task && inspectButton}</section>}
      {!!flow && (flow.steps.length > 0 || flow.messages.length > 0) && <details className="maintenance-detail" open={flow.phase === 'failed' && !items.length}><summary><span><Info size={13} />{flow.phase === 'failed' ? '错误详情与运行记录' : '运行记录'}</span><ChevronDown size={13} /></summary><div className="maintenance-report-detail"><div className="maintenance-messages">{flow.messages.map(message => <p key={message.id} className={message.tone}>{message.text}</p>)}</div></div></details>}
    </div>
    {flow && (reviewed || waitingConfirmation) && <div className="maintenance-action-bar">
      <div>{fileMode && reviewed ? <><span><strong>已选择 {selectedItems.length} 项</strong>{selectedItems.length > 0 && <small>{bytes(totalSize)}{unknownSize ? '，部分大小未知' : ''}</small>}</span>{selected.size > 0 && <button className="text-button" onClick={() => setSelected(new Set())} disabled={!canSelect}>清空</button>}</> : <span><strong>{items.length} 个项目</strong></span>}</div>
      {waitingConfirmation ? <button ref={reviewTrigger} className="primary" onClick={() => setReviewOpen(true)}>查看并确认 <ArrowRight size={14} /></button> : <button className="primary" onClick={execute} disabled={!ready || busy || submitting || !items.length || fileMode && !selectedItems.length}>核对清单<ArrowRight size={14} /></button>}
    </div>}
    <dialog className="confirm-dialog maintenance-dialog" ref={dialog} aria-labelledby="maintenance-confirm-title" aria-describedby="maintenance-confirm-description" onCancel={event => { event.preventDefault(); if (!submitting) setReviewOpen(false); }}>
      <div className="confirm-icon">{operation === 'optimize' ? <CheckCircle2 size={23} /> : <Trash2 size={23} />}</div><h2 id="maintenance-confirm-title">确认{tool.title}</h2><p id="maintenance-confirm-description">{tool.impact}</p>
      {flow && <><div className="dialog-file-summary"><span>{fileMode ? '本次选择' : '检查清单'} <strong>{items.length}</strong> 项</span><span>{fileMode ? '只处理下列文件' : '按当前规则整批执行'}</span></div><div className="maintenance-confirm-items">{items.slice(0, 100).map(item => <div key={item.id}><span title={item.path || item.title}>{item.path ? shortPath(item.path, home) : item.title}</span><strong>{item.size != null ? bytes(item.size) : '—'}</strong></div>)}{items.length > 100 && <p>另有 {items.length - 100} 项，可返回页面查看完整清单。</p>}</div></>}
      {!!flow?.cloudCount && <div className="confirm-note"><AlertCircle size={15} /><span>包含 {flow.cloudCount} 个云同步目录，清理可能同步到其他设备，请确认相关内容可以重新生成。</span></div>}
      <div className="confirm-note"><ShieldCheck size={15} /><span>{fileMode ? '执行前已重新核对文件；状态变化或不符合保护规则的项目会跳过。' : '执行时会再次检查当前状态，完成后可查看每个步骤的处理说明。'}</span></div>
      <div className="dialog-actions"><button className="secondary" onClick={() => setReviewOpen(false)} disabled={submitting}>返回核对</button><button className={operation === 'optimize' ? 'primary' : 'danger-button'} onClick={() => act('confirm')} disabled={submitting || !waitingConfirmation}>{submitting ? <Loader2 size={14} className="spin" /> : <Check size={14} />}确认执行</button></div>
    </dialog>
  </div>;
}
