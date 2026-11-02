// DocVault health: an alert add-on that watches DocVault itself. Backups that stopped, a
// scheduled job that keeps failing, outbound mail that bounces, or a data drive filling up
// all fail silently; this reports them to DocVault Alerts (POST /api/alerts/report), which
// emails only when a check trips. Its page is DATA_DIR/alerts/docvault-health/dashboard.html.
//
// An internet outage is not a broken DocVault. A job or task the server marked as waiting for
// the internet (offlineSince) is neither failing nor stalled, a send that failed while it was
// down isn't a delivery failure, and a job only counts as stalled after it has had its full
// three intervals of server uptime with a working connection. The Internet check trips only
// for a long outage: it can't email while the line is down, so its email arriving means the
// server's connection probe disagrees with a line that works.
//
// Env: DOCVAULT_DRY_RUN=1 prints the report instead of sending it.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';

const envFlag = (v?: string) => v === '1' || v === 'true' || v === 'yes';
const DRY = envFlag(process.env.DOCVAULT_DRY_RUN);
const DATA_DIR = process.env.DOCVAULT_DATA_DIR || '/data';
const JOB_ID = process.env.DOCVAULT_JOB_ID || 'docvault-health';
const SOURCE_ID = 'docvault-health';
const API = process.env.DOCVAULT_API_BASE || 'http://127.0.0.1:3005';

// Adjustable on the Alerts page (Edit settings). The job runner passes the owner's values in
// DOCVAULT_ALERT_SETTINGS; anything unset keeps the default here.
const SETTINGS = [
  { key: 'backupWarnHours', label: 'Backup warning after', unit: 'hours', default: 24, min: 1, max: 720, step: 1, help: 'Time since the last backup sync.' },
  { key: 'backupCriticalHours', label: 'Backup critical after', unit: 'hours', default: 72, min: 1, max: 2160, step: 1 },
  { key: 'jobFailureRuns', label: 'Job failing after', unit: 'runs', default: 3, min: 1, max: 50, step: 1, help: 'Failed runs in a row.' },
  { key: 'diskWarnPct', label: 'Disk warning at', unit: '%', default: 90, min: 50, max: 100, step: 1, help: 'Space used on the data drive.' },
  { key: 'diskCriticalPct', label: 'Disk critical at', unit: '%', default: 97, min: 50, max: 100, step: 1 },
  { key: 'internetDownHours', label: 'Internet down warning after', unit: 'hours', default: 6, min: 1, max: 168, step: 1, help: 'How long the server has found no route to the internet.' },
];
const owner: Record<string, unknown> = (() => {
  try {
    return JSON.parse(process.env.DOCVAULT_ALERT_SETTINGS || '{}')[SOURCE_ID] ?? {};
  } catch {
    console.log(`[${SOURCE_ID}] WARN DOCVAULT_ALERT_SETTINGS is not valid JSON; using defaults`);
    return {};
  }
})();
const setting = (key: string): number => {
  const value = owner[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : SETTINGS.find((s) => s.key === key)!.default;
};
console.log(`[${SOURCE_ID}] settings changed by the owner: ${Object.keys(owner).join(',') || 'none'}`);

const BACKUP_WARN_HOURS = setting('backupWarnHours');
const BACKUP_CRITICAL_HOURS = setting('backupCriticalHours');
const JOB_FAILURE_RUNS = setting('jobFailureRuns');
const STALE_INTERVALS = 3;
const DISK_WARN_PCT = setting('diskWarnPct');
const DISK_CRITICAL_PCT = setting('diskCriticalPct');
const INTERNET_DOWN_HOURS = setting('internetDownHours');
const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;

type Severity = 'critical' | 'warning';
interface Check {
  id: string;
  label: string;
  scope: string;
  severity: Severity;
  active: boolean;
  value: string;
  threshold: string;
  event?: string;
}
interface SyncStatus {
  status?: string;
  lastSync?: string | null;
  errors?: number;
  entitiesSynced?: number;
  nextSync?: string | null;
}
interface JobStatus {
  lastRanAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures?: number;
  running?: boolean;
  /** Set by the server while the last run failed because the internet was down. */
  offlineSince?: string | null;
}
interface Outage {
  from: string;
  to: string | null;
}
/** From GET /api/jobs; absent on servers older than the connectivity check. */
interface Connectivity {
  online: boolean;
  bootedAt: string;
  offlineSince: string | null;
  lastOutageEnd: string | null;
  outages?: Outage[];
}
interface JobsResponse {
  builtInJobs: { id: string; label: string; enabled: boolean; schedule: string; status: JobStatus }[];
  customJobs: { manifest: { id: string; label: string; enabled: boolean; schedule: string } }[];
  customJobStatuses: Record<string, JobStatus>;
  connectivity?: Connectivity;
}
interface EmailEntry {
  at: string;
  ok: boolean;
  purpose: string;
  /** The send failed because the internet was down. */
  offline?: boolean;
}
interface JobRow {
  id: string;
  label: string;
  kind: 'built-in' | 'custom';
  enabled: boolean;
  schedule: string;
  lastRanAt: string | null;
  lastSuccessAt: string | null;
  failures: number;
  lastError: string | null;
  offlineSince: string | null;
  state: 'failing' | 'stale' | 'waiting' | 'ok' | 'off' | 'new';
}

const t0 = performance.now();
const ms = (start: number) => (performance.now() - start).toFixed(0);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const log = (line: string) => console.log(`[${SOURCE_ID}] ${line}`);
const clip = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);
const age = (iso: string | null | undefined, now: number) =>
  iso && Number.isFinite(Date.parse(iso)) ? now - Date.parse(iso) : null;
