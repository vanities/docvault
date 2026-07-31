// Pure date-math tests for the Calendar view grid/agenda helpers. All
// fixture data is fabricated (open-source repo — no real names).

import { describe, expect, test } from 'vite-plus/test';
import {
  addMonths,
  agendaBuckets,
  daysUntil,
  groupOccurrencesByDate,
  monthGridDays,
  monthTitle,
  relativeLabel,
} from './calendarMath';
import type { Occurrence } from './types';

function occ(overrides: Partial<Occurrence>): Occurrence {
  return {
    eventId: 'evt-1',
    kind: 'task',
    title: 'Replace air filter',
    date: '2026-08-15',
    completable: true,
    completed: false,
    overdue: false,
    recurrenceLabel: 'one-off',
    ...overrides,
  };
}

describe('monthGridDays', () => {
  test('always 42 cells, Sunday start, correct in-month flags', () => {
    // March 2026 starts on a Sunday.
    const march = monthGridDays({ year: 2026, month: 3 }, '2026-03-10');
    expect(march).toHaveLength(42);
    expect(march[0].date).toBe('2026-03-01');
    expect(march[0].inMonth).toBe(true);
    expect(march.filter((d) => d.inMonth)).toHaveLength(31);
    expect(march.find((d) => d.date === '2026-03-10')?.isToday).toBe(true);

    // August 2026 starts on a Saturday — leading cells from July.
    const august = monthGridDays({ year: 2026, month: 8 }, '2026-03-10');
    expect(august[0].date).toBe('2026-07-26');
    expect(august[6].date).toBe('2026-08-01');
    expect(august.filter((d) => d.inMonth)).toHaveLength(31);
  });

  test('leap February', () => {
    const feb = monthGridDays({ year: 2028, month: 2 }, '2028-01-01');
    expect(feb.filter((d) => d.inMonth)).toHaveLength(29);
  });

  test('DST months have no duplicate or missing dates', () => {
    // US DST transitions: March (spring forward) and November (fall back).
    for (const cursor of [
      { year: 2026, month: 3 },
      { year: 2026, month: 11 },
    ]) {
      const days = monthGridDays(cursor, '2026-01-01');
      const unique = new Set(days.map((d) => d.date));
      expect(unique.size).toBe(42);
    }
  });

  test('weekend flags on first and last columns', () => {
    const days = monthGridDays({ year: 2026, month: 8 }, '2026-01-01');
    for (let i = 0; i < 42; i++) {
      expect(days[i].isWeekend).toBe(i % 7 === 0 || i % 7 === 6);
    }
  });
});

describe('addMonths / monthTitle', () => {
  test('rolls across year boundaries in both directions', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 6 }, 18)).toEqual({ year: 2027, month: 12 });
  });

  test('monthTitle formats', () => {
    expect(monthTitle({ year: 2026, month: 7 })).toBe('July 2026');
  });
});

describe('daysUntil / relativeLabel', () => {
  const TODAY = '2026-07-31';

  test('daysUntil spans month boundaries', () => {
    expect(daysUntil('2026-07-31', TODAY)).toBe(0);
    expect(daysUntil('2026-08-02', TODAY)).toBe(2);
    expect(daysUntil('2026-07-28', TODAY)).toBe(-3);
  });

  test('relativeLabel wording', () => {
    expect(relativeLabel('2026-07-31', TODAY)).toBe('today');
    expect(relativeLabel('2026-08-01', TODAY)).toBe('tomorrow');
    expect(relativeLabel('2026-08-05', TODAY)).toBe('in 5 days');
    expect(relativeLabel('2026-07-30', TODAY)).toBe('1 day overdue');
    expect(relativeLabel('2026-07-20', TODAY)).toBe('11 days overdue');
    expect(relativeLabel('2026-09-14', TODAY)).toBe('Sep 14');
  });
});

describe('groupOccurrencesByDate / agendaBuckets', () => {
  const TODAY = '2026-07-31';

  test('groups by date preserving order', () => {
    const grouped = groupOccurrencesByDate([
      occ({ title: 'A', date: '2026-08-01' }),
      occ({ title: 'B', date: '2026-08-01' }),
      occ({ title: 'C', date: '2026-08-02' }),
    ]);
    expect(grouped.get('2026-08-01')?.map((o) => o.title)).toEqual(['A', 'B']);
    expect(grouped.get('2026-08-02')).toHaveLength(1);
  });

  test('buckets pending occurrences and drops completed ones', () => {
    const buckets = agendaBuckets(
      [
        occ({ title: 'Overdue task', date: '2026-07-15', overdue: true }),
        occ({ title: 'Done task', date: '2026-07-15', completed: true }),
        occ({ title: 'Today task', date: '2026-07-31' }),
        occ({ title: 'This week', date: '2026-08-05' }),
        occ({ title: 'Later', date: '2026-08-20' }),
        // A birthday last week is history, not "overdue".
        occ({
          title: 'Birthday — Alex',
          kind: 'birthday',
          date: '2026-07-20',
          completable: false,
        }),
      ],
      TODAY
    );
    expect(buckets.overdue.map((o) => o.title)).toEqual(['Overdue task']);
    expect(buckets.today.map((o) => o.title)).toEqual(['Today task']);
    expect(buckets.week.map((o) => o.title)).toEqual(['This week']);
    expect(buckets.later.map((o) => o.title)).toEqual(['Later']);
  });

  test('week boundary is 7 days inclusive', () => {
    const buckets = agendaBuckets(
      [occ({ date: '2026-08-07' }), occ({ title: 'Just past', date: '2026-08-08' })],
      TODAY
    );
    expect(buckets.week).toHaveLength(1);
    expect(buckets.later.map((o) => o.title)).toEqual(['Just past']);
  });
});
