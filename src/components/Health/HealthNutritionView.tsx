// Nutrition & Supplements view — a per-person regimen ledger with image
// upload + Claude Vision parsing + dose/status tracking. Data flows into
// /api/health-snapshot for LLM consumption.
//
// Designed as a field journal (matches HealthDNAView's "field notebook"
// aesthetic): numbered entries, warm amber/emerald/rose accents, serif
// display headers, typewriter-adjacent body copy. Label cards are pinned
// paper with a category tag stripe along the bottom.
//
// Behavioural principles intentionally applied:
//   - Visual Salience (#2): "Active regimen" block gets warm, high-contrast
//     treatment; browsing categories recede into quieter type.
//   - Chunking / Miller's Law (#25): active entries group by time-of-day
//     (morning / midday / evening / bedtime / workout) so a 10+ item regimen
//     doesn't become an undifferentiated wall.
//   - Hick's Law (#10): status selector is 4 options max, always in the same
//     position on each card; no nested menus.
//   - Default Effect (#32): new uploads land in "considering" automatically —
//     promoting to active requires a deliberate click, which matches the
//     user's mental model of "saw it on Amazon vs. actually taking it daily".
//   - Fitts's Law (#9): upload CTA is large, persistent in the header, and
//     triggered via the whole button surface — no tiny target.
//   - Endowed Progress Effect (#97): header shows a small "regimen health"
//     counter (X active with doses set / Y active total) so adding a dose
//     feels like closing a loop rather than a chore.
//   - Serial Position Effect (#11): active comes first (primacy), past/never
//     last (recency-but-muted). Considering in the middle where it belongs
//     as a true "holding area".
//   - Progressive Disclosure (#24): the detail modal reveals full parsed
//     facts only once opened — cards carry just product name + dose + status.
//   - Peak-End Rule (#117): page ends with a grounding "regimen notes" card
//     rather than silent whitespace.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  Loader2,
  Pill,
  RefreshCw,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Moon,
  Dumbbell,
  Trash2,
  X,
  Camera,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAppContext } from '../../contexts/AppContext';
import { useHealthApi } from './useHealthApi';
import type { NutritionDose, NutritionEntry, NutritionStatus } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_ORDER: NutritionStatus[] = ['active', 'considering', 'past', 'never'];

const STATUS_COPY: Record<NutritionStatus, { label: string; hint: string }> = {
  active: { label: 'Taking', hint: 'daily regimen' },
  considering: { label: 'Considering', hint: 'maybe add later' },
  past: { label: 'Past', hint: 'used to take' },
  never: { label: 'Passed on', hint: 'decided against' },
};

const STATUS_ACCENT: Record<NutritionStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40',
  considering: 'bg-amber-500/10 text-amber-400 border-amber-500/40',
  past: 'bg-surface-200/40 text-surface-700 border-surface-300/50',
  never: 'bg-rose-500/10 text-rose-400 border-rose-500/40',
};

// Time-of-day bucket config — used both for grouping active entries and for
// the iconography that gives each lane a distinct visual identity.
type TimeBucket =
  | 'morning'
  | 'midday'
  | 'evening'
  | 'bedtime'
  | 'pre-workout'
  | 'post-workout'
  | 'unscheduled';

const TIME_BUCKETS: { key: TimeBucket; label: string; icon: LucideIcon; accent: string }[] = [
  { key: 'morning', label: 'Morning', icon: Sunrise, accent: 'text-amber-400' },
  { key: 'midday', label: 'Midday', icon: Sun, accent: 'text-yellow-400' },
  { key: 'pre-workout', label: 'Pre-workout', icon: Dumbbell, accent: 'text-sky-400' },
  { key: 'post-workout', label: 'Post-workout', icon: Dumbbell, accent: 'text-emerald-400' },
  { key: 'evening', label: 'Evening', icon: Sunset, accent: 'text-orange-400' },
  { key: 'bedtime', label: 'Bedtime', icon: Moon, accent: 'text-indigo-400' },
  { key: 'unscheduled', label: 'Unscheduled', icon: Pill, accent: 'text-surface-600' },
];

