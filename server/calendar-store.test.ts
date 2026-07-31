// Calendar store tests: load/save roundtrip, malformed-file recovery, and
// the one-time migration of the legacy reminders file. All fixture data is
// fabricated. Uses a temp DATA_DIR so file I/O can never touch real data.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';
import path from 'path';

// Point DATA_DIR at a throwaway directory BEFORE any handler code runs. ES
// module imports are hoisted above top-level statements, so assigning
// process.env after the imports is too late — data.ts reads DOCVAULT_DATA_DIR
// at module-load time. vi.hoisted runs before the import graph resolves.
const tmpDataDir = vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const dir = p.join(o.tmpdir(), `docvault-calendar-test-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

// eslint-disable-next-line import/first
import type { Reminder } from './data.js';
// eslint-disable-next-line import/first
import {
  CALENDAR_PATH,
  REMINDERS_BACKUP_PATH,
  isCalendarStore,
  loadCalendarStore,
  migrateReminders,
  saveCalendarStore,
  type CalendarEvent,
  type CalendarStore,
} from './calendar-store.js';

const LEGACY_PATH = path.join(tmpDataDir, '.docvault-reminders.json');

function makeReminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: `rem-${Math.random().toString(36).slice(2, 10)}`,
    entityId: 'acme-llc',
    title: 'File widget report',
    dueDate: '2026-08-15',
    recurrence: null,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 10)}`,
    kind: 'task',
    title: 'Replace air filter',
    date: '2026-08-15',
    recurrence: null,
    status: 'active',
    completions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  await fs.mkdir(tmpDataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
});

describe('load/save', () => {
  test('missing file loads as empty store', async () => {
    const store = await loadCalendarStore();
    expect(store).toEqual({ version: 1, events: [] });
  });

  test('roundtrip preserves events; save is atomic (no .tmp left behind)', async () => {
    const store: CalendarStore = {
      version: 1,
      events: [makeEvent({ title: 'Clean gutters' })],
    };
    await saveCalendarStore(store);
    expect(await loadCalendarStore()).toEqual(store);
    await expect(fs.access(`${CALENDAR_PATH}.tmp`)).rejects.toThrow();
  });

  test('malformed JSON loads as empty store', async () => {
    await fs.writeFile(CALENDAR_PATH, 'not json{{');
    expect(await loadCalendarStore()).toEqual({ version: 1, events: [] });
  });

  test('well-formed JSON with wrong shape loads as empty store', async () => {
    await fs.writeFile(CALENDAR_PATH, JSON.stringify({ version: 2, events: 'nope' }));
    expect(await loadCalendarStore()).toEqual({ version: 1, events: [] });
  });

  test('isCalendarStore rejects events missing required fields', () => {
    expect(isCalendarStore({ version: 1, events: [{ id: 'x' }] })).toBe(false);
    expect(isCalendarStore({ version: 1, events: [makeEvent({})] })).toBe(true);
  });
});

