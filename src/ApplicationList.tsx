import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { InstalledApp } from './types';
import { ApplicationIcon } from './ApplicationIcon';

interface Props {
  apps: InstalledApp[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (app: InstalledApp) => void;
  iconRevision?: string | null;
}

const availableSize = (value: string) => !value || value.startsWith('N/A') || value === 'Unknown' ? '大小暂不可用' : value;

/** Small inventories keep native tab order; large inventories use measured virtual rows. */
export const ApplicationList = memo(function ApplicationList({ apps, selected, disabled, onToggle, iconRevision }: Props) {
  const list = useRef<VirtuosoHandle>(null);
  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const virtualized = apps.length > 100;
  const focusPendingRow = useCallback(() => {
    if (pendingFocus.current == null) return;
    const input = container.current?.querySelector<HTMLInputElement>(`[data-app-index="${pendingFocus.current}"] input`);
    if (input) { pendingFocus.current = null; input.focus({ preventScroll: true }); }
  }, []);

  useEffect(() => {
    setFocusedIndex(0);
    pendingFocus.current = null;
    if (virtualized) list.current?.scrollToIndex({ index: 0, behavior: 'auto' });
  }, [apps, virtualized]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!virtualized || disabled || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
    const currentIndex = (event.target as HTMLElement).matches('input') ? focusedIndex : direction > 0 ? -1 : apps.length;
    let index = event.key === 'Home' ? 0 : event.key === 'End' ? apps.length - 1 : currentIndex + direction;
    while (index >= 0 && index < apps.length && (!apps[index].selectable || selected.size >= 20 && !selected.has(apps[index].id))) index += direction;
    if (index < 0 || index >= apps.length) return;
    pendingFocus.current = index;
    setFocusedIndex(index);
    list.current?.scrollIntoView({ index, behavior: 'auto', done: focusPendingRow });
  }

  const renderRow = (index: number, app: InstalledApp) => <div role="listitem" aria-setsize={apps.length} aria-posinset={index + 1} data-app-index={index} className={`application-row ${selected.has(app.id) ? 'selected' : ''} ${!app.selectable ? 'unselectable' : ''}`} key={app.id}>
    <label className="application-select">
      <input type="checkbox" aria-label={`选择 ${app.name}`} checked={selected.has(app.id)} disabled={disabled || !app.selectable || selected.size >= 20 && !selected.has(app.id)} tabIndex={virtualized && focusedIndex !== index ? -1 : 0} onFocus={virtualized ? () => setFocusedIndex(index) : undefined} onChange={() => onToggle(app)} />
      <ApplicationIcon app={app} revision={iconRevision} />
      <div className="application-text"><strong title={app.name}>{app.name}</strong><span title={app.path}>{app.path}</span>{!app.selectable && <small>{app.reason}</small>}</div>
    </label>
    <span className={`app-source ${app.source === 'Homebrew' ? 'brew' : ''}`}>{app.source === 'Homebrew' ? 'Homebrew' : '应用程序'}</span><span className="app-size">{availableSize(app.sizeLabel)}</span>
  </div>;

  return <div ref={container} className={`app-list ${virtualized ? 'virtual-app-list' : ''}`} role="list" aria-label={`应用列表，共 ${apps.length.toLocaleString()} 项`} aria-describedby={virtualized ? 'application-keyboard-help' : undefined} tabIndex={virtualized ? 0 : undefined} onKeyDown={onKeyDown}>
    {virtualized ? <Virtuoso ref={list} data={apps} computeItemKey={(_, app) => app.id} increaseViewportBy={200} itemContent={renderRow} itemsRendered={() => { if (pendingFocus.current != null) requestAnimationFrame(focusPendingRow); }} style={{ height: '100%' }} /> : apps.map((app, index) => renderRow(index, app))}
  </div>;
});
