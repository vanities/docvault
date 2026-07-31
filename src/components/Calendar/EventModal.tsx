// Create/edit dialog for calendar events. Kind picks the form shape:
// birthday (implicitly yearly, optional birth year for "turns N"), task
// (completable, optional recurrence with fixed vs after-completion
// anchoring), event (a date, optionally recurring, never completable).

import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SETTINGS_COLOR_MAP } from '../../utils/entityDisplay';
import type { EntityConfig } from '../../hooks/useFileSystemServer';
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventKind,
  RecurrenceAnchor,
  RecurrenceUnit,
} from './types';

export interface EventModalState {
  mode: 'create' | 'edit';
  event?: CalendarEvent;
  defaultDate?: string;
}

interface EventModalProps {
  state: EventModalState | null;
  entities: EntityConfig[];
  onClose: () => void;
  onSave: (input: CalendarEventInput, eventId?: string) => Promise<void>;
  onDelete: (eventId: string) => Promise<void>;
}

const FIELD_LABEL = 'text-xs font-medium text-surface-700 uppercase tracking-wide';

export function EventModal({ state, entities, onClose, onSave, onDelete }: EventModalProps) {
  const [kind, setKind] = useState<CalendarEventKind>('task');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [birthYearInput, setBirthYearInput] = useState('');
  const [repeats, setRepeats] = useState(false);
  const [interval, setInterval] = useState('1');
  const [unit, setUnit] = useState<RecurrenceUnit>('month');
  const [anchor, setAnchor] = useState<RecurrenceAnchor>('fixed');
  const [entityId, setEntityId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = state !== null;
  const editing = state?.mode === 'edit' ? state.event : undefined;

  useEffect(() => {
    if (!state) return;
    const ev = state.mode === 'edit' ? state.event : undefined;
    setKind(ev?.kind ?? 'task');
    setTitle(ev?.title ?? '');
    setDate(ev?.date ?? state.defaultDate ?? '');
    setBirthYearInput(ev?.birthYear !== undefined ? String(ev.birthYear) : '');
    setRepeats(Boolean(ev?.recurrence));
    setInterval(ev?.recurrence ? String(ev.recurrence.interval) : '1');
    setUnit(ev?.recurrence?.unit ?? 'month');
    setAnchor(ev?.recurrence?.anchor ?? 'fixed');
    setEntityId(ev?.entityId ?? '');
    setNotes(ev?.notes ?? '');
    setSubmitting(false);
    setConfirmDelete(false);
    setError(null);
  }, [state]);

  // Birthdays parse the birth year straight off the date when present.
  useEffect(() => {
    if (kind === 'birthday' && date && !editing) {
      const year = Number(date.slice(0, 4));
      const currentYear = new Date().getFullYear();
      if (year >= 1900 && year <= currentYear) setBirthYearInput(String(year));
    }
  }, [kind, date, editing]);

  const canSave = title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && !submitting;

  const handleSave = async () => {
    if (!canSave || !state) return;
    setSubmitting(true);
    setError(null);
    const birthYear = birthYearInput.trim() ? Number(birthYearInput.trim()) : null;
    const input: CalendarEventInput = {
      kind,
      title: title.trim(),
      date,
      recurrence:
        kind !== 'birthday' && repeats
          ? {
              interval: Math.max(1, Number(interval) || 1),
              unit,
              anchor: kind === 'task' ? anchor : 'fixed',
            }
          : null,
      birthYear: kind === 'birthday' ? birthYear : null,
      entityId: entityId || null,
      notes: notes.trim() || null,
    };
    try {
      await onSave(input, editing?.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event');
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setSubmitting(true);
    try {
      await onDelete(editing.id);
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event');
      setSubmitting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Event' : 'New Event'}</DialogTitle>
            <DialogDescription>
              Birthdays repeat yearly on their date. Tasks can repeat on a fixed schedule or from
              each completion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editing && (
              <div>
                <div className={`${FIELD_LABEL} mb-1.5`}>Type</div>
                <Select value={kind} onValueChange={(v) => setKind(v as CalendarEventKind)}>
                  <SelectTrigger className="text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task">Task — completable, can recur</SelectItem>
                    <SelectItem value="birthday">Birthday — yearly, shows age</SelectItem>
                    <SelectItem value="event">Event — a date to remember</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label htmlFor="calendar-event-title" className={FIELD_LABEL}>
                Title
              </label>
              <Input
                id="calendar-event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === 'birthday' ? 'e.g. Alex' : 'e.g. Replace HVAC filter'}
                autoFocus
                className="mt-1.5"
                disabled={submitting}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSave();
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="calendar-event-date" className={FIELD_LABEL}>
                  {kind === 'birthday' ? 'Birth date' : kind === 'task' ? 'First due' : 'Date'}
                </label>
                <Input
                  id="calendar-event-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1.5"
                  disabled={submitting}
                />
              </div>
              {kind === 'birthday' && (
                <div>
                  <label htmlFor="calendar-event-birthyear" className={FIELD_LABEL}>
                    Birth year
                  </label>
                  <Input
                    id="calendar-event-birthyear"
                    type="number"
                    value={birthYearInput}
                    onChange={(e) => setBirthYearInput(e.target.value)}
                    placeholder="for “turns N”"
                    className="mt-1.5"
                    disabled={submitting}
                  />
                </div>
              )}
            </div>

            {kind !== 'birthday' && (
              <div className="rounded-lg border border-border-subtle p-3 space-y-3">
                <label className="flex items-center gap-2 text-[13px] text-surface-900">
                  <input
                    type="checkbox"
                    checked={repeats}
                    onChange={(e) => setRepeats(e.target.checked)}
                    disabled={submitting}
                    className="accent-emerald-500"
                  />
                  Repeats
                </label>
                {repeats && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-surface-600">every</span>
                      <Input
                        type="number"
                        min={1}
                        value={interval}
                        onChange={(e) => setInterval(e.target.value)}
                        className="w-16 text-center"
                        disabled={submitting}
                        aria-label="Repeat interval"
                      />
                      <Select value={unit} onValueChange={(v) => setUnit(v as RecurrenceUnit)}>
                        <SelectTrigger className="text-[13px] flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="day">day(s)</SelectItem>
                          <SelectItem value="week">week(s)</SelectItem>
                          <SelectItem value="month">month(s)</SelectItem>
                          <SelectItem value="year">year(s)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {kind === 'task' && (
                      <div>
                        <Select
                          value={anchor}
                          onValueChange={(v) => setAnchor(v as RecurrenceAnchor)}
                        >
                          <SelectTrigger className="text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixed">On a fixed schedule</SelectItem>
                            <SelectItem value="afterCompletion">After each completion</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-surface-600 mt-1.5 leading-relaxed">
                          {anchor === 'afterCompletion'
                            ? 'The next due date counts from the day you check it off — right for maintenance chores.'
                            : 'Occurrences stay on schedule no matter when you complete them — right for deadlines.'}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div>
              <div className={`${FIELD_LABEL} mb-1.5`}>Entity tag (optional)</div>
              <Select
                value={entityId || 'none'}
                onValueChange={(v) => setEntityId(v === 'none' ? '' : v)}
              >
                <SelectTrigger className="text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {entities.map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            SETTINGS_COLOR_MAP[entity.color]?.bg ?? 'bg-surface-500/40'
                          } ${SETTINGS_COLOR_MAP[entity.color]?.border ?? ''} border`}
                        />
                        {entity.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="calendar-event-notes" className={FIELD_LABEL}>
                Notes (optional)
              </label>
              <Textarea
                id="calendar-event-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1.5"
                disabled={submitting}
              />
            </div>

            {error && <p className="text-[12px] text-red-400">{error}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            {editing && (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={submitting}
                className="mr-auto text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Saving…
                </>
              ) : editing ? (
                'Save'
              ) : (
                'Create'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{editing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the event and its completion history. Recurring tasks lose
              all past check-offs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-red-600 hover:bg-red-500 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
