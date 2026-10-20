import type { AlertCheck, AlertSeriesPoint, AlertSourceView } from '../../../server/alerts-types';

export type SourceStatus = 'act' | 'warning' | 'clear' | 'paused';

/** A source whose job is switched off is paused: its checks are only as fresh as the last report. */
export function sourceStatus(source: Pick<AlertSourceView, 'checks' | 'job'>): SourceStatus {
  if (source.job && !source.job.enabled) return 'paused';
  if (source.checks.some((c) => c.active && c.severity === 'critical')) return 'act';
  if (source.checks.some((c) => c.active)) return 'warning';
  return 'clear';
}

/** Worst status across the sources that are running, plus how many are paused. */
export function overallStatus(sources: Array<Pick<AlertSourceView, 'checks' | 'job'>>): {
  status: Exclude<SourceStatus, 'paused'>;
  paused: number;
} {
  const statuses = sources.map(sourceStatus);
  const status = statuses.includes('act')
    ? 'act'
    : statuses.includes('warning')
      ? 'warning'
      : 'clear';
  return { status, paused: statuses.filter((s) => s === 'paused').length };
}

/** Tripped checks first (critical before warning); the rest keep a stable order between polls. */
export function sortChecks(checks: AlertCheck[]): AlertCheck[] {
  const rank = (c: AlertCheck) => (c.active ? (c.severity === 'critical' ? 0 : 1) : 2);
  return [...checks].sort(
    (a, b) => rank(a) - rank(b) || a.scope.localeCompare(b.scope) || a.label.localeCompare(b.label)
  );
}

/** Mirrors the custom job schedules the server accepts (hourly, daily, every Nh, every Nm). */
export function scheduleToMs(schedule: string): number | null {
  if (schedule === 'hourly') return 60 * 60 * 1000;
  if (schedule === 'daily') return 24 * 60 * 60 * 1000;
  const match = /^every ([1-9][0-9]*)([hm])$/.exec(schedule);
  if (!match) return null;
  return Number(match[1]) * (match[2] === 'h' ? 60 * 60 * 1000 : 60 * 1000);
}

/** Matches the server watchdog: three missed intervals means the job stopped reporting. */
export const STALE_INTERVALS = 3;

export type SourceHealth =
  | { kind: 'ok'; ageMs: number }
  | { kind: 'stale'; ageMs: number }
  | { kind: 'failing'; ageMs: number | null }
  | { kind: 'never'; ageMs: null };

export function sourceHealth(
  source: Pick<AlertSourceView, 'reportedAt' | 'failures' | 'job'>,
  now: number
): SourceHealth {
  const reported = source.reportedAt ? Date.parse(source.reportedAt) : Number.NaN;
  const ageMs = Number.isFinite(reported) ? Math.max(0, now - reported) : null;
  if (source.failures > 0) return { kind: 'failing', ageMs };
  if (ageMs === null) return { kind: 'never', ageMs: null };
  const intervalMs = source.job?.enabled ? scheduleToMs(source.job.schedule) : null;
  return intervalMs !== null && ageMs > STALE_INTERVALS * intervalMs
    ? { kind: 'stale', ageMs }
    : { kind: 'ok', ageMs };
}

/** Status from the checks alone; a paused source keeps its row open or closed while you toggle it. */
export function checkStatus(checks: AlertCheck[]): Exclude<SourceStatus, 'paused'> {
  if (checks.some((c) => c.active && c.severity === 'critical')) return 'act';
  if (checks.some((c) => c.active)) return 'warning';
  return 'clear';
}

/**
 * Remembered open/closed choices are keyed by status, so a source the owner
 * collapsed while it was clear still opens on its own when something trips.
 */
export function expansionKey(id: string, checks: AlertCheck[]): string {
  return `${id}:${checkStatus(checks)}`;
}

export function isExpanded(
  remembered: Record<string, boolean>,
  id: string,
  checks: AlertCheck[]
): boolean {
  return remembered[expansionKey(id, checks)] ?? checkStatus(checks) !== 'clear';
}

/**
 * Act now first, then warnings, then sources that can't report, then quiet ones. Paused
 * sources keep their place, so flipping a row's switch never moves it out from under you.
 */
