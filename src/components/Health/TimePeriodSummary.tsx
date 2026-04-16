// Time period summary cards — Today / This Week / This Month / This Year.
// Each card shows key stats with delta indicators vs the previous period.

import { useState } from 'react';
import { Calendar, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { PeriodSummary } from './types';

interface TimePeriodSummaryProps {
  periods: PeriodSummary[];
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const abs = Math.abs(pct);
  const display = abs >= 1 ? `${Math.round(abs)}%` : `${abs.toFixed(1)}%`;

  if (pct > 1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
        <TrendingUp className="w-2.5 h-2.5" />+{display}
      </span>
    );
  }
  if (pct < -1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded-full">
        <TrendingDown className="w-2.5 h-2.5" />-{display}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-surface-600 bg-surface-200/40 px-1.5 py-0.5 rounded-full">
      <Minus className="w-2.5 h-2.5" />
      ~0%
    </span>
  );
}

export function TimePeriodSummary({ periods }: TimePeriodSummaryProps) {
  const [selected, setSelected] = useState(1); // default to "This Week"

  if (periods.length === 0) return null;

  const period = periods[selected] ?? periods[0];

  return (
    <div className="rounded-xl border border-border/40 bg-surface-50/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold text-surface-600 uppercase tracking-[0.12em] flex items-center gap-1.5">
          <Calendar className="w-3 h-3 text-accent-400" />
          Period summary
        </h3>

        {/* Period tabs */}
        <div className="flex gap-0.5 bg-surface-200/30 rounded-lg p-0.5">
          {periods.map((p, i) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setSelected(i)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                i === selected
                  ? 'bg-accent-500 text-white shadow-sm'
                  : 'text-surface-600 hover:text-surface-900'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards for the selected period */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {period.stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg bg-surface-100/60 border border-border/20 p-3"
          >
            <div className="text-[10px] uppercase tracking-[0.08em] text-surface-600 font-medium mb-1.5">
              {stat.label}
            </div>
            <div className="font-mono text-lg text-surface-950 tabular-nums leading-none">
              {stat.formatted}
            </div>
            <div className="mt-2">
              <DeltaBadge pct={stat.deltaPct} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
