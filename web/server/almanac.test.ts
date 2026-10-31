// Almanac tests — holiday rules against known 2026 dates, meteor table
// sanity, and DST detection with a synthetic offset function (the real one
// depends on the host timezone, which CI doesn't guarantee). No personal
// data.

import { describe, expect, test } from 'vite-plus/test';
import {
  dstTransitionsByDate,
  holidayEmoji,
  holidayForDate,
  meteorShowersByDate,
  usHolidaysByDate,
  usHolidaysForYear,
  usObservancesForYear,
} from './almanac.js';

describe('usHolidays', () => {
  test('2026 nth-weekday holidays land on the right dates', () => {
    const h = usHolidaysForYear(2026);
    expect(h.get('2026-01-19')).toBe('MLK Jr. Day'); // 3rd Monday Jan
    expect(h.get('2026-02-16')).toBe("Presidents' Day");
    expect(h.get('2026-05-25')).toBe('Memorial Day'); // LAST Monday May
    expect(h.get('2026-09-07')).toBe('Labor Day');
    expect(h.get('2026-10-12')).toBe('Indigenous Peoples’ Day');
    expect(h.get('2026-11-26')).toBe('Thanksgiving'); // 4th Thursday Nov
    expect(h.get('2026-07-04')).toBe('Independence Day');
    expect(h.size).toBe(11);
  });

  test('window filter is inclusive, year-spanning, and carries observances', () => {
    const h = usHolidaysByDate('2026-12-20', '2027-01-05');
    expect(h.get('2026-12-24')).toBe('Christmas Eve');
    expect(h.get('2026-12-25')).toBe('Christmas Day');
    expect(h.get('2026-12-31')).toBe("New Year's Eve");
    expect(h.get('2027-01-01')).toBe("New Year's Day");
    expect(h.size).toBe(4);
  });
});

describe('usObservances', () => {
  test('2026 observances land on the right dates', () => {
    const o = usObservancesForYear(2026);
    expect(o.get('2026-10-31')).toBe('Halloween');
    expect(o.get('2026-02-14')).toBe("Valentine's Day");
    expect(o.get('2026-04-05')).toBe('Easter'); // computus
    expect(o.get('2026-05-10')).toBe("Mother's Day"); // 2nd Sunday May
    expect(o.get('2026-06-21')).toBe("Father's Day"); // 3rd Sunday June
    expect(o.size).toBe(8);
  });

  test('Easter computus across years', () => {
    expect(usObservancesForYear(2025).get('2025-04-20')).toBe('Easter');
    expect(usObservancesForYear(2027).get('2027-03-28')).toBe('Easter');
  });

  test('observances stay out of the strictly-federal set', () => {
    expect(usHolidaysForYear(2026).has('2026-10-31')).toBe(false);
  });

  test('holidayForDate answers for a single day across both sets', () => {
    expect(holidayForDate('2026-10-31')).toBe('Halloween');
    expect(holidayForDate('2026-11-26')).toBe('Thanksgiving');
    expect(holidayForDate('2026-10-30')).toBeUndefined();
  });

  test('holidayEmoji maps known names and falls back to the party popper', () => {
    expect(holidayEmoji('Halloween')).toBe('🎃');
    expect(holidayEmoji('Thanksgiving')).toBe('🦃');
    expect(holidayEmoji('Juneteenth')).toBe('🎉');
  });
});

describe('meteorShowersByDate', () => {
  test('nine major showers per year; Perseids peak mid-August', () => {
    const year = meteorShowersByDate('2026-01-01', '2026-12-31');
    expect(year.size).toBe(9);
    expect(year.get('2026-08-12')?.label).toContain('Perseids');
    expect(year.get('2026-12-13')?.label).toContain('Geminids');
  });

  test('window filtering', () => {
    const aug = meteorShowersByDate('2026-08-01', '2026-08-31');
    expect([...aug.keys()]).toEqual(['2026-08-12']);
  });
});

describe('dstTransitionsByDate', () => {
  // Synthetic US-2026-like offsets: CST (360) until Mar 7, CDT (300) from
  // Mar 8 through Oct 31, back to CST from Nov 1.
  const offsetAt = (iso: string): number => {
    if (iso < '2026-03-08') return 360;
    if (iso < '2026-11-01') return 300;
    return 360;
  };

  test('detects both transitions with the right direction', () => {
    const marks = dstTransitionsByDate('2026-01-01', '2026-12-31', offsetAt);
    expect(marks.size).toBe(2);
    expect(marks.get('2026-03-08')?.label).toContain('spring forward');
    expect(marks.get('2026-11-01')?.label).toContain('fall back');
  });

  test('no marks in a DST-free zone', () => {
    expect(dstTransitionsByDate('2026-01-01', '2026-12-31', () => 0).size).toBe(0);
  });

  test('transition just before the window start is not marked', () => {
    const marks = dstTransitionsByDate('2026-03-09', '2026-03-31', offsetAt);
    expect(marks.size).toBe(0);
  });
});
