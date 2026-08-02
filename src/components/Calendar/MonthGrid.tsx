// The month grid — 42 Sunday-start cells. Desktop cells show up to 3 event
// chips with a "+N more" overflow that pins the day in the agenda panel;
// below md the cells collapse to color dots and the whole cell becomes the
// tap target (the day agenda panel under the grid carries the detail).

import { WEEKDAY_LABELS, type GridDay } from './calendarMath';
import { EventChip } from './EventChip';
import { occurrenceStyle } from './occurrenceStyle';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import type { Occurrence } from './types';

const MAX_CHIPS = 3;
const MAX_DOTS = 4;

export interface AstroMark {
  emoji: string;
  label: string;
}

interface MonthGridProps {
  days: GridDay[];
  occurrencesByDate: Map<string, Occurrence[]>;
  astroByDate: Map<string, AstroMark[]>;
  selectedDate: string | null;
  entities: EntityConfig[];
  onSelectDay: (date: string) => void;
  onToggleComplete: (occ: Occurrence) => void;
  onOpenOccurrence: (occ: Occurrence) => void;
}

export function MonthGrid({
  days,
  occurrencesByDate,
  astroByDate,
  selectedDate,
  entities,
  onSelectDay,
  onToggleComplete,
  onOpenOccurrence,
}: MonthGridProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-100/20 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border-subtle">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-1.5 text-center text-[10px] uppercase tracking-wider text-surface-600"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => (
          <DayCell
            key={day.date}
            day={day}
            row={Math.floor(i / 7)}
            col={i % 7}
            occurrences={occurrencesByDate.get(day.date) ?? []}
            astro={astroByDate.get(day.date)}
            selected={selectedDate === day.date}
            entities={entities}
            onSelectDay={onSelectDay}
            onToggleComplete={onToggleComplete}
            onOpenOccurrence={onOpenOccurrence}
          />
        ))}
      </div>
    </div>
  );
}

interface DayCellProps {
  day: GridDay;
  row: number;
  col: number;
  occurrences: Occurrence[];
  astro: AstroMark[] | undefined;
  selected: boolean;
  entities: EntityConfig[];
  onSelectDay: (date: string) => void;
  onToggleComplete: (occ: Occurrence) => void;
  onOpenOccurrence: (occ: Occurrence) => void;
}

function DayCell({
  day,
  row,
  col,
  occurrences,
  astro,
  selected,
  entities,
  onSelectDay,
  onToggleComplete,
  onOpenOccurrence,
}: DayCellProps) {
  const dayNumber = Number(day.date.slice(8, 10));
  const overflow = occurrences.length - MAX_CHIPS;
  const hasOverdue = occurrences.some((o) => o.overdue);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectDay(day.date)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectDay(day.date);
        }
      }}
      className={`
        relative min-h-[52px] md:min-h-[96px] p-1 md:p-1.5 cursor-pointer text-left
        ${col > 0 ? 'border-l border-border-subtle' : ''}
        ${row > 0 ? 'border-t border-border-subtle' : ''}
        ${day.inMonth ? '' : 'opacity-40'}
        ${day.isWeekend && day.inMonth ? 'bg-surface-0/30' : ''}
        ${day.isToday ? 'bg-accent-500/5 ring-1 ring-inset ring-accent-500/40' : ''}
        ${selected && !day.isToday ? 'ring-1 ring-inset ring-surface-500/50 bg-surface-100/40' : ''}
        hover:bg-surface-100/50 transition-colors
      `}
    >
      <div className="flex items-center justify-between">
        {/* Astronomy layer: principal moon phases + solstice/equinox marks. */}
        <span className="flex gap-0.5 text-[10px] leading-none opacity-70">
          {astro?.map((a) => (
            <span key={a.label} title={a.label}>
              {a.emoji}
            </span>
          ))}
        </span>
        <span
          className={`text-[11px] tabular-nums ${
            day.isToday
              ? 'bg-accent-500/20 text-accent-400 font-semibold rounded-full w-5 h-5 flex items-center justify-center -mr-0.5 -mt-0.5'
              : 'text-surface-600'
          }`}
        >
          {dayNumber}
        </span>
      </div>

      {/* Desktop: chips */}
      <div className="hidden md:flex flex-col gap-0.5 mt-0.5">
        {occurrences.slice(0, MAX_CHIPS).map((occ) => (
          <EventChip
            key={`${occ.eventId}:${occ.date}`}
            occ={occ}
            entities={entities}
            onToggleComplete={onToggleComplete}
            onOpen={onOpenOccurrence}
          />
        ))}
        {overflow > 0 && (
          <span className="text-[10px] text-surface-600 hover:text-surface-900 pl-1">
            +{overflow} more
          </span>
        )}
      </div>

      {/* Mobile: dots */}
      <div className="flex md:hidden flex-wrap items-center gap-0.5 mt-1 min-h-[8px]">
        {occurrences.slice(0, MAX_DOTS).map((occ) => (
          <span
            key={`${occ.eventId}:${occ.date}`}
            className={`w-1.5 h-1.5 rounded-full ${occurrenceStyle(occ, entities).dot} ${
              occ.completed ? 'opacity-40' : ''
            }`}
          />
        ))}
        {occurrences.length > MAX_DOTS && (
          <span className="text-[9px] leading-none text-surface-600">
            +{occurrences.length - MAX_DOTS}
          </span>
        )}
      </div>

      {hasOverdue && (
        <span className="absolute bottom-1 left-1 w-1.5 h-1.5 rounded-full bg-red-500 md:hidden" />
      )}
    </div>
  );
}
