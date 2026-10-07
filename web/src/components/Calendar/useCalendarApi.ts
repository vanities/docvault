// Thin client hooks over /api/calendar routes (pattern: Health/useHealthApi).
// CalendarView fetches ONE union occurrences window (grid month ∪ agenda
// horizon) and slices it client-side, so month navigation costs one request.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { requestJson } from '../../api/client';
import { API_BASE } from '../../constants';
import { todayISO } from './calendarMath';
import type { CalendarEvent, CalendarEventInput, Occurrence } from './types';

export interface OccurrencesResult {
  occurrences: Occurrence[];
  today: string;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Fetch projected occurrences for [start, end]. Refetches when the window
 * changes; `refetch` re-pulls after any mutation (required after completing
 * an afterCompletion task — only the server can project the moved next
 * occurrence). */
export function useOccurrences(start: string, end: string): OccurrencesResult {
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [today, setToday] = useState<string>(todayISO());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWindow = useCallback(async () => {
    try {
      setError(null);
      const res = await requestJson<{ occurrences: Occurrence[]; today: string }>(
        `${API_BASE}/calendar/occurrences?start=${start}&end=${end}`
      );
      setOccurrences(res.occurrences);
      setToday(res.today);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    setLoading(true);
    void fetchWindow();
  }, [fetchWindow]);

  return { occurrences, today, loading, error, refetch: fetchWindow };
}

export function useCalendarApi() {
  const createEvent = useCallback(async (input: CalendarEventInput): Promise<CalendarEvent> => {
    const res = await requestJson<{ event: CalendarEvent }>(`${API_BASE}/calendar/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.event;
  }, []);

  const updateEvent = useCallback(
    async (id: string, updates: Partial<CalendarEventInput>): Promise<CalendarEvent> => {
      const res = await requestJson<{ event: CalendarEvent }>(
        `${API_BASE}/calendar/events/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }
      );
      return res.event;
    },
    []
  );

  const deleteEvent = useCallback(async (id: string): Promise<void> => {
    await requestJson<{ ok: true }>(`${API_BASE}/calendar/events/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }, []);

  const getEvent = useCallback(async (id: string): Promise<CalendarEvent | null> => {
    const res = await requestJson<{ events: CalendarEvent[] }>(`${API_BASE}/calendar/events`);
    return res.events.find((e) => e.id === id) ?? null;
  }, []);

  const completeOccurrence = useCallback(
    async (
      eventId: string,
      occurrenceDate: string,
      opts?: { skipped?: boolean; completedOn?: string }
    ): Promise<{ next: Occurrence | null }> => {
      const res = await requestJson<{ next: Occurrence | null }>(
        `${API_BASE}/calendar/events/${encodeURIComponent(eventId)}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ occurrenceDate, ...opts }),
        }
      );
      return res;
    },
    []
  );

  const uncompleteOccurrence = useCallback(
    async (eventId: string, occurrenceDate: string): Promise<void> => {
      await requestJson<{ ok: true }>(
        `${API_BASE}/calendar/events/${encodeURIComponent(eventId)}/uncomplete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ occurrenceDate }),
        }
      );
    },
    []
  );

  return useMemo(
    () => ({
      createEvent,
      updateEvent,
      deleteEvent,
      getEvent,
      completeOccurrence,
      uncompleteOccurrence,
    }),
    [createEvent, updateEvent, deleteEvent, getEvent, completeOccurrence, uncompleteOccurrence]
  );
}
