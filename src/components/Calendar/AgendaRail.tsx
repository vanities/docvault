// Upcoming agenda — the right rail on desktop, stacked under the grid on
// mobile. A selected day pins its full occurrence list at the top (that's
// where "+N more" and mobile day-taps land); below it, pending occurrences
// bucket into Overdue / Today / This Week, then a month-grouped "Coming
// Months" outlook covers the rest of the ~6-month fetched horizon.

import { X } from 'lucide-react';
import {
  addDays,
  agendaBuckets,
  comingMonthGroups,
  parseISODate,
  relativeLabel,
} from './calendarMath';
import { EventChip } from './EventChip';
import { occurrenceLabel, occurrenceStyle } from './occurrenceStyle';
import {
  formatClock,
  formatDaylight,
  type MoonInfo,
  type SeasonMark,
  type SunTimes,
} from './astronomy';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import type { Occurrence } from './types';

export interface DayAstro {
  moon: MoonInfo;
  season?: SeasonMark;
  sun?: SunTimes | null;
}

interface AgendaRailProps {
  occurrences: Occurrence[]; // agenda horizon slice (today-60d .. today+180d)
  selectedDate: string | null;
  selectedDayOccurrences: Occurrence[];
  selectedDayAstro: DayAstro | null;
  today: string;
  entities: EntityConfig[];
  onClearSelection: () => void;
  onToggleComplete: (occ: Occurrence) => void;
  onOpenOccurrence: (occ: Occurrence) => void;
  onAddOnDay: (date: string) => void;
}

// Near-term buckets; everything past "This Week" renders as month groups.
const BUCKET_META: { key: 'overdue' | 'today' | 'week'; label: string; tone: string }[] = [
  { key: 'overdue', label: 'Overdue', tone: 'text-red-400' },
  { key: 'today', label: 'Today', tone: 'text-accent-400' },
  { key: 'week', label: 'This Week', tone: 'text-amber-400' },
];

