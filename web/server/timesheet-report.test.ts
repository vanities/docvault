// Weekly timesheet report — pure-logic tests: window math, the scheduled
// due-gate (weekday/hour/dedup, timezone-aware), keyword categorization,
// CSV escaping, and HTML totals. All fixture data is synthetic.

import { describe, expect, it } from 'vite-plus/test';
import {
  normalizeWeeklyReportConfig,
  weekWindow,
  weeklyReportDue,
  categorizeEntry,
  collectReportRows,
  categoryTotals,
  buildReportCsv,
  buildReportHtml,
  DEFAULT_WEEKLY_REPORT,
} from './timesheet-report.js';
import type { TimesheetStore, WeeklyReportConfig } from './timesheet-store.js';

const CFG: WeeklyReportConfig = {
  enabled: true,
  to: 'billing@example.com',
  day: 5, // Friday
  hour: 15,
  timezone: 'America/Chicago',
  cadence: 'weekly',
  windowDays: 7,
  clientIds: [],
  projectIds: [],
  categories: [
    { name: 'Platform', keywords: ['deploy', 'infra'] },
    { name: 'Meetings', keywords: ['standup', 'sync'] },
  ],
};

function makeStore(): TimesheetStore {
  return {
    version: 1,
    clients: [
      { id: 'c1', name: 'Globex Corporation', currency: 'USD', archived: false },
      { id: 'c2', name: 'Initech', currency: 'USD', archived: false },
    ],
    projects: [
      {
        id: 'p1',
        clientId: 'c1',
        name: 'Widgets',
        hourlyRate: 100,
        archived: false,
        subClients: [
          { id: 'sc1', name: 'Northwind Trading', archived: false },
          { id: 'sc2', name: 'Umbrella Health', archived: false },
        ],
      },
      { id: 'p2', clientId: 'c1', name: 'Gadgets', hourlyRate: 120, archived: false },
      { id: 'p3', clientId: 'c2', name: 'Other Client Work', hourlyRate: 90, archived: false },
    ],
    entries: [
      {
        id: 'e1',
        projectId: 'p1',
        date: '2026-07-28',
        start: '09:00',
        end: '11:00',
        durationMinutes: 120,
        description: 'Deploy pipeline hardening',
        hourlyRate: 100,
        amount: 200,
        billable: true,
        invoiced: false,
      },
      {
        id: 'e2',
        projectId: 'p2',
        date: '2026-07-29',
        start: '10:00',
        end: '10:30',
        durationMinutes: 30,
        description: 'Weekly standup, "notes"',
        hourlyRate: 120,
        amount: 60,
        billable: true,
        invoiced: false,
      },
      {
        id: 'e3',
        projectId: 'p1',
        date: '2026-07-30',
        start: '13:00',
        end: '14:00',
        durationMinutes: 60,
        description: 'Widget research spike',
        hourlyRate: 100,
        amount: 0,
        billable: false,
        invoiced: false,
      },
      {
        // Duration-first entry: no start/end, tagged with a sub-client. Its
        // description would match the "Platform" rule, but the tag must win.
        id: 'e6',
        projectId: 'p1',
        date: '2026-07-30',
        durationMinutes: 90,
        subClientId: 'sc1',
        description: 'Deploy work for the end client',
        hourlyRate: 100,
        amount: 150,
        billable: true,
        invoiced: false,
      },
      {
        // Another client's work, inside the window — must be excluded when the
        // report is scoped to c1, or a billing contact sees a rival's hours.
        id: 'e5',
        projectId: 'p3',
        date: '2026-07-29',
        start: '15:00',
        end: '16:00',
        durationMinutes: 60,
        description: 'Confidential other-client work',
        hourlyRate: 90,
        amount: 90,
        billable: true,
        invoiced: false,
      },
      {
        // Outside the window ending 2026-07-31 — must be excluded.
        id: 'e4',
        projectId: 'p1',
        date: '2026-07-24',
        start: '09:00',
        end: '10:00',
        durationMinutes: 60,
        description: 'Old work',
        hourlyRate: 100,
        amount: 100,
        billable: true,
        invoiced: false,
      },
    ],
    templates: [],
    invoices: [],
  };
}

