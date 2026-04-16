// Heart segment view — resting HR, avg HR, HRV, recovery.

import { HeartPulse, TrendingDown, TrendingUp, Minus, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SegmentViewShell } from './SegmentViewShell';
import { HealthChart } from './HealthChart';
import { InsightsRow } from './InsightsRow';
import { CollapsibleTable } from './CollapsibleTable';
import { TimePeriodSummary } from './TimePeriodSummary';
import { StatTile } from './StatTile';
import { ChartCard } from './ChartCard';
import { formatBpm, formatDecimal1 } from './healthFormatters';

export function HealthHeartView() {
  return (
    <SegmentViewShell
      segment="heart"
      title="Heart"
      subtitle="Resting HR, HRV, recovery"
      icon={HeartPulse}
      accent="rose"
    >
      {(data) => {
        const restingTrendIcon: LucideIcon =
          data.headline.restingHRTrend === 'improving'
            ? TrendingDown
            : data.headline.restingHRTrend === 'worsening'
              ? TrendingUp
              : Minus;
        const restingTrendColor =
          data.headline.restingHRTrend === 'improving'
            ? 'text-emerald-400'
            : data.headline.restingHRTrend === 'worsening'
              ? 'text-rose-400'
              : 'text-surface-500';

        const hrvTrendIcon: LucideIcon =
          data.headline.hrvTrend === 'up'
            ? TrendingUp
            : data.headline.hrvTrend === 'down'
              ? TrendingDown
              : Minus;
        const hrvTrendColor =
          data.headline.hrvTrend === 'up'
            ? 'text-emerald-400'
            : data.headline.hrvTrend === 'down'
              ? 'text-rose-400'
              : 'text-surface-500';

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatTile
                icon={HeartPulse}
                label="Current resting HR"
                value={
                  data.headline.latestRestingHR !== null
                    ? formatBpm(data.headline.latestRestingHR)
                    : '—'
                }
                color="text-rose-400"
              />
              <StatTile
                icon={restingTrendIcon}
                label="90-day resting avg"
                value={
                  data.headline.avgRestingHR90d !== null
                    ? formatBpm(data.headline.avgRestingHR90d)
                    : '—'
                }
                color={restingTrendColor}
                caption={data.headline.restingHRTrend}
              />
              <StatTile
                icon={Zap}
                label="HRV (SDNN, last)"
                value={
                  data.headline.latestHRV !== null
                    ? `${formatDecimal1(data.headline.latestHRV)} ms`
                    : '—'
                }
                color="text-violet-400"
              />
              <StatTile
                icon={hrvTrendIcon}
                label="90-day HRV avg"
                value={
                  data.headline.avgHRV90d !== null
                    ? `${formatDecimal1(data.headline.avgHRV90d)} ms`
                    : '—'
                }
                color={hrvTrendColor}
                caption={data.headline.hrvTrend}
              />
            </div>

            <TimePeriodSummary periods={data.periods} />
            <InsightsRow insights={data.insights} />

            <ChartCard icon={HeartPulse} title="Resting heart rate" color="text-rose-400">
              <HealthChart
                data={data.daily}
                lines={[{ key: 'restingHR', label: 'Resting HR', color: '#f43f5e' }]}
                valueFormatter={formatBpm}
                defaultRange="6M"
              />
            </ChartCard>

            <ChartCard icon={Zap} title="Heart rate variability (SDNN)" color="text-violet-400">
              <HealthChart
                data={data.daily}
                lines={[{ key: 'hrv', label: 'HRV', color: '#a855f7' }]}
                valueFormatter={(v) => `${v.toFixed(1)} ms`}
                defaultRange="6M"
              />
            </ChartCard>

            <ChartCard
              icon={HeartPulse}
              title="Daily HR range (min / avg / max)"
              color="text-rose-400"
            >
              <HealthChart
                data={data.daily}
                lines={[
                  { key: 'minHR', label: 'Min', color: '#60a5fa' },
                  { key: 'avgHR', label: 'Avg', color: '#f59e0b' },
                  { key: 'maxHR', label: 'Max', color: '#f43f5e' },
                ]}
                valueFormatter={formatBpm}
                defaultRange="1M"
                defaultMode="line"
              />
            </ChartCard>

            {(() => {
              const recentDays = data.daily.slice().reverse();
              return (
                <CollapsibleTable
                  title="Daily heart metrics"
                  totalRows={recentDays.length}
                  head={
                    <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                      <th className="py-2 px-4">Date</th>
                      <th className="py-2 px-3 text-right">Resting HR</th>
                      <th className="py-2 px-3 text-right">Avg HR</th>
                      <th className="py-2 px-3 text-right">Min HR</th>
                      <th className="py-2 px-3 text-right">Max HR</th>
                      <th className="py-2 px-3 text-right">HRV</th>
                    </tr>
                  }
                  rows={recentDays.map((d) => (
                    <tr
                      key={d.date}
                      className="border-b border-border/20 hover:bg-surface-100/30 transition-colors"
                    >
                      <td className="py-1.5 px-4 text-surface-700 font-mono text-xs">{d.date}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.restingHR !== null ? Math.round(d.restingHR) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.avgHR !== null ? Math.round(d.avgHR) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.minHR !== null ? Math.round(d.minHR) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.maxHR !== null ? Math.round(d.maxHR) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.hrv !== null ? d.hrv.toFixed(1) : '—'}
                      </td>
                    </tr>
                  ))}
                />
              );
            })()}
          </div>
        );
      }}
    </SegmentViewShell>
  );
}
