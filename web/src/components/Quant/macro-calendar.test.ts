import { describe, expect, test } from 'vite-plus/test';
import { upcomingMacroEvents } from './macro-calendar';

describe('published macro release countdowns', () => {
  test('uses the published October CPI day instead of a second-Tuesday estimate', () => {
    const next = upcomingMacroEvents(new Date('2026-10-06T18:00:00Z'));
    expect(next[0]).toMatchObject({ date: '2026-10-14', type: 'cpi', daysAway: 8 });
    expect(next[1]).toMatchObject({ date: '2026-10-28', type: 'fomc', daysAway: 22 });
  });

  test('keeps a release today when UTC has crossed into the following day', () => {
    expect(upcomingMacroEvents(new Date('2026-01-10T02:00:00Z'), 1)[0]).toMatchObject({
      date: '2026-01-09',
      type: 'nfp',
      daysAway: 0,
    });
  });

  test('counts days across the daylight-saving change without rounding drift', () => {
    expect(upcomingMacroEvents(new Date('2026-11-01T06:30:00Z'), 1)[0]).toMatchObject({
      date: '2026-11-06',
      daysAway: 5,
    });
  });

  test('does not extrapolate unpublished future dates', () => {
    expect(upcomingMacroEvents(new Date('2030-01-01T18:00:00Z'))).toEqual([]);
  });
});
