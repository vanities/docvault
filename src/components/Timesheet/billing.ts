// Billing-state derivations for the Timesheet UI: which invoice locked an
// entry, the work period an invoice covered, and what a New Invoice selection
// will — and won't — bill. Pure over the store so the modal, the tables, and
// the tests share one definition. The open-entry filter mirrors the server's
// assembleInvoice (server/routes/timesheet.ts); change them together.

import type { Invoice, InvoiceStatus, TimesheetEntry, TimesheetStore } from './types';

/** The stored invoice that billed an entry. The server refuses to change the
 * entry's billed values or delete it until that invoice is deleted (mirrors
 * billingInvoiceOf in server/timesheet-store.ts). */
export function billedOn(
  invoiceById: ReadonlyMap<string, Invoice>,
  entry: Pick<TimesheetEntry, 'invoiceId'>
): Invoice | undefined {
  return entry.invoiceId ? invoiceById.get(entry.invoiceId) : undefined;
}

/** First..last date of the work an invoice billed. Retainer top-up lines have
 * no minutes and are skipped; line-less Kimai imports return null. */
export function invoiceWorkPeriod(
  invoice: Pick<Invoice, 'lines'>
): { from: string; to: string } | null {
  let from = '';
  let to = '';
  for (const line of invoice.lines) {
    if (line.minutes <= 0) continue;
    if (!from || line.date < from) from = line.date;
    if (!to || line.date > to) to = line.date;
  }
  return from ? { from, to } : null;
}

export interface SelectionInput {
  clientId: string;
  projectId?: string;
  from?: string;
  to?: string;
}

/** Work inside the checked period that an earlier invoice already billed. */
export interface BilledGroup {
  invoiceId: string | null; // null = marked invoiced with no invoice record
  number: string | null;
  status: InvoiceStatus | null;
  count: number;
  minutes: number;
  firstDate: string;
  lastDate: string;
}

export interface SelectionSummary {
  count: number;
  minutes: number;
  amount: number;
  deficit: number; // what per-project retainer top-ups would add
  firstDate: string | null;
  lastDate: string | null;
  /** Period checked for already-billed work: the explicit window, with an
   * unset bound widened to the calendar month the open work starts/ends in —
   * so at month end, an early invoice from that same month is listed. */
  period: { from: string; to: string } | null;
  billed: BilledGroup[]; // newest work first
}

function monthEnd(ymd: string): string {
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0).getDate();
  return `${ymd.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

export function summarizeInvoiceSelection(
  store: TimesheetStore,
  { clientId, projectId, from, to }: SelectionInput
): SelectionSummary {
  const projectById = new Map(store.projects.map((p) => [p.id, p] as const));
  const invoiceById = new Map(store.invoices.map((i) => [i.id, i] as const));
  const inScope = (e: TimesheetEntry) =>
    projectById.get(e.projectId)?.clientId === clientId &&
    (!projectId || e.projectId === projectId);

  // Exactly what POST /invoices bills for this selection.
  const open = store.entries.filter(
    (e) =>
      inScope(e) && !e.invoiced && e.billable && (!from || e.date >= from) && (!to || e.date <= to)
  );

  let deficit = 0;
  for (const pid of new Set(open.map((e) => e.projectId))) {
    const min = projectById.get(pid)?.minimumInvoice;
    if (!min) continue;
    const projSum = open.filter((e) => e.projectId === pid).reduce((s, e) => s + e.amount, 0);
    if (projSum < min) deficit += min - projSum;
  }

  const dates = open.map((e) => e.date).sort();
  const firstDate = dates[0] ?? null;
  const lastDate = dates[dates.length - 1] ?? null;
  const periodFrom = from || (firstDate ? `${firstDate.slice(0, 7)}-01` : '');
  const periodTo = to || (lastDate ? monthEnd(lastDate) : '');
  const period = periodFrom && periodTo ? { from: periodFrom, to: periodTo } : null;

  const groups = new Map<string, BilledGroup>();
  if (period) {
    for (const e of store.entries) {
      if (!e.invoiced || !inScope(e) || e.date < period.from || e.date > period.to) continue;
      const invoice = billedOn(invoiceById, e);
      const key = invoice?.id ?? '';
      const group = groups.get(key) ?? {
        invoiceId: invoice?.id ?? null,
        number: invoice?.number ?? null,
        status: invoice?.status ?? null,
        count: 0,
        minutes: 0,
        firstDate: e.date,
        lastDate: e.date,
      };
      group.count += 1;
      group.minutes += e.durationMinutes;
      if (e.date < group.firstDate) group.firstDate = e.date;
      if (e.date > group.lastDate) group.lastDate = e.date;
      groups.set(key, group);
    }
  }

  return {
    count: open.length,
    minutes: open.reduce((s, e) => s + e.durationMinutes, 0),
    amount: open.reduce((s, e) => s + e.amount, 0),
    deficit,
    firstDate,
    lastDate,
    period,
    billed: [...groups.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
  };
}
