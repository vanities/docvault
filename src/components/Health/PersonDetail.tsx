// Person detail — upload exports and view parsed summaries.
//
// Flow:
//   1. Upload export.zip → server auto-unarchives + auto-parses in one call
//   2. Parsed summary comes back in the upload response, immediately rendered
//   3. Summary card, DailySummaryTable, and WorkoutList are the three views
//   4. Previously uploaded exports show in a list; clicking one loads its summary

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
} from 'lucide-react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useHealthApi } from './useHealthApi';
import type { AppleHealthSummary, ExportInfo } from './types';
import { DailySummaryTable } from './DailySummaryTable';
import { ShortcutSetupGuide } from './ShortcutSetupGuide';

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
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listExports(person.id);
      setExports(list);
      // Auto-load the most recent parsed summary
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

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id]);

  /** One-shot upload + unarchive + parse. The server does everything. */
  const handleUpload = async (file: File) => {
    setError(null);
    setBusyMessage(`Uploading ${file.name}…`);
    try {
      // Transition message to "parsing" after a brief moment so the user sees
      // the flow happening. This is a UI-only cue; the server is already
      // streaming as soon as the upload body lands.
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
      // Refresh the exports list so the new row + "parsed" badge appear
      const list = await api.listExports(person.id);
      setExports(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyMessage(null);
    }
  };

  /** Re-parse a previously uploaded zip (e.g. after a parser version bump). */
  const handleReParse = async (filename: string) => {
    setError(null);
    setBusyMessage(`Re-parsing ${filename}…`);
    try {
      const s = await api.parseExport(person.id, filename);
      setSummary(s);
      setSelectedFilename(filename);
      const list = await api.listExports(person.id);
      setExports(list);
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
    <div className="space-y-6">
      {error && (
        <Card className="p-4 border-danger-500/30 bg-danger-500/5">
          <div className="flex items-start gap-2.5 text-danger-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        </Card>
      )}

      {/* Busy notice — shown during upload + unarchive + parse */}
      {busy && (
        <Card className="p-5 border-accent-500/30 bg-accent-500/5">
          <div className="flex items-center gap-3 text-accent-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <div>
              <div className="font-medium">{busyMessage}</div>
              <div className="text-xs text-surface-700 mt-0.5">
                The ~1 GB XML is streamed through the parser — usually 30–60 seconds total.
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* "Your export is ready to parse" — shown when zips exist but nothing
          has been parsed yet. This is the state you land in on a fresh install
          if a zip was rsynced/copied onto the NAS before the UI saw it. */}
      {needsParseGuidance && (
        <Card className="p-5 border-accent-500/30 bg-accent-500/5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-500/15 flex items-center justify-center flex-shrink-0">
              <PlayCircle className="w-5 h-5 text-accent-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-surface-950">
                Your export is ready — click Re-parse to see the dashboard
              </h3>
              <p className="text-xs text-surface-700 mt-1 leading-relaxed">
                There&apos;s an <code className="font-mono text-[11px]">export.zip</code> for this
                person on disk but it hasn&apos;t been parsed yet. Click the{' '}
                <strong>Re-parse</strong> button on the row below — the server will unarchive and
                stream through the XML (~30–60 seconds on a NAS), then the daily summary table and
                workout list will render here.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Empty state for a person with no exports yet — step-by-step guide */}
      {!loading && !hasExports && !busy && <PersonEmptyState onUpload={handleUpload} />}

      {/* Upload zone — shown when there's already at least one export */}
      {hasExports && (
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center flex-shrink-0">
              <Upload className="w-5 h-5 text-accent-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-surface-950">Upload another export</h3>
              <p className="text-xs text-surface-600 mt-1">
                Newer exports from the Health app always contain the full history. Uploading
                replaces the previous parsed summary for this person.
              </p>
              <div className="mt-3">
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
                  className="gap-2"
                >
                  <FileArchive className="w-4 h-4" />
                  Choose export.zip
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Exports list — hidden when empty, included in the empty state card instead */}
      {hasExports && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-surface-950">
              Exports ({exports.length.toLocaleString()})
            </h3>
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <div className="space-y-1.5">
            {exports.map((exp) => {
              const isSelected = exp.filename === selectedFilename;
              return (
                <div
                  key={exp.filename}
                  className={`
                    flex items-center gap-3 p-2.5 rounded-lg border transition-colors
                    ${isSelected ? 'bg-accent-500/5 border-accent-500/30' : 'border-border hover:bg-surface-100/50'}
                  `}
                >
                  <FileArchive className="w-4 h-4 text-surface-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-surface-950 truncate">
                      {exp.filename}
                    </div>
                    <div className="text-xs text-surface-600">
                      {formatBytes(exp.size)} • uploaded {formatDateTime(exp.uploadedAt)}
                    </div>
                  </div>
                  {exp.parsed && (
                    <button
                      type="button"
                      className="text-emerald-400 flex items-center gap-1 text-xs hover:underline"
                      onClick={() => void handleSelectSummary(exp.filename)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      View
                    </button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleReParse(exp.filename)}
                    disabled={busy}
                    className="gap-1.5"
                    title="Re-run the parser against this zip (e.g. after a parser version bump)"
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Re-parse
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Summary — stats + daily table + workouts */}
      {summary && (
        <>
          <SummaryStats summary={summary} />
          <DailySummaryTable summary={summary} />
          <WorkoutList summary={summary} />
        </>
      )}

      {/* Shortcut daily-sync setup guide. Only rendered once the person has
          parsed data — the daily flow is additive on top of a bulk baseline,
          so it makes no sense to offer it before there's anything to overlay. */}
      {hasParsedExport && <ShortcutSetupGuide personId={person.id} personName={person.name} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-person empty state — step-by-step guide + upload button
// ---------------------------------------------------------------------------
function PersonEmptyState({ onUpload }: { onUpload: (file: File) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Card className="p-6 sm:p-8">
      <h2 className="font-display text-xl italic text-surface-950 mb-2">
        Upload their Apple Health export
      </h2>
      <p className="text-sm text-surface-700 mb-5 leading-relaxed">
        Drop in an <code className="font-mono text-[11px]">export.zip</code> and DocVault will
        unarchive it, run the parser across every metric, and show the daily dashboard. The
        decompressed XML is kept on disk so your data-dir backup captures it automatically.
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
          title="Tap “Export All Health Data”"
          detail="Scroll to the bottom of your profile page. The export takes a few minutes to build — give it time, it's a large file."
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
    </Card>
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
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center">
        <Icon className="w-4 h-4 text-rose-400" />
      </div>
      <div className="flex-1">
        <div className="font-medium text-sm text-surface-950">
          <span className="text-rose-400 mr-2">{number}.</span>
          {title}
        </div>
        <div className="text-xs text-surface-700 mt-0.5 leading-relaxed">{detail}</div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Summary stats — headline row of counts
// ---------------------------------------------------------------------------
function SummaryStats({ summary }: { summary: AppleHealthSummary }) {
  const { recordCounts, dateRange, typesSeen, profile } = summary;
  const days = Object.keys(summary.dailySummaries).length;

  return (
    <Card className="p-5">
      <h3 className="font-medium text-surface-950 mb-3 flex items-center gap-2">
        <Activity className="w-4 h-4 text-accent-400" />
        Summary
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[11px] text-surface-600 uppercase tracking-wide">Records</div>
          <div className="font-mono text-xl text-surface-950 tabular-nums">
            {recordCounts.totalRecords.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-surface-600 uppercase tracking-wide">Workouts</div>
          <div className="font-mono text-xl text-surface-950 tabular-nums">
            {recordCounts.totalWorkouts.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-surface-600 uppercase tracking-wide">Days covered</div>
          <div className="font-mono text-xl text-surface-950 tabular-nums">
            {days.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-surface-600 uppercase tracking-wide">Metric types</div>
          <div className="font-mono text-xl text-surface-950 tabular-nums">
            {typesSeen.numeric.length + typesSeen.category.length}
          </div>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="flex items-center gap-2 text-surface-700">
          <CalendarRange className="w-3.5 h-3.5 text-surface-500" />
          <span>
            {dateRange.start ?? '—'} → {dateRange.end ?? '—'}
          </span>
        </div>
        {profile.biologicalSex && (
          <div className="flex items-center gap-2 text-surface-700">
            <TrendingUp className="w-3.5 h-3.5 text-surface-500" />
            <span>
              {profile.biologicalSex}
              {profile.dateOfBirth ? ` · born ${profile.dateOfBirth}` : ''}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Workout list — condensed table of all workouts
// ---------------------------------------------------------------------------
function WorkoutList({ summary }: { summary: AppleHealthSummary }) {
  const [expanded, setExpanded] = useState(false);
  // Show most-recent first
  const sorted = [...summary.workouts].sort((a, b) => b.start.localeCompare(a.start));
  const visible = expanded ? sorted : sorted.slice(0, 10);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-surface-950">
          Workouts ({summary.workouts.length.toLocaleString()})
        </h3>
        {sorted.length > 10 && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : `Show all (${sorted.length})`}
          </Button>
        )}
      </div>
      {sorted.length === 0 ? (
        <div className="text-sm text-surface-600 py-4">No workouts in this export.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3 text-right">Duration</th>
                <th className="py-2 pr-3 text-right">Distance</th>
                <th className="py-2 pr-3 text-right">Energy</th>
                <th className="py-2 pr-3 text-right">Avg HR</th>
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
                    className="border-b border-border/30 hover:bg-surface-100/30"
                  >
                    <td className="py-2 pr-3 font-medium text-surface-950">{w.type}</td>
                    <td className="py-2 pr-3 text-surface-700 font-mono text-xs">
                      {w.start.slice(0, 10)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {w.durationMinutes !== undefined ? w.durationMinutes.toFixed(0) + 'm' : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {dist?.sum !== undefined ? `${dist.sum.toFixed(2)} ${dist.unit ?? ''}` : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {energy?.sum !== undefined
                        ? `${energy.sum.toFixed(0)} ${energy.unit ?? ''}`
                        : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {hr?.avg !== undefined ? hr.avg.toFixed(0) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
