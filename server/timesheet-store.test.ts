// Timesheet store tests: derivation helpers (midnight wrap, amount rounding),
// shape guards, and load/save roundtrip. All fixture data is fabricated.
// Uses a temp DATA_DIR so file I/O can never touch real data.

import { describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';

// Point DATA_DIR at a throwaway directory BEFORE any handler code runs. ES
// module imports are hoisted above top-level statements, so assigning
// process.env after the imports is too late — data.ts reads DOCVAULT_DATA_DIR
// at module-load time. vi.hoisted runs before the import graph resolves.
const tmpDataDir = vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const dir = p.join(o.tmpdir(), `docvault-timesheet-test-${Date.now()}`);
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
import {
  TIMESHEET_PATH,
  entryAmount,
  isTimesheetStore,
  isValidDate,
  isValidTime,
  loadTimesheetStore,
  saveTimesheetStore,
  spanMinutes,
  type TimesheetStore,
} from './timesheet-store.js';

function makeStore(): TimesheetStore {
  return {
    version: 1,
    clients: [{ id: 'acme', name: 'Acme Corp', currency: 'USD', archived: false }],
    projects: [
      { id: 'widgets', clientId: 'acme', name: 'Widgets', hourlyRate: 100, archived: false },
    ],
    entries: [
      {
        id: 'e1',
        projectId: 'widgets',
        date: '2026-01-05',
        start: '09:00',
        end: '11:30',
        durationMinutes: 150,
        description: 'built widgets',
        hourlyRate: 100,
        amount: 250,
        billable: true,
        invoiced: false,
      },
    ],
  };
}

describe('spanMinutes', () => {
  test('plain same-day span', () => {
    expect(spanMinutes('09:00', '11:30')).toBe(150);
  });

  test('wraps across midnight when end < start', () => {
    expect(spanMinutes('23:30', '01:00')).toBe(90);
  });

  test('zero-length span', () => {
    expect(spanMinutes('09:00', '09:00')).toBe(0);
  });
});

describe('entryAmount', () => {
  test('rounds to cents', () => {
    // 50 minutes at $125/h = 104.1666... -> 104.17
    expect(entryAmount(50, 125, true)).toBe(104.17);
  });

  test('non-billable entries are always zero', () => {
    expect(entryAmount(600, 125, false)).toBe(0);
  });
});

describe('validators', () => {
  test('accepts valid time and date', () => {
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidDate('2026-02-28')).toBe(true);
  });

  test('rejects malformed values', () => {
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:00')).toBe(false);
    expect(isValidDate('01-05-2026')).toBe(false);
  });
});

describe('shape guard', () => {
  test('accepts a well-formed store', () => {
    expect(isTimesheetStore(makeStore())).toBe(true);
  });

  test('rejects wrong version and missing arrays', () => {
    expect(isTimesheetStore({ ...makeStore(), version: 2 })).toBe(false);
    expect(isTimesheetStore({ version: 1, clients: [], projects: [] })).toBe(false);
  });

  test('rejects entries missing required fields', () => {
    const store = makeStore();
    delete (store.entries[0] as Partial<(typeof store.entries)[0]>).durationMinutes;
    expect(isTimesheetStore(store)).toBe(false);
  });
});

describe('load/save roundtrip', () => {
  test('missing file yields empty store', async () => {
    const store = await loadTimesheetStore();
    expect(store).toEqual({ version: 1, clients: [], projects: [], entries: [] });
  });

  test('saved store loads back identically', async () => {
    await fs.mkdir(tmpDataDir, { recursive: true });
    const store = makeStore();
    await saveTimesheetStore(store);
    expect(await loadTimesheetStore()).toEqual(store);
  });

  test('malformed file falls back to empty store', async () => {
    await fs.mkdir(tmpDataDir, { recursive: true });
    await fs.writeFile(TIMESHEET_PATH, '{"version":1,"clients":"nope"}');
    const store = await loadTimesheetStore();
    expect(store.entries).toEqual([]);
  });
});
