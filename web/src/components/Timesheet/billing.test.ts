// Billing-state derivation tests: the New Invoice selection summary (what
// will be billed vs. what an earlier invoice already billed), invoice work
// periods, and the date-span formatter. All fixtures are fabricated.

import { describe, expect, test } from 'vite-plus/test';
import { billedOn, invoiceWorkPeriod, summarizeInvoiceSelection } from './billing';
import { formatDateSpan, type Invoice, type TimesheetEntry, type TimesheetStore } from './types';

function entry(
  id: string,
  date: string,
  minutes: number,
  extra: Partial<TimesheetEntry> = {}
): TimesheetEntry {
  return {
    id,
    projectId: 'widgets',
    date,
    durationMinutes: minutes,
    description: 'work',
    hourlyRate: 100,
    amount: (minutes / 60) * 100,
    billable: true,
    invoiced: false,
    ...extra,
  };
}

const billedBy = (invoiceId: string): Partial<TimesheetEntry> => ({ invoiced: true, invoiceId });

function invoice(id: string, number: string, extra: Partial<Invoice> = {}): Invoice {
  return {
    id,
    number,
    clientId: 'acme',
    clientName: 'Acme Corp',
    issueDate: '2026-09-14',
    dueDate: '2026-09-28',
    status: 'paid',
    currency: 'USD',
    totalMinutes: 0,
    subtotal: 0,
    vat: 0,
    tax: 0,
    total: 0,
    lines: [],
    entryIds: [],
    createdAt: '2026-09-14T00:00:00.000Z',
    ...extra,
  };
}

// An Acme invoice issued mid-month (work Aug 28 – Sep 10), with the rest of
// September still open — plus another client's work that must never mix in.
function makeStore(entries?: TimesheetEntry[]): TimesheetStore {
  return {
    version: 1,
    clients: [
      { id: 'acme', name: 'Acme Corp', currency: 'USD', archived: false },
      { id: 'globex', name: 'Globex', currency: 'USD', archived: false },
    ],
    projects: [
      { id: 'widgets', clientId: 'acme', name: 'Widgets', hourlyRate: 100, archived: false },
      { id: 'gadgets', clientId: 'acme', name: 'Gadgets', hourlyRate: 100, archived: false },
      { id: 'sprockets', clientId: 'globex', name: 'Sprockets', hourlyRate: 100, archived: false },
    ],
    entries: entries ?? [
      entry('aug28', '2026-08-28', 30, billedBy('inv-early')),
      entry('sep03', '2026-09-03', 120, billedBy('inv-early')),
      entry('sep10', '2026-09-10', 180, billedBy('inv-early')),
      entry('sep14', '2026-09-14', 60),
      entry('sep28', '2026-09-28', 90),
      entry('globex', '2026-09-15', 600, { projectId: 'sprockets' }),
    ],
    templates: [],
    invoices: [invoice('inv-early', '2099/001')],
  };
}

