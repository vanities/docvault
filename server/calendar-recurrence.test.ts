// Pure date-math tests for the calendar recurrence projector. No DATA_DIR,
// no I/O. All fixture data is fabricated (open-source repo — no real names).

import { expect, test, describe } from 'vite-plus/test';
import type { CalendarEvent } from './calendar-store.js';
import {
  addInterval,
  daysInMonth,
  describeRecurrence,
  isYMD,
  nextOccurrence,
  projectEvent,
  projectOccurrences,
} from './calendar-recurrence.js';

let nextId = 0;
function makeEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: `evt-${nextId++}`,
    kind: 'task',
    title: 'Replace HVAC filter',
    date: '2026-01-15',
    recurrence: null,
    status: 'active',
    completions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isYMD / daysInMonth', () => {
  test('accepts real dates, rejects malformed and impossible ones', () => {
    expect(isYMD('2026-07-31')).toBe(true);
    expect(isYMD('2024-02-29')).toBe(true); // leap
    expect(isYMD('2026-02-29')).toBe(false); // non-leap
    expect(isYMD('2026-13-01')).toBe(false);
    expect(isYMD('2026-00-10')).toBe(false);
    expect(isYMD('2026-04-31')).toBe(false);
    expect(isYMD('26-04-01')).toBe(false);
    expect(isYMD('2026/04/01')).toBe(false);
  });

  test('daysInMonth handles leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
    expect(daysInMonth(1900, 2)).toBe(28); // divisible by 100, not 400
  });
});

describe('addInterval', () => {
  test('month addition clamps to the end of the target month', () => {
    expect(addInterval('2026-01-31', 1, 'month')).toBe('2026-02-28');
    expect(addInterval('2024-01-31', 1, 'month')).toBe('2024-02-29'); // leap target
    expect(addInterval('2026-01-31', 2, 'month')).toBe('2026-03-31'); // no drift through Feb
    expect(addInterval('2026-03-31', 1, 'month')).toBe('2026-04-30');
  });

  test('year addition clamps Feb 29 to Feb 28 in non-leap targets', () => {
    expect(addInterval('2024-02-29', 1, 'year')).toBe('2025-02-28');
    expect(addInterval('2024-02-29', 4, 'year')).toBe('2028-02-29');
  });

  test('month addition rolls across year boundaries', () => {
    expect(addInterval('2026-11-15', 3, 'month')).toBe('2027-02-15');
    expect(addInterval('2026-01-15', 12, 'month')).toBe('2027-01-15');
    expect(addInterval('2026-01-15', -2, 'month')).toBe('2025-11-15');
  });

  test('day and week addition cross month/year boundaries', () => {
    expect(addInterval('2026-12-31', 1, 'day')).toBe('2027-01-01');
    expect(addInterval('2026-03-07', 2, 'week')).toBe('2026-03-21');
    expect(addInterval('2026-01-05', -7, 'day')).toBe('2025-12-29');
  });
});

describe('describeRecurrence', () => {
  test('labels', () => {
    expect(describeRecurrence(null, 'task')).toBe('one-off');
    expect(describeRecurrence(undefined, 'event')).toBe('one-off');
    expect(describeRecurrence({ interval: 1, unit: 'month', anchor: 'fixed' }, 'task')).toBe(
      'monthly'
    );
    expect(describeRecurrence({ interval: 3, unit: 'month', anchor: 'fixed' }, 'task')).toBe(
      'every 3 months'
    );
    expect(
      describeRecurrence({ interval: 6, unit: 'month', anchor: 'afterCompletion' }, 'task')
    ).toBe('every 6 months after completion');
    expect(describeRecurrence({ interval: 1, unit: 'year', anchor: 'fixed' }, 'event')).toBe(
      'yearly'
    );
    // Birthdays ignore any stored recurrence — implicitly yearly.
    expect(describeRecurrence(null, 'birthday')).toBe('yearly');
  });
});

