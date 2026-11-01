import { calendarToday, loadCalendarStore, type CalendarEventKind } from '../../calendar-store.js';
import {
  addInterval,
  diffDays,
  occurrenceEnd,
  projectOccurrences,
  type Occurrence,
} from '../../calendar-recurrence.js';
import { buildSkyWeekAheadItems } from '../../calendar-sky.js';
import { getCalendarDisplayConfig } from '../../data.js';
import { formatWallClock } from '../../wall-clock.js';
import { ReadCollector } from '../request.js';
import type { ContextRequest, ContextSource } from '../types.js';

/** One row of the rendered "Week Ahead" box. `sky`/`holiday` rows come from
 *  the shared astronomy and almanac math and carry their own emoji. */
export interface WeekAheadItem {
  date: string; // YYYY-MM-DD
  title: string;
  kind: CalendarEventKind | 'sky' | 'holiday';
  overdue?: boolean;
  age?: number; // birthdays: "turns N"
  /** Inclusive last day of a multi-day row (trips); absent when single-day. */
  endDate?: string;
  /** Wall-clock HH:MM of a timed row; absent = all-day. A span's endTime
   *  belongs to its endDate. */
  time?: string;
  endTime?: string;
  emoji?: string;
}

export interface WeekAheadCalendar {
  start: string;
  end: string;
  items: WeekAheadItem[];
}

/** Format pending calendar occurrences into lines plus the "Week Ahead" box
 *  data. Pure. Lines use whatever horizon the occurrences were projected over;
 *  the box covers today to +7 days plus anything overdue, capped at 20 rows.
 *
 *  `showOverdue` mirrors settings.calendar.showOverdue (opt-in, default off)
 *  and is required so a new caller can't silently reintroduce the nagging.
 *  When off, the past-due tail is dropped outright: projectOccurrences drags
 *  overdue tasks in from before the window, and the box has no lower bound. */
export function buildCalendarDigest(
  occurrences: Occurrence[],
  today: string,
  showOverdue: boolean
): { items: string[]; weekAhead: WeekAheadCalendar } {
  const overdueDays = (date: string): number => {
    const [y1, m1, d1] = date.split('-').map(Number);
    const [y2, m2, d2] = today.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  };
  const pending = occurrences.filter((o) => !o.completed && (showOverdue || !o.overdue));
  // Multi-day rows state both ends and the length, so a reader can write
  // "away Thursday through Sunday" without date math.
  const span = (o: Occurrence): string =>
    o.endDate
      ? ` through ${o.endDate}${o.endTime ? ` at ${formatWallClock(o.endTime)}` : ''} (${
          diffDays(o.date, o.endDate) + 1
        } days)`
      : '';
  // A span's end time belongs to its last day, so span() carries it instead.
  const at = (o: Occurrence): string => {
    if (!o.time) return '';
    if (o.endTime && !o.endDate) {
      return ` from ${formatWallClock(o.time)} to ${formatWallClock(o.endTime)}`;
    }
    return ` at ${formatWallClock(o.time)}`;
  };
  const items = pending.map((o) => {
    if (o.kind === 'birthday') {
      return `Birthday ${o.date}: ${o.title}${o.age !== undefined ? ` turns ${o.age}` : ''}.`;
    }
    if (o.completable) {
      const extras: string[] = [];
      if (o.recurrenceLabel !== 'one-off') extras.push(o.recurrenceLabel);
      if (o.overdue) extras.push(`overdue ${overdueDays(occurrenceEnd(o))} days`);
      return `Due ${o.date}${at(o)}${span(o)}: ${o.title}${extras.length ? ` (${extras.join('; ')})` : ''}.`;
    }
    return `Event ${o.date}${at(o)}${span(o)}: ${o.title}.`;
  });
  const weekEnd = addInterval(today, 7, 'day');
  const weekAhead: WeekAheadCalendar = {
    start: today,
    end: weekEnd,
    items: pending
      .filter((o) => o.date <= weekEnd || o.overdue)
      .slice(0, 20)
      .map((o) => ({
        date: o.date,
        title: o.title,
        kind: o.kind,
        ...(o.overdue ? { overdue: true } : {}),
        ...(o.age !== undefined ? { age: o.age } : {}),
        ...(o.endDate ? { endDate: o.endDate } : {}),
        ...(o.time ? { time: o.time } : {}),
        ...(o.endTime ? { endTime: o.endTime } : {}),
      })),
  };
  return { items, weekAhead };
}

/**
 * Pending occurrences over the horizon (7 days for a daily, 30 otherwise), plus
 * overdue tasks when that layer is on, and the Week Ahead box with sky and
 * almanac rows (moons, seasons, meteors, holidays, DST) honoring the
 * settings.calendar display toggles. Sky rows are also lines, so a full moon
 * can get a sentence; the box still owns the exact dates.
 */
export async function calendarDigest(
  purpose: ContextRequest['purpose'],
  today?: string,
  onSkyError?: (err: unknown) => void
): Promise<{ items: string[]; weekAhead: WeekAheadCalendar }> {
  const horizonDays = purpose === 'daily' ? 7 : 30;
  const day = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : await calendarToday();
  const store = await loadCalendarStore();
  // Overdue nagging is the one opt-in layer, and this is its second consumer
  // alongside CalendarView.
  const cfg = await getCalendarDisplayConfig();
  const occurrences = projectOccurrences(
    store.events,
    { start: day, end: addInterval(day, horizonDays, 'day') },
    day
  );
  const digest = buildCalendarDigest(occurrences, day, cfg.showOverdue);
  try {
    const sky = buildSkyWeekAheadItems(day, digest.weekAhead.end, cfg);
    if (sky.length > 0) {
      digest.weekAhead.items = [...digest.weekAhead.items, ...sky].sort((a, b) =>
        a.date < b.date ? -1 : 1
      );
      for (const s of sky) digest.items.push(`Sky ${s.date}: ${s.title}.`);
    }
  } catch (err) {
    onSkyError?.(err);
  }
  return digest;
}

export const calendarSource: ContextSource = {
  id: 'calendar',
  label: 'Calendar',
  group: 'calendar',
  description:
    'Upcoming birthdays, tasks and events (7 days ahead for a daily, 30 otherwise) with exact ' +
    'dates and times, overdue tasks when that setting is on, and sky and holiday dates.',
  files: ['.docvault-calendar.json'],
  async read(req) {
    const r = new ReadCollector();
    await r.part('calendar', async () => {
      let skyError: unknown;
      const digest = await calendarDigest(req.purpose, req.today, (err) => (skyError = err));
      r.lines.push(...digest.items);
      if (skyError !== undefined) {
        await r.part('calendar/sky', () => {
          throw skyError;
        });
      }
    });
    return r.result();
  },
};
