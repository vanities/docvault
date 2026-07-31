// Event chip — the pill rendered in month-grid cells and the selected-day
// panel. Color resolution lives in occurrenceStyle.ts (shared with the
// mobile dots and agenda rows).

import { Cake, Check, Circle, Repeat } from 'lucide-react';
import { occurrenceLabel, occurrenceStyle } from './occurrenceStyle';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import type { Occurrence } from './types';

interface EventChipProps {
  occ: Occurrence;
  entities: EntityConfig[];
  onToggleComplete: (occ: Occurrence) => void;
  onOpen: (occ: Occurrence) => void;
}

export function EventChip({ occ, entities, onToggleComplete, onOpen }: EventChipProps) {
  const style = occurrenceStyle(occ, entities);
  const recurring = occ.recurrenceLabel !== 'one-off' && occ.kind !== 'birthday';
  return (
    <div
      className={`group/chip flex items-center gap-1 w-full min-w-0 rounded-md border px-1.5 py-0.5 text-[11px] leading-4 transition-colors ${style.bg} ${style.border} ${style.text} ${
        occ.completed ? 'opacity-45' : ''
      } ${occ.overdue ? 'ring-1 ring-red-500/40' : ''}`}
    >
      {occ.completable && (
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
      {recurring && <Repeat className="w-3 h-3 shrink-0 opacity-70" />}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(occ);
        }}
        title={`${occurrenceLabel(occ)}${occ.notes ? ` — ${occ.notes}` : ''}`}
        className={`flex-1 min-w-0 truncate text-left hover:underline decoration-dotted underline-offset-2 ${
          occ.completed ? 'line-through' : ''
        }`}
      >
        {occurrenceLabel(occ)}
      </button>
    </div>
  );
}
