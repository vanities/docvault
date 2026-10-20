// DocVault Alerts. A source (usually a custom job) reports its full set of
// checks; this module keeps each check's trip history, decides when that is
// worth an email, and logs every notification.
//
// Email is bad news only: a check trips, a tripped check is still tripped 6+
// hours after the last email, or a source goes blind (3 failed reports in a row,
// or no report for 3 of its job's intervals). Recoveries never email; they show
// up as "Cleared" inside the next bad-news email and on the Alerts page. The
// owner can turn a source's emails off without stopping its checks.
//
// A source can bring its own page: DATA_DIR/alerts/<id>/dashboard.html, served
// sandboxed and fed the source's data by postMessage (see AlertDashboardMessage).
//
// A source can also declare settings (numbers the owner adjusts on the page, such
// as a trip line). The owner's values live here; the job runner hands them to the
// job at launch (alertSettingsForJob → DOCVAULT_ALERT_SETTINGS).

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR, ensureDir, getEmailConfig } from './data.js';
import { sendEmail } from './email.js';
import { customJobScheduleToMs, listCustomJobManifests, type CustomJobSchedule } from './jobs.js';
import { createLogger } from './logger.js';
import { createWriteLock, writeJsonAtomic } from './write-lock.js';
import type {
  AlertCheck,
  AlertCheckInput,
  AlertJobInfo,
  AlertJobSettings,
  AlertNotification,
  AlertNotificationKind,
  AlertReportInput,
  AlertSeriesPoint,
  AlertSettingSpec,
  AlertSource,
  AlertSourceSettings,
  AlertsResponse,
  AlertsStore,
} from './alerts-types.js';

export type * from './alerts-types.js';

const log = createLogger('alerts');

export const ALERTS_FILE = '.docvault-alerts.json';
export const ALERTS_DIR = 'alerts';
export const DASHBOARD_FILE = 'dashboard.html';
export const MAX_DASHBOARD_BYTES = 2 * 1024 * 1024;
export const REMINDER_MS = 6 * 60 * 60 * 1000;
export const FAILURES_BEFORE_BLIND = 3;
export const STALE_INTERVALS = 3;
export const WATCHDOG_INTERVAL_MS = 15 * 60 * 1000;
export const SERIES_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_LOG_ENTRIES = 200;
export const MAX_CHECKS = 100;
export const MAX_DETAIL_BYTES = 256 * 1024;
export const MAX_SETTINGS = 30;
// Jobs can't run more often than every 10 minutes; this bounds anything else that reports.
const MAX_SERIES_POINTS = 2100;
const MAX_SERIES_KEYS = 200;
// A failed trip email is retried on later reports, but at most this often so a
// missing mail setup doesn't flood the sent-mail log every run.
const SEND_RETRY_MS = 60 * 60 * 1000;

export interface AlertsOptions {
  dataDir?: string;
  now?: Date;
}

const withStore = createWriteLock();

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function storeFile(dataDir: string): string {
  return path.join(dataDir, ALERTS_FILE);
}

function emptyStore(): AlertsStore {
  return { version: 1, sources: {}, log: [] };
}

function isStore(value: unknown): value is AlertsStore {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<AlertsStore>;
  return (
    v.version === 1 &&
    !!v.sources &&
    typeof v.sources === 'object' &&
    !Array.isArray(v.sources) &&
    Array.isArray(v.log)
  );
}

async function loadStore(dataDir: string): Promise<AlertsStore> {
  const file = storeFile(dataDir);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') log.warn(`[store] read failed code=${code ?? 'unknown'}`);
    return emptyStore();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isStore(parsed)) return parsed;
  } catch {
    // handled below
  }
  // Keep the unreadable file for inspection instead of silently overwriting it.
  const aside = `${file}.corrupt-${Date.now()}`;
  await fs.rename(file, aside).catch(() => {});
  log.error(`[store] unreadable store moved aside bytes=${raw.length}`);
  return emptyStore();
}

async function saveStore(dataDir: string, store: AlertsStore): Promise<void> {
  await ensureDir(dataDir);
  await writeJsonAtomic(storeFile(dataDir), store);
}

