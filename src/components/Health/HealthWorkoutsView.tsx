// Workouts segment view — by-type aggregates, weekly frequency, recent list.

import { Dumbbell, Trophy, Flame, Clock, CalendarClock } from 'lucide-react';
import { SegmentViewShell } from './SegmentViewShell';
import { HealthChart } from './HealthChart';
import { InsightsRow } from './InsightsRow';
import { CollapsibleTable } from './CollapsibleTable';
import { TimePeriodSummary } from './TimePeriodSummary';
import { StatTile } from './StatTile';
import { ChartCard } from './ChartCard';
import { formatInt, formatMinutes, humanizeTypeName } from './healthFormatters';

function formatStart(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function plural(n: number, singular: string): string {
  return `${n.toLocaleString()} ${singular}${n === 1 ? '' : 's'}`;
}

export function HealthWorkoutsView() {
  return (
    <SegmentViewShell
      segment="workouts"
      title="Workouts"
      subtitle="Sessions, types, frequency, streaks"
      icon={Dumbbell}
      accent="amber"
    >
      {(data) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <StatTile
              icon={Trophy}
              label="Total workouts"
              value={formatInt(data.headline.totalWorkouts)}
              color="text-amber-400"
            />
            <StatTile
              icon={CalendarClock}
              label="This week"
              value={plural(data.headline.thisWeekCount, 'session')}
              caption={formatMinutes(data.headline.thisWeekMinutes)}
              color="text-emerald-400"
            />
            <StatTile
              icon={Flame}
              label="Longest streak"
              value={plural(data.headline.longestStreakDays, 'day')}
              caption={`current: ${plural(data.headline.currentStreakDays, 'day')}`}
              color="text-rose-400"
            />
            <StatTile
              icon={Dumbbell}
              label="Favorite type"
              value={
                data.headline.favoriteType ? humanizeTypeName(data.headline.favoriteType) : '—'
              }
              color="text-sky-400"
            />
          </div>

          <TimePeriodSummary periods={data.periods} />
          <InsightsRow insights={data.insights} />

          <ChartCard icon={CalendarClock} title="Weekly workout count" color="text-amber-400">
            <HealthChart
              data={data.weekly.map((w) => ({
                date: w.weekStart,
                count: w.count,
                minutes: w.totalDurationMinutes,
              }))}
              lines={[{ key: 'count', label: 'Sessions', color: '#f59e0b' }]}
              valueFormatter={formatInt}
              defaultRange="1Y"
            />
          </ChartCard>

          <ChartCard icon={Clock} title="Weekly workout minutes" color="text-amber-400">
            <HealthChart
              data={data.weekly.map((w) => ({
                date: w.weekStart,
                minutes: w.totalDurationMinutes,
              }))}
              lines={[{ key: 'minutes', label: 'Minutes', color: '#10b981' }]}
              valueFormatter={formatInt}
              defaultRange="1Y"
            />
          </ChartCard>

          <CollapsibleTable
            title="By type"
            totalRows={data.byType.length}
            defaultRows={10}
            head={
              <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                <th className="py-2 px-4">Type</th>
                <th className="py-2 px-3 text-right">Sessions</th>
                <th className="py-2 px-3 text-right">Total time</th>
                <th className="py-2 px-3 text-right">Avg time</th>
                <th className="py-2 px-3 text-right">Total distance</th>
                <th className="py-2 px-3 text-right">Total energy</th>
                <th className="py-2 px-3">Last</th>
              </tr>
            }
            rows={data.byType.map((t) => (
              <tr
                key={t.type}
                className="border-b border-border/20 hover:bg-surface-100/30 transition-colors"
              >
                <td className="py-1.5 px-4 font-medium text-surface-950">
                  {humanizeTypeName(t.type)}
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums">{t.count}</td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                  {formatMinutes(t.totalDurationMinutes)}
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                  {formatMinutes(t.avgDurationMinutes)}
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                  {t.totalDistance !== null ? t.totalDistance.toFixed(1) : '—'}
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                  {t.totalEnergy !== null ? formatInt(t.totalEnergy) : '—'}
                </td>
                <td className="py-1.5 px-3 text-surface-700 font-mono text-xs">
                  {formatStart(t.lastWorkout)}
                </td>
              </tr>
            ))}
          />

          <CollapsibleTable
            title="Recent workouts"
            totalRows={data.recent.length}
            head={
              <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                <th className="py-2 px-4">Type</th>
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3 text-right">Duration</th>
                <th className="py-2 px-3 text-right">Distance</th>
                <th className="py-2 px-3 text-right">Avg HR</th>
                <th className="py-2 px-3 text-right">Energy</th>
              </tr>
            }
            rows={data.recent.map((w, i) => (
              <tr
                key={`${w.start}-${i}`}
                className="border-b border-border/20 hover:bg-surface-100/30 transition-colors"
              >
                <td className="py-1.5 px-4 font-medium text-surface-950">
                  {humanizeTypeName(w.type)}
                </td>
                <td className="py-1.5 px-3 text-surface-700 font-mono text-xs">
                  {formatStart(w.start)}
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                  {formatMinutes(w.durationMinutes)}
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                  {w.distance !== null ? w.distance.toFixed(2) : '—'}
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                  {w.avgHR !== null ? Math.round(w.avgHR) : '—'}
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                  {w.energy !== null ? formatInt(w.energy) : '—'}
                </td>
              </tr>
            ))}
          />
        </div>
      )}
    </SegmentViewShell>
  );
}