describe('projectEvent — birthdays', () => {
  test('yearly on MM-DD with age from birthYear', () => {
    const bday = makeEvent({
      kind: 'birthday',
      title: 'Birthday — Alex',
      date: '1992-08-02',
      birthYear: 1992,
    });
    const occs = projectEvent(bday, { start: '2026-07-01', end: '2027-08-31' }, '2026-07-31');
    expect(occs.map((o) => o.date)).toEqual(['2026-08-02', '2027-08-02']);
    expect(occs[0].age).toBe(34);
    expect(occs[1].age).toBe(35);
    expect(occs[0].completable).toBe(false);
    expect(occs[0].overdue).toBe(false);
    expect(occs[0].recurrenceLabel).toBe('yearly');
  });

  test('no age when birthYear is unknown', () => {
    const bday = makeEvent({ kind: 'birthday', title: 'Birthday — Sam', date: '2000-05-10' });
    const [occ] = projectEvent(bday, { start: '2026-05-01', end: '2026-05-31' }, '2026-05-01');
    expect(occ.date).toBe('2026-05-10');
    expect(occ.age).toBeUndefined();
  });

  test('leap-day birthday lands on Feb 28 in non-leap years', () => {
    const bday = makeEvent({
      kind: 'birthday',
      title: 'Birthday — Jordan',
      date: '2000-02-29',
      birthYear: 2000,
    });
    const nonLeap = projectEvent(bday, { start: '2027-02-01', end: '2027-03-01' }, '2027-01-01');
    expect(nonLeap.map((o) => o.date)).toEqual(['2027-02-28']);
    expect(nonLeap[0].age).toBe(27);
    const leap = projectEvent(bday, { start: '2028-02-01', end: '2028-03-01' }, '2028-01-01');
    expect(leap.map((o) => o.date)).toEqual(['2028-02-29']);
    expect(leap[0].age).toBe(28);
  });
});