describe('summarizeInvoiceSelection', () => {
  test('month end: bills only the open work and lists what the early invoice billed', () => {
    const s = summarizeInvoiceSelection(makeStore(), { clientId: 'acme' });
    expect(s.count).toBe(2);
    expect(s.minutes).toBe(150);
    expect(s.amount).toBe(250);
    expect([s.firstDate, s.lastDate]).toEqual(['2026-09-14', '2026-09-28']);
    // No window set → the check widens to the whole month of the open work.
    expect(s.period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(s.billed).toEqual([
      {
        invoiceId: 'inv-early',
        number: '2099/001',
        status: 'paid',
        count: 2, // Aug 28 is outside September
        minutes: 300,
        firstDate: '2026-09-03',
        lastDate: '2026-09-10',
      },
    ]);
  });

  test('an explicit window bounds both the open work and the billed list', () => {
    const s = summarizeInvoiceSelection(makeStore(), {
      clientId: 'acme',
      from: '2026-08-01',
      to: '2026-09-12',
    });
    expect(s.count).toBe(0);
    expect(s.period).toEqual({ from: '2026-08-01', to: '2026-09-12' });
    expect(s.billed.map((g) => g.count)).toEqual([3]);
  });

  test('a project scope excludes the client’s other projects from both sides', () => {
    const store = makeStore([
      entry('w-billed', '2026-09-02', 60, billedBy('inv-early')),
      entry('g-billed', '2026-09-03', 60, { projectId: 'gadgets', ...billedBy('inv-early') }),
      entry('w-open', '2026-09-20', 60),
      entry('g-open', '2026-09-21', 60, { projectId: 'gadgets' }),
    ]);
    const s = summarizeInvoiceSelection(store, { clientId: 'acme', projectId: 'gadgets' });
    expect(s.count).toBe(1);
    expect(s.billed).toHaveLength(1);
    expect(s.billed[0].count).toBe(1);
    expect(s.billed[0].firstDate).toBe('2026-09-03');
  });

  test('entries marked invoiced with no invoice record group together', () => {
    const store = makeStore([
      entry('legacy', '2026-09-05', 60, { invoiced: true }),
      entry('open', '2026-09-20', 60),
    ]);
    const s = summarizeInvoiceSelection(store, { clientId: 'acme' });
    expect(s.billed).toEqual([
      expect.objectContaining({ invoiceId: null, number: null, status: null, count: 1 }),
    ]);
  });

  test('groups list the newest billed work first', () => {
    const store = makeStore([
      entry('a', '2026-09-02', 60, billedBy('inv-early')),
      entry('b', '2026-09-16', 60, billedBy('inv-late')),
      entry('open', '2026-09-29', 60),
    ]);
    store.invoices.push(invoice('inv-late', '2099/002', { status: 'new' }));
    const s = summarizeInvoiceSelection(store, { clientId: 'acme' });
    expect(s.billed.map((g) => g.number)).toEqual(['2099/002', '2099/001']);
  });

  test('nothing open and no window → no period to check', () => {
    const store = makeStore([entry('done', '2026-09-03', 60, billedBy('inv-early'))]);
    const s = summarizeInvoiceSelection(store, { clientId: 'acme' });
    expect(s.count).toBe(0);
    expect(s.period).toBeNull();
    expect(s.billed).toEqual([]);
  });

  test('the widened period ends on the real last day of the month (leap February)', () => {
    const store = makeStore([entry('feb', '2028-02-10', 60)]);
    expect(summarizeInvoiceSelection(store, { clientId: 'acme' }).period).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  test('retainer deficit is computed per project', () => {
    const store = makeStore([
      entry('w', '2026-09-20', 60), // $100 against a $500 floor
      entry('g', '2026-09-21', 60, { projectId: 'gadgets' }), // no floor
    ]);
    store.projects[0].minimumInvoice = 500;
    expect(summarizeInvoiceSelection(store, { clientId: 'acme' }).deficit).toBe(400);
  });
});

describe('billedOn', () => {
  test('resolves a link only to an invoice that exists', () => {
    const inv = invoice('inv-early', '2099/001');
    const byId = new Map([[inv.id, inv]]);
    expect(billedOn(byId, { invoiceId: 'inv-early' })).toBe(inv);
    expect(billedOn(byId, { invoiceId: 'inv-deleted' })).toBeUndefined();
    expect(billedOn(byId, {})).toBeUndefined();
  });
});

describe('invoiceWorkPeriod', () => {
  test('spans the billed lines and ignores retainer top-ups', () => {
    const line = (date: string, minutes: number) => ({
      date,
      description: 'work',
      projectName: 'Widgets',
      minutes,
      hourlyRate: 100,
      amount: minutes,
    });
    const inv = invoice('i', '2099/003', {
      lines: [line('2026-09-10', 60), line('2026-08-28', 30), line('2026-10-01', 0)],
    });
    expect(invoiceWorkPeriod(inv)).toEqual({ from: '2026-08-28', to: '2026-09-10' });
  });

  test('line-less imported invoices have no period', () => {
    expect(invoiceWorkPeriod(invoice('i', '2099/004'))).toBeNull();
  });
});

describe('formatDateSpan', () => {
  test('drops the year inside the current year', () => {
    expect(formatDateSpan('2026-08-28', '2026-09-12', 2026)).toBe('Aug 28 – Sep 12');
    expect(formatDateSpan('2026-09-12', '2026-09-12', 2026)).toBe('Sep 12');
  });

  test('spells the year out for past years and cross-year spans', () => {
    expect(formatDateSpan('2025-02-03', '2025-02-28', 2026)).toBe('Feb 3 – Feb 28, 2025');
    expect(formatDateSpan('2025-12-01', '2026-01-04', 2026)).toBe('Dec 1, 2025 – Jan 4, 2026');
  });
});