describe('normalizeWeeklyReportConfig', () => {
  it('defaults malformed input and drops empty rules', () => {
    const cfg = normalizeWeeklyReportConfig({
      enabled: 'yes', // not === true
      to: 42,
      day: 99,
      hour: -3,
      categories: [{ name: '  ', keywords: ['x'] }, { name: 'Ok', keywords: ['a', '', 3] }, null],
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.to).toBe('');
    expect(cfg.day).toBe(6);
    expect(cfg.hour).toBe(0);
    expect(cfg.categories).toEqual([{ name: 'Ok', keywords: ['a'] }]);
  });

  it('passes a valid config through', () => {
    expect(normalizeWeeklyReportConfig(CFG)).toEqual(CFG);
    expect(normalizeWeeklyReportConfig(undefined)).toEqual(DEFAULT_WEEKLY_REPORT);
  });
});

describe('weekWindow', () => {
  it('spans 7 days inclusive, crossing month boundaries', () => {
    expect(weekWindow('2026-07-31')).toEqual({ start: '2026-07-25', end: '2026-07-31' });
    expect(weekWindow('2026-08-03')).toEqual({ start: '2026-07-28', end: '2026-08-03' });
    expect(weekWindow('2026-01-02')).toEqual({ start: '2025-12-27', end: '2026-01-02' });
  });
});

describe('weeklyReportDue', () => {
  // 2026-07-31 is a Friday. 20:00 UTC = 15:00 in America/Chicago (CDT).
  const fridayAtSend = new Date('2026-07-31T20:00:00Z');

  it('fires on the configured weekday at/after the hour', () => {
    expect(weeklyReportDue(fridayAtSend, CFG, 'UTC')).toBe('2026-07-31');
  });

  it('respects the hour gate and the weekday gate', () => {
    expect(weeklyReportDue(new Date('2026-07-31T18:00:00Z'), CFG, 'UTC')).toBeNull(); // 13:00 CDT
    expect(weeklyReportDue(new Date('2026-07-30T20:00:00Z'), CFG, 'UTC')).toBeNull(); // Thursday
  });

  it('dedups an already-sent week and respects enabled', () => {
    expect(weeklyReportDue(fridayAtSend, { ...CFG, lastSentWeek: '2026-07-31' }, 'UTC')).toBeNull();
    expect(weeklyReportDue(fridayAtSend, { ...CFG, enabled: false }, 'UTC')).toBeNull();
  });

  it('falls back to the passed timezone when config has none', () => {
    const { timezone: _tz, ...noTz } = CFG;
    // 15:00 UTC Friday: due in UTC, but only 10:00 in Chicago.
    const at = new Date('2026-07-31T15:00:00Z');
    expect(weeklyReportDue(at, noTz, 'UTC')).toBe('2026-07-31');
    expect(weeklyReportDue(at, noTz, 'America/Chicago')).toBeNull();
  });
});

describe('categorizeEntry', () => {
  it('applies first-match-wins rules, case-insensitively', () => {
    expect(categorizeEntry('Fixed the DEPLOY script', 'Widgets', CFG.categories)).toBe('Platform');
    expect(categorizeEntry('Team sync notes', 'Widgets', CFG.categories)).toBe('Meetings');
  });

  it('falls back to project name, then Uncategorized', () => {
    expect(categorizeEntry('Misc work', 'Widgets', CFG.categories)).toBe('Widgets');
    expect(categorizeEntry('Misc work', '', CFG.categories)).toBe('Uncategorized');
  });

  it('lets an explicit sub-client outrank a matching keyword rule', () => {
    // "deploy" matches the Platform rule, but the recorded tag is ground truth.
    expect(categorizeEntry('Deploy work', 'Widgets', CFG.categories, 'Northwind Trading')).toBe(
      'Northwind Trading'
    );
  });
});

describe('duration-first + sub-client entries', () => {
  const window = weekWindow('2026-07-31');

  it('includes entries that have no start/end and groups them by sub-client', () => {
    const rows = collectReportRows(makeStore(), { ...CFG, clientIds: ['c1'] }, window);
    const quick = rows.find((r) => r.minutes === 90);
    expect(quick).toBeDefined();
    expect(quick!.category).toBe('Northwind Trading');
    expect(quick!.subClient).toBe('Northwind Trading');
  });

  it('sorts untimed entries after timed ones on the same day', () => {
    const sameDay = collectReportRows(makeStore(), { ...CFG, clientIds: ['c1'] }, window).filter(
      (r) => r.date === '2026-07-30'
    );
    expect(sameDay.map((r) => r.minutes)).toEqual([60, 90]);
  });

  it('leaves subClient empty on untagged entries', () => {
    const rows = collectReportRows(makeStore(), { ...CFG, clientIds: ['c1'] }, window);
    expect(rows.find((r) => r.minutes === 120)!.subClient).toBe('');
  });
});

describe('cadence + window length', () => {
  const friday = new Date('2026-07-31T20:00:00Z'); // 15:00 America/Chicago

  it('weekly sends on consecutive send-days', () => {
    const cfg = { ...CFG, cadence: 'weekly' as const, lastSentWeek: '2026-07-24' };
    expect(weeklyReportDue(friday, cfg, 'UTC')).toBe('2026-07-31');
  });

  it('biweekly skips the intervening send-day but fires two weeks on', () => {
    const cfg = { ...CFG, cadence: 'biweekly' as const, lastSentWeek: '2026-07-24' };
    expect(weeklyReportDue(friday, cfg, 'UTC')).toBeNull();
    expect(weeklyReportDue(friday, { ...cfg, lastSentWeek: '2026-07-17' }, 'UTC')).toBe(
      '2026-07-31'
    );
  });

  it('monthly waits about four weeks', () => {
    const cfg = { ...CFG, cadence: 'monthly' as const, lastSentWeek: '2026-07-10' };
    expect(weeklyReportDue(friday, cfg, 'UTC')).toBeNull();
    expect(weeklyReportDue(friday, { ...cfg, lastSentWeek: '2026-07-03' }, 'UTC')).toBe(
      '2026-07-31'
    );
  });

  it('sends on the first run of any cadence (no watermark yet)', () => {
    for (const cadence of ['weekly', 'biweekly', 'monthly'] as const) {
      const { lastSentWeek: _w, ...cfg } = { ...CFG, cadence };
      expect(weeklyReportDue(friday, cfg, 'UTC')).toBe('2026-07-31');
    }
  });

  it('windowDays widens or narrows the reporting window', () => {
    expect(weekWindow('2026-07-31', 14)).toEqual({ start: '2026-07-18', end: '2026-07-31' });
    expect(weekWindow('2026-07-31', 1)).toEqual({ start: '2026-07-31', end: '2026-07-31' });
    expect(weekWindow('2026-07-31')).toEqual({ start: '2026-07-25', end: '2026-07-31' });
  });
});

describe('scope filtering', () => {
  const window = weekWindow('2026-07-31');

  it('excludes other clients when scoped to one client', () => {
    const rows = collectReportRows(makeStore(), { ...CFG, clientIds: ['c1'] }, window);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.client))).toEqual(new Set(['Globex Corporation']));
    expect(rows.some((r) => r.description.includes('other-client'))).toBe(false);
  });

  it('includes every client when the scope is empty', () => {
    const rows = collectReportRows(makeStore(), CFG, window);
    expect(new Set(rows.map((r) => r.client))).toEqual(new Set(['Globex Corporation', 'Initech']));
  });

  it('narrows to specific projects', () => {
    const rows = collectReportRows(
      makeStore(),
      { ...CFG, clientIds: ['c1'], projectIds: ['p2'] },
      window
    );
    expect(rows.map((r) => r.project)).toEqual(['Gadgets']);
  });

  it('drops entries whose project no longer exists', () => {
    const store = makeStore();
    store.projects = store.projects.filter((p) => p.id !== 'p1');
    const rows = collectReportRows(store, { ...CFG, clientIds: ['c1'] }, window);
    expect(rows.map((r) => r.project)).toEqual(['Gadgets']);
  });
});

