// Invoices: an alert add-on for DocVault's timesheet. It trips when an invoice is past due
// (7+ days is a warning, 30+ is act now) and when billable time from an earlier month is still
// on no invoice after the 5th, so both money owed and money never billed get noticed. Reports to
// DocVault Alerts (POST /api/alerts/report); its page is DATA_DIR/alerts/overdue-invoices/dashboard.html.
//
// Env: DOCVAULT_DRY_RUN=1 prints the report instead of sending it.

const envFlag = (v?: string) => v === '1' || v === 'true' || v === 'yes';
const DRY = envFlag(process.env.DOCVAULT_DRY_RUN);
const JOB_ID = process.env.DOCVAULT_JOB_ID || 'overdue-invoices';
const SOURCE_ID = 'overdue-invoices';
const API = process.env.DOCVAULT_API_BASE || 'http://127.0.0.1:3005';

const OVERDUE_WARN_DAYS = 7;
const OVERDUE_CRITICAL_DAYS = 30;
const UNBILLED_AFTER_DAY = 5; // invoices for last month usually go out in the first few days
const UNBILLED_LOOKBACK_DAYS = 120; // older leftovers are history, not a to-do
const UNBILLED_MIN_HOURS = 0.5;
const DAY_MS = 24 * 3600e3;

type Severity = 'critical' | 'warning';
interface Check {
  id: string;
  label: string;
  scope: string;
  severity: Severity;
  active: boolean;
  value: string;
  threshold: string;
}
interface Invoice {
  number: string;
  clientId: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  status: 'new' | 'paid' | 'canceled';
  currency: string;
  total: number;
}
interface Entry {
  projectId: string;
  date: string;
  durationMinutes: number;
  amount: number;
  billable: boolean;
  invoiced: boolean;
  invoiceId?: string;
}
interface Store {
  clients: { id: string; name: string }[];
  projects: { id: string; clientId: string; name: string }[];
  entries: Entry[];
  invoices: Invoice[];
}

const t0 = performance.now();
const ms = (start: number) => (performance.now() - start).toFixed(0);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const log = (line: string) => console.log(`[${SOURCE_ID}] ${line}`);

async function post(pathname: string, body: unknown): Promise<{ emailed?: string | null; emailError?: string; failures?: number }> {
  const start = performance.now();
  const res = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  log(`post ${pathname} status=${res.status} in ${ms(start)}ms`);
  if (!res.ok) throw new Error(`${pathname} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** Today as a local YYYY-MM-DD; DocVault dates are local calendar dates. */
function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Whole days from a to b (YYYY-MM-DD), computed on UTC midnights so DST can't shift it. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
function money(n: number, currency: string): string {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}${currency === 'USD' ? '$' : `${currency} `}${s}`;
}

log(`start dry=${DRY} api=${API}`);
let store: Store;
try {
  const start = performance.now();
  const res = await fetch(`${API}/api/timesheet`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`/api/timesheet HTTP ${res.status}`);
  store = (await res.json()) as Store;
  log(`get /api/timesheet ok in ${ms(start)}ms invoices=${store.invoices.length} entries=${store.entries.length}`);
} catch (e) {
  log(`fetch failed: ${errMsg(e)}`);
  if (!DRY) {
    try {
      const r = await post('/api/alerts/report-failure', { sourceId: SOURCE_ID, error: errMsg(e) });
      log(`failure reported failures=${r.failures} emailed=${r.emailed ?? 'none'}`);
    } catch (err) {
      log(`could not report the failure: ${errMsg(err)}`);
    }
  }
  console.log(`[${SOURCE_ID}] done status=fetch-failed in ${ms(t0)}ms`);
  process.exit(1);
}

const today = localDate();
// Sums use the currency most invoices are in; mixed-currency books still list every invoice.
const currencyCounts = new Map<string, number>();
for (const inv of store.invoices) currencyCounts.set(inv.currency, (currencyCounts.get(inv.currency) ?? 0) + 1);
const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';
const inCurrency = (inv: Invoice) => inv.currency === currency;

const open = store.invoices
  .filter((inv) => inv.status === 'new')
  .map((inv) => ({ ...inv, daysOverdue: Math.max(0, daysBetween(inv.dueDate, today)) }))
  .sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));
const overdueWarn = open.filter((inv) => inv.daysOverdue >= OVERDUE_WARN_DAYS);
const overdueCritical = open.filter((inv) => inv.daysOverdue >= OVERDUE_CRITICAL_DAYS);
const sum = (list: { total: number; currency: string }[]) =>
  list.filter((inv) => inv.currency === currency).reduce((a, inv) => a + inv.total, 0);
const describe = (list: typeof open) =>
  `${list.length} ${list.length === 1 ? 'invoice' : 'invoices'}, ${money(sum(list), currency)}, oldest ${list[0].daysOverdue} days`;

const aging = { current: 0, d1_30: 0, d31_60: 0, d60plus: 0 };
for (const inv of open) {
  if (!inCurrency(inv)) continue;
  if (inv.daysOverdue === 0) aging.current += inv.total;
  else if (inv.daysOverdue <= 30) aging.d1_30 += inv.total;
  else if (inv.daysOverdue <= 60) aging.d31_60 += inv.total;
  else aging.d60plus += inv.total;
}

