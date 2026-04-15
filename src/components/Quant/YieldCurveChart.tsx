import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { useYieldCurve } from './useQuantData';

const REGIME_META = {
  'deeply-inverted': {
    label: 'Deeply Inverted',
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    blurb: 'Strong recession signal — spread more than 50bps below zero.',
  },
  inverted: {
    label: 'Inverted',
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    blurb: 'Short rates above long rates — classic recession lead indicator.',
  },
  flattening: {
    label: 'Flattening',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    blurb: 'Spread near zero — curve losing steepness, watch for inversion.',
  },
  normal: {
    label: 'Normal',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    blurb: 'Healthy upward slope — long rates above short rates.',
  },
  steepening: {
    label: 'Steepening',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    blurb: 'Spread above 150bps — curve steepening, often post-recession recovery.',
  },
} as const;

/** Yield Curve (T10Y2Y + T10Y3M) — the classic US recession lead indicator.
 *  Every US recession since 1970 has been preceded by a T10Y2Y inversion,
 *  typically 6–18 months before recession onset. */
export function YieldCurveChart() {
  const { data, loading, error } = useYieldCurve();

  const option = useMemo(() => {
    if (!data) return null;

    // Downsample to ~1 point per week to keep the chart responsive — 50 years
    // of daily bars would be ~12,000 points.
    const step = Math.max(1, Math.floor(data.points.length / 3000));
    const sampled = data.points.filter((_, i) => i % step === 0);

    const t10y2y = sampled
      .filter((p) => p.t10y2y != null)
      .map((p) => [p.t, Number(p.t10y2y!.toFixed(2))]);
    const t10y3m = sampled
      .filter((p) => p.t10y3m != null)
      .map((p) => [p.t, Number(p.t10y3m!.toFixed(2))]);

    // Build markArea data for every historical inversion period of T10Y2Y.
    // Walk through the points and emit [start, end] pairs for contiguous
    // runs where t10y2y < 0.
    const inversions: Array<[{ xAxis: number }, { xAxis: number }]> = [];
    let inversionStart: number | null = null;
    for (const p of sampled) {
      if (p.t10y2y == null) continue;
      if (p.t10y2y < 0) {
        if (inversionStart == null) inversionStart = p.t;
      } else if (inversionStart != null) {
        inversions.push([{ xAxis: inversionStart }, { xAxis: p.t }]);
        inversionStart = null;
      }
    }
    if (inversionStart != null) {
      const last = sampled[sampled.length - 1];
      inversions.push([{ xAxis: inversionStart }, { xAxis: last.t }]);
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(14, 165, 233, 0.5)' } },
        valueFormatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`,
      },
      legend: {
        data: ['10Y − 2Y', '10Y − 3M'],
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 8,
      },
      grid: { top: 50, bottom: 40, left: 55, right: 30 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Spread (%)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
      },
      series: [
        {
          name: '10Y − 2Y',
          type: 'line',
          data: t10y2y,
          lineStyle: { color: '#06b6d4', width: 1.5 },
          itemStyle: { color: '#06b6d4' },
          symbol: 'none',
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#94a3b8', width: 1.5, opacity: 0.6 },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(244, 63, 94, 0.15)' },
            data: inversions,
          },
        },
        {
          name: '10Y − 3M',
          type: 'line',
          data: t10y3m,
          lineStyle: { color: '#f59e0b', width: 1, opacity: 0.7 },
          itemStyle: { color: '#f59e0b' },
          symbol: 'none',
        },
      ],
    };
  }, [data]);

  const meta = data ? REGIME_META[data.latest.regime] : null;

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          Yield Curve Inversion
        </h3>
        <p className="text-[13px] text-surface-600 mt-1 leading-relaxed">
          10Y − 2Y and 10Y − 3M Treasury spreads from FRED. Inverted periods (spread &lt; 0) are
          shaded rose — every US recession since 1970 has been preceded by a T10Y2Y inversion,
          typically 6–18 months before recession onset.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-500 text-[13px]">
          Loading 50 years of FRED data...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Yield curve not available</div>
          <div className="text-[11px] text-surface-500 max-w-md">{error}</div>
          {error.toLowerCase().includes('fred api key') && (
            <div className="text-[11px] text-cyan-400 mt-2">
              Go to <strong>Settings → Quant</strong> to add your free FRED API key.
            </div>
          )}
        </div>
      )}

      {!loading && !error && data && option && meta && (
        <>
          {/* Stats header */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                10Y − 2Y Spread
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${
                  (data.latest.t10y2y ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {data.latest.t10y2y != null
                  ? `${data.latest.t10y2y >= 0 ? '+' : ''}${data.latest.t10y2y.toFixed(2)}%`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                10Y − 3M Spread
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${
                  (data.latest.t10y3m ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {data.latest.t10y3m != null
                  ? `${data.latest.t10y3m >= 0 ? '+' : ''}${data.latest.t10y3m.toFixed(2)}%`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                Inversion Streak
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${
                  data.inversionStreak > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {data.inversionStreak > 0
                  ? `${data.inversionStreak}d inverted`
                  : `${Math.abs(data.inversionStreak)}d normal`}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">
                {data.lastInversionStart
                  ? `Since ${data.lastInversionStart}`
                  : 'Post-inversion recovery'}
              </div>
            </div>
            <div className={`p-3 rounded-xl border ${meta.border} ${meta.bg}`}>
              <div className={`text-[10px] uppercase tracking-wider font-medium ${meta.color}`}>
                Regime
              </div>
              <div className={`text-[16px] font-bold mt-0.5 ${meta.color}`}>{meta.label}</div>
              <div className="text-[10px] text-surface-600 mt-0.5 leading-tight">{meta.blurb}</div>
            </div>
          </div>

          {/* Main chart */}
          <ReactECharts
            option={option}
            style={{ height: '420px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          {/* Footer */}
          <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-surface-500 items-center justify-between">
            <div>
              <span className="text-surface-600 font-medium">Source:</span>{' '}
              <a
                href="https://fred.stlouisfed.org/series/T10Y2Y"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline"
              >
                FRED (T10Y2Y + T10Y3M)
              </a>
              {' · '}
              <span className="text-surface-600 font-medium">Range:</span>{' '}
              <span className="text-surface-900">
                {data.dataRange.from} → {data.dataRange.to}
              </span>
              {' · '}
              <span className="text-surface-600">
                {data.points.length.toLocaleString()} daily bars
              </span>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