async function loadJobs(dataDir: string): Promise<Map<string, AlertJobInfo>> {
  const jobs = new Map<string, AlertJobInfo>();
  try {
    for (const record of await listCustomJobManifests(dataDir)) {
      if (record.status !== 'valid') continue;
      const { id, label, schedule, script, enabled, tags } = record.manifest;
      jobs.set(id, { id, label, schedule, script, enabled, tags });
    }
  } catch (err) {
    log.warn(`[jobs] manifest lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return jobs;
}

async function recordNotification(
  dataDir: string,
  notification: AlertNotification,
  apply?: (source: AlertSource) => void
): Promise<void> {
  await withStore(async () => {
    const store = await loadStore(dataDir);
    const source = store.sources[notification.sourceId];
    if (source && apply) apply(source);
    store.log = [notification, ...store.log].slice(0, MAX_LOG_ENTRIES);
    await saveStore(dataDir, store);
  });
}

// ---------------------------------------------------------------------------
// Check merging
// ---------------------------------------------------------------------------

export interface MergedChecks {
  checks: AlertCheck[];
  /** Went from OK (or unknown) to tripped in this report. */
  newTrips: AlertCheck[];
  /** Tripped before, but no email about them has gone out yet (the last send failed). */
  unsent: AlertCheck[];
  /** Tripped before and already emailed; candidates for a reminder. */
  still: AlertCheck[];
  /** Tripped before, OK now (or no longer reported). */
  cleared: AlertCheck[];
}

export function mergeChecks(
  previous: AlertCheck[],
  inputs: AlertCheckInput[],
  now: Date
): MergedChecks {
  const nowIso = now.toISOString();
  const prevById = new Map(previous.map((c) => [c.id, c]));
  const checks: AlertCheck[] = inputs.map((input) => {
    const old = prevById.get(input.id);
    const continuing = input.active && old?.active === true;
    return {
      id: input.id,
      label: input.label,
      scope: input.scope,
      severity: input.severity,
      active: input.active,
      value: input.value,
      threshold: input.threshold,
      since: input.active ? (continuing ? (old.since ?? nowIso) : nowIso) : null,
      lastAlertAt: continuing ? (old.lastAlertAt ?? null) : null,
    };
  });
  const wasActive = (id: string) => prevById.get(id)?.active === true;
  const nowById = new Map(checks.map((c) => [c.id, c]));
  return {
    checks,
    newTrips: checks.filter((c) => c.active && !wasActive(c.id)),
    unsent: checks.filter((c) => c.active && wasActive(c.id) && !c.lastAlertAt),
    still: checks.filter((c) => c.active && wasActive(c.id) && !!c.lastAlertAt),
    cleared: previous
      .filter((old) => old.active && !nowById.get(old.id)?.active)
      .map(
        (old) =>
          nowById.get(old.id) ?? {
            ...old,
            active: false,
            since: null,
            lastAlertAt: null,
            value: 'no longer reported',
          }
      ),
  };
}

function appendSeries(
  series: AlertSeriesPoint[],
  values: Record<string, number | null> | undefined,
  now: Date
): AlertSeriesPoint[] {
  const cutoff = now.getTime() - SERIES_RETENTION_MS;
  const kept = series.filter((p) => Date.parse(p.t) >= cutoff);
  if (values && Object.keys(values).length > 0) kept.push({ t: now.toISOString(), values });
  return kept.slice(-MAX_SERIES_POINTS);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/** The configured `toEmail` can hold a whole newsletter list; alerts go to its first address only. */
export function firstRecipient(list: string | undefined): string | null {
  return (
    list
      ?.split(/[,;\n]+/)
      .map((s) => s.trim())
      .find(Boolean) ?? null
  );
}

interface AlertMessage {
  subject: string;
  html: string;
  text: string;
}

async function deliver(
  kind: AlertNotificationKind,
  sourceId: string,
  message: AlertMessage
): Promise<{ ok: boolean; error?: string }> {
  const t0 = performance.now();
  try {
    const to = firstRecipient((await getEmailConfig()).toEmail);
    if (!to) {
      log.warn(`[email] skipped kind=${kind} source=${sourceId}: no recipient configured`);
      return { ok: false, error: 'No email recipient configured' };
    }
    const res = await sendEmail({
      purpose: 'news',
      to,
      cc: '',
      subject: message.subject,
      html: message.html,
      text: message.text,
      ref: `alerts:${sourceId}:${kind}`,
    });
    log.info(
      `[email] kind=${kind} source=${sourceId} ok=${res.ok} in ${(performance.now() - t0).toFixed(0)}ms`
    );
    return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'Send failed' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`[email] kind=${kind} source=${sourceId} threw: ${error}`);
    return { ok: false, error };
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
}

function formatDuration(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/** Label plus scope, unless the label already names the scope. */
export function checkName(check: Pick<AlertCheckInput, 'label' | 'scope'>): string {
  return check.scope && !check.label.toLowerCase().includes(check.scope.toLowerCase())
    ? `${check.label} (${check.scope})`
    : check.label;
}

const severityRank = (c: AlertCheck) => (c.severity === 'critical' ? 0 : 1);

export function alertSubject(active: AlertCheck[]): string {
  const primary = [...active].sort((a, b) => severityRank(a) - severityRank(b))[0];
  return primary.severity === 'critical'
    ? `ACT NOW: ${primary.label}`
    : `Alert warning: ${checkName(primary)}`;
}

const FOOTER =
  'DocVault Alerts emails only when a check trips, then every 6 hours while it stays tripped. Recoveries do not email.';

function renderMessage(
  subject: string,
  title: string,
  intro: string,
  sections: Array<{ title: string; lines: Array<{ text: string; critical?: boolean }> }>,
  advice?: string
): AlertMessage {
  const text = [
    title,
    intro,
    ...sections.flatMap((s) => ['', s.title, ...s.lines.map((l) => `- ${l.text}`)]),
    ...(advice ? ['', 'What to do', advice] : []),
    '',
    FOOTER,
  ].join('\n');
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2430">`,
    `<h2 style="margin:0 0 4px">${escapeHtml(title)}</h2>`,
    `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`,
    ...sections.map(
      (s) =>
        `<h3 style="margin:16px 0 4px;font-size:14px">${escapeHtml(s.title)}</h3><ul style="margin:0;padding-left:20px">${s.lines
          .map((l) => `<li${l.critical ? ' style="color:#b42318"' : ''}>${escapeHtml(l.text)}</li>`)
          .join('')}</ul>`
    ),
    advice
      ? `<h3 style="margin:16px 0 4px;font-size:14px">What to do</h3><p style="margin:0">${escapeHtml(advice)}</p>`
      : '',
    `<p style="margin:20px 0 0;color:#667085;font-size:12px">${escapeHtml(FOOTER)}</p>`,
    `</div>`,
  ].join('');
  return { subject, html, text };
}

function checkLine(c: AlertCheck, now: Date, withAge: boolean) {
  const age =
    withAge && c.since
      ? `, tripped ${formatDuration(now.getTime() - Date.parse(c.since))} ago`
      : '';
  const tag = c.severity === 'critical' ? 'CRITICAL' : 'Warning';
  return {
    text: `${tag}: ${checkName(c)} is ${c.value} (trips ${c.threshold})${age}`,
    critical: c.severity === 'critical',
  };
}

function buildCheckEmail(
  source: AlertSource,
  groups: { tripped: AlertCheck[]; still: AlertCheck[]; cleared: AlertCheck[] },
  kind: 'trip' | 'reminder',
  now: Date
): AlertMessage {
  const active = [...groups.tripped, ...groups.still];
  const critical = active.some((c) => c.severity === 'critical');
  const sections = [];
  if (groups.tripped.length > 0) {
    sections.push({
      title: 'Just tripped',
      lines: groups.tripped.map((c) => checkLine(c, now, false)),
    });
  }
  if (groups.still.length > 0) {
    sections.push({
      title: 'Still tripped',
      lines: groups.still.map((c) => checkLine(c, now, true)),
    });
  }
  if (groups.cleared.length > 0) {
    sections.push({
      title: 'Cleared',
      lines: groups.cleared.map((c) => ({ text: `${checkName(c)} is back to ${c.value}` })),
    });
  }
  return renderMessage(
    alertSubject(active),
    source.label,
    kind === 'trip' ? 'A check just tripped.' : 'Reminder: checks are still tripped.',
    sections,
    critical ? source.advice?.critical : source.advice?.warning
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AlertReportOutcome {
  emailed: AlertNotificationKind | null;
  emailError?: string;
  active: number;
  newTrips: number;
  cleared: number;
}

export async function reportAlerts(
  input: AlertReportInput,
  opts: AlertsOptions = {}
): Promise<AlertReportOutcome> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const now = opts.now ?? new Date();
  const t0 = performance.now();

  const plan = await withStore(async () => {
    const store = await loadStore(dataDir);
    const previous = store.sources[input.sourceId];
    const merged = mergeChecks(previous?.checks ?? [], input.checks, now);
    const source: AlertSource = {
      id: input.sourceId,
      label: input.label,
      ...(input.description ? { description: input.description } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      reportedAt: now.toISOString(),
      failures: 0,
      failureNotifiedAt: null,
      staleNotifiedAt: null,
      // Owner settings, not report data: a report never turns emails back on or resets a value.
      ...(previous?.emails === false ? { emails: false } : {}),
      ...(input.settings?.length ? { settings: input.settings } : {}),
      ...keptValues(input.sourceId, previous?.values, input.settings),
      checks: merged.checks,
      ...(input.advice ? { advice: input.advice } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
      series: appendSeries(previous?.series ?? [], input.series, now),
    };
    store.sources[input.sourceId] = source;
    await saveStore(dataDir, store);

    const lastSend = store.log.find((n) => n.sourceId === input.sourceId && n.kind !== 'blind');
    const retryAllowed =
      !lastSend || lastSend.ok || now.getTime() - Date.parse(lastSend.at) >= SEND_RETRY_MS;
    const due = merged.still.filter(
      (c) => now.getTime() - Date.parse(c.lastAlertAt ?? '') >= REMINDER_MS
    );
    const kind: 'trip' | 'reminder' | null =
      merged.newTrips.length > 0 || (merged.unsent.length > 0 && retryAllowed)
        ? 'trip'
        : due.length > 0
          ? 'reminder'
          : null;
    return { source, merged, kind };
  });

  const { source, merged, kind } = plan;
  const active = source.checks.filter((c) => c.active);
  const outcome: AlertReportOutcome = {
    emailed: null,
    active: active.length,
    newTrips: merged.newTrips.length,
    cleared: merged.cleared.length,
  };

  // Muted checks stay unstamped, so turning emails back on mails whatever is still tripped.
  const muted = source.emails === false;
  if (kind && !muted) {
    const tripped = [...merged.newTrips, ...merged.unsent];
    const message = buildCheckEmail(
      source,
      { tripped, still: active.filter((c) => !tripped.includes(c)), cleared: merged.cleared },
      kind,
      now
    );
    const sent = await deliver(kind, source.id, message);
    const sinceById = new Map(active.map((c) => [c.id, c.since]));
    await recordNotification(
      dataDir,
      {
        at: now.toISOString(),
        sourceId: source.id,
        kind,
        subject: message.subject,
        ok: sent.ok,
        checkIds: active.map((c) => c.id),
      },
      (stored) => {
        if (!sent.ok) return;
        // Only stamp checks still in the same trip episode the email described.
        for (const check of stored.checks) {
          if (check.active && check.since === sinceById.get(check.id)) {
            check.lastAlertAt = now.toISOString();
          }
        }
      }
    );
    if (sent.ok) outcome.emailed = kind;
    else outcome.emailError = sent.error;
  }

  log.info(
    `[report] source=${source.id} checks=${source.checks.length} active=${outcome.active} new=${outcome.newTrips} cleared=${outcome.cleared} email=${kind ?? 'none'}${kind ? (muted ? ':muted' : `:${outcome.emailed ? 'sent' : 'failed'}`) : ''} in ${(performance.now() - t0).toFixed(0)}ms`
  );
  return outcome;
}

export interface AlertFailureOutcome {
  emailed: 'blind' | null;
  emailError?: string;
  failures: number;
}

export async function reportAlertFailure(
  sourceId: string,
  error: string,
  opts: AlertsOptions = {}
): Promise<AlertFailureOutcome> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const now = opts.now ?? new Date();

  const plan = await withStore(async () => {
    const store = await loadStore(dataDir);
    const source: AlertSource = store.sources[sourceId] ?? {
      id: sourceId,
      label: sourceId,
      reportedAt: null,
      failures: 0,
      checks: [],
      series: [],
    };
    source.failures = (source.failures ?? 0) + 1;
    source.lastError = error.slice(0, 500);
    store.sources[sourceId] = source;
    await saveStore(dataDir, store);
    return {
      label: source.label,
      failures: source.failures,
      notify:
        source.failures >= FAILURES_BEFORE_BLIND &&
        !source.failureNotifiedAt &&
        source.emails !== false,
    };
  });

  log.warn(`[failure] source=${sourceId} failures=${plan.failures} notify=${plan.notify}`);
  if (!plan.notify) return { emailed: null, failures: plan.failures };

  const message = renderMessage(
    `Alert blind: ${plan.label} can't see its data`,
    plan.label,
    `The last ${plan.failures} checks failed, so DocVault can't tell whether anything tripped.`,
    [{ title: 'Last error', lines: [{ text: error.slice(0, 500) }] }],
    'Look at the job in Settings → Jobs. You will not get another email about this until it recovers and something trips.'
  );
  const sent = await deliver('blind', sourceId, message);
  await recordNotification(
    dataDir,
    {
      at: now.toISOString(),
      sourceId,
      kind: 'blind',
      subject: message.subject,
      ok: sent.ok,
      checkIds: [],
    },
    (stored) => {
      if (sent.ok) stored.failureNotifiedAt = now.toISOString();
    }
  );
  return sent.ok
    ? { emailed: 'blind', failures: plan.failures }
    : { emailed: null, emailError: sent.error, failures: plan.failures };
}

/**
 * Sends one "stopped reporting" email per stale episode for sources whose job is
 * enabled but hasn't reported in STALE_INTERVALS of its schedule. A disabled job
 * is paused on purpose, so it never counts as stale.
 */
export async function checkStaleAlertSources(
  opts: AlertsOptions = {}
): Promise<{ checked: number; notified: string[] }> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const now = opts.now ?? new Date();
  const t0 = performance.now();
  const [store, jobs] = await Promise.all([loadStore(dataDir), loadJobs(dataDir)]);

  const notified: string[] = [];
  for (const source of Object.values(store.sources)) {
    if (!source.jobId || !source.reportedAt || source.staleNotifiedAt) continue;
    // A failing job also goes stale; the failure-streak email already told the owner it's blind.
    if (source.failureNotifiedAt || source.emails === false) continue;
    const job = jobs.get(source.jobId);
    if (!job?.enabled) continue;
    let intervalMs: number;
    try {
      intervalMs = customJobScheduleToMs(job.schedule as CustomJobSchedule);
    } catch {
      continue;
    }
    const ageMs = now.getTime() - Date.parse(source.reportedAt);
    if (!(ageMs > STALE_INTERVALS * intervalMs)) continue;

    const message = renderMessage(
      `Alert blind: ${source.label} stopped reporting`,
      source.label,
      `No report in ${formatDuration(ageMs)} (its job runs ${job.schedule}), so DocVault can't tell whether anything tripped.`,
      [],
      'Look at the job in Settings → Jobs. You will not get another email about this until it reports again.'
    );
    const sent = await deliver('blind', source.id, message);
    await recordNotification(
      dataDir,
      {
        at: now.toISOString(),
        sourceId: source.id,
        kind: 'blind',
        subject: message.subject,
        ok: sent.ok,
        checkIds: [],
      },
      (stored) => {
        if (sent.ok && stored.reportedAt === source.reportedAt)
          stored.staleNotifiedAt = now.toISOString();
      }
    );
    if (sent.ok) notified.push(source.id);
  }

  log.debug(
    `[watchdog] sources=${Object.keys(store.sources).length} notified=${notified.length} in ${(performance.now() - t0).toFixed(0)}ms`
  );
  return { checked: Object.keys(store.sources).length, notified };
}

export function startAlertsWatchdog(dataDir: string = DATA_DIR): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    checkStaleAlertSources({ dataDir })
      .catch((err) =>
        log.error(`[watchdog] failed: ${err instanceof Error ? err.message : String(err)}`)
      )
      .finally(() => {
        running = false;
      });
  }, WATCHDOG_INTERVAL_MS);
  timer.unref?.();
  log.info(`[watchdog] started, every ${WATCHDOG_INTERVAL_MS / 60_000}m`);
  return () => clearInterval(timer);
}

