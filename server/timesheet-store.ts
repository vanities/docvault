// Timesheet store — clients, projects, and manually-entered time entries,
// persisted in DATA_DIR/.docvault-timesheet.json (auto-included in encrypted
// backups via the .docvault-*.json glob in backup.ts).
//
// Model notes:
// - Two-level hierarchy: clients own projects; the billing rate lives on the
//   project. Each entry SNAPSHOTS the rate at logging time (hourlyRate +
//   computed amount), so re-rating a project never rewrites history or
//   already-invoiced entries.
// - Entries are manual start/end wall times (no running-timer state). An
//   entry is immutable-complete at creation: date (YYYY-MM-DD), start/end
//   (HH:MM local), durationMinutes derived server-side with midnight wrap.
// - `invoiced` is the lightweight billing state machine (Kimai's `exported`):
//   the core report is "uninvoiced hours per client", not "hours per week".

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('Timesheet');

export const TIMESHEET_PATH = path.join(DATA_DIR, '.docvault-timesheet.json');

export interface TimesheetClient {
  id: string;
  name: string;
  currency: string; // ISO code, display only
  color?: string; // #rrggbb; UI falls back to a palette slot when unset
  defaultTemplateId?: string; // preselected template when invoicing this client
  dueDays?: number; // payment terms override; unset = template's dueDays
  email?: string; // where "Send invoice" delivers the PDF
  autoFileEntityId?: string; // entity whose docs get a copy of each new invoice PDF
  archived: boolean;
}

export interface TimesheetProject {
  id: string;
  clientId: string;
  name: string;
  hourlyRate: number; // default rate applied to NEW entries
  color?: string; // #rrggbb; falls back to the client's color when unset
  // Retainer floor for THIS engagement: when an invoice's billed work for
  // this project comes in under it, creation appends a labeled top-up line.
  minimumInvoice?: number;
  // Email defaults for invoices billing this project. Support {{placeholder}}
  // substitution: number, client, project, total, dueDate, issueDate, month,
  // hours, company. Resolved into an editable draft before sending — nothing
  // is ever sent without the user seeing and confirming the composed email.
  emailTo?: string;
  emailFrom?: string;
  emailSubject?: string;
  emailBody?: string;
  archived: boolean;
}

export interface TimesheetEntry {
  id: string;
  projectId: string;
  date: string; // YYYY-MM-DD (local date of start)
  start: string; // HH:MM local wall time
  end: string; // HH:MM local wall time; end < start means it crossed midnight
  durationMinutes: number;
  description: string;
  hourlyRate: number; // snapshot of the project rate when logged
  amount: number; // billable ? durationMinutes/60 * hourlyRate : 0
  billable: boolean;
  invoiced: boolean;
  invoicedAt?: string; // ISO timestamp of the mark-invoiced action
  invoiceId?: string; // set when the entry was billed through a stored invoice
  kimaiId?: number; // provenance for rows migrated from Kimai
}

/** Reusable invoice layout config — the sender identity and terms that would
 * otherwise be retyped per invoice (mirrors Kimai's invoice templates). All
 * content is data (lives in the store, gitignored) — nothing personal is
 * baked into code. */
export interface InvoiceTemplate {
  id: string;
  name: string;
  title: string; // heading, e.g. "Invoice"
  company: string;
  address: string[]; // sender address lines
  contact: string[]; // name / email lines
  paymentTerms: string;
  paymentDetails: string[]; // bank details lines, rendered in the footer
  dueDays: number;
  vat: number; // percent; 0 = no tax line
  // Long line descriptions on the PDF: wrap to extra lines (default) or
  // truncate with an ellipsis to keep one row per entry.
  descriptionStyle?: 'wrap' | 'truncate';
  archived: boolean;
}

export type InvoiceStatus = 'new' | 'paid' | 'canceled';

/** A line frozen onto an invoice at creation time. Invoices snapshot their
 * lines so later edits/deletes of entries can never rewrite billing history. */
export interface InvoiceLine {
  date: string;
  description: string;
  projectName: string;
  minutes: number;
  hourlyRate: number;
  amount: number;
}

export interface Invoice {
  id: string;
  number: string; // e.g. "2026/027" — continues the Kimai sequence
  clientId: string;
  clientName: string; // snapshot, so client renames don't rewrite history
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  status: InvoiceStatus;
  currency: string;
  totalMinutes: number;
  subtotal: number;
  vat: number; // percent applied
  tax: number; // computed tax amount
  total: number;
  templateId?: string;
  comment?: string;
  lines: InvoiceLine[]; // empty for invoices imported from Kimai (no line data)
  entryIds: string[]; // entries billed by this invoice (empty for imports)
  projectIds?: string[]; // distinct projects billed — drives history filtering
  // (absent on Kimai imports; those only match the "all projects" filter)
  paymentDate?: string; // YYYY-MM-DD when marked paid
  sentAt?: string; // ISO timestamp of the last email send
  sentTo?: string; // recipient of the last email send
  filedPath?: string; // "entityId:relative/path" when auto-filed into entity docs
  createdAt: string;
  kimaiId?: number; // provenance for invoices imported from Kimai
}

