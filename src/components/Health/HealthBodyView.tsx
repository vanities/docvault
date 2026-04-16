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
                caption={
                  data.headline.currentKg !== null
                    ? `${formatDecimal1(data.headline.currentKg)} kg`
                    : undefined
                }
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

            <TimePeriodSummary periods={data.periods} />
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
                  defaultRange="1Y"
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
                    </tr>
                  }
                  rows={reversed.map((w) => {
                    const delta = w.lb - firstLb;
                    return (
                      <tr
                        key={w.date}
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
