// Person detail — upload exports, view parsed summaries, and health-at-a-glance charts.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload,
  FileArchive,
  CheckCircle2,
  PlayCircle,
  RefreshCcw,
  Loader2,
  AlertCircle,
  RefreshCw,
  CalendarRange,
  Activity,
  TrendingUp,
  Smartphone,
  Share2,
  Database,
  Dumbbell,
  Clock,
  Hash,
  ChevronDown,
  ChevronUp,
  Footprints,
  HeartPulse,
  Moon,
  ShieldCheck,
  Star,
} from 'lucide-react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { Button } from '@/components/ui/button';
import { useHealthApi } from './useHealthApi';
import type { AppleHealthSummary, ExportInfo, PersonSnapshots } from './types';
import { DailySummaryTable } from './DailySummaryTable';
import { ShortcutSetupGuide } from './ShortcutSetupGuide';
import { HealthChart } from './HealthChart';
import { ChartCard } from './ChartCard';
import { ScoreGauge } from './ScoreGauge';
import { humanizeTypeName, formatInt, formatHours, formatBpm } from './healthFormatters';

interface PersonDetailProps {
  person: HealthPerson;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function PersonDetail({ person }: PersonDetailProps) {
  const api = useHealthApi();
  const [exports, setExports] = useState<ExportInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<AppleHealthSummary | null>(null);
  const [snapshot, setSnapshot] = useState<PersonSnapshots | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listExports(person.id);
      setExports(list);
      const parsed = [...list]
        .filter((e) => e.parsed)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
      if (parsed.length > 0 && !selectedFilename) {
        const latest = parsed[0];
        setSelectedFilename(latest.filename);
        try {
          const s = await api.getSummary(person.id, latest.filename);
          setSummary(s);
        } catch (e) {
          console.warn('Summary load failed:', e);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api, person.id, selectedFilename]);

  // Load snapshot for charts
  useEffect(() => {
    void api
      .getSnapshot(person.id, 'all')
      .then((res) => setSnapshot(res.data))
      .catch(() => setSnapshot(null));
  }, [api, person.id]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id]);

  const handleUpload = async (file: File) => {
    setError(null);
    setBusyMessage(`Uploading ${file.name}…`);
    try {
      const parsingTimer = setTimeout(
        () => setBusyMessage(`Unarchiving and parsing ${file.name}…`),
        1500
      );
      try {
        const { filename, summary: s } = await api.uploadAndParseExport(person.id, file);
        setSummary(s);
        setSelectedFilename(filename);
      } finally {
        clearTimeout(parsingTimer);
      }
      const list = await api.listExports(person.id);
      setExports(list);
      // Refresh snapshot for charts
      void api
        .getSnapshot(person.id, 'all')
        .then((res) => setSnapshot(res.data))
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyMessage(null);
    }
  };

  const handleReParse = async (filename: string) => {
    setError(null);
    setBusyMessage(`Re-parsing ${filename}…`);
    try {
      const s = await api.parseExport(person.id, filename);
      setSummary(s);
      setSelectedFilename(filename);
      const list = await api.listExports(person.id);
      setExports(list);
      void api
        .getSnapshot(person.id, 'all')
        .then((res) => setSnapshot(res.data))
        .catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyMessage(null);
    }
  };

