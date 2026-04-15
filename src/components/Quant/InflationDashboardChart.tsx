import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Flame, AlertCircle } from 'lucide-react';
import { useInflationDashboard, type MacroSeriesData } from './useQuantData';

const SERIES_COLORS: Record<string, string> = {
  CPIAUCSL: '#f43f5e',
  PCEPI: '#f59e0b',
  PPIACO: '#a855f7',
  T5YIE: '#06b6d4',
  WALCL: '#10b981',
  DCOILWTICO: '#eab308',
};

// Is a rising YoY a "good" (disinflation) or "bad" (inflation) signal? For
// every series here, rising YoY means more inflation — which is bad for
// consumers and risk assets. WALCL is the exception: rising = QE = usually
// risk-on for crypto and equities.
const GOOD_DIRECTION: Record<string, 'up' | 'down'> = {
  CPIAUCSL: 'down',
  PCEPI: 'down',
  PPIACO: 'down',
  T5YIE: 'down',
  WALCL: 'up',
  DCOILWTICO: 'down',
};

function fmtValue(s: MacroSeriesData, v: number): string {
  if (s.id === 'WALCL') return `$${(v / 1_000_000).toFixed(2)}T`;
  if (s.id === 'DCOILWTICO') return `$${v.toFixed(2)}`;
  if (s.unit === '%') return `${v.toFixed(s.decimals)}%`;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: s.decimals })}${s.unit}`;
}

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
      valueFormatter: (v: number) => fmtValue(s, v),
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
        formatter: (v: number) => {
          if (s.id === 'WALCL') return `${(v / 1_000_000).toFixed(1)}T`;
          if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
          if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
          return v.toFixed(s.decimals <= 1 ? 1 : 2);
        },
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
  const dir = GOOD_DIRECTION[series.id] ?? 'down';
  const yoy = series.yoyChange ?? 0;
  const yoyGood = dir === 'up' ? yoy >= 0 : yoy < 0;
  const yoyClass = yoyGood ? 'text-emerald-400' : 'text-rose-400';

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
            {series.latest ? fmtValue(series, series.latest.value) : '—'}
          </div>
          {series.yoyChange != null && (
            <div className={`text-[10px] font-semibold ${yoyClass}`}>
              {yoy >= 0 ? '+' : ''}
              {yoy.toFixed(2)}% YoY
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

/** Inflation Dashboard — six FRED series that together tell the inflation
 *  story: headline CPI, PCE (Fed's preferred gauge), PPI, market-implied
 *  5-year breakeven inflation, Fed balance sheet (WALCL — the quantitative
 *  side of monetary policy), and WTI crude oil (the biggest single driver of
 *  headline CPI swings). */
export function InflationDashboardChart() {
  const { data, loading, error } = useInflationDashboard();

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Flame className="w-5 h-5 text-rose-400" />
          Inflation &amp; Fed Balance Sheet
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          The full inflation picture in one card: headline CPI, the Fed&apos;s preferred PCE gauge,
          producer prices (PPI — leads CPI by ~3 months), 5-year market-implied breakeven inflation,
          the Fed&apos;s total balance sheet (WALCL — QE vs QT), and WTI crude oil. Rising WALCL is
          risk-on; everything else rising is risk-off.
        </p>
      </div>

      {loading && (
        <div className="h-[400px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading 6 FRED inflation series...
        </div>
      )}

      {error && !loading && (
        <div className="h-[400px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Inflation dashboard not available</div>
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
            {' · CPI/PCE/PPI monthly; WALCL weekly (Wed); T5YIE + WTI daily'}
          </div>
        </>
      )}
    </Card>
  );
}
