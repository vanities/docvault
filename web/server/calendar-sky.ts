// Sky/almanac rows for the Daily News "Week Ahead" box. Imports the SAME
// pure math modules the Calendar view uses (src/components/Calendar/*, which
// are dependency-free), so the paper and the UI can never disagree about
// when the full moon is. Dates resolve in the server's local timezone — the
// container's TZ is set to the household timezone (see Makefile/deploy).
// Every layer is gated by the settings.calendar toggles (see
// getCalendarDisplayConfig): a layer turned off in the calendar disappears
// from the paper too.

import {
  formatClock,
  formatDaylight,
  formatDaylightDelta,
  moonPhasesByDate,
  seasonMarksByDate,
  sunTimesForDate,
} from './astronomy.js';
import { dstTransitionsByDate, meteorShowersByDate, usHolidaysByDate } from './almanac.js';
import type { CalendarDisplaySettings } from './data.js';

export interface SkyWeekAheadItem {
  date: string; // YYYY-MM-DD
  title: string;
  kind: 'sky' | 'holiday';
  emoji: string;
}

/** Sky + almanac events in [startISO, endISO], honoring the display toggles.
 * Principal quarters are omitted from the paper — only new/full moons (with
 * supermoon/eclipse annotations), seasons, meteor peaks, holidays, and DST
 * changes make the cut. */
export function buildSkyWeekAheadItems(
  startISO: string,
  endISO: string,
  cfg: Required<CalendarDisplaySettings>
): SkyWeekAheadItem[] {
  const out: SkyWeekAheadItem[] = [];
  if (cfg.showMoon) {
    for (const [date, mark] of moonPhasesByDate(startISO, endISO)) {
      if (mark.phase !== 'new' && mark.phase !== 'full') continue;
      let title = mark.label;
      let emoji = mark.emoji;
      if (mark.supermoon) {
        title = 'Supermoon';
        emoji = '🌝';
      }
      if (mark.eclipse === 'solar') title += ' — solar eclipse';
      if (mark.eclipse === 'lunar') title += ' — lunar eclipse';
      out.push({ date, title, kind: 'sky', emoji });
    }
  }
  if (cfg.showSeasons) {
    for (const [date, mark] of seasonMarksByDate(startISO, endISO)) {
      out.push({ date, title: mark.name, kind: 'sky', emoji: mark.emoji });
    }
  }
  if (cfg.showMeteors) {
    for (const [date, mark] of meteorShowersByDate(startISO, endISO)) {
      out.push({ date, title: mark.label, kind: 'sky', emoji: mark.emoji });
    }
  }
  if (cfg.showDst) {
    for (const [date, mark] of dstTransitionsByDate(startISO, endISO)) {
      out.push({ date, title: mark.label, kind: 'sky', emoji: mark.emoji });
    }
  }
  if (cfg.showHolidays) {
    for (const [date, name] of usHolidaysByDate(startISO, endISO)) {
      out.push({ date, title: name, kind: 'holiday', emoji: '🎉' });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

// ---------------------------------------------------------------------------
// The almanac sun line — sunrise/sunset for the edition's own date. Unlike the
// sky rows above (dated events inside a week-long window), this is a reading
// for ONE day, so it renders as its own strip beside the weather rather than as
// a Week Ahead row.
// ---------------------------------------------------------------------------

export interface SunAlmanac {
  /** YYYY-MM-DD these readings are for. */
  date: string;
  /** Already formatted in the household timezone, e.g. "6:08 AM". */
  sunrise: string;
  sunset: string;
  /** Length of the day, e.g. "13h 25m". */
  daylight: string;
  /** Change vs. yesterday, e.g. "-2m 00s"; absent if yesterday can't be computed. */
  delta?: string;
}

/** Yesterday's YYYY-MM-DD. UTC arithmetic on the date parts only — no clock
 * component, so a DST boundary can't shift it. */
function previousDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Sunrise/sunset/daylight for `iso` at a location, pre-formatted for rendering.
 *
 * Gated by cfg.showSunTimes — the same "a layer off in the Calendar is off in
 * the paper" contract the sky rows follow. Returns null when the layer is off
 * or the sun never rises/sets that day (polar latitudes).
 *
 * Times are formatted with an EXPLICIT `timeZone` rather than the process zone:
 * the server renders this, and the container's TZ is not the source of truth
 * (see getConfiguredTimezone).
 */
export function buildSunAlmanac(
  iso: string,
  latitude: number,
  longitude: number,
  timeZone: string,
  cfg: Required<CalendarDisplaySettings>
): SunAlmanac | null {
  if (!cfg.showSunTimes) return null;
  const today = sunTimesForDate(iso, latitude, longitude);
  if (!today) return null;
  const yesterday = sunTimesForDate(previousDay(iso), latitude, longitude);
  const deltaSeconds = yesterday
    ? (today.sunset.getTime() -
        today.sunrise.getTime() -
        (yesterday.sunset.getTime() - yesterday.sunrise.getTime())) /
      1000
    : null;
  return {
    date: iso,
    sunrise: formatClock(today.sunrise, timeZone),
    sunset: formatClock(today.sunset, timeZone),
    daylight: formatDaylight(today.daylightMinutes),
    ...(deltaSeconds !== null ? { delta: formatDaylightDelta(deltaSeconds) } : {}),
  };
}