describe('migrateReminders (pure mapping)', () => {
  const NOW = '2026-07-31T12:00:00.000Z';

  test('pending one-off becomes an active task with provenance', () => {
    const rem = makeReminder({ id: 'rem-1', notes: 'bring checkbook' });
    const [event] = migrateReminders([rem], NOW);
    expect(event.kind).toBe('task');
    expect(event.status).toBe('active');
    expect(event.date).toBe('2026-08-15');
    expect(event.recurrence).toBeNull();
    expect(event.entityId).toBe('acme-llc');
    expect(event.notes).toBe('bring checkbook');
    expect(event.completions).toEqual([]);
    expect(event.migratedFromReminderId).toBe('rem-1');
  });

  test('two pending one-offs with the same title stay separate events', () => {
    const events = migrateReminders(
      [
        makeReminder({ title: 'Pay invoice', dueDate: '2026-08-01' }),
        makeReminder({ title: 'Pay invoice', dueDate: '2026-09-01' }),
      ],
      NOW
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.date).sort()).toEqual(['2026-08-01', '2026-09-01']);
  });

  test('resolved one-offs become archived with one completion (skipped when dismissed)', () => {
    const events = migrateReminders(
      [
        makeReminder({ status: 'completed', updatedAt: '2026-05-05T09:00:00.000Z' }),
        makeReminder({ title: 'Renew license', status: 'dismissed' }),
      ],
      NOW
    );
    expect(events).toHaveLength(2);
    const done = events.find((e) => e.title === 'File widget report')!;
    expect(done.status).toBe('archived');
    expect(done.completions).toEqual([
      {
        occurrenceDate: '2026-08-15',
        completedOn: '2026-05-05',
        completedAt: '2026-05-05T09:00:00.000Z',
      },
    ]);
    const dismissed = events.find((e) => e.title === 'Renew license')!;
    expect(dismissed.status).toBe('archived');
    expect(dismissed.completions[0].skipped).toBe(true);
  });

  test('quarterly series folds duplicated rows into one event with history', () => {
    // The legacy store's shape after completing two quarters and dismissing
    // one: three resolved rows plus the currently-pending row it pushed.
    const series = [
      makeReminder({
        title: 'Estimated Tax Payment',
        recurrence: 'quarterly',
        dueDate: '2026-01-15',
        status: 'completed',
        updatedAt: '2026-01-14T10:00:00.000Z',
      }),
      makeReminder({
        title: 'Estimated Tax Payment',
        recurrence: 'quarterly',
        dueDate: '2026-04-15',
        status: 'completed',
        updatedAt: '2026-04-12T10:00:00.000Z',
      }),
      makeReminder({
        title: 'Estimated Tax Payment',
        recurrence: 'quarterly',
        dueDate: '2026-07-15',
        status: 'dismissed',
        updatedAt: '2026-07-20T10:00:00.000Z',
      }),
      makeReminder({
        id: 'rem-pending',
        title: 'Estimated Tax Payment',
        recurrence: 'quarterly',
        dueDate: '2026-10-15',
        status: 'pending',
      }),
    ];
    const events = migrateReminders(series, NOW);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.status).toBe('active');
    expect(event.date).toBe('2026-10-15'); // anchored at the pending row
    expect(event.recurrence).toEqual({ interval: 3, unit: 'month', anchor: 'fixed' });
    expect(event.migratedFromReminderId).toBe('rem-pending');
    expect(event.completions.map((c) => [c.occurrenceDate, c.skipped ?? false])).toEqual([
      ['2026-01-15', false],
      ['2026-04-15', false],
      ['2026-07-15', true],
    ]);
  });

  test('completed-only recurring series becomes an archived event', () => {
    const events = migrateReminders(
      [
        makeReminder({
          title: 'Renew policy',
          recurrence: 'yearly',
          dueDate: '2025-06-01',
          status: 'completed',
        }),
        makeReminder({
          title: 'Renew policy',
          recurrence: 'yearly',
          dueDate: '2026-06-01',
          status: 'completed',
        }),
      ],
      NOW
    );
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('archived');
    expect(events[0].date).toBe('2026-06-01'); // latest row anchors the archive
    expect(events[0].completions).toHaveLength(2);
  });

  test('recurrence enum maps: yearly and monthly', () => {
    const events = migrateReminders(
      [
        makeReminder({ title: 'A', recurrence: 'yearly' }),
        makeReminder({ title: 'B', recurrence: 'monthly' }),
      ],
      NOW
    );
    expect(events.find((e) => e.title === 'A')!.recurrence).toEqual({
      interval: 1,
      unit: 'year',
      anchor: 'fixed',
    });
    expect(events.find((e) => e.title === 'B')!.recurrence).toEqual({
      interval: 1,
      unit: 'month',
      anchor: 'fixed',
    });
  });
});

describe('lazy migration on load', () => {
  test('migrates the legacy file, renames it, and never re-migrates', async () => {
    await fs.writeFile(
      LEGACY_PATH,
      JSON.stringify([makeReminder({ title: 'Change coop bedding' })])
    );

    const store = await loadCalendarStore();
    expect(store.events).toHaveLength(1);
    expect(store.events[0].title).toBe('Change coop bedding');

    // Original renamed to the backup path, calendar file created.
    await expect(fs.access(LEGACY_PATH)).rejects.toThrow();
    await expect(fs.access(REMINDERS_BACKUP_PATH)).resolves.toBeUndefined();
    await expect(fs.access(CALENDAR_PATH)).resolves.toBeUndefined();

    // A reminders file that appears AFTER migration is ignored: the calendar
    // store exists, so load never re-migrates.
    await fs.writeFile(LEGACY_PATH, JSON.stringify([makeReminder({ title: 'Stray row' })]));
    const again = await loadCalendarStore();
    expect(again.events.map((e) => e.title)).toEqual(['Change coop bedding']);
    await expect(fs.access(LEGACY_PATH)).resolves.toBeUndefined(); // left in place
  });

  test('malformed legacy file is left untouched and load still works', async () => {
    await fs.writeFile(LEGACY_PATH, 'not json[[');
    const store = await loadCalendarStore();
    expect(store).toEqual({ version: 1, events: [] });
    await expect(fs.access(LEGACY_PATH)).resolves.toBeUndefined(); // preserved for repair
    await expect(fs.access(REMINDERS_BACKUP_PATH)).rejects.toThrow();
  });
});
