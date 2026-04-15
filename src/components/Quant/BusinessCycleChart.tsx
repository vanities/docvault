import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Activity, AlertCircle, AlertTriangle } from 'lucide-react';
import { useBusinessCycle, type MacroSeriesData } from './useQuantData';

const SERIES_COLORS: Record<string, string> = {
  SAHMREALTIME: '#f43f5e',
  RECPROUSM156N: '#f43f5e',
  INDPRO: '#06b6d4',
  DGORDER: '#10b981',
  PERMIT: '#f59e0b',
  UMCSENT: '#a855f7',
};

// "Good direction" — is a rising YoY a positive signal for the economy?
const GOOD_DIRECTION: Record<string, 'up' | 'down'> = {
  SAHMREALTIME: 'down',
  RECPROUSM156N: 'down',
  INDPRO: 'up',
  DGORDER: 'up',
  PERMIT: 'up',
  UMCSENT: 'up',
};

function miniOption(s: MacroSeriesData) {
  const color = SERIES_COLORS[s.id] ?? '#94a3b8';
  const points = s.points.map((p) => [p.t, p.value]);
  // For Sahm Rule, add a markLine at 0.5 (recession threshold)
  const extras: Record<string, unknown> = {};
  if (s.id === 'SAHMREALTIME') {
    extras.markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: '#f43f5e', type: 'dashed', opacity: 0.5 },
      label: { show: false },
      data: [{ yAxis: 0.5 }],
    };
  }
  if (s.id === 'RECPROUSM156N') {
    extras.markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: '#f43f5e', type: 'dashed', opacity: 0.5 },
      label: { show: false },
      data: [{ yAxis: 0.5 }],
    };
  }
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
            ? `${(v / 1000000).toFixed(1)}M`
            : v >= 1000
              ? `${(v / 1000).toFixed(1)}k`
              : v.toFixed(s.decimals <= 1 ? 1 : 2),
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
        ...extras,
      },
    ],
  };
}

