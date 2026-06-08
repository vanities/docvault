// Timezone-aware calendar math for scheduling, independent of the process TZ.
//
// The Daily News scheduler decides "is it past the publish hour?" and "what
// calendar day is this edition for?" — both need a wall-clock reading in the
// USER's timezone, not the container's (which is UTC in Docker). Date's get*()
// methods read process.env.TZ, so we compute the parts via Intl instead, which
// resolves any IANA zone against the OS tzdata without depending on TZ.

import type { Settings } from './data.js';

const FALLBACK_TZ = 'UTC';

/** True if `tz` is a usable IANA timezone name in this runtime. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    // Constructing with an unknown timeZone throws RangeError.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The app-wide timezone, in precedence order:
 *   1. the geocoded location's zone (settings.weather.timezone) — the source of
 *      truth; auto-derived when you pick a city in Maps → Weather.
 *   2. a legacy/explicit schedules.timezone (installs predating step 1).
 *   3. the runtime's own zone — honors a container `TZ` env if one is set.
 *   4. 'UTC'.
 */
export function getConfiguredTimezone(settings: Settings | undefined): string {
  const fromLocation = settings?.weather?.timezone;
  if (isValidTimeZone(fromLocation)) return fromLocation;
  const legacy = settings?.schedules?.timezone;
  if (isValidTimeZone(legacy)) return legacy;
  try {
    const runtime = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(runtime)) return runtime;
  } catch {
    /* fall through to UTC */
  }
  return FALLBACK_TZ;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface ZonedParts {
  /** Hour of day 0-23 in the zone. */
  hour: number;
  /** Day of week 0-6 (0=Sunday) in the zone. */
  weekday: number;
  /** Calendar date YYYY-MM-DD in the zone. */
  ymd: string;
}

/**
 * Calendar parts of an instant rendered in a given IANA timezone. Falls back to
 * UTC when `timeZone` is invalid, so a bad setting degrades to the old behavior
 * instead of throwing inside the scheduler tick.
 */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const tz = isValidTimeZone(timeZone) ? timeZone : FALLBACK_TZ;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23', // 00–23; some engines emit "24" for midnight, handled below
    weekday: 'short',
  }).formatToParts(instant);

  let year = '0000';
  let month = '01';
  let day = '01';
  let hour = '00';
  let weekday = 'Sun';
  for (const p of parts) {
    if (p.type === 'year') year = p.value;
    else if (p.type === 'month') month = p.value;
    else if (p.type === 'day') day = p.value;
    else if (p.type === 'hour') hour = p.value;
    else if (p.type === 'weekday') weekday = p.value;
  }

  return {
    hour: parseInt(hour, 10) % 24, // % 24 maps a stray "24" (midnight) back to 0
    weekday: WEEKDAY_INDEX[weekday] ?? 0,
    ymd: `${year}-${month}-${day}`,
  };
}

/** Convenience: the YYYY-MM-DD of an instant in a zone. */
export function zonedYMD(instant: Date, timeZone: string): string {
  return zonedParts(instant, timeZone).ymd;
}
