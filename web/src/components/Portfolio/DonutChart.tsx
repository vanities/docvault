import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatUsdFull(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  slices: DonutSlice[];
}

export function DonutChart({ slices }: DonutChartProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={160} height={160}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={72}
            paddingAngle={1}
            strokeWidth={0}
          >
            {slices.map((slice, i) => (
              <Cell key={i} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: '#1e293b',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              color: '#f8fafc',
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any) => [formatUsdFull(Number(value))]}
          />
          {/* Center text */}
          <text
            x="50%"
            y="47%"
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: 10, fill: '#94a3b8' }}
          >
            Total
          </text>
          <text
            x="50%"
            y="57%"
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: 13, fontWeight: 'bold', fill: '#0f172a' }}
          >
            {formatUsd(total)}
          </text>
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        {slices.map((slice, i) => {
          const pct = (slice.value / total) * 100;
          return (
            <div key={i} className="flex items-center gap-2 min-w-0">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: slice.color }}
              />
              <span className="text-[11px] text-surface-700 truncate">{slice.label}</span>
              <span className="text-[11px] text-surface-500 ml-auto flex-shrink-0 tabular-nums">
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
