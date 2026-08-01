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
  archived: boolean;
}

export interface TimesheetProject {
  id: string;
  clientId: string;
  name: string;
  hourlyRate: number; // default rate applied to NEW entries
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
  kimaiId?: number; // provenance for rows migrated from Kimai
}

export interface TimesheetStore {
  version: 1;
  clients: TimesheetClient[];
  projects: TimesheetProject[];
  entries: TimesheetEntry[];
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

export function isTimesheetStore(value: unknown): value is TimesheetStore {
  if (!isPlainObject(value)) return false;
  if (value.version !== 1) return false;
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
    if (isTimesheetStore(parsed)) return parsed;
    log.warn('[load] stored timesheet malformed — returning empty store');
  } catch {
    // Missing file (first run) or unreadable JSON — start empty either way.
  }
  return { version: 1, clients: [], projects: [], entries: [] };
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
