// Calendar recurrence projection — pure date math, no I/O (testable like
// daily-news-schedule.ts). Expands CalendarEvent definitions into dated
// occurrences for a window: the month grid, the ReminderBanner, the Daily
// News "Week Ahead" box, and chat tools all read through projectOccurrences.
//
// All arithmetic stays in {y,m,d} integer parts or UTC-pinned Date math —
// never `new Date(str).toISOString().split('T')[0]`, which shifts a day for
// negative-UTC-offset users (the legacy reminders bug this replaces).
// YYYY-MM-DD strings compare lexicographically in date order, so window
// checks are plain string comparisons.

import type {
  CalendarEvent,
  CalendarEventKind,
  CalendarRecurrence,
  RecurrenceUnit,
} from './calendar-store.js';

export interface DateWindow {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
}

export interface Occurrence {
  eventId: string;
  kind: CalendarEventKind;
  title: string;
  date: string; // YYYY-MM-DD due/occurrence date (first day of a span)
  // Inclusive last day, set only when this occurrence spans MULTIPLE days.
  // Single-day occurrences omit it — use occurrenceEnd() to read either.
  endDate?: string;
  entityId?: string;
  notes?: string;
  completable: boolean; // kind === 'task'
  completed: boolean; // a completion record exists (done OR skipped)
  skipped?: boolean;
  completedOn?: string;
  overdue: boolean; // pending task occurrence whose LAST day is before today
  age?: number; // birthdays with birthYear: occurrence year - birthYear
  recurrenceLabel: string; // "monthly", "every 6 months after completion", "one-off"
}

// Safety cap on fixed-recurrence expansion: ~10 years of a daily task. The
// k-th occurrence is always computed from the anchor (anchor + k*interval),
// so hitting the cap truncates silently rather than drifting.
const MAX_FIXED_ITERATIONS = 4000;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month, pinned to UTC so local timezone can't shift it.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days from `start` to `end` (negative when end precedes start).
 * UTC-pinned, so a DST boundary inside the range can't shift the count. */
