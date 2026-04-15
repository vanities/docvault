import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Zap, AlertCircle } from 'lucide-react';
import { useBtcDerivatives } from './useQuantData';

/** BTC Derivatives Panel — funding rate, open interest, long/short ratio.
 *  Sourced from OKX's free public API. Cowen watches these for short-term
 *  top/bottom signals:
 *  - Funding rate > +0.1%/8h = euphoric longs, often near local tops
 *  - Funding rate < 0 = shorts paying, often near local bottoms
 *  - Rising OI with flat price = building leverage, squeeze risk
 *  - L/S ratio extremes = contrarian signal */
export function BtcDerivativesChart() {
  const { data, loading, error } = useBtcDerivatives();

  // Funding rate history mini-chart
  const fundingOption = useMemo(() => {
    if (!data) return null;
    // Express as % per 8h × 100 for display
    const pts = data.fundingHistory.map((p) => [p.t, p.rate * 100]);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        valueFormatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(4)}% / 8h`,
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
        axisLine: { show: false },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 9,
          formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`,
        },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.06)' } },
      },
      series: [
        {
          type: 'bar',
          data: pts.map(([t, v]) => ({
            value: [t, v],
            itemStyle: { color: v >= 0 ? '#f59e0b' : '#06b6d4' },
          })),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#94a3b8', type: 'dashed', opacity: 0.4 },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    };
  }, [data]);

  // Open interest history mini-chart
  const oiOption = useMemo(() => {
    if (!data) return null;
    const pts = data.openInterestHistory.map((p) => [p.t, p.oiUsd / 1e9]);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        valueFormatter: (v: number) => `$${v.toFixed(2)}B`,
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
        axisLine: { show: false },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 9,
          formatter: (v: number) => `$${v.toFixed(1)}B`,
        },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.06)' } },
      },
      series: [
        {
          type: 'line',
          data: pts,
          lineStyle: { color: '#a855f7', width: 2 },
          itemStyle: { color: '#a855f7' },
          symbol: 'none',
          areaStyle: { color: '#a855f7', opacity: 0.08 },
        },
      ],
    };
  }, [data]);

  // Long/Short ratio mini-chart
  const lsOption = useMemo(() => {
    if (!data) return null;
    const pts = data.longShortHistory.map((p) => [p.t, p.ratio]);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        valueFormatter: (v: number) => v.toFixed(2),
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
        axisLine: { show: false },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 9,
          formatter: (v: number) => v.toFixed(1),
        },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.06)' } },
      },
      series: [
        {
          type: 'line',
          data: pts,
          lineStyle: { color: '#10b981', width: 2 },
          itemStyle: { color: '#10b981' },
          symbol: 'none',
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#94a3b8', type: 'dashed', opacity: 0.4 },
            label: { show: false },
            data: [{ yAxis: 1 }],
          },
        },
      ],
    };
  }, [data]);

  // Funding regime classification
  const fundingZone = (() => {
    if (!data) return null;
    const r = data.currentFundingRate;
    if (r < -0.0002)
      return {
        label: 'Shorts Squeezed',
        color: 'text-emerald-500',
        tip: 'Shorts paying heavily — contrarian bullish.',
      };
    if (r < 0)
      return {
        label: 'Mild Short Bias',
        color: 'text-emerald-400',
        tip: 'Slight short bias, healthy for dips.',
      };
    if (r < 0.0001)
      return { label: 'Neutral', color: 'text-cyan-400', tip: 'Balanced positioning.' };
    if (r < 0.0003)
      return {
        label: 'Mild Long Bias',
        color: 'text-amber-400',
        tip: 'Longs leaning in, watch for exhaustion.',
      };
    if (r < 0.0006)
      return {
        label: 'Hot Longs',
        color: 'text-orange-400',
        tip: 'Longs paying premium — local top risk.',
      };
    return {
      label: 'Euphoric Longs',
      color: 'text-rose-500',
      tip: 'Longs paying steep funding — historical top signal.',
    };
  })();

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-400" />
          BTC Derivatives
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Funding rate, open interest, and long/short ratio from OKX perpetual futures. Cowen
          watches these for short-term top/bottom signals:{' '}
          <strong className="text-rose-400">positive funding</strong> = longs paying, often near
          local tops; <strong className="text-emerald-400">negative funding</strong> = shorts
          paying, often near local bottoms. Binance futures are US-blocked so we use OKX.
        </p>
      </div>

      {loading && (
        <div className="h-[360px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading OKX derivatives data...
        </div>
      )}

      {error && !loading && (
        <div className="h-[360px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[11px]">{error}</div>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Stats header */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div
              className={`p-3 rounded-xl border ${
                data.currentFundingRate >= 0
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-cyan-500/40 bg-cyan-500/5'
              }`}
            >
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Funding Rate (8h)
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${
                  data.currentFundingRate >= 0 ? 'text-amber-400' : 'text-cyan-400'
                }`}
              >
                {data.currentFundingRate >= 0 ? '+' : ''}
                {(data.currentFundingRate * 100).toFixed(4)}%
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">
                Annualized: {data.annualizedFundingRate >= 0 ? '+' : ''}
                {(data.annualizedFundingRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Open Interest
              </div>
              <div className="text-[16px] font-bold text-violet-400 mt-0.5">
                ${(data.currentOpenInterestUsd / 1e9).toFixed(2)}B
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">OKX BTC-USDT SWAP</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Long / Short
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${
                  (data.currentLongShortRatio ?? 1) >= 1 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {data.currentLongShortRatio != null ? data.currentLongShortRatio.toFixed(2) : '—'}
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">1.0 = balanced</div>
            </div>
            <div className={`p-3 rounded-xl border border-border/40 bg-surface-100/30`}>
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Regime
              </div>
              <div className={`text-[15px] font-bold mt-0.5 ${fundingZone?.color ?? ''}`}>
                {fundingZone?.label ?? '—'}
              </div>
              <div className="text-[10px] text-surface-800 mt-0.5 leading-tight">
                {fundingZone?.tip}
              </div>
            </div>
          </div>

          {/* 3 mini charts in a grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/20">
              <div className="text-[11px] font-semibold text-surface-200 mb-1">
                Funding Rate History
              </div>
              <div className="text-[9px] text-surface-700 mb-1">
                {data.fundingHistory.length} bars · 8-hour intervals
              </div>
              {fundingOption && (
                <ReactECharts
                  option={fundingOption}
                  style={{ height: '160px', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                  notMerge
                />
              )}
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/20">
              <div className="text-[11px] font-semibold text-surface-200 mb-1">
                Open Interest History
              </div>
              <div className="text-[9px] text-surface-700 mb-1">
                {data.openInterestHistory.length} days · OKX BTC-USDT SWAP
              </div>
              {oiOption && (
                <ReactECharts
                  option={oiOption}
                  style={{ height: '160px', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                  notMerge
                />
              )}
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/20">
              <div className="text-[11px] font-semibold text-surface-200 mb-1">
                Long/Short Ratio History
              </div>
              <div className="text-[9px] text-surface-700 mb-1">
                {data.longShortHistory.length} days · aggregate account ratio
              </div>
              {lsOption && (
                <ReactECharts
                  option={lsOption}
                  style={{ height: '160px', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                  notMerge
                />
              )}
            </div>
          </div>

          <div className="mt-3 text-[10px] text-surface-700 text-center">
            Source:{' '}
            <a
              href="https://www.okx.com/api/v5/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:underline"
            >
              OKX public API
            </a>
            {' · Free, no API key required'}
          </div>
        </>
      )}
    </Card>
  );
}
