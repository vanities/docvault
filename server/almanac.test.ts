// Almanac tests — holiday rules against known 2026 dates, meteor table
// sanity, and DST detection with a synthetic offset function (the real one
// depends on the host timezone, which CI doesn't guarantee). No personal
// data.

import { describe, expect, test } from 'vite-plus/test';
import {
  dstTransitionsByDate,
  meteorShowersByDate,
  usHolidaysByDate,
  usHolidaysForYear,
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

  test('window filter is inclusive and year-spanning', () => {
    const h = usHolidaysByDate('2026-12-20', '2027-01-05');
    expect(h.get('2026-12-25')).toBe('Christmas Day');
    expect(h.get('2027-01-01')).toBe("New Year's Day");
    expect(h.size).toBe(2);
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