export async function listAlerts(opts: AlertsOptions = {}): Promise<AlertsResponse> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const [store, jobs] = await Promise.all([loadStore(dataDir), loadJobs(dataDir)]);
  const sorted = Object.values(store.sources).sort((a, b) => a.label.localeCompare(b.label));
  const dashboards = await Promise.all(sorted.map((s) => resolveDashboard(s.id, dataDir)));
  return {
    sources: sorted.map((s, i) => ({
      ...s,
      job: s.jobId ? (jobs.get(s.jobId) ?? null) : null,
      hasDashboard: dashboards[i] !== null,
    })),
    log: store.log,
  };
}

/** A settings change the source can't take (unknown key, out of range); the route answers 400. */
export class AlertSettingsError extends Error {}

export async function setAlertSourceSettings(
  id: string,
  settings: AlertSourceSettings,
  opts: AlertsOptions = {}
): Promise<AlertSource | null> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  return withStore(async () => {
    const store = await loadStore(dataDir);
    const source = store.sources[id];
    if (!source) return null;
    // Validate everything before changing anything, so a bad value saves nothing.
    if (settings.values) source.values = nextValues(source, settings.values);
    if (!source.values || Object.keys(source.values).length === 0) delete source.values;
    if (settings.emails === true) delete source.emails;
    else if (settings.emails === false) source.emails = false;
    await saveStore(dataDir, store);
    log.info(
      `[settings] source=${id}${settings.emails !== undefined ? ` emails=${settings.emails}` : ''}${settings.values ? ` changed=${Object.keys(settings.values).join(',')} overrides=${Object.keys(source.values ?? {}).length}` : ''}`
    );
    return source;
  });
}