export function diffDays(start: string, end: string): number {
  const a = parseParts(start);
  const b = parseParts(end);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** Last day an occurrence covers: its span end, or its own date when single-day. */
export function occurrenceEnd(occ: Pick<Occurrence, 'date' | 'endDate'>): string {
  return occ.endDate ?? occ.date;
}

/** Days an event's span covers, 0 when single-day. Birthdays never span. */
export function eventSpanDays(event: Pick<CalendarEvent, 'kind' | 'date' | 'endDate'>): number {
  if (event.kind === 'birthday' || !event.endDate || event.endDate <= event.date) return 0;
  return diffDays(event.date, event.endDate);
}

export function isYMD(value: string): boolean {
  const m = YMD_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function parseParts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}

function formatYMD(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Add a recurrence interval to a date. Month/year addition clamps to the end
 * of the target month (Jan 31 + 1 month = Feb 28/29; Feb 29 + 1 year =
 * Feb 28). Day/week addition goes through Date.UTC so it is DST-immune.
 * Negative intervals are supported (used for lookback windows).
 */
export function addInterval(ymd: string, interval: number, unit: RecurrenceUnit): string {
  const { y, m, d } = parseParts(ymd);
  if (unit === 'day' || unit === 'week') {
    const days = unit === 'week' ? interval * 7 : interval;
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return formatYMD(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const monthsTotal = unit === 'year' ? interval * 12 : interval;
  const zeroBased = m - 1 + monthsTotal;
  const targetYear = y + Math.floor(zeroBased / 12);
  const targetMonth = (((zeroBased % 12) + 12) % 12) + 1;
  return formatYMD(targetYear, targetMonth, Math.min(d, daysInMonth(targetYear, targetMonth)));
}

export function describeRecurrence(
  recurrence: CalendarRecurrence | null | undefined,
  kind: CalendarEventKind
): string {
  if (kind === 'birthday') return 'yearly';
  if (!recurrence) return 'one-off';
  const { interval, unit, anchor } = recurrence;
  const base =
    interval === 1
      ? { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[unit]
      : `every ${interval} ${unit}s`;
  return anchor === 'afterCompletion' ? `${base} after completion` : base;
}

/** Project a single event's occurrences intersecting the window.
 *
 * Overdue surfacing: when the window reaches back to today or earlier
 * (window.start <= today), pending task occurrences that fall BEFORE the
 * window also surface — at most one per event (the latest missed one) for
 * fixed/one-off tasks, and always the single pending occurrence for
 * afterCompletion tasks. A missed filter change must show up in a
 * "today → +60d" query even though its due date is in the past.
 */
export function projectEvent(
  event: CalendarEvent,
  window: DateWindow,
  today: string
): Occurrence[] {
  if (event.status === 'archived') return [];

  const completable = event.kind === 'task';
  const recurrenceLabel = describeRecurrence(event.recurrence, event.kind);
  const completionsByDate = new Map(
    (event.completions ?? []).map((c) => [c.occurrenceDate, c] as const)
  );
  const includeOverdueTail = window.start <= today;
  // Span length recurs with the event: every occurrence covers the same
  // number of days as the anchor does.
  const spanDays = eventSpanDays(event);
  const spanEnd = (date: string): string | undefined =>
    spanDays > 0 ? addInterval(date, spanDays, 'day') : undefined;
  // A multi-day occurrence is "past" only once its LAST day is behind us — a
  // trip you are in the middle of is neither overdue nor out of window.
  const lastDay = (date: string): string => spanEnd(date) ?? date;

  const base = {
    eventId: event.id,
    kind: event.kind,
    title: event.title,
    entityId: event.entityId,
    notes: event.notes,
    completable,
    recurrenceLabel,
  };

  const occurrenceAt = (date: string): Occurrence => {
    const completion = completionsByDate.get(date);
    const end = spanEnd(date);
    return {
      ...base,
      date,
      ...(end ? { endDate: end } : {}),
      completed: completion !== undefined,
      skipped: completion?.skipped,
      completedOn: completion?.completedOn,
      overdue: completable && completion === undefined && lastDay(date) < today,
    };
  };

  // --- Birthdays: yearly on the anchor's MM-DD, Feb 29 -> Feb 28 off-years.
  if (event.kind === 'birthday') {
    const anchor = parseParts(event.date);
    const out: Occurrence[] = [];
    for (let year = parseParts(window.start).y; year <= parseParts(window.end).y; year++) {
      const date = formatYMD(year, anchor.m, Math.min(anchor.d, daysInMonth(year, anchor.m)));
      if (date < window.start || date > window.end) continue;
      out.push({
        ...base,
        date,
        completable: false,
        completed: false,
        overdue: false,
        age: event.birthYear !== undefined ? year - event.birthYear : undefined,
      });
    }
    return out;
  }

  // --- afterCompletion tasks: exactly one pending occurrence, due an
  // interval after the latest actual completion (or at the anchor if never
  // completed). Historical completions render on their occurrence dates.
  if (completable && event.recurrence && event.recurrence.anchor === 'afterCompletion') {
    const { interval, unit } = event.recurrence;
    const out: Occurrence[] = [];
    const completions = [...(event.completions ?? [])].sort((a, b) =>
      a.completedOn < b.completedOn ? -1 : 1
    );
    for (const c of completions) {
      if (lastDay(c.occurrenceDate) >= window.start && c.occurrenceDate <= window.end) {
        out.push(occurrenceAt(c.occurrenceDate));
      }
    }
    const latest = completions[completions.length - 1];
    const due = latest ? addInterval(latest.completedOn, interval, unit) : event.date;
    // The pending occurrence surfaces even before window.start — it's the
    // only projection of this task's future, and overdue must not hide.
    if (due <= window.end && (lastDay(due) >= window.start || includeOverdueTail)) {
      const end = spanEnd(due);
      out.push({
        ...base,
        date: due,
        ...(end ? { endDate: end } : {}),
        completed: false,
        overdue: lastDay(due) < today,
      });
    }
    return out;
  }

  // --- One-offs (recurrence null): a single occurrence at the anchor date.
  if (!event.recurrence) {
    const date = event.date;
    const completion = completionsByDate.get(date);
    const inWindow = lastDay(date) >= window.start && date <= window.end;
    const pendingOverdueBeforeWindow =
      completable &&
      completion === undefined &&
      lastDay(date) < window.start &&
      lastDay(date) <= today &&
      includeOverdueTail;
    return inWindow || pendingOverdueBeforeWindow ? [occurrenceAt(date)] : [];
  }

  // --- Fixed recurrence: k-th occurrence = anchor + k*interval, computed
  // from the anchor each time so Jan-31-monthly yields Feb 28, Mar 31,
  // Apr 30 without drifting to the 28th forever.
  const { interval, unit } = event.recurrence;
  const out: Occurrence[] = [];
  let latestOverdueBeforeWindow: Occurrence | null = null;
  for (let k = 0; k < MAX_FIXED_ITERATIONS; k++) {
    const date = addInterval(event.date, k * interval, unit);
    if (date > window.end) break;
    if (lastDay(date) >= window.start) {
      out.push(occurrenceAt(date));
    } else if (
      completable &&
      !completionsByDate.has(date) &&
      lastDay(date) <= today &&
      includeOverdueTail
    ) {
      // Track only the latest missed occurrence — "filter is overdue" once,
      // not once per missed month.
      latestOverdueBeforeWindow = occurrenceAt(date);
    }
  }
  if (latestOverdueBeforeWindow) out.unshift(latestOverdueBeforeWindow);
  return out;
}

/** Project all active events over a window, sorted by date then title. */
export function projectOccurrences(
  events: CalendarEvent[],
  window: DateWindow,
  today: string
): Occurrence[] {
  const out = events.flatMap((event) => projectEvent(event, window, today));
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    // Multi-day spans first (longest first) so a trip renders as the top band
    // of every cell it crosses instead of hopping rows day to day.
    const aEnd = occurrenceEnd(a);
    const bEnd = occurrenceEnd(b);
    if (aEnd !== bEnd) return aEnd > bEnd ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return out;
}

/** The next pending (or, for tasks, currently-overdue) occurrence of an
 * event, looking ahead two years from today. Null when nothing is pending
 * (archived, or a fully-resolved one-off). */
export function nextOccurrence(event: CalendarEvent, today: string): Occurrence | null {
  const window: DateWindow = { start: today, end: addInterval(today, 2, 'year') };
  const pending = projectEvent(event, window, today).filter((o) => !o.completed);
  return pending[0] ?? null;
}
