// Sky Week-Ahead rows: toggle gating + content sanity. Pure math over the
// shared calendar modules; no DATA_DIR, no personal data.

import { describe, expect, test } from 'vite-plus/test';
import { buildSkyWeekAheadItems, buildSunAlmanac } from './calendar-sky.js';

const ALL_ON = {
  showMoon: true,
  showSeasons: true,
  showAstrology: true,
  showMeteors: true,
  showSunTimes: true,
  showHolidays: true,
  showDst: true,
  showWeather: true,
  showOverdue: true, // unused by the sky builder; present to satisfy Required<>
};

describe('buildSkyWeekAheadItems', () => {
  test('a Perseids + full-moon week carries sky rows, sorted by date', () => {
    const items = buildSkyWeekAheadItems('2026-08-09', '2026-08-16', ALL_ON);
    expect(items.some((i) => i.title.includes('Perseids'))).toBe(true);
    const dates = items.map((i) => i.date);
    expect([...dates].sort()).toEqual(dates);
    for (const i of items) {
      expect(i.emoji.length).toBeGreaterThan(0);
      expect(['sky', 'holiday']).toContain(i.kind);
    }
  });

  test('holidays appear as holiday rows', () => {
    const items = buildSkyWeekAheadItems('2026-11-23', '2026-11-29', ALL_ON);
    const thanksgiving = items.find((i) => i.title === 'Thanksgiving');
    expect(thanksgiving?.kind).toBe('holiday');
    expect(thanksgiving?.date).toBe('2026-11-26');
  });

  test('toggles remove their layers everywhere (the newspaper contract)', () => {
    const cfg = { ...ALL_ON, showMeteors: false, showHolidays: false };
    const items = buildSkyWeekAheadItems('2026-11-15', '2026-12-31', cfg);
    expect(items.some((i) => i.title.includes('Geminids'))).toBe(false);
    expect(items.some((i) => i.kind === 'holiday')).toBe(false);
    // Moon rows still present with their layer on.
    expect(items.some((i) => i.kind === 'sky')).toBe(true);
  });

  test('only new/full moons make the paper — no quarters', () => {
    const items = buildSkyWeekAheadItems('2026-08-01', '2026-08-31', ALL_ON);
    expect(items.some((i) => i.title.includes('quarter'))).toBe(false);
  });
});

// A round synthetic point — 40°N, 90°W, in the US Central zone. Deliberately
// not a real address; the assertions below only need a mid-northern latitude,
// and the values are checkable against any published sunrise table for 40°N.
const LAT = 40;
const LON = -90;
const TZ = 'America/Chicago';

describe('buildSunAlmanac', () => {
  test('reads sunrise before sunset, with daylight matching the span', () => {
    const sun = buildSunAlmanac('2026-08-18', LAT, LON, TZ, ALL_ON);
    expect(sun).not.toBeNull();
    expect(sun!.date).toBe('2026-08-18');
    // Mid-August at 40°N: sunrise just after 6am, sunset just before 8pm,
    // ~13h40m of daylight.
    expect(sun!.sunrise).toBe('6:14 AM');
    expect(sun!.sunset).toBe('7:52 PM');
    expect(sun!.daylight).toBe('13h 39m');
  });

  test('formats in the GIVEN zone, not the process zone', () => {
    const central = buildSunAlmanac('2026-08-18', LAT, LON, 'America/Chicago', ALL_ON);
    const utc = buildSunAlmanac('2026-08-18', LAT, LON, 'UTC', ALL_ON);
    // Same instant, two zones — 5h apart in August (CDT).
    expect(central!.sunrise).toBe('6:14 AM');
    expect(utc!.sunrise).toBe('11:14 AM');
    // The day LENGTH is a difference of instants, so it is zone-independent.
    expect(central!.daylight).toBe(utc!.daylight);
  });

  test('daylight delta shrinks after the June solstice and grows after December', () => {
    // Direction is the whole point of the delta — a sign flip on the wrong side
    // of a solstice is the failure mode worth pinning.
    expect(buildSunAlmanac('2026-08-18', LAT, LON, TZ, ALL_ON)!.delta).toMatch(/^-/);
    expect(buildSunAlmanac('2026-03-20', LAT, LON, TZ, ALL_ON)!.delta).toMatch(/^\+/);
    // Within days of a solstice the change is under a minute, so it must still
    // render in seconds rather than collapsing to a flat "0m".
    expect(buildSunAlmanac('2026-06-21', LAT, LON, TZ, ALL_ON)!.delta).toMatch(/^[+-]\d+s$/);
  });

  test('the showSunTimes toggle removes it from the paper', () => {
    expect(
      buildSunAlmanac('2026-08-18', LAT, LON, TZ, { ...ALL_ON, showSunTimes: false })
    ).toBeNull();
  });

  test('polar night yields no reading rather than a bogus one', () => {
    // 78°N in December is inside the polar night — the sun never rises.
    expect(buildSunAlmanac('2026-12-21', 78, 15, 'UTC', ALL_ON)).toBeNull();
  });
});
