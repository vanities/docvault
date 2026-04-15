import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Repeat, AlertCircle } from 'lucide-react';
import { useFlippening } from './useQuantData';

const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

/** Flippening Index — ETH/BTC price ratio over time. "The flippening" is the
 *  theoretical point at which ETH's market cap overtakes BTC's. We compute
 *  both the raw ratio and an estimate of "progress to flippening" based on
 *  current circulating supplies. */
export function FlippeningChart() {
  const { data, loading, error } = useFlippening();

  const option = useMemo(() => {
    if (!data) return null;
    const points = data.series.map((p) => [p.t, p.ratio]);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(167, 139, 250, 0.5)' } },
        valueFormatter: (v: number) => v.toFixed(5),
      },
      grid: { top: 20, bottom: 40, left: 65, right: 20 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'ETH / BTC',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 10,
          formatter: (v: number) => v.toFixed(4),
        },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
      },
      series: [
        {
          name: 'ETH/BTC',
          type: 'line',
          data: points,
          lineStyle: { color: '#a855f7', width: 2 },
          itemStyle: { color: '#a855f7' },
          symbol: 'none',
          areaStyle: { color: '#a855f7', opacity: 0.1 },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(244, 63, 94, 0.5)', type: 'dashed' },
            label: {
              color: '#f43f5e',
              fontSize: 9,
              position: 'end' as const,
              formatter: 'Flippening',
            },
            // ratioAtFlippening = BTC_SUPPLY / ETH_SUPPLY. We compute it
            // from the response's progress field: ratio / progress.
            data:
              data.latest.progressToFlippening > 0
                ? [{ yAxis: data.latest.ratio / data.latest.progressToFlippening }]
                : [],
          },
        },
      ],
    };
  }, [data]);

  const r90 = data?.stats.ratio90dReturn ?? 0;
  const r365 = data?.stats.ratio365dReturn ?? 0;

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Repeat className="w-5 h-5 text-purple-400" />
          Flippening Index
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          The ETH/BTC price ratio — tracks whether ETH is gaining or losing ground against BTC.
          &ldquo;The flippening&rdquo; refers to the theoretical point where ETH&apos;s market cap
          overtakes BTC&apos;s. Rising ratio = ETH outperforming (altcoin season leader), falling =
          BTC dominance strengthening. Cowen treats this as the primary alt-vs-BTC gauge.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading ETH/BTC history...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Flippening not available</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
        </div>
      )}

      {!loading && !error && data && option && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border-2 border-purple-500/40 bg-purple-500/5">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                ETH / BTC Ratio
              </div>
              <div className="text-[22px] font-bold text-purple-400 mt-0.5">
                {data.latest.ratio.toFixed(5)}
              </div>
              <div className="text-[11px] text-surface-700">
                ATH {data.stats.ratioAth.toFixed(5)} on {data.stats.ratioAthDate}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Progress to Flippening
              </div>
              <div className="text-[22px] font-bold text-cyan-400 mt-0.5">
                {(data.latest.progressToFlippening * 100).toFixed(1)}%
              </div>
              <div className="text-[11px] text-surface-700">Based on current supplies</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                90-day ratio return
              </div>
              <div
                className={`text-[22px] font-bold mt-0.5 ${
                  r90 >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {r90 >= 0 ? '+' : ''}
                {fmtPct(r90)}
              </div>
              <div className="text-[11px] text-surface-700">
                {r90 >= 0 ? 'ETH leading' : 'BTC leading'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                365-day ratio return
              </div>
              <div
                className={`text-[22px] font-bold mt-0.5 ${
                  r365 >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {r365 >= 0 ? '+' : ''}
                {fmtPct(r365)}
              </div>
              <div className="text-[11px] text-surface-700">
                ETH ${data.latest.ethPrice.toFixed(0)} / BTC $
                {(data.latest.btcPrice / 1000).toFixed(1)}k
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
            Source: yahoo-finance2 (<span className="font-mono">ETH-USD</span> and{' '}
            <span className="font-mono">BTC-USD</span>) · Flippening threshold assumes ~19.9M BTC
            and ~120.5M ETH circulating
          </div>
        </>
      )}
    </Card>
  );
}
