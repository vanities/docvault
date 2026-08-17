import { describe, expect, test } from 'vite-plus/test';
import {
  applySourceCitations,
  buildCalendarDigest,
  buildOvernightMetricBits,
  buildResearchDigestItems,
  selectDailyNewsStepCount,
  snapshotFromAllResponseBody,
} from './daily-news.js';
import type { Occurrence } from './calendar-recurrence.js';

function afterSince(d?: string | null): boolean {
  if (!d) return false;
  const iso = d.length === 10 ? `${d}T23:59:59` : d;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= new Date('2026-06-01T00:00:00.000Z').getTime();
}

describe('daily-news digest helpers', () => {
  test('daily health steps use the last complete day before the edition date', () => {
    const steps = selectDailyNewsStepCount(
      [
        { date: '2026-06-07', steps: 8200 },
        { date: '2026-06-08', steps: 10500 },
        { date: '2026-06-09', steps: 450 },
      ],
      { useAverage: false, editionDate: '2026-06-09' }
    );

    expect(steps).toBe(10500);
  });

  test('weekly health steps keep using the 7-day average path', () => {
    const steps = selectDailyNewsStepCount(
      [
        { date: '2026-06-07', steps: 8200 },
        { date: '2026-06-08', steps: 10500 },
        { date: '2026-06-09', steps: 450, steps7dAvg: 9300 },
      ],
      { useAverage: true, editionDate: '2026-06-09' }
    );

    expect(steps).toBe(9300);
  });

  test('includes every in-window research entry instead of dropping after a fixed cap', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: `entry-${i + 1}`,
      domain: i % 2 === 0 ? 'finance' : 'politics',
      title: `Research report ${i + 1}`,
      publisher: i % 2 === 0 ? 'Desk A' : 'Desk B',
      uploadedAt: `2026-06-${String((i % 8) + 1).padStart(2, '0')}T12:00:00.000Z`,
      text: `Full text for report ${i + 1}. `.repeat(80),
    }));

    const items = buildResearchDigestItems(entries as never[], afterSince, { maxChars: 12_000 });

    expect(items).toHaveLength(25);
    expect(items[0]).toContain('Research report 1');
    expect(items[24]).toContain('Research report 25');
  });

  test('filters old or empty research entries while preserving all eligible entries', () => {
    const entries = [
      {
        id: 'old',
        domain: 'finance',
        title: 'Old report',
        uploadedAt: '2026-05-30T12:00:00.000Z',
        text: 'old text',
      },
      {
        id: 'blank',
        domain: 'finance',
        title: 'Blank report',
        uploadedAt: '2026-06-02T12:00:00.000Z',
        text: '   ',
      },
      {
        id: 'new-1',
        domain: 'finance',
        title: 'New report 1',
        uploadedAt: '2026-06-02T12:00:00.000Z',
        text: 'new text 1',
      },
      {
        id: 'new-2',
        domain: 'politics',
        title: 'New report 2',
        reportDate: '2026-06-03',
        uploadedAt: '2026-05-20T12:00:00.000Z',
        text: 'new text 2',
      },
    ];

    const items = buildResearchDigestItems(entries as never[], afterSince, { maxChars: 4_000 });

    expect(items).toHaveLength(2);
    expect(items.join('\n')).toContain('New report 1');
    expect(items.join('\n')).toContain('New report 2');
    expect(items.join('\n')).not.toContain('Old report');
    expect(items.join('\n')).not.toContain('Blank report');
  });
});

