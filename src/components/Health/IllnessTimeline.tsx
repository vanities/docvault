// Illness timeline — shows auto-detected periods where vitals suggest illness.

import { useState } from 'react';
import { Thermometer, ChevronDown, ChevronUp, AlertTriangle, ShieldAlert } from 'lucide-react';
import type { IllnessPeriod } from './types';

interface IllnessTimelineProps {
  periods: IllnessPeriod[];
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' };

  // Same year as current? Omit year. Different year? Show it.
  const currentYear = new Date().getFullYear();
  const startYear = s.getUTCFullYear();

  if (start === end) {
    return s.toLocaleDateString('en-US', startYear === currentYear ? opts : yearOpts);
  }

  const startStr = s.toLocaleDateString('en-US', startYear === currentYear ? opts : yearOpts);
  const endStr = e.toLocaleDateString('en-US', opts);
  return `${startStr} – ${endStr}`;
}

export function IllnessTimeline({ periods }: IllnessTimelineProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (periods.length === 0) return null;

  // Sort most recent first
  const sorted = [...periods].sort((a, b) => b.startDate.localeCompare(a.startDate));

  return (
    <div className="rounded-xl border border-border/40 bg-surface-50/30 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <Thermometer className="w-3.5 h-3.5 text-amber-400" />
        <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-[0.12em]">
          Detected illness periods
        </h3>
        <span className="text-[11px] font-mono text-surface-500 tabular-nums">
          ({sorted.length})
        </span>
      </div>

      <div className="divide-y divide-border/20">
        {sorted.map((period) => {
          const key = `${period.startDate}-${period.endDate}`;
          const isExpanded = expanded === key;
          const ConfidenceIcon = period.confidence === 'likely' ? ShieldAlert : AlertTriangle;
          const confidenceColor =
            period.confidence === 'likely' ? 'text-rose-400' : 'text-amber-400';
          const confidenceBg =
            period.confidence === 'likely' ? 'bg-rose-500/10' : 'bg-amber-500/10';

          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : key)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-100/30 transition-colors"
              >
                <div
                  className={`w-8 h-8 rounded-lg ${confidenceBg} flex items-center justify-center flex-shrink-0`}
                >
                  <ConfidenceIcon className={`w-4 h-4 ${confidenceColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-surface-950">
                      {formatDateRange(period.startDate, period.endDate)}
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${
                        period.confidence === 'likely'
                          ? 'bg-rose-500/10 text-rose-400'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}
                    >
                      {period.confidence}
                    </span>
                  </div>
                  <div className="text-[11px] text-surface-600 mt-0.5">
                    {period.durationDays} day{period.durationDays === 1 ? '' : 's'} &middot;{' '}
                    {period.peakSignals} peak signals
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-surface-500 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-surface-500 flex-shrink-0" />
                )}
              </button>

              {isExpanded && (
                <div className="px-4 pb-3 pl-[60px]">
                  <div className="text-[11px] text-surface-600 uppercase font-semibold mb-1.5">
                    Signals detected
                  </div>
                  <ul className="space-y-1">
                    {period.signals.map((signal, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-surface-700">
                        <span
                          className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            signal.includes('elevated') ||
                            signal.includes('depressed') ||
                            signal.includes('low')
                              ? 'bg-rose-400'
                              : 'bg-amber-400'
                          }`}
                        />
                        <span className="font-mono">{signal}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