  const handleSelectSummary = async (filename: string) => {
    setSelectedFilename(filename);
    setError(null);
    try {
      const s = await api.getSummary(person.id, filename);
      setSummary(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const hasExports = exports.length > 0;
  const hasParsedExport = exports.some((e) => e.parsed);
  const needsParseGuidance = hasExports && !hasParsedExport && !busyMessage && !summary;
  const busy = busyMessage !== null;

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-danger-500/20 bg-danger-500/5 p-4">
          <div className="flex items-start gap-2.5 text-danger-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        </div>
      )}

      {busy && (
        <div className="rounded-xl border border-accent-500/20 bg-accent-500/5 p-5">
          <div className="flex items-center gap-3 text-accent-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <div>
              <div className="font-medium">{busyMessage}</div>
              <div className="text-xs text-surface-700 mt-0.5">
                The ~1 GB XML is streamed through the parser — usually 30-60 seconds total.
              </div>
            </div>
          </div>
        </div>
      )}

      {needsParseGuidance && (
        <div className="rounded-xl border border-accent-500/20 bg-accent-500/5 p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-500/15 flex items-center justify-center flex-shrink-0">
              <PlayCircle className="w-5 h-5 text-accent-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-surface-950">
                Your export is ready — click Re-parse to see the dashboard
              </h3>
              <p className="text-xs text-surface-700 mt-1 leading-relaxed">
                There&apos;s an <code className="font-mono text-[11px]">export.zip</code> on disk
                but it hasn&apos;t been parsed yet. Click <strong>Re-parse</strong> below.
              </p>
            </div>
          </div>
        </div>
      )}

      {!loading && !hasExports && !busy && <PersonEmptyState onUpload={handleUpload} />}

      {/* Upload + Exports panel */}
      {hasExports && (
        <div className="rounded-xl border border-border/40 bg-surface-50/30 overflow-hidden">
          <div className="flex items-center gap-4 p-4 border-b border-border/30">
            <div className="w-9 h-9 rounded-lg bg-accent-500/10 flex items-center justify-center flex-shrink-0">
              <Upload className="w-4 h-4 text-accent-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-surface-950">Upload another export</div>
              <div className="text-[11px] text-surface-600">
                Newer exports always contain full history — uploading replaces the previous parse.
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
                if (e.target) e.target.value = '';
              }}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              size="sm"
              className="gap-1.5"
            >
              <FileArchive className="w-3.5 h-3.5" />
              Choose .zip
            </Button>
          </div>

          <div className="divide-y divide-border/20">
            {exports.map((exp) => {
              const isSelected = exp.filename === selectedFilename;
              return (
                <div
                  key={exp.filename}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                    isSelected ? 'bg-accent-500/5' : 'hover:bg-surface-100/30'
                  }`}
                >
                  <FileArchive
                    className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-accent-400' : 'text-surface-500'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-surface-950 truncate">
                      {exp.filename}
                    </div>
                    <div className="text-[11px] text-surface-600">
                      {formatBytes(exp.size)} &middot; {formatDateTime(exp.uploadedAt)}
                    </div>
                  </div>
                  {/* Only show View button when multiple exports exist */}
                  {exp.parsed && exports.filter((e) => e.parsed).length > 1 && (
                    <button
                      type="button"
                      className="text-emerald-400 flex items-center gap-1 text-[11px] font-medium hover:underline"
                      onClick={() => void handleSelectSummary(exp.filename)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      View
                    </button>
                  )}
                  {exp.parsed && exports.filter((e) => e.parsed).length <= 1 && (
                    <span className="text-emerald-400 flex items-center gap-1 text-[11px] font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Parsed
                    </span>
                  )}
                  {!exp.parsed && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => void handleReParse(exp.filename)}
                      disabled={busy}
                      className="gap-1"
                    >
                      <RefreshCcw className="w-3 h-3" />
                      Parse
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-surface-600 p-4">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Loading exports...
            </div>
          )}
        </div>
      )}

      {hasParsedExport && <ShortcutSetupGuide personId={person.id} personName={person.name} />}

      {/* Health at a Glance — charts + scores from snapshot */}
      {snapshot && <HealthAtAGlance snapshot={snapshot} />}

      {/* Raw data */}
      {summary && (
        <>
          <SummaryStats summary={summary} />
          <DailySummaryTable summary={summary} />
          <WorkoutList summary={summary} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health at a Glance — key charts and scores from the snapshot
// ---------------------------------------------------------------------------
function HealthAtAGlance({ snapshot }: { snapshot: PersonSnapshots }) {
  const latestRecovery =
    snapshot.activity.recoveryScores.length > 0
      ? snapshot.activity.recoveryScores[snapshot.activity.recoveryScores.length - 1]
      : null;
  const latestSleepQuality =
    snapshot.sleep.qualityScores.length > 0
      ? snapshot.sleep.qualityScores[snapshot.sleep.qualityScores.length - 1]
      : null;

  return (
    <div className="space-y-4">
      <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-[0.12em] flex items-center gap-1.5">
        <Activity className="w-3 h-3 text-accent-400" />
        Health at a glance
      </h3>

      {/* Scores row */}
      {(latestRecovery || latestSleepQuality) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {latestRecovery && (
            <ScoreGauge
              label="Recovery Score"
              score={latestRecovery.score}
              icon={ShieldCheck}
              components={[
                { label: 'HRV', value: latestRecovery.components.hrv },
                { label: 'Sleep', value: latestRecovery.components.sleep },
                { label: 'Resting HR', value: latestRecovery.components.restingHR },
                { label: 'Load', value: latestRecovery.components.exerciseLoad },
              ]}
            />
          )}
          {latestSleepQuality && (
            <ScoreGauge
              label="Sleep Quality"
              score={latestSleepQuality.score}
              icon={Star}
              components={[
                { label: 'Duration', value: latestSleepQuality.components.duration },
                { label: 'Consistency', value: latestSleepQuality.components.consistency },
                { label: 'Interruptions', value: latestSleepQuality.components.interruptions },
              ]}
            />
          )}
        </div>
      )}

      {/* Key charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ChartCard icon={Footprints} title="Steps (30d)" color="text-emerald-400">
          <HealthChart
            data={snapshot.activity.daily}
            lines={[
              { key: 'steps', label: 'Steps', color: '#10b981' },
              { key: 'steps7dAvg', label: '7d avg', color: '#6ee7b7' },
            ]}
            valueFormatter={formatInt}
            defaultRange="1M"
          />
        </ChartCard>

        <ChartCard icon={Moon} title="Sleep (30d)" color="text-violet-400">
          <HealthChart
            data={snapshot.sleep.daily.map((d) => ({
              date: d.date,
              hours: d.asleepMinutes / 60,
            }))}
            lines={[{ key: 'hours', label: 'Hours', color: '#a855f7' }]}
            valueFormatter={(v) => formatHours(v)}
            defaultRange="1M"
          />
        </ChartCard>

        <ChartCard icon={HeartPulse} title="Resting HR (30d)" color="text-rose-400">
          <HealthChart
            data={snapshot.heart.daily}
            lines={[{ key: 'restingHR', label: 'Resting HR', color: '#f43f5e' }]}
            valueFormatter={formatBpm}
            defaultRange="1M"
          />
        </ChartCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-person empty state
// ---------------------------------------------------------------------------
function PersonEmptyState({ onUpload }: { onUpload: (file: File) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-border/40 bg-surface-50/30 p-6 sm:p-8">
      <h2 className="font-display text-xl italic text-surface-950 mb-2">
        Upload their Apple Health export
      </h2>
      <p className="text-sm text-surface-700 mb-5 leading-relaxed">
        Drop in an <code className="font-mono text-[11px]">export.zip</code> and DocVault will
        unarchive it, run the parser across every metric, and show the daily dashboard.
      </p>
      <ol className="space-y-3 mb-6">
        <EmptyStep
          icon={Smartphone}
          number={1}
          title="On your iPhone, open the Health app"
          detail="Tap your profile picture in the top-right corner."
        />
        <EmptyStep
          icon={Share2}
          number={2}
          title='Tap "Export All Health Data"'
          detail="Scroll to the bottom of your profile page. The export takes a few minutes to build."
        />
        <EmptyStep
          icon={Upload}
          number={3}
          title="Share the zip here, then upload it"
          detail="AirDrop to this machine (or save to Files / iCloud Drive), then click the button below."
        />
      </ol>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onUpload(f);
          if (e.target) e.target.value = '';
        }}
      />
      <Button onClick={() => inputRef.current?.click()} size="lg" className="gap-2">
        <FileArchive className="w-4 h-4" />
        Choose export.zip
      </Button>
    </div>
  );
}

function EmptyStep({
  icon: Icon,
  number,
  title,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  number: number;
  title: string;
  detail: string;
}) {
  return (
    <li className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-accent-500/10 flex items-center justify-center">
        <Icon className="w-4 h-4 text-accent-400" />
      </div>
      <div className="flex-1">
        <div className="font-medium text-sm text-surface-950">
          <span className="text-accent-400 font-mono mr-2">{number}.</span>
          {title}
        </div>
        <div className="text-xs text-surface-700 mt-0.5 leading-relaxed">{detail}</div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------
function SummaryStats({ summary }: { summary: AppleHealthSummary }) {
  const { recordCounts, dateRange, typesSeen, profile } = summary;
  const days = Object.keys(summary.dailySummaries).length;

  return (
    <div className="rounded-xl border border-border/40 bg-surface-50/30 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border/30">
        <Database className="w-3.5 h-3.5 text-surface-500" />
        <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-[0.12em]">
          Export summary
        </h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/20">
        <SummaryStat
          icon={Activity}
          label="Records"
          value={recordCounts.totalRecords.toLocaleString()}
        />
        <SummaryStat
          icon={Dumbbell}
          label="Workouts"
          value={recordCounts.totalWorkouts.toLocaleString()}
        />
        <SummaryStat icon={Clock} label="Days covered" value={days.toLocaleString()} />
        <SummaryStat
          icon={Hash}
          label="Metric types"
          value={`${typesSeen.numeric.length + typesSeen.category.length}`}
        />
      </div>

      <div className="px-5 py-3 border-t border-border/30 flex flex-wrap gap-x-6 gap-y-1 text-xs text-surface-600">
        <span className="flex items-center gap-1.5">
          <CalendarRange className="w-3 h-3 text-surface-500" />
          {dateRange.start ?? '—'} &rarr; {dateRange.end ?? '—'}
        </span>
        {profile.biologicalSex && (
          <span className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-surface-500" />
            {profile.biologicalSex}
            {profile.dateOfBirth ? ` · born ${profile.dateOfBirth}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-surface-50 p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="w-3.5 h-3.5 text-surface-500 opacity-70" />
        <div className="text-[10px] uppercase tracking-[0.08em] text-surface-600 font-medium">
          {label}
        </div>
      </div>
      <div className="font-mono text-lg text-surface-950 tabular-nums leading-none">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workout list
// ---------------------------------------------------------------------------
function WorkoutList({ summary }: { summary: AppleHealthSummary }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...summary.workouts].sort((a, b) => b.start.localeCompare(a.start));
  const defaultRows = 10;
  const canExpand = sorted.length > defaultRows;
  const visible = canExpand && !expanded ? sorted.slice(0, defaultRows) : sorted;

  return (
    <div className="rounded-xl border border-border/40 bg-surface-50/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-[0.12em] flex items-center gap-1.5">
          <Dumbbell className="w-3 h-3 text-surface-500" />
          Workouts
          <span className="text-surface-500 font-mono tabular-nums">
            ({summary.workouts.length.toLocaleString()})
          </span>
        </h3>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-accent-400 transition-colors font-medium"
          >
            {expanded ? (
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
      {sorted.length === 0 ? (
        <div className="text-sm text-surface-600 py-8 text-center">No workouts in this export.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                <th className="py-2 px-4">Type</th>
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3 text-right">Duration</th>
                <th className="py-2 px-3 text-right">Distance</th>
                <th className="py-2 px-3 text-right">Energy</th>
                <th className="py-2 px-3 text-right">Avg HR</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((w, i) => {
                const dist = w.statistics.DistanceWalkingRunning ?? w.statistics.DistanceCycling;
                const energy = w.statistics.ActiveEnergyBurned;
                const hr = w.statistics.HeartRate;
                return (
                  <tr
                    key={`${w.start}-${i}`}
                    className="border-b border-border/20 hover:bg-surface-100/30 transition-colors"
                  >
                    <td className="py-1.5 px-4 font-medium text-surface-950">
                      {humanizeTypeName(w.type)}
                    </td>
                    <td className="py-1.5 px-3 text-surface-700 font-mono text-xs">
                      {w.start.slice(0, 10)}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {w.durationMinutes !== undefined ? w.durationMinutes.toFixed(0) + 'm' : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {dist?.sum !== undefined ? `${dist.sum.toFixed(2)} ${dist.unit ?? ''}` : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {energy?.sum !== undefined
                        ? `${energy.sum.toFixed(0)} ${energy.unit ?? ''}`
                        : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {hr?.avg !== undefined ? hr.avg.toFixed(0) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canExpand && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full py-2 text-[11px] text-surface-500 hover:text-accent-400 bg-surface-100/30 border-t border-border/20 transition-colors font-medium"
        >
          Show all {sorted.length.toLocaleString()} workouts
        </button>
      )}
    </div>
  );
}
