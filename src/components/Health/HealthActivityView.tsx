// Activity segment view — steps, energy, exercise minutes, distance.

import {
  Activity as ActivityIcon,
  Footprints,
  Flame,
  Timer,
  Route,
  ShieldCheck,
} from 'lucide-react';
import { SegmentViewShell } from './SegmentViewShell';
import { HealthChart } from './HealthChart';
import { InsightsRow } from './InsightsRow';
import { CollapsibleTable } from './CollapsibleTable';
import { TimePeriodSummary } from './TimePeriodSummary';
import { ScoreGauge } from './ScoreGauge';
import { StatTile } from './StatTile';
import { ChartCard } from './ChartCard';
import { formatInt, formatDecimal1 } from './healthFormatters';

export function HealthActivityView() {
  return (
    <SegmentViewShell
      segment="activity"
      title="Activity"
      subtitle="Steps, energy, exercise, distance"
      icon={ActivityIcon}
      accent="emerald"
    >
      {(data) => (
        <div className="space-y-4">
          {/* Headline tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <StatTile
              icon={Footprints}
              label="Avg daily steps (90d)"
              value={formatInt(data.headline.avgDailySteps90d)}
              color="text-emerald-400"
            />
            <StatTile
              icon={Flame}
              label="Total active energy"
              value={`${formatInt(data.headline.totalActiveEnergy)} cal`}
              color="text-orange-400"
            />
            <StatTile
              icon={Timer}
              label="Total exercise minutes"
              value={formatInt(data.headline.totalExerciseMinutes)}
              color="text-sky-400"
            />
            <StatTile
              icon={Route}
              label={`Total distance (${data.distanceUnit})`}
              value={formatDecimal1(data.headline.totalDistance)}
              color="text-violet-400"
            />
          </div>

          {/* Recovery score — latest day */}
          {data.recoveryScores.length > 0 &&
            (() => {
              const latest = data.recoveryScores[data.recoveryScores.length - 1];
              return (
                <ScoreGauge
                  label="Recovery Score"
                  score={latest.score}
                  icon={ShieldCheck}
                  components={[
                    { label: 'HRV', value: latest.components.hrv },
                    { label: 'Sleep', value: latest.components.sleep },
                    { label: 'Resting HR', value: latest.components.restingHR },
                    { label: 'Load', value: latest.components.exerciseLoad },
                  ]}
                />
              );
            })()}

          <TimePeriodSummary periods={data.periods} />
          <InsightsRow insights={data.insights} />

          {/* Most active day callout */}
          {data.headline.mostActiveDay && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Footprints className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-[10px] text-surface-600 uppercase tracking-[0.08em] font-medium">
                    Most active day
                  </div>
                  <div className="font-mono text-surface-950 tabular-nums">
                    {data.headline.mostActiveDay.date} —{' '}
                    {formatInt(data.headline.mostActiveDay.steps)} steps
                  </div>
                </div>
              </div>
            </div>
          )}

          <ChartCard icon={Footprints} title="Daily steps" color="text-emerald-400">
            <HealthChart
              data={data.daily}
              lines={[
                { key: 'steps', label: 'Steps', color: '#10b981' },
                { key: 'steps7dAvg', label: '7-day avg', color: '#6ee7b7' },
              ]}
              valueFormatter={formatInt}
              defaultRange="3M"
            />
          </ChartCard>

          <ChartCard icon={Flame} title="Active energy (calories)" color="text-orange-400">
            <HealthChart
              data={data.daily}
              lines={[
                { key: 'activeEnergy', label: 'Calories', color: '#f97316' },
                { key: 'activeEnergy7dAvg', label: '7-day avg', color: '#fdba74' },
              ]}
              valueFormatter={formatInt}
              defaultRange="3M"
            />
          </ChartCard>

          <ChartCard icon={Timer} title="Exercise minutes" color="text-sky-400">
            <HealthChart
              data={data.daily}
              lines={[
                { key: 'exerciseMinutes', label: 'Minutes', color: '#0ea5e9' },
                { key: 'exerciseMinutes7dAvg', label: '7-day avg', color: '#7dd3fc' },
              ]}
              valueFormatter={formatInt}
              defaultRange="3M"
            />
          </ChartCard>

          {(() => {
            const recentDays = data.daily.slice().reverse();
            return (
              <CollapsibleTable
                title="Daily activity"
                totalRows={recentDays.length}
                head={
                  <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                    <th className="py-2 px-4">Date</th>
                    <th className="py-2 px-3 text-right">Steps</th>
                    <th className="py-2 px-3 text-right">Energy</th>
                    <th className="py-2 px-3 text-right">Exercise</th>
                    <th className="py-2 px-3 text-right">Stand</th>
                    <th className="py-2 px-3 text-right">Distance</th>
                    <th className="py-2 px-3 text-right">Flights</th>
                  </tr>
                }
                rows={recentDays.map((d) => (
                  <tr
                    key={d.date}
                    className="border-b border-border/20 hover:bg-surface-100/30 transition-colors"
                  >
                    <td className="py-1.5 px-4 text-surface-700 font-mono text-xs">{d.date}</td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {formatInt(d.steps)}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {formatInt(d.activeEnergy)}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {formatInt(d.exerciseMinutes)}m
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {formatInt(d.standHours)}h
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {formatDecimal1(d.distance)}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                      {formatInt(d.flightsClimbed)}
                    </td>
                  </tr>
                ))}
              />
            );
          })()}
        </div>
      )}
    </SegmentViewShell>
  );
}
