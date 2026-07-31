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

import path from 'path';
import { DATA_DIR } from './data.js';

export const CALENDAR_PATH = path.join(DATA_DIR, '.docvault-calendar.json');

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
