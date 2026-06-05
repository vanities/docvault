import { promises as fs } from 'fs';
import path from 'path';
import type { Settings } from './data.js';
import type { ScheduleStatusMap, ScheduleTaskName, ScheduleTaskStatus } from './scheduler.js';

const JOB_ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
const SCRIPT_RE = /^scripts\/[a-zA-Z0-9._/-]+\.local\.(js|ts|sh)$/;

export type CustomJobSchedule = 'hourly' | 'daily' | `every ${number}h`;

export type CustomJobManifest = {
  id: string;
  label: string;
  kind: 'local-script';
  schedule: CustomJobSchedule;
  script: string;
  enabled: boolean;
  tags: string[];
};

export type CustomJobRecord =
  | {
      status: 'valid';
      path: string;
      manifest: CustomJobManifest;
    }
  | {
      status: 'invalid';
      path: string;
      error: string;
    };

export type BuiltInJobRecord = {
  id: string;
  label: string;
  kind: 'built-in';
  description: string;
  enabled: boolean;
  schedule: string;
  tags: string[];
  status: ScheduleTaskStatus;
};

export type CreateCustomJobOptions = {
  dataDir: string;
  overwrite?: boolean;
};

export type CustomJobScriptStatus = {
  path: string;
  exists: boolean;
  runnable: boolean;
  repaired: boolean;
  message: string | null;
};

export const JOBS_DIR = 'jobs';
export const JOBS_MANIFESTS_DIR = 'manifests';
export const JOBS_SCRIPTS_DIR = 'scripts';
export const JOBS_RUNS_DIR = 'runs';
export const JOBS_LOGS_DIR = 'logs';