export interface TimesheetStore {
  version: 1;
  clients: TimesheetClient[];
  projects: TimesheetProject[];
  entries: TimesheetEntry[];
  templates: InvoiceTemplate[];
  invoices: Invoice[];
}

// ============================================================================
// Shape guards
// ============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isClient(value: unknown): value is TimesheetClient {
  if (!isPlainObject(value)) return false;
  return typeof value.id === 'string' && typeof value.name === 'string';
}

function isProject(value: unknown): value is TimesheetProject {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.clientId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.hourlyRate === 'number'
  );
}

function isEntry(value: unknown): value is TimesheetEntry {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.date === 'string' &&
    typeof value.start === 'string' &&
    typeof value.end === 'string' &&
    typeof value.durationMinutes === 'number'
  );
}

function isTemplate(value: unknown): value is InvoiceTemplate {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.company === 'string' &&
    Array.isArray(value.address)
  );
}

const INVOICE_STATUSES = new Set(['new', 'paid', 'canceled']);

function isInvoice(value: unknown): value is Invoice {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.number === 'string' &&
    typeof value.clientId === 'string' &&
    typeof value.issueDate === 'string' &&
    INVOICE_STATUSES.has(value.status as string) &&
    typeof value.total === 'number' &&
    Array.isArray(value.lines) &&
    Array.isArray(value.entryIds)
  );
}

export function isTimesheetStore(value: unknown): value is TimesheetStore {
  if (!isPlainObject(value)) return false;
  if (value.version !== 1) return false;
  // templates/invoices are validated but may be absent (pre-invoice stores);
  // loadTimesheetStore normalizes them to [].
  if (value.templates !== undefined) {
    if (!Array.isArray(value.templates) || !value.templates.every(isTemplate)) return false;
  }
  if (value.invoices !== undefined) {
    if (!Array.isArray(value.invoices) || !value.invoices.every(isInvoice)) return false;
  }
  return (
    Array.isArray(value.clients) &&
    value.clients.every(isClient) &&
    Array.isArray(value.projects) &&
    value.projects.every(isProject) &&
    Array.isArray(value.entries) &&
    value.entries.every(isEntry)
  );
}

// ============================================================================
// Load / save
// ============================================================================

export async function loadTimesheetStore(): Promise<TimesheetStore> {
  try {
    const raw = await fs.readFile(TIMESHEET_PATH, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (isTimesheetStore(parsed)) {
      // Normalize pre-invoice stores (v1 without templates/invoices arrays).
      parsed.templates ??= [];
      parsed.invoices ??= [];
      return parsed;
    }
    log.warn('[load] stored timesheet malformed — returning empty store');
  } catch {
    // Missing file (first run) or unreadable JSON — start empty either way.
  }
  return { version: 1, clients: [], projects: [], entries: [], templates: [], invoices: [] };
}

export async function saveTimesheetStore(store: TimesheetStore): Promise<void> {
  const t0 = performance.now();
  // Write-then-rename so a crash mid-write can't truncate the store.
  const tmpPath = `${TIMESHEET_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2));
  await fs.rename(tmpPath, TIMESHEET_PATH);
  log.debug(
    `[save] clients=${store.clients.length} projects=${store.projects.length} entries=${store.entries.length} in ${(performance.now() - t0).toFixed(1)}ms`
  );
}

// ============================================================================
// Derivations
// ============================================================================

/** Minutes between two HH:MM wall times, wrapping across midnight. */
export function spanMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let span = eh * 60 + em - (sh * 60 + sm);
  if (span < 0) span += 24 * 60;
  return span;
}

export function isValidTime(value: string): boolean {
  if (!HHMM.test(value)) return false;
  const [h, m] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidDate(value: string): boolean {
  return YMD.test(value) && !Number.isNaN(Date.parse(value));
}

export function entryAmount(
  durationMinutes: number,
  hourlyRate: number,
  billable: boolean
): number {
  if (!billable) return 0;
  return Math.round((durationMinutes / 60) * hourlyRate * 100) / 100;
}

/** Next invoice number continuing the `YYYY/NNN` sequence (Kimai's format).
 * The counter is per-year: the first invoice of a new year starts at 001. */
export function nextInvoiceNumber(invoices: Invoice[], year: number): string {
  let max = 0;
  for (const inv of invoices) {
    const m = inv.number.match(/^(\d{4})\/(\d+)$/);
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  }
  return `${year}/${String(max + 1).padStart(3, '0')}`;
}
