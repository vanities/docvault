// Illness timeline — auto-detected periods with user notes, dismiss, and collapsible list.

import { useState, useCallback } from 'react';
import {
  Thermometer,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ShieldAlert,
  MessageSquare,
  X,
  Check,
  EyeOff,
  Eye,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHealthApi } from './useHealthApi';
import type { IllnessPeriod } from './types';

/** User annotations stored server-side. */
export interface IllnessNoteMap {
  [key: string]: { note?: string; dismissed?: boolean; updatedAt: string };
}

interface IllnessTimelineProps {
  periods: IllnessPeriod[];
  personId: string;
  notes: IllnessNoteMap;
  onNotesChange: (notes: IllnessNoteMap) => void;
}

function periodKey(p: IllnessPeriod): string {
  return `${p.startDate}-${p.endDate}`;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' };
  const currentYear = new Date().getFullYear();
  const startYear = s.getUTCFullYear();

  if (start === end) {
    return s.toLocaleDateString('en-US', startYear === currentYear ? opts : yearOpts);
  }
  const startStr = s.toLocaleDateString('en-US', startYear === currentYear ? opts : yearOpts);
  const endStr = e.toLocaleDateString('en-US', opts);
  return `${startStr} – ${endStr}`;
}

export function IllnessTimeline({ periods, personId, notes, onNotesChange }: IllnessTimelineProps) {
  const api = useHealthApi();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);

  const saveNote = useCallback(
    async (key: string, data: { note?: string; dismissed?: boolean }) => {
      await api.updateIllnessNote(personId, key, data);
      const updated = { ...notes };
      if ((!data.note || data.note.trim() === '') && !data.dismissed) {
        delete updated[key];
      } else {
        updated[key] = { ...data, updatedAt: new Date().toISOString() };
      }
      onNotesChange(updated);
    },
    [api, personId, notes, onNotesChange]
  );

  if (periods.length === 0) return null;

  // Separate dismissed and active
  const active = periods.filter((p) => !notes[periodKey(p)]?.dismissed);
  const dismissed = periods.filter((p) => notes[periodKey(p)]?.dismissed);

  // Sort most recent first
  const sorted = [...active].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const defaultCount = 3;
  const canExpand = sorted.length > defaultCount;
  const visible = canExpand && !showAll ? sorted.slice(0, defaultCount) : sorted;

  return (
    <div className="rounded-xl border border-border/40 bg-surface-50/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-[0.12em] flex items-center gap-1.5">
          <Thermometer className="w-3.5 h-3.5 text-amber-400" />
          Detected illness periods
          <span className="text-surface-500 font-mono tabular-nums">({active.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {dismissed.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDismissed(!showDismissed)}
              className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-surface-700 transition-colors font-medium"
            >
              {showDismissed ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {dismissed.length} dismissed
            </button>
          )}
          {canExpand && (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-accent-400 transition-colors font-medium"
            >
              {showAll ? (
                <>
                  Collapse <ChevronUp className="w-3 h-3" />
                </>
              ) : (
                <>
                  Show all <ChevronDown className="w-3 h-3" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {active.length === 0 && !showDismissed ? (
        <div className="text-sm text-surface-600 py-6 text-center">
          No illness periods detected (or all dismissed).
        </div>
      ) : (
        <div className="divide-y divide-border/20">
          {visible.map((period) => (
            <PeriodRow
              key={periodKey(period)}
              period={period}
              note={notes[periodKey(period)]}
              isExpanded={expanded === periodKey(period)}
              isEditingNote={editingNote === periodKey(period)}
              noteText={noteText}
              onToggle={() =>
                setExpanded(expanded === periodKey(period) ? null : periodKey(period))
              }
              onEditStart={() => {
                setEditingNote(periodKey(period));
                setNoteText(notes[periodKey(period)]?.note ?? '');
              }}
              onEditCancel={() => setEditingNote(null)}
              onEditSave={async () => {
                await saveNote(periodKey(period), { note: noteText, dismissed: false });
                setEditingNote(null);
              }}
              onNoteTextChange={setNoteText}
              onDismiss={() =>
                saveNote(periodKey(period), {
                  note: notes[periodKey(period)]?.note,
                  dismissed: true,
                })
              }
            />
          ))}

          {/* Dismissed periods */}
          {showDismissed &&
            dismissed.map((period) => (
              <PeriodRow
                key={periodKey(period)}
                period={period}
                note={notes[periodKey(period)]}
                isDismissed
                isExpanded={expanded === periodKey(period)}
                isEditingNote={editingNote === periodKey(period)}
                noteText={noteText}
                onToggle={() =>
                  setExpanded(expanded === periodKey(period) ? null : periodKey(period))
                }
                onEditStart={() => {
                  setEditingNote(periodKey(period));
                  setNoteText(notes[periodKey(period)]?.note ?? '');
                }}
                onEditCancel={() => setEditingNote(null)}
                onEditSave={async () => {
                  await saveNote(periodKey(period), { note: noteText, dismissed: true });
                  setEditingNote(null);
                }}
                onNoteTextChange={setNoteText}
                onRestore={() =>
                  saveNote(periodKey(period), {
                    note: notes[periodKey(period)]?.note,
                    dismissed: false,
                  })
                }
              />
            ))}
        </div>
      )}

      {canExpand && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full py-2 text-[11px] text-surface-500 hover:text-accent-400 bg-surface-100/30 border-t border-border/20 transition-colors font-medium"
        >
          Show all {sorted.length} periods
        </button>
      )}
    </div>
  );
}

function PeriodRow({
  period,
  note,
  isDismissed,
  isExpanded,
  isEditingNote,
  noteText,
  onToggle,
  onEditStart,
  onEditCancel,
  onEditSave,
  onNoteTextChange,
  onDismiss,
  onRestore,
}: {
  period: IllnessPeriod;
  note?: { note?: string; dismissed?: boolean };
  isDismissed?: boolean;
  isExpanded: boolean;
  isEditingNote: boolean;
  noteText: string;
  onToggle: () => void;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onNoteTextChange: (text: string) => void;
  onDismiss?: () => void;
  onRestore?: () => void;
}) {
  const ConfidenceIcon = period.confidence === 'likely' ? ShieldAlert : AlertTriangle;
  const confidenceColor = period.confidence === 'likely' ? 'text-rose-400' : 'text-amber-400';
  const confidenceBg = period.confidence === 'likely' ? 'bg-rose-500/10' : 'bg-amber-500/10';

  return (
    <div className={isDismissed ? 'opacity-50' : ''}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-100/30 transition-colors"
      >
        <div
          className={`w-8 h-8 rounded-lg ${confidenceBg} flex items-center justify-center flex-shrink-0`}
        >
          <ConfidenceIcon className={`w-4 h-4 ${confidenceColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-surface-950">
              {formatDateRange(period.startDate, period.endDate)}
            </span>
            <span
              className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${
                period.confidence === 'likely'
                  ? 'bg-rose-500/10 text-rose-400'
                  : 'bg-amber-500/10 text-amber-400'
              }`}
            >
              {period.confidence}
            </span>
            {note?.note && <MessageSquare className="w-3 h-3 text-accent-400" />}
          </div>
          <div className="text-[11px] text-surface-600 mt-0.5">
            {period.durationDays} day{period.durationDays === 1 ? '' : 's'} &middot;{' '}
            {period.peakSignals} peak signals
            {note?.note && <span className="text-surface-500 ml-1">— {note.note}</span>}
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-surface-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-surface-500 flex-shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 pl-[60px] space-y-3">
          {/* Signals */}
          <div>
            <div className="text-[11px] text-surface-600 uppercase font-semibold mb-1.5">
              Signals detected
            </div>
            <ul className="space-y-1">
              {period.signals.map((signal, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-surface-700">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-rose-400" />
                  <span className="font-mono">{signal}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Note editing */}
          {isEditingNote ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={(e) => onNoteTextChange(e.target.value)}
                placeholder="Add a note (e.g. 'confirmed flu', 'false positive - travel')..."
                className="flex-1 h-7 rounded-md border border-border bg-surface-0 px-2 text-xs text-surface-950 placeholder:text-surface-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onEditSave();
                  if (e.key === 'Escape') onEditCancel();
                }}
              />
              <Button variant="ghost" size="xs" onClick={onEditSave}>
                <Check className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="xs" onClick={onEditCancel}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={onEditStart}
                className="gap-1 text-surface-500"
              >
                <Pencil className="w-3 h-3" />
                {note?.note ? 'Edit note' : 'Add note'}
              </Button>
              {isDismissed && onRestore ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={onRestore}
                  className="gap-1 text-surface-500"
                >
                  <Eye className="w-3 h-3" />
                  Restore
                </Button>
              ) : onDismiss ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={onDismiss}
                  className="gap-1 text-surface-500"
                >
                  <EyeOff className="w-3 h-3" />
                  Dismiss
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
