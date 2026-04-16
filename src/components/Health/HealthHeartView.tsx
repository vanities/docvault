// Heart segment view — resting HR, avg HR, HRV, recovery.

import { HeartPulse, TrendingDown, TrendingUp, Minus, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SegmentViewShell } from './SegmentViewShell';
import { HealthChart } from './HealthChart';
import { InsightsRow } from './InsightsRow';
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

            <InsightsRow insights={data.insights} />

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <HeartPulse className="w-4 h-4 text-rose-400" />
                <h3 className="font-medium text-surface-950">Resting heart rate</h3>
              </div>
              <HealthChart
                data={data.daily}
                lines={[{ key: 'restingHR', label: 'Resting HR', color: '#f43f5e' }]}
                valueFormatter={formatBpm}
                defaultRange="6M"
              />
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-violet-400" />
                <h3 className="font-medium text-surface-950">Heart rate variability (SDNN)</h3>
              </div>
              <HealthChart
                data={data.daily}
                lines={[{ key: 'hrv', label: 'HRV', color: '#a855f7' }]}
                valueFormatter={(v) => `${v.toFixed(1)} ms`}
                defaultRange="6M"
              />
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <HeartPulse className="w-4 h-4 text-rose-400" />
                <h3 className="font-medium text-surface-950">Daily HR range (min / avg / max)</h3>
              </div>
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
            </Card>

            <Card className="p-5">
              <h3 className="font-medium text-surface-950 mb-3">Last 14 days</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3 text-right">Resting HR</th>
                      <th className="py-2 pr-3 text-right">Avg HR</th>
                      <th className="py-2 pr-3 text-right">Min HR</th>
                      <th className="py-2 pr-3 text-right">Max HR</th>
                      <th className="py-2 pr-3 text-right">HRV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily
                      .slice(-14)
                      .reverse()
                      .map((d) => (
                        <tr
                          key={d.date}
                          className="border-b border-border/30 hover:bg-surface-100/30"
                        >
                          <td className="py-1.5 pr-3 text-surface-700 font-mono text-xs">
                            {d.date}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.restingHR !== null ? Math.round(d.restingHR) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.avgHR !== null ? Math.round(d.avgHR) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.minHR !== null ? Math.round(d.minHR) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.maxHR !== null ? Math.round(d.maxHR) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.hrv !== null ? d.hrv.toFixed(1) : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      }}
    </SegmentViewShell>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  color,
  caption,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  color: string;
  caption?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <div className="text-[10px] uppercase tracking-wide text-surface-600">{label}</div>
      </div>
      <div className="font-mono text-xl text-surface-950 tabular-nums">{value}</div>
      {caption && (
        <div className={`text-[10px] mt-0.5 uppercase tracking-wide ${color}`}>{caption}</div>
      )}
    </Card>
  );
}
