// Health Analysis view — AI-generated health narratives saved by the
// /health-analysis skill. Mirrors StrategyView's pattern: immutable
// append-only entries with a compact signal grid + collapsible markdown
// body. Each entry is a point-in-time snapshot of the reasoning that
// produced it; the skill POSTs new entries after a conversation with
// the user.

import { useCallback, useEffect, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, HeartPulse, Terminal, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { API_BASE } from '../../constants';
import { BlurredMarkdown } from '../common/BlurredMarkdown';
import type { HealthAnalysisEntry, HealthAnalysisSignals } from './types';

// -- Signal formatting --------------------------------------------------------

/**
 * Human-readable labels + formatters for known signal keys. Unknown keys fall
 * through with their raw value so new signals added by the skill don't require
 * a code change to display.
 */
const SIGNAL_META: Record<string, { label: string; fmt?: (v: unknown) => string; color?: string }> =
  {
    ldl: { label: 'LDL-C', fmt: (v) => `${v}`, color: 'text-rose-400' },
    hdl: { label: 'HDL', fmt: (v) => `${v}`, color: 'text-emerald-400' },
    triglycerides: { label: 'TG', fmt: (v) => `${v}`, color: 'text-amber-400' },
    totalCholesterol: { label: 'Total chol', fmt: (v) => `${v}` },
    apoB: { label: 'ApoB', fmt: (v) => `${v}`, color: 'text-rose-400' },
    lpA: { label: 'Lp(a)', fmt: (v) => `${v}`, color: 'text-rose-400' },
    hba1c: { label: 'HbA1c', fmt: (v) => `${Number(v).toFixed(2)}%`, color: 'text-amber-400' },
    fastingGlucose: { label: 'Glucose', fmt: (v) => `${v}` },
    platelets: { label: 'PLT', fmt: (v) => `${v}`, color: 'text-cyan-400' },
    restingHR: { label: 'RHR', fmt: (v) => `${v} bpm`, color: 'text-rose-400' },
    hrv: { label: 'HRV', fmt: (v) => `${v} ms`, color: 'text-emerald-400' },
    avgSleepHours: { label: 'Sleep', fmt: (v) => `${Number(v).toFixed(1)}h` },
    avgDailySteps: { label: 'Steps', fmt: (v) => `${Number(v).toLocaleString()}` },
    weightKg: { label: 'Weight', fmt: (v) => `${v} kg` },
  };

function SignalGrid({ signals }: { signals: HealthAnalysisSignals }) {
  const entries = Object.entries(signals).filter(([, v]) => v != null);
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 mt-3">
      {entries.map(([key, val]) => {
        const meta = SIGNAL_META[key];
        const label = meta?.label ?? key;
        const formatted = meta?.fmt ? meta.fmt(val) : String(val);
        const color = meta?.color ?? 'text-surface-950';
        return (
          <div
            key={key}
            className="px-2 py-1.5 rounded-lg bg-surface-100/30 border border-border/20"
          >
            <div className="text-[9px] text-surface-700 uppercase tracking-wider font-medium">
              {label}
            </div>
            <div className={`text-[12px] font-bold font-mono leading-tight ${color}`}>
              {formatted}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// -- Card ---------------------------------------------------------------------

function AnalysisCard({
  entry,
  onDelete,
  defaultExpanded = false,
}: {
  entry: HealthAnalysisEntry;
  onDelete: (id: string) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const date = new Date(entry.createdAt);
  const dateStr = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card variant="glass" className="p-3 md:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-mono text-surface-700">
              {dateStr} {timeStr}
            </span>
            <span className="text-[10px] text-surface-700">by {entry.author}</span>
            {entry.tags && entry.tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {entry.tags.map((t) => (
                  <span
                    key={t}
                    className="text-[9px] uppercase tracking-wider bg-surface-100/50 text-surface-700 px-1.5 py-0.5 rounded"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <h4 className="text-sm md:text-[14px] font-semibold text-surface-950 leading-snug">
            {entry.title}
          </h4>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => onDelete(entry.id)}
            className="p-1.5 rounded-lg text-surface-700 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg text-surface-700 hover:text-accent-400 hover:bg-accent-500/10 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <SignalGrid signals={entry.signals} />

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-relaxed [&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:text-surface-950 [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-surface-950 [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:text-surface-800 [&_p]:mb-2 [&_ul]:text-surface-800 [&_ul]:mb-2 [&_li]:mb-1 [&_strong]:text-surface-950 [&_code]:text-cyan-400 [&_code]:bg-surface-100/40 [&_code]:px-1 [&_code]:rounded [&_table]:w-full [&_table]:text-[12px] [&_table]:border-collapse [&_table]:my-3 [&_th]:text-left [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-surface-700 [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-[10px] [&_th]:border-b [&_th]:border-border/40 [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-surface-800 [&_td]:border-b [&_td]:border-border/20 [&_tr:hover]:bg-surface-100/20">
            <BlurredMarkdown>{entry.body}</BlurredMarkdown>
          </div>
        </div>
      )}
    </Card>
  );
}

// -- Main view ---------------------------------------------------------------

export function HealthAnalysisView() {
  const [entries, setEntries] = useState<HealthAnalysisEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/health-analysis`);
      const json = (await res.json()) as { entries?: HealthAnalysisEntry[] };
      setEntries(json.entries ?? []);
    } catch {
      // empty list on failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${API_BASE}/health-analysis/${id}`, { method: 'DELETE' });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-10">
      <div className="mb-6">
        <h2 className="text-2xl md:text-3xl font-bold text-surface-950 flex items-center gap-2">
          <HeartPulse className="w-6 h-6 text-rose-400" />
          Health Analysis
        </h2>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed max-w-2xl">
          AI-generated health narratives that weave your snapshot data — labs, DNA, activity,
          supplements, sickness history — into actionable interpretation. Each entry is a
          point-in-time reasoning snapshot. Create new ones via the{' '}
          <code className="text-[12px] bg-surface-100/50 text-accent-400 px-1 rounded">
            /health-analysis
          </code>{' '}
          skill.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Activity className="w-5 h-5 text-accent-400 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <Card variant="glass" className="p-6 md:p-8 text-center space-y-3">
          <Terminal className="w-8 h-8 text-surface-600 mx-auto" />
          <h3 className="font-display italic text-lg text-surface-950">No analyses yet</h3>
          <p className="text-sm text-surface-700 max-w-md mx-auto">
            Trigger the{' '}
            <code className="text-xs bg-surface-100/50 text-accent-400 px-1 rounded">
              /health-analysis
            </code>{' '}
            skill in Claude Code. The conversation that follows becomes one of these cards, saved
            permanently so you can revisit the reasoning later.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, i) => (
            <AnalysisCard
              key={entry.id}
              entry={entry}
              onDelete={handleDelete}
              defaultExpanded={i === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