describe('projectEvent — fixed recurrence', () => {
  test('monthly from Jan 31 clamps per-month without drifting', () => {
    const task = makeEvent({
      date: '2026-01-31',
      recurrence: { interval: 1, unit: 'month', anchor: 'fixed' },
    });
    const occs = projectEvent(task, { start: '2026-01-01', end: '2026-05-31' }, '2026-01-01');
    expect(occs.map((o) => o.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  test('completions mark occurrences; pending past occurrences are overdue', () => {
    const task = makeEvent({
      title: 'Quarterly estimated tax',
      date: '2026-01-15',
      recurrence: { interval: 3, unit: 'month', anchor: 'fixed' },
      completions: [
        {
          occurrenceDate: '2026-01-15',
          completedOn: '2026-01-14',
          completedAt: '2026-01-14T12:00:00.000Z',
        },
      ],
    });
    const occs = projectEvent(task, { start: '2026-01-01', end: '2026-12-31' }, '2026-07-31');
    expect(occs.map((o) => [o.date, o.completed, o.overdue])).toEqual([
      ['2026-01-15', true, false],
      ['2026-04-15', false, true], // missed
      ['2026-07-15', false, true], // missed
      ['2026-10-15', false, false], // future
    ]);
    expect(occs[0].completedOn).toBe('2026-01-14');
  });

  test('only the latest missed occurrence surfaces from before the window', () => {
    const task = makeEvent({
      date: '2026-04-15',
      recurrence: { interval: 1, unit: 'month', anchor: 'fixed' },
    });
    // Apr/May/Jun/Jul 15 are all pending and before the window — only Jul 15
    // (the latest miss) should surface, alongside the in-window Aug 15.
    const occs = projectEvent(task, { start: '2026-07-31', end: '2026-08-31' }, '2026-07-31');
    expect(occs.map((o) => [o.date, o.overdue])).toEqual([
      ['2026-07-15', true],
      ['2026-08-15', false],
    ]);
  });

  test('overdue tail is suppressed for future-only windows', () => {
    const task = makeEvent({
      date: '2026-04-15',
      recurrence: { interval: 1, unit: 'month', anchor: 'fixed' },
    });
    // Viewing October: no overdue tail (window.start > today), just October's.
    const occs = projectEvent(task, { start: '2026-10-01', end: '2026-10-31' }, '2026-07-31');
    expect(occs.map((o) => o.date)).toEqual(['2026-10-15']);
  });

  test('recurring "event" kind projects but is never completable or overdue', () => {
    const anniversary = makeEvent({
      kind: 'event',
      title: 'Lease renewal window opens',
      date: '2025-09-01',
      recurrence: { interval: 1, unit: 'year', anchor: 'fixed' },
    });
    const occs = projectEvent(
      anniversary,
      { start: '2026-01-01', end: '2026-12-31' },
      '2026-10-01'
    );
    expect(occs.map((o) => [o.date, o.completable, o.overdue])).toEqual([
      ['2026-09-01', false, false],
    ]);
  });
});

describe('projectEvent — afterCompletion', () => {
  const recurrence = { interval: 3, unit: 'month', anchor: 'afterCompletion' } as const;

  test('never completed: pending at the anchor date', () => {
    const task = makeEvent({ title: 'Coop deep clean', date: '2026-08-10', recurrence });
    const occs = projectEvent(task, { start: '2026-07-31', end: '2026-09-30' }, '2026-07-31');
    expect(occs.map((o) => [o.date, o.completed, o.overdue])).toEqual([
      ['2026-08-10', false, false],
    ]);
  });

  test('next due counts from the actual completion date, not the schedule', () => {
    const task = makeEvent({
      title: 'Coop deep clean',
      date: '2026-05-01',
      recurrence,
      completions: [
        {
          occurrenceDate: '2026-05-01',
          completedOn: '2026-07-20', // done 11 weeks late
          completedAt: '2026-07-20T15:00:00.000Z',
        },
      ],
    });
    // Narrow window: the single pending occurrence is 3 months after the
    // late completion, not 3 months after the scheduled date.
    const occs = projectEvent(task, { start: '2026-07-01', end: '2026-12-31' }, '2026-07-31');
    expect(occs.map((o) => [o.date, o.completed])).toEqual([['2026-10-20', false]]);
    // Widened window: the historical completion projects on its occurrence date.
    const withHistory = projectEvent(
      task,
      { start: '2026-04-01', end: '2026-12-31' },
      '2026-07-31'
    );
    expect(withHistory.map((o) => [o.date, o.completed])).toEqual([
      ['2026-05-01', true],
      ['2026-10-20', false],
    ]);
  });

  test('single pending occurrence even when long overdue, surfaced across windows', () => {
    const task = makeEvent({ title: 'Replace well filter', date: '2026-01-05', recurrence });
    const occs = projectEvent(task, { start: '2026-07-31', end: '2026-09-30' }, '2026-07-31');
    expect(occs.map((o) => [o.date, o.overdue])).toEqual([['2026-01-05', true]]);
  });

  test('skipped completions advance the schedule too', () => {
    const task = makeEvent({
      title: 'Coop deep clean',
      date: '2026-05-01',
      recurrence,
      completions: [
        {
          occurrenceDate: '2026-05-01',
          completedOn: '2026-05-03',
          completedAt: '2026-05-03T10:00:00.000Z',
          skipped: true,
        },
      ],
    });
    const occs = projectEvent(task, { start: '2026-05-01', end: '2026-12-31' }, '2026-05-04');
    expect(occs.map((o) => [o.date, o.completed, o.skipped ?? false])).toEqual([
      ['2026-05-01', true, true],
      ['2026-08-03', false, false],
    ]);
  });
});

describe('projectEvent — one-offs and archiving', () => {
  test('window boundaries are inclusive', () => {
    const task = makeEvent({ date: '2026-08-01' });
    const window = { start: '2026-08-01', end: '2026-08-01' };
    expect(projectEvent(task, window, '2026-07-01')).toHaveLength(1);
    // Not yet due (today before the date): excluded from a window that
    // starts after it, because it isn't overdue.
    expect(projectEvent(task, { start: '2026-08-02', end: '2026-08-31' }, '2026-07-01')).toEqual(
      []
    );
  });

  test('pending overdue one-off surfaces before the window; resolved ones do not', () => {
    const pending = makeEvent({ date: '2026-06-01' });
    const done = makeEvent({
      date: '2026-06-01',
      completions: [
        {
          occurrenceDate: '2026-06-01',
          completedOn: '2026-06-01',
          completedAt: '2026-06-01T09:00:00.000Z',
        },
      ],
    });
    const window = { start: '2026-07-31', end: '2026-09-30' };
    expect(projectEvent(pending, window, '2026-07-31').map((o) => [o.date, o.overdue])).toEqual([
      ['2026-06-01', true],
    ]);
    expect(projectEvent(done, window, '2026-07-31')).toEqual([]);
  });

  test('one-off "event" kind never surfaces as overdue', () => {
    const party = makeEvent({ kind: 'event', title: 'Farm open house', date: '2026-06-01' });
    expect(projectEvent(party, { start: '2026-07-01', end: '2026-07-31' }, '2026-07-31')).toEqual(
      []
    );
  });

  test('archived events project nothing', () => {
    const archived = makeEvent({
      status: 'archived',
      date: '2026-08-05',
      recurrence: { interval: 1, unit: 'month', anchor: 'fixed' },
    });
    expect(
      projectEvent(archived, { start: '2026-01-01', end: '2026-12-31' }, '2026-07-31')
    ).toEqual([]);
  });
});

describe('multi-day spans', () => {
  test('every occurrence carries the anchor span, clamped month math included', () => {
    const trip = makeEvent({
      kind: 'event',
      title: 'Onsite week',
      date: '2026-01-29',
      endDate: '2026-02-02',
      recurrence: { interval: 1, unit: 'month', anchor: 'fixed' },
    });
    const occs = projectEvent(trip, { start: '2026-01-01', end: '2026-04-30' }, '2026-01-01');
    expect(occs.map((o) => [o.date, o.endDate])).toEqual([
      ['2026-01-29', '2026-02-02'],
      ['2026-02-28', '2026-03-04'], // Feb clamps the anchor day, the span follows it
      ['2026-03-29', '2026-04-02'],
      ['2026-04-29', '2026-05-03'],
    ]);
  });

  test('a span that started before the window still projects', () => {
    const trip = makeEvent({
      kind: 'event',
      title: 'Trip to Denver',
      date: '2026-07-28',
      endDate: '2026-08-04',
      recurrence: null,
    });
    // Window opens mid-trip: the occurrence belongs to it, at its real start.
    const occs = projectEvent(trip, { start: '2026-08-01', end: '2026-08-31' }, '2026-08-01');
    expect(occs.map((o) => o.date)).toEqual(['2026-07-28']);
    // Once the last day is behind the window it drops out again.
    expect(projectEvent(trip, { start: '2026-08-05', end: '2026-08-31' }, '2026-08-05')).toEqual(
      []
    );
  });

  test('a task is overdue only once its LAST day has passed', () => {
    const chore = makeEvent({
      title: 'Deep clean the garage',
      date: '2026-07-28',
      endDate: '2026-08-04',
    });
    const during = projectEvent(chore, { start: '2026-07-01', end: '2026-08-31' }, '2026-08-01');
    expect(during[0].overdue).toBe(false);
    const after = projectEvent(chore, { start: '2026-07-01', end: '2026-08-31' }, '2026-08-05');
    expect(after[0].overdue).toBe(true);
  });

  test('birthdays never span, even with a stray endDate', () => {
    const bday = makeEvent({
      kind: 'birthday',
      title: 'Birthday — Alex',
      date: '1990-03-10',
      endDate: '1990-03-14',
    });
    const occs = projectEvent(bday, { start: '2026-01-01', end: '2026-12-31' }, '2026-01-01');
    expect(occs).toHaveLength(1);
    expect(occs[0].endDate).toBeUndefined();
  });

  test('a single-day event carries no endDate', () => {
    const one = makeEvent({ kind: 'event', date: '2026-08-03' });
    const occs = projectEvent(one, { start: '2026-08-01', end: '2026-08-31' }, '2026-08-01');
    expect(occs[0].endDate).toBeUndefined();
  });

  test('afterCompletion tasks span from each new due date', () => {
    const chore = makeEvent({
      title: 'Repaint the deck',
      date: '2026-01-05',
      endDate: '2026-01-07',
      recurrence: { interval: 6, unit: 'month', anchor: 'afterCompletion' },
      completions: [
        {
          occurrenceDate: '2026-01-05',
          completedOn: '2026-01-10',
          completedAt: '2026-01-10T09:00:00.000Z',
        },
      ],
    });
    const occs = projectEvent(chore, { start: '2026-01-01', end: '2026-12-31' }, '2026-02-01');
    expect(occs.map((o) => [o.date, o.endDate])).toEqual([
      ['2026-01-05', '2026-01-07'],
      ['2026-07-10', '2026-07-12'],
    ]);
  });
});

describe('projectOccurrences', () => {
  test('merges events sorted by date then title', () => {
    const events = [
      makeEvent({ title: 'Zebra task', date: '2026-08-05' }),
      makeEvent({ title: 'Apple task', date: '2026-08-05' }),
      makeEvent({ kind: 'birthday', title: 'Birthday — Alex', date: '1990-08-02' }),
    ];
    const occs = projectOccurrences(
      events,
      { start: '2026-08-01', end: '2026-08-31' },
      '2026-08-01'
    );
    expect(occs.map((o) => o.title)).toEqual(['Birthday — Alex', 'Apple task', 'Zebra task']);
  });

  test('on a shared start date the longest span sorts first', () => {
    const events = [
      makeEvent({ title: 'Apple task', date: '2026-08-05' }),
      makeEvent({ kind: 'event', title: 'Short trip', date: '2026-08-05', endDate: '2026-08-07' }),
      makeEvent({ kind: 'event', title: 'Long trip', date: '2026-08-05', endDate: '2026-08-12' }),
    ];
    const occs = projectOccurrences(
      events,
      { start: '2026-08-01', end: '2026-08-31' },
      '2026-08-01'
    );
    // Bands first, longest outermost, so a run keeps the same row across the
    // cells it crosses; single-day chips settle underneath.
    expect(occs.map((o) => o.title)).toEqual(['Long trip', 'Short trip', 'Apple task']);
  });
});

describe('nextOccurrence', () => {
  test('returns the overdue pending occurrence for afterCompletion tasks', () => {
    const task = makeEvent({
      title: 'Replace well filter',
      date: '2026-01-05',
      recurrence: { interval: 3, unit: 'month', anchor: 'afterCompletion' },
    });
    expect(nextOccurrence(task, '2026-07-31')?.date).toBe('2026-01-05');
  });

  test('returns the next birthday', () => {
    const bday = makeEvent({ kind: 'birthday', title: 'Birthday — Sam', date: '1990-03-10' });
    expect(nextOccurrence(bday, '2026-07-31')?.date).toBe('2027-03-10');
  });

  test('null for a resolved one-off', () => {
    const done = makeEvent({
      date: '2026-06-01',
      completions: [
        {
          occurrenceDate: '2026-06-01',
          completedOn: '2026-06-01',
          completedAt: '2026-06-01T09:00:00.000Z',
        },
      ],
    });
    expect(nextOccurrence(done, '2026-07-31')).toBeNull();
  });
});
