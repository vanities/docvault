// Health-specific time-series chart. Thin wrapper around recharts with a
// built-in time-range picker (1M / 3M / 6M / 1Y / ALL). Accepts any object
// array that has a `date: string` field plus the plotted keys.
//
// Separate from common/HistoryChart.tsx because that component is tailored
// to financial data (hardcoded $ formatting, % change callout, etc.) — and
// Health metrics need different units (steps, bpm, minutes, hours) plus a
// more flexible formatter.

import { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Button } from '@/components/ui/button';

const RANGES = [
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '6M', days: 180 },
  { key: '1Y', days: 365 },
  { key: 'ALL', days: Infinity },
] as const;

export interface HealthChartLine {
  key: string;
  label: string;
  color: string;
}

interface HealthChartProps<T extends { date: string }> {
  data: T[];
  lines: HealthChartLine[];
  /** Formatter for the Y axis tick labels AND tooltip values. */
  valueFormatter?: (value: number) => string;
  /** Chart height in px. Default 240. */
  height?: number;
  /** Initial time range. Default '3M'. */
  defaultRange?: '1M' | '3M' | '6M' | '1Y' | 'ALL';
  /** Render mode. Default 'area'. */
  defaultMode?: 'area' | 'line';
  /** Show the area/line mode toggle. Default true. */
  showModeToggle?: boolean;
}

function defaultFormatter(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}

export function HealthChart<T extends { date: string }>({
  data,
  lines,
  valueFormatter = defaultFormatter,
  height = 240,
  defaultRange = '3M',
  defaultMode = 'area',
  showModeToggle = true,
}: HealthChartProps<T>) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>(defaultRange);
  const [mode, setMode] = useState<'area' | 'line'>(defaultMode);

  const filtered = useMemo(() => {
    const rangeConfig = RANGES.find((r) => r.key === range) ?? RANGES[RANGES.length - 1];
    const cutoff =
      rangeConfig.days === Infinity ? 0 : Date.now() - rangeConfig.days * 24 * 60 * 60 * 1000;
    const short = rangeConfig.days <= 365;
    return data
      .filter((d) => new Date(`${d.date}T00:00:00Z`).getTime() >= cutoff)
      .map((d) => {
        const date = new Date(`${d.date}T00:00:00Z`);
        const label = short
          ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        const point: Record<string, string | number> = { __x: label, __date: d.date };
        for (const line of lines) {
          const v = (d as unknown as Record<string, unknown>)[line.key];
          point[line.key] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
        }
        return point;
      });
  }, [data, lines, range]);

  const chartEl =
    mode === 'area' ? (
      <AreaChart data={filtered} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          {lines.map((line) => (
            <linearGradient key={line.key} id={`hc-${line.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={line.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={line.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="__x" tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" />
        <YAxis
          tickFormatter={(v) => valueFormatter(Number(v))}
          tick={{ fontSize: 11 }}
          stroke="rgba(255,255,255,0.3)"
          width={52}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          labelStyle={{ color: '#aaa' }}
          // Recharts' Tooltip formatter type is complex; match the escape
          // hatch used in common/HistoryChart.tsx.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any) => valueFormatter(Number(v))}
        />
        {lines.map((line) => (
          <Area
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color}
            fill={`url(#hc-${line.key})`}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </AreaChart>
    ) : (
      <LineChart data={filtered} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="__x" tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" />
        <YAxis
          tickFormatter={(v) => valueFormatter(Number(v))}
          tick={{ fontSize: 11 }}
          stroke="rgba(255,255,255,0.3)"
          width={52}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          labelStyle={{ color: '#aaa' }}
          // Recharts' Tooltip formatter type is complex; match the escape
          // hatch used in common/HistoryChart.tsx.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any) => valueFormatter(Number(v))}
        />
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    );

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              variant={range === r.key ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setRange(r.key)}
              className="h-7 px-2.5 text-[11px]"
            >
              {r.key}
            </Button>
          ))}
        </div>
        {showModeToggle && (
          <div className="flex gap-1">
            <Button
              variant={mode === 'area' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('area')}
              className="h-7 px-2.5 text-[11px]"
            >
              Area
            </Button>
            <Button
              variant={mode === 'line' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('line')}
              className="h-7 px-2.5 text-[11px]"
            >
              Line
            </Button>
          </div>
        )}
      </div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartEl}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Formatters live in ./healthFormatters.ts so this file can stay a single
// component export (React Fast Refresh requires it).
