/** Pages rendered by the plugin shell. */
export type Operation = 'analyze' | 'clean' | 'uninstall' | 'optimize' | 'purge' | 'installer';
export type Page = 'overview' | Operation | 'history' | 'settings';
export type MaintenanceOperation = 'clean' | 'optimize' | 'purge' | 'installer';
export type TaskState = 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled';
export type ScanStatus = 'complete' | 'partial' | 'unavailable';

export interface ScanEntry {
  name: string;
  path: string;
  size: number | null;
  isDir: boolean;
  scanStatus: ScanStatus;
}

export interface ScanReport {
  path: string;
  scanStatus: ScanStatus;
  overview: boolean;
  entries: ScanEntry[];
  largeFiles: ScanEntry[];
  totalSize: number | null;
  totalFiles: number | null;
}

/** Mole fields are converted from snake_case by the preload bridge. */
export interface Snapshot {
  collectedAt?: string;
  host?: string;
  platform?: string;
  uptime?: string;
  healthScore?: number;
  healthScoreMsg?: string;
  hardware?: { model?: string; cpuModel?: string; totalRam?: string; osVersion?: string };
  cpu?: { usage?: number; perCore?: number[]; logicalCpu?: number; coreCount?: number; load1?: number };
  memory?: { total?: number; used?: number; available?: number; usedPercent?: number; swapUsed?: number; pressure?: string };
  disks?: { mount: string; device: string; used: number; total: number; usedPercent: number; external?: boolean }[];
  /** Mole reports disk and network rates in MiB/s. */
  diskIo?: { readRate?: number; writeRate?: number };
  network?: { name?: string; interface?: string; rxRateMbs?: number; txRateMbs?: number }[] | null;
  networkHistory?: { rxHistory?: number[]; txHistory?: number[] };
  batteries?: { percent?: number; status?: string; health?: string; cycleCount?: number }[];
  thermal?: { cpuTemp?: number; fanSpeed?: number; batteryTemp?: number };
  topProcesses?: { pid: number; name: string; cpu?: number; memory?: number }[] | null;
}

export interface StatusState {
  state: 'starting' | 'live' | 'error';
  snapshot: Snapshot | null;
  receivedAt: string | null;
  error?: string;
}

export interface Environment {
  ready: boolean;
  /** Missing means no command was found; unavailable means an existing command could not run. */
  installation?: 'ready' | 'missing' | 'unavailable';
  moPath: string;
  moVersion: string;
  home: string;
  platform: string;
  pathSource?: 'auto' | 'manual';
  error?: string;
}

/** Graphical state of the explicitly requested update of the selected Mole installation. */
export interface MoleUpdate {
  phase: 'idle' | 'checking' | 'updating' | 'authorizing' | 'verifying' | 'succeeded' | 'failed';
  id: string;
  message: string;
  detail: string;
  fromVersion: string;
  toVersion: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Single-use challenge for the current administrator prompt. */
  promptToken: string;
  /** Latest installation check, present after the process finishes. */
  environment?: Environment;
}

export interface MoleUpdateAuthorization {
  action: 'password' | 'cancel';
  promptToken: string;
  /** Passed only to the waiting process, never persisted or logged. */
  password?: string;
}

export const isUpdatingMole = (update?: MoleUpdate) => !!update && ['checking', 'updating', 'authorizing', 'verifying'].includes(update.phase);

export interface MoleHistory {
  sessions: {
    command?: string;
    runId?: string;
    attribution?: string;
    startedAt?: string;
    endedAt?: string;
    items?: number;
    size?: string;
    failedTasks?: number;
  }[];
  deletions: { timestamp?: string; mode?: string; status?: string; sizeKb?: number; path?: string }[];
  limit?: number;
}

/** Read-only application metadata supplied by Mole; sizeLabel is unavailable when N/A. */
export interface InstalledApp {
  id: string;
  name: string;
  bundleId: string;
  path: string;
  source: string;
  sizeLabel: string;
  selectable: boolean;
  reason?: string;
}

/** A shared asynchronous inventory; an error may retain an older list. */
export interface ApplicationInventory {
  state: 'loading' | 'ready' | 'error';
  apps: InstalledApp[];
  updatedAt: string | null;
  error?: string;
}

