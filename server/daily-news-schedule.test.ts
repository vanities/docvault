import { expect, test, describe } from 'vite-plus/test';
import type { Settings } from './data.js';
import { clampInt, localYMD, dailyNewsPlan } from './daily-news-schedule.js';
import { getConfiguredTimezone } from './tz.js';

describe('clampInt', () => {
  test('rounds then clamps to range', () => {
    expect(clampInt(7.4, 0, 23)).toBe(7);
    expect(clampInt(-5, 0, 23)).toBe(0);
    expect(clampInt(99, 0, 23)).toBe(23);
    expect(clampInt(3.5, 0, 6)).toBe(4);
  });
});

describe('localYMD', () => {
  test('formats local date parts and zero-pads', () => {
    expect(localYMD(new Date(2026, 5, 5, 12))).toBe('2026-06-05');
    expect(localYMD(new Date(2026, 0, 9, 1))).toBe('2026-01-09');
  });
});

describe('dailyNewsPlan', () => {
  // Instants are fixed with Date.UTC so the tests are independent of the
  // machine's timezone; the 3rd arg is the IANA zone the publish-hour gate, the
  // per-day dedup key, and the weekly-day check are evaluated in.
  // America/Chicago is UTC-5 in June (CDT); America/Anchorage is UTC-8 (AKDT).
  const enabled = { dailyNewsEnabled: true, dailyNewsHour: 7, dailyNewsWeeklyDay: 0 };
  const CHI = 'America/Chicago';

  test('null when disabled or schedules missing', () => {
    const afternoon = new Date(Date.UTC(2026, 5, 5, 18)); // 13:00 CDT
    expect(dailyNewsPlan(afternoon, { dailyNewsEnabled: false }, CHI)).toBeNull();
    expect(dailyNewsPlan(afternoon, undefined, CHI)).toBeNull();
    expect(dailyNewsPlan(afternoon, {}, CHI)).toBeNull();
  });

  test('publish-hour gate is evaluated in the given timezone, not UTC', () => {
    // 11:59 UTC = 06:59 CDT → before 07:00 → null.
    expect(dailyNewsPlan(new Date(Date.UTC(2026, 5, 5, 11, 59)), enabled, CHI)).toBeNull();
    // 12:00 UTC = 07:00 CDT → exactly the publish hour → a plan.
    const plan = dailyNewsPlan(new Date(Date.UTC(2026, 5, 5, 12, 0)), enabled, CHI);
    expect(plan).not.toBeNull();
    expect(plan!.today).toBe('2026-06-05');
  });

  test('the same instant decides differently across zones', () => {
    const instant = new Date(Date.UTC(2026, 5, 5, 12)); // 12:00 UTC
    expect(dailyNewsPlan(instant, enabled, 'UTC')).not.toBeNull(); // 12:00 ≥ 07
    expect(dailyNewsPlan(instant, enabled, 'America/Anchorage')).toBeNull(); // 04:00 AKDT
  });

  test('today + weekStart use the calendar date in the given zone', () => {
    // 02:00 UTC Jun 5 = 21:00 CDT Jun 4 — still the 4th in Chicago.
    const plan = dailyNewsPlan(
      new Date(Date.UTC(2026, 5, 5, 2)),
      { ...enabled, dailyNewsHour: 0 },
      CHI
    );
    expect(plan!.today).toBe('2026-06-04');
    expect(plan!.weekStart).toBe('2026-05-29'); // six days earlier, in-zone
  });

  test('isWeeklyDay matches the weekday in the given zone', () => {
    // 02:00 UTC Sun Jun 7 = 21:00 CDT Sat Jun 6 → Saturday (6) in Chicago.
    const instant = new Date(Date.UTC(2026, 5, 7, 2));
    expect(
      dailyNewsPlan(instant, { ...enabled, dailyNewsHour: 0, dailyNewsWeeklyDay: 6 }, CHI)!
        .isWeeklyDay
    ).toBe(true);
    expect(
      dailyNewsPlan(instant, { ...enabled, dailyNewsHour: 0, dailyNewsWeeklyDay: 0 }, CHI)!
        .isWeeklyDay
    ).toBe(false);
  });
});

describe('getConfiguredTimezone', () => {
  const s = (o: Partial<Settings>): Settings => o as Settings;

  test('prefers the location (weather) zone over a legacy schedules zone', () => {
    expect(
      getConfiguredTimezone(
        s({ weather: { timezone: 'America/Chicago' }, schedules: { timezone: 'America/New_York' } })
      )
    ).toBe('America/Chicago');
  });

  test('falls back to a legacy schedules.timezone when no location zone is set', () => {
    expect(getConfiguredTimezone(s({ schedules: { timezone: 'America/New_York' } }))).toBe(
      'America/New_York'
    );
  });

  test('ignores an invalid zone and falls through to the next source', () => {
    expect(
      getConfiguredTimezone(
        s({ weather: { timezone: 'Not/AZone' }, schedules: { timezone: 'America/Denver' } })
      )
    ).toBe('America/Denver');
  });
});
