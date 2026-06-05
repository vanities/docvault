import { expect, test, describe } from 'vite-plus/test';
import { clampInt, localYMD, dailyNewsPlan } from './daily-news-schedule.js';

// Dates are constructed with new Date(y, monthIndex, d, h) — LOCAL time, exactly
// how the scheduler reads the wall clock. monthIndex is 0-based (5 = June).

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
  const enabled = { dailyNewsEnabled: true, dailyNewsHour: 7, dailyNewsWeeklyDay: 0 };

  test('null when disabled or schedules missing', () => {
    expect(dailyNewsPlan(new Date(2026, 5, 5, 9), { dailyNewsEnabled: false })).toBeNull();
    expect(dailyNewsPlan(new Date(2026, 5, 5, 9), undefined)).toBeNull();
    expect(dailyNewsPlan(new Date(2026, 5, 5, 9), {})).toBeNull();
  });

  test('null before the publish hour, a plan at/after it', () => {
    expect(dailyNewsPlan(new Date(2026, 5, 5, 6, 59), enabled)).toBeNull();
    const plan = dailyNewsPlan(new Date(2026, 5, 5, 7, 0), enabled);
    expect(plan).not.toBeNull();
    expect(plan!.today).toBe('2026-06-05');
  });

  test('hour defaults to 7 when unset', () => {
    const cfg = { dailyNewsEnabled: true };
    expect(dailyNewsPlan(new Date(2026, 5, 5, 6), cfg)).toBeNull();
    expect(dailyNewsPlan(new Date(2026, 5, 5, 7), cfg)).not.toBeNull();
  });

  test('weekStart is six local days earlier (handles month rollover)', () => {
    // 2026-06-05 minus 6 days = 2026-05-30.
    expect(dailyNewsPlan(new Date(2026, 5, 5, 8), enabled)!.weekStart).toBe('2026-05-30');
    // 2026-01-03 minus 6 days = 2025-12-28 (year rollover).
    expect(dailyNewsPlan(new Date(2026, 0, 3, 8), enabled)!.weekStart).toBe('2025-12-28');
  });

  test('isWeeklyDay matches the configured weekday', () => {
    const d = new Date(2026, 5, 7, 8);
    const wd = d.getDay();
    expect(dailyNewsPlan(d, { ...enabled, dailyNewsWeeklyDay: wd })!.isWeeklyDay).toBe(true);
    expect(dailyNewsPlan(d, { ...enabled, dailyNewsWeeklyDay: (wd + 1) % 7 })!.isWeeklyDay).toBe(
      false
    );
  });
});
