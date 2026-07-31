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

export function groupOccurrencesByDate(occurrences: Occurrence[]): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const list = map.get(occ.date);
    if (list) list.push(occ);
    else map.set(occ.date, [occ]);
  }
  return map;
}

export type AgendaBucketKey = 'overdue' | 'today' | 'week' | 'later';

export interface AgendaBuckets {
  overdue: Occurrence[];
  today: Occurrence[];
  week: Occurrence[]; // next 7 days after today
  later: Occurrence[]; // beyond, within the fetched horizon
}

/** Bucket pending/upcoming occurrences for the agenda rail. Completed
 * occurrences are excluded — the rail is a to-do surface, the grid is the
 * history surface. */
export function agendaBuckets(occurrences: Occurrence[], today: string): AgendaBuckets {
  const buckets: AgendaBuckets = { overdue: [], today: [], week: [], later: [] };
  const weekEnd = daysUntilBound(today, 7);
  for (const occ of occurrences) {
    if (occ.completed) continue;
    if (occ.date < today) {
      if (occ.completable) buckets.overdue.push(occ); // past birthdays/events aren't "overdue"
    } else if (occ.date === today) {
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
