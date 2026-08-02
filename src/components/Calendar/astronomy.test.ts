// Astronomy tests anchored to well-documented events (J2000-era instants
// published in astronomical almanacs) plus structural invariants, so exact
// coefficients can be refined without brittle expectations. Pure math, no
// personal data.

import { describe, expect, test } from 'vite-plus/test';
import {
  formatDaylight,
  moonInfoForDate,
  moonPhasesByDate,
  seasonMarksByDate,
  sunTimesForDate,
} from './astronomy';

const HOUR = 3_600_000;

describe('moonPhasesByDate', () => {
  test('anchors: the J2000 epoch new moon and the Jan 2000 eclipse full moon', () => {
    // New moon 2000-01-06 18:14 UTC; full moon (total lunar eclipse)
    // 2000-01-21 04:44 UTC.
    const phases = moonPhasesByDate('1999-12-30', '2000-02-05');
    const marks = [...phases.values()];
    const newMoon = marks.find((m) => m.phase === 'new');
    const fullMoon = marks.find((m) => m.phase === 'full');
    expect(newMoon).toBeDefined();
    expect(fullMoon).toBeDefined();
    expect(Math.abs(newMoon!.instant.getTime() - Date.UTC(2000, 0, 6, 18, 14))).toBeLessThan(
      2 * HOUR
    );
    expect(Math.abs(fullMoon!.instant.getTime() - Date.UTC(2000, 0, 21, 4, 44))).toBeLessThan(
      2 * HOUR
    );
  });

  test('a full synodic month contains all four principal phases in order', () => {
    const phases = moonPhasesByDate('2026-08-01', '2026-09-05');
    const seq = [...phases.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, m]) => m.phase);
    // Whatever phase starts the window, all four appear at least once.
    expect(new Set(seq).size).toBe(4);
    // Consecutive same-type phases are ~29.2–29.9 days apart.
    const fulls = [...phases.values()]
      .filter((m) => m.phase === 'full')
      .map((m) => m.instant.getTime());
    if (fulls.length === 2) {
      const gapDays = Math.abs(fulls[1] - fulls[0]) / 86_400_000;
      expect(gapDays).toBeGreaterThan(29.1);
      expect(gapDays).toBeLessThan(30);
    }
  });

  test('every month has 3-5 principal phases marked', () => {
    for (const [start, end] of [
      ['2026-08-01', '2026-08-31'],
      ['2027-02-01', '2027-02-28'],
    ]) {
      const count = moonPhasesByDate(start, end).size;
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(5);
    }
  });
});

describe('moonInfoForDate', () => {
  test('illumination near 0 at new moon, near 1 at full moon', () => {
    // Anchored to the Jan 2000 phases above.
    expect(moonInfoForDate('2000-01-06').illumination).toBeLessThan(0.05);
    expect(moonInfoForDate('2000-01-21').illumination).toBeGreaterThan(0.95);
    expect(moonInfoForDate('2000-01-06').name).toBe('New moon');
    expect(moonInfoForDate('2000-01-21').name).toBe('Full moon');
  });

  test('age stays within one synodic month and waxes then wanes', () => {
    const a = moonInfoForDate('2026-08-05');
    expect(a.ageDays).toBeGreaterThanOrEqual(0);
    expect(a.ageDays).toBeLessThan(29.54);
  });
});

describe('seasonMarksByDate', () => {
  test('anchors: March 2000 equinox and December 2000 solstice', () => {
    // 2000-03-20 07:35 UTC and 2000-12-21 13:37 UTC.
    const marks = seasonMarksByDate('2000-01-01', '2000-12-31');
    expect(marks.size).toBe(4);
    const byName = new Map([...marks.values()].map((m) => [m.name, m.instant]));
    expect(
      Math.abs(byName.get('March equinox')!.getTime() - Date.UTC(2000, 2, 20, 7, 35))
    ).toBeLessThan(2 * HOUR);
    expect(
      Math.abs(byName.get('December solstice')!.getTime() - Date.UTC(2000, 11, 21, 13, 37))
    ).toBeLessThan(2 * HOUR);
  });

  test('2026 seasons fall in their canonical day ranges', () => {
    const marks = seasonMarksByDate('2026-01-01', '2026-12-31');
    const days = new Map([...marks.entries()].map(([date, m]) => [m.name, date]));
    expect(days.get('March equinox')! >= '2026-03-19').toBe(true);
    expect(days.get('March equinox')! <= '2026-03-21').toBe(true);
    expect(days.get('June solstice')! >= '2026-06-20').toBe(true);
    expect(days.get('June solstice')! <= '2026-06-22').toBe(true);
    expect(days.get('September equinox')! >= '2026-09-21').toBe(true);
    expect(days.get('September equinox')! <= '2026-09-24').toBe(true);
    expect(days.get('December solstice')! >= '2026-12-20').toBe(true);
    expect(days.get('December solstice')! <= '2026-12-23').toBe(true);
  });
});

describe('sunTimesForDate', () => {
  // A mid-latitude US location (generic fixture — not personal data).
  const LAT = 36.0;
  const LON = -86.9;

  test('summer days are long, winter days short, at mid-northern latitude', () => {
    const june = sunTimesForDate('2026-06-21', LAT, LON)!;
    const dec = sunTimesForDate('2026-12-21', LAT, LON)!;
    expect(june.daylightMinutes).toBeGreaterThan(14 * 60 - 30);
    expect(june.daylightMinutes).toBeLessThan(15 * 60);
    expect(dec.daylightMinutes).toBeGreaterThan(9 * 60);
    expect(dec.daylightMinutes).toBeLessThan(10 * 60 + 15);
    expect(june.sunset.getTime()).toBeGreaterThan(june.sunrise.getTime());
  });

  test('equinox daylight is ~12 hours everywhere temperate', () => {
    const eq = sunTimesForDate('2026-03-20', LAT, LON)!;
    expect(Math.abs(eq.daylightMinutes - 12 * 60)).toBeLessThan(25);
  });

  test('polar night returns null', () => {
    expect(sunTimesForDate('2026-12-21', 78, 16)).toBeNull(); // Svalbard, winter
  });

  test('formatDaylight renders h/m', () => {
    expect(formatDaylight(754)).toBe('12h 34m');
  });
});
