import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Gauge, AlertCircle } from 'lucide-react';
import { useFearGreed } from './useQuantData';

function zoneForValue(v: number): {
  label: string;
  color: string;
  bg: string;
  border: string;
  hex: string;
} {
  if (v >= 75)
    return {
      label: 'Extreme Greed',
      color: 'text-rose-500',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/40',
      hex: '#f43f5e',
    };
  if (v >= 55)
    return {
      label: 'Greed',
      color: 'text-orange-400',
      bg: 'bg-orange-500/10',
      border: 'border-orange-500/40',
      hex: '#fb923c',
    };
  if (v >= 45)
    return {
      label: 'Neutral',
      color: 'text-amber-300',
      bg: 'bg-amber-500/5',
      border: 'border-amber-500/30',
      hex: '#fcd34d',
    };
  if (v >= 25)
    return {
      label: 'Fear',
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/40',
      hex: '#22d3ee',
    };
  return {
    label: 'Extreme Fear',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/40',
    hex: '#10b981',
  };
}

/** Crypto Fear & Greed Index — alternative.me's 0-100 sentiment gauge. Above
 *  75 is Extreme Greed (historically a distribution zone), below 25 is
 *  Extreme Fear (historically an accumulation zone). Cowen frequently uses
 *  this as a contrarian overlay alongside the Risk Metric. */
export function FearGreedChart() {
  const { data, loading, error } = useFearGreed();

  const latestZone = data ? zoneForValue(data.latest.value) : null;

  const option = useMemo(() => {
    if (!data) return null;
    // Cap the history to the last ~2 years so the chart is readable.
    const cutoff = data.latest.t - 2 * 365 * 24 * 60 * 60 * 1000;
    const recent = data.history.filter((s) => s.t >= cutoff);
    const points = recent.map((s) => [s.t, s.value]);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(251, 191, 36, 0.5)' } },
        valueFormatter: (v: number) => `${v.toFixed(0)} (${zoneForValue(v).label})`,
      },
      grid: { top: 20, bottom: 40, left: 45, right: 20 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
      },
      visualMap: {
        show: false,
        pieces: [
          { gt: 75, lte: 100, color: '#f43f5e' },
          { gt: 55, lte: 75, color: '#fb923c' },
          { gt: 45, lte: 55, color: '#fcd34d' },
          { gt: 25, lte: 45, color: '#22d3ee' },
          { gt: 0, lte: 25, color: '#10b981' },
        ],
        outOfRange: { color: '#94a3b8' },
      },
      series: [
        {
          name: 'Fear & Greed',
          type: 'line',
          data: points,
          symbol: 'none',
          lineStyle: { width: 2 },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(148, 163, 184, 0.3)', type: 'dashed' },
            label: {
              show: true,
              color: '#94a3b8',
              fontSize: 9,
              formatter: (p: { value: number }) => `${p.value}`,
            },
            data: [{ yAxis: 25 }, { yAxis: 50 }, { yAxis: 75 }],
          },
        },
      ],
    };
  }, [data]);

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Gauge className="w-5 h-5 text-amber-300" />
          Crypto Fear &amp; Greed Index
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Alternative.me&apos;s 0-100 sentiment composite (volatility, momentum, volume, social,
          dominance, trends). Below 25 is <span className="text-emerald-400">
            Extreme Fear
          </span>{' '}
          (historically accumulation), above 75 is{' '}
          <span className="text-rose-400">Extreme Greed</span> (historically distribution). Cowen
          treats this as a contrarian overlay — buy fear, sell greed, but only when confirmed by
          longer-term signals.
        </p>
      </div>

      {loading && (
        <div className="h-[400px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading Fear &amp; Greed history...
        </div>
      )}

      {error && !loading && (
        <div className="h-[400px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Fear &amp; Greed not available</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
        </div>
      )}

      {!loading && !error && data && latestZone && option && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className={`p-4 rounded-xl border-2 ${latestZone.border} ${latestZone.bg}`}>
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Today
              </div>
              <div className={`text-[32px] font-bold ${latestZone.color} mt-0.5 leading-none`}>
                {data.latest.value}
              </div>
              <div className={`text-[12px] font-semibold mt-1 ${latestZone.color}`}>
                {latestZone.label}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                30-day Avg
              </div>
              <div
                className="text-[22px] font-bold mt-0.5"
                style={{ color: zoneForValue(data.ma30).hex }}
              >
                {data.ma30.toFixed(0)}
              </div>
              <div className="text-[11px] text-surface-700">{zoneForValue(data.ma30).label}</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                90-day Avg
              </div>
              <div
                className="text-[22px] font-bold mt-0.5"
                style={{ color: zoneForValue(data.ma90).hex }}
              >
                {data.ma90.toFixed(0)}
              </div>
              <div className="text-[11px] text-surface-700">{zoneForValue(data.ma90).label}</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                1y Range
              </div>
              <div className="text-[15px] font-bold text-surface-200 mt-0.5">
                {data.lowest365?.value ?? '—'} → {data.highest365?.value ?? '—'}
              </div>
              <div className="text-[11px] text-surface-700">
                low {data.lowest365?.classification} · high {data.highest365?.classification}
              </div>
            </div>
          </div>

          <ReactECharts
            option={option}
            style={{ height: '320px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          <div className="mt-3 text-[10px] text-surface-700 text-center">
            Source:{' '}
            <a
              href="https://alternative.me/crypto/fear-and-greed-index/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline"
            >
              alternative.me
            </a>
            {' · Updated daily; daily values available back to 2018-02-01'}
          </div>
        </>
      )}
    </Card>
  );
}