describe('buildOvernightMetricBits', () => {
  // Values mirror the real 2026-08-10 incident: the paper printed the
  // 2026-08-09 night (6.9h) as "last night" because the phone hadn't synced
  // the current day yet, and the only staleness check keyed off activity.
  const heartFresh = { date: '2026-08-10', restingHR: 58, hrv: 43 };
  const sleepAug9 = { date: '2026-08-09', asleepMinutes: 412, deepMinutes: 54, remMinutes: 82 };

  test('same-day sleep reads as last night, stages included, no provenance label', () => {
    const bits = buildOvernightMetricBits(
      {
        heart: { daily: [heartFresh] },
        sleep: { daily: [{ ...sleepAug9, date: '2026-08-10' }] },
      },
      { useAvg: false, afterSince, editionDate: '2026-08-10' }
    );

    expect(bits).toContain('resting HR 58');
    expect(bits).toContain('HRV 43');
    expect(bits).toContain('6.9h sleep (0.9h deep, 1.4h REM)');
    expect(bits.join(' ')).not.toContain('from 2026');
  });

  test('REGRESSION: a day-old night is labelled, never passed off as last night', () => {
    // The since-window check alone passes a one-day-old night (day keys count
    // as end-of-day), which is exactly how the 2026-08-10 edition printed the
    // 08-09 night unlabelled. Only date === editionDate counts as last night.
    const bits = buildOvernightMetricBits(
      { heart: { daily: [heartFresh] }, sleep: { daily: [sleepAug9] } },
      { useAvg: false, afterSince: () => true, editionDate: '2026-08-10' }
    );

    expect(bits).toContain('6.9h sleep (0.9h deep, 1.4h REM) — from 2026-08-09, not last night');
  });

  test('stale heart metrics carry their own date independently of sleep', () => {
    const bits = buildOvernightMetricBits(
      {
        heart: { daily: [{ date: '2026-08-08', restingHR: 61, hrv: 39 }] },
        sleep: { daily: [{ ...sleepAug9, date: '2026-08-10' }] },
      },
      {
        useAvg: false,
        afterSince: (d) => (d ?? '') >= '2026-08-10',
        editionDate: '2026-08-10',
      }
    );

    expect(bits).toContain('resting HR 61 (from 2026-08-08)');
    expect(bits).toContain('HRV 39 (from 2026-08-08)');
    // Sleep is current — it must not inherit the heart staleness.
    expect(bits).toContain('6.9h sleep (0.9h deep, 1.4h REM)');
  });

  test('without an edition date, sleep falls back to the since-window check', () => {
    const stale = buildOvernightMetricBits(
      { sleep: { daily: [sleepAug9] } },
      { useAvg: false, afterSince: () => false }
    );
    expect(stale).toContain('6.9h sleep (0.9h deep, 1.4h REM) — from 2026-08-09, not last night');

    const fresh = buildOvernightMetricBits(
      { sleep: { daily: [sleepAug9] } },
      { useAvg: false, afterSince: () => true }
    );
    expect(fresh).toContain('6.9h sleep (0.9h deep, 1.4h REM)');
  });

  test('weekly averages keep the /night phrasing and skip provenance labels', () => {
    const bits = buildOvernightMetricBits(
      {
        heart: {
          daily: [
            { date: '2026-08-09', restingHR: 60, hrv: 40 },
            { date: '2026-08-10', restingHR: 56, hrv: 46 },
          ],
        },
        sleep: {
          daily: [
            { date: '2026-08-09', asleepMinutes: 400 },
            { date: '2026-08-10', asleepMinutes: 440 },
          ],
        },
      },
      { useAvg: true, afterSince: () => false, editionDate: '2026-08-10' }
    );

    expect(bits).toContain('resting HR 58');
    expect(bits).toContain('HRV 43');
    expect(bits).toContain('7.0h sleep/night');
    expect(bits.join(' ')).not.toContain('from 2026');
  });

  test('missing series produce no bits', () => {
    expect(buildOvernightMetricBits({}, { useAvg: false, afterSince })).toEqual([]);
  });
});

describe('snapshotFromAllResponseBody', () => {
  // Regression: freshPersonSnapshot reads the `/snapshot/all` body, which nests
  // metrics under `snapshot`. It previously read `data` (the single-segment
  // key), so it returned undefined every call — the auto-heal recompute never
  // reached the digest and a freshly-synced person (whose raw-store snapshot
  // wasn't recomputed yet) was silently dropped from the edition.
  const snap = {
    activity: { daily: [{ date: '2026-06-15', steps: 7659 }] },
    sleep: { daily: [{ asleepMinutes: 350, deepMinutes: 41 }] },
  };

  test('reads the `snapshot` key from the all-endpoint shape', () => {
    const body = { snapshot: snap, illnessNotes: {}, stale: false, currentParserVersion: 7 };
    expect(snapshotFromAllResponseBody(body)).toBe(snap);
  });

  test('a single-segment `data` body yields undefined (the original bug)', () => {
    expect(snapshotFromAllResponseBody({ data: snap })).toBeUndefined();
  });

  test('missing, empty, or null-snapshot bodies yield undefined', () => {
    expect(snapshotFromAllResponseBody(undefined)).toBeUndefined();
    expect(snapshotFromAllResponseBody(null)).toBeUndefined();
    expect(snapshotFromAllResponseBody({})).toBeUndefined();
    expect(snapshotFromAllResponseBody({ snapshot: null })).toBeUndefined();
  });
});

describe('applySourceCitations', () => {
  const CITES = [
    { ref: 'S1', url: 'https://example.com/oil-shorts' },
    { ref: 'S2', url: 'https://example.com/el-nino' },
  ];

  test('tagged phrases become inline markdown links', () => {
    const body = 'Paper bets the crisis ends: [Brent shorts have tripled][S1] since March.';
    expect(applySourceCitations(body, CITES)).toBe(
      'Paper bets the crisis ends: [Brent shorts have tripled](https://example.com/oil-shorts) since March.'
    );
  });

  test('bare tags become numbered links, renumbered in reading order', () => {
    const body = 'El Nino was declared [S2]. Shorts tripled [S1]. El Nino again [S2].';
    expect(applySourceCitations(body, CITES)).toBe(
      'El Nino was declared [[1]](https://example.com/el-nino). ' +
        'Shorts tripled [[2]](https://example.com/oil-shorts). ' +
        'El Nino again [[1]](https://example.com/el-nino).'
    );
  });

  test('unknown tags are stripped, not leaked to readers', () => {
    const body = 'A claim [with text][S9] and a bare mistake [S7].';
    expect(applySourceCitations(body, CITES)).toBe('A claim with text and a bare mistake.');
  });

  test('no citations strips any stray tags entirely', () => {
    expect(applySourceCitations('Clean prose [S3] here.', [])).toBe('Clean prose here.');
  });

  test('regular markdown links pass through untouched', () => {
    const body = 'See [the appendix](https://example.com/notes) below.';
    expect(applySourceCitations(body, CITES)).toBe(body);
  });
});