/**
 * DOCVAULT_ALERT_SETTINGS for one run of a job: the owner's values for every source that job
 * reports. Read at launch, so a run always sees the values saved before it started.
 */
export async function alertSettingsForJob(
  jobId: string,
  opts: AlertsOptions = {}
): Promise<AlertJobSettings> {
  const store = await loadStore(opts.dataDir ?? DATA_DIR);
  const out: AlertJobSettings = {};
  for (const source of Object.values(store.sources)) {
    if (source.jobId === jobId && source.values && Object.keys(source.values).length > 0) {
      out[source.id] = source.values;
    }
  }
  return out;
}

function inRange(spec: AlertSettingSpec, value: number): boolean {
  return (
    (spec.min === undefined || value >= spec.min) && (spec.max === undefined || value <= spec.max)
  );
}

function rangeText(spec: AlertSettingSpec): string {
  if (spec.min !== undefined && spec.max !== undefined)
    return `between ${spec.min} and ${spec.max}`;
  return spec.min !== undefined ? `at least ${spec.min}` : `at most ${spec.max}`;
}

/** The owner's values after an edit; only values that differ from the default are kept. */
function nextValues(
  source: AlertSource,
  updates: Record<string, number | null>
): Record<string, number> {
  const specs = new Map((source.settings ?? []).map((s) => [s.key, s]));
  if (specs.size === 0) throw new AlertSettingsError('This alert has no settings to change');
  const next = { ...(source.values ?? {}) };
  for (const [key, value] of Object.entries(updates)) {
    const spec = specs.get(key);
    if (!spec) throw new AlertSettingsError(`Unknown setting "${key}"`);
    if (value === null || value === spec.default) {
      delete next[key];
      continue;
    }
    if (!inRange(spec, value)) {
      throw new AlertSettingsError(`${spec.label} must be ${rangeText(spec)}`);
    }
    next[key] = value;
  }
  return next;
}

