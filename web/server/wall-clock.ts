// Wall-clock times ("HH:MM", 24-hour): timesheet entry spans and calendar
// event times. A wall time is a label in the household's configured timezone,
// never an instant, so nothing here touches Date or timezone math and a
// recurring 5 PM stays 5 PM across a DST change. Pure, no I/O: the frontend
// imports this file directly (src may import server, never the reverse; see
// no-src-imports.test.ts).

const HHMM = /^\d{2}:\d{2}$/;

export function isValidTime(value: string): boolean {
  if (!HHMM.test(value)) return false;
  const [h, m] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Display a HH:MM wall time: "17:30" → "5:30 PM", or as-is when `hour24`. */
export function formatWallClock(value: string, hour24 = false): string {
  if (hour24) return value;
  const [h, m] = value.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/** Compact form for narrow month-grid chips: "5pm", "5:30pm", "12am". */
export function formatWallClockShort(value: string): string {
  const [h, m] = value.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

/** "2:00 PM – 3:00 PM", or just the start when there is no end. */
export function formatTimeRange(start: string, end?: string): string {
  return end ? `${formatWallClock(start)} – ${formatWallClock(end)}` : formatWallClock(start);
}