function MiniChart({ series }: { series: MacroSeriesData }) {
  const option = useMemo(() => miniOption(series), [series]);
  const color = SERIES_COLORS[series.id] ?? '#94a3b8';
  const dir = GOOD_DIRECTION[series.id] ?? 'up';
  const yoyGood = dir === 'up' ? (series.yoyChange ?? 0) >= 0 : (series.yoyChange ?? 0) < 0;
  const yoyClass = yoyGood ? 'text-emerald-400' : 'text-rose-400';

  const fmtValue = (v: number) => {
    if (series.id === 'DGORDER') return `$${(v / 1000).toFixed(0)}B`;
    if (series.id === 'PERMIT') return `${(v / 1000).toFixed(2)}M`;
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

/** Business Cycle Dashboard — 6 FRED indicators that together tell you
 *  where we are in the expansion/contraction cycle. Cowen's late-cycle
 *  framework depends heavily on these. */
export function BusinessCycleChart() {
  const { data, loading, error } = useBusinessCycle();

  // Find the Sahm Rule and Recession Probability for prominent display
  const sahm = data?.series.find((s) => s.id === 'SAHMREALTIME');
  const recProb = data?.series.find((s) => s.id === 'RECPROUSM156N');

  const sahmZone = (() => {
    if (!sahm?.latest) return null;
    const v = sahm.latest.value;
    if (v >= 0.5)
      return {
        label: 'Recession Signal',
        color: 'text-rose-500',
        tip: 'At or above 0.5 — historically the Sahm Rule has only triggered during recessions.',
      };
    if (v >= 0.3)
      return {
        label: 'Warning',
        color: 'text-orange-400',
        tip: 'Approaching the 0.5 threshold — recession risk elevated.',
      };
    if (v >= 0.1)
      return {
        label: 'Elevated',
        color: 'text-amber-400',
        tip: 'Unemployment ticking up above its recent low.',
      };
    return {
      label: 'Calm',
      color: 'text-emerald-400',
      tip: 'Below 0.1 — no recession signal yet.',
    };
  })();

  const recProbZone = (() => {
    if (!recProb?.latest) return null;
    const v = recProb.latest.value;
    if (v >= 0.7)
      return {
        label: 'Very High',
        color: 'text-rose-500',
        tip: 'Recession imminent or already started.',
      };
    if (v >= 0.4)
      return {
        label: 'Elevated',
        color: 'text-orange-400',
        tip: '40%+ probability — significant recession risk within 12 months.',
      };
    if (v >= 0.2)
      return { label: 'Watchful', color: 'text-amber-400', tip: 'Above normal, worth monitoring.' };
    return { label: 'Normal', color: 'text-emerald-400', tip: 'Low recession risk.' };
  })();

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Activity className="w-5 h-5 text-rose-400" />
          Business Cycle Dashboard
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Classic recession / business-cycle indicators: Sahm Rule, Chauvet-Piger smoothed recession
          probability, industrial production (coincident), durable goods orders and building permits
          (leading), and Michigan consumer sentiment. Together these tell you where we are in the
          expansion → contraction cycle. Cowen's late-cycle framework leans on exactly this mix.
        </p>
      </div>

      {loading && (
        <div className="h-[400px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading 6 FRED business-cycle series...
        </div>
      )}

      {error && !loading && (
        <div className="h-[400px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Business cycle not available</div>
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
          {/* Big recession-risk cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div
              className={`p-4 rounded-xl border-2 ${
                sahmZone?.label === 'Recession Signal'
                  ? 'border-rose-500/60 bg-rose-500/10'
                  : sahmZone?.label === 'Warning'
                    ? 'border-orange-500/50 bg-orange-500/10'
                    : sahmZone?.label === 'Elevated'
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-emerald-500/40 bg-emerald-500/5'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className={`w-4 h-4 ${sahmZone?.color ?? 'text-surface-700'}`} />
                <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                  Sahm Rule Indicator
                </div>
              </div>
              <div className={`text-[28px] font-bold ${sahmZone?.color ?? ''}`}>
                {sahm?.latest ? sahm.latest.value.toFixed(2) : '—'}
                <span className="text-[14px] text-surface-700 font-normal ml-2">
                  / 0.50 threshold
                </span>
              </div>
              <div className={`text-[13px] font-semibold mt-1 ${sahmZone?.color ?? ''}`}>
                {sahmZone?.label ?? '—'}
              </div>
              <div className="text-[11px] text-surface-800 mt-1 leading-tight">{sahmZone?.tip}</div>
              <div className="text-[9px] text-surface-700 mt-2">
                3-month avg U-3 unemployment minus its 12-month low. Developed by Claudia Sahm —
                triggered at the start of every U.S. recession since 1970.
              </div>
            </div>
            <div
              className={`p-4 rounded-xl border-2 ${
                recProbZone?.label === 'Very High'
                  ? 'border-rose-500/60 bg-rose-500/10'
                  : recProbZone?.label === 'Elevated'
                    ? 'border-orange-500/50 bg-orange-500/10'
                    : recProbZone?.label === 'Watchful'
                      ? 'border-amber-500/40 bg-amber-500/5'
                      : 'border-emerald-500/40 bg-emerald-500/5'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className={`w-4 h-4 ${recProbZone?.color ?? 'text-surface-700'}`} />
                <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                  Recession Probability (12mo)
                </div>
              </div>
              <div className={`text-[28px] font-bold ${recProbZone?.color ?? ''}`}>
                {recProb?.latest ? `${(recProb.latest.value * 100).toFixed(1)}%` : '—'}
              </div>
              <div className={`text-[13px] font-semibold mt-1 ${recProbZone?.color ?? ''}`}>
                {recProbZone?.label ?? '—'}
              </div>
              <div className="text-[11px] text-surface-800 mt-1 leading-tight">
                {recProbZone?.tip}
              </div>
              <div className="text-[9px] text-surface-700 mt-2">
                Chauvet-Piger smoothed recession probability — a dynamic factor model combining
                employment, industrial production, income, and sales. FRED series{' '}
                <span className="font-mono">RECPROUSM156N</span>.
              </div>
            </div>
          </div>

          {/* 6 mini-charts in a grid */}
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
            {' · Monthly updates; Chauvet-Piger available with 1-2 month lag'}
          </div>
        </>
      )}
    </Card>
  );
}