/**
 * The owner's values that still fit what a report declares. A report without a settings list
 * keeps every value, so a job that briefly stops declaring them doesn't wipe the owner's numbers.
 */
function keptValues(
  sourceId: string,
  values: Record<string, number> | undefined,
  specs: AlertSettingSpec[] | undefined
): { values?: Record<string, number> } {
  if (!values || Object.keys(values).length === 0) return {};
  if (!specs) return { values };
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const kept: Record<string, number> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const spec = byKey.get(key);
    if (spec && inRange(spec, value) && value !== spec.default) kept[key] = value;
    else dropped.push(key);
  }
  if (dropped.length > 0) {
    log.info(
      `[settings] source=${sourceId} dropped=${dropped.join(',')} (no longer declared, out of range, or now the default)`
    );
  }
  return Object.keys(kept).length > 0 ? { values: kept } : {};
}

// ---------------------------------------------------------------------------
// Dashboard files
// ---------------------------------------------------------------------------

/**
 * Absolute path of a source's dashboard file, or null when there is none. The
 * real path must stay inside DATA_DIR/alerts, so a symlink can't serve files
 * from elsewhere on disk.
 */
async function resolveDashboard(id: string, dataDir: string): Promise<string | null> {
  if (!SOURCE_ID_RE.test(id)) return null;
  const root = path.join(dataDir, ALERTS_DIR);
  try {
    const [realRoot, realFile] = await Promise.all([
      fs.realpath(root),
      fs.realpath(path.join(root, id, DASHBOARD_FILE)),
    ]);
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
      log.warn(`[dashboard] source=${id} resolves outside the alerts directory; ignored`);
      return null;
    }
    const stat = await fs.stat(realFile);
    return stat.isFile() ? realFile : null;
  } catch {
    return null;
  }
}

