// Pure date math for the Calendar view. No React, no fetch — unit-tested in
// calendarMath.test.ts. Date-only strings are parsed as LOCAL time via the
// `+ 'T00:00:00'` idiom (see ReminderBanner) and all grid arithmetic runs on
// date PARTS, never millisecond offsets, so DST transitions can't duplicate
// or drop a day.

import type { Occurrence } from './types';

export interface MonthCursor {
  year: number;
  month: number; // 1-12
}

export interface GridDay {
  date: string; // YYYY-MM-DD
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function parseISODate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** Whole days from today to dateStr; negative = overdue. */
export function daysUntil(dateStr: string, today: string = todayISO()): number {
  const a = parseISODate(today).getTime();
  const b = parseISODate(dateStr).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function addMonths(cursor: MonthCursor, delta: number): MonthCursor {
  const zeroBased = cursor.month - 1 + delta;
  return {
    year: cursor.year + Math.floor(zeroBased / 12),
    month: (((zeroBased % 12) + 12) % 12) + 1,
  };
}

export function monthTitle(cursor: MonthCursor): string {
  return new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The 42 cells (6 weeks, Sunday-start) covering a month. Always 42 so the
 * grid height never jumps while navigating months.
 */
export function monthGridDays(cursor: MonthCursor, today: string = todayISO()): GridDay[] {
  const first = new Date(cursor.year, cursor.month - 1, 1);
  const start = new Date(cursor.year, cursor.month - 1, 1 - first.getDay());
  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = toISODate(d);
    days.push({
      date: iso,
      inMonth: d.getMonth() === cursor.month - 1,
      isToday: iso === today,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    });
  }
  return days;
}

/** Inclusive last day an occurrence covers (its own date when single-day). */
export function occurrenceEnd(occ: Occurrence): string {
  return occ.endDate ?? occ.date;
}

/** True while `today` falls inside a multi-day occurrence that already started. */
export function isOngoing(occ: Occurrence, today: string): boolean {
  return occ.date < today && occurrenceEnd(occ) >= today;
}

/** Total days an occurrence covers, 1 for a single-day one. */
export function spanLength(occ: Occurrence): number {
  return occ.endDate ? daysUntil(occ.endDate, occ.date) + 1 : 1;
}

/** One day of an occurrence as rendered in the grid. A multi-day event
 * produces one segment per day it covers, so a trip paints a continuous band
 * across the cells instead of a single chip on its first day. */
export interface DaySegment {
  occ: Occurrence;
  date: string; // the day this segment renders on
  isStart: boolean;
  isEnd: boolean;
  dayIndex: number; // 1-based position within the span
  dayCount: number; // total days in the span (1 = single-day)
}

/** Index occurrences by day, expanding multi-day spans across every day they
 * cover. Occurrence order within a day is preserved from the server sort
 * (longest span first), so a band keeps the same row across the week. */
export function groupOccurrencesByDate(occurrences: Occurrence[]): Map<string, DaySegment[]> {
  const map = new Map<string, DaySegment[]>();
  const push = (segment: DaySegment) => {
    const list = map.get(segment.date);
    if (list) list.push(segment);
    else map.set(segment.date, [segment]);
  };
  for (const occ of occurrences) {
    const dayCount = spanLength(occ);
    for (let i = 0; i < dayCount; i++) {
      const date = i === 0 ? occ.date : addDays(occ.date, i);
      push({
        occ,
        date,
        isStart: i === 0,
        isEnd: i === dayCount - 1,
        dayIndex: i + 1,
        dayCount,
      });
    }
  }
  return map;
}

export type AgendaBucketKey = 'overdue' | 'today' | 'week' | 'later';

export interface AgendaBuckets {
  overdue: Occurrence[];
  today: Occurrence[]; // happening today — includes multi-day events under way
  week: Occurrence[]; // next 7 days after today
  later: Occurrence[]; // beyond, within the fetched horizon
}

/** Bucket pending/upcoming occurrences for the agenda rail. Completed
 * occurrences are excluded — the rail is a to-do surface, the grid is the
 * history surface. A multi-day occurrence buckets on the span, not the start
 * day: a trip you are in the middle of belongs under Today, and only a span
 * whose LAST day has passed counts as overdue. */
export function agendaBuckets(occurrences: Occurrence[], today: string): AgendaBuckets {
  const buckets: AgendaBuckets = { overdue: [], today: [], week: [], later: [] };
  const weekEnd = daysUntilBound(today, 7);
  for (const occ of occurrences) {
    if (occ.completed) continue;
    if (occurrenceEnd(occ) < today) {
      if (occ.completable) buckets.overdue.push(occ); // past birthdays/events aren't "overdue"
    } else if (occ.date <= today) {
      buckets.today.push(occ);
    } else if (occ.date <= weekEnd) {
      buckets.week.push(occ);
    } else {
      buckets.later.push(occ);
    }
  }
  return buckets;
}

/** ISO date `days` after `iso` (negative allowed). */
export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

function daysUntilBound(today: string, days: number): string {
  return addDays(today, days);
}

export interface MonthGroup {
  key: string; // YYYY-MM
  label: string; // "September" / "January 2027" when the year differs from today's
  items: Occurrence[];
}

/** Pending occurrences strictly after `afterISO`, grouped by calendar month in
 * chronological order — the agenda's "coming months" outlook. */
export function comingMonthGroups(
  occurrences: Occurrence[],
  afterISO: string,
  today: string
): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  const todayYear = today.slice(0, 4);
  for (const occ of occurrences) {
    if (occ.completed || occ.date <= afterISO) continue;
    const key = occ.date.slice(0, 7);
    let group = groups.get(key);
    if (!group) {
      const label = parseISODate(`${key}-01`).toLocaleDateString('en-US', {
        month: 'long',
        ...(key.slice(0, 4) !== todayYear ? { year: 'numeric' } : {}),
      });
      group = { key, label, items: [] };
      groups.set(key, group);
    }
    group.items.push(occ);
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Compact inclusive date range: "Oct 3 – 9" within a month, "Oct 30 – Nov 2"
 * across one, "Dec 28, 2026 – Jan 3, 2027" across a year. */
export function formatDateRange(start: string, end: string): string {
  const from = parseISODate(start);
  const to = parseISODate(end);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const sameMonth = sameYear && start.slice(0, 7) === end.slice(0, 7);
  const left = from.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const right = to.toLocaleDateString('en-US', {
    ...(sameMonth ? {} : { month: 'short' }),
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${left} – ${right}`;
}

/** Right-hand agenda label for an occurrence: "day 3 of 7" while a span is
 * under way, otherwise the usual relative label off its start date. */
export function occurrenceTimingLabel(occ: Occurrence, today: string): string {
  if (isOngoing(occ, today)) {
    return `day ${daysUntil(today, occ.date) + 1} of ${spanLength(occ)}`;
  }
  return relativeLabel(occ.date, today);
}

/** Human-friendly relative label: "today", "tomorrow", "in 5 days", "3 days
 * overdue", "Mar 14". Falls to an absolute date beyond two weeks. */
export function relativeLabel(dateStr: string, today: string = todayISO()): string {
  const delta = daysUntil(dateStr, today);
  if (delta === 0) return 'today';
  if (delta === 1) return 'tomorrow';
  if (delta === -1) return '1 day overdue';
  if (delta < 0) return `${-delta} days overdue`;
  if (delta <= 14) return `in ${delta} days`;
  return parseISODate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