// ---------- unbilled time ----------
const firstOfMonth = `${today.slice(0, 8)}01`;
const lookbackStart = localDate(new Date(Date.parse(`${firstOfMonth}T12:00:00`) - UNBILLED_LOOKBACK_DAYS * DAY_MS));
const projectById = new Map(store.projects.map((p) => [p.id, p]));
const clientById = new Map(store.clients.map((c) => [c.id, c]));
const unbilledByProject = new Map<string, { clientName: string; projectName: string; minutes: number; amount: number; oldestDate: string }>();
for (const e of store.entries) {
  if (!e.billable || e.invoiced || e.invoiceId || e.date >= firstOfMonth || e.date < lookbackStart) continue;
  const project = projectById.get(e.projectId);
  const row = unbilledByProject.get(e.projectId) ?? {
    clientName: (project && clientById.get(project.clientId)?.name) ?? 'Unknown client',
    projectName: project?.name ?? 'Unknown project',
    minutes: 0,
    amount: 0,
    oldestDate: e.date,
  };
  row.minutes += e.durationMinutes;
  row.amount += e.amount;
  if (e.date < row.oldestDate) row.oldestDate = e.date;
  unbilledByProject.set(e.projectId, row);
}
const unbilled = [...unbilledByProject.values()]
  .map((r) => ({ clientName: r.clientName, projectName: r.projectName, hours: Number((r.minutes / 60).toFixed(2)), amount: Number(r.amount.toFixed(2)), oldestDate: r.oldestDate }))
  .sort((a, b) => b.amount - a.amount);
const unbilledHours = unbilled.reduce((a, r) => a + r.hours, 0);
const unbilledAmount = unbilled.reduce((a, r) => a + r.amount, 0);
const pastBillingDay = Number(today.slice(8, 10)) > UNBILLED_AFTER_DAY;

const ninetyDaysAgo = localDate(new Date(Date.now() - 90 * DAY_MS));
const paid90 = store.invoices.filter((inv) => inv.status === 'paid' && inv.issueDate >= ninetyDaysAgo);

const checks: Check[] = [
  {
    id: 'invoices:overdue',
    label: 'Past-due invoices',
    scope: 'Invoices',
    severity: 'warning',
    active: overdueWarn.length > 0,
    value: overdueWarn.length ? describe(overdueWarn) : `none ${OVERDUE_WARN_DAYS}+ days late (${open.length} open)`,
    threshold: `${OVERDUE_WARN_DAYS}+ days past due`,
  },
  {
    id: 'invoices:very-overdue',
    label: 'Invoices 30+ days late',
    scope: 'Invoices',
    severity: 'critical',
    active: overdueCritical.length > 0,
    value: overdueCritical.length ? describe(overdueCritical) : `none ${OVERDUE_CRITICAL_DAYS}+ days late`,
    threshold: `${OVERDUE_CRITICAL_DAYS}+ days past due`,
  },
  {
    id: 'invoices:unbilled',
    label: 'Unbilled time',
    scope: 'Invoices',
    severity: 'warning',
    active: pastBillingDay && unbilledHours >= UNBILLED_MIN_HOURS,
    value: unbilledHours >= UNBILLED_MIN_HOURS
      ? `${unbilledHours.toFixed(1)} h, about ${money(unbilledAmount, currency)}${pastBillingDay ? '' : ` (checked after the ${UNBILLED_AFTER_DAY}th)`}`
      : 'all earlier time is invoiced',
    threshold: `time before this month still unbilled after the ${UNBILLED_AFTER_DAY}th`,
  },
];
for (const c of checks) log(`check ${c.id} ${c.active ? 'TRIPPED' : 'ok'}`);

const report = {
  sourceId: SOURCE_ID,
  label: 'Invoices',
  description: 'Past-due invoices and billable time that never made it onto an invoice',
  jobId: JOB_ID,
  checks,
  advice: {
    critical:
      'Follow up today on invoices more than 30 days past due: resend them from the Timesheet tab or contact the client, and mark them paid once the money lands.',
    warning:
      'Look at the past-due invoices and unbilled time in the Timesheet tab: send a reminder, or bill the leftover hours with this month\'s invoices.',
  },
  detail: {
    kind: 'overdue-invoices',
    data: {
      currency,
      today,
      open: open.map((inv) => ({
        number: inv.number,
        clientName: inv.clientName,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        daysOverdue: inv.daysOverdue,
        total: inv.total,
        currency: inv.currency,
      })),
      aging,
      unbilled,
      unbilledSince: lookbackStart,
      paid90: { count: paid90.length, total: Number(sum(paid90).toFixed(2)) },
    },
  },
  series: {
    'invoices.outstanding': Number(sum(open).toFixed(2)),
    'invoices.overdue': Number(sum(open.filter((inv) => inv.daysOverdue > 0)).toFixed(2)),
    'invoices.unbilledHours': Number(unbilledHours.toFixed(2)),
  },
};

let outcome = 'dry';
if (DRY) {
  log(`dry run: would report checks=${checks.length} active=${checks.filter((c) => c.active).length} bytes=${JSON.stringify(report).length}`);
  if (envFlag(process.env.DOCVAULT_PRINT_REPORT)) console.log(JSON.stringify(report));
} else {
  try {
    const r = await post('/api/alerts/report', report);
    outcome = `reported emailed=${r.emailed ?? 'none'}${r.emailError ? ` emailError="${r.emailError}"` : ''}`;
  } catch (e) {
    log(`report failed: ${errMsg(e)}`);
    console.log(`[${SOURCE_ID}] done status=report-failed in ${ms(t0)}ms`);
    process.exit(1);
  }
}
console.log(
  `[${SOURCE_ID}] done status=ok checks=${checks.length} active=${checks.filter((c) => c.active).length} ${outcome} in ${ms(t0)}ms`
);
