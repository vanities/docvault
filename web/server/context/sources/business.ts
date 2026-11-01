import { loadTimesheetStore, type TimesheetEntry } from '../../timesheet-store.js';
import { money } from '../format.js';
import { ReadCollector, windowPhrase, windowTest } from '../request.js';
import type { ContextSource } from '../types.js';

const hours = (minutes: number) => `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}h`;

export const timesheetSource: ContextSource = {
  id: 'timesheet',
  label: 'Timesheet and invoices',
  group: 'finance',
  description:
    'Business hours logged in the window by client, invoices issued and paid in the window, ' +
    'open invoices with due dates, and billable time not invoiced yet.',
  files: ['.docvault-timesheet.json'],
  async read(req) {
    const r = new ReadCollector();
    const inWindow = windowTest(req);
    await r.part('business/timesheet', async () => {
      const store = await loadTimesheetStore();
      const clientOfProject = new Map(store.projects.map((p) => [p.id, p.clientId]));
      const clientName = new Map(store.clients.map((c) => [c.id, c.name]));
      const clientOf = (e: TimesheetEntry) =>
        clientName.get(clientOfProject.get(e.projectId) ?? '') ?? 'an unlisted client';
      const byClient = (entries: TimesheetEntry[]) => {
        const totals = new Map<string, { minutes: number; amount: number }>();
        for (const e of entries) {
          const t = totals.get(clientOf(e)) ?? { minutes: 0, amount: 0 };
          t.minutes += e.durationMinutes;
          t.amount += e.billable ? e.amount : 0;
          totals.set(clientOf(e), t);
        }
        return [...totals].sort((a, b) => b[1].minutes - a[1].minutes);
      };

      const logged = store.entries.filter((e) => inWindow(e.date));
      if (logged.length) {
        const total = logged.reduce((s, e) => s + e.durationMinutes, 0);
        const parts = byClient(logged).map(
          ([name, t]) =>
            `${name} ${hours(t.minutes)}${t.amount ? `, ${money(t.amount)} billable` : ''}`
        );
        r.lines.push(
          `Time logged ${windowPhrase(req)}: ${hours(total)} across ${parts.length} client(s): ` +
            `${parts.join('; ')}.`
        );
      }
      for (const inv of store.invoices.filter((i) => inWindow(i.issueDate))) {
        r.lines.push(
          `Invoice ${inv.number} to ${inv.clientName} issued ${inv.issueDate}: ${money(inv.total)}, ` +
            `due ${inv.dueDate}, ${inv.status}${inv.sentAt ? `, emailed ${inv.sentAt.slice(0, 10)}` : ''}.`
        );
      }
      for (const inv of store.invoices.filter((i) => i.paymentDate && inWindow(i.paymentDate))) {
        r.lines.push(
          `Invoice ${inv.number} from ${inv.clientName} paid ${inv.paymentDate}: ${money(inv.total)}.`
        );
      }
      if (!req.full) return;
      const open = store.invoices.filter((i) => i.status === 'new');
      if (open.length) {
        const owed = open.reduce((s, i) => s + i.total, 0);
        const late = open.filter((i) => i.dueDate < req.today);
        r.lines.push(
          `Open invoices: ${open.length}, ${money(owed)} owed to the business` +
            (late.length
              ? `; past due: ${late.map((i) => `${i.number} ${i.clientName} ${money(i.total)} (due ${i.dueDate})`).join('; ')}.`
              : '; none past due.')
        );
      }
      const unbilled = store.entries.filter((e) => e.billable && !e.invoiced);
      if (unbilled.length) {
        const parts = byClient(unbilled).map(
          ([name, t]) => `${name} ${hours(t.minutes)} (${money(t.amount)})`
        );
        r.lines.push(`Billable time not invoiced yet: ${parts.join('; ')}.`);
      }
    });
    return r.result();
  },
};