export function sortSources<T extends AlertSourceView>(sources: T[], now: number): T[] {
  const rank = (s: T) => {
    const status = checkStatus(s.checks);
    if (status === 'act') return 0;
    if (status === 'warning') return 1;
    return sourceHealth(s, now).kind === 'ok' ? 3 : 2;
  };
  return [...sources].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

function checkName(check: Pick<AlertCheck, 'label' | 'scope'>): string {
  return check.scope && !check.label.toLowerCase().includes(check.scope.toLowerCase())
    ? `${check.label} (${check.scope})`
    : check.label;
}

export type SummaryTone = 'critical' | 'warning' | 'ok' | 'muted';

/** The one line a collapsed row shows: what's wrong, or that nothing is. */
export function sourceSummary(
  source: Pick<AlertSourceView, 'checks' | 'job' | 'emails' | 'failures' | 'reportedAt'>,
  now: number
): { text: string; tone: SummaryTone } {
  const tripped = sortChecks(source.checks).filter((c) => c.active);
  const worst: SummaryTone = tripped.some((c) => c.severity === 'critical')
    ? 'critical'
    : 'warning';
  const trips =
    tripped.length === 0
      ? ''
      : `${tripped.length} tripped: ${tripped.slice(0, 2).map(checkName).join(', ')}${tripped.length > 2 ? `, +${tripped.length - 2} more` : ''}`;

  if (source.job && !source.job.enabled) {
    return {
      text: `Paused, ${tripped.length ? trips : 'all clear'} at the last report`,
      tone: 'muted',
    };
  }
  const health = sourceHealth(source, now);
  const emailsOff = source.emails === false ? ', emails off' : '';
  if (health.kind === 'never') return { text: 'Waiting for its first report', tone: 'muted' };
  if (health.kind !== 'ok') {
    const problem =
      health.kind === 'failing'
        ? `Can't get its data (${source.failures} failed ${source.failures === 1 ? 'check' : 'checks'})`
        : `No report in ${formatDuration(health.ageMs)}`;
    return {
      text: `${problem}${trips ? `; last report: ${trips}` : ''}${emailsOff}`,
      tone: 'warning',
    };
  }
  if (tripped.length > 0) return { text: `${trips}${emailsOff}`, tone: worst };
  const count = source.checks.length;
  return {
    text: `All clear, ${count} ${count === 1 ? 'check' : 'checks'}${emailsOff}`,
    tone: 'ok',
  };
}

export function formatDuration(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} h`;
  return `${Math.floor(hr / 24)} d`;
}

export function formatAge(ms: number): string {
  return ms < 60_000 ? 'just now' : `${formatDuration(ms)} ago`;
}

/** Series values carry no unit, so small numbers keep more digits than large ones. */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) < 10 ? 4 : 1 });
}

/** Every series key a source has reported, in first-seen order. */
export function seriesKeys(series: AlertSeriesPoint[]): string[] {
  return [...new Set(series.flatMap((p) => Object.keys(p.values ?? {})))];
}

export function seriesValues(series: AlertSeriesPoint[], key: string): Array<number | null> {
  return series.map((p) => {
    const v = p.values?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
}

export interface SparkGeometry {
  line: string;
  area: string;
  end: { x: number; y: number } | null;
  refY: number | null;
  min: number;
  max: number;
}

/**
 * Projects a series into an SVG box. The domain always includes `ref`, so a trip
 * line far from the data stays visible instead of being clipped off the chart.
 */
export function sparkGeometry(
  values: Array<number | null>,
  width: number,
  height: number,
  ref: number | null = null,
  pad = 3
): SparkGeometry {
  const points = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null && Number.isFinite(p.v));
  if (points.length === 0) return { line: '', area: '', end: null, refY: null, min: 0, max: 0 };

  const domain = points.map((p) => p.v);
  if (ref != null && Number.isFinite(ref)) domain.push(ref);
  let min = Math.min(...domain);
  let max = Math.max(...domain);
  const span = max - min || Math.max(Math.abs(max) * 0.001, 1e-6);
  min -= span * 0.1;
  max += span * 0.1;

  const x = (i: number) =>
    values.length > 1 ? pad + (i / (values.length - 1)) * (width - 2 * pad) : width / 2;
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - 2 * pad);
  const fmt = (n: number) => n.toFixed(1);

  const line = points.map((p, k) => `${k ? 'L' : 'M'}${fmt(x(p.i))} ${fmt(y(p.v))}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const floorY = fmt(height - pad);
  const area = `${line} L${fmt(x(last.i))} ${floorY} L${fmt(x(first.i))} ${floorY} Z`;
  return {
    line,
    area,
    end: { x: x(last.i), y: y(last.v) },
    refY: ref != null && Number.isFinite(ref) ? y(ref) : null,
    min,
    max,
  };
}