export function AgendaRail({
  occurrences,
  selectedDate,
  selectedDayOccurrences,
  selectedDayAstro,
  today,
  entities,
  onClearSelection,
  onToggleComplete,
  onOpenOccurrence,
  onAddOnDay,
}: AgendaRailProps) {
  const buckets = agendaBuckets(occurrences, today);
  const total = buckets.overdue.length + buckets.today.length + buckets.week.length;
  // Beyond this week: month-grouped outlook over the fetched horizon.
  const monthGroups = comingMonthGroups(occurrences, addDays(today, 7), today);

  return (
    <div className="space-y-4">
      {selectedDate && (
        <section className="rounded-xl border border-border bg-surface-100/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[12px] font-medium text-surface-900">
              {parseISODate(selectedDate).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </h3>
            <button
              type="button"
              aria-label="Clear selected day"
              onClick={onClearSelection}
              className="p-1 text-surface-600 hover:text-surface-900"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {selectedDayAstro && (
            <div className="mb-2 space-y-0.5 text-[11px] text-surface-600">
              <div>
                {selectedDayAstro.moon.emoji} {selectedDayAstro.moon.name} ·{' '}
                {Math.round(selectedDayAstro.moon.illumination * 100)}% lit
                {selectedDayAstro.season && (
                  <span>
                    {' · '}
                    {selectedDayAstro.season.emoji} {selectedDayAstro.season.name}
                  </span>
                )}
              </div>
              {selectedDayAstro.sun && (
                <div>
                  ☀️ {formatClock(selectedDayAstro.sun.sunrise)} –{' '}
                  {formatClock(selectedDayAstro.sun.sunset)} ·{' '}
                  {formatDaylight(selectedDayAstro.sun.daylightMinutes)} of daylight
                </div>
              )}
            </div>
          )}
          {selectedDayOccurrences.length === 0 ? (
            <p className="text-[12px] text-surface-600">Nothing on this day.</p>
          ) : (
            <div className="space-y-1">
              {selectedDayOccurrences.map((occ) => (
                <EventChip
                  key={`${occ.eventId}:${occ.date}`}
                  occ={occ}
                  entities={entities}
                  onToggleComplete={onToggleComplete}
                  onOpen={onOpenOccurrence}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => onAddOnDay(selectedDate)}
            className="mt-2 text-[11px] text-accent-400 hover:text-accent-500"
          >
            + Add on this day
          </button>
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface-100/20 p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] uppercase tracking-wider text-surface-600">Upcoming</h3>
          {total > 0 && (
            <span className="text-[10px] tabular-nums rounded-full bg-surface-200/60 px-1.5 py-0.5 text-surface-700">
              {total}
            </span>
          )}
        </div>
        {BUCKET_META.map(({ key, label, tone }) => {
          const list = buckets[key];
          if (list.length === 0) return null;
          return (
            <div key={key} className="mb-3 last:mb-0">
              <div className={`text-[10px] uppercase tracking-wider mb-1 ${tone}`}>{label}</div>
              <ul className="space-y-1">
                {list.map((occ) => (
                  <AgendaRow
                    key={`${occ.eventId}:${occ.date}`}
                    occ={occ}
                    today={today}
                    entities={entities}
                    onToggleComplete={onToggleComplete}
                    onOpen={onOpenOccurrence}
                  />
                ))}
              </ul>
            </div>
          );
        })}
        {total === 0 && monthGroups.length === 0 && (
          <p className="text-[12px] text-surface-600">
            Nothing upcoming. Add birthdays and recurring tasks with “New event”.
          </p>
        )}
      </section>

      {monthGroups.length > 0 && (
        <section className="rounded-xl border border-border bg-surface-100/20 p-3">
          <h3 className="text-[11px] uppercase tracking-wider text-surface-600 mb-2">
            Coming Months
          </h3>
          {monthGroups.map((group) => (
            <div key={group.key} className="mb-3 last:mb-0">
              <div className="text-[10px] uppercase tracking-wider mb-1 text-surface-700">
                {group.label}
              </div>
              <ul className="space-y-1">
                {group.items.map((occ) => (
                  <AgendaRow
                    key={`${occ.eventId}:${occ.date}`}
                    occ={occ}
                    today={today}
                    entities={entities}
                    onToggleComplete={onToggleComplete}
                    onOpen={onOpenOccurrence}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function AgendaRow({
  occ,
  today,
  entities,
  onToggleComplete,
  onOpen,
}: {
  occ: Occurrence;
  today: string;
  entities: EntityConfig[];
  onToggleComplete: (occ: Occurrence) => void;
  onOpen: (occ: Occurrence) => void;
}) {
  const style = occurrenceStyle(occ, entities);
  return (
    <li className="flex items-center gap-2 min-h-[28px]">
      {occ.completable ? (
        <button
          type="button"
          aria-label="Mark done"
          onClick={() => onToggleComplete(occ)}
          className="shrink-0 w-4 h-4 rounded-full border border-surface-500/60 hover:border-emerald-400 hover:bg-emerald-500/15 transition-colors"
        />
      ) : (
        <span className={`shrink-0 w-2 h-2 rounded-full ml-1 mr-1 ${style.dot}`} />
      )}
      <button
        type="button"
        onClick={() => onOpen(occ)}
        className="flex-1 min-w-0 text-left text-[12px] text-surface-900 truncate hover:underline decoration-dotted underline-offset-2"
        title={occ.notes ? `${occurrenceLabel(occ)} — ${occ.notes}` : undefined}
      >
        {occurrenceLabel(occ)}
        {occ.recurrenceLabel !== 'one-off' && occ.kind !== 'birthday' && (
          <span className="text-surface-600"> · {occ.recurrenceLabel}</span>
        )}
      </button>
      <span
        className={`shrink-0 text-[11px] tabular-nums ${
          occ.overdue ? 'text-red-400' : 'text-surface-600'
        }`}
      >
        {relativeLabel(occ.date, today)}
      </span>
    </li>
  );
}
