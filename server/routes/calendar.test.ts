// Calendar route tests — drive handleCalendarRoutes with synthesized
// Requests exactly the way invokeRoute (chat tools) does. All fixtures are
// fabricated. Uses a temp DATA_DIR so file I/O can never touch real data.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';

// Point DATA_DIR at a throwaway directory BEFORE any handler code runs (see
// nutrition.test.ts — data.ts reads DOCVAULT_DATA_DIR at module-load time).
const tmpDataDir = vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const dir = p.join(o.tmpdir(), `docvault-calendar-routes-test-${Date.now()}`);
  process.env.DOCVAULT_DATA_DIR = dir;
  return dir;
});

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    timer: () => () => 0,
  }),
}));

// eslint-disable-next-line import/first
import { handleCalendarRoutes } from './calendar.js';
// eslint-disable-next-line import/first
import type { CalendarEvent } from '../calendar-store.js';
// eslint-disable-next-line import/first
import type { Occurrence } from '../calendar-recurrence.js';

async function call(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: any }> {
  const url = new URL(`http://internal${path}`);
  const req = new Request(url, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  });
  const res = await handleCalendarRoutes(req, url, url.pathname);
  if (!res) throw new Error(`No response for ${method} ${path}`);
  return { status: res.status, data: await res.json() };
}

beforeEach(async () => {
  await fs.mkdir(tmpDataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
});

describe('event CRUD', () => {
  test('create, list, update, delete round-trip', async () => {
    const created = await call('POST', '/api/calendar/events', {
      kind: 'task',
      title: '  Replace HVAC filter ',
      date: '2026-08-15',
      recurrence: { interval: 3, unit: 'month', anchor: 'fixed' },
      entityId: 'acme-llc',
      notes: 'MERV 13',
    });
    expect(created.status).toBe(200);
    const event: CalendarEvent = created.data.event;
    expect(event.title).toBe('Replace HVAC filter'); // trimmed
    expect(event.status).toBe('active');

    const list = await call('GET', '/api/calendar/events');
    expect(list.data.events).toHaveLength(1);

    const filtered = await call('GET', '/api/calendar/events?entity=other-llc');
    expect(filtered.data.events).toHaveLength(0);

    const updated = await call('PUT', `/api/calendar/events/${event.id}`, {
      title: 'Replace MERV-13 filter',
      entityId: null,
      status: 'archived',
    });
    expect(updated.status).toBe(200);
    expect(updated.data.event.title).toBe('Replace MERV-13 filter');
    expect(updated.data.event.entityId).toBeUndefined();
    expect(updated.data.event.status).toBe('archived');

    const deleted = await call('DELETE', `/api/calendar/events/${event.id}`);
    expect(deleted.status).toBe(200);
    expect((await call('GET', '/api/calendar/events')).data.events).toHaveLength(0);
  });

  test('validation 400s on create', async () => {
    const bad = async (body: unknown, msg: RegExp) => {
      const res = await call('POST', '/api/calendar/events', body);
      expect(res.status).toBe(400);
      expect(res.data.error).toMatch(msg);
    };
    await bad({ kind: 'meeting', title: 'X', date: '2026-01-01' }, /kind/);
    await bad({ kind: 'task', title: '   ', date: '2026-01-01' }, /title/);
    await bad({ kind: 'task', title: 'X', date: '2026-02-30' }, /date/);
    await bad(
      {
        kind: 'task',
        title: 'X',
        date: '2026-01-01',
        recurrence: { interval: 0, unit: 'month', anchor: 'fixed' },
      },
      /interval/
    );
    await bad(
      {
        kind: 'event',
        title: 'X',
        date: '2026-01-01',
        recurrence: { interval: 1, unit: 'month', anchor: 'afterCompletion' },
      },
      /only valid for tasks/
    );
    await bad(
      {
        kind: 'birthday',
        title: 'X',
        date: '2026-01-01',
        recurrence: { interval: 1, unit: 'year', anchor: 'fixed' },
      },
      /implicitly yearly/
    );
    await bad({ kind: 'task', title: 'X', date: '2026-01-01', birthYear: 1990 }, /birthYear/);
    await bad({ kind: 'birthday', title: 'X', date: '2026-01-01', birthYear: 1.5 }, /birthYear/);
  });

  test('update guards: unknown id 404, kind immutable', async () => {
    expect((await call('PUT', '/api/calendar/events/nope', { title: 'X' })).status).toBe(404);
    expect((await call('DELETE', '/api/calendar/events/nope')).status).toBe(404);

    const { data } = await call('POST', '/api/calendar/events', {
      kind: 'task',
      title: 'X',
      date: '2026-01-01',
    });
    const res = await call('PUT', `/api/calendar/events/${data.event.id}`, { kind: 'event' });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/kind cannot be changed/);
  });
});

