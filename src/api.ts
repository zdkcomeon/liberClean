import type { ApplicationInventory, MaintenanceActionRequest, EnterAction, Environment, MoleHistory, MoleUpdate, MoleUpdateAuthorization, StartTaskRequest, StatusState, Task, UninstallActionRequest } from './types';
import { createPreviewBridge } from './preview';

export interface AttachedTask {
  task: Task;
  output: string;
  truncated: boolean;
}

export interface MoleBridge {
  version: number;
  getEnvironment(): Promise<Environment>;
  refreshEnvironment(): Promise<Environment>;
  getMoleUpdate(): MoleUpdate;
  updateMole(): MoleUpdate;
  subscribeMoleUpdate(listener: (update: MoleUpdate) => void): () => void;
  authorizeMoleUpdate(request: MoleUpdateAuthorization): MoleUpdate;
  subscribeStatus(listener: (status: StatusState) => void): () => void;
  getStatus(): StatusState;
  getTasks(): Task[];
  getTask(id: string): Task | null;
  startTask(request: StartTaskRequest): Task;
  stopTask(id: string): Task | null;
  sendInput(id: string, data: string): boolean;
  attachTask(id: string, listener: (chunk: string) => void): AttachedTask | null;
  detachTask(id: string, listener: (chunk: string) => void): void;
  subscribeTasks(listener: (task: Task) => void): () => void;
  getApplications(refresh?: boolean): Promise<ApplicationInventory>;
  /** Native system icon for an inventoried app ID; null when unavailable. */
  getApplicationIcon(id: string): Promise<string | null>;
  getHistory(limit?: number): Promise<MoleHistory>;
  uninstallAction(id: string, action: UninstallActionRequest): Task;
  maintenanceAction(id: string, action: MaintenanceActionRequest): Task;
  pickDirectory(): string | null;
  chooseMoPath(): Promise<Environment | null>;
  clearMoPath(): Promise<Environment>;
  openExternal(url: string): void;
  openLog(): void;
  getEnterAction(): EnterAction | null;
  onEnter(listener: (action: EnterAction) => void): () => void;
  getPaths(): { logFile: string };
}

declare global {
  interface Window {
    mole?: MoleBridge;
  }
}

/** Injected by preload.js before the page runs. */
export const previewMode = import.meta.env.DEV && typeof window !== 'undefined' && !window.mole && new URLSearchParams(window.location.search).has('preview');
export const mole: MoleBridge | undefined = typeof window !== 'undefined' ? window.mole ?? (previewMode ? createPreviewBridge() : undefined) : undefined;

export const bytes = (value: number | null | undefined, digits = 1): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 B';
  const index = Math.min(4, Math.max(0, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))));
  return `${(value / 1024 ** index).toFixed(index ? digits : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
};

export const percent = (value?: number | null) => value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;

/** Mole rates are MiB/s; convert before formatting the displayed byte rate. */
export const rate = (value?: number | null) => value == null || !Number.isFinite(value) ? '暂不可用' : `${bytes(value * 1024 ** 2)}/s`;

export const dateTime = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export const shortPath = (value: string, home?: string) => home && (value === home || value.startsWith(`${home}/`))
  ? `~${value.slice(home.length)}`
  : value;

export const duration = (task: Task, now: number) => {
  const start = new Date(task.startedAt).getTime();
  const end = task.endedAt ? new Date(task.endedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
};
