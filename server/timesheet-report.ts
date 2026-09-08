// Scheduled timesheet report — a categorized summary of recent raw time
// entries, delivered as an HTML email with a CSV attachment so a billing
// contact can fold the hours into downstream client bills without re-typing.
//
// Pure pieces (window math, the due-gate, categorization, HTML/CSV rendering)
// are exported for unit tests; only sendWeeklyReport touches the store, the
// clock, and email. Scheduling mirrors Daily News: the scheduler arms a
// self-rescheduling timeout at the configured local hour and the gate here
// decides whether a send is actually due (weekday + hour + cadence gap).
//
// Two invariants worth keeping: the client/project scope filter is a privacy
// boundary (one recipient must not see another client's hours), and category
// resolution puts the recorded sub-client ahead of keyword rules.

import type {
  ReportCadence,
  TimesheetStore,
  WeeklyReportConfig,
  WeeklyReportRule,
} from './timesheet-store.js';
import { entryTimeKey, loadTimesheetStore, saveTimesheetStore } from './timesheet-store.js';
import { sendEmail } from './email.js';
import { zonedParts } from './tz.js';
import { createLogger } from './logger.js';

const log = createLogger('Timesheet');

// ============================================================================
// Config
// ============================================================================

export const DEFAULT_WEEKLY_REPORT: WeeklyReportConfig = {
  enabled: false,
  to: '',
  day: 5, // Friday
  hour: 15,
  cadence: 'weekly',
  windowDays: 7,
  clientIds: [],
  projectIds: [],
  categories: [],
};

const CADENCES: ReportCadence[] = ['weekly', 'biweekly', 'monthly'];

/** Minimum days between sends. Weekly needs none — the weekday gate already
 * enforces a 7-day rhythm. The others are set a day under the nominal period
 * so a DST shift or a short month can't push a send into the following week. */
const MIN_GAP_DAYS: Record<ReportCadence, number> = {
  weekly: 0,
  biweekly: 13,
  monthly: 27,
};

function stringList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === 'string' && v !== '')
    : [];
}

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(Math.max(v, lo), hi);
}

/** Defensive shape-up of a stored/submitted config — the store guard does not
 * validate this optional blob, so malformed fields degrade to defaults. */
export function normalizeWeeklyReportConfig(raw: unknown): WeeklyReportConfig {
  const r = (raw ?? {}) as Partial<WeeklyReportConfig>;
  const categories: WeeklyReportRule[] = Array.isArray(r.categories)
    ? r.categories
        .map((c) => ({
          name: typeof c?.name === 'string' ? c.name.trim() : '',
          keywords: Array.isArray(c?.keywords)
            ? c.keywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '')
            : [],
        }))
        .filter((c) => c.name !== '')
    : [];
  return {
    enabled: r.enabled === true,
    to: typeof r.to === 'string' ? r.to.trim() : '',
    day: clampInt(r.day, 0, 6, DEFAULT_WEEKLY_REPORT.day),
    hour: clampInt(r.hour, 0, 23, DEFAULT_WEEKLY_REPORT.hour),
    cadence: CADENCES.includes(r.cadence as ReportCadence)
      ? (r.cadence as ReportCadence)
      : DEFAULT_WEEKLY_REPORT.cadence,
    windowDays: clampInt(r.windowDays, 1, 90, DEFAULT_WEEKLY_REPORT.windowDays),
    ...(typeof r.timezone === 'string' && r.timezone.trim() !== ''
      ? { timezone: r.timezone.trim() }
      : {}),
    clientIds: stringList(r.clientIds),
    projectIds: stringList(r.projectIds),
    categories,
    ...(typeof r.lastSentWeek === 'string' ? { lastSentWeek: r.lastSentWeek } : {}),
    ...(typeof r.lastSentAt === 'string' ? { lastSentAt: r.lastSentAt } : {}),
  };
}

// ============================================================================
// Window + due-gate
// ============================================================================

export interface ReportWindow {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(
    at.getUTCDate()
  ).padStart(2, '0')}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / (24 * 60 * 60 * 1000));
}

/** The `days`-long window ending on `weekEnd` (both bounds inclusive). Pure
 * string date math via Date.UTC — never touches the process timezone. */
export function weekWindow(weekEnd: string, days = 7): ReportWindow {
  return { start: shiftYmd(weekEnd, -(Math.max(1, days) - 1)), end: weekEnd };
}

/**
 * Whether a scheduled send is due at `now`: enabled, the configured weekday,
 * at/after the configured hour, and not already sent for this week-ending
 * date. Returns the week-ending YYYY-MM-DD (the dedup key) or null.
 */
export function weeklyReportDue(
  now: Date,
  cfg: WeeklyReportConfig,
  timezone: string
): string | null {
  if (!cfg.enabled) return null;
  const parts = zonedParts(now, cfg.timezone ?? timezone);
  if (parts.weekday !== cfg.day) return null;
  if (parts.hour < cfg.hour) return null;
  if (cfg.lastSentWeek === parts.ymd) return null;
  // Cadence gate: biweekly/monthly skip send-days that fall inside the period
  // already covered. Measured from the last send, so a missed week self-heals
  // on the next send-day instead of drifting the schedule forward.
  const minGap = MIN_GAP_DAYS[cfg.cadence] ?? 0;
  if (minGap > 0 && cfg.lastSentWeek && daysBetween(cfg.lastSentWeek, parts.ymd) < minGap) {
    return null;
  }
  return parts.ymd;
}

