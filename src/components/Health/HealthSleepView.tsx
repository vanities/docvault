// Sleep segment view — duration, stages, respiratory rate, wrist temp.

import { Moon, Clock, Award, BedDouble, Star } from 'lucide-react';
import { SegmentViewShell } from './SegmentViewShell';
import { HealthChart } from './HealthChart';
import { InsightsRow } from './InsightsRow';
import { CollapsibleTable } from './CollapsibleTable';
import { TimePeriodSummary } from './TimePeriodSummary';
import { ScoreGauge } from './ScoreGauge';
import { StatTile } from './StatTile';
import { ChartCard } from './ChartCard';
import { formatHours, formatMinutes } from './healthFormatters';

/** Convert minutes to "Xh Ym" for labels. */
function hmLabel(min: number): string {
  if (!Number.isFinite(min) || min === 0) return '0h';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function HealthSleepView() {
  return (
    <SegmentViewShell
      segment="sleep"
      title="Sleep"
      subtitle="Duration, stages, recovery signals"
      icon={Moon}
      accent="violet"
    >
      {(data) => {
        const chartData = data.daily.map((d) => ({
          date: d.date,
          asleepHours: d.asleepMinutes / 60,
          deepHours: (d.deepMinutes ?? 0) / 60,
          remHours: (d.remMinutes ?? 0) / 60,
          coreHours: (d.coreMinutes ?? 0) / 60,
          awakeHours: (d.awakeMinutes ?? 0) / 60,
          respiratoryRate: d.respiratoryRate ?? 0,
        }));

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatTile
                icon={Clock}
                label="90-day average"
                value={formatHours(data.headline.avgSleepHours90d)}
                color="text-violet-400"
              />
              <StatTile
                icon={BedDouble}
                label="All-time average"
                value={formatHours(data.headline.avgSleepHoursAll)}
                color="text-blue-400"
              />
              <StatTile
                icon={Award}
                label="Nights with 7+ hrs"
                value={`${data.headline.nightsWith7Plus}`}
                color="text-emerald-400"
              />
              <StatTile
                icon={Moon}
                label="Nights with 5+ hrs"
                value={`${data.headline.nightsWith5Plus}`}
                color="text-sky-400"
              />
            </div>

            {/* Sleep quality score — latest night */}
            {data.qualityScores.length > 0 &&
              (() => {
                const latest = data.qualityScores[data.qualityScores.length - 1];
                return (
                  <ScoreGauge
                    label="Sleep Quality Score"
                    score={latest.score}
                    icon={Star}
                    components={[
                      { label: 'Duration', value: latest.components.duration },
                      { label: 'Consistency', value: latest.components.consistency },
                      { label: 'Interruptions', value: latest.components.interruptions },
                    ]}
                  />
                );
              })()}

            <TimePeriodSummary periods={data.periods} />
            <InsightsRow insights={data.insights} />

            {data.headline.longestSleep && (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <Award className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <div className="text-[10px] text-surface-600 uppercase tracking-[0.08em] font-medium">
                      Longest sleep
                    </div>
                    <div className="font-mono text-surface-950 tabular-nums">
                      {data.headline.longestSleep.date} —{' '}
                      {hmLabel(data.headline.longestSleep.minutes)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <ChartCard icon={Moon} title="Nightly sleep duration" color="text-violet-400">
              <HealthChart
                data={chartData}
                lines={[{ key: 'asleepHours', label: 'Asleep', color: '#a855f7' }]}
                valueFormatter={(v) => formatHours(v)}
                defaultRange="3M"
              />
            </ChartCard>

            <ChartCard icon={BedDouble} title="Sleep stages" color="text-violet-400">
              <HealthChart
                data={chartData}
                lines={[
                  { key: 'deepHours', label: 'Deep', color: '#6366f1' },
                  { key: 'remHours', label: 'REM', color: '#8b5cf6' },
                  { key: 'coreHours', label: 'Core', color: '#a78bfa' },
                  { key: 'awakeHours', label: 'Awake', color: '#f59e0b' },
                ]}
                valueFormatter={(v) => formatHours(v)}
                defaultRange="1M"
                defaultMode="line"
              />
            </ChartCard>

            {(() => {
              const recentNights = data.daily.slice().reverse();
              return (
                <CollapsibleTable
                  title="Nightly sleep"
                  totalRows={recentNights.length}
                  head={
                    <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                      <th className="py-2 px-4">Date</th>
                      <th className="py-2 px-3 text-right">Total</th>
                      <th className="py-2 px-3 text-right">Deep</th>
                      <th className="py-2 px-3 text-right">REM</th>
                      <th className="py-2 px-3 text-right">Core</th>
                      <th className="py-2 px-3 text-right">Awake</th>
                      <th className="py-2 px-3 text-right">Resp</th>
                    </tr>
                  }
                  rows={recentNights.map((d) => (
                    <tr
                      key={d.date}
                      className="border-b border-border/20 hover:bg-surface-100/30 transition-colors"
                    >
                      <td className="py-1.5 px-4 text-surface-700 font-mono text-xs">{d.date}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {formatMinutes(d.asleepMinutes)}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.deepMinutes !== null ? formatMinutes(d.deepMinutes) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.remMinutes !== null ? formatMinutes(d.remMinutes) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.coreMinutes !== null ? formatMinutes(d.coreMinutes) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.awakeMinutes !== null ? formatMinutes(d.awakeMinutes) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                        {d.respiratoryRate !== null ? d.respiratoryRate.toFixed(1) : '—'}
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
