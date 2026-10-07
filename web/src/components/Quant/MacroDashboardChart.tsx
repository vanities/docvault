import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Landmark, AlertCircle } from 'lucide-react';
import { useMacroDashboard, type MacroSeriesData } from './useQuantData';

const SERIES_COLORS: Record<string, string> = {
  DGS10: '#06b6d4',
  DFF: '#f59e0b',
  M2SL: '#10b981',
  DTWEXBGS: '#a855f7',
  CPILFESL: '#f43f5e',
};

function miniChartOption(s: MacroSeriesData) {
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
    grid: { top: 5, bottom: 18, left: 45, right: 5 },
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
          s.unit === 'B' && v >= 1000
            ? `${(v / 1000).toFixed(0)}k`
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
  const option = useMemo(() => miniChartOption(series), [series]);
  const color = SERIES_COLORS[series.id] ?? '#94a3b8';
  const yoyPositive = (series.yoyChange ?? 0) >= 0;

  return (
    <div className="p-3 rounded-xl border border-border/40 bg-surface-100/20">
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <div className="text-[11px] font-semibold text-surface-950">{series.label}</div>
          <div className="text-[9px] text-surface-700 leading-tight">
            FRED: <span className="font-mono">{series.id}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-bold" style={{ color }}>
            {series.latest
              ? `${series.latest.value.toLocaleString(undefined, { maximumFractionDigits: series.decimals })}${series.unit}`
              : '—'}
          </div>
          {series.yoyChange != null && (
            <div
              className={`text-[10px] font-semibold ${
                yoyPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {yoyPositive ? '+' : ''}
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

/** Macro Dashboard — 5 FRED series in one card: 10Y Treasury, Fed Funds,
 *  M2 Money Supply, Dollar Index, and Core CPI. The "regime filter" Cowen
 *  uses as context for crypto and equity positioning. */
export function MacroDashboardChart() {
  const { data, loading, error } = useMacroDashboard();

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Landmark className="w-5 h-5 text-cyan-400" />
          Macro Dashboard
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Five FRED series capturing the macro regime: 10Y Treasury yield, Fed Funds Rate, M2 money
          supply, Dollar Index, and Core CPI. Cowen uses these as a <strong>
            regime filter
          </strong> —
          crypto and equities trend up when rates fall, M2 grows, DXY weakens, and inflation cools.
        </p>
      </div>

      {loading && (
        <div className="h-[320px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading 5 FRED series in parallel...
        </div>
      )}

      {error && !loading && (
        <div className="h-[320px] flex flex-col items-center justify-center gap-2 text-danger-400 text-center p-6">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Macro dashboard not available</div>
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
          </div>
        </>
      )}
    </Card>
  );
}
