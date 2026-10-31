// Theme resolution tests — pure date math against the fixed style list.
// No personal data.

import { describe, expect, test } from 'vite-plus/test';
import { DAILY_NEWS_THEMES, resolveTheme } from './daily-news-themes.js';

describe('resolveTheme', () => {
  test('a pinned theme passes through unchanged', () => {
    expect(resolveTheme('economist', '2026-06-15')).toBe('economist');
  });

  test('unknown or missing config falls back to brew', () => {
    expect(resolveTheme(undefined, '2026-06-15')).toBe('brew');
    expect(resolveTheme('not-a-theme', '2026-06-15')).toBe('brew');
  });

  test('cycle covers all styles across a holiday-free week, deterministically', () => {
    // 2026-11-02..08 has no federal holiday or observance.
    const week = [2, 3, 4, 5, 6, 7, 8].map((d) => resolveTheme('cycle', `2026-11-0${d}`));
    expect(new Set(week).size).toBe(DAILY_NEWS_THEMES.length);
    expect(resolveTheme('cycle', '2026-11-02')).toBe(week[0]);
  });

  test('cycle wears the holiday skin on skin dates', () => {
    expect(resolveTheme('cycle', '2026-10-31')).toBe('noir'); // Halloween
    expect(resolveTheme('cycle', '2026-12-24')).toBe('victorian');
    expect(resolveTheme('cycle', '2026-12-25')).toBe('victorian');
    expect(resolveTheme('cycle', '2027-10-31')).toBe('noir'); // any year
  });

  test('a pinned theme is never hijacked by a holiday', () => {
    expect(resolveTheme('brew', '2026-10-31')).toBe('brew');
    expect(resolveTheme(undefined, '2026-10-31')).toBe('brew');
  });
});
