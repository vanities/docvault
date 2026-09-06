// Pure date-math tests for the Calendar view grid/agenda helpers. All
// fixture data is fabricated (open-source repo — no real names).

import { describe, expect, test } from 'vite-plus/test';
import {
  addMonths,
  comingMonthGroups,
  agendaBuckets,
  daysUntil,
  formatDateRange,
  groupOccurrencesByDate,
  isOngoing,
  monthGridDays,
  monthTitle,
  occurrenceTimingLabel,
  relativeLabel,
  spanLength,
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
    expect(grouped.get('2026-08-01')?.map((s) => s.occ.title)).toEqual(['A', 'B']);
    expect(grouped.get('2026-08-02')).toHaveLength(1);
  });

  test('a multi-day occurrence gets one segment per day it covers', () => {
    const grouped = groupOccurrencesByDate([
      occ({ title: 'Trip to Denver', kind: 'event', date: '2026-08-03', endDate: '2026-08-06' }),
      occ({ title: 'Single day', date: '2026-08-05' }),
    ]);
    expect([...grouped.keys()]).toEqual(['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']);
    const trip = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'].map(
      (d) => grouped.get(d)!.find((s) => s.occ.title === 'Trip to Denver')!
    );
    expect(trip.map((s) => [s.dayIndex, s.isStart, s.isEnd])).toEqual([
      [1, true, false],
      [2, false, false],
      [3, false, false],
      [4, false, true],
    ]);
    expect(trip.every((s) => s.dayCount === 4)).toBe(true);
    // The single-day event still gets exactly one segment, on its own day.
    expect(grouped.get('2026-08-05')).toHaveLength(2);
    expect(grouped.get('2026-08-04')?.map((s) => s.occ.title)).toEqual(['Trip to Denver']);
  });

  test('a span crossing a month boundary keeps counting days', () => {
    const grouped = groupOccurrencesByDate([
      occ({ title: 'Conference', kind: 'event', date: '2026-08-30', endDate: '2026-09-02' }),
    ]);
    expect([...grouped.keys()]).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });

  test('spanLength counts both ends', () => {
    expect(spanLength(occ({ date: '2026-08-03' }))).toBe(1);
    expect(spanLength(occ({ date: '2026-08-03', endDate: '2026-08-03' }))).toBe(1);
    expect(spanLength(occ({ date: '2026-08-03', endDate: '2026-08-09' }))).toBe(7);
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

  test('an in-progress multi-day event buckets under Today, not Overdue', () => {
    const buckets = agendaBuckets(
      [
        // Started Monday, runs through next week — today sits inside it.
        occ({
          title: 'Trip to Denver',
          kind: 'event',
          completable: false,
          date: '2026-07-28',
          endDate: '2026-08-04',
        }),
        // Ended yesterday: history, and non-completable, so it drops out.
        occ({
          title: 'Last trip',
          kind: 'event',
          completable: false,
          date: '2026-07-25',
          endDate: '2026-07-30',
        }),
        // A task whose span already closed is genuinely overdue.
        occ({ title: 'Multi-day chore', date: '2026-07-25', endDate: '2026-07-30' }),
        // Starts inside the week — still a future item.
        occ({
          title: 'Next trip',
          kind: 'event',
          completable: false,
          date: '2026-08-03',
          endDate: '2026-08-09',
        }),
      ],
      TODAY
    );
    expect(buckets.today.map((o) => o.title)).toEqual(['Trip to Denver']);
    expect(buckets.overdue.map((o) => o.title)).toEqual(['Multi-day chore']);
    expect(buckets.week.map((o) => o.title)).toEqual(['Next trip']);
    expect(buckets.later).toEqual([]);
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

describe('comingMonthGroups', () => {
  const TODAY = '2026-07-31';
  const AFTER = '2026-08-07'; // end of "This Week"

  test('groups pending occurrences after the boundary by month, in order', () => {
    const groups = comingMonthGroups(
      [
        occ({ title: 'This week — excluded', date: '2026-08-05' }),
        occ({ title: 'Boundary day — excluded', date: '2026-08-07' }),
        occ({ title: 'Mid August', date: '2026-08-15' }),
        occ({ title: 'Late August', date: '2026-08-24' }),
        occ({ title: 'Done — excluded', date: '2026-09-10', completed: true }),
        occ({ title: 'September thing', date: '2026-09-15' }),
        occ({ title: 'Next year', date: '2027-01-01' }),
      ],
      AFTER,
      TODAY
    );
    expect(groups.map((g) => [g.key, g.label, g.items.length])).toEqual([
      ['2026-08', 'August', 2],
      ['2026-09', 'September', 1],
      ['2027-01', 'January 2027', 1], // year shown when it differs from today's
    ]);
    expect(groups[0].items.map((o) => o.title)).toEqual(['Mid August', 'Late August']);
  });

  test('empty when nothing lies beyond the boundary', () => {
    expect(comingMonthGroups([occ({ date: '2026-08-01' })], AFTER, TODAY)).toEqual([]);
  });
});

describe('span labels', () => {
  const TODAY = '2026-07-31';

  test('isOngoing only covers a span already started and not yet finished', () => {
    const trip = occ({ date: '2026-07-28', endDate: '2026-08-04' });
    expect(isOngoing(trip, TODAY)).toBe(true);
    expect(isOngoing(trip, '2026-07-28')).toBe(false); // first day: not yet "ongoing"
    expect(isOngoing(trip, '2026-08-04')).toBe(true); // last day still counts
    expect(isOngoing(trip, '2026-08-05')).toBe(false);
    expect(isOngoing(occ({ date: '2026-07-31' }), TODAY)).toBe(false); // single-day
  });

  test('timing label counts the day within a running span', () => {
    const trip = occ({ date: '2026-07-28', endDate: '2026-08-04' });
    expect(occurrenceTimingLabel(trip, TODAY)).toBe('day 4 of 8');
    // Before it starts it reads like any other upcoming item.
    expect(occurrenceTimingLabel(trip, '2026-07-27')).toBe('tomorrow');
  });

  test('formatDateRange collapses the shared month and year', () => {
    expect(formatDateRange('2026-10-03', '2026-10-09')).toBe('Oct 3 – 9');
    expect(formatDateRange('2026-10-30', '2026-11-02')).toBe('Oct 30 – Nov 2');
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
  });
});
