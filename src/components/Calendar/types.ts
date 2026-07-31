// Frontend mirrors of the server calendar types (server/calendar-store.ts,
// server/calendar-recurrence.ts).

export type CalendarEventKind = 'birthday' | 'task' | 'event';
export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';
export type RecurrenceAnchor = 'fixed' | 'afterCompletion';

export interface CalendarRecurrence {
  interval: number;
  unit: RecurrenceUnit;
  anchor: RecurrenceAnchor;
}

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  date: string; // YYYY-MM-DD anchor
  recurrence?: CalendarRecurrence | null;
  birthYear?: number;
  entityId?: string;
  notes?: string;
  status: 'active' | 'archived';
  completions: {
    occurrenceDate: string;
    completedOn: string;
    completedAt: string;
    skipped?: boolean;
    notes?: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface Occurrence {
  eventId: string;
  kind: CalendarEventKind;
  title: string;
  date: string; // YYYY-MM-DD
  entityId?: string;
  notes?: string;
  completable: boolean;
  completed: boolean;
  skipped?: boolean;
  completedOn?: string;
  overdue: boolean;
  age?: number;
  recurrenceLabel: string;
}

export interface CalendarEventInput {
  kind: CalendarEventKind;
  title: string;
  date: string;
  recurrence?: CalendarRecurrence | null;
  birthYear?: number | null;
  entityId?: string | null;
  notes?: string | null;
  status?: 'active' | 'archived';
}
