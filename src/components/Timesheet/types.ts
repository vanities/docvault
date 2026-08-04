// Shared types + helpers for the Timesheet feature. Mirrors the server-side
// store shapes in server/timesheet-store.ts.

import { API_BASE } from '../../constants';
import { requestJson } from '../../api/client';

export interface TimesheetClient {
  id: string;
  name: string;
  currency: string;
  color?: string;
  defaultTemplateId?: string;
  dueDays?: number;
  email?: string;
  autoFileEntityId?: string;
  archived: boolean;
}

export interface TimesheetProject {
  id: string;
  clientId: string;
  name: string;
  hourlyRate: number;
  color?: string;
  minimumInvoice?: number;
  emailTo?: string;
  emailFrom?: string;
  emailSubject?: string;
  emailBody?: string;
  archived: boolean;
}

export interface TimesheetEntry {
  id: string;
  projectId: string;
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  description: string;
  hourlyRate: number;
  amount: number;
  billable: boolean;
  invoiced: boolean;
  invoicedAt?: string;
  invoiceId?: string;
}

export interface InvoiceTemplate {
  id: string;
  name: string;
  title: string;
  company: string;
  address: string[];
  contact: string[];
  paymentTerms: string;
  paymentDetails: string[];
  dueDays: number;
  vat: number;
  descriptionStyle?: 'wrap' | 'truncate';
  archived: boolean;
}

export type InvoiceStatus = 'new' | 'paid' | 'canceled';

export interface Invoice {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  currency: string;
  totalMinutes: number;
  subtotal: number;
  vat: number;
  tax: number;
  total: number;
  templateId?: string;
  comment?: string;
  lines: unknown[];
  entryIds: string[];
  projectIds?: string[];
  paymentDate?: string;
  sentAt?: string;
  sentTo?: string;
  filedPath?: string;
  createdAt: string;
  kimaiId?: number;
}

export interface TimesheetStore {
  version: 1;
  clients: TimesheetClient[];
  projects: TimesheetProject[];
  entries: TimesheetEntry[];
  templates: InvoiceTemplate[];
  invoices: Invoice[];
  weeklyReport?: WeeklyReportConfig;
}

// Weekly report — mirrors server/timesheet-report.ts shapes.

export interface WeeklyReportRule {
  name: string;
  keywords: string[];
}

export interface WeeklyReportConfig {
  enabled: boolean;
  to: string;
  day: number; // 0-6, 0=Sunday
  hour: number; // 0-23
  timezone?: string;
  clientIds: string[]; // empty = all clients
  projectIds: string[]; // empty = all projects
  categories: WeeklyReportRule[];
  lastSentWeek?: string;
  lastSentAt?: string;
}

export interface WeeklyReportRow {
  date: string;
  category: string;
  client: string;
  project: string;
  description: string;
  minutes: number;
  hourlyRate: number;
  amount: number;
  billable: boolean;
}

export interface WeeklyReportPreview {
  window: { start: string; end: string };
  rows: WeeklyReportRow[];
  categories: { category: string; minutes: number; amount: number }[];
  totalMinutes: number;
  totalAmount: number;
  csv: string;
  html: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export const TS = `${API_BASE}/timesheet`;

export function tsJson<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  return requestJson<T>(`${TS}${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
}

/** POST expecting a PDF back; triggers a browser download. Throws on non-OK
 * with the server's error message so callers can surface it. */
export async function downloadPdf(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${TS}${path}`, {
    method: body !== undefined ? 'POST' : 'GET',
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!res.ok) {
    let message = `PDF request failed (${res.status})`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'invoice.pdf';
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Formatters + date helpers
// ---------------------------------------------------------------------------

// Validated dark-mode categorical slots (dataviz reference palette, fixed
// order — the ordering is the CVD-safety mechanism, don't shuffle). Assigned
// to clients by stable store order; color follows the client everywhere.
export const CLIENT_PALETTE = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
];

export const CHART_ACCENT = CLIENT_PALETTE[0];
export const CHART_CONTEXT_GRAY = '#5b6070'; // de-emphasis series

/** Client id → display color: the user-picked color when set, otherwise the
 * palette slot for the client's stable store position. Single source of truth
 * so tables, charts, and pickers all agree. */
export function buildClientColorMap(clients: TimesheetClient[]): Map<string, string> {
  return new Map(
    clients.map((c, i) => [c.id, c.color || CLIENT_PALETTE[i % CLIENT_PALETTE.length]] as const)
  );
}

/** Project display color: its own color, else its client's. */
export function projectDisplayColor(
  project: TimesheetProject | undefined,
  clientColors: Map<string, string>
): string {
  if (!project) return CHART_CONTEXT_GRAY;
  return project.color || clientColors.get(project.clientId) || CHART_CONTEXT_GRAY;
}

export function compactUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

export function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday-start ISO date of the week containing `ymd`. */
export function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  const dow = (d.getDay() + 6) % 7;
  return shiftDays(ymd, -dow);
}

export type RangePreset =
  | 'all'
  | 'this-week'
  | 'this-month'
  | 'last-month'
  | 'this-year'
  | 'custom';

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-year', label: 'This year' },
  { value: 'custom', label: 'Custom…' },
];

/** Resolve a preset to a [from, to] date window ('' = unbounded). */
export function presetRange(preset: RangePreset): { from: string; to: string } {
  const today = todayYMD();
  const [y, m] = [today.slice(0, 4), today.slice(5, 7)];
  switch (preset) {
    case 'this-week':
      return { from: weekStart(today), to: today };
    case 'this-month':
      return { from: `${y}-${m}-01`, to: today };
    case 'last-month': {
      const first = new Date(`${y}-${m}-01T00:00:00`);
      first.setMonth(first.getMonth() - 1);
      const ly = first.getFullYear();
      const lm = String(first.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(ly, first.getMonth() + 1, 0).getDate();
      return { from: `${ly}-${lm}-01`, to: `${ly}-${lm}-${String(lastDay).padStart(2, '0')}` };
    }
    case 'this-year':
      return { from: `${y}-01-01`, to: today };
    default:
      return { from: '', to: '' };
  }
}

/** Display a HH:MM wall time in the user's preferred clock format. */
export function formatClock(value: string, hour24: boolean): string {
  if (hour24) return value;
  const [h, m] = value.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/** Now, rounded to the nearest 15 minutes, as HH:MM. */
export function nowRounded15(): string {
  const d = new Date();
  let minutes = Math.round((d.getHours() * 60 + d.getMinutes()) / 15) * 15;
  minutes = minutes % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** HH:MM plus `delta` minutes, wrapping midnight. */
export function addMinutes(time: string, delta: number): string {
  const [h, m] = time.split(':').map(Number);
  let total = (h * 60 + m + delta) % (24 * 60);
  if (total < 0) total += 24 * 60;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Wall-clock span with midnight wrap — mirrors the server derivation. */
export function spanMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let span = eh * 60 + em - (sh * 60 + sm);
  if (span < 0) span += 24 * 60;
  return span;
}