// ============================================================================
// Categorization + rows
// ============================================================================

/**
 * Resolve an entry's reporting category, most-trustworthy source first:
 *
 *   1. sub-client — recorded fact, set by the person who did the work
 *   2. keyword rule — an inference from prose; first match wins
 *   3. project name — the honest fallback
 *
 * Sub-client outranks keyword rules deliberately: rules guess a category from
 * a description, and a day-long entry mentioning many things matches whichever
 * rule happens to be listed first. An explicit tag is never wrong that way.
 */
export function categorizeEntry(
  description: string,
  projectName: string,
  rules: WeeklyReportRule[],
  subClientName?: string
): string {
  if (subClientName) return subClientName;
  const hay = `${description}\n${projectName}`.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.some((k) => hay.includes(k.trim().toLowerCase()))) return rule.name;
  }
  return projectName || 'Uncategorized';
}

export interface ReportRow {
  date: string;
  category: string;
  client: string;
  project: string;
  subClient: string; // '' when the entry isn't tagged
  description: string; // collapsed to one line
  minutes: number;
  hourlyRate: number;
  amount: number;
  billable: boolean;
}

/** Normalize a description for reporting: keep line structure (a multi-line
 * work log is a list, and flattening it produces an unreadable run-on), but
 * collapse runs of blank lines and trailing spaces. CSV quotes embedded
 * newlines and the HTML renderer converts them to <br>, so both are safe. */
function tidyLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fmtHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

