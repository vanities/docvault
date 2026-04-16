// Daily summary table for a parsed Apple Health export.
//
// Design:
//   - Top bar: metric-type picker (multi-select) + aggregation picker (sum/avg/min/max)
//   - Table: one row per day, one column per selected metric
//   - Defaults to a reasonable set of metrics if available: steps, active energy,
//     heart rate, sleep, etc. — but all 40+ types are available in the picker.
//   - Date range filter: "last 30 days", "last 90 days", "last year", "all"

import { useState, useMemo } from 'react';
import { Calendar, ChevronDown, ChevronUp, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AppleHealthSummary, DailySummary, NumericAggregate } from './types';

type Aggregation = 'sum' | 'avg' | 'min' | 'max' | 'last' | 'count';
type DateRange = '30' | '90' | '365' | 'all';

const AGGREGATIONS: Array<{ id: Aggregation; label: string }> = [
  { id: 'sum', label: 'Sum' },
  { id: 'avg', label: 'Average' },
  { id: 'min', label: 'Min' },
  { id: 'max', label: 'Max' },
  { id: 'last', label: 'Latest' },
  { id: 'count', label: 'Count' },
];

const DATE_RANGES: Array<{ id: DateRange; label: string }> = [
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: '365', label: 'Last year' },
  { id: 'all', label: 'All time' },
];

// Metrics to show by default when the user first opens the view
const DEFAULT_METRICS = new Set([
  'StepCount',
  'ActiveEnergyBurned',
  'AppleExerciseTime',
  'HeartRate',
  'RestingHeartRate',
  'DistanceWalkingRunning',
  'FlightsClimbed',
]);

function extractValue(agg: NumericAggregate, mode: Aggregation): number {
  switch (mode) {
    case 'sum':
      return agg.sum;
    case 'avg':
      return agg.count > 0 ? agg.sum / agg.count : 0;
    case 'min':
      return agg.min;
    case 'max':
      return agg.max;
    case 'last':
      return agg.last;
    case 'count':
      return agg.count;
  }
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return value.toLocaleString();
  const abs = Math.abs(value);
  if (abs >= 1000) return Math.round(value).toLocaleString();
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

interface DailySummaryTableProps {
  summary: AppleHealthSummary;
}

export function DailySummaryTable({ summary }: DailySummaryTableProps) {
  const [aggregation, setAggregation] = useState<Aggregation>('sum');
  const [range, setRange] = useState<DateRange>('30');
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(() => {
    // Initialize with intersection of DEFAULT_METRICS and what's actually present
    return new Set(summary.typesSeen.numeric.filter((t) => DEFAULT_METRICS.has(t)));
  });
  const [showPicker, setShowPicker] = useState(false);

  // Compute the list of days, filtered by range, sorted descending
  const days: DailySummary[] = useMemo(() => {
    const all = Object.values(summary.dailySummaries).sort((a, b) => b.date.localeCompare(a.date));
    if (range === 'all') return all;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(range));
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return all.filter((d) => d.date >= cutoffStr);
  }, [summary.dailySummaries, range]);

  const metricsInOrder = useMemo(() => [...selectedMetrics].sort(), [selectedMetrics]);

  const toggleMetric = (type: string) => {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const [expanded, setExpanded] = useState(false);
  const defaultRowCount = 14;
  const canExpand = days.length > defaultRowCount;
  const visibleDays = canExpand && !expanded ? days.slice(0, defaultRowCount) : days.slice(0, 500);

  return (
    <div className="rounded-xl border border-border/40 bg-surface-50/30 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-wrap gap-2">
        <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-[0.12em] flex items-center gap-1.5">
          <Table2 className="w-3 h-3 text-surface-500" />
          Daily summaries
          <span className="text-surface-500 font-mono tabular-nums">
            ({days.length.toLocaleString()})
          </span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={range} onValueChange={(v) => setRange(v as DateRange)}>
            <SelectTrigger className="w-[140px] h-7 text-[11px]">
              <Calendar className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={aggregation} onValueChange={(v) => setAggregation(v as Aggregation)}>
            <SelectTrigger className="w-[100px] h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGGREGATIONS.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="xs" onClick={() => setShowPicker((v) => !v)}>
            Metrics ({selectedMetrics.size}){' '}
            {showPicker ? (
              <ChevronUp className="w-3 h-3 ml-1" />
            ) : (
              <ChevronDown className="w-3 h-3 ml-1" />
            )}
          </Button>
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
      </div>

      {/* Metric picker */}
      {showPicker && (
        <div className="px-4 py-3 border-b border-border/30 bg-surface-100/20">
          <div className="text-[11px] uppercase text-surface-600 font-semibold mb-2">
            Numeric metrics ({summary.typesSeen.numeric.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {summary.typesSeen.numeric.map((type) => {
              const selected = selectedMetrics.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleMetric(type)}
                  className={`px-2 py-1 rounded-md text-xs font-mono transition-colors ${
                    selected
                      ? 'bg-accent-500/15 text-accent-400 border border-accent-500/30'
                      : 'bg-surface-0 text-surface-700 border border-border hover:border-accent-500/20'
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>
          {summary.typesSeen.category.length > 0 && (
            <>
              <div className="text-[11px] uppercase text-surface-600 font-semibold mt-3 mb-2">
                Category metrics ({summary.typesSeen.category.length}) — not shown in table
              </div>
              <div className="flex flex-wrap gap-1.5">
                {summary.typesSeen.category.map((type) => (
                  <span
                    key={type}
                    className="px-2 py-1 rounded-md text-xs font-mono bg-surface-0 text-surface-600 border border-border"
                  >
                    {type}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        {days.length === 0 ? (
          <div className="text-sm text-surface-600 py-8 text-center">No data in this range.</div>
        ) : metricsInOrder.length === 0 ? (
          <div className="text-sm text-surface-600 py-8 text-center">
            Select one or more metrics above to display.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border sticky top-0 bg-surface-50">
                <th className="py-2 px-4">Date</th>
                {metricsInOrder.map((m) => (
                  <th key={m} className="py-2 px-3 text-right font-mono normal-case">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleDays.map((day) => (
                <tr
                  key={day.date}
                  className="border-b border-border/20 hover:bg-surface-100/30 transition-colors"
                >
                  <td className="py-1.5 px-4 text-surface-700 font-mono text-xs">{day.date}</td>
                  {metricsInOrder.map((m) => {
                    const agg = day.numeric[m];
                    return (
                      <td
                        key={m}
                        className="py-1.5 px-3 text-right font-mono tabular-nums text-surface-950"
                      >
                        {agg ? formatValue(extractValue(agg, aggregation)) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canExpand && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full py-2 text-[11px] text-surface-500 hover:text-accent-400 bg-surface-100/30 border-t border-border/20 transition-colors font-medium"
        >
          Show all {days.length.toLocaleString()} rows
        </button>
      )}
      {days.length > 500 && expanded && (
        <div className="text-[11px] text-surface-600 px-4 py-2 border-t border-border/20">
          Showing 500 of {days.length.toLocaleString()} rows. Use a narrower date range to see older
          data.
        </div>
      )}
    </div>
  );
}
