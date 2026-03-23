import { useState, useMemo } from 'react';
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
import type { PortfolioSnapshot } from '../../types';

// Time ranges
const RANGES = [
  { key: '1W', days: 7 },
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '6M', days: 180 },
  { key: '1Y', days: 365 },
  { key: 'ALL', days: Infinity },
] as const;

type ChartMode = 'area' | 'line';

function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatUsdFull(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

interface DataLine {
  key: string;
  label: string;
  color: string;
}

interface HistoryChartProps {
  snapshots: PortfolioSnapshot[];
  /** Which data fields to plot */
  lines: DataLine[];
  /** Whether to stack areas (default: false for single line, true for multiple) */
  stacked?: boolean;
  /** Chart height in px (default: 200) */
  height?: number;
  /** Default time range key (default: '3M') */
  defaultRange?: string;
  /** Show mode toggle between area and line (default: true) */
  showModeToggle?: boolean;
}

export function HistoryChart({
  snapshots,
  lines,
  stacked,
  height = 200,
  defaultRange = '3M',
  showModeToggle = true,
}: HistoryChartProps) {
  const [range, setRange] = useState(defaultRange);
  const [mode, setMode] = useState<ChartMode>('area');

  const filteredData = useMemo(() => {
    const rangeConfig = RANGES.find((r) => r.key === range) || RANGES[RANGES.length - 1];
    const cutoff =
      rangeConfig.days === Infinity ? 0 : Date.now() - rangeConfig.days * 24 * 60 * 60 * 1000;

    return snapshots
      .filter((s) => new Date(s.date).getTime() >= cutoff)
      .map((s) => {
        const d = new Date(s.date);
        const dateLabel =
          rangeConfig.days <= 30
            ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : rangeConfig.days <= 365
              ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

        const point: Record<string, string | number> = { date: dateLabel, fullDate: s.date };
        for (const line of lines) {
          point[line.key] = (s as unknown as Record<string, number>)[line.key] || 0;
        }
        return point;
      });
  }, [snapshots, range, lines]);

  // Calculate change
  const firstVal = filteredData.length > 0 ? Number(filteredData[0][lines[0]?.key] || 0) : 0;
  const lastVal =
    filteredData.length > 0 ? Number(filteredData[filteredData.length - 1][lines[0]?.key] || 0) : 0;

  // For stacked charts, sum all lines for total change
  const firstTotal =
    filteredData.length > 0
      ? lines.reduce((sum, l) => sum + Number(filteredData[0][l.key] || 0), 0)
      : 0;
  const lastTotal =
    filteredData.length > 0
      ? lines.reduce((sum, l) => sum + Number(filteredData[filteredData.length - 1][l.key] || 0), 0)
      : 0;

  const useTotal = stacked || lines.length > 1;
  const change = useTotal ? lastTotal - firstTotal : lastVal - firstVal;
  const changePct =
    (useTotal ? firstTotal : firstVal) > 0
      ? (change / (useTotal ? firstTotal : firstVal)) * 100
      : 0;
  const isUp = change >= 0;

  if (snapshots.length < 2) {
    return (
      <div className="text-center py-6 text-[12px] text-surface-600">
        Need at least 2 snapshots to show a chart. Snapshots are saved daily.
      </div>
    );
  }

  const shouldStack = stacked ?? lines.length > 1;
  const ChartComponent = mode === 'line' ? LineChart : AreaChart;

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-[13px] font-semibold ${isUp ? 'text-green-500' : 'text-red-500'}`}>
            {isUp ? '+' : ''}
            {formatUsd(change)} ({changePct >= 0 ? '+' : ''}
            {changePct.toFixed(1)}%)
          </span>
          <span className="text-[11px] text-surface-500">
            {filteredData.length} day{filteredData.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {showModeToggle && (
            <div className="flex rounded-lg border border-border/50 mr-2">
              <button
                onClick={() => setMode('area')}
                className={`px-2 py-1 text-[10px] font-medium rounded-l-lg transition-colors ${
                  mode === 'area'
                    ? 'bg-surface-200/50 text-surface-900'
                    : 'text-surface-500 hover:text-surface-700'
                }`}
              >
                Area
              </button>
              <button
                onClick={() => setMode('line')}
                className={`px-2 py-1 text-[10px] font-medium rounded-r-lg transition-colors ${
                  mode === 'line'
                    ? 'bg-surface-200/50 text-surface-900'
                    : 'text-surface-500 hover:text-surface-700'
                }`}
              >
                Line
              </button>
            </div>
          )}
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-colors ${
                range === r.key
                  ? 'bg-accent-500/15 text-accent-400'
                  : 'text-surface-500 hover:text-surface-700 hover:bg-surface-200/30'
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <ChartComponent data={filteredData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            {lines.map((line) => (
              <linearGradient
                key={`grad-${line.key}`}
                id={`grad-${line.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={line.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={line.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatUsd}
            width={55}
          />
          <Tooltip
            contentStyle={{
              background: '#1e293b',
              border: '1px solid rgba(148,163,184,0.1)',
              borderRadius: 10,
              fontSize: 12,
              color: '#f8fafc',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any, name: any) => {
              const lineConfig = lines.find((l) => l.key === String(name));
              return [formatUsdFull(Number(value)), lineConfig?.label || String(name)];
            }}
            labelFormatter={(_, payload) => {
              const fullDate = payload?.[0]?.payload?.fullDate;
              if (fullDate) {
                return new Date(fullDate).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
              }
              return '';
            }}
          />
          {mode === 'area'
            ? lines.map((line) => (
                <Area
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  stackId={shouldStack ? '1' : undefined}
                  stroke={line.color}
                  strokeWidth={1.5}
                  fill={`url(#grad-${line.key})`}
                  dot={false}
                  activeDot={{ r: 3, fill: line.color, stroke: '#1e293b', strokeWidth: 2 }}
                />
              ))
            : lines.map((line) => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  stroke={line.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: line.color, stroke: '#1e293b', strokeWidth: 2 }}
                />
              ))}
        </ChartComponent>
      </ResponsiveContainer>

      {/* Legend */}
      {lines.length > 1 && (
        <div className="flex items-center justify-center gap-4 mt-2">
          {lines.map((line) => (
            <div key={line.key} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: line.color }} />
              <span className="text-[11px] text-surface-500">{line.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
