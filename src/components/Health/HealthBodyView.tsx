// Body segment view — weight trend + height.

import { Scale, Ruler, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SegmentViewShell } from './SegmentViewShell';
import { HealthChart } from './HealthChart';
import { InsightsRow } from './InsightsRow';
import { CollapsibleTable } from './CollapsibleTable';
import { TimePeriodSummary } from './TimePeriodSummary';
import { StatTile } from './StatTile';
import { ChartCard } from './ChartCard';
import { formatDecimal1 } from './healthFormatters';
import type { PeriodSummary } from './types';

function trendIcon(delta: number | null): LucideIcon {
  if (delta === null) return Minus;
  if (delta > 0.1) return TrendingUp;
  if (delta < -0.1) return TrendingDown;
  return Minus;
}

function trendColor(delta: number | null): string {
  if (delta === null) return 'text-surface-500';
  if (delta > 0.1) return 'text-amber-400';
  if (delta < -0.1) return 'text-emerald-400';
  return 'text-surface-500';
}

export function HealthBodyView() {
  return (
    <SegmentViewShell
      segment="body"
      title="Body"
      subtitle="Weight, height"
      icon={Scale}
      accent="sky"
    >
      {(data) => {
        const Trend30 = trendIcon(data.headline.change30d);
        const Trend1y = trendIcon(data.headline.change1y);

        // Most weight series are clinic-visit-cadenced (a few readings per
        // year). "Avg weight this week vs last week" is rarely meaningful
        // against that pattern, so hide the period summary block whenever
        // no period has any data. Keeps the layout focused on what's
        // actually informative.
        const hasPeriodData = data.periods.some((p: PeriodSummary) =>
          p.stats.some((s) => s.value !== 0 && s.value !== null)
        );

        // Count readings in the last 90 days to decide whether 30d/1y
        // stat tiles should show an explanatory empty caption vs a plain
        // dash. This is separate from the snapshot's change30d/change1y
        // which look for anchor points within ±14d / ±60d tolerance.
        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const recentCount = data.weightHistory.filter(
          (w) => new Date(`${w.date}T00:00:00Z`).getTime() >= ninetyDaysAgo
        ).length;
        const noRecentWeights = recentCount === 0 && data.weightHistory.length > 0;
        // Show a hint caption instead of a blank dash when the last reading
        // is too old for a clean 30-day or 1-year delta.
        const sparseCaption = noRecentWeights ? 'No reading within tolerance' : undefined;

        // Current-weight tile shows which source the headline number came
        // from. Clinical values are audited — smart scales are convenience.
        const latest = data.weightHistory[data.weightHistory.length - 1];
        const sourceLabel = latest
          ? latest.source === 'clinical'
            ? 'clinical (VA)'
            : 'apple-health'
          : undefined;
        const currentCaption =
          data.headline.currentKg !== null
            ? `${formatDecimal1(data.headline.currentKg)} kg${sourceLabel ? ` · ${sourceLabel}` : ''}`
            : undefined;

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatTile
                icon={Scale}
                label="Current weight"
                value={
                  data.headline.currentLb !== null
                    ? `${formatDecimal1(data.headline.currentLb)} lb`
                    : '—'
                }
                caption={currentCaption}
                color="text-sky-400"
              />
              <StatTile
                icon={Trend30}
                label="30-day change"
                value={
                  data.headline.change30d !== null
                    ? `${data.headline.change30d > 0 ? '+' : ''}${formatDecimal1(data.headline.change30d * 2.20462)} lb`
                    : '—'
                }
                caption={data.headline.change30d === null ? sparseCaption : undefined}
                color={trendColor(data.headline.change30d)}
              />
              <StatTile
                icon={Trend1y}
                label="1-year change"
                value={
                  data.headline.change1y !== null
                    ? `${data.headline.change1y > 0 ? '+' : ''}${formatDecimal1(data.headline.change1y * 2.20462)} lb`
                    : '—'
                }
                caption={data.headline.change1y === null ? sparseCaption : undefined}
                color={trendColor(data.headline.change1y)}
              />
              <StatTile
                icon={Ruler}
                label="Height"
                value={
                  data.heightIn !== null
                    ? `${Math.floor(data.heightIn / 12)}' ${Math.round(data.heightIn % 12)}"`
                    : '—'
                }
                caption={data.heightCm !== null ? `${formatDecimal1(data.heightCm)} cm` : undefined}
                color="text-violet-400"
              />
            </div>

            {hasPeriodData && <TimePeriodSummary periods={data.periods} />}
            <InsightsRow insights={data.insights} />

            <ChartCard icon={Scale} title="Weight trend" color="text-sky-400">
              {data.weightHistory.length === 0 ? (
                <div className="text-sm text-surface-600 py-8 text-center">
                  No weight measurements in this export.
                </div>
              ) : (
                <HealthChart
                  data={data.weightHistory}
                  lines={[{ key: 'lb', label: 'Weight (lb)', color: '#0ea5e9' }]}
                  valueFormatter={(v) => `${v.toFixed(1)} lb`}
                  defaultRange="ALL"
                  defaultMode="line"
                />
              )}
            </ChartCard>

            {(() => {
              const reversed = [...data.weightHistory].reverse();
              const firstLb = data.weightHistory.length > 0 ? data.weightHistory[0].lb : 0;
              return (
                <CollapsibleTable
                  title="Weight history"
                  totalRows={reversed.length}
                  head={
                    <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                      <th className="py-2 px-4">Date</th>
                      <th className="py-2 px-3 text-right">Weight (lb)</th>
                      <th className="py-2 px-3 text-right">Weight (kg)</th>
                      <th className="py-2 px-3 text-right">delta from first</th>
                      <th className="py-2 px-3">Source</th>
                    </tr>
                  }
                  rows={reversed.map((w) => {
                    const delta = w.lb - firstLb;
                    const sourceBadge =
                      w.source === 'clinical' ? (
                        <span className="text-[10px] font-medium text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">
                          clinical
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded">
                          apple-health
                        </span>
                      );
                    return (
                      <tr
                        key={`${w.date}-${w.source}`}
                        className="border-b border-border/20 hover:bg-surface-100/30 transition-colors"
                      >
                        <td className="py-1.5 px-4 text-surface-700 font-mono text-xs">{w.date}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                          {formatDecimal1(w.lb)}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                          {formatDecimal1(w.kg)}
                        </td>
                        <td
                          className={`py-1.5 px-3 text-right font-mono tabular-nums ${delta > 0 ? 'text-amber-400' : delta < 0 ? 'text-emerald-400' : 'text-surface-500'}`}
                        >
                          {delta > 0 ? '+' : ''}
                          {formatDecimal1(delta)}
                        </td>
                        <td className="py-1.5 px-3">{sourceBadge}</td>
                      </tr>
                    );
                  })}
                />
              );
            })()}
          </div>
        );
      }}
    </SegmentViewShell>
  );
}
