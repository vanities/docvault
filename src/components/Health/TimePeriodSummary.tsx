// Time period summary cards — Today / This Week / This Month / This Year.
// Each card shows key stats with delta indicators vs the previous period.

import { useState } from 'react';
import { Calendar, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card } from '@/components/ui/card';
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
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-500">
        <TrendingUp className="w-3 h-3" />+{display}
      </span>
    );
  }
  if (pct < -1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-rose-400">
        <TrendingDown className="w-3 h-3" />-{display}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-surface-500">
      <Minus className="w-3 h-3" />
      ~0%
    </span>
  );
}

export function TimePeriodSummary({ periods }: TimePeriodSummaryProps) {
  const [selected, setSelected] = useState(1); // default to "This Week"

  if (periods.length === 0) return null;

  const period = periods[selected] ?? periods[0];

  return (
    <div>
      <h3 className="text-xs font-semibold text-surface-600 uppercase tracking-[0.12em] mb-2 flex items-center gap-1.5">
        <Calendar className="w-3 h-3" />
        Period summary
      </h3>

      {/* Period tabs */}
      <div className="flex gap-1 mb-3">
        {periods.map((p, i) => (
          <button
            key={p.name}
            type="button"
            onClick={() => setSelected(i)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              i === selected
                ? 'bg-surface-900 text-white'
                : 'bg-surface-100/50 text-surface-600 hover:bg-surface-200/50'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Stat cards for the selected period */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {period.stats.map((stat) => (
          <Card key={stat.label} className="p-3">
            <div className="text-[10px] uppercase tracking-wide text-surface-600 mb-1">
              {stat.label}
            </div>
            <div className="font-mono text-base text-surface-950 tabular-nums leading-tight">
              {stat.formatted}
            </div>
            <div className="mt-1">
              <DeltaBadge pct={stat.deltaPct} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
