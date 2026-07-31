// Calendar — the global month-grid view of birthdays, recurring tasks, and
// one-off events. One occurrences request covers the visible grid AND the
// agenda horizon (a union window), so month navigation and the rail share a
// single fetch. Completing an afterCompletion task must refetch: the next
// occurrence moves to completion-date + interval, which only the server
// projects.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppContext } from '../../contexts/AppContext';
import { useToast } from '../../hooks/useToast';
import { AgendaRail } from './AgendaRail';
import { EventModal, type EventModalState } from './EventModal';
import { MonthGrid } from './MonthGrid';
import {
  addMonths,
  groupOccurrencesByDate,
  monthGridDays,
  monthTitle,
  parseISODate,
  toISODate,
  todayISO,
  type MonthCursor,
} from './calendarMath';
import { useCalendarApi, useOccurrences } from './useCalendarApi';
import type { CalendarEventInput, Occurrence } from './types';

const AGENDA_PAST_DAYS = 60;
// Forward horizon feeds both the near-term buckets and the month-grouped
// "Coming Months" outlook in the rail.
const AGENDA_FUTURE_DAYS = 180;

function shiftDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

export function CalendarView() {
  const { entities } = useAppContext();
  const { addToast } = useToast();
  const api = useCalendarApi();

  const now = new Date();
  const [cursor, setCursor] = useState<MonthCursor>({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [modal, setModal] = useState<EventModalState | null>(null);

  const localToday = todayISO();
  const gridDays = useMemo(() => monthGridDays(cursor, localToday), [cursor, localToday]);

  // Union window: visible grid ∪ agenda horizon.
  const windowStart = useMemo(() => {
    const agendaStart = shiftDays(localToday, -AGENDA_PAST_DAYS);
    return gridDays[0].date < agendaStart ? gridDays[0].date : agendaStart;
  }, [gridDays, localToday]);
  const windowEnd = useMemo(() => {
    const agendaEnd = shiftDays(localToday, AGENDA_FUTURE_DAYS);
    const gridEnd = gridDays[gridDays.length - 1].date;
    return gridEnd > agendaEnd ? gridEnd : agendaEnd;
  }, [gridDays, localToday]);

  const { occurrences, today, loading, error, refetch } = useOccurrences(windowStart, windowEnd);
  const [optimistic, setOptimistic] = useState<Map<string, boolean>>(new Map());

  // Server refetch clears local optimistic completion flips.
  useEffect(() => {
    setOptimistic(new Map());
  }, [occurrences]);

  const effectiveOccurrences = useMemo(() => {
    if (optimistic.size === 0) return occurrences;
    return occurrences.map((occ) => {
      const flip = optimistic.get(`${occ.eventId}:${occ.date}`);
      return flip === undefined ? occ : { ...occ, completed: flip, overdue: false };
    });
  }, [occurrences, optimistic]);

  const occurrencesByDate = useMemo(
    () => groupOccurrencesByDate(effectiveOccurrences),
    [effectiveOccurrences]
  );

  const agendaSlice = useMemo(() => {
    const start = shiftDays(today, -AGENDA_PAST_DAYS);
    const end = shiftDays(today, AGENDA_FUTURE_DAYS);
    return effectiveOccurrences.filter((o) => o.date >= start && o.date <= end);
  }, [effectiveOccurrences, today]);

  const monthCounts = useMemo(() => {
    const inMonth = effectiveOccurrences.filter((o) => {
      const [y, m] = o.date.split('-').map(Number);
      return y === cursor.year && m === cursor.month;
    });
    const birthdays = inMonth.filter((o) => o.kind === 'birthday').length;
    const tasks = inMonth.filter((o) => o.completable && !o.completed).length;
    const parts: string[] = [];
    if (birthdays) parts.push(`${birthdays} birthday${birthdays === 1 ? '' : 's'}`);
    if (tasks) parts.push(`${tasks} open task${tasks === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }, [effectiveOccurrences, cursor]);

  const handleToggleComplete = useCallback(
    (occ: Occurrence) => {
      const key = `${occ.eventId}:${occ.date}`;
      const target = !occ.completed;
      setOptimistic((prev) => new Map(prev).set(key, target));
      void (async () => {
        try {
          if (target) await api.completeOccurrence(occ.eventId, occ.date);
          else await api.uncompleteOccurrence(occ.eventId, occ.date);
          await refetch();
        } catch (err) {
          setOptimistic((prev) => {
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
          addToast(err instanceof Error ? err.message : 'Failed to update task', 'error');
        }
      })();
    },
    [api, refetch, addToast]
  );

  const handleOpenOccurrence = useCallback(
    (occ: Occurrence) => {
      void api
        .getEvent(occ.eventId)
        .then((event) => {
          if (event) setModal({ mode: 'edit', event });
          else addToast('Event no longer exists', 'error');
        })
        .catch(() => addToast('Failed to load event', 'error'));
    },
    [api, addToast]
  );

  const handleSave = useCallback(
    async (input: CalendarEventInput, eventId?: string) => {
      if (eventId) await api.updateEvent(eventId, input);
      else await api.createEvent(input);
      await refetch();
    },
    [api, refetch]
  );

  const handleDelete = useCallback(
    async (eventId: string) => {
      await api.deleteEvent(eventId);
      await refetch();
    },
    [api, refetch]
  );

  // Keyboard: ←/→ month nav, t = today. Skipped while typing or in a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (modal || !target) return;
      if (target.closest('input, textarea, select, [role="dialog"], [contenteditable]')) return;
      if (e.key === 'ArrowLeft') setCursor((c) => addMonths(c, -1));
      else if (e.key === 'ArrowRight') setCursor((c) => addMonths(c, 1));
      else if (e.key === 't') {
        const d = new Date();
        setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  const goToday = () => {
    const d = new Date();
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
    setSelectedDate(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display italic text-2xl text-surface-950 flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-orange-400" />
            Calendar
          </h2>
          <p className="text-[13px] text-surface-800 mt-1">
            Birthdays, recurring tasks, and dates worth remembering — across every entity.
          </p>
        </div>
        <Button size="sm" onClick={() => setModal({ mode: 'create', defaultDate: today })}>
          <Plus className="w-4 h-4" />
          New event
        </Button>
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-6 space-y-4 lg:space-y-0">
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Previous month"
                onClick={() => setCursor((c) => addMonths(c, -1))}
              >
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="xs" onClick={goToday}>
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Next month"
                onClick={() => setCursor((c) => addMonths(c, 1))}
              >
                <ChevronRight />
              </Button>
            </div>
            <div className="text-right">
              <div className="font-display italic text-lg text-surface-950 leading-tight">
                {monthTitle(cursor)}
              </div>
              {monthCounts && <div className="text-[11px] text-surface-600">{monthCounts}</div>}
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-[13px] text-red-400">
              {error}
            </div>
          ) : (
            <div className={loading ? 'opacity-60 pointer-events-none' : ''}>
              <MonthGrid
                days={gridDays}
                occurrencesByDate={occurrencesByDate}
                selectedDate={selectedDate}
                entities={entities}
                onSelectDay={(date) => setSelectedDate((cur) => (cur === date ? null : date))}
                onToggleComplete={handleToggleComplete}
                onOpenOccurrence={handleOpenOccurrence}
              />
            </div>
          )}
        </div>

        <AgendaRail
          occurrences={agendaSlice}
          selectedDate={selectedDate}
          selectedDayOccurrences={selectedDate ? (occurrencesByDate.get(selectedDate) ?? []) : []}
          today={today}
          entities={entities}
          onClearSelection={() => setSelectedDate(null)}
          onToggleComplete={handleToggleComplete}
          onOpenOccurrence={handleOpenOccurrence}
          onAddOnDay={(date) => setModal({ mode: 'create', defaultDate: date })}
        />
      </div>

      <EventModal
        state={modal}
        entities={entities}
        onClose={() => setModal(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}
