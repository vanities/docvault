// Calendar store — one global calendar of birthdays, recurring tasks, and
// one-off events, persisted in DATA_DIR/.docvault-calendar.json (auto-included
// in encrypted backups via the .docvault-*.json glob in backup.ts).
//
// This store absorbs the legacy Reminders system: loadCalendarStore() runs a
// one-time migration of .docvault-reminders.json into calendar events (see
// migrateReminders in a later phase). Unlike reminders, events here project
// future occurrences (server/calendar-recurrence.ts) instead of materializing
// the next row on completion, so a month grid can render 12 months of
// "change HVAC filter every 3 months" from a single event definition.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR, REMINDERS_FILE, loadSettings, type Reminder, type Settings } from './data.js';
import { addInterval, projectOccurrences } from './calendar-recurrence.js';
import { createLogger } from './logger.js';
import { getConfiguredTimezone, zonedYMD } from './tz.js';

/** Today's date in the configured timezone. loadSettings can throw (e.g. no
 * master key in a test env) — the calendar must keep working on the container
 * timezone fallback rather than propagate a 500. */
export async function calendarToday(): Promise<string> {
  let settings: Settings | undefined;
  try {
    settings = await loadSettings();
  } catch {
    settings = undefined;
  }
  return zonedYMD(new Date(), getConfiguredTimezone(settings));
}

const log = createLogger('Calendar');

export const CALENDAR_PATH = path.join(DATA_DIR, '.docvault-calendar.json');
// Post-migration resting place for the legacy reminders file. Still matches
// the `.docvault-*.json` backup glob, so it rides in encrypted backups.
export const REMINDERS_BACKUP_PATH = path.join(DATA_DIR, '.docvault-reminders.backup.json');

export type CalendarEventKind = 'birthday' | 'task' | 'event';
export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';
export type RecurrenceAnchor = 'fixed' | 'afterCompletion';

export interface CalendarRecurrence {
  interval: number; // integer >= 1
  unit: RecurrenceUnit;
  // 'fixed': occurrences fall on anchor + k*interval regardless of when you
  // complete them (birthdays, tax deadlines). 'afterCompletion': the next due
  // date counts from the day you actually completed the last one (filter
  // changes, coop maintenance) — exactly one pending occurrence at a time.
  anchor: RecurrenceAnchor;
}

// One resolved occurrence of a task. `occurrenceDate` identifies which
// occurrence this resolves; `completedOn` is the day the work actually
// happened and is what afterCompletion recurrence advances from.
export interface CalendarCompletion {
  occurrenceDate: string; // YYYY-MM-DD
  completedOn: string; // YYYY-MM-DD
  completedAt: string; // ISO timestamp (audit)
  skipped?: boolean; // resolved without doing it (legacy "dismissed")
  notes?: string;
}

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  // Anchor date YYYY-MM-DD. Birthday: any year with the right MM-DD (the
  // birth date itself when known). Task: first due date. Event: the date.
  date: string;
  // null/undefined = one-off. Ignored for birthdays (implicitly yearly fixed).
  recurrence?: CalendarRecurrence | null;
  birthYear?: number; // birthdays only — enables "turns N"
  entityId?: string; // optional tag; the calendar itself is global
  notes?: string;
  status: 'active' | 'archived'; // archived = hidden from projection, history kept
  completions: CalendarCompletion[]; // only kind 'task' accumulates these
  createdAt: string;
  updatedAt: string;
  migratedFromReminderId?: string; // provenance from the legacy reminders store
}

export interface CalendarStore {
  version: 1;
  events: CalendarEvent[];
}

// ============================================================================
// Load / save
// ============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const EVENT_KINDS = new Set(['birthday', 'task', 'event']);
const EVENT_STATUSES = new Set(['active', 'archived']);

function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.date === 'string' &&
    EVENT_KINDS.has(value.kind as string) &&
    EVENT_STATUSES.has(value.status as string) &&
    Array.isArray(value.completions)
  );
}