/** Paths are extracted from Mole's own review. Kept and reviewOnly entries are not removal targets. */
export interface UninstallFile {
  path: string;
  sizeLabel?: string;
  kind: 'app' | 'related' | 'system' | 'reviewOnly' | 'kept';
}

/** Structured guided uninstall state. promptToken authorizes only the current one-use action. */
export interface UninstallFlow {
  phase: 'preparing' | 'reviewed' | 'confirm' | 'authorizing' | 'executing' | 'completed' | 'failed' | 'cancelled';
  promptToken?: string;
  files: UninstallFile[] | null;
  notices: string[] | null;
  outcome?: 'preview' | 'complete' | 'partial' | 'failed' | 'unknown';
  message?: string;
}

/** A reviewed maintenance item. IDs refer only to the server-owned preview, never to an arbitrary path. */
export interface MaintenanceItem {
  /** Opaque item ID; pass it back with previewTaskId for file selection. */
  id: string;
  title: string;
  /** Absolute local path, or an empty string for a system optimization step. */
  path: string;
  group: string;
  /** Measured bytes; null means the size is unavailable. */
  size: number | null;
  detail: string;
  /** Only purge/installer items with a verified identity can be selected. */
  selectable: boolean;
  status: 'ready' | 'removed' | 'skipped';
}

/** Progress comes from Mole's actual steps and result messages. */
export interface MaintenanceStep {
  id: string;
  title: string;
  detail: string;
  status: 'running' | 'completed' | 'warning';
}

/** Graphical review, confirmation and administrator authentication for maintenance. */
export interface MaintenanceFlow {
  phase: 'preparing' | 'reviewed' | 'confirm' | 'authorizing' | 'executing' | 'completed' | 'failed' | 'cancelled';
  /** File operations support selection; batch operations follow Mole's full rule set. */
  kind: 'files' | 'batch';
  items: MaintenanceItem[];
  steps: MaintenanceStep[];
  messages: { id: string; tone: 'info' | 'warning'; text: string }[];
  selectedIds: string[];
  previewTaskId: string;
  /** One-use token, present only while waiting for confirmation or a password. */
  promptToken?: string;
  allowSkip?: boolean;
  cloudCount?: number;
  scanStatus: 'complete' | 'partial';
  outcome?: 'preview' | 'complete' | 'partial' | 'unknown' | 'failed' | 'cancelled';
  message: string;
  summary?: { selectedCount: number; completedCount: number; failedCount: number };
}

/** A structured action is accepted only for its current task and one-use prompt token. */
export interface MaintenanceActionRequest {
  action: 'confirm' | 'password' | 'skip';
  promptToken: string;
  /** Only for password actions; sent to Mole without storage or logging. */
  password?: string;
}

/** A task is owned by the preload bridge; terminal output is attached separately. */
export interface Task {
  id: string;
  operation: Operation;
  mode: 'scan' | 'preview' | 'execute';
  state: TaskState;
  pty: boolean;
  cols?: number;
  rows?: number;
  createdAt: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  error: string;
  path?: string;
  result?: ScanReport;
  apps?: InstalledApp[];
  uninstall?: UninstallFlow;
  maintenance?: MaintenanceFlow;
}

export interface StartTaskRequest {
  operation: Operation;
  mode: 'scan' | 'preview' | 'execute';
  path?: string;
  appIds?: string[];
  /** Completed preview task whose server-owned items are being executed; required for maintenance execution. */
  previewTaskId?: string;
  /** Opaque selected item IDs from previewTaskId; required for project and installer cleanup. */
  itemIds?: string[];
  cols?: number;
  rows?: number;
}

export interface UninstallActionRequest {
  action: 'confirm' | 'password';
  promptToken: string;
  password?: string;
}

export interface EnterAction {
  code: string;
  type: string;
  payload?: unknown;
  from?: string;
}

export const isActive = (task?: Task) => !!task && (task.state === 'running' || task.state === 'cancelling');

export const stateLabels: Record<TaskState, string> = {
  running: '运行中',
  cancelling: '正在停止',
  succeeded: '已完成',
  failed: '执行失败',
  cancelled: '已停止'
};
