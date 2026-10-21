import { useEffect, useRef, useState } from 'react';
import { Check, Download, ExternalLink, Folder, Loader2, LockKeyhole, RefreshCw, TriangleAlert } from 'lucide-react';
import { dateTime, mole } from './api';
import { isUpdatingMole, type Environment, type MoleUpdate } from './types';

export function MoleInstallationPrompt({ environment, onRefresh, onEnvironment }: {
  environment: Environment;
  onRefresh: () => Promise<Environment | undefined>;
  onEnvironment: (environment: Environment) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function check(choose = false) {
    if (!mole) return;
    setBusy(true); setError('');
    try {
      if (choose) { const next = await mole.chooseMoPath(); if (next) onEnvironment(next); }
      else await onRefresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  const missing = environment.installation === 'missing';
  return <section className="mole-install-prompt card" role="status" aria-label="Mole 安装检测">
    <div className="mole-install-icon"><Download size={23} /></div>
    <div className="mole-install-body">
      <h2>{missing ? '尚未安装 Mole' : '未检测到可用的 Mole'}</h2>
      <p>{missing ? '插件需要本机 Mole 才能运行。请先安装，再回到这里重新检测。' : environment.error || '请检查 Mole 的安装与命令路径。'}</p>
      <div className="mole-install-command"><span>通过 Homebrew 安装</span><code>brew install mole</code></div>
      <p className="mole-install-help">也可按官方说明使用脚本安装。已安装到其他目录时，可以手动选择 mo 文件。</p>
      <div className="mole-environment-actions">
        <button className="primary" onClick={() => void check()} disabled={busy}><RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? '正在检测…' : '我已安装，重新检测'}</button>
        <button className="secondary" onClick={() => mole?.openExternal('https://github.com/tw93/Mole#quick-start')}><ExternalLink size={14} /> 安装说明</button>
        <button className="secondary" onClick={() => void check(true)} disabled={busy}><Folder size={14} /> 选择 mo 路径</button>
      </div>
      {error && <p className="mole-environment-error" role="alert">{error}</p>}
    </div>
  </section>;
}

export function MoleUpdatePanel({ environment, update, taskBusy, onUpdate }: {
  environment?: Environment;
  update?: MoleUpdate;
  taskBusy: boolean;
  onUpdate: () => void;
}) {
  const updating = isUpdatingMole(update);
  const failed = update?.phase === 'failed';
  const succeeded = update?.phase === 'succeeded';
  return <section className={`card mole-update-panel ${failed ? 'failed' : succeeded ? 'succeeded' : ''}`} aria-label="Mole 更新">
    <div className="mole-update-heading">
      <div className="mole-update-title"><span className="mole-update-icon">{updating ? <Loader2 size={20} className="spin" /> : succeeded ? <Check size={20} /> : <Download size={20} />}</span><div><h2>Mole 更新</h2><p>当前版本 {environment?.moVersion || '未检测到'} · 更新至最新稳定版</p></div></div>
      <button className="primary" onClick={onUpdate} disabled={!environment?.ready || taskBusy || updating || !mole?.updateMole}><RefreshCw size={14} className={updating ? 'spin' : ''} /> {updating ? '正在更新…' : failed ? '重试更新' : '更新 Mole'}</button>
    </div>
    <div className="mole-update-status" role="status" aria-live="polite">
      {failed && <TriangleAlert size={15} />}
      <span>{update?.message || '点击后自动检查并更新，Homebrew 与脚本安装均可使用。'}</span>
    </div>
    {update?.detail && <p className="mole-update-detail">{update.detail}</p>}
    {updating && <div className="mole-update-progress" role="progressbar" aria-label="Mole 更新进行中"><span /></div>}
    {taskBusy && !updating && <p className="mole-update-detail">请等待当前维护任务完成后再更新。</p>}
    {!environment?.ready && <p className="mole-update-detail">安装并检测到 Mole 后即可更新。</p>}
    {!mole?.updateMole && <p className="mole-update-detail">请重新加载插件以启用更新功能。</p>}
    {update?.endedAt && <small className="mole-update-time">上次检查 {dateTime(update.endedAt)}</small>}
  </section>;
}

export function MoleUpdatePasswordDialog({ update, onUpdate }: { update: MoleUpdate; onUpdate: (update: MoleUpdate) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => { setPassword(''); setError(''); input.current?.focus(); }, [update.promptToken]);
  function submit(cancel = false) {
    if (!mole) return;
    try {
      onUpdate(mole.authorizeMoleUpdate({ action: cancel ? 'cancel' : 'password', promptToken: update.promptToken, ...(cancel ? {} : { password }) }));
      setPassword(''); setError('');
    } catch (error) { setPassword(''); setError((error as Error).message); }
  }
  return <div className="modal-backdrop mole-update-backdrop">
    <section ref={dialog} className="confirm-dialog mole-update-dialog" role="dialog" aria-modal="true" aria-labelledby="mole-update-auth-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); submit(true); }
      if (event.key === 'Tab') {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') || [])];
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); elements.at(-1)?.focus(); }
        else if (!event.shiftKey && index === elements.length - 1) { event.preventDefault(); elements[0]?.focus(); }
      }
    }}>
      <div className="confirm-icon"><LockKeyhole size={22} /></div>
      <h2 id="mole-update-auth-title">授权更新 Mole</h2>
      <p>{update.message}</p>
      <form onSubmit={event => { event.preventDefault(); submit(); }}>
        <label htmlFor="mole-update-password">Mac 登录密码</label>
        <input ref={input} id="mole-update-password" type="password" autoComplete="off" maxLength={256} value={password} onChange={event => setPassword(event.target.value)} />
        {error && <p className="mole-environment-error" role="alert">{error}</p>}
        <p className="mole-update-auth-note">密码仅用于本次管理员验证，不会保存或写入日志。</p>
        <div className="dialog-actions"><button type="button" className="secondary" onClick={() => submit(true)}>取消更新</button><button className="primary" type="submit" disabled={!password}><LockKeyhole size={14} /> 验证并继续</button></div>
      </form>
    </section>
  </div>;
}
