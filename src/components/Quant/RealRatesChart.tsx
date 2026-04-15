import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Percent, AlertCircle } from 'lucide-react';
import { useRealRates } from './useQuantData';

/** Real Interest Rates — nominal Treasury yield minus market-implied
 *  breakeven inflation at the same maturity. Cowen's macro-regime signal:
 *  rising real rates = discount rate on all risk assets rises, crypto and
 *  growth equities struggle. Falling real rates = liquidity tailwind. */
export function RealRatesChart() {
  const { data, loading, error } = useRealRates();

  const option = useMemo(() => {
    if (!data) return null;
    const ten = data.ten.map((p) => [p.t, Number(p.real.toFixed(2))]);
    const five = data.five.map((p) => [p.t, Number(p.real.toFixed(2))]);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(14, 165, 233, 0.5)' } },
        valueFormatter: (v: number) => `${v.toFixed(2)}%`,
      },
      legend: {
        data: ['10Y Real Rate', '5Y Real Rate'],
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 4,
      },
      grid: { top: 40, bottom: 40, left: 55, right: 20 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Real Rate (%)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
      },
      series: [
        {
          name: '10Y Real Rate',
          type: 'line',
          data: ten,
          lineStyle: { color: '#06b6d4', width: 2 },
          itemStyle: { color: '#06b6d4' },
          symbol: 'none',
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(148, 163, 184, 0.4)', type: 'dashed' },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: '5Y Real Rate',
          type: 'line',
          data: five,
          lineStyle: { color: '#a855f7', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#a855f7' },
          symbol: 'none',
        },
      ],
    };
  }, [data]);

  const realTen = data?.latest.tenYear.real ?? 0;
  const percentile = data?.stats.tenYearPercentile10y ?? 0;
  const change52w = data?.stats.tenYearChange52w ?? 0;
  const tenColor =
    realTen >= 2
      ? 'text-rose-400'
      : realTen >= 1
        ? 'text-orange-400'
        : realTen >= 0
          ? 'text-amber-300'
          : 'text-emerald-400';
  const tenLabel =
    realTen >= 2
      ? 'Restrictive'
      : realTen >= 1
        ? 'Tight'
        : realTen >= 0
          ? 'Neutral'
          : 'Accommodative';

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Percent className="w-5 h-5 text-cyan-400" />
          Real Interest Rates
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Nominal Treasury yield minus market-implied breakeven inflation at the same maturity. 10Y
          = <span className="font-mono">DGS10 − T10YIE</span>, 5Y ={' '}
          <span className="font-mono">DGS5 − T5YIE</span>. Positive real rates = inflation-adjusted
          yields above zero = tight monetary regime. The 10Y real rate is Cowen&apos;s go-to macro
          regime gauge — rising real rates historically suppress crypto and growth equities.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading FRED yields + breakevens...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Real rates not available</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
          {error.toLowerCase().includes('fred api key') && (
            <div className="text-[11px] text-cyan-400 mt-2">
              Add your free FRED API key in <strong>Settings → Quant</strong>.
            </div>
          )}
        </div>
      )}

      {!loading && !error && data && option && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border-2 border-cyan-500/40 bg-cyan-500/5">
              <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-medium">
                10Y Real Rate
              </div>
              <div className={`text-[22px] font-bold mt-0.5 ${tenColor}`}>
                {realTen.toFixed(2)}%
              </div>
              <div className={`text-[11px] font-semibold ${tenColor}`}>{tenLabel}</div>
              <div className="text-[10px] text-surface-700 mt-0.5">
                {data.latest.tenYear.nominal.toFixed(2)}% −{' '}
                {data.latest.tenYear.breakeven.toFixed(2)}% inflation
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                5Y Real Rate
              </div>
              <div className="text-[22px] font-bold text-purple-400 mt-0.5">
                {data.latest.fiveYear.real.toFixed(2)}%
              </div>
              <div className="text-[11px] text-surface-700">
                {data.latest.fiveYear.nominal.toFixed(2)}% −{' '}
                {data.latest.fiveYear.breakeven.toFixed(2)}%
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                10Y Percentile (10y)
              </div>
              <div className="text-[22px] font-bold text-surface-200 mt-0.5">
                {(percentile * 100).toFixed(0)}%
              </div>
              <div className="text-[11px] text-surface-700">
                {percentile > 0.8
                  ? 'Near decade high'
                  : percentile > 0.5
                    ? 'Above median'
                    : percentile > 0.2
                      ? 'Below median'
                      : 'Near decade low'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                52-week Change
              </div>
              <div
                className={`text-[22px] font-bold mt-0.5 ${
                  change52w >= 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {change52w >= 0 ? '+' : ''}
                {change52w.toFixed(2)}pp
              </div>
              <div className="text-[11px] text-surface-700">
                {change52w >= 0 ? 'Tightening' : 'Easing'}
              </div>
            </div>
          </div>

          <ReactECharts
            option={option}
            style={{ height: '360px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          <div className="mt-3 text-[10px] text-surface-700 text-center">
            Source:{' '}
            <a
              href="https://fred.stlouisfed.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline"
            >
              FRED (DGS10 / DGS5 / T10YIE / T5YIE)
            </a>
            {' · Updated each business day'}
          </div>
        </>
      )}
    </Card>
  );
}