describe('occurrences', () => {
  test('explicit window projects recurrence with entity filter', async () => {
    await call('POST', '/api/calendar/events', {
      kind: 'task',
      title: 'Coop bedding',
      date: '2026-01-10',
      recurrence: { interval: 6, unit: 'month', anchor: 'fixed' },
      entityId: 'farm',
    });
    await call('POST', '/api/calendar/events', {
      kind: 'birthday',
      title: 'Birthday — Alex',
      date: '1990-07-04',
      entityId: 'family',
    });

    const all = await call('GET', '/api/calendar/occurrences?start=2026-01-01&end=2026-12-31');
    expect(all.status).toBe(200);
    expect(all.data.occurrences.map((o: Occurrence) => o.date)).toEqual([
      '2026-01-10',
      '2026-07-04',
      '2026-07-10',
    ]);
    expect(all.data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const farmOnly = await call(
      'GET',
      '/api/calendar/occurrences?start=2026-01-01&end=2026-12-31&entity=farm'
    );
    expect(farmOnly.data.occurrences.every((o: Occurrence) => o.entityId === 'farm')).toBe(true);
  });

  test('default window is accepted and bad windows are rejected', async () => {
    expect((await call('GET', '/api/calendar/occurrences')).status).toBe(200);
    expect(
      (await call('GET', '/api/calendar/occurrences?start=2026-02-30&end=2026-03-01')).status
    ).toBe(400);
    expect(
      (await call('GET', '/api/calendar/occurrences?start=2026-03-01&end=2026-02-01')).status
    ).toBe(400);
    expect(
      (await call('GET', '/api/calendar/occurrences?start=2020-01-01&end=2026-01-01')).status
    ).toBe(400); // > 800 days
  });

  test('includeCompleted=false hides resolved occurrences', async () => {
    const { data } = await call('POST', '/api/calendar/events', {
      kind: 'task',
      title: 'One-off chore',
      date: '2026-05-01',
    });
    await call('POST', `/api/calendar/events/${data.event.id}/complete`, {
      occurrenceDate: '2026-05-01',
      completedOn: '2026-05-02',
    });
    const withDone = await call('GET', '/api/calendar/occurrences?start=2026-05-01&end=2026-05-31');
    expect(withDone.data.occurrences).toHaveLength(1);
    const withoutDone = await call(
      'GET',
      '/api/calendar/occurrences?start=2026-05-01&end=2026-05-31&includeCompleted=false'
    );
    expect(withoutDone.data.occurrences).toHaveLength(0);
  });
});

describe('complete / uncomplete', () => {
  test('afterCompletion: next due counts from completedOn', async () => {
    const { data } = await call('POST', '/api/calendar/events', {
      kind: 'task',
      title: 'Deep clean coop',
      date: '2026-05-01',
      recurrence: { interval: 3, unit: 'month', anchor: 'afterCompletion' },
    });
    const done = await call('POST', `/api/calendar/events/${data.event.id}/complete`, {
      occurrenceDate: '2026-05-01',
      completedOn: '2026-07-20', // done late
    });
    expect(done.status).toBe(200);
    expect(done.data.next?.date).toBe('2026-10-20'); // 3 months from actual completion
  });

  test('double-complete is a 400; uncomplete restores pending', async () => {
    const { data } = await call('POST', '/api/calendar/events', {
      kind: 'task',
      title: 'One-off chore',
      date: '2026-05-01',
    });
    const id = data.event.id;
    await call('POST', `/api/calendar/events/${id}/complete`, {
      occurrenceDate: '2026-05-01',
      completedOn: '2026-05-01',
    });
    const dup = await call('POST', `/api/calendar/events/${id}/complete`, {
      occurrenceDate: '2026-05-01',
    });
    expect(dup.status).toBe(400);
    expect(dup.data.error).toMatch(/already completed/);

    const undone = await call('POST', `/api/calendar/events/${id}/uncomplete`, {
      occurrenceDate: '2026-05-01',
    });
    expect(undone.status).toBe(200);
    expect(undone.data.event.completions).toHaveLength(0);

    const missing = await call('POST', `/api/calendar/events/${id}/uncomplete`, {
      occurrenceDate: '2026-05-01',
    });
    expect(missing.status).toBe(404);
  });

  test('completing a non-task is a 400; skipped flag persists', async () => {
    const bday = await call('POST', '/api/calendar/events', {
      kind: 'birthday',
      title: 'Birthday — Sam',
      date: '1990-03-10',
    });
    const res = await call('POST', `/api/calendar/events/${bday.data.event.id}/complete`, {
      occurrenceDate: '2026-03-10',
    });
    expect(res.status).toBe(400);

    const task = await call('POST', '/api/calendar/events', {
      kind: 'task',
      title: 'Skippable chore',
      date: '2026-05-01',
    });
    const skipped = await call('POST', `/api/calendar/events/${task.data.event.id}/complete`, {
      occurrenceDate: '2026-05-01',
      skipped: true,
    });
    expect(skipped.data.event.completions[0].skipped).toBe(true);
  });
});

describe('dispatch', () => {
  test('non-calendar paths return null', async () => {
    const url = new URL('http://internal/api/reminders');
    const req = new Request(url, { method: 'GET' });
    expect(await handleCalendarRoutes(req, url, url.pathname)).toBeNull();
  });
});
