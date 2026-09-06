// Event chip — the pill rendered in month-grid cells and the selected-day
// panel. Color resolution lives in occurrenceStyle.ts (shared with the
// mobile dots and agenda rows).
//
// A chip renders ONE day of an occurrence (a DaySegment). Single-day events
// have exactly one; a multi-day event (a trip) has one per day it covers,
// squared off at the joins so the run reads as a continuous band. Only the
// first day carries the completion toggle and the title — later days repeat
// the title at week starts, where the band restarts on a new row.

import { Cake, Check, Circle, Repeat } from 'lucide-react';
import { formatDateRange, occurrenceEnd, type DaySegment } from './calendarMath';
import { occurrenceLabel, occurrenceStyle } from './occurrenceStyle';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import type { Occurrence } from './types';

interface EventChipProps {
  segment: DaySegment;
  entities: EntityConfig[];
  /** Repeat the title here even mid-span — set on the first cell of a grid
   * row, where a band that started earlier in the week picks up again. */
  repeatTitle?: boolean;
  onToggleComplete: (occ: Occurrence) => void;
  onOpen: (occ: Occurrence) => void;
}

export function EventChip({
  segment,
  entities,
  repeatTitle = false,
  onToggleComplete,
  onOpen,
}: EventChipProps) {
  const { occ, isStart, isEnd, dayIndex, dayCount } = segment;
  const style = occurrenceStyle(occ, entities);
  const recurring = occ.recurrenceLabel !== 'one-off' && occ.kind !== 'birthday';
  const multiDay = dayCount > 1;
  const showTitle = isStart || repeatTitle;
  const range = multiDay ? formatDateRange(occ.date, occurrenceEnd(occ)) : null;
  const label = occurrenceLabel(occ);
  const tooltip = [label, range && `${range} · day ${dayIndex} of ${dayCount}`, occ.notes]
    .filter(Boolean)
    .join(' — ');

  return (
    <div
      className={`group/chip flex items-center gap-1 w-full min-w-0 border px-1.5 py-0.5 text-[11px] leading-4 transition-colors ${style.bg} ${style.border} ${style.text} ${
        occ.completed ? 'opacity-45' : ''
      } ${occ.overdue ? 'ring-1 ring-red-500/40' : ''} ${
        // Square off + bleed into the cell padding wherever the band continues
        // into the neighbouring day, so the joins read as one bar.
        isStart ? 'rounded-l-md' : 'rounded-l-none border-l-0 -ml-1 md:-ml-1.5 pl-1'
      } ${isEnd ? 'rounded-r-md' : 'rounded-r-none border-r-0 -mr-1 md:-mr-1.5 pr-1'}`}
    >
      {occ.completable && isStart && (
        <button
          type="button"
          aria-label={occ.completed ? 'Mark not done' : 'Mark done'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete(occ);
          }}
          className="shrink-0 rounded-full hover:bg-emerald-500/20 hover:text-emerald-400 p-0.5 -ml-0.5"
        >
          {occ.completed ? (
            <Check className="w-3 h-3 text-emerald-400" />
          ) : (
            <Circle className="w-3 h-3 opacity-60" />
          )}
        </button>
      )}
      {occ.kind === 'birthday' && <Cake className="w-3 h-3 shrink-0" />}
      {recurring && isStart && <Repeat className="w-3 h-3 shrink-0 opacity-70" />}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(occ);
        }}
        title={tooltip}
        aria-label={showTitle ? undefined : `${label} — day ${dayIndex} of ${dayCount}`}
        className={`flex-1 min-w-0 truncate text-left hover:underline decoration-dotted underline-offset-2 ${
          occ.completed ? 'line-through' : ''
        } ${showTitle ? '' : 'opacity-0'}`}
      >
        {/* The continuation days keep the button (and the band's height) but
            hide the text, so the bar stays one unbroken run. */}
        {showTitle ? label : '·'}
      </button>
    </div>
  );
}
