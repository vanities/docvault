// Pure scheduling logic for Daily News — extracted so the wall-clock due-gate
// (the bug-prone part: timezones, the publish-hour gate, weekly-day detection,
// the local-date dedup key) is unit-testable without the store, settings, or a
// real clock. The scheduler combines this with the store's dedup checks.

import type { Settings } from './data.js';

type Schedules = Settings['schedules'];

export function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Math.round(n), lo), hi);
}

/** Local-timezone YYYY-MM-DD (NOT toISOString/UTC) so the publish-hour gate and
 *  the per-day dedup key are always computed in the same timezone. */
export function localYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export interface DailyNewsPlan {
  /** Local YYYY-MM-DD this edition is for (the per-day dedup key). */
  today: string;
  /** Local YYYY-MM-DD six days ago — the window for the weekly dedup check. */
  weekStart: string;
  /** Whether today is the configured weekly deep-dive weekday. */
  isWeeklyDay: boolean;
}

/**
 * Decide whether an edition could be due right now, returning the dates the
 * caller needs — or null when disabled or before the publish hour. This does
 * NOT consult the store; the caller still checks editionExistsForDate /
 * weeklyEditionExistsForWeek to enforce the once-per-day / once-per-week dedup.
 */
export function dailyNewsPlan(now: Date, schedules: Schedules): DailyNewsPlan | null {
  if (schedules?.dailyNewsEnabled !== true) return null;
  if (now.getHours() < clampInt(schedules.dailyNewsHour ?? 7, 0, 23)) return null;
  const weeklyDay = clampInt(schedules.dailyNewsWeeklyDay ?? 0, 0, 6);
  return {
    today: localYMD(now),
    weekStart: localYMD(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)),
    isWeeklyDay: now.getDay() === weeklyDay,
  };
}
