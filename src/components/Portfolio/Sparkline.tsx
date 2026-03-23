import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
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

const COLORS = {
  broker: '#8b5cf6', // violet
  crypto: '#f59e0b', // amber
  bank: '#3b82f6', // blue
};

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

  const hasBankData = snapshots.some((s) => (s.bankValue || 0) > 0);

  const data = snapshots.map((s) => ({
    date: s.date.slice(5), // MM-DD
    total: s.totalValue,
    crypto: s.cryptoValue,
    broker: s.brokerValue,
    bank: s.bankValue || 0,
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
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradBroker" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.broker} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COLORS.broker} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gradCrypto" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.crypto} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COLORS.crypto} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gradBank" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.bank} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COLORS.bank} stopOpacity={0.05} />
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
            formatter={(value: any, name: any) => {
              const labels: Record<string, string> = {
                broker: 'Brokers',
                crypto: 'Crypto',
                bank: 'Banks',
              };
              return [formatUsdFull(Number(value)), labels[String(name)] || String(name)];
            }}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
            formatter={(value: string) => {
              const labels: Record<string, string> = {
                broker: 'Brokers',
                crypto: 'Crypto',
                bank: 'Banks',
              };
              return labels[value] || value;
            }}
          />
          <Area
            type="monotone"
            dataKey="broker"
            stackId="1"
            stroke={COLORS.broker}
            strokeWidth={1.5}
            fill="url(#gradBroker)"
            dot={false}
            activeDot={{ r: 3, fill: COLORS.broker }}
          />
          <Area
            type="monotone"
            dataKey="crypto"
            stackId="1"
            stroke={COLORS.crypto}
            strokeWidth={1.5}
            fill="url(#gradCrypto)"
            dot={false}
            activeDot={{ r: 3, fill: COLORS.crypto }}
          />
          {hasBankData && (
            <Area
              type="monotone"
              dataKey="bank"
              stackId="1"
              stroke={COLORS.bank}
              strokeWidth={1.5}
              fill="url(#gradBank)"
              dot={false}
              activeDot={{ r: 3, fill: COLORS.bank }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
