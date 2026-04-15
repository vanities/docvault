import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { ShieldAlert, AlertCircle } from 'lucide-react';
import { useFinancialConditions, type MacroSeriesData } from './useQuantData';

const SERIES_COLORS: Record<string, string> = {
  NFCI: '#f43f5e',
  ANFCI: '#f59e0b',
  STLFSI4: '#a855f7',
  KCFSI: '#06b6d4',
};

// All of these are zero-centered stress indices where > 0 = tighter-than-
// average, < 0 = looser-than-average. So rising = bad for risk assets.
const GOOD_DIRECTION = 'down' as const;

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
      valueFormatter: (v: number) => v.toFixed(s.decimals),
    },
    grid: { top: 5, bottom: 18, left: 42, right: 5 },
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
      axisLabel: { color: '#94a3b8', fontSize: 9, formatter: (v: number) => v.toFixed(1) },
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
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: 'rgba(148, 163, 184, 0.35)', type: 'dashed' },
          label: { show: false },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
}

function MiniChart({ series }: { series: MacroSeriesData }) {
  const option = useMemo(() => miniOption(series), [series]);
  const color = SERIES_COLORS[series.id] ?? '#94a3b8';
  const yoy = series.yoyChange ?? 0;
  // These indices are zero-centered, so YoY % of a near-zero base is useless.
  // Show absolute change instead.
  const absChange =
    series.points.length >= 2 && series.latest
      ? series.latest.value - series.points[series.points.length - 2].value
      : 0;
  const latest = series.latest?.value ?? 0;
  const stressClass =
    latest > 0.5
      ? 'text-rose-400'
      : latest > 0
        ? 'text-amber-400'
        : latest > -0.5
          ? 'text-emerald-400'
          : 'text-emerald-500';
  const label =
    latest > 1
      ? 'Crisis'
      : latest > 0.5
        ? 'Stressed'
        : latest > 0
          ? 'Tight'
          : latest > -0.5
            ? 'Loose'
            : 'Very loose';
  void GOOD_DIRECTION;
  void yoy;

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
            {series.latest ? latest.toFixed(series.decimals) : '—'}
          </div>
          <div className={`text-[10px] font-semibold ${stressClass}`}>
            {label}
            {series.points.length >= 2 && (
              <span className="text-surface-700 font-normal">
                {' '}
                ({absChange >= 0 ? '+' : ''}
                {absChange.toFixed(2)} WoW)
              </span>
            )}
          </div>
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

/** Financial Conditions Dashboard — four zero-centered Fed stress indices:
 *  Chicago Fed NFCI, Adjusted NFCI (cyclical effects removed), St Louis Fed
 *  Financial Stress Index, and Kansas City Fed Financial Stress Index. All
 *  four spike during crises (2008, 2020, 2023 SVB) and sit around 0 in
 *  normal times. Positive = tighter-than-average financial conditions. */
export function FinancialConditionsChart() {
  const { data, loading, error } = useFinancialConditions();

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-400" />
          Financial Conditions
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Four zero-centered Fed stress indices: Chicago NFCI, Adjusted NFCI (cyclical effects
          removed), St. Louis Fed FSI, and Kansas City Fed FSI. Positive = tighter-than-average
          financial conditions. Every US recession since 1970 has been preceded by a sustained move
          above zero; brief crisis spikes (2008 GFC, 2020 Covid, 2023 SVB) can push values past 2.
        </p>
      </div>

      {loading && (
        <div className="h-[400px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading 4 FRED stress indices...
        </div>
      )}

      {error && !loading && (
        <div className="h-[400px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Financial conditions not available</div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
            {' · NFCI/ANFCI/STLFSI4 weekly; KCFSI monthly'}
          </div>
        </>
      )}
    </Card>
  );
}