export function isCalendarStore(value: unknown): value is CalendarStore {
  if (!isPlainObject(value)) return false;
  if (value.version !== 1) return false;
  return Array.isArray(value.events) && value.events.every(isCalendarEvent);
}

export async function loadCalendarStore(): Promise<CalendarStore> {
  await migrateLegacyReminders();
  try {
    const raw = await fs.readFile(CALENDAR_PATH, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (isCalendarStore(parsed)) return parsed;
    log.warn('[load] stored calendar malformed — returning empty store');
  } catch {
    // Missing file (first run) or unreadable JSON — start empty either way.
  }
  return { version: 1, events: [] };
}

export async function saveCalendarStore(store: CalendarStore): Promise<void> {
  const t0 = performance.now();
  // Write-then-rename so a crash mid-write can't truncate the store.
  const tmpPath = `${CALENDAR_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2));
  await fs.rename(tmpPath, CALENDAR_PATH);
  log.debug(`[save] events=${store.events.length} in ${(performance.now() - t0).toFixed(1)}ms`);
}

// ============================================================================
// Legacy-shape compatibility projection
// ============================================================================

/**
 * Project calendar occurrences into the legacy `Reminder` row shape. Kept so
 * consumers of the old reminders store (financial/health snapshots, the
 * /api/reminders shim, Daily News) see an unchanged output shape while the
 * data lives in the calendar. Row id is composite `${eventId}:${occurrence
 * date}` — event ids are UUIDs, so the first ':' splits it unambiguously.
 * Only tasks map (birthdays/events have no legacy equivalent).
 */
export async function loadLegacyShapedReminders(window?: {
  start: string;
  end: string;
}): Promise<Reminder[]> {
  const today = await calendarToday();
  const w = window ?? {
    start: addInterval(today, -1, 'year'),
    end: addInterval(today, 1, 'year'),
  };
  const store = await loadCalendarStore();
  const byId = new Map(store.events.map((e) => [e.id, e] as const));
  return projectOccurrences(store.events, w, today)
    .filter((o) => o.completable)
    .map((o) => {
      const event = byId.get(o.eventId)!;
      return {
        id: `${o.eventId}:${o.date}`,
        entityId: o.entityId ?? '',
        title: o.title,
        dueDate: o.date,
        recurrence: toLegacyRecurrence(event.recurrence),
        status: o.completed ? (o.skipped ? 'dismissed' : 'completed') : 'pending',
        ...(o.notes ? { notes: o.notes } : {}),
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      };
    });
}

/** Back-map a calendar recurrence onto the legacy 3-value enum; cadences the
 * old system couldn't express (e.g. every 6 months) become null. */
export function toLegacyRecurrence(
  recurrence: CalendarRecurrence | null | undefined
): 'yearly' | 'monthly' | 'quarterly' | null {
  if (!recurrence) return null;
  const { interval, unit } = recurrence;
  if (interval === 1 && unit === 'year') return 'yearly';
  if (interval === 3 && unit === 'month') return 'quarterly';
  if (interval === 1 && unit === 'month') return 'monthly';
  return null;
}

// ============================================================================
// One-time migration from the legacy reminders store
// ============================================================================

const LEGACY_RECURRENCE: Record<string, CalendarRecurrence> = {
  yearly: { interval: 1, unit: 'year', anchor: 'fixed' },
  quarterly: { interval: 3, unit: 'month', anchor: 'fixed' },
  monthly: { interval: 1, unit: 'month', anchor: 'fixed' },
};

function completionFromReminder(r: Reminder): CalendarCompletion {
  return {
    occurrenceDate: r.dueDate,
    // updatedAt is the closest record of when the user resolved it.
    completedOn: r.updatedAt.slice(0, 10),
    completedAt: r.updatedAt,
    ...(r.status === 'dismissed' ? { skipped: true } : {}),
  };
}

/**
 * Map legacy reminders onto calendar events. The old store duplicated a row
 * per completion of a recurring reminder (completing pushed a fresh pending
 * row with the next due date), so recurring rows are grouped by
 * (title, entityId, recurrence): the earliest pending row becomes the active
 * event's anchor and resolved siblings fold into its completion history.
 * One-off rows are NOT grouped — two pending reminders sharing a title are
 * genuinely distinct — each maps to its own event, archived when already
 * resolved. All reminders become kind 'task'.
 */
export function migrateReminders(reminders: Reminder[], nowISO: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  const eventFromReminder = (r: Reminder, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: crypto.randomUUID(),
    kind: 'task',
    title: r.title,
    date: r.dueDate,
    recurrence: r.recurrence ? LEGACY_RECURRENCE[r.recurrence] : null,
    entityId: r.entityId,
    ...(r.notes ? { notes: r.notes } : {}),
    status: 'active',
    completions: [],
    createdAt: r.createdAt || nowISO,
    updatedAt: nowISO,
    migratedFromReminderId: r.id,
    ...over,
  });

  // One-offs: one event per row.
  for (const r of reminders) {
    if (r.recurrence) continue;
    events.push(
      r.status === 'pending'
        ? eventFromReminder(r)
        : eventFromReminder(r, { status: 'archived', completions: [completionFromReminder(r)] })
    );
  }

  // Recurring: group the duplicated rows back into one event per series.
  const groups = new Map<string, Reminder[]>();
  for (const r of reminders) {
    if (!r.recurrence) continue;
    const key = JSON.stringify([r.title, r.entityId, r.recurrence]);
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }

  for (const group of groups.values()) {
    const pending = group
      .filter((r) => r.status === 'pending')
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const resolved = group.filter((r) => r.status !== 'pending');
    const completions: CalendarCompletion[] = [];
    const seenDates = new Set<string>();
    for (const r of resolved) {
      if (seenDates.has(r.dueDate)) continue;
      seenDates.add(r.dueDate);
      completions.push(completionFromReminder(r));
    }
    completions.sort((a, b) => (a.occurrenceDate < b.occurrenceDate ? -1 : 1));

    if (pending.length > 0) {
      // Earliest pending row anchors the series; any extra pending duplicates
      // are dropped (the projection regenerates future occurrences anyway).
      // Completions dated before the anchor stay in history but never
      // project, so old resolved quarters can't resurface as overdue.
      events.push(eventFromReminder(pending[0], { completions }));
    } else {
      const latest = group.reduce((a, b) => (a.dueDate > b.dueDate ? a : b));
      events.push(eventFromReminder(latest, { status: 'archived', completions }));
    }
  }

  return events;
}

/**
 * Lazy one-time migration: runs on every load until `.docvault-calendar.json`
 * exists, then short-circuits on a single fs.access. The legacy file is
 * renamed (not deleted) so the raw history survives in backups.
 */
async function migrateLegacyReminders(): Promise<void> {
  try {
    await fs.access(CALENDAR_PATH);
    return; // Calendar store already exists — never re-migrate.
  } catch {
    // fall through
  }
  let raw: string;
  try {
    raw = await fs.readFile(REMINDERS_FILE, 'utf-8');
  } catch {
    return; // No legacy reminders either — fresh install.
  }
  const t0 = performance.now();
  try {
    const reminders: unknown = JSON.parse(raw);
    if (!Array.isArray(reminders)) throw new Error('legacy reminders file is not an array');
    const events = migrateReminders(reminders as Reminder[], new Date().toISOString());
    await saveCalendarStore({ version: 1, events });
    await fs.rename(REMINDERS_FILE, REMINDERS_BACKUP_PATH);
    log.info(
      `[migrate] ${reminders.length} legacy reminders -> ${events.length} calendar events in ${(performance.now() - t0).toFixed(1)}ms; original saved as ${path.basename(REMINDERS_BACKUP_PATH)}`
    );
  } catch (err) {
    // Leave the legacy file untouched for a future attempt / manual repair.
    log.error(`[migrate] failed to migrate legacy reminders: ${String(err)}`);
  }
}
