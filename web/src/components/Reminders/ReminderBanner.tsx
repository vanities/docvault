// Upcoming-deadlines banner shown in TaxYearView and BusinessDocsView.
// Reads projected calendar occurrences (the reminders system now lives in
// the calendar store) filtered to the selected entity and the next 60 days,
// plus anything overdue. Complete = calendar completion; Dismiss = a
// completion with skipped:true (recurrence still advances). The inline add
// form creates a calendar task tagged with the selected entity.

import { useState } from 'react';
import { Bell, Check, X, Plus, CalendarClock, Repeat } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { daysUntil, parseISODate, todayISO, toISODate } from '../Calendar/calendarMath';
import { useCalendarApi, useOccurrences } from '../Calendar/useCalendarApi';
import type { CalendarRecurrence, Occurrence } from '../Calendar/types';

function formatDueDate(dateStr: string): string {
  const days = daysUntil(dateStr);
  const formatted = parseISODate(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (days < 0) return `${formatted} (${Math.abs(days)}d overdue)`;
  if (days === 0) return `${formatted} (today!)`;
  if (days === 1) return `${formatted} (tomorrow)`;
  if (days <= 30) return `${formatted} (${days}d)`;
  return formatted;
}

function urgencyColor(dateStr: string): { bg: string; text: string; border: string; dot: string } {
  const days = daysUntil(dateStr);
  if (days < 0)
    return {
      bg: 'bg-red-500/10',
      text: 'text-red-400',
      border: 'border-red-500/25',
      dot: 'bg-red-400',
    };
  if (days <= 7)
    return {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/25',
      dot: 'bg-amber-400',
    };
  if (days <= 30)
    return {
      bg: 'bg-blue-500/8',
      text: 'text-blue-400',
      border: 'border-blue-500/20',
      dot: 'bg-blue-400',
    };
  return {
    bg: 'bg-surface-200/30',
    text: 'text-surface-700',
    border: 'border-surface-400/20',
    dot: 'bg-surface-500',
  };
}

const LEGACY_RECURRENCE: Record<string, CalendarRecurrence> = {
  monthly: { interval: 1, unit: 'month', anchor: 'fixed' },
  quarterly: { interval: 3, unit: 'month', anchor: 'fixed' },
  yearly: { interval: 1, unit: 'year', anchor: 'fixed' },
};

/** Auto-record an estimated tax payment when completing an estimated-tax
 * occurrence: derive quarter + tax year from the due date and append a
 * quarterly payment to /api/estimated-taxes/personal/:year. */
async function recordEstimatedTaxPayment(occ: Occurrence): Promise<void> {
  try {
    const dueDate = parseISODate(occ.date);
    const month = dueDate.getMonth() + 1; // 1-indexed
    let quarter: 1 | 2 | 3 | 4;
    let taxYear: number;
    if (month === 1) {
      // Jan 15 = Q4 of prior year
      quarter = 4;
      taxYear = dueDate.getFullYear() - 1;
    } else if (month <= 4) {
      quarter = 1;
      taxYear = dueDate.getFullYear();
    } else if (month <= 6) {
      quarter = 2;
      taxYear = dueDate.getFullYear();
    } else {
      quarter = 3;
      taxYear = dueDate.getFullYear();
    }

    const res = await fetch(`/api/estimated-taxes/personal/${taxYear}`);
    const data = await res.json();
    const payments = data.payments || [];
    const config = data.config || { annualTarget: 0 };

    if (config.annualTarget > 0) {
      payments.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        date: todayISO(),
        quarter,
        amount: config.annualTarget / 4,
      });
      await fetch(`/api/estimated-taxes/personal/${taxYear}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payments, config }),
      });
    }
  } catch {
    // Silently fail — the occurrence is already completed
  }
}

function ReminderRow({
  occ,
  entityName,
  onComplete,
  onDismiss,
}: {
  occ: Occurrence;
  entityName: string;
  onComplete: () => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const colors = urgencyColor(occ.date);

  const run = async (fn: () => Promise<void>) => {
    if (isBusy) return;
    setIsBusy(true);
    await fn();
    setIsBusy(false);
  };

  return (
    <div
      className={`flex items-start gap-2 sm:gap-3 px-3 py-2 rounded-lg ${colors.bg} border ${colors.border} transition-all ${isBusy ? 'opacity-50' : ''}`}
    >
      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${colors.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className={`text-[13px] font-medium truncate ${colors.text}`}>{occ.title}</span>
          {occ.recurrenceLabel !== 'one-off' && (
            <span title={`Repeats ${occ.recurrenceLabel}`}>
              <Repeat className="w-3 h-3 text-surface-600 flex-shrink-0" />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
          <span className="text-[11px] text-surface-600">{entityName}</span>
          <span className="text-[11px] text-surface-500">·</span>
          <span className={`text-[11px] whitespace-nowrap ${colors.text}`}>
            {formatDueDate(occ.date)}
          </span>
          {occ.notes && (
            <>
              <span className="text-[11px] text-surface-500 hidden sm:inline">·</span>
              <span className="text-[11px] text-surface-600 truncate max-w-[200px] sm:max-w-none">
                {occ.notes}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void run(onComplete)}
          disabled={isBusy}
          className="hover:bg-emerald-500/15 text-surface-600 hover:text-emerald-400"
          title="Mark complete"
        >
          <Check className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void run(onDismiss)}
          disabled={isBusy}
          className="hover:bg-red-500/10 text-surface-600 hover:text-red-400"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function bannerWindow(): { start: string; end: string } {
  const now = new Date();
  return {
    start: toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60)),
    end: toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60)),
  };
}

export function ReminderBanner() {
  const { entities, selectedEntity } = useAppContext();
  const [{ start, end }] = useState(bannerWindow);
  const { occurrences, refetch } = useOccurrences(start, end);
  const api = useCalendarApi();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newRecurrence, setNewRecurrence] = useState<string>('');
  const [newNotes, setNewNotes] = useState('');

  // Pending task occurrences, matching entity, due within 60 days or overdue.
  const activeOccurrences = occurrences
    .filter((o) => o.completable && !o.completed)
    .filter((o) => selectedEntity === 'all' || o.entityId === selectedEntity)
    .filter((o) => daysUntil(o.date) <= 60)
    .sort((a, b) => a.date.localeCompare(b.date));

  const handleComplete = async (occ: Occurrence) => {
    try {
      await api.completeOccurrence(occ.eventId, occ.date);
      if (occ.title.includes('Estimated Tax Payment')) {
        await recordEstimatedTaxPayment(occ);
      }
    } catch {
      // Refetch below re-syncs the banner either way.
    }
    await refetch();
  };

  const handleDismiss = async (occ: Occurrence) => {
    try {
      await api.completeOccurrence(occ.eventId, occ.date, { skipped: true });
    } catch {
      // Refetch below re-syncs the banner either way.
    }
    await refetch();
  };

  const handleAdd = async () => {
    if (!newTitle || !newDate || selectedEntity === 'all') return;
    try {
      await api.createEvent({
        kind: 'task',
        title: newTitle,
        date: newDate,
        recurrence: newRecurrence ? LEGACY_RECURRENCE[newRecurrence] : null,
        entityId: selectedEntity,
        notes: newNotes || null,
      });
    } catch {
      return; // keep the form open so the input isn't lost
    }
    setNewTitle('');
    setNewDate('');
    setNewRecurrence('');
    setNewNotes('');
    setShowAddForm(false);
    await refetch();
  };

  if (activeOccurrences.length === 0 && !showAddForm) {
    // Show a subtle add button
    if (selectedEntity !== 'all') {
      return (
        <div className="mb-4">
          <Button variant="ghost" size="xs" onClick={() => setShowAddForm(true)}>
            <Bell className="w-3.5 h-3.5" />
            Add reminder
          </Button>
        </div>
      );
    }
    return null;
  }

  const getEntityName = (entityId: string | undefined) => {
    if (!entityId) return 'Global';
    return entities.find((e) => e.id === entityId)?.name || entityId;
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-surface-600" />
          <h3 className="text-[12px] font-semibold text-surface-600 uppercase tracking-wider">
            Upcoming Deadlines
          </h3>
          {activeOccurrences.length > 0 && (
            <span className="text-[11px] bg-accent-500/15 text-accent-400 px-1.5 py-0.5 rounded-full font-medium">
              {activeOccurrences.length}
            </span>
          )}
        </div>
        {selectedEntity !== 'all' && (
          <Button variant="ghost" size="xs" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="w-3.5 h-3.5" />
            Add
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {activeOccurrences.map((occ) => (
          <ReminderRow
            key={`${occ.eventId}:${occ.date}`}
            occ={occ}
            entityName={getEntityName(occ.entityId)}
            onComplete={() => handleComplete(occ)}
            onDismiss={() => handleDismiss(occ)}
          />
        ))}
      </div>

      {/* Add Reminder Form */}
      {showAddForm && (
        <div className="mt-2 p-3 rounded-lg bg-surface-200/30 border border-surface-400/20">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <Input
              type="text"
              placeholder="Reminder title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="col-span-2 h-8 text-[13px]"
            />
            <Input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="h-8 text-[13px]"
            />
            <Select
              value={newRecurrence || 'one-time'}
              onValueChange={(val) => setNewRecurrence(val === 'one-time' ? '' : val)}
            >
              <SelectTrigger className="text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one-time">One-time</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="text"
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="col-span-2 h-8 text-[13px]"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="xs" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button size="xs" onClick={() => void handleAdd()} disabled={!newTitle || !newDate}>
              Add Reminder
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
