import { useState } from 'react';
import { Bell, Check, X, Plus, CalendarClock, Repeat } from 'lucide-react';
import { useAppContext } from '../../contexts/AppContext';
import type { Reminder } from '../../types';

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDueDate(dateStr: string): string {
  const days = daysUntil(dateStr);
  const date = new Date(dateStr + 'T00:00:00');
  const formatted = date.toLocaleDateString('en-US', {
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

function urgencyColor(
  dateStr: string,
  status: string
): { bg: string; text: string; border: string; dot: string } {
  if (status === 'completed')
    return {
      bg: 'bg-emerald-500/8',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
      dot: 'bg-emerald-400',
    };
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

function ReminderRow({
  reminder,
  entityName,
  onComplete,
  onDismiss,
}: {
  reminder: Reminder;
  entityName: string;
  onComplete: () => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const colors = urgencyColor(reminder.dueDate, reminder.status);

  const handleComplete = async () => {
    if (isBusy) return;
    setIsBusy(true);
    await onComplete();
    setIsBusy(false);
  };

  const handleDismiss = async () => {
    if (isBusy) return;
    setIsBusy(true);
    await onDismiss();
    setIsBusy(false);
  };

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg ${colors.bg} border ${colors.border} transition-all ${isBusy ? 'opacity-50' : ''}`}
    >
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[13px] font-medium ${colors.text}`}>{reminder.title}</span>
          {reminder.recurrence && (
            <Repeat
              className="w-3 h-3 text-surface-600 flex-shrink-0"
              title={`Repeats ${reminder.recurrence}`}
            />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-surface-600">{entityName}</span>
          <span className="text-[11px] text-surface-500">·</span>
          <span className={`text-[11px] ${colors.text}`}>{formatDueDate(reminder.dueDate)}</span>
          {reminder.notes && (
            <>
              <span className="text-[11px] text-surface-500">·</span>
              <span className="text-[11px] text-surface-600 truncate">{reminder.notes}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={handleComplete}
          disabled={isBusy}
          className="p-1 rounded-md hover:bg-emerald-500/15 text-surface-600 hover:text-emerald-400 transition-colors disabled:opacity-40"
          title="Mark complete"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleDismiss}
          disabled={isBusy}
          className="p-1 rounded-md hover:bg-red-500/10 text-surface-600 hover:text-red-400 transition-colors disabled:opacity-40"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ReminderBanner() {
  const { reminders, entities, selectedEntity, updateReminder, addReminder } = useAppContext();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newRecurrence, setNewRecurrence] = useState<string>('');
  const [newNotes, setNewNotes] = useState('');

  // Filter to active reminders: pending, matching entity, and due within 60 days (or overdue)
  const activeReminders = reminders
    .filter((r) => r.status === 'pending')
    .filter((r) => selectedEntity === 'all' || r.entityId === selectedEntity)
    .filter((r) => daysUntil(r.dueDate) <= 60)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const handleComplete = async (id: string) => {
    await updateReminder(id, { status: 'completed' });
  };

  const handleDismiss = async (id: string) => {
    await updateReminder(id, { status: 'dismissed' });
  };

  const handleAdd = async () => {
    if (!newTitle || !newDate || selectedEntity === 'all') return;
    await addReminder({
      entityId: selectedEntity,
      title: newTitle,
      dueDate: newDate,
      recurrence: (newRecurrence as Reminder['recurrence']) || null,
      notes: newNotes || undefined,
    });
    setNewTitle('');
    setNewDate('');
    setNewRecurrence('');
    setNewNotes('');
    setShowAddForm(false);
  };

  if (activeReminders.length === 0 && !showAddForm) {
    // Show a subtle add button
    if (selectedEntity !== 'all') {
      return (
        <div className="mb-4">
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 text-[12px] text-surface-600 hover:text-surface-800 transition-colors"
          >
            <Bell className="w-3.5 h-3.5" />
            Add reminder
          </button>
        </div>
      );
    }
    return null;
  }

  const getEntityName = (entityId: string) => {
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
          {activeReminders.length > 0 && (
            <span className="text-[11px] bg-accent-500/15 text-accent-400 px-1.5 py-0.5 rounded-full font-medium">
              {activeReminders.length}
            </span>
          )}
        </div>
        {selectedEntity !== 'all' && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1 text-[12px] text-surface-600 hover:text-accent-400 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {activeReminders.map((r) => (
          <ReminderRow
            key={r.id}
            reminder={r}
            entityName={getEntityName(r.entityId)}
            onComplete={() => handleComplete(r.id)}
            onDismiss={() => handleDismiss(r.id)}
          />
        ))}
      </div>

      {/* Add Reminder Form */}
      {showAddForm && (
        <div className="mt-2 p-3 rounded-lg bg-surface-200/30 border border-surface-400/20">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="text"
              placeholder="Reminder title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="col-span-2 px-2.5 py-1.5 bg-surface-100 border border-surface-400/30 rounded-lg text-[13px] text-surface-900 placeholder:text-surface-500"
            />
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="px-2.5 py-1.5 bg-surface-100 border border-surface-400/30 rounded-lg text-[13px] text-surface-900"
            />
            <select
              value={newRecurrence}
              onChange={(e) => setNewRecurrence(e.target.value)}
              className="px-2.5 py-1.5 bg-surface-100 border border-surface-400/30 rounded-lg text-[13px] text-surface-900"
            >
              <option value="">One-time</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
            <input
              type="text"
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="col-span-2 px-2.5 py-1.5 bg-surface-100 border border-surface-400/30 rounded-lg text-[13px] text-surface-900 placeholder:text-surface-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-[12px] text-surface-700 hover:bg-surface-300/30 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newTitle || !newDate}
              className="px-3 py-1.5 text-[12px] font-medium text-accent-400 bg-accent-500/10 hover:bg-accent-500/15 rounded-lg transition-colors disabled:opacity-40"
            >
              Add Reminder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
