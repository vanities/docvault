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
  date: string; // YYYY-MM-DD anchor (first day of a span)
  endDate?: string; // inclusive last day of a multi-day event; absent = single-day
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
  date: string; // YYYY-MM-DD (first day of a span)
  endDate?: string; // inclusive last day; set only on multi-day occurrences
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
  endDate?: string | null;
  recurrence?: CalendarRecurrence | null;
  birthYear?: number | null;
  entityId?: string | null;
  notes?: string | null;
  status?: 'active' | 'archived';
}