function emptyStatus(): ScheduleTaskStatus {
  return {
    lastRanAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
    running: false,
  };
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseSchedule(value: unknown): CustomJobSchedule {
  const schedule = assertString(value, 'schedule');
  if (schedule === 'hourly' || schedule === 'daily') return schedule;
  if (/^every [1-9][0-9]*h$/.test(schedule)) return schedule as CustomJobSchedule;
  throw new Error('schedule must be hourly, daily, or every Nh');
}

function parseTags(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('tags must be an array');
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function parseCustomJobManifest(raw: unknown): CustomJobManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('manifest must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const id = assertString(obj.id, 'id');
  if (!JOB_ID_RE.test(id)) {
    throw new Error('id must be lowercase kebab-case');
  }

  const script = assertString(obj.script, 'script');
  if (!SCRIPT_RE.test(script) || script.includes('..')) {
    throw new Error(
      'script must live under scripts/ and end with .local.js, .local.ts, or .local.sh'
    );
  }

  const rawKind = obj.kind;
  if (rawKind !== undefined && rawKind !== 'local-script') {
    throw new Error('kind must be local-script when provided');
  }

  return {
    id,
    label: assertString(obj.label, 'label'),
    kind: 'local-script',
    schedule: parseSchedule(obj.schedule),
    script,
    enabled: obj.enabled === undefined ? false : obj.enabled === true,
    tags: parseTags(obj.tags),
  };
}

export function jobsRoot(dataDir: string): string {
  return path.join(dataDir, JOBS_DIR);
}

export function jobsManifestsDir(dataDir: string): string {
  return path.join(jobsRoot(dataDir), JOBS_MANIFESTS_DIR);
}

export function customJobScheduleToMs(schedule: CustomJobSchedule): number {
  if (schedule === 'hourly') return 60 * 60 * 1000;
  if (schedule === 'daily') return 24 * 60 * 60 * 1000;
  const match = /^every ([1-9][0-9]*)h$/.exec(schedule);
  if (!match) throw new Error('unsupported custom job schedule');
  return Number(match[1]) * 60 * 60 * 1000;
}

export function customJobScriptPath(dataDir: string, script: string): string {
  if (!SCRIPT_RE.test(script) || script.includes('..')) {
    throw new Error(
      'script must live under scripts/ and end with .local.js, .local.ts, or .local.sh'
    );
  }
  const relativeScript = script.replace(/^scripts\//, '');
  const scriptsDir = path.join(jobsRoot(dataDir), JOBS_SCRIPTS_DIR);
  const resolved = path.resolve(scriptsDir, relativeScript);
  if (!resolved.startsWith(`${path.resolve(scriptsDir)}${path.sep}`)) {
    throw new Error('script must live under scripts/');
  }
  return resolved;
}

export function customJobManifestPath(dataDir: string, id: string): string {
  if (!JOB_ID_RE.test(id)) throw new Error('id must be lowercase kebab-case');
  return path.join(jobsManifestsDir(dataDir), `${id}.json`);
}

export async function ensureJobsLayout(dataDir: string): Promise<void> {
  const root = jobsRoot(dataDir);
  await Promise.all([
    fs.mkdir(path.join(root, JOBS_MANIFESTS_DIR), { recursive: true }),
    fs.mkdir(path.join(root, JOBS_SCRIPTS_DIR), { recursive: true }),
    fs.mkdir(path.join(root, JOBS_RUNS_DIR), { recursive: true }),
    fs.mkdir(path.join(root, JOBS_LOGS_DIR), { recursive: true }),
  ]);
}

export async function createCustomJobManifest(
  raw: unknown,
  options: CreateCustomJobOptions
): Promise<CustomJobManifest> {
  const manifest = parseCustomJobManifest(raw);
  await ensureJobsLayout(options.dataDir);
  const manifestPath = customJobManifestPath(options.dataDir, manifest.id);

  if (!options.overwrite) {
    try {
      await fs.access(manifestPath);
      throw new Error(`custom job already exists: ${manifest.id}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('custom job already exists')) {
        throw err;
      }
    }
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

function readOptionalScriptContent(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const value = obj.scriptContent ?? obj.scriptBody;
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('scriptContent must be a string when provided');
  return value;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function prepareCustomJobScript(
  raw: unknown,
  manifest: CustomJobManifest,
  options: CreateCustomJobOptions
): Promise<CustomJobScriptStatus> {
  const scriptPath = customJobScriptPath(options.dataDir, manifest.script);
  const content = readOptionalScriptContent(raw);
  let repaired = false;

  if (content != null) {
    if (!options.overwrite && (await fileExists(scriptPath))) {
      throw new Error(`custom job script already exists: ${manifest.script}`);
    }
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, content.replace(/\r\n?/g, '\n'), { mode: 0o700 });
    repaired = true;
  } else if (!(await fileExists(scriptPath))) {
    return {
      path: scriptPath,
      exists: false,
      runnable: false,
      repaired: false,
      message:
        'script file does not exist yet; create it under DATA_DIR/jobs/scripts before running',
    };
  }

  try {
    const current = await fs.readFile(scriptPath, 'utf8');
    const normalized = current.replace(/\r\n?/g, '\n');
    if (normalized !== current) {
      await fs.writeFile(scriptPath, normalized, { mode: 0o700 });
      repaired = true;
    }
  } catch {
    // Binary/non-UTF8 scripts are not expected for local jobs; still chmod below
    // so a copied shell/js/ts script has a chance to run.
  }

  await fs.chmod(scriptPath, 0o700);
  return {
    path: scriptPath,
    exists: true,
    runnable: true,
    repaired,
    message: repaired ? 'script normalized and chmodded 0700' : 'script already runnable',
  };
}

export async function listCustomJobManifests(dataDir: string): Promise<CustomJobRecord[]> {
  await ensureJobsLayout(dataDir);
  const manifestsDir = jobsManifestsDir(dataDir);
  const entries = await fs.readdir(manifestsDir, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry): Promise<CustomJobRecord> => {
        const manifestPath = path.join(manifestsDir, entry.name);
        try {
          const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
          return {
            status: 'valid',
            path: manifestPath,
            manifest: parseCustomJobManifest(raw),
          };
        } catch (err) {
          return {
            status: 'invalid',
            path: manifestPath,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
  );
}

type BuiltInDefinition = {
  id: string;
  label: string;
  description: string;
  taskName: ScheduleTaskName;
  tags: string[];
  enabled: (schedules: Settings['schedules']) => boolean;
  schedule: (schedules: Settings['schedules']) => string;
};

const BUILT_IN_JOBS: BuiltInDefinition[] = [
  {
    id: 'snapshot',
    label: 'Portfolio Snapshot',
    description: 'Refreshes balances/prices and writes a portfolio snapshot.',
    taskName: 'snapshot',
    tags: ['built-in', 'finance', 'snapshot'],
    enabled: (schedules) => schedules?.snapshotEnabled !== false,
    schedule: (schedules) => `every ${schedules?.snapshotIntervalMinutes || 1440}m`,
  },
  {
    id: 'dropbox-sync',
    label: 'Dropbox Sync',
    description: 'Runs sync-to-dropbox.sh via rclone and triggers encrypted config backup.',
    taskName: 'dropboxSync',
    tags: ['built-in', 'sync', 'backup'],
    enabled: (schedules) => schedules?.dropboxSyncEnabled !== false,
    schedule: (schedules) => `every ${schedules?.dropboxSyncIntervalMinutes || 15}m`,
  },
  {
    id: 'encrypted-backup',
    label: 'Encrypted Config Backup',
    description: 'Creates an encrypted bundle before Dropbox sync when a backup password is set.',
    taskName: 'encryptedBackup',
    tags: ['built-in', 'backup'],
    enabled: (schedules) =>
      schedules?.dropboxSyncEnabled !== false && Boolean(schedules?.backupPassword),
    schedule: () => 'with dropbox-sync',
  },
  {
    id: 'quant-refresh',
    label: 'Quant Refresh',
    description: 'Refreshes quant signals and writes daily quant snapshot data.',
    taskName: 'quantRefresh',
    tags: ['built-in', 'quant'],
    enabled: (schedules) => schedules?.quantRefreshEnabled !== false,
    schedule: (schedules) => `every ${schedules?.quantRefreshIntervalMinutes || 1440}m`,
  },
  {
    id: 'politics-refresh',
    label: 'Congress / Politics Refresh',
    description: 'Forward-only ingest of recent bills, executive actions, and politician trades.',
    taskName: 'politicsRefresh',
    tags: ['built-in', 'politics'],
    enabled: (schedules) => schedules?.politicsRefreshEnabled !== false,
    schedule: (schedules) => `every ${schedules?.politicsRefreshIntervalMinutes || 1440}m`,
  },
  {
    id: 'daily-news',
    label: 'Daily News',
    description:
      'Synthesizes a newspaper edition each morning (weekly deep-dive on the configured day).',
    taskName: 'dailyNewsRefresh',
    tags: ['built-in', 'news'],
    enabled: (schedules) => schedules?.dailyNewsEnabled === true,
    schedule: (schedules) =>
      `daily at ${String(schedules?.dailyNewsHour ?? 7).padStart(2, '0')}:00`,
  },
];

export function listBuiltInJobRecords(
  scheduleStatus: Partial<ScheduleStatusMap> = {},
  schedules: Settings['schedules'] = {}
): BuiltInJobRecord[] {
  return BUILT_IN_JOBS.map((job) => ({
    id: job.id,
    label: job.label,
    kind: 'built-in',
    description: job.description,
    enabled: job.enabled(schedules),
    schedule: job.schedule(schedules),
    tags: job.tags,
    status: scheduleStatus[job.taskName] ?? emptyStatus(),
  }));
}