describe('collectReportRows + categoryTotals', () => {
  it('filters to the window, resolves names, and totals per category', () => {
    const rows = collectReportRows(
      makeStore(),
      { ...CFG, clientIds: ['c1'] },
      weekWindow('2026-07-31')
    );
    expect(rows.map((r) => r.date)).toEqual([
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-30',
    ]);
    expect(rows[0]).toMatchObject({
      category: 'Platform',
      client: 'Globex Corporation',
      project: 'Widgets',
      minutes: 120,
    });
    const totals = categoryTotals(rows);
    expect(totals.map((t) => t.category)).toEqual([
      'Platform',
      'Northwind Trading',
      'Widgets',
      'Meetings',
    ]);
    expect(totals[0]).toMatchObject({ minutes: 120, amount: 200 });
  });
});

describe('buildReportCsv', () => {
  it('escapes quotes and commas and flags non-billable rows', () => {
    const rows = collectReportRows(
      makeStore(),
      { ...CFG, clientIds: ['c1'] },
      weekWindow('2026-07-31')
    );
    const csv = buildReportCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'Date,Category,Client,Project,Sub-client,Description,Hours,Rate,Amount,Billable'
    );
    expect(lines[2]).toContain('"Weekly standup, ""notes"""');
    expect(lines[3]).toContain(',no'); // the non-billable row
    // Date,Category,Client,Project,Sub-client,... — the tag drives the category
    expect(lines[4].split(',').slice(0, 5)).toEqual([
      '2026-07-30',
      'Northwind Trading',
      'Globex Corporation',
      'Widgets',
      'Northwind Trading',
    ]);
    expect(lines).toHaveLength(5);
  });
});

