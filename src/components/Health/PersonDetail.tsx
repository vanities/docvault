// Person detail — upload exports, trigger parsing, view parsed summaries.
//
// Flow:
//   1. List exports already uploaded (with "Parsed" badge if summary exists).
//   2. Upload new export.zip → lands in data/health/<personId>/exports/.
//   3. Click "Parse" → server streams the XML and stores a summary.
//   4. When parsed, the DailySummaryTable is rendered below.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload,
  FileArchive,
  CheckCircle2,
  PlayCircle,
  Loader2,
  AlertCircle,
  RefreshCw,
  CalendarRange,
  Activity,
  TrendingUp,
} from 'lucide-react';
import type { HealthPerson } from '../../hooks/useFileSystemServer';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useHealthApi } from './useHealthApi';
import type { AppleHealthSummary, ExportInfo } from './types';
import { DailySummaryTable } from './DailySummaryTable';

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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [parsingFilename, setParsingFilename] = useState<string | null>(null);
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
          // Summary load failure is non-fatal — user can click Parse
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

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      // fetch() doesn't give upload progress without XMLHttpRequest, and
      // that's more complexity than this flow needs for now. Just show
      // an indeterminate spinner.
      await api.uploadExport(person.id, file);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleParse = async (filename: string) => {
    setParsingFilename(filename);
    setError(null);
    try {
      const s = await api.parseExport(person.id, filename);
      setSummary(s);
      setSelectedFilename(filename);
      // Refresh to update the "parsed" flags on the list
      const list = await api.listExports(person.id);
      setExports(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsingFilename(null);
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

      {/* Upload zone */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center flex-shrink-0">
            <Upload className="w-5 h-5 text-accent-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-surface-950">Upload Apple Health Export</h3>
            <p className="text-xs text-surface-600 mt-1">
              On your iPhone: Health → profile picture → Export All Health Data → share the{' '}
              <code className="font-mono text-surface-800">export.zip</code> to this machine, then
              upload it here.
            </p>
            <div className="mt-3 flex items-center gap-3">
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
                disabled={uploading}
                className="gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading{uploadProgress ? ` ${uploadProgress}%` : '…'}
                  </>
                ) : (
                  <>
                    <FileArchive className="w-4 h-4" />
                    Choose export.zip
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Exports list */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-surface-950">Exports</h3>
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        {loading ? (
          <div className="text-sm text-surface-600 py-4">Loading…</div>
        ) : exports.length === 0 ? (
          <div className="text-sm text-surface-600 py-4">
            No exports uploaded yet. Upload an <code>export.zip</code> above to get started.
          </div>
        ) : (
          <div className="space-y-1.5">
            {exports.map((exp) => {
              const isSelected = exp.filename === selectedFilename;
              const isParsing = exp.filename === parsingFilename;
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
                      className="text-emerald-400 flex items-center gap-1 text-xs hover:underline"
                      onClick={() => void handleSelectSummary(exp.filename)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Parsed
                    </button>
                  )}
                  <Button
                    variant={exp.parsed ? 'ghost' : 'default'}
                    size="sm"
                    onClick={() => void handleParse(exp.filename)}
                    disabled={isParsing}
                    className="gap-1.5"
                  >
                    {isParsing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Parsing…
                      </>
                    ) : (
                      <>
                        <PlayCircle className="w-3.5 h-3.5" />
                        {exp.parsed ? 'Re-parse' : 'Parse'}
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Parse-in-progress notice */}
      {parsingFilename && (
        <Card className="p-5 border-accent-500/30 bg-accent-500/5">
          <div className="flex items-center gap-3 text-accent-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <div>
              <div className="font-medium">Parsing {parsingFilename}…</div>
              <div className="text-xs text-surface-700 mt-0.5">
                Streaming ~1 GB of XML, this usually takes 20–60 seconds.
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Summary — stats + daily table */}
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
