// Workouts segment view — by-type aggregates, weekly frequency, recent list.

import { Dumbbell, Trophy, Flame, Clock, CalendarClock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SegmentViewShell } from './SegmentViewShell';
import { HealthChart } from './HealthChart';
import { InsightsRow } from './InsightsRow';
import { formatInt, formatMinutes, humanizeTypeName } from './healthFormatters';

function formatStart(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "1 session" / "2 sessions" / "0 sessions". */
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

          <InsightsRow insights={data.insights} />

          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="w-4 h-4 text-amber-400" />
              <h3 className="font-medium text-surface-950">Weekly workout count</h3>
            </div>
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
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="font-medium text-surface-950">Weekly workout minutes</h3>
            </div>
            <HealthChart
              data={data.weekly.map((w) => ({
                date: w.weekStart,
                minutes: w.totalDurationMinutes,
              }))}
              lines={[{ key: 'minutes', label: 'Minutes', color: '#10b981' }]}
              valueFormatter={formatInt}
              defaultRange="1Y"
            />
          </Card>

          <Card className="p-5">
            <h3 className="font-medium text-surface-950 mb-3">By type</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3 text-right">Sessions</th>
                    <th className="py-2 pr-3 text-right">Total time</th>
                    <th className="py-2 pr-3 text-right">Avg time</th>
                    <th className="py-2 pr-3 text-right">Total distance</th>
                    <th className="py-2 pr-3 text-right">Total energy</th>
                    <th className="py-2 pr-3">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byType.map((t) => (
                    <tr key={t.type} className="border-b border-border/30 hover:bg-surface-100/30">
                      <td className="py-1.5 pr-3 font-medium text-surface-950">
                        {humanizeTypeName(t.type)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{t.count}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {formatMinutes(t.totalDurationMinutes)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {formatMinutes(t.avgDurationMinutes)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {t.totalDistance !== null ? t.totalDistance.toFixed(1) : '—'}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {t.totalEnergy !== null ? formatInt(t.totalEnergy) : '—'}
                      </td>
                      <td className="py-1.5 pr-3 text-surface-700 font-mono text-xs">
                        {formatStart(t.lastWorkout)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-medium text-surface-950 mb-3">
              Recent workouts ({data.recent.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3 text-right">Duration</th>
                    <th className="py-2 pr-3 text-right">Distance</th>
                    <th className="py-2 pr-3 text-right">Avg HR</th>
                    <th className="py-2 pr-3 text-right">Energy</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((w, i) => (
                    <tr
                      key={`${w.start}-${i}`}
                      className="border-b border-border/30 hover:bg-surface-100/30"
                    >
                      <td className="py-1.5 pr-3 font-medium text-surface-950">
                        {humanizeTypeName(w.type)}
                      </td>
                      <td className="py-1.5 pr-3 text-surface-700 font-mono text-xs">
                        {formatStart(w.start)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {formatMinutes(w.durationMinutes)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {w.distance !== null ? w.distance.toFixed(2) : '—'}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {w.avgHR !== null ? Math.round(w.avgHR) : '—'}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {w.energy !== null ? formatInt(w.energy) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
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
      {/* `break-words` gives long values (e.g. "Traditional Strength Training")
          a safe fallback if humanizeTypeName doesn't split them enough. */}
      <div className="font-mono text-xl text-surface-950 tabular-nums break-words">{value}</div>
      {caption && (
        <div className="text-[10px] mt-0.5 uppercase tracking-wide text-surface-600">{caption}</div>
      )}
    </Card>
  );
}