export async function readAlertDashboard(
  id: string,
  opts: AlertsOptions = {}
): Promise<string | null> {
  const file = await resolveDashboard(id, opts.dataDir ?? DATA_DIR);
  if (!file) return null;
  const stat = await fs.stat(file);
  if (stat.size > MAX_DASHBOARD_BYTES) {
    log.warn(`[dashboard] source=${id} bytes=${stat.size} over the ${MAX_DASHBOARD_BYTES} cap`);
    return null;
  }
  return fs.readFile(file, 'utf8');
}

export async function removeAlertSource(id: string, opts: AlertsOptions = {}): Promise<boolean> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  return withStore(async () => {
    const store = await loadStore(dataDir);
    if (!store.sources[id]) return false;
    delete store.sources[id];
    await saveStore(dataDir, store);
    log.info(`[remove] source=${id}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const JOB_ID_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DETAIL_KIND_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Plain identifiers, so a job can read them as object keys without quoting.
const SETTING_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unknown = Object.keys(obj).find((k) => !allowed.includes(k));
  if (unknown) throw new Error(`${where}: unknown field "${unknown}"`);
}

function text(
  value: unknown,
  where: string,
  max: number,
  opts: { optional?: boolean; allowEmpty?: boolean; pattern?: RegExp } = {}
): string | undefined {
  if (value === undefined && opts.optional) return undefined;
  if (typeof value !== 'string') throw new Error(`${where} must be a string`);
  if (!opts.allowEmpty && value.trim() === '') throw new Error(`${where} must not be empty`);
  if (value.length > max) throw new Error(`${where} must be at most ${max} characters`);
  if (opts.pattern && !opts.pattern.test(value)) throw new Error(`${where} has an invalid format`);
  return value;
}

function finite(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${where} must be a finite number`);
  }
  return value;
}

