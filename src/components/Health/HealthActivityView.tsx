// Activity segment view — steps, energy, exercise minutes, distance.
// Uses the Activity snapshot from the API.

import {
  Activity as ActivityIcon,
  Footprints,
  Flame,
  Timer,
  Route,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SegmentViewShell } from './SegmentViewShell';
import { HealthChart } from './HealthChart';
import { InsightsRow } from './InsightsRow';
import { CollapsibleTable } from './CollapsibleTable';
import { TimePeriodSummary } from './TimePeriodSummary';
import { ScoreGauge } from './ScoreGauge';
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

          {/* Period summaries */}
          <TimePeriodSummary periods={data.periods} />

          {/* Insights */}
          <InsightsRow insights={data.insights} />

          {/* Most active day callout */}
          {data.headline.mostActiveDay && (
            <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
              <div className="flex items-center gap-3">
                <Footprints className="w-5 h-5 text-emerald-400" />
                <div>
                  <div className="text-xs text-surface-600 uppercase tracking-wide">
                    Most active day
                  </div>
                  <div className="font-medium text-surface-950">
                    {data.headline.mostActiveDay.date} —{' '}
                    {formatInt(data.headline.mostActiveDay.steps)} steps
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Steps chart */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Footprints className="w-4 h-4 text-emerald-400" />
              <h3 className="font-medium text-surface-950">Daily steps</h3>
            </div>
            <HealthChart
              data={data.daily}
              lines={[
                { key: 'steps', label: 'Steps', color: '#10b981' },
                { key: 'steps7dAvg', label: '7-day avg', color: '#6ee7b7' },
              ]}
              valueFormatter={formatInt}
              defaultRange="3M"
            />
          </Card>

          {/* Active energy chart */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-4 h-4 text-orange-400" />
              <h3 className="font-medium text-surface-950">Active energy (calories)</h3>
            </div>
            <HealthChart
              data={data.daily}
              lines={[
                { key: 'activeEnergy', label: 'Calories', color: '#f97316' },
                { key: 'activeEnergy7dAvg', label: '7-day avg', color: '#fdba74' },
              ]}
              valueFormatter={formatInt}
              defaultRange="3M"
            />
          </Card>

          {/* Exercise minutes chart */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Timer className="w-4 h-4 text-sky-400" />
              <h3 className="font-medium text-surface-950">Exercise minutes</h3>
            </div>
            <HealthChart
              data={data.daily}
              lines={[
                { key: 'exerciseMinutes', label: 'Minutes', color: '#0ea5e9' },
                { key: 'exerciseMinutes7dAvg', label: '7-day avg', color: '#7dd3fc' },
              ]}
              valueFormatter={formatInt}
              defaultRange="3M"
            />
          </Card>

          {/* Recent days table */}
          {(() => {
            const recentDays = data.daily.slice().reverse();
            return (
              <CollapsibleTable
                title="Daily activity"
                totalRows={recentDays.length}
                head={
                  <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3 text-right">Steps</th>
                    <th className="py-2 pr-3 text-right">Energy</th>
                    <th className="py-2 pr-3 text-right">Exercise</th>
                    <th className="py-2 pr-3 text-right">Stand</th>
                    <th className="py-2 pr-3 text-right">Distance</th>
                    <th className="py-2 pr-3 text-right">Flights</th>
                  </tr>
                }
                rows={recentDays.map((d) => (
                  <tr key={d.date} className="border-b border-border/30 hover:bg-surface-100/30">
                    <td className="py-1.5 pr-3 text-surface-700 font-mono text-xs">{d.date}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {formatInt(d.steps)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {formatInt(d.activeEnergy)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {formatInt(d.exerciseMinutes)}m
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {formatInt(d.standHours)}h
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {formatDecimal1(d.distance)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
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

function StatTile({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <div className="text-[10px] uppercase tracking-wide text-surface-600">{label}</div>
      </div>
      <div className="font-mono text-xl text-surface-950 tabular-nums">{value}</div>
    </Card>
  );
}
