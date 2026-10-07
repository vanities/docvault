// Timesheet route tests — the billing lock that keeps an early/partial
// invoice's hours off the next invoice. Drives handleTimesheetRoutes with
// synthesized Requests the way invokeRoute (chat tools) does. All fixtures
// are fabricated (Acme / Widgets). Uses a temp DATA_DIR so file I/O can never
// touch real data.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { promises as fs } from 'fs';

// Point DATA_DIR at a throwaway directory BEFORE any handler code runs —
// data.ts reads DOCVAULT_DATA_DIR at module-load time.
const tmpDataDir = vi.hoisted(() => {
  const p = require('path') as typeof import('path');
  const o = require('os') as typeof import('os');
  const dir = p.join(o.tmpdir(), `docvault-timesheet-routes-test-${Date.now()}`);
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

// scheduler.ts boots timers and snapshot/quant refreshes at module load; the
// routes only need its re-arm hook. Email must never actually send.
vi.mock('../scheduler.js', () => ({ armWeeklyReportTimer: () => {} }));
vi.mock('../email.js', () => ({
  sendEmail: vi.fn(async () => ({ ok: false, error: 'email disabled in tests' })),
}));

import { sendEmail, type SendEmailResult } from '../email.js';
import { sendWeeklyReport } from '../timesheet-report.js';

// eslint-disable-next-line import/first
import { handleTimesheetRoutes } from './timesheet.js';
// eslint-disable-next-line import/first
import {
  loadTimesheetStore,
  saveTimesheetStore,
  type Invoice,
  type TimesheetEntry,
  type TimesheetStore,
} from '../timesheet-store.js';

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
  const res = await handleTimesheetRoutes(req, url, url.pathname);
  if (!res) throw new Error(`No response for ${method} ${path}`);
  return { status: res.status, data: await res.json() };
}

function entry(
  id: string,
  date: string,
  span: { start: string; end: string } | { minutes: number },
  extra: Partial<TimesheetEntry> = {}
): TimesheetEntry {
  const minutes =
    'minutes' in span
      ? span.minutes
      : (Number(span.end.slice(0, 2)) - Number(span.start.slice(0, 2))) * 60;
  return {
    id,
    projectId: 'widgets',
    date,
    ...('start' in span ? { start: span.start, end: span.end } : {}),
    durationMinutes: minutes,
    description: `work on ${date}`,
    hourlyRate: 100,
    amount: (minutes / 60) * 100,
    billable: true,
    invoiced: false,
    ...extra,
  };
}

// A client invoiced mid-month (through Sep 12) and again at month end.
async function seed(entryOverrides: Record<string, Partial<TimesheetEntry>> = {}): Promise<void> {
  const store: TimesheetStore = {
    version: 1,
    clients: [{ id: 'acme', name: 'Acme Corp', currency: 'USD', archived: false }],
    projects: [
      { id: 'widgets', clientId: 'acme', name: 'Widgets', hourlyRate: 100, archived: false },
      { id: 'gadgets', clientId: 'acme', name: 'Gadgets', hourlyRate: 80, archived: false },
    ],
    entries: [
      entry('e-sep03', '2026-09-03', { start: '09:00', end: '11:00' }, entryOverrides['e-sep03']),
      entry('e-sep10', '2026-09-10', { start: '13:00', end: '16:00' }, entryOverrides['e-sep10']),
      entry('e-sep20', '2026-09-20', { start: '10:00', end: '11:00' }, entryOverrides['e-sep20']),
      entry('e-sep28', '2026-09-28', { minutes: 90 }, entryOverrides['e-sep28']),
    ],
    templates: [],
    invoices: [],
  };
  await saveTimesheetStore(store);
}

async function invoiceEarly(): Promise<Invoice> {
  const res = await call('POST', '/api/timesheet/invoices', { clientId: 'acme', to: '2026-09-12' });
  expect(res.status).toBe(200);
  return res.data.invoice as Invoice;
}

async function storedEntry(id: string): Promise<TimesheetEntry> {
  const store = await loadTimesheetStore();
  const found = store.entries.find((e) => e.id === id);
  if (!found) throw new Error(`entry ${id} missing`);
  return found;
}

beforeEach(async () => {
  vi.mocked(sendEmail)
    .mockReset()
    .mockResolvedValue({ ok: false, error: 'email disabled in tests' });
  await fs.mkdir(tmpDataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDataDir, { recursive: true, force: true });
});

describe('an early invoice, then the month-end invoice', () => {
  test('month end bills only what the early invoice left open', async () => {
    await seed();
    const early = await invoiceEarly();
    expect([...early.entryIds].sort()).toEqual(['e-sep03', 'e-sep10']);
    expect(early.total).toBe(500);

    const monthEnd = await call('POST', '/api/timesheet/invoices', { clientId: 'acme' });
    expect(monthEnd.status).toBe(200);
    expect([...monthEnd.data.invoice.entryIds].sort()).toEqual(['e-sep20', 'e-sep28']);
    expect(monthEnd.data.invoice.total).toBe(250);
    expect(monthEnd.data.invoice.number).not.toBe(early.number);

    // Every entry sits on exactly one invoice and links back to it.
    const store = await loadTimesheetStore();
    for (const e of store.entries) {
      const holders = store.invoices.filter((i) => i.entryIds.includes(e.id));
      expect(holders).toHaveLength(1);
      expect(e.invoiced).toBe(true);
      expect(e.invoiceId).toBe(holders[0].id);
    }
  });

  test('a whole-month window still skips the early invoice’s entries', async () => {
    await seed();
    await invoiceEarly();
    const window = { clientId: 'acme', from: '2026-09-01', to: '2026-09-30' };

    const monthEnd = await call('POST', '/api/timesheet/invoices', window);
    expect(monthEnd.status).toBe(200);
    expect([...monthEnd.data.invoice.entryIds].sort()).toEqual(['e-sep20', 'e-sep28']);

    // Nothing left in the month — a third invoice has nothing to bill.
    const again = await call('POST', '/api/timesheet/invoices', window);
    expect(again.status).toBe(400);
    expect(again.data.error).toBe('No entries to invoice');
  });

  test('explicitly re-selecting a billed entry is refused', async () => {
    await seed();
    await invoiceEarly();
    const res = await call('POST', '/api/timesheet/invoices', {
      clientId: 'acme',
      entryIds: ['e-sep03', 'e-sep20'],
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/already invoiced/);
  });
});

describe('a billed entry is locked', () => {
  test('notes can change, and a modal save re-sending unchanged fields passes', async () => {
    await seed();
    const early = await invoiceEarly();
    const billedAt = (await storedEntry('e-sep03')).invoicedAt;

    const notes = await call('PUT', '/api/timesheet/entries/e-sep03', {
      description: 'clarified notes',
    });
    expect(notes.status).toBe(200);

    // Exactly what the edit modal posts: every field, values unchanged.
    const modalSave = await call('PUT', '/api/timesheet/entries/e-sep03', {
      projectId: 'widgets',
      date: '2026-09-03',
      start: '09:00',
      end: '11:00',
      subClientId: null,
      description: 'saved from the modal',
      billable: true,
      hourlyRate: 100,
      invoiced: true,
    });
    expect(modalSave.status).toBe(200);

    const after = await storedEntry('e-sep03');
    expect(after.description).toBe('saved from the modal');
    expect(after.invoiced).toBe(true);
    expect(after.invoiceId).toBe(early.id);
    expect(after.invoicedAt).toBe(billedAt); // re-sending `invoiced: true` isn't a re-bill
  });

  test('changing anything the invoice charged is refused and nothing is written', async () => {
    await seed();
    const early = await invoiceEarly();
    const before = await storedEntry('e-sep03');

    const attempts: Record<string, unknown>[] = [
      { end: '12:00' }, // more hours
      { date: '2026-09-04' },
      { hourlyRate: 150 },
      { billable: false },
      { projectId: 'gadgets' },
      { start: null, end: null, durationMinutes: 120 }, // same hours, span dropped
      { invoiced: false }, // would put the hours back in the billing queue
    ];
    for (const patch of attempts) {
      const res = await call('PUT', '/api/timesheet/entries/e-sep03', patch);
      expect(res.status, JSON.stringify(patch)).toBe(409);
      expect(res.data.invoiceNumber).toBe(early.number);
      expect(res.data.error).toContain(early.number);
    }
    expect(await storedEntry('e-sep03')).toEqual(before);
  });

  test('a billed entry cannot be deleted', async () => {
    await seed();
    const early = await invoiceEarly();
    const res = await call('DELETE', '/api/timesheet/entries/e-sep03');
    expect(res.status).toBe(409);
    expect(res.data.invoiceNumber).toBe(early.number);
    expect((await loadTimesheetStore()).entries).toHaveLength(4);
  });

  test('deleting the invoice releases its entries to be edited and billed again', async () => {
    await seed();
    const early = await invoiceEarly();

    const released = await call('DELETE', `/api/timesheet/invoices/${early.id}`);
    expect(released.data.released).toBe(2);

    const edit = await call('PUT', '/api/timesheet/entries/e-sep03', { end: '12:00' });
    expect(edit.status).toBe(200);
    expect(edit.data.entry.durationMinutes).toBe(180);

    const reissued = await invoiceEarly();
    expect([...reissued.entryIds].sort()).toEqual(['e-sep03', 'e-sep10']);
    expect(reissued.total).toBe(600);
  });
});

describe('invoiced entries with no invoice record', () => {
  test('mark-invoiced entries stay editable and can be un-marked', async () => {
    await seed();
    const marked = await call('POST', '/api/timesheet/mark-invoiced', { entryIds: ['e-sep20'] });
    expect(marked.data.updated).toBe(1);

    expect((await call('PUT', '/api/timesheet/entries/e-sep20', { end: '12:00' })).status).toBe(
      200
    );
    const unmarked = await call('PUT', '/api/timesheet/entries/e-sep20', { invoiced: false });
    expect(unmarked.status).toBe(200);
    expect(unmarked.data.entry.invoiced).toBe(false);
  });

  test('un-invoicing drops a dangling invoice link so the entry is cleanly open', async () => {
    await seed({ 'e-sep20': { invoiced: true, invoiceId: 'inv-gone', invoicedAt: '2026-09-21' } });
    const res = await call('PUT', '/api/timesheet/entries/e-sep20', { invoiced: false });
    expect(res.status).toBe(200);
    const after = await storedEntry('e-sep20');
    expect(after.invoiced).toBe(false);
    expect(after.invoiceId).toBeUndefined();
    expect(after.invoicedAt).toBeUndefined();
  });
});

describe('overlapping timesheet mutations', () => {
  test('concurrent entries are all retained', async () => {
    await seed();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        call('POST', '/api/timesheet/entries', {
          projectId: 'widgets',
          date: '2026-09-30',
          durationMinutes: 15,
          description: `Synthetic parallel entry ${i}`,
        })
      )
    );
    expect(
      results.every((result) => result.status === 'fulfilled' && result.value.status === 200)
    ).toBe(true);
    const store = await loadTimesheetStore();
    expect(
      store.entries.filter((entry) => entry.description.startsWith('Synthetic parallel entry'))
    ).toHaveLength(12);
  });
  test('overlapping invoices cannot bill the same entries twice', async () => {
    await seed();
    const results = await Promise.allSettled([
      call('POST', '/api/timesheet/invoices', { clientId: 'acme' }),
      call('POST', '/api/timesheet/invoices', { clientId: 'acme' }),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(
      results.filter((result) => result.status === 'fulfilled' && result.value.status === 200)
    ).toHaveLength(1);
    expect((await loadTimesheetStore()).invoices).toHaveLength(1);
  });
});

/** Pause the fake email response while another route updates the store. */
function holdEmail() {
  let release!: (result: SendEmailResult) => void;
  let started!: () => void;
  const pending = new Promise<SendEmailResult>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.mocked(sendEmail).mockImplementationOnce(() => {
    started();
    return pending;
  });
  return { ready, release: () => release({ ok: true, id: 'synthetic-delivery' }) };
}

describe('updates during email delivery', () => {
  test('invoice delivery preserves newer entries and invoice edits, and escapes composed text', async () => {
    await seed();
    const invoice = await invoiceEarly();
    const email = holdEmail();
    const sending = call('POST', `/api/timesheet/invoices/${invoice.id}/send`, {
      to: 'billing@example.com',
      body: 'Hi <Team> & partners\nPlease review.\n\nThanks!',
    });
    await email.ready;
    expect(
      (
        await call('PUT', `/api/timesheet/invoices/${invoice.id}`, {
          status: 'paid',
          comment: 'Synthetic payment',
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call('POST', '/api/timesheet/entries', {
          projectId: 'widgets',
          date: '2026-09-30',
          durationMinutes: 15,
          description: 'Synthetic entry during send',
        })
      ).status
    ).toBe(200);
    email.release();
    expect((await sending).status).toBe(200);
    const store = await loadTimesheetStore();
    expect(store.entries).toHaveLength(5);
    expect(store.invoices[0]).toMatchObject({
      status: 'paid',
      comment: 'Synthetic payment',
      sentTo: 'billing@example.com',
    });
    expect(store.invoices[0].sentAt).toBeTruthy();
    expect(vi.mocked(sendEmail).mock.calls[0][0].html).toBe(
      '<p>Hi &lt;Team&gt; &amp; partners<br>Please review.</p>\n<p>Thanks!</p>'
    );
  });

  test('finishing delivery cannot restore a deleted invoice or its billing locks', async () => {
    await seed();
    const invoice = await invoiceEarly();
    const email = holdEmail();
    const sending = call('POST', `/api/timesheet/invoices/${invoice.id}/send`, {
      to: 'billing@example.com',
    });
    await email.ready;
    expect((await call('DELETE', `/api/timesheet/invoices/${invoice.id}`)).status).toBe(200);
    email.release();
    expect((await sending).status).toBe(200);
    const store = await loadTimesheetStore();
    expect(store.invoices).toHaveLength(0);
    expect(store.entries.every((entry) => !entry.invoiced && !entry.invoiceId)).toBe(true);
  });

  test('weekly report delivery preserves updated report scope and newer entries', async () => {
    await seed();
    await call('PUT', '/api/timesheet/weekly-report/config', {
      to: 'billing@example.com',
      clientIds: ['acme'],
    });
    const email = holdEmail();
    const sending = sendWeeklyReport('2026-09-30');
    await email.ready;
    expect(
      (
        await call('PUT', '/api/timesheet/weekly-report/config', {
          to: 'billing@example.com',
          projectIds: ['gadgets'],
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call('POST', '/api/timesheet/entries', {
          projectId: 'widgets',
          date: '2026-09-30',
          durationMinutes: 15,
          description: 'Synthetic entry during report',
        })
      ).status
    ).toBe(200);
    email.release();
    expect((await sending).ok).toBe(true);
    const store = await loadTimesheetStore();
    expect(store.entries).toHaveLength(5);
    expect(store.weeklyReport).toMatchObject({
      projectIds: ['gadgets'],
      lastSentWeek: '2026-09-30',
    });
    expect(store.weeklyReport?.lastSentAt).toBeTruthy();
  });
});
