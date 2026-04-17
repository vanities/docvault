// Health Sickness view — per-person illness log.
//
// Combines two streams:
//   1. User-logged sickness episodes (manual, structured) — CRUD via the
//      /api/health/:personId/sickness endpoints. Category, severity,
//      start/end dates, symptoms, medications, notes.
//   2. Auto-detected illness periods from apple-health-snapshots.ts,
//      displayed inline via the existing <IllnessTimeline> component so
//      wearable-flagged periods and user-logged episodes sit side-by-side.
//
// Mobile-first layout: stacked cards by default, `sm:` breakpoints only
// where more horizontal space is genuinely useful.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Calendar,
  ChevronDown,
  ChevronUp,
  Pill,
  Plus,
  Thermometer,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAppContext } from '../../contexts/AppContext';
import { useHealthApi } from './useHealthApi';
import { IllnessTimeline, type IllnessNoteMap } from './IllnessTimeline';
import type {
  IllnessPeriod,
  MedicationDose,
  PersonSnapshots,
  SicknessCategory,
  SicknessLog,
  SicknessSeverity,
} from './types';

const CATEGORIES: { key: SicknessCategory; label: string; emoji: string }[] = [
  { key: 'cold', label: 'Cold', emoji: '🤧' },
  { key: 'flu', label: 'Flu', emoji: '🤒' },
  { key: 'covid', label: 'COVID', emoji: '😷' },
  { key: 'allergies', label: 'Allergies', emoji: '🌾' },
  { key: 'sinus', label: 'Sinus', emoji: '👃' },
  { key: 'stomach', label: 'Stomach', emoji: '🤢' },
  { key: 'injury', label: 'Injury', emoji: '🩹' },
  { key: 'migraine', label: 'Migraine', emoji: '🌀' },
  { key: 'other', label: 'Other', emoji: '❓' },
];