const hours = (msValue: number) => (msValue < HOUR_MS ? `${Math.round(msValue / 60000)} min` : `${(msValue / HOUR_MS).toFixed(1)} h`);

async function getJson<T>(pathname: string): Promise<T> {
  const start = performance.now();
  const res = await fetch(`${API}${pathname}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${pathname} HTTP ${res.status}`);
  const body = (await res.json()) as T;
  log(`get ${pathname} ok in ${ms(start)}ms`);
  return body;
}

async function post(pathname: string, body: unknown): Promise<{ emailed?: string | null; emailError?: string; failures?: number }> {
  const start = performance.now();
  const res = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  log(`post ${pathname} status=${res.status} in ${ms(start)}ms`);
  if (!res.ok) throw new Error(`${pathname} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** Interval for the schedule strings DocVault uses; null when a job only follows another one. */
function scheduleMs(schedule: string): number | null {
  if (schedule === 'hourly') return HOUR_MS;
  if (schedule === 'daily' || schedule.startsWith('daily at')) return DAY_MS;
  if (schedule.startsWith('weekly')) return 7 * DAY_MS;
  const m = /^every ([1-9][0-9]*)([mh])$/.exec(schedule);
  return m ? Number(m[1]) * (m[2] === 'h' ? HOUR_MS : 60_000) : null;
}

async function diskUsage(dir: string): Promise<{ usedPct: number; freeGb: number; totalGb: number }> {
  try {
    const s = await fs.statfs(dir);
    const used = (s.blocks - s.bfree) * s.bsize;
    const avail = s.bavail * s.bsize;
    return { usedPct: (used / (used + avail)) * 100, freeGb: avail / 1e9, totalGb: (used + avail) / 1e9 };
  } catch {
    // Older runtimes lack statfs; `df -Pk` is POSIX and present in the image.
    const { stdout } = await promisify(execFile)('df', ['-Pk', dir]);
    const cols = stdout.trim().split('\n').at(-1)?.split(/\s+/) ?? [];
    const usedK = Number(cols[2]);
    const availK = Number(cols[3]);
    if (!Number.isFinite(usedK) || !Number.isFinite(availK)) throw new Error(`could not read disk usage for ${dir}`);
    return { usedPct: (usedK / (usedK + availK)) * 100, freeGb: (availK * 1024) / 1e9, totalGb: ((usedK + availK) * 1024) / 1e9 };
  }
}

/**
 * The earliest moment a job could have run with a working connection: the later of this
 * server's boot and the end of the last internet outage. Hours the server was off, or the
 * line was down, aren't a job going quiet. -Infinity when the server doesn't report it.
 */
function couldRunSince(conn: Connectivity | undefined): number {
  const boot = Date.parse(conn?.bootedAt ?? '');
  const back = Date.parse(conn?.lastOutageEnd ?? '');
  return Math.max(Number.isFinite(boot) ? boot : -Infinity, Number.isFinite(back) ? back : -Infinity);
}

function jobRows(jobs: JobsResponse, now: number): JobRow[] {
  const since = couldRunSince(jobs.connectivity);
  // Time since the last success that the job actually had to succeed in; null if it never has.
  const quietMs = (lastSuccessAt: string | null) => {
    const last = Date.parse(lastSuccessAt ?? '');
    return Number.isFinite(last) ? now - Math.max(last, since) : null;
  };
  const rows: JobRow[] = [];
  for (const j of jobs.builtInJobs) {
    const st = j.status;
    const waiting = !!st.offlineSince;
    const erroredLast =
      !!st.lastError && (!st.lastSuccessAt || Date.parse(st.lastRanAt ?? '') > Date.parse(st.lastSuccessAt));
    // Built-ins don't count failures in a row, so a last-run error counts as failing only once
    // the job has also gone 3 of its intervals without a success (one partial run is normal).
    const interval = scheduleMs(j.schedule) ?? DAY_MS;
    const quiet = quietMs(st.lastSuccessAt);
    const failing =
      j.enabled && !waiting && erroredLast && (quiet === null || quiet > STALE_INTERVALS * interval);
    rows.push({
      id: j.id,
      label: j.label,
      kind: 'built-in',
      enabled: j.enabled,
      schedule: j.schedule,
      lastRanAt: st.lastRanAt,
      lastSuccessAt: st.lastSuccessAt,
      failures: erroredLast ? 1 : 0,
      lastError: st.lastError ? clip(st.lastError, 200) : null,
      offlineSince: st.offlineSince ?? null,
      state: !j.enabled ? 'off' : waiting ? 'waiting' : failing ? 'failing' : !st.lastRanAt ? 'new' : 'ok',
    });
  }
  for (const c of jobs.customJobs) {
    const m = c.manifest;
    if (m.id === JOB_ID) continue;
    const st = jobs.customJobStatuses[m.id] ?? { lastRanAt: null, lastSuccessAt: null, lastError: null };
    const waiting = !!st.offlineSince;
    const failures = st.consecutiveFailures ?? 0;
    const interval = scheduleMs(m.schedule);
    const quiet = quietMs(st.lastSuccessAt);
    const failing = m.enabled && !waiting && failures >= JOB_FAILURE_RUNS;
    const stale =
      m.enabled && !waiting && !failing && interval !== null && quiet !== null && quiet > STALE_INTERVALS * interval;
    rows.push({
      id: m.id,
      label: m.label,
      kind: 'custom',
      enabled: m.enabled,
      schedule: m.schedule,
      lastRanAt: st.lastRanAt,
      lastSuccessAt: st.lastSuccessAt,
      failures,
      lastError: st.lastError ? clip(st.lastError, 200) : null,
      offlineSince: st.offlineSince ?? null,
      state: !m.enabled ? 'off' : waiting ? 'waiting' : failing ? 'failing' : stale ? 'stale' : !st.lastRanAt ? 'new' : 'ok',
    });
  }
  return rows;
}

const now = Date.now();
log(`start dry=${DRY} api=${API}`);

let sync: SyncStatus;
let jobs: JobsResponse;
let emails: EmailEntry[];
let disk: { usedPct: number; freeGb: number; totalGb: number };
try {
  sync = await getJson<SyncStatus>('/api/sync-status');
  jobs = await getJson<JobsResponse>('/api/jobs');
  emails = (await getJson<{ entries: EmailEntry[] }>('/api/email/log?limit=200')).entries ?? [];
  const start = performance.now();
  disk = await diskUsage(DATA_DIR);
  log(`disk ${DATA_DIR} read in ${ms(start)}ms`);
} catch (e) {
  log(`fetch failed: ${errMsg(e)}`);
  if (!DRY) {
    try {
      const r = await post('/api/alerts/report-failure', { sourceId: SOURCE_ID, error: errMsg(e) });
      log(`failure reported failures=${r.failures} emailed=${r.emailed ?? 'none'}`);
    } catch (err) {
      log(`could not report the failure: ${errMsg(err)}`);
    }
  }
  console.log(`[${SOURCE_ID}] done status=fetch-failed in ${ms(t0)}ms`);
  process.exit(1);
}

// ---------- backups ----------
const dropboxJob = jobs.builtInJobs.find((j) => j.id === 'dropbox-sync');
const encryptedJob = jobs.builtInJobs.find((j) => j.id === 'encrypted-backup');
const lastSync = sync.lastSync ?? (dropboxJob?.enabled ? dropboxJob.status.lastSuccessAt : null);
const backupConfigured = !!lastSync || (sync.status !== undefined && sync.status !== 'unknown');
const backupAgeMs = age(lastSync, now);
const backupAgeHours = backupAgeMs === null ? null : backupAgeMs / HOUR_MS;
const backupTooOld = backupAgeHours !== null && backupAgeHours >= BACKUP_WARN_HOURS;
const syncErrors = sync.errors ?? 0;

// ---------- internet ----------
const conn = jobs.connectivity;
const outages = conn?.outages ?? [];
const downAt = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? '');
  return (
    Number.isFinite(t) &&
    outages.some((o) => Date.parse(o.from) <= t && t <= (o.to ? Date.parse(o.to) : now))
  );
};
const downMs = conn?.offlineSince ? age(conn.offlineSince, now) : null;
const lastOutage = outages.find((o) => o.to);
// The sync failed because it couldn't reach Dropbox, not because backups are broken.
const syncErrorsOffline =
  syncErrors > 0 && (!!dropboxJob?.status.offlineSince || downAt(sync.lastSync));

// ---------- jobs ----------
const rows = jobRows(jobs, now);
const failing = rows.filter((r) => r.state === 'failing');
const stale = rows.filter((r) => r.state === 'stale');
const waiting = rows.filter((r) => r.state === 'waiting');
const names = (list: JobRow[]) => clip(list.map((r) => r.label).join(', '), 90);
if (waiting.length) log(`waiting for the internet: ${waiting.map((r) => r.id).join(', ')}`);

// ---------- email ----------
// A send that failed while the internet was down is the outage, not a delivery problem.
const recent24All = emails.filter((e) => (age(e.at, now) ?? Infinity) <= DAY_MS);
const recent24 = recent24All.filter((e) => !e.offline);
const offline24h = recent24All.length - recent24.length;
const sent24h = recent24.filter((e) => e.ok).length;
const failed24h = recent24.length - sent24h;
const lastFailure = emails.find((e) => !e.ok && !e.offline);

const checks: Check[] = [
  {
    id: 'backup:age',
    label: 'Backup age',
    scope: 'Backup',
    severity: backupAgeHours !== null && backupAgeHours >= BACKUP_CRITICAL_HOURS ? 'critical' : 'warning',
    active: backupConfigured && backupTooOld,
    value: !backupConfigured ? 'not configured' : backupAgeMs === null ? 'no successful sync yet' : `${hours(backupAgeMs)} since the last sync`,
    threshold: `${BACKUP_WARN_HOURS} h without a sync (${BACKUP_CRITICAL_HOURS} h is critical)`,
  },
  {
    id: 'backup:errors',
    label: 'Backup errors',
    scope: 'Backup',
    severity: 'warning',
    active: backupConfigured && syncErrors > 0 && !syncErrorsOffline,
    value: !backupConfigured
      ? 'not configured'
      : `${syncErrors} ${syncErrors === 1 ? 'error' : 'errors'} in the last sync` +
        (syncErrorsOffline ? ' (the internet was down; it syncs again when it is back)' : ''),
    threshold: 'any error while the internet is up',
  },
  {
    id: 'jobs:failing',
    label: 'Failing jobs',
    scope: 'Jobs',
    severity: 'warning',
    active: failing.length > 0,
    value: failing.length ? `${failing.length} failing: ${names(failing)}` : `none of ${rows.filter((r) => r.enabled).length} running`,
    threshold: `${JOB_FAILURE_RUNS}+ failed runs in a row`,
  },
  {
    id: 'jobs:stale',
    label: 'Stalled jobs',
    scope: 'Jobs',
    severity: 'warning',
    active: stale.length > 0,
    value: stale.length ? `${stale.length} stale: ${names(stale)}` : 'all on schedule',
    threshold: `no success in ${STALE_INTERVALS}x its schedule`,
  },
  {
    id: 'email:failing',
    label: 'Email delivery',
    scope: 'Email',
    severity: 'warning',
    active: failed24h > 0,
    value:
      (failed24h ? `${failed24h} of ${recent24.length} failed in 24 h` : `${sent24h} sent in 24 h, none failed`) +
      (offline24h ? `; ${offline24h} more waited out an internet outage` : ''),
    threshold: 'any failed send in 24 h while the internet was up',
    // A failed send stays in the 24 h window long after the owner heard about it. A fixed event
    // makes this email once per stretch of failures instead of every 6 hours until it ages out.
    ...(failed24h > 0 ? { event: 'failed-sends' } : {}),
  },
  {
    id: 'disk:space',
    label: 'Disk space',
    scope: 'Disk',
    severity: disk.usedPct >= DISK_CRITICAL_PCT ? 'critical' : 'warning',
    active: disk.usedPct >= DISK_WARN_PCT,
    value: `${disk.usedPct.toFixed(1)}% used, ${disk.freeGb.toFixed(0)} GB free`,
    threshold: `${DISK_WARN_PCT}% used (${DISK_CRITICAL_PCT}% is critical)`,
  },
  {
    id: 'internet:down',
    label: 'Internet',
    scope: 'Network',
    severity: 'warning',
    // Its email can only go out over a working line, so receiving it means the server's
    // connection probe is wrong (DOCVAULT_CONNECTIVITY_PROBES), not that the internet is out.
    active: downMs !== null && downMs >= INTERNET_DOWN_HOURS * HOUR_MS,
    value: !conn
      ? 'not reported by this server'
      : downMs !== null
        ? `down for ${hours(downMs)}${waiting.length ? `; ${waiting.length} job(s) waiting` : ''}`
        : lastOutage
          ? `up; the last outage lasted ${hours(Date.parse(lastOutage.to!) - Date.parse(lastOutage.from))} and ended ${hours(now - Date.parse(lastOutage.to!))} ago`
          : 'up',
    threshold: `down ${INTERNET_DOWN_HOURS} h or more`,
  },
];
for (const c of checks) log(`check ${c.id} ${c.active ? 'TRIPPED' : 'ok'} value="${c.value}"`);

const round = (n: number | null, digits: number) => (n === null || !Number.isFinite(n) ? null : Number(n.toFixed(digits)));
const report = {
  sourceId: SOURCE_ID,
  label: 'DocVault health',
  description: 'Backups, scheduled jobs, outbound email, disk space and the internet connection',
  jobId: JOB_ID,
  settings: SETTINGS,
  checks,
  advice: {
    critical:
      'Open Settings to see what stopped. Backups and email matter most: check the Dropbox connection and the email settings first, then free up space if the data drive is nearly full.',
    warning:
      'Something in DocVault needs a look. Settings > Jobs shows the failing job and its last error; the email log shows failed sends.',
  },
  detail: {
    kind: 'docvault-health',
    data: {
      backup: {
        configured: backupConfigured,
        lastSync,
        ageHours: round(backupAgeHours, 2),
        status: sync.status ?? null,
        errors: syncErrors,
        entitiesSynced: sync.entitiesSynced ?? null,
        nextSync: sync.nextSync ?? null,
        encryptedBackupAt: encryptedJob?.enabled ? encryptedJob.status.lastSuccessAt : null,
      },
      jobs: rows,
      // Time, purpose and outcome only: recipients and subjects stay out of the page.
      email: { recent: emails.slice(0, 12).map((e) => ({ at: e.at, ok: e.ok, purpose: e.purpose, offline: !!e.offline })), sent24h, failed24h, offline24h, lastFailureAt: lastFailure?.at ?? null },
      disk: { usedPct: round(disk.usedPct, 2), freeGb: round(disk.freeGb, 1), totalGb: round(disk.totalGb, 1) },
      internet: conn
        ? { online: conn.online, offlineSince: conn.offlineSince, bootedAt: conn.bootedAt, outages: outages.slice(0, 10) }
        : null,
    },
  },
  series: {
    'backup.hoursSinceSync': round(backupAgeHours, 2),
    'jobs.failing': failing.length,
    'email.failed24h': failed24h,
    'disk.usedPct': round(disk.usedPct, 2),
  },
};

let outcome = 'dry';
if (DRY) {
  log(`dry run: would report checks=${checks.length} active=${checks.filter((c) => c.active).length} bytes=${JSON.stringify(report).length}`);
  if (envFlag(process.env.DOCVAULT_PRINT_REPORT)) console.log(JSON.stringify(report));
} else {
  try {
    const r = await post('/api/alerts/report', report);
    outcome = `reported emailed=${r.emailed ?? 'none'}${r.emailError ? ` emailError="${r.emailError}"` : ''}`;
  } catch (e) {
    log(`report failed: ${errMsg(e)}`);
    console.log(`[${SOURCE_ID}] done status=report-failed in ${ms(t0)}ms`);
    process.exit(1);
  }
}
console.log(
  `[${SOURCE_ID}] done status=ok checks=${checks.length} active=${checks.filter((c) => c.active).length} ${outcome} in ${ms(t0)}ms`
);
