import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Briefcase, AlertCircle } from 'lucide-react';
import { useJobsDashboard, type MacroSeriesData } from './useQuantData';

const SERIES_COLORS: Record<string, string> = {
  UNRATE: '#f43f5e',
  PAYEMS: '#10b981',
  ICSA: '#f59e0b',
  JTSJOL: '#06b6d4',
  CES0500000003: '#a855f7',
  CIVPART: '#fbbf24',
};

function miniOption(s: MacroSeriesData) {
  const color = SERIES_COLORS[s.id] ?? '#94a3b8';
  const points = s.points.map((p) => [p.t, p.value]);
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 24, 32, 0.95)',
      borderColor: 'rgba(100, 116, 139, 0.3)',
      textStyle: { color: '#e2e8f0', fontSize: 11 },
      valueFormatter: (v: number) =>
        `${v.toLocaleString(undefined, { maximumFractionDigits: s.decimals })}${s.unit}`,
    },
    grid: { top: 5, bottom: 18, left: 50, right: 5 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
      axisLabel: { color: '#94a3b8', fontSize: 9 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { show: false },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 9,
        formatter: (v: number) =>
          v >= 1000000
            ? `${(v / 1000).toFixed(0)}k`
            : v >= 1000
              ? `${(v / 1000).toFixed(1)}k`
              : v.toFixed(s.decimals <= 1 ? 0 : 1),
      },
      splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.06)' } },
    },
    series: [
      {
        type: 'line',
        data: points,
        lineStyle: { color, width: 1.5 },
        itemStyle: { color },
        symbol: 'none',
        areaStyle: { color, opacity: 0.08 },
      },
    ],
  };
}

function MiniChart({ series }: { series: MacroSeriesData }) {
  const option = useMemo(() => miniOption(series), [series]);
  const color = SERIES_COLORS[series.id] ?? '#94a3b8';
  // For jobs data, YoY up is usually bad for UNRATE / good for payrolls.
  // Use a per-series "good direction" mapping.
  const goodDirection: Record<string, 'up' | 'down'> = {
    UNRATE: 'down',
    PAYEMS: 'up',
    ICSA: 'down',
    JTSJOL: 'up',
    CES0500000003: 'up',
    CIVPART: 'up',
  };
  const dir = goodDirection[series.id] ?? 'up';
  const yoyPositive = dir === 'up' ? (series.yoyChange ?? 0) >= 0 : (series.yoyChange ?? 0) < 0;
  const yoyClass = yoyPositive ? 'text-emerald-400' : 'text-rose-400';

  const fmtValue = (v: number) => {
    if (series.id === 'PAYEMS' || series.id === 'JTSJOL') {
      return `${(v / 1000).toFixed(1)}M`;
    }
    if (series.id === 'ICSA') {
      return `${(v / 1000).toFixed(0)}k`;
    }
    return `${v.toLocaleString(undefined, { maximumFractionDigits: series.decimals })}${series.unit}`;
  };

  return (
    <div className="p-3 rounded-xl border border-border/40 bg-surface-100/20">
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <div className="text-[11px] font-semibold text-surface-200">{series.label}</div>
          <div className="text-[9px] text-surface-700 leading-tight">
            FRED: <span className="font-mono">{series.id}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-bold" style={{ color }}>
            {series.latest ? fmtValue(series.latest.value) : '—'}
          </div>
          {series.yoyChange != null && (
            <div className={`text-[10px] font-semibold ${yoyClass}`}>
              {series.yoyChange >= 0 ? '+' : ''}
              {series.yoyChange.toFixed(2)}% YoY
            </div>
          )}
        </div>
      </div>
      <ReactECharts
        option={option}
        style={{ height: '90px', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
      />
      <div className="text-[9px] text-surface-700 mt-1 leading-tight">{series.description}</div>
    </div>
  );
}

/** Jobs Dashboard — 6 FRED labor series in one card: unemployment, nonfarm
 *  payrolls, initial claims, JOLTS openings, avg hourly earnings, labor
 *  force participation. Same pattern as MacroDashboardChart but with a
 *  labor-specific "good direction" mapping for the YoY color coding. */
export function JobsDashboardChart() {
  const { data, loading, error } = useJobsDashboard();

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-emerald-400" />
          Jobs Dashboard
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Six FRED labor series: unemployment rate, total nonfarm employment, weekly initial jobless
          claims, JOLTS job openings, average hourly earnings, and labor force participation.{' '}
          <strong className="text-emerald-400">Green YoY</strong> = labor market improving for that
          series, <strong className="text-rose-400">rose</strong> = weakening. Job openings falling
          + rising unemployment is the classic late-cycle softening pattern Cowen watches for
          recession signals.
        </p>
      </div>

      {loading && (
        <div className="h-[320px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading 6 FRED labor series in parallel...
        </div>
      )}

      {error && !loading && (
        <div className="h-[320px] flex flex-col items-center justify-center gap-2 text-danger-400 text-center p-6">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Jobs dashboard not available</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
          {error.toLowerCase().includes('fred api key') && (
            <div className="text-[11px] text-cyan-400 mt-2">
              Add your free FRED API key in <strong>Settings → Quant</strong>.
            </div>
          )}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.series.map((s) => (
              <MiniChart key={s.id} series={s} />
            ))}
          </div>
          <div className="mt-3 text-[10px] text-surface-700 text-center">
            Source:{' '}
            <a
              href="https://fred.stlouisfed.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline"
            >
              Federal Reserve Economic Data (FRED)
            </a>
            {' · Updated monthly (daily for ICSA)'}
          </div>
        </>
      )}
    </Card>
  );
}