function parseSettingSpec(raw: unknown, index: number): AlertSettingSpec {
  const where = `settings[${index}]`;
  if (!isRecord(raw)) throw new Error(`${where} must be an object`);
  onlyKeys(raw, ['key', 'label', 'default', 'unit', 'min', 'max', 'step', 'help'], where);
  const spec: AlertSettingSpec = {
    key: text(raw.key, `${where}.key`, 64, { pattern: SETTING_KEY_RE })!,
    label: text(raw.label, `${where}.label`, 120)!,
    default: finite(raw.default, `${where}.default`),
  };
  const unit = text(raw.unit, `${where}.unit`, 16, { optional: true });
  if (unit) spec.unit = unit;
  if (raw.min !== undefined) spec.min = finite(raw.min, `${where}.min`);
  if (raw.max !== undefined) spec.max = finite(raw.max, `${where}.max`);
  if (raw.step !== undefined) {
    spec.step = finite(raw.step, `${where}.step`);
    if (spec.step <= 0) throw new Error(`${where}.step must be greater than 0`);
  }
  const help = text(raw.help, `${where}.help`, 300, { optional: true });
  if (help) spec.help = help;
  if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
    throw new Error(`${where}.min must not be greater than max`);
  }
  if (!inRange(spec, spec.default)) throw new Error(`${where}.default must be ${rangeText(spec)}`);
  return spec;
}

function parseCheck(raw: unknown, index: number): AlertCheckInput {
  const where = `checks[${index}]`;
  if (!isRecord(raw)) throw new Error(`${where} must be an object`);
  onlyKeys(raw, ['id', 'label', 'scope', 'severity', 'active', 'value', 'threshold'], where);
  if (raw.severity !== 'critical' && raw.severity !== 'warning') {
    throw new Error(`${where}.severity must be "critical" or "warning"`);
  }
  if (typeof raw.active !== 'boolean') throw new Error(`${where}.active must be a boolean`);
  return {
    id: text(raw.id, `${where}.id`, 120, { pattern: KEY_RE })!,
    label: text(raw.label, `${where}.label`, 200)!,
    scope: text(raw.scope ?? '', `${where}.scope`, 120, { allowEmpty: true })!,
    severity: raw.severity,
    active: raw.active,
    value: text(raw.value, `${where}.value`, 120, { allowEmpty: true })!,
    threshold: text(raw.threshold, `${where}.threshold`, 120, { allowEmpty: true })!,
  };
}