function fmtMoney(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** All entries dated inside the window AND inside the configured client/project
 * scope, categorized and sorted by date/start. The scope filter is what keeps
 * one client's billing contact from seeing another client's work. */
export function collectReportRows(
  store: TimesheetStore,
  cfg: WeeklyReportConfig,
  window: ReportWindow
): ReportRow[] {
  const projects = new Map(store.projects.map((p) => [p.id, p]));
  const clients = new Map(store.clients.map((c) => [c.id, c]));
  const clientScope = new Set(cfg.clientIds);
  const projectScope = new Set(cfg.projectIds);
  const inScope = (projectId: string): boolean => {
    if (projectScope.size > 0 && !projectScope.has(projectId)) return false;
    if (clientScope.size === 0) return true;
    const clientId = projects.get(projectId)?.clientId;
    return clientId !== undefined && clientScope.has(clientId);
  };
  return store.entries
    .filter((e) => e.date >= window.start && e.date <= window.end && inScope(e.projectId))
    .sort((a, b) => a.date.localeCompare(b.date) || entryTimeKey(a).localeCompare(entryTimeKey(b)))
    .map((e) => {
      const project = projects.get(e.projectId);
      const client = project ? clients.get(project.clientId) : undefined;
      const subClient = e.subClientId
        ? project?.subClients?.find((s) => s.id === e.subClientId)?.name
        : undefined;
      return {
        date: e.date,
        category: categorizeEntry(e.description, project?.name ?? '', cfg.categories, subClient),
        client: client?.name ?? '',
        project: project?.name ?? '',
        subClient: subClient ?? '',
        description: tidyLines(e.description),
        minutes: e.durationMinutes,
        hourlyRate: e.hourlyRate,
        amount: e.amount,
        billable: e.billable,
      };
    });
}

// ============================================================================
// Rendering
// ============================================================================

export function csvEscape(field: string): string {
  return /[",\n\r]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

export function buildReportCsv(rows: ReportRow[]): string {
  const header = 'Date,Category,Client,Project,Sub-client,Description,Hours,Rate,Amount,Billable';
  const lines = rows.map((r) =>
    [
      r.date,
      csvEscape(r.category),
      csvEscape(r.client),
      csvEscape(r.project),
      csvEscape(r.subClient),
      csvEscape(r.description),
      fmtHours(r.minutes),
      r.hourlyRate.toFixed(2),
      r.amount.toFixed(2),
      r.billable ? 'yes' : 'no',
    ].join(',')
  );
  return [header, ...lines].join('\n');
}

export interface CategoryTotal {
  category: string;
  minutes: number;
  amount: number;
  rows: ReportRow[];
}

export function categoryTotals(rows: ReportRow[]): CategoryTotal[] {
  const byCategory = new Map<string, CategoryTotal>();
  for (const row of rows) {
    let t = byCategory.get(row.category);
    if (!t) {
      t = { category: row.category, minutes: 0, amount: 0, rows: [] };
      byCategory.set(row.category, t);
    }
    t.minutes += row.minutes;
    t.amount += row.amount;
    t.rows.push(row);
  }
  return [...byCategory.values()].sort((a, b) => b.minutes - a.minutes);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape, then keep the line breaks a work log depends on — email clients
 * collapse raw newlines, so a bulleted description needs explicit <br>. */
function multiline(s: string): string {
  return esc(s).replace(/\n/g, '<br>');
}

const TD = 'padding:6px 10px;border-bottom:1px solid #e5e5ea;font-size:13px;';
const TH = `${TD}text-align:left;color:#6b6b73;font-size:11px;text-transform:uppercase;`;

export function buildReportHtml(rows: ReportRow[], window: ReportWindow): string {
  const totals = categoryTotals(rows);
  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);

  const sections = totals
    .map((t) => {
      const body = t.rows
        .map(
          (r) =>
            `<tr><td style="${TD}white-space:nowrap;">${r.date}</td>` +
            `<td style="${TD}">${multiline(r.description) || esc(r.project)}${r.billable ? '' : ' <em>(non-billable)</em>'}</td>` +
            `<td style="${TD}text-align:right;">${fmtHours(r.minutes)}</td></tr>`
        )
        .join('');
      return (
        `<h3 style="margin:18px 0 6px;font-size:14px;">${esc(t.category)} — ${fmtHours(t.minutes)}h</h3>` +
        `<table style="border-collapse:collapse;width:100%;">` +
        `<tr><th style="${TH}">Date</th><th style="${TH}">Work</th><th style="${TH}text-align:right;">Hours</th></tr>` +
        `${body}</table>`
      );
    })
    .join('');

  const summaryRows = totals
    .map(
      (t) =>
        `<tr><td style="${TD}">${esc(t.category)}</td>` +
        `<td style="${TD}text-align:right;">${fmtHours(t.minutes)}</td>` +
        `<td style="${TD}text-align:right;">$${fmtMoney(t.amount)}</td></tr>`
    )
    .join('');

  return (
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1f;max-width:680px;">` +
    `<h2 style="margin:0 0 4px;">Timesheet</h2>` +
    `<p style="margin:0 0 14px;color:#6b6b73;">${window.start} to ${window.end} · ` +
    `${fmtHours(totalMinutes)} hours · $${fmtMoney(totalAmount)}</p>` +
    (rows.length === 0
      ? `<p>No time entries were logged this week.</p>`
      : `<table style="border-collapse:collapse;width:100%;">` +
        `<tr><th style="${TH}">Category</th><th style="${TH}text-align:right;">Hours</th><th style="${TH}text-align:right;">Amount</th></tr>` +
        `${summaryRows}</table>${sections}`) +
    `<p style="margin:16px 0 0;color:#6b6b73;font-size:12px;">Full detail attached as CSV.</p>` +
    `</div>`
  );
}

// ============================================================================
// Send
// ============================================================================

export interface WeeklyReportResult {
  ok: boolean;
  error?: string;
  weekEnd: string;
  rowCount: number;
  totalMinutes: number;
  sentTo?: string;
}

/**
 * Build and email the report for the week ending `weekEnd`, then persist the
 * dedup watermark. Used by both the scheduler tick and the manual send route.
 */
export async function sendWeeklyReport(weekEnd: string): Promise<WeeklyReportResult> {
  const t0 = performance.now();
  const store = await loadTimesheetStore();
  const cfg = normalizeWeeklyReportConfig(store.weeklyReport);
  const window = weekWindow(weekEnd, cfg.windowDays);
  const rows = collectReportRows(store, cfg, window);
  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  const base = { weekEnd, rowCount: rows.length, totalMinutes };

  if (!cfg.to) {
    log.warn(`[weekly-report] no recipient configured — skipping ${weekEnd}`);
    return { ...base, ok: false, error: 'No recipient configured' };
  }

  const subject = `Timesheet ${window.start} to ${window.end} (${fmtHours(totalMinutes)}h)`;
  const result = await sendEmail({
    purpose: 'client',
    ref: `weekly-report:${weekEnd}`,
    to: cfg.to,
    subject,
    html: buildReportHtml(rows, window),
    attachments: [
      {
        filename: `timesheet-${window.start}-to-${window.end}.csv`,
        content: Buffer.from(buildReportCsv(rows)).toString('base64'),
        contentType: 'text/csv',
      },
    ],
  });
  if (!result.ok) {
    log.error(`[weekly-report] send failed for ${weekEnd}: ${result.error}`);
    return { ...base, ok: false, error: result.error ?? 'Email send failed' };
  }

  // Persist the watermark on a FRESH load — the send awaited network I/O and
  // another request may have written the store meanwhile.
  const fresh = await loadTimesheetStore();
  fresh.weeklyReport = {
    ...normalizeWeeklyReportConfig(fresh.weeklyReport),
    lastSentWeek: weekEnd,
    lastSentAt: new Date().toISOString(),
  };
  await saveTimesheetStore(fresh);

  log.info(
    `[weekly-report] sent ${weekEnd}: ${rows.length} entries, ${fmtHours(totalMinutes)}h ` +
      `in ${(performance.now() - t0).toFixed(1)}ms`
  );
  return { ...base, ok: true, sentTo: cfg.to };
}