// Gentle tilt per card to suggest pinned paper — fixed per-card based on id
// so the layout doesn't reshuffle on re-render.
function tiltFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % 7) - 3) * 0.4;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function HealthNutritionView() {
  const { selectedHealthPersonId } = useAppContext();
  const api = useHealthApi();

  const [entries, setEntries] = useState<NutritionEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedHealthPersonId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.listNutrition(selectedHealthPersonId);
      setEntries(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, selectedHealthPersonId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!selectedHealthPersonId) return;
      setUploading(true);
      setError(null);
      try {
        await api.uploadNutritionLabel(selectedHealthPersonId, file, 'considering');
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    },
    [api, selectedHealthPersonId, load]
  );

  const handleStatusChange = useCallback(
    async (entry: NutritionEntry, next: NutritionStatus) => {
      if (!selectedHealthPersonId) return;
      try {
        await api.updateNutrition(selectedHealthPersonId, entry.id, { status: next });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, selectedHealthPersonId, load]
  );

  const handleDelete = useCallback(
    async (entry: NutritionEntry) => {
      if (!selectedHealthPersonId) return;
      if (
        !confirm(
          `Tear out "${entry.parsed?.productName ?? 'this entry'}" from the ledger? The image and all parsed notes will be permanently removed.`
        )
      )
        return;
      try {
        await api.deleteNutrition(selectedHealthPersonId, entry.id);
        if (selectedId === entry.id) setSelectedId(null);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, selectedHealthPersonId, load, selectedId]
  );

  const handleReparse = useCallback(
    async (entry: NutritionEntry) => {
      if (!selectedHealthPersonId) return;
      try {
        await api.reparseNutrition(selectedHealthPersonId, entry.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, selectedHealthPersonId, load]
  );

  const handleGenerateResearch = useCallback(
    async (entry: NutritionEntry) => {
      if (!selectedHealthPersonId) return;
      try {
        await api.generateResearch(selectedHealthPersonId, entry.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, selectedHealthPersonId, load]
  );

  const handleDoseOrNotesChange = useCallback(
    async (
      entry: NutritionEntry,
      updates: { dose?: NutritionDose | null; notes?: string | null }
    ) => {
      if (!selectedHealthPersonId) return;
      try {
        await api.updateNutrition(selectedHealthPersonId, entry.id, updates);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, selectedHealthPersonId, load]
  );

  // ---- Derived state -----------------------------------------------------

  const active = useMemo(() => (entries ?? []).filter((e) => e.status === 'active'), [entries]);
  const considering = useMemo(
    () => (entries ?? []).filter((e) => e.status === 'considering'),
    [entries]
  );
  const past = useMemo(() => (entries ?? []).filter((e) => e.status === 'past'), [entries]);
  const never = useMemo(() => (entries ?? []).filter((e) => e.status === 'never'), [entries]);

  // Group active by time-of-day bucket — the "chunking" organizer.
  const activeByTime = useMemo(() => {
    const groups = new Map<TimeBucket, NutritionEntry[]>();
    for (const b of TIME_BUCKETS) groups.set(b.key, []);
    for (const e of active) {
      const bucket: TimeBucket = e.dose?.timeOfDay ?? 'unscheduled';
      groups.get(bucket)?.push(e);
    }
    return groups;
  }, [active]);

  // Endowed-progress style completion counter
  const activeWithDoses = active.filter((e) => e.dose && Object.keys(e.dose).length > 0).length;
  const totalActive = active.length;

  const selectedEntry = useMemo(
    () => (entries ?? []).find((e) => e.id === selectedId) ?? null,
    [entries, selectedId]
  );

  // ---- No-person empty state --------------------------------------------

  if (!selectedHealthPersonId) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Card variant="glass" className="rounded-2xl p-10 max-w-md text-center">
          <Pill className="w-8 h-8 text-surface-600 mx-auto mb-4" />
          <h2 className="font-display italic text-xl text-surface-950 mb-2">
            No person in the ledger
          </h2>
          <p className="text-sm text-surface-700">
            Pick a person from the Health Overview before opening the regimen journal.
          </p>
        </Card>
      </div>
    );
  }

  // ---- Main render -------------------------------------------------------

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 md:p-10 space-y-10">
        <MastheadHeader
          totalEntries={entries?.length ?? 0}
          totalActive={totalActive}
          activeWithDoses={activeWithDoses}
          onUpload={handleUpload}
          uploading={uploading}
        />

        {error && (
          <Card variant="glass" className="rounded-xl p-4 border border-rose-500/30 bg-rose-500/5">
            <div className="flex items-start justify-between gap-4">
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

        {loading && entries === null ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-accent-400 animate-spin" />
          </div>
        ) : (
          <>
            {/* PRIMARY — active regimen, chunked by time-of-day */}
            {active.length > 0 ? (
              <PrimarySection
                activeByTime={activeByTime}
                onOpen={setSelectedId}
                onStatusChange={handleStatusChange}
                imageUrlFor={(e) => api.nutritionImageUrl(e.personId, e.id)}
              />
            ) : null}

            {/* SECONDARY — considering, past, never — quieter, one lane */}
            {considering.length > 0 && (
              <SidewaysSection
                title="01"
                subtitle="Considering"
                entries={considering}
                onOpen={setSelectedId}
                onStatusChange={handleStatusChange}
                imageUrlFor={(e) => api.nutritionImageUrl(e.personId, e.id)}
              />
            )}
            {past.length > 0 && (
              <SidewaysSection
                title="02"
                subtitle="Past"
                muted
                entries={past}
                onOpen={setSelectedId}
                onStatusChange={handleStatusChange}
                imageUrlFor={(e) => api.nutritionImageUrl(e.personId, e.id)}
              />
            )}
            {never.length > 0 && (
              <SidewaysSection
                title="03"
                subtitle="Passed on"
                muted
                entries={never}
                onOpen={setSelectedId}
                onStatusChange={handleStatusChange}
                imageUrlFor={(e) => api.nutritionImageUrl(e.personId, e.id)}
              />
            )}

            {entries !== null && entries.length === 0 && (
              <EmptyState onUpload={handleUpload} uploading={uploading} />
            )}

            {entries !== null && entries.length > 0 && <ClosingNote totalActive={totalActive} />}
          </>
        )}
      </div>

      {selectedEntry && (
        <DetailModal
          entry={selectedEntry}
          imageUrl={api.nutritionImageUrl(selectedEntry.personId, selectedEntry.id)}
          onClose={() => setSelectedId(null)}
          onStatusChange={(s) => handleStatusChange(selectedEntry, s)}
          onDelete={() => handleDelete(selectedEntry)}
          onReparse={() => handleReparse(selectedEntry)}
          onSave={(u) => handleDoseOrNotesChange(selectedEntry, u)}
          onGenerateResearch={() => handleGenerateResearch(selectedEntry)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Masthead — the field-journal style page header
// ---------------------------------------------------------------------------

function MastheadHeader({
  totalEntries,
  totalActive,
  activeWithDoses,
  onUpload,
  uploading,
}: {
  totalEntries: number;
  totalActive: number;
  activeWithDoses: number;
  onUpload: (f: File) => void;
  uploading: boolean;
}) {
  const pct = totalActive === 0 ? 0 : Math.round((activeWithDoses / totalActive) * 100);
  return (
    <header className="relative border-b border-surface-200/40 pb-8">
      {/* small circulation flags */}
      <div className="flex items-center gap-3 text-[10px] font-semibold text-surface-600 uppercase tracking-[0.22em] mb-3">
        <span>Volume I</span>
        <span className="h-px flex-1 bg-surface-200/50" />
        <span>Regimen Ledger</span>
        <span className="h-px w-8 bg-surface-200/50" />
        <span>{new Date().toISOString().split('T')[0]}</span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="font-display italic text-3xl sm:text-4xl md:text-5xl leading-[1.05] text-surface-950">
            Nutrition <span className="text-surface-500">&amp;</span> Supplements
          </h1>
          <p className="mt-3 text-sm text-surface-700 max-w-xl leading-relaxed">
            A reference for what's currently in the daily stack, what's being considered, and what's
            been tried before.{' '}
            <span className="text-surface-600">
              Upload any Supplement Facts or Nutrition Facts label — Claude Vision reads the panel
              for you.
            </span>
          </p>

          {/* endowed-progress: completion counter */}
          {totalActive > 0 && (
            <div className="mt-5 inline-flex items-center gap-3 px-3.5 py-2 rounded-lg bg-surface-100/60 border border-surface-200/50">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] text-surface-800 font-medium tracking-wide">
                {activeWithDoses} of {totalActive} active entries have a dose recorded
                {pct < 100 && <span className="text-surface-600"> · {pct}% complete</span>}
              </span>
            </div>
          )}
        </div>

        {/* Upload CTA — Fitts's Law target; stacks below heading on mobile */}
        <div className="shrink-0 self-start sm:self-end">
          <UploadButton onFile={onUpload} uploading={uploading} />
        </div>
      </div>

      {totalEntries > 0 && (
        <div className="mt-6 flex items-center gap-6 text-[11px] text-surface-700">
          <Ledger label="In the stack" value={totalActive} accent="text-emerald-400" />
          <Ledger
            label="Under review"
            value={Math.max(0, totalEntries - totalActive)}
            accent="text-amber-400"
          />
          <Ledger label="On file" value={totalEntries} accent="text-surface-950" />
        </div>
      )}
    </header>
  );
}

function Ledger({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-display italic text-lg ${accent}`}>{value}</span>
      <span className="uppercase tracking-[0.18em] text-[9px] text-surface-600">{label}</span>
    </div>
  );
}

function UploadButton({ onFile, uploading }: { onFile: (file: File) => void; uploading: boolean }) {
  return (
    <label
      className={`group relative inline-flex items-center gap-2.5 px-5 py-3 rounded-xl cursor-pointer transition-all font-medium text-sm select-none ${
        uploading
          ? 'bg-surface-200/50 text-surface-700 cursor-wait'
          : 'bg-surface-950 text-surface-0 hover:bg-surface-950/85 shadow-lg shadow-surface-950/10'
      }`}
    >
      {uploading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Reading label…</span>
        </>
      ) : (
        <>
          <Camera className="w-4 h-4" />
          <span>Add a label</span>
          <span className="ml-2 pl-3 border-l border-surface-0/20 text-[10px] uppercase tracking-wider text-surface-0/60">
            PNG · JPG
          </span>
        </>
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Primary section — Active regimen, chunked by time-of-day
// ---------------------------------------------------------------------------

function PrimarySection({
  activeByTime,
  onOpen,
  onStatusChange,
  imageUrlFor,
}: {
  activeByTime: Map<TimeBucket, NutritionEntry[]>;
  onOpen: (id: string) => void;
  onStatusChange: (e: NutritionEntry, s: NutritionStatus) => void;
  imageUrlFor: (e: NutritionEntry) => string;
}) {
  return (
    <section>
      <SectionHeader
        number="§"
        title="Daily regimen"
        subtitle="What's in the stack right now, chunked by when it's taken"
      />
      <div className="mt-6 space-y-7">
        {TIME_BUCKETS.map((bucket) => {
          const entries = activeByTime.get(bucket.key) ?? [];
          if (entries.length === 0) return null;
          return (
            <TimeBucketLane
              key={bucket.key}
              bucket={bucket}
              entries={entries}
              onOpen={onOpen}
              onStatusChange={onStatusChange}
              imageUrlFor={imageUrlFor}
            />
          );
        })}
      </div>
    </section>
  );
}

function TimeBucketLane({
  bucket,
  entries,
  onOpen,
  onStatusChange,
  imageUrlFor,
}: {
  bucket: { key: TimeBucket; label: string; icon: LucideIcon; accent: string };
  entries: NutritionEntry[];
  onOpen: (id: string) => void;
  onStatusChange: (e: NutritionEntry, s: NutritionStatus) => void;
  imageUrlFor: (e: NutritionEntry) => string;
}) {
  const Icon = bucket.icon;
  return (
    <div className="relative">
      <div className="flex items-center gap-3 mb-3">
        <Icon className={`w-4 h-4 ${bucket.accent}`} />
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-surface-800">
          {bucket.label}
        </h4>
        <div className="flex-1 h-px bg-surface-200/40" />
        <span className="text-[10px] text-surface-600 uppercase tracking-[0.18em]">
          {entries.length} {entries.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {entries.map((entry) => (
          <LabelCard
            key={entry.id}
            entry={entry}
            imageUrl={imageUrlFor(entry)}
            onClick={() => onOpen(entry.id)}
            onStatusChange={(s) => onStatusChange(entry, s)}
            prominent
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Secondary (considering / past / never) — quieter, one lane per status
// ---------------------------------------------------------------------------

function SidewaysSection({
  title,
  subtitle,
  entries,
  onOpen,
  onStatusChange,
  imageUrlFor,
  muted,
}: {
  title: string;
  subtitle: string;
  entries: NutritionEntry[];
  onOpen: (id: string) => void;
  onStatusChange: (e: NutritionEntry, s: NutritionStatus) => void;
  imageUrlFor: (e: NutritionEntry) => string;
  muted?: boolean;
}) {
  return (
    <section className={muted ? 'opacity-85' : ''}>
      <SectionHeader number={title} title={subtitle} compact />
      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {entries.map((entry) => (
          <LabelCard
            key={entry.id}
            entry={entry}
            imageUrl={imageUrlFor(entry)}
            onClick={() => onOpen(entry.id)}
            onStatusChange={(s) => onStatusChange(entry, s)}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section header — numbered observation style from the field-journal system
// ---------------------------------------------------------------------------

function SectionHeader({
  number,
  title,
  subtitle,
  compact,
}: {
  number: string;
  title: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-4 px-1">
      <span className={`font-display italic text-surface-600 ${compact ? 'text-xl' : 'text-3xl'}`}>
        {number}
      </span>
      <div className="flex-1 min-w-0">
        <h3
          className={`font-display italic text-surface-950 leading-tight ${compact ? 'text-lg' : 'text-2xl'}`}
        >
          {title}
        </h3>
        {subtitle && <p className="text-xs text-surface-700 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Label card — pinned-paper aesthetic
// ---------------------------------------------------------------------------

function LabelCard({
  entry,
  imageUrl,
  onClick,
  onStatusChange,
  prominent,
}: {
  entry: NutritionEntry;
  imageUrl: string;
  onClick: () => void;
  onStatusChange: (s: NutritionStatus) => void;
  prominent?: boolean;
}) {
  const p = entry.parsed;
  const title = p?.productName ?? '(unparsed)';
  const subtitle = p?.brandName ?? entry.filename ?? '';
  const tilt = tiltFor(entry.id);

  return (
    <div
      className="group relative transition-transform duration-300"
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {/* Pin / tack */}
      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-surface-400 shadow-[inset_-1px_-1px_2px_rgba(0,0,0,0.2)] z-10" />

      <Card
        variant="glass"
        className={`relative rounded-xl overflow-hidden flex flex-col transition-all ${
          prominent
            ? 'shadow-lg shadow-surface-950/5 hover:shadow-xl hover:shadow-surface-950/10 hover:-translate-y-0.5'
            : 'hover:-translate-y-0.5'
        }`}
      >
        <button
          onClick={onClick}
          className="relative w-full h-40 bg-surface-100/40 hover:bg-surface-200/50 transition-colors"
        >
          <img src={imageUrl} alt={title} className="w-full h-full object-cover" loading="lazy" />
          {entry.parseError && (
            <div className="absolute top-2 left-2 px-2 py-0.5 bg-rose-500/90 text-surface-0 text-[10px] tracking-wide uppercase rounded-md">
              Parse failed
            </div>
          )}
          {entry.citations && entry.citations.length > 0 && (
            <div
              className="absolute top-2 right-2 px-2 py-0.5 bg-surface-950/80 backdrop-blur-sm text-accent-400 text-[10px] font-semibold rounded-md flex items-center gap-1"
              title={`${entry.citations.length} research citation${entry.citations.length === 1 ? '' : 's'} attached`}
            >
              <BookOpen className="w-3 h-3" />
              {entry.citations.length}
            </div>
          )}
        </button>

        <div className="p-4 space-y-3 flex-1 flex flex-col">
          <button onClick={onClick} className="text-left">
            <h4 className="font-display italic text-surface-950 text-[17px] leading-tight line-clamp-2">
              {title}
            </h4>
            {subtitle && (
              <p className="text-[11px] text-surface-600 mt-1 uppercase tracking-wider">
                {subtitle}
              </p>
            )}
          </button>

          {entry.dose && (
            <div className="text-xs text-surface-800 flex items-center gap-1.5 font-medium">
              <Pill className="w-3 h-3 text-accent-400" />
              <span>{formatDoseShort(entry.dose)}</span>
            </div>
          )}

          {entry.notes && (
            <p className="text-[11px] text-surface-700 italic line-clamp-2 leading-snug">
              {entry.notes}
            </p>
          )}

          {/* Status chips */}
          <div className="flex items-center gap-1 mt-auto pt-2 border-t border-surface-200/40">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(s)}
                title={STATUS_COPY[s].hint}
                className={`flex-1 px-1.5 py-1 text-[10px] font-medium rounded border transition-all ${
                  entry.status === s
                    ? STATUS_ACCENT[s]
                    : 'border-transparent text-surface-600 hover:text-surface-900 hover:bg-surface-100/40'
                }`}
              >
                {entry.status === s && <Check className="w-3 h-3 inline -mt-0.5 mr-0.5" />}
                {STATUS_COPY[s].label}
              </button>
            ))}
          </div>

          {/* Category tag stripe */}
          {p?.category && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-accent-400/40 via-accent-400 to-accent-400/40" />
          )}
        </div>
      </Card>
    </div>
  );
}

function formatDoseShort(dose: NutritionDose): string {
  const parts: string[] = [];
  if (dose.amount != null) parts.push(String(dose.amount));
  if (dose.unit) parts.push(dose.unit);
  if (dose.frequency) {
    if (dose.frequency === 'custom' && dose.frequencyCustom) parts.push(dose.frequencyCustom);
    else parts.push(dose.frequency);
  }
  if (dose.timeOfDay) parts.push(`· ${dose.timeOfDay}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onUpload, uploading }: { onUpload: (f: File) => void; uploading: boolean }) {
  return (
    <Card
      variant="glass"
      className="rounded-2xl p-10 md:p-14 text-center space-y-6 border-dashed border-2 border-surface-300/50"
    >
      <div className="inline-flex p-4 bg-amber-500/10 rounded-2xl">
        <Camera className="w-7 h-7 text-amber-400" />
      </div>
      <div className="space-y-2">
        <h2 className="font-display italic text-2xl md:text-3xl text-surface-950">
          An empty ledger waiting for its first entry
        </h2>
        <p className="text-sm text-surface-700 max-w-md mx-auto leading-relaxed">
          Snap a photo of any supplement bottle or nutrition label. The parser will pull out the
          panel — serving size, vitamins, minerals, ingredients, dosing instructions — in a few
          seconds.
        </p>
      </div>
      <div className="pt-2">
        <UploadButton onFile={onUpload} uploading={uploading} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Closing note — Peak-End Rule
// ---------------------------------------------------------------------------

function ClosingNote({ totalActive }: { totalActive: number }) {
  return (
    <Card
      variant="glass"
      className="rounded-xl p-6 md:p-8 border-l-4 border-l-amber-400/50 bg-surface-100/30"
    >
      <div className="flex items-start gap-4">
        <div className="hidden md:block font-display italic text-5xl text-surface-500 leading-none pt-1 select-none">
          ¶
        </div>
        <div className="space-y-2 text-sm text-surface-700 leading-relaxed">
          <p className="text-surface-950 font-medium">A note on this ledger</p>
          <p>
            The snapshot endpoint reads the items marked{' '}
            <span className="text-emerald-400 font-medium">Taking</span> and surfaces them to any
            skill consuming health data. Keep active entries trimmed to what you&apos;re actually
            swallowing today — the ledger is most useful when it matches reality, not aspiration.
          </p>
          {totalActive > 4 && (
            <p className="text-[11px] text-surface-600 italic">
              You have {totalActive} active items — a well-researched stack lives around 5–7 for
              most people. Worth asking whether any could drop to &apos;past&apos;.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Detail modal — product passport
// ---------------------------------------------------------------------------

function DetailModal({
  entry,
  imageUrl,
  onClose,
  onStatusChange,
  onDelete,
  onReparse,
  onSave,
  onGenerateResearch,
}: {
  entry: NutritionEntry;
  imageUrl: string;
  onClose: () => void;
  onStatusChange: (s: NutritionStatus) => void;
  onDelete: () => void;
  onReparse: () => Promise<void> | void;
  onSave: (updates: { dose?: NutritionDose | null; notes?: string | null }) => void;
  onGenerateResearch: () => Promise<void> | void;
}) {
  const [doseAmount, setDoseAmount] = useState<string>(entry.dose?.amount?.toString() ?? '');
  const [doseUnit, setDoseUnit] = useState<string>(entry.dose?.unit ?? '');
  const [frequency, setFrequency] = useState<NutritionDose['frequency']>(entry.dose?.frequency);
  const [frequencyCustom, setFrequencyCustom] = useState<string>(entry.dose?.frequencyCustom ?? '');
  const [timeOfDay, setTimeOfDay] = useState<NutritionDose['timeOfDay']>(entry.dose?.timeOfDay);
  const [notes, setNotes] = useState<string>(entry.notes ?? '');
  const [reparsing, setReparsing] = useState(false);

  const saveDose = useCallback(() => {
    const dose: NutritionDose = {};
    if (doseAmount.trim()) {
      const n = parseFloat(doseAmount);
      if (!Number.isNaN(n)) dose.amount = n;
    }
    if (doseUnit.trim()) dose.unit = doseUnit.trim();
    if (frequency) dose.frequency = frequency;
    if (frequencyCustom.trim()) dose.frequencyCustom = frequencyCustom.trim();
    if (timeOfDay) dose.timeOfDay = timeOfDay;
    const hasAny = Object.keys(dose).length > 0;
    onSave({ dose: hasAny ? dose : null, notes: notes.trim() || null });
  }, [doseAmount, doseUnit, frequency, frequencyCustom, timeOfDay, notes, onSave]);

  const p = entry.parsed;

  return (
    <div
      className="fixed inset-0 z-50 bg-surface-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-0 rounded-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Passport header */}
        <div className="relative px-8 pt-8 pb-6 border-b border-surface-200/50">
          <div className="flex items-center gap-3 text-[10px] font-semibold text-surface-600 uppercase tracking-[0.22em] mb-3">
            <span>Entry</span>
            <span className="font-mono text-surface-800">{entry.id.slice(0, 6)}</span>
            <span>·</span>
            <span>{new Date(entry.uploadedAt).toISOString().split('T')[0]}</span>
            {p?.confidence != null && (
              <>
                <span>·</span>
                <span className="text-surface-700">
                  Parser confidence {(p.confidence * 100).toFixed(0)}%
                </span>
              </>
            )}
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-display italic text-3xl md:text-4xl text-surface-950 leading-tight">
                {p?.productName ?? '(unparsed label)'}
              </h2>
              <p className="mt-1 text-xs text-surface-700 uppercase tracking-[0.2em]">
                {p?.brandName ?? entry.filename ?? 'Unknown source'}
                {p?.category && (
                  <span className="ml-2 text-surface-500 tracking-normal normal-case">
                    · {p.category}
                  </span>
                )}
              </p>
              {entry.parseError && (
                <p className="text-xs text-rose-400 mt-3 font-mono bg-rose-500/5 px-2 py-1 rounded border border-rose-500/20 w-fit">
                  Parse error: {entry.parseError}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-surface-600 hover:text-surface-950 p-1 rounded-lg hover:bg-surface-100/50"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_1.2fr] gap-0">
          {/* Left: image */}
          <div className="p-6 md:p-8 border-r-0 lg:border-r border-surface-200/40 bg-surface-100/30">
            <div className="sticky top-8">
              <img
                src={imageUrl}
                alt={p?.productName ?? 'label'}
                className="w-full rounded-xl border border-surface-200/60 shadow-md"
              />
            </div>
          </div>

          {/* Right: editable + parsed */}
          <div className="p-6 md:p-8 space-y-8">
            {/* Status */}
            <FieldGroup number="01" label="Standing">
              <div className="flex gap-1.5 flex-wrap">
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    onClick={() => onStatusChange(s)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                      entry.status === s
                        ? STATUS_ACCENT[s]
                        : 'border-surface-200/50 text-surface-700 hover:bg-surface-100/50'
                    }`}
                  >
                    {STATUS_COPY[s].label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-surface-600 mt-2 italic">
                {STATUS_COPY[entry.status].hint}
              </p>
            </FieldGroup>

            {/* Dose */}
            <FieldGroup number="02" label="Dose">
              <div className="flex gap-2 mb-2">
                <input
                  type="number"
                  placeholder="Amount"
                  value={doseAmount}
                  onChange={(e) => setDoseAmount(e.target.value)}
                  className="w-28 px-3 py-1.5 text-sm bg-surface-100/50 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
                />
                <input
                  type="text"
                  placeholder="Unit (caps, tbsp…)"
                  value={doseUnit}
                  onChange={(e) => setDoseUnit(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-sm bg-surface-100/50 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <select
                  value={frequency ?? ''}
                  onChange={(e) =>
                    setFrequency((e.target.value || undefined) as NutritionDose['frequency'])
                  }
                  className="px-3 py-1.5 text-sm bg-surface-100/50 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
                >
                  <option value="">— Frequency —</option>
                  <option value="daily">Daily</option>
                  <option value="twice-daily">Twice daily</option>
                  <option value="as-needed">As needed</option>
                  <option value="weekly">Weekly</option>
                  <option value="custom">Custom</option>
                </select>
                <select
                  value={timeOfDay ?? ''}
                  onChange={(e) =>
                    setTimeOfDay((e.target.value || undefined) as NutritionDose['timeOfDay'])
                  }
                  className="px-3 py-1.5 text-sm bg-surface-100/50 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
                >
                  <option value="">— Time of day —</option>
                  <option value="morning">Morning</option>
                  <option value="midday">Midday</option>
                  <option value="evening">Evening</option>
                  <option value="bedtime">Bedtime</option>
                  <option value="pre-workout">Pre-workout</option>
                  <option value="post-workout">Post-workout</option>
                </select>
              </div>
              {frequency === 'custom' && (
                <input
                  type="text"
                  placeholder="e.g. 3× per week post-ruck"
                  value={frequencyCustom}
                  onChange={(e) => setFrequencyCustom(e.target.value)}
                  className="w-full mt-2 px-3 py-1.5 text-sm bg-surface-100/50 border border-surface-200/50 rounded-lg focus:outline-none focus:border-accent-400/50"
                />
              )}
            </FieldGroup>

            {/* Notes */}
            <FieldGroup number="03" label="Personal notes">
              <textarea
                rows={3}
                placeholder="Why you're taking this, interactions to watch, a hunch to track later…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-100/50 border border-surface-200/50 rounded-lg resize-y focus:outline-none focus:border-accent-400/50"
              />
            </FieldGroup>

            {/* Save + actions */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-200/40">
              <Button onClick={saveDose} size="sm">
                Save entry
              </Button>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setReparsing(true);
                    try {
                      await onReparse();
                    } finally {
                      setReparsing(false);
                    }
                  }}
                  disabled={reparsing}
                  className="px-3 py-1.5 text-xs text-surface-700 hover:text-surface-950 border border-surface-200/50 rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                >
                  {reparsing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Re-parse
                </button>
                <button
                  onClick={onDelete}
                  className="px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Tear out
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Research panel — AI-generated evidence + structured citations */}
        <div className="px-6 md:px-8 pb-2">
          <ResearchPanel entry={entry} onGenerateResearch={onGenerateResearch} />
        </div>

        {/* Parsed facts panel */}
        {p && (
          <div className="px-6 md:px-8 pb-8 space-y-6">
            <PassportDivider label="Parsed facts" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FactsBlock title="Serving">
                {p.servingSize && (
                  <FactsRow
                    label="Serving size"
                    value={`${p.servingSize.amount} ${p.servingSize.unit}${p.servingSize.description ? ` (${p.servingSize.description})` : ''}`}
                  />
                )}
                {p.servingsPerContainer != null && (
                  <FactsRow label="Servings / container" value={String(p.servingsPerContainer)} />
                )}
                {p.macros?.calories != null && (
                  <FactsRow label="Calories" value={String(p.macros.calories)} />
                )}
                {p.directions && <FactsRow label="Directions" value={p.directions} />}
              </FactsBlock>

              {p.vitamins && p.vitamins.length > 0 && (
                <FactsBlock title={`Vitamins (${p.vitamins.length})`}>
                  {p.vitamins.map((v) => (
                    <NutrientRow key={v.name} entry={v} />
                  ))}
                </FactsBlock>
              )}

              {p.minerals && p.minerals.length > 0 && (
                <FactsBlock title={`Minerals (${p.minerals.length})`}>
                  {p.minerals.map((m) => (
                    <NutrientRow key={m.name} entry={m} />
                  ))}
                </FactsBlock>
              )}

              {p.otherActive && p.otherActive.length > 0 && (
                <FactsBlock title={`Other actives (${p.otherActive.length})`}>
                  {p.otherActive.map((a) => (
                    <NutrientRow key={a.name} entry={a} />
                  ))}
                </FactsBlock>
              )}

              {p.proprietaryBlends && p.proprietaryBlends.length > 0 && (
                <FactsBlock title="Proprietary blends" className="md:col-span-2">
                  {p.proprietaryBlends.map((b) => (
                    <div key={b.name} className="text-xs text-surface-700">
                      <div className="font-medium text-surface-950 flex items-baseline gap-2">
                        <span>{b.name}</span>
                        {b.totalAmount && (
                          <span className="text-surface-600 font-normal">
                            {b.totalAmount.amount} {b.totalAmount.unit}
                          </span>
                        )}
                      </div>
                      {b.ingredients && b.ingredients.length > 0 && (
                        <div className="text-surface-600 mt-1 italic">
                          {b.ingredients.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </FactsBlock>
              )}

              {p.ingredients && p.ingredients.length > 0 && (
                <FactsBlock title="Other ingredients" className="md:col-span-2">
                  <p className="text-xs text-surface-700">{p.ingredients.join(', ')}</p>
                </FactsBlock>
              )}

              {p.allergenInfo && p.allergenInfo.length > 0 && (
                <FactsBlock title="Allergen info" className="md:col-span-2">
                  <ul className="text-xs text-surface-700 space-y-1">
                    {p.allergenInfo.map((a, i) => (
                      <li key={i}>· {a}</li>
                    ))}
                  </ul>
                </FactsBlock>
              )}

              {p.warnings && p.warnings.length > 0 && (
                <FactsBlock title="Warnings" className="md:col-span-2">
                  <ul className="text-xs text-surface-700 space-y-1">
                    {p.warnings.map((w, i) => (
                      <li key={i}>· {w}</li>
                    ))}
                  </ul>
                </FactsBlock>
              )}
            </div>
            {p.parserNotes && (
              <p className="text-xs text-surface-600 italic text-center pt-4 border-t border-surface-200/40">
                Parser note: {p.parserNotes}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FieldGroup({
  number,
  label,
  children,
}: {
  number: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="font-display italic text-surface-500 text-sm">{number}</span>
        <label className="text-xs font-semibold text-surface-800 uppercase tracking-[0.18em]">
          {label}
        </label>
      </div>
      {children}
    </div>
  );
}

function PassportDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="h-px w-12 bg-surface-300" />
      <span className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.22em]">
        {label}
      </span>
      <div className="flex-1 h-px bg-surface-200/50" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Research panel — collapsible, read-only. Renders AI-generated evidence
// prose (markdown) + structured citations with clickable PubMed links.
// "Generate with AI" button hits the /generate-research endpoint which
// calls Claude with the product info and auto-saves the result.
// ---------------------------------------------------------------------------

function ResearchPanel({
  entry,
  onGenerateResearch,
}: {
  entry: NutritionEntry;
  onGenerateResearch: () => Promise<void> | void;
}) {
  const hasResearch = !!entry.research && entry.research.trim().length > 0;
  const citations = entry.citations ?? [];
  const [open, setOpen] = useState<boolean>(hasResearch);
  const [generating, setGenerating] = useState<boolean>(false);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      await onGenerateResearch();
      setOpen(true);
    } finally {
      setGenerating(false);
    }
  }, [onGenerateResearch]);

  return (
    <div className="rounded-xl border border-surface-200/50 bg-surface-50/40">
      {/* Header — clickable to toggle; shows state + CTA */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left flex-1 min-w-0 group"
          aria-expanded={open}
        >
          <BookOpen className="w-4 h-4 text-accent-400 shrink-0" />
          <span className="text-xs font-semibold text-surface-800 uppercase tracking-[0.18em]">
            Evidence & research
          </span>
          {hasResearch ? (
            <span className="text-xs text-surface-600">
              · {citations.length} reference{citations.length === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="text-xs text-surface-600 italic">· not yet generated</span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-surface-600 ml-auto transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className={`shrink-0 px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${
            hasResearch
              ? 'text-surface-700 hover:text-surface-950 border border-surface-200/50'
              : 'text-accent-400 hover:text-accent-300 border border-accent-400/40 bg-accent-400/5'
          } disabled:opacity-50`}
          title={
            hasResearch
              ? 'Regenerate research (overwrites current)'
              : 'Have Claude generate evidence + citations'
          }
        >
          {generating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          {generating ? 'Generating…' : hasResearch ? 'Regenerate' : 'Generate with AI'}
        </button>
      </div>

      {/* Body — research markdown + references, visible only when open */}
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-surface-200/40">
          {hasResearch ? (
            <>
              <div className="prose prose-sm prose-surface max-w-none text-sm text-surface-800 [&_strong]:text-surface-950 [&_a]:text-accent-400 [&_ul]:my-2 [&_li]:my-0.5 [&_p]:my-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.research ?? ''}</ReactMarkdown>
              </div>
              {citations.length > 0 && (
                <div className="mt-4 pt-3 border-t border-surface-200/40">
                  <div className="text-[10px] font-semibold text-surface-600 uppercase tracking-[0.22em] mb-2">
                    References
                  </div>
                  <ol className="text-xs text-surface-700 space-y-1.5 list-decimal list-outside ml-5">
                    {citations.map((c, i) => (
                      <li key={c.id || i} className="pl-1">
                        <span className="text-surface-800">{c.authors}</span>{' '}
                        <span className="text-surface-600">{c.year}.</span>{' '}
                        <em className="text-surface-700">{c.journal}</em>.{' '}
                        {c.pmid && (
                          <a
                            href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-400 hover:text-accent-300 underline-offset-2 hover:underline"
                          >
                            PMID {c.pmid}
                          </a>
                        )}
                        {!c.pmid && c.doi && (
                          <a
                            href={`https://doi.org/${c.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-400 hover:text-accent-300 underline-offset-2 hover:underline"
                          >
                            DOI {c.doi}
                          </a>
                        )}
                        {!c.pmid && !c.doi && c.url && (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-400 hover:text-accent-300 underline-offset-2 hover:underline"
                          >
                            link
                          </a>
                        )}
                        . <span className="text-surface-800">{c.title}</span>.
                        {c.findings && (
                          <span className="text-surface-600 italic"> {c.findings}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-surface-600 italic">
              No research generated yet. Click "Generate with AI" to have Claude draft
              evidence-backed research with structured citations based on this product's parsed
              ingredients.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FactsBlock({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <h4 className="text-[11px] font-semibold text-surface-800 uppercase tracking-[0.18em] mb-2.5">
        {title}
      </h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function FactsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs flex justify-between gap-4">
      <span className="text-surface-600 flex-shrink-0">{label}</span>
      <span className="text-surface-950 text-right">{value}</span>
    </div>
  );
}

function NutrientRow({
  entry,
}: {
  entry: { name: string; amount?: number; unit?: string; dv?: number; form?: string };
}) {
  const amount =
    entry.amount != null ? `${entry.amount}${entry.unit ? ' ' + entry.unit : ''}` : '—';
  const dv = entry.dv != null ? ` · ${entry.dv}% DV` : '';
  return (
    <div className="text-xs">
      <div className="flex justify-between gap-2">
        <span className="text-surface-950">{entry.name}</span>
        <span className="text-surface-700 text-right">
          {amount}
          {dv}
        </span>
      </div>
      {entry.form && <div className="text-surface-600 text-[10px] mt-0.5 italic">{entry.form}</div>}
    </div>
  );
}