const SEVERITIES: { key: SicknessSeverity; label: string; accent: string }[] = [
  {
    key: 'mild',
    label: 'Mild',
    accent: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40',
  },
  {
    key: 'moderate',
    label: 'Moderate',
    accent: 'bg-amber-500/10 text-amber-400 border-amber-500/40',
  },
  { key: 'severe', label: 'Severe', accent: 'bg-rose-500/10 text-rose-400 border-rose-500/40' },
];

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function HealthSicknessView() {
  const { selectedHealthPersonId } = useAppContext();
  const api = useHealthApi();

  const [logs, setLogs] = useState<SicknessLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingLog, setEditingLog] = useState<SicknessLog | null>(null);
  const [illnessPeriods, setIllnessPeriods] = useState<IllnessPeriod[]>([]);
  const [illnessNotes, setIllnessNotes] = useState<IllnessNoteMap>({});

  const load = useCallback(async () => {
    if (!selectedHealthPersonId) return;
    setLoading(true);
    setError(null);
    try {
      const [sicknessRes, snapshot] = await Promise.all([
        api.listSickness(selectedHealthPersonId),
        api.getSnapshot(selectedHealthPersonId, 'all').catch(() => null),
      ]);
      setLogs(sicknessRes);
      if (snapshot?.data) {
        const d = snapshot.data as PersonSnapshots;
        setIllnessPeriods(d.illnessPeriods ?? []);
        setIllnessNotes(snapshot.illnessNotes ?? {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, selectedHealthPersonId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(
    async (input: Omit<SicknessLog, 'id' | 'personId' | 'createdAt' | 'updatedAt'>) => {
      if (!selectedHealthPersonId) return;
      try {
        await api.createSickness(selectedHealthPersonId, input);
        setShowCreate(false);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, selectedHealthPersonId, load]
  );

  const handleUpdate = useCallback(
    async (id: string, input: Partial<SicknessLog>) => {
      if (!selectedHealthPersonId) return;
      try {
        await api.updateSickness(selectedHealthPersonId, id, input);
        setEditingLog(null);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, selectedHealthPersonId, load]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!selectedHealthPersonId) return;
      if (!confirm('Delete this sickness log?')) return;
      try {
        await api.deleteSickness(selectedHealthPersonId, id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, selectedHealthPersonId, load]
  );

  const activeLogs = useMemo(() => logs.filter((l) => !l.endDate), [logs]);
  const resolvedLogs = useMemo(() => logs.filter((l) => l.endDate), [logs]);

  if (!selectedHealthPersonId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Card variant="glass" className="rounded-2xl p-8 max-w-md text-center">
          <Thermometer className="w-8 h-8 text-surface-600 mx-auto mb-4" />
          <h2 className="font-display italic text-xl text-surface-950 mb-2">No person selected</h2>
          <p className="text-sm text-surface-700">
            Pick a person from the Health Overview to open their sickness log.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-10 space-y-6">
        {/* Header */}
        <header className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display italic text-3xl md:text-4xl text-surface-950 leading-tight">
                Sickness Log
              </h1>
              <p className="text-xs md:text-sm text-surface-700 mt-1 max-w-xl">
                Track illness episodes with symptoms, medications, and notes. Wearable-detected
                periods appear below — link your notes to them so future analyses can connect cause
                and effect.
              </p>
            </div>
            <Button onClick={() => setShowCreate(true)} size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              New log
            </Button>
          </div>
        </header>

        {error && (
          <Card variant="glass" className="rounded-xl p-4 border border-rose-500/30 bg-rose-500/5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-rose-400">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-surface-600 hover:text-surface-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </Card>
        )}

        {showCreate && (
          <SicknessForm onCancel={() => setShowCreate(false)} onSubmit={handleCreate} />
        )}

        {editingLog && (
          <SicknessForm
            initial={editingLog}
            onCancel={() => setEditingLog(null)}
            onSubmit={(input) => handleUpdate(editingLog.id, input)}
          />
        )}

        {/* Active episodes */}
        {activeLogs.length > 0 && (
          <section>
            <SectionTitle
              title="Active episodes"
              count={activeLogs.length}
              accent="text-rose-400"
            />
            <div className="mt-3 space-y-3">
              {activeLogs.map((l) => (
                <SicknessCard
                  key={l.id}
                  log={l}
                  onEdit={() => setEditingLog(l)}
                  onDelete={() => handleDelete(l.id)}
                  onResolve={() => handleUpdate(l.id, { endDate: todayISO() })}
                />
              ))}
            </div>
          </section>
        )}

        {/* Auto-detected wearable illness periods */}
        {selectedHealthPersonId && illnessPeriods.length > 0 && (
          <section>
            <SectionTitle
              title="Wearable-detected illness periods"
              count={illnessPeriods.length}
              accent="text-amber-400"
            />
            <div className="mt-3">
              <IllnessTimeline
                periods={illnessPeriods}
                personId={selectedHealthPersonId}
                notes={illnessNotes}
                onNotesChange={setIllnessNotes}
              />
            </div>
          </section>
        )}

        {/* Resolved logs */}
        {resolvedLogs.length > 0 && (
          <section>
            <SectionTitle title="Resolved" count={resolvedLogs.length} accent="text-surface-600" />
            <div className="mt-3 space-y-3">
              {resolvedLogs.map((l) => (
                <SicknessCard
                  key={l.id}
                  log={l}
                  onEdit={() => setEditingLog(l)}
                  onDelete={() => handleDelete(l.id)}
                  muted
                />
              ))}
            </div>
          </section>
        )}

        {!loading && logs.length === 0 && illnessPeriods.length === 0 && (
          <Card variant="glass" className="rounded-2xl p-8 md:p-10 text-center space-y-3">
            <Activity className="w-8 h-8 text-surface-600 mx-auto" />
            <h2 className="font-display italic text-xl text-surface-950">No sickness logged</h2>
            <p className="text-sm text-surface-700 max-w-md mx-auto">
              Log an episode when you get sick so future analyses can connect the dots between
              symptoms, medications, and what the wearable flagged.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function SectionTitle({ title, count, accent }: { title: string; count: number; accent: string }) {
  return (
    <div className="flex items-baseline gap-2 px-1">
      <h3 className="font-display italic text-lg text-surface-950">{title}</h3>
      <span className={`text-xs font-mono ${accent}`}>({count})</span>
    </div>
  );
}

function SicknessCard({
  log,
  onEdit,
  onDelete,
  onResolve,
  muted,
}: {
  log: SicknessLog;
  onEdit: () => void;
  onDelete: () => void;
  onResolve?: () => void;
  muted?: boolean;
}) {
  const [expanded, setExpanded] = useState(!log.endDate); // active episodes default-expanded
  const cat = CATEGORIES.find((c) => c.key === log.category);
  const sev = SEVERITIES.find((s) => s.key === log.severity);
  const range = log.endDate ? `${log.startDate} → ${log.endDate}` : `${log.startDate} → ongoing`;
  const duration = log.endDate
    ? Math.max(
        1,
        Math.round(
          (new Date(log.endDate).getTime() - new Date(log.startDate).getTime()) / 86_400_000
        ) + 1
      )
    : null;

  return (
    <Card
      variant="glass"
      className={`rounded-xl p-4 md:p-5 ${muted ? 'opacity-80' : ''} ${!log.endDate ? 'border-l-4 border-l-rose-400/50' : ''}`}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className="text-2xl leading-none flex-shrink-0">{cat?.emoji ?? '❓'}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm md:text-base font-medium text-surface-950">{log.title}</h4>
            {sev && (
              <span
                className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded border ${sev.accent}`}
              >
                {sev.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-surface-700 mt-1 flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {range}
            </span>
            {duration && <span>· {duration}d</span>}
            <span className="text-surface-600">· {cat?.label ?? log.category}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
          {onResolve && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onResolve}
              title="Mark resolved (end date = today)"
              className="text-[11px]"
            >
              Resolve
            </Button>
          )}
          <button
            onClick={onEdit}
            className="p-1.5 text-xs text-surface-700 hover:text-surface-950 hover:bg-surface-100/50 rounded-lg"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-surface-700 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg"
            title="Delete log"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 text-surface-700 hover:text-accent-400 rounded-lg"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 pt-3 border-t border-surface-200/40">
          {log.symptoms.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-surface-600 font-semibold mb-1.5">
                Symptoms
              </div>
              <div className="flex flex-wrap gap-1.5">
                {log.symptoms.map((s, i) => (
                  <span
                    key={i}
                    className="text-xs text-surface-800 bg-surface-100/60 border border-surface-200/50 px-2 py-0.5 rounded-full"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {log.medications.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-surface-600 font-semibold mb-1.5 flex items-center gap-1.5">
                <Pill className="w-3 h-3" />
                Medications
              </div>
              <ul className="text-xs text-surface-800 space-y-1">
                {log.medications.map((m, i) => (
                  <li key={i}>
                    <span className="text-surface-950 font-medium">{m.name}</span>
                    {m.doseText && <span className="text-surface-700"> · {m.doseText}</span>}
                    {m.count != null && <span className="text-surface-600"> · ×{m.count}</span>}
                    {m.notes && <span className="text-surface-600 italic"> — {m.notes}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {log.notes && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-surface-600 font-semibold mb-1.5">
                Notes
              </div>
              <p className="text-xs text-surface-800 whitespace-pre-wrap leading-relaxed">
                {log.notes}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create / edit form (shared)
// ---------------------------------------------------------------------------

function SicknessForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: SicknessLog;
  onCancel: () => void;
  onSubmit: (
    input: Omit<SicknessLog, 'id' | 'personId' | 'createdAt' | 'updatedAt'>
  ) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [category, setCategory] = useState<SicknessCategory>(initial?.category ?? 'other');
  const [severity, setSeverity] = useState<SicknessSeverity>(initial?.severity ?? 'mild');
  const [symptoms, setSymptoms] = useState(initial?.symptoms.join(', ') ?? '');
  const [medications, setMedications] = useState<MedicationDose[]>(initial?.medications ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const addMed = () =>
    setMedications([...medications, { name: '', doseText: '', count: undefined }]);
  const updateMed = (i: number, patch: Partial<MedicationDose>) => {
    setMedications(medications.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };
  const removeMed = (i: number) => setMedications(medications.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!title.trim()) return;
    await onSubmit({
      title: title.trim(),
      startDate,
      endDate: endDate.trim() || undefined,
      category,
      severity,
      symptoms: symptoms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      medications: medications.filter((m) => m.name.trim()),
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Card
      variant="glass"
      className="rounded-2xl p-4 md:p-6 border-2 border-accent-400/30 bg-accent-500/5"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="font-display italic text-xl text-surface-950">
          {initial ? 'Edit sickness log' : 'Log a new sickness'}
        </h3>
        <button
          onClick={onCancel}
          className="p-1.5 text-surface-700 hover:text-surface-950 rounded-lg"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4">
        {/* Title */}
        <FormField label="Title">
          <input
            type="text"
            placeholder="e.g. Spring sinus congestion"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-surface-0 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
            autoFocus
          />
        </FormField>

        {/* Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface-0 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
            />
          </FormField>
          <FormField label="End date (leave blank if ongoing)">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface-0 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
            />
          </FormField>
        </div>

        {/* Category + severity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Category">
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                    category === c.key
                      ? 'bg-accent-500/10 text-accent-400 border-accent-500/40'
                      : 'border-surface-200/50 text-surface-700 hover:bg-surface-100/50'
                  }`}
                >
                  {c.emoji} {c.label}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Severity">
            <div className="flex gap-1.5">
              {SEVERITIES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSeverity(s.key)}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    severity === s.key
                      ? s.accent
                      : 'border-surface-200/50 text-surface-700 hover:bg-surface-100/50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </FormField>
        </div>

        {/* Symptoms */}
        <FormField label="Symptoms (comma-separated)">
          <input
            type="text"
            placeholder="congestion, fatigue, headache"
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-surface-0 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
          />
        </FormField>

        {/* Medications */}
        <FormField label="Medications">
          <div className="space-y-2">
            {medications.map((m, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  type="text"
                  placeholder="Name (e.g. Claritin-D)"
                  value={m.name}
                  onChange={(e) => updateMed(i, { name: e.target.value })}
                  className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-surface-0 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
                />
                <input
                  type="text"
                  placeholder="Dose (12hr)"
                  value={m.doseText ?? ''}
                  onChange={(e) => updateMed(i, { doseText: e.target.value })}
                  className="w-24 px-2 py-1.5 text-sm bg-surface-0 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
                />
                <input
                  type="number"
                  placeholder="#"
                  value={m.count ?? ''}
                  onChange={(e) =>
                    updateMed(i, {
                      count: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                  className="w-16 px-2 py-1.5 text-sm bg-surface-0 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
                />
                <button
                  type="button"
                  onClick={() => removeMed(i)}
                  className="p-1.5 text-surface-600 hover:text-rose-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={addMed}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add medication
            </Button>
          </div>
        </FormField>

        {/* Notes */}
        <FormField label="Notes">
          <textarea
            rows={3}
            placeholder="Context, triggers, patterns, how you felt..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-surface-0 border border-surface-200/50 rounded-lg resize-y focus:outline-none focus:border-accent-400/50"
          />
        </FormField>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!title.trim()}>
            {initial ? 'Save' : 'Log sickness'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-surface-800 uppercase tracking-[0.18em] mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
