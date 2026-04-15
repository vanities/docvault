// Sleep segment view — duration, stages, respiratory rate, wrist temp.

import { Moon, Clock, Award, BedDouble } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SegmentViewShell } from './SegmentViewShell';
import { HealthChart } from './HealthChart';
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
        // Convert the raw minute fields into hours for the chart
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

            {data.headline.longestSleep && (
              <Card className="p-4 border-violet-500/30 bg-violet-500/5">
                <div className="flex items-center gap-3">
                  <Award className="w-5 h-5 text-violet-400" />
                  <div>
                    <div className="text-xs text-surface-600 uppercase tracking-wide">
                      Longest sleep
                    </div>
                    <div className="font-medium text-surface-950">
                      {data.headline.longestSleep.date} —{' '}
                      {hmLabel(data.headline.longestSleep.minutes)}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Moon className="w-4 h-4 text-violet-400" />
                <h3 className="font-medium text-surface-950">Nightly sleep duration</h3>
              </div>
              <HealthChart
                data={chartData}
                lines={[{ key: 'asleepHours', label: 'Asleep', color: '#a855f7' }]}
                valueFormatter={(v) => formatHours(v)}
                defaultRange="3M"
              />
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <BedDouble className="w-4 h-4 text-violet-400" />
                <h3 className="font-medium text-surface-950">Sleep stages</h3>
              </div>
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
            </Card>

            <Card className="p-5">
              <h3 className="font-medium text-surface-950 mb-3">Recent 14 nights</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-surface-600 tracking-wide border-b border-border">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                      <th className="py-2 pr-3 text-right">Deep</th>
                      <th className="py-2 pr-3 text-right">REM</th>
                      <th className="py-2 pr-3 text-right">Core</th>
                      <th className="py-2 pr-3 text-right">Awake</th>
                      <th className="py-2 pr-3 text-right">Resp</th>
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
                            {formatMinutes(d.asleepMinutes)}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.deepMinutes !== null ? formatMinutes(d.deepMinutes) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.remMinutes !== null ? formatMinutes(d.remMinutes) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.coreMinutes !== null ? formatMinutes(d.coreMinutes) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.awakeMinutes !== null ? formatMinutes(d.awakeMinutes) : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {d.respiratoryRate !== null ? d.respiratoryRate.toFixed(1) : '—'}
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
}: {
  icon: LucideIcon;
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