describe('buildCalendarDigest', () => {
  const TODAY = '2026-07-31';
  function occ(overrides: Partial<Occurrence>): Occurrence {
    return {
      eventId: 'evt-1',
      kind: 'task',
      title: 'Replace air filter',
      date: '2026-08-03',
      completable: true,
      completed: false,
      overdue: false,
      recurrenceLabel: 'every 3 months',
      ...overrides,
    };
  }

  test('formats due/birthday/event lines with recurrence and overdue detail', () => {
    const { items } = buildCalendarDigest(
      [
        occ({}),
        occ({ title: 'Late chore', date: '2026-07-27', overdue: true }),
        occ({
          kind: 'birthday',
          title: 'Alex',
          date: '2026-08-02',
          age: 34,
          completable: false,
          recurrenceLabel: 'yearly',
        }),
        occ({
          kind: 'event',
          title: 'Farm open house',
          date: '2026-08-22',
          completable: false,
          recurrenceLabel: 'one-off',
        }),
      ],
      TODAY,
      true
    );
    expect(items).toEqual([
      'Due 2026-08-03: Replace air filter (every 3 months).',
      'Due 2026-07-27: Late chore (every 3 months; overdue 4 days).',
      'Birthday 2026-08-02: Alex turns 34.',
      'Event 2026-08-22: Farm open house.',
    ]);
  });

  test('weekAhead box covers 7 days plus overdue, drops completed, caps at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      occ({ eventId: `evt-${i}`, title: `Chore ${i}`, date: '2026-08-01' })
    );
    const { weekAhead } = buildCalendarDigest(
      [
        occ({ title: 'Done already', completed: true }),
        occ({ title: 'Overdue task', date: '2026-07-20', overdue: true }),
        occ({ title: 'Beyond the week', date: '2026-08-20' }),
        ...many,
      ],
      TODAY,
      true
    );
    expect(weekAhead.start).toBe(TODAY);
    expect(weekAhead.end).toBe('2026-08-07');
    expect(weekAhead.items.length).toBe(20);
    expect(weekAhead.items.some((i) => i.title === 'Done already')).toBe(false);
    expect(weekAhead.items.some((i) => i.title === 'Beyond the week')).toBe(false);
    expect(weekAhead.items.find((i) => i.title === 'Overdue task')?.overdue).toBe(true);
  });

  test('birthday rows carry age for the rendered box', () => {
    const { weekAhead } = buildCalendarDigest(
      [
        occ({
          kind: 'birthday',
          title: 'Sam',
          date: '2026-08-01',
          age: 12,
          completable: false,
          recurrenceLabel: 'yearly',
        }),
      ],
      TODAY,
      true
    );
    expect(weekAhead.items).toEqual([
      { date: '2026-08-01', title: 'Sam', kind: 'birthday', age: 12 },
    ]);
  });

  // The edition is a SECOND consumer of settings.calendar.showOverdue next to
  // CalendarView; before this it re-derived overdue from projectOccurrences and
  // never asked, so past-due tasks kept nagging from a "Week Ahead" box.
  test('showOverdue=false drops the past-due tail from BOTH desk lines and the box', () => {
    const { items, weekAhead } = buildCalendarDigest(
      [
        occ({ title: 'Late chore', date: '2026-07-27', overdue: true }),
        occ({ title: 'Missed dentist', date: '2026-07-20', overdue: true }),
        occ({ title: 'Upcoming chore', date: '2026-08-03' }),
      ],
      TODAY,
      false
    );
    expect(items).toEqual(['Due 2026-08-03: Upcoming chore (every 3 months).']);
    expect(weekAhead.items.map((i) => i.title)).toEqual(['Upcoming chore']);
  });

  // Regression guard for the real shape of the bug: the box filter is
  // `date <= weekEnd || overdue` with NO lower bound, so merely clearing the
  // flag would leave a 7/20 row sitting inside a window that starts 7/31.
  test('showOverdue=false removes the row entirely, not just the overdue chip', () => {
    const { weekAhead } = buildCalendarDigest(
      [occ({ title: 'Late chore', date: '2026-07-27', overdue: true })],
      TODAY,
      false
    );
    expect(weekAhead.items).toEqual([]);
  });

  test('showOverdue=false leaves past non-completable rows alone', () => {
    // Birthdays/events are never flagged overdue, so the toggle must not eat
    // them even when they predate the window.
    const { weekAhead } = buildCalendarDigest(
      [
        occ({
          kind: 'birthday',
          title: 'Sam',
          date: '2026-07-29',
          age: 12,
          completable: false,
          overdue: false,
          recurrenceLabel: 'yearly',
        }),
      ],
      TODAY,
      false
    );
    expect(weekAhead.items.map((i) => i.title)).toEqual(['Sam']);
  });
});