describe('buildReportHtml', () => {
  it('renders totals and category sections', () => {
    const window = weekWindow('2026-07-31');
    const html = buildReportHtml(
      collectReportRows(makeStore(), { ...CFG, clientIds: ['c1'] }, window),
      window
    );
    expect(html).toContain('2026-07-25 to 2026-07-31');
    expect(html).toContain('5.00 hours');
    expect(html).toContain('$410.00');
    expect(html).toContain('Platform — 2.00h');
    expect(html).toContain('Northwind Trading — 1.50h');
    expect(html).toContain('(non-billable)');
  });

  it('states when the week is empty', () => {
    const window = weekWindow('2026-07-31');
    expect(buildReportHtml([], window)).toContain('No time entries');
  });
});

describe('multi-line descriptions', () => {
  const window = weekWindow('2026-07-31');

  function storeWithLog(): TimesheetStore {
    const store = makeStore();
    store.entries = [
      {
        id: 'log',
        projectId: 'p1',
        date: '2026-07-28',
        durationMinutes: 60,
        description:
          'Completed:\n- ABC-1: Did a thing\n- ABC-2: Did another\n\n\nIn Review:\n- ABC-3: Pending',
        hourlyRate: 100,
        amount: 100,
        billable: true,
        invoiced: false,
      },
    ];
    return store;
  }

  it('keeps line structure instead of flattening the work log', () => {
    const rows = collectReportRows(storeWithLog(), CFG, window);
    expect(rows[0].description.split('\n')).toEqual([
      'Completed:',
      '- ABC-1: Did a thing',
      '- ABC-2: Did another',
      '',
      'In Review:',
      '- ABC-3: Pending',
    ]);
  });

  it('renders those breaks as <br> in the email body', () => {
    const rows = collectReportRows(storeWithLog(), CFG, window);
    const html = buildReportHtml(rows, window);
    expect(html).toContain('Completed:<br>- ABC-1: Did a thing<br>');
    expect(html).not.toContain('- ABC-1: Did a thing - ABC-2');
  });

  it('quotes the embedded newlines in CSV so the row stays intact', () => {
    const csv = buildReportCsv(collectReportRows(storeWithLog(), CFG, window));
    expect(csv.split('\n')[0]).toContain('Description');
    expect(csv).toContain('"Completed:\n- ABC-1: Did a thing');
  });
});
