import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { PortfolioSnapshot } from '../../types';

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatUsdFull(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

interface SparklineProps {
  snapshots: PortfolioSnapshot[];
}

export function Sparkline({ snapshots }: SparklineProps) {
  if (snapshots.length < 2) {
    return (
      <div className="text-center py-6 text-[12px] text-surface-600">
        Need at least 2 snapshots to show a chart. Snapshots are saved daily.
      </div>
    );
  }

  const first = snapshots[0].totalValue;
  const last = snapshots[snapshots.length - 1].totalValue;
  const isUp = last >= first;
  const change = last - first;
  const changePct = first > 0 ? (change / first) * 100 : 0;
  const color = isUp ? '#22c55e' : '#ef4444';

  const data = snapshots.map((s) => ({
    date: s.date.slice(5), // MM-DD
    total: s.totalValue,
    crypto: s.cryptoValue,
    broker: s.brokerValue,
  }));

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-[11px] text-surface-600">
          {snapshots.length} day{snapshots.length !== 1 ? 's' : ''}
        </span>
        <span className={`text-[13px] font-semibold ${isUp ? 'text-green-500' : 'text-red-500'}`}>
          {isUp ? '+' : ''}
          {formatUsd(change)} ({changePct >= 0 ? '+' : ''}
          {changePct.toFixed(1)}%)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatUsd}
            width={50}
            domain={['dataMin', 'dataMax']}
          />
          <Tooltip
            contentStyle={{
              background: '#1e293b',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              color: '#f8fafc',
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any) => [formatUsdFull(Number(value)), 'Total']}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke={color}
            strokeWidth={2}
            fill="url(#sparkGrad)"
            dot={false}
            activeDot={{ r: 4, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
