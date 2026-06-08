import { expect, test, describe } from 'vite-plus/test';
import { clampInt, localYMD, dailyNewsPlan } from './daily-news-schedule.js';

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
  // Instants are fixed with Date.UTC so these tests are independent of the
  // machine's timezone; `schedules.timezone` is what the publish-hour gate, the
  // per-day dedup key, and the weekly-day check are evaluated against.
  // America/Chicago is UTC-5 in June (CDT); America/Anchorage is UTC-8 (AKDT).
  const enabled = {
    dailyNewsEnabled: true,
    dailyNewsHour: 7,
    dailyNewsWeeklyDay: 0,
    timezone: 'America/Chicago',
  };

  test('null when disabled or schedules missing', () => {
    const afternoon = new Date(Date.UTC(2026, 5, 5, 18)); // 13:00 CDT
    expect(dailyNewsPlan(afternoon, { dailyNewsEnabled: false })).toBeNull();
    expect(dailyNewsPlan(afternoon, undefined)).toBeNull();
    expect(dailyNewsPlan(afternoon, {})).toBeNull();
  });

  test('publish-hour gate is evaluated in the configured timezone, not UTC', () => {
    // 11:59 UTC = 06:59 CDT → before 07:00 → null.
    expect(dailyNewsPlan(new Date(Date.UTC(2026, 5, 5, 11, 59)), enabled)).toBeNull();
    // 12:00 UTC = 07:00 CDT → exactly the publish hour → a plan.
    const plan = dailyNewsPlan(new Date(Date.UTC(2026, 5, 5, 12, 0)), enabled);
    expect(plan).not.toBeNull();
    expect(plan!.today).toBe('2026-06-05');
  });

  test('the same instant decides differently across zones', () => {
    const instant = new Date(Date.UTC(2026, 5, 5, 12)); // 12:00 UTC
    // 12:00 UTC ≥ 07 → a plan in UTC.
    expect(dailyNewsPlan(instant, { ...enabled, timezone: 'UTC' })).not.toBeNull();
    // 12:00 UTC = 04:00 AKDT → before 07 → null.
    expect(dailyNewsPlan(instant, { ...enabled, timezone: 'America/Anchorage' })).toBeNull();
  });

  test('defaults to UTC when timezone is unset', () => {
    const cfg = { dailyNewsEnabled: true }; // no timezone; hour defaults to 7
    expect(dailyNewsPlan(new Date(Date.UTC(2026, 5, 5, 6)), cfg)).toBeNull(); // 06:00 UTC
    expect(dailyNewsPlan(new Date(Date.UTC(2026, 5, 5, 7)), cfg)).not.toBeNull(); // 07:00 UTC
  });

  test('today + weekStart use the calendar date in the configured zone', () => {
    // 02:00 UTC Jun 5 = 21:00 CDT Jun 4 — still the 4th in Chicago.
    const plan = dailyNewsPlan(new Date(Date.UTC(2026, 5, 5, 2)), { ...enabled, dailyNewsHour: 0 });
    expect(plan!.today).toBe('2026-06-04');
    expect(plan!.weekStart).toBe('2026-05-29'); // six days earlier, in-zone
  });

  test('isWeeklyDay matches the weekday in the configured zone', () => {
    // 02:00 UTC Sun Jun 7 = 21:00 CDT Sat Jun 6 → Saturday (6) in Chicago.
    const instant = new Date(Date.UTC(2026, 5, 7, 2));
    expect(
      dailyNewsPlan(instant, { ...enabled, dailyNewsHour: 0, dailyNewsWeeklyDay: 6 })!.isWeeklyDay
    ).toBe(true);
    expect(
      dailyNewsPlan(instant, { ...enabled, dailyNewsHour: 0, dailyNewsWeeklyDay: 0 })!.isWeeklyDay
    ).toBe(false);
  });
});
