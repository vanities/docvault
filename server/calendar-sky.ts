// Sky/almanac rows for the Daily News "Week Ahead" box. Imports the SAME
// pure math modules the Calendar view uses (src/components/Calendar/*, which
// are dependency-free), so the paper and the UI can never disagree about
// when the full moon is. Dates resolve in the server's local timezone — the
// container's TZ is set to the household timezone (see Makefile/deploy).
// Every layer is gated by the settings.calendar toggles (see
// getCalendarDisplayConfig): a layer turned off in the calendar disappears
// from the paper too.

import { moonPhasesByDate, seasonMarksByDate } from '../src/components/Calendar/astronomy';
import {
  dstTransitionsByDate,
  meteorShowersByDate,
  usHolidaysByDate,
} from '../src/components/Calendar/almanac';
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
