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
import {
  astrologyForDate,
  mercuryStationsByDate,
  moonInfoForDate,
  moonPhasesByDate,
  seasonMarksByDate,
  sunTimesForDate,
} from './astronomy';
import { dstTransitionsByDate, meteorShowersByDate, usHolidaysByDate } from './almanac';
import { requestJson } from '../../api/client';
import { API_BASE } from '../../constants';
import type { AstroMark } from './MonthGrid';
import type { DayAstro } from './AgendaRail';
import type { CalendarEventInput, Occurrence } from './types';

const AGENDA_PAST_DAYS = 60;
// Forward horizon feeds both the near-term buckets and the month-grouped
// "Coming Months" outlook in the rail.
const AGENDA_FUTURE_DAYS = 180;

interface WeatherDaySummary {
  date: string;
  emoji: string;
  hi: number;
  lo: number;
}

/** Per-layer display toggles, server-persisted in settings.calendar so the
 * Daily News respects the same choices. Everything defaults ON. */
export interface CalendarDisplaySettings {
  showMoon?: boolean; // phases + eclipses + supermoons
  showSeasons?: boolean; // equinoxes/solstices
  showAstrology?: boolean; // zodiac signs + Mercury retrograde
  showMeteors?: boolean;
  showSunTimes?: boolean;
  showHolidays?: boolean;
  showDst?: boolean;
  showWeather?: boolean;
}

const on = (v: boolean | undefined) => v !== false;

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

  const [display, setDisplay] = useState<CalendarDisplaySettings>({});

  // Astronomy + almanac layers — pure client-side math over the grid window,
  // each gated by its settings toggle.
  const astroByDate = useMemo(() => {
    const start = gridDays[0].date;
    const end = gridDays[gridDays.length - 1].date;
    const map = new Map<string, AstroMark[]>();
    const push = (date: string, mark: AstroMark) => {
      const list = map.get(date) ?? [];
      list.push(mark);
      map.set(date, list);
    };
    if (on(display.showMoon)) {
      for (const [date, mark] of moonPhasesByDate(start, end)) {
        if (mark.supermoon) {
          push(date, { emoji: '🌝', label: 'Supermoon (full moon near perigee)' });
        } else {
          push(date, { emoji: mark.emoji, label: mark.label });
        }
        if (mark.eclipse === 'solar') push(date, { emoji: '⚫', label: 'Solar eclipse' });
        if (mark.eclipse === 'lunar') push(date, { emoji: '🔴', label: 'Lunar eclipse' });
      }
    }
    if (on(display.showSeasons)) {
      for (const [date, mark] of seasonMarksByDate(start, end)) {
        push(date, { emoji: mark.emoji, label: mark.name });
      }
    }
    if (on(display.showAstrology)) {
      for (const [date, station] of mercuryStationsByDate(start, end)) {
        push(date, { emoji: '☿', label: station.label });
      }
    }
    if (on(display.showMeteors)) {
      for (const [date, mark] of meteorShowersByDate(start, end)) {
        push(date, { emoji: mark.emoji, label: mark.label });
      }
    }
    if (on(display.showDst)) {
      for (const [date, mark] of dstTransitionsByDate(start, end)) {
        push(date, { emoji: mark.emoji, label: mark.label });
      }
    }
    return map;
  }, [gridDays, display]);

  const holidaysByDate = useMemo(
    () =>
      on(display.showHolidays)
        ? usHolidaysByDate(gridDays[0].date, gridDays[gridDays.length - 1].date)
        : new Map<string, string>(),
    [gridDays, display]
  );

  // Week forecast (same cached source as the Daily News weather box).
  const [weatherByDate, setWeatherByDate] = useState<Map<string, WeatherDaySummary>>(new Map());
  useEffect(() => {
    if (!on(display.showWeather)) return;
    requestJson<{
      forecast: { days: { date: string; emoji: string; hi: number; lo: number }[] } | null;
    }>(`${API_BASE}/weather/forecast`)
      .then((res) => {
        if (!res.forecast) return;
        setWeatherByDate(new Map(res.forecast.days.map((d) => [d.date, d])));
      })
      .catch(() => {});
  }, [display.showWeather]);

  // Sunrise/sunset reuses the weather location (the single location source of
  // truth — configured in Settings with the geocode picker); the same fetch
  // loads the per-layer calendar display toggles.
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    requestJson<{
      weather?: { latitude?: number; longitude?: number };
      calendar?: CalendarDisplaySettings;
    }>(`${API_BASE}/settings`)
      .then((s) => {
        if (typeof s.weather?.latitude === 'number' && typeof s.weather?.longitude === 'number') {
          setCoords({ latitude: s.weather.latitude, longitude: s.weather.longitude });
        }
        if (s.calendar) setDisplay(s.calendar);
      })
      .catch(() => {});
  }, []);

  const selectedDayAstro = useMemo<DayAstro | null>(() => {
    if (!selectedDate) return null;
    const seasonByDate = on(display.showSeasons)
      ? seasonMarksByDate(selectedDate, selectedDate)
      : new Map<string, never>();
    const marks = astroByDate.get(selectedDate) ?? [];
    const extras: string[] = marks
      .filter((m) => !['New moon', 'First quarter', 'Full moon', 'Last quarter'].includes(m.label))
      .map((m) => `${m.emoji} ${m.label}`);
    const holiday = holidaysByDate.get(selectedDate);
    if (holiday) extras.push(`🎉 ${holiday}`);
    const weather = weatherByDate.get(selectedDate);
    if (weather)
      extras.push(`${weather.emoji} ${Math.round(weather.hi)}° / ${Math.round(weather.lo)}°`);
    return {
      moon: on(display.showMoon) ? moonInfoForDate(selectedDate) : null,
      season: seasonByDate.get(selectedDate),
      sun:
        on(display.showSunTimes) && coords
          ? sunTimesForDate(selectedDate, coords.latitude, coords.longitude)
          : null,
      astrology: on(display.showAstrology) ? astrologyForDate(selectedDate) : null,
      extras,
    };
  }, [selectedDate, coords, display, astroByDate, holidaysByDate, weatherByDate]);

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
                astroByDate={astroByDate}
                holidaysByDate={holidaysByDate}
                weatherByDate={weatherByDate}
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
          selectedDayAstro={selectedDayAstro}
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
