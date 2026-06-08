// Pure scheduling logic for Daily News — extracted so the wall-clock due-gate
// (the bug-prone part: timezones, the publish-hour gate, weekly-day detection,
// the per-day dedup key) is unit-testable without the store, settings, or a
// real clock. The scheduler combines this with the store's dedup checks.
//
// All wall-clock reads go through `tz.ts` so the gate/dedup/weekday are computed
// in the configured IANA timezone (schedules.timezone) — NOT the container's
// process zone, which is UTC in Docker. That zone-mismatch is what made
// "publish at 9" fire at 9 UTC (the small hours, locally).

import type { Settings } from './data.js';
import { getConfiguredTimezone, zonedParts, zonedYMD } from './tz.js';

type Schedules = Settings['schedules'];

export function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Math.round(n), lo), hi);
}

/** Process-local YYYY-MM-DD (NOT toISOString/UTC). Retained as a generic util;
 *  scheduling no longer uses it — it computes dates in the configured timezone
 *  via `zonedYMD` so the result doesn't depend on the container's process zone. */
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
 *
 * Hour, weekday, and calendar date are all read in `schedules.timezone`
 * (default 'UTC' when unset) so a single zone governs every comparison.
 */
export function dailyNewsPlan(now: Date, schedules: Schedules): DailyNewsPlan | null {
  if (schedules?.dailyNewsEnabled !== true) return null;
  const tz = getConfiguredTimezone(schedules);
  const parts = zonedParts(now, tz);
  if (parts.hour < clampInt(schedules.dailyNewsHour ?? 7, 0, 23)) return null;
  const weeklyDay = clampInt(schedules.dailyNewsWeeklyDay ?? 0, 0, 6);
  return {
    today: parts.ymd,
    weekStart: zonedYMD(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000), tz),
    isWeeklyDay: parts.weekday === weeklyDay,
  };
}
