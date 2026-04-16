// Vitals tab — blood pressure, clinical weight, etc. recorded during
// healthcare visits. Separate from HealthKit vitals (resting HR etc.)
// since clinical vitals are sparse and tied to encounters.

import { useMemo } from 'react';
import { Stethoscope, CalendarDays, Activity } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { StatTile } from '../StatTile';
import { Section, formatDate, EmptyTabState } from './shared';
import type { ClinicalSummary, LabResult } from '../types';

function formatValue(r: LabResult): string {
  if (r.value !== null) {
    const fixed = Number.isInteger(r.value) ? r.value.toString() : r.value.toFixed(1);
    return r.unit ? `${fixed} ${r.unit}` : fixed;
  }
  return r.valueString ?? '—';
}

interface VitalTrend {
  name: string;
  unit: string | null;
  points: LabResult[];
  latest: LabResult | null;
}

function buildVitalTrends(vitals: LabResult[]): VitalTrend[] {
  const groups = new Map<string, LabResult[]>();
  for (const v of vitals) {
    const key = v.loinc ? `loinc:${v.loinc}` : `name:${v.name.toLowerCase()}`;
    const arr = groups.get(key);
    if (arr) arr.push(v);
    else groups.set(key, [v]);
  }
  const trends: VitalTrend[] = [];
  for (const [, points] of groups) {
    points.sort((a, b) => (a.effectiveAt ?? '').localeCompare(b.effectiveAt ?? ''));
    const latest = points[points.length - 1] ?? null;
    trends.push({
      name: latest?.name ?? points[0]?.name ?? 'Unknown',
      unit: latest?.unit ?? null,
      points,
      latest,
    });
  }
  trends.sort((a, b) => (b.latest?.effectiveAt ?? '').localeCompare(a.latest?.effectiveAt ?? ''));
  return trends;
}

function VitalCard({ trend }: { trend: VitalTrend }) {
  const data = trend.points
    .filter((p) => p.value !== null)
    .map((p) => ({ date: p.date ?? '', value: p.value as number }));

  return (
    <div className="rounded-xl border border-border/30 bg-surface-50/40 p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-surface-600">
          {trend.name}
        </div>
        <div className="text-[10px] text-surface-500 font-mono tabular-nums">
          {trend.points.length} record{trend.points.length === 1 ? '' : 's'}
        </div>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <div className="text-xl font-mono tabular-nums text-surface-950 leading-none">
          {trend.latest ? formatValue(trend.latest) : '—'}
        </div>
        <div className="text-[10.5px] text-surface-600 font-mono tabular-nums">
          {formatDate(trend.latest?.effectiveAt ?? null)}
        </div>
      </div>
      {data.length >= 2 ? (
        <div className="h-14 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
                contentStyle={{
                  background: 'rgba(15,23,42,0.9)',
                  border: '1px solid rgba(148,163,184,0.2)',
                  borderRadius: 8,
                  fontSize: 11,
                  color: '#e2e8f0',
                }}
                labelFormatter={(label) => formatDate(String(label))}
                formatter={(value) => [
                  `${String(value)}${trend.unit ? ` ${trend.unit}` : ''}`,
                  trend.name,
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#0ea5e9"
                strokeWidth={1.75}
                dot={{ r: 1.5, fill: '#0ea5e9' }}
                activeDot={{ r: 3.5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-14 text-[10.5px] text-surface-500 flex items-center">
          {data.length === 1 ? 'Single reading' : 'No numeric data'}
        </div>
      )}
    </div>
  );
}

export function VitalsTab({ summary }: { summary: ClinicalSummary }) {
  const trends = useMemo(() => buildVitalTrends(summary.vitals), [summary.vitals]);

  if (trends.length === 0) {
    return (
      <EmptyTabState
        icon={Stethoscope}
        accent="sky"
        title="No clinical vitals recorded"
        description="Your providers haven't sent any vital sign observations in this export. Apple Watch vitals live in the Heart tab."
      />
    );
  }

  const totalReadings = trends.reduce((sum, t) => sum + t.points.length, 0);
  const latestDate = trends[0]?.latest?.effectiveAt ?? null;

  return (
    <>
      <p className="text-[12px] text-surface-800 mb-6 leading-relaxed">
        Blood pressure, weight, temperature, and other vitals logged during clinical visits. Tied to
        provider encounters, not Apple Watch — for continuous data see Activity / Heart.
      </p>

      <Section title="At a glance">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatTile
            icon={Stethoscope}
            label="Vital types"
            value={trends.length.toString()}
            color="text-sky-400"
          />
          <StatTile
            icon={Activity}
            label="Total readings"
            value={totalReadings.toString()}
            color="text-cyan-400"
          />
          <StatTile
            icon={CalendarDays}
            label="Latest reading"
            value={formatDate(latestDate)}
            color="text-violet-400"
          />
        </div>
      </Section>

      <Section
        title="All vitals"
        subtitle={`${trends.length} distinct vital${trends.length === 1 ? '' : 's'}, newest reading first`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {trends.map((t, i) => (
            <VitalCard key={`${t.name}-${i}`} trend={t} />
          ))}
        </div>
      </Section>
    </>
  );
}

VitalsTab.isEmpty = (s: ClinicalSummary): boolean => s.vitals.length === 0;
