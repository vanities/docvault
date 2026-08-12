// Sky Week-Ahead rows: toggle gating + content sanity. Pure math over the
// shared calendar modules; no DATA_DIR, no personal data.

import { describe, expect, test } from 'vite-plus/test';
import { buildSkyWeekAheadItems } from './calendar-sky.js';

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
