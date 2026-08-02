// Almanac layer — earthly recurring marks that complement the astronomy
// layer: annual meteor-shower peaks, US federal holidays (all rule-based),
// and daylight-saving transitions detected from the browser's own timezone
// database (so the marks are correct in any locale, or absent where DST
// isn't observed). Pure functions, unit-tested in almanac.test.ts.

export interface AlmanacMark {
  emoji: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Meteor showers — major annual showers and their (approximately fixed) peak
// nights. ZHR = zenithal hourly rate under ideal dark skies.
// ---------------------------------------------------------------------------

const METEOR_SHOWERS: { mmdd: string; name: string; zhr: number }[] = [
  { mmdd: '01-03', name: 'Quadrantids', zhr: 110 },
  { mmdd: '04-22', name: 'Lyrids', zhr: 18 },
  { mmdd: '05-06', name: 'Eta Aquariids', zhr: 50 },
  { mmdd: '07-30', name: 'Delta Aquariids', zhr: 25 },
  { mmdd: '08-12', name: 'Perseids', zhr: 100 },
  { mmdd: '10-21', name: 'Orionids', zhr: 20 },
  { mmdd: '11-17', name: 'Leonids', zhr: 15 },
  { mmdd: '12-13', name: 'Geminids', zhr: 150 },
  { mmdd: '12-22', name: 'Ursids', zhr: 10 },
];

export function meteorShowersByDate(startISO: string, endISO: string): Map<string, AlmanacMark> {
  const out = new Map<string, AlmanacMark>();
  const startYear = Number(startISO.slice(0, 4));
  const endYear = Number(endISO.slice(0, 4));
  for (let year = startYear; year <= endYear; year++) {
    for (const s of METEOR_SHOWERS) {
      const date = `${year}-${s.mmdd}`;
      if (date < startISO || date > endISO) continue;
      out.set(date, { emoji: '☄️', label: `${s.name} meteor shower peak (~${s.zhr}/hr)` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// US federal holidays — every one is a fixed date or an nth-weekday rule.
// ---------------------------------------------------------------------------

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Date of the nth `weekday` (0=Sun..6=Sat) of a month; nth=-1 = last. */
function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  if (nth === -1) {
    const last = new Date(year, month, 0); // final day of `month`
    const back = (last.getDay() - weekday + 7) % 7;
    return iso(year, month, last.getDate() - back);
  }
  const first = new Date(year, month - 1, 1);
  const fwd = (weekday - first.getDay() + 7) % 7;
  return iso(year, month, 1 + fwd + (nth - 1) * 7);
}

export function usHolidaysForYear(year: number): Map<string, string> {
  return new Map([
    [iso(year, 1, 1), "New Year's Day"],
    [nthWeekday(year, 1, 1, 3), 'MLK Jr. Day'],
    [nthWeekday(year, 2, 1, 3), "Presidents' Day"],
    [nthWeekday(year, 5, 1, -1), 'Memorial Day'],
    [iso(year, 6, 19), 'Juneteenth'],
    [iso(year, 7, 4), 'Independence Day'],
    [nthWeekday(year, 9, 1, 1), 'Labor Day'],
    [nthWeekday(year, 10, 1, 2), 'Indigenous Peoples’ Day'],
    [iso(year, 11, 11), 'Veterans Day'],
    [nthWeekday(year, 11, 4, 4), 'Thanksgiving'],
    [iso(year, 12, 25), 'Christmas Day'],
  ]);
}

export function usHolidaysByDate(startISO: string, endISO: string): Map<string, string> {
  const out = new Map<string, string>();
  for (let year = Number(startISO.slice(0, 4)); year <= Number(endISO.slice(0, 4)); year++) {
    for (const [date, name] of usHolidaysForYear(year)) {
      if (date >= startISO && date <= endISO) out.set(date, name);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Daylight-saving transitions — detected from actual UTC-offset changes, so
// they follow whatever timezone the browser is in (and vanish in zones
// without DST). `offsetAt` is injectable for tests.
// ---------------------------------------------------------------------------

function defaultOffsetAt(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00`).getTimezoneOffset();
}

export function dstTransitionsByDate(
  startISO: string,
  endISO: string,
  offsetAt: (isoDate: string) => number = defaultOffsetAt
): Map<string, AlmanacMark> {
  const out = new Map<string, AlmanacMark>();
  const start = new Date(`${startISO}T12:00:00`);
  const end = new Date(`${endISO}T12:00:00`);
  let prev: number | null = null;
  for (let t = start.getTime() - 86_400_000; t <= end.getTime(); t += 86_400_000) {
    const d = new Date(t);
    const dateISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    const offset = offsetAt(dateISO);
    if (prev !== null && offset !== prev && t >= start.getTime()) {
      out.set(
        dateISO,
        // getTimezoneOffset is minutes BEHIND UTC — it shrinks when clocks
        // spring forward.
        offset < prev
          ? { emoji: '🕑', label: 'Clocks spring forward (DST begins)' }
          : { emoji: '🕐', label: 'Clocks fall back (DST ends)' }
      );
    }
    prev = offset;
  }
  return out;
}