/** Strict parse of a POST /api/alerts/report body. Throws with a readable message. */
export function parseAlertReport(raw: unknown): AlertReportInput {
  if (!isRecord(raw)) throw new Error('body must be a JSON object');
  onlyKeys(
    raw,
    [
      'sourceId',
      'label',
      'description',
      'jobId',
      'checks',
      'advice',
      'detail',
      'series',
      'settings',
    ],
    'body'
  );
  const input: AlertReportInput = {
    sourceId: text(raw.sourceId, 'sourceId', 64, { pattern: SOURCE_ID_RE })!,
    label: text(raw.label, 'label', 120)!,
    checks: [],
  };
  const description = text(raw.description, 'description', 500, {
    optional: true,
    allowEmpty: true,
  });
  if (description) input.description = description;
  const jobId = text(raw.jobId, 'jobId', 81, { optional: true, pattern: JOB_ID_RE });
  if (jobId) input.jobId = jobId;

  if (!Array.isArray(raw.checks)) throw new Error('checks must be an array');
  if (raw.checks.length > MAX_CHECKS)
    throw new Error(`checks must have at most ${MAX_CHECKS} entries`);
  input.checks = raw.checks.map(parseCheck);
  const ids = new Set(input.checks.map((c) => c.id));
  if (ids.size !== input.checks.length) throw new Error('checks must have unique ids');

  if (raw.advice !== undefined) {
    if (!isRecord(raw.advice)) throw new Error('advice must be an object');
    onlyKeys(raw.advice, ['critical', 'warning'], 'advice');
    const critical = text(raw.advice.critical, 'advice.critical', 2000, { optional: true });
    const warning = text(raw.advice.warning, 'advice.warning', 2000, { optional: true });
    input.advice = { ...(critical ? { critical } : {}), ...(warning ? { warning } : {}) };
  }

  if (raw.detail !== undefined) {
    if (!isRecord(raw.detail)) throw new Error('detail must be an object');
    onlyKeys(raw.detail, ['kind', 'data'], 'detail');
    const kind = text(raw.detail.kind, 'detail.kind', 64, { pattern: DETAIL_KIND_RE })!;
    const bytes = Buffer.byteLength(JSON.stringify(raw.detail.data ?? null), 'utf8');
    if (bytes > MAX_DETAIL_BYTES) {
      throw new Error(
        `detail.data must be at most ${MAX_DETAIL_BYTES / 1024} KB (got ${Math.ceil(bytes / 1024)} KB)`
      );
    }
    input.detail = { kind, data: raw.detail.data ?? null };
  }

  if (raw.series !== undefined) {
    if (!isRecord(raw.series)) throw new Error('series must be an object of key → number | null');
    const entries = Object.entries(raw.series);
    if (entries.length > MAX_SERIES_KEYS)
      throw new Error(`series must have at most ${MAX_SERIES_KEYS} keys`);
    const series: Record<string, number | null> = {};
    for (const [key, value] of entries) {
      if (!KEY_RE.test(key))
        throw new Error(`series key "${key.slice(0, 40)}" has an invalid format`);
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error(`series.${key} must be a finite number or null`);
      }
      series[key] = value;
    }
    input.series = series;
  }

  if (raw.settings !== undefined) {
    if (!Array.isArray(raw.settings)) throw new Error('settings must be an array');
    if (raw.settings.length > MAX_SETTINGS) {
      throw new Error(`settings must have at most ${MAX_SETTINGS} entries`);
    }
    input.settings = raw.settings.map(parseSettingSpec);
    if (new Set(input.settings.map((s) => s.key)).size !== input.settings.length) {
      throw new Error('settings must have unique keys');
    }
  }
  return input;
}

/** Strict parse of a PUT /api/alerts/sources/:id/settings body. Ranges are checked on save. */
export function parseAlertSettings(raw: unknown): AlertSourceSettings {
  if (!isRecord(raw)) throw new Error('body must be a JSON object');
  onlyKeys(raw, ['emails', 'values'], 'body');
  const out: AlertSourceSettings = {};
  if (raw.emails !== undefined) {
    if (typeof raw.emails !== 'boolean') throw new Error('emails must be a boolean');
    out.emails = raw.emails;
  }
  if (raw.values !== undefined) {
    if (!isRecord(raw.values)) throw new Error('values must be an object of key → number | null');
    const entries = Object.entries(raw.values);
    if (entries.length > MAX_SETTINGS) {
      throw new Error(`values must have at most ${MAX_SETTINGS} keys`);
    }
    out.values = {};
    for (const [key, value] of entries) {
      if (!SETTING_KEY_RE.test(key)) {
        throw new Error(`values key "${key.slice(0, 40)}" has an invalid format`);
      }
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error(`values.${key} must be a finite number or null`);
      }
      out.values[key] = value;
    }
  }
  if (out.emails === undefined && out.values === undefined) {
    throw new Error('body must set emails, values, or both');
  }
  return out;
}

/** Strict parse of a POST /api/alerts/report-failure body. */
export function parseAlertFailure(raw: unknown): { sourceId: string; error: string } {
  if (!isRecord(raw)) throw new Error('body must be a JSON object');
  onlyKeys(raw, ['sourceId', 'error'], 'body');
  return {
    sourceId: text(raw.sourceId, 'sourceId', 64, { pattern: SOURCE_ID_RE })!,
    error: text(raw.error, 'error', 2000)!,
  };
}
