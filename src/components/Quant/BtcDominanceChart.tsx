import { Card } from '@/components/ui/card';
import { PieChart as PieChartIcon, AlertCircle } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';
import { useBtcDominance } from './useQuantData';

/** BTC Dominance snapshot — BTC market cap as % of total, plus ETH, stables,
 *  and Cowen's "flight to safety" (BTC + stables). Single snapshot from
 *  CoinGecko's free /global endpoint. */
export function BtcDominanceChart() {
  const { data, loading, error } = useBtcDominance();

  const pieOption = useMemo(() => {
    if (!data) return null;
    const others = Math.max(0, 100 - data.btcDominance - data.ethDominance - data.stableDominance);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: (p: { name: string; value: number; percent: number }) =>
          `<b>${p.name}</b><br/>${p.value.toFixed(2)}%`,
      },
      series: [
        {
          type: 'pie',
          radius: ['55%', '85%'],
          center: ['50%', '55%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderColor: 'rgba(20, 24, 32, 0.8)',
            borderWidth: 2,
          },
          label: {
            show: true,
            color: '#94a3b8',
            fontSize: 11,
            formatter: '{b}\n{d}%',
          },
          labelLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.4)' } },
          data: [
            { name: 'BTC', value: data.btcDominance, itemStyle: { color: '#fbbf24' } },
            { name: 'ETH', value: data.ethDominance, itemStyle: { color: '#8b5cf6' } },
            {
              name: 'Stables',
              value: data.stableDominance,
              itemStyle: { color: '#06b6d4' },
            },
            { name: 'Alts', value: others, itemStyle: { color: '#f43f5e' } },
          ],
        },
      ],
    };
  }, [data]);

  // Cowen's 60% pivot: dominance above/below 60% is his key signal
  const pivotState = data
    ? data.btcDominance >= 60
      ? { label: 'BTC-led', color: 'text-amber-400' }
      : { label: 'Alt-rotating', color: 'text-rose-400' }
    : null;

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <PieChartIcon className="w-5 h-5 text-amber-400" />
          Bitcoin Dominance
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          BTC market cap as a share of total crypto market cap. Per ITC:{' '}
          <em>
            &ldquo;Dominance is the asset market cap divided by the total market cap.&rdquo;
          </em>{' '}
          Cowen watches the <strong>60% level</strong> as the key pivot — above 60% is BTC-led
          markets, below is altcoin-rotating. He also tracks{' '}
          <strong>flight-to-safety (BTC + stables)</strong> as a risk-off gauge.
        </p>
      </div>

      {loading && (
        <div className="h-[360px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading CoinGecko /global...
        </div>
      )}

      {error && !loading && (
        <div className="h-[360px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[11px]">{error}</div>
        </div>
      )}

      {!loading && !error && data && pieOption && pivotState && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReactECharts
              option={pieOption}
              style={{ height: '320px', width: '100%' }}
              opts={{ renderer: 'canvas' }}
              notMerge
            />
            <div className="flex flex-col justify-center gap-2">
              <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
                <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                  BTC Dominance
                </div>
                <div className="text-[22px] font-bold text-amber-400 mt-0.5">
                  {data.btcDominance.toFixed(2)}%
                </div>
                <div className={`text-[11px] font-semibold ${pivotState.color}`}>
                  {pivotState.label} (pivot = 60%)
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg border border-border/40 bg-surface-100/20">
                  <div className="text-[10px] text-surface-700 uppercase font-medium">ETH</div>
                  <div className="text-[14px] font-bold text-violet-400">
                    {data.ethDominance.toFixed(2)}%
                  </div>
                </div>
                <div className="p-2 rounded-lg border border-border/40 bg-surface-100/20">
                  <div className="text-[10px] text-surface-700 uppercase font-medium">Stables</div>
                  <div className="text-[14px] font-bold text-cyan-400">
                    {data.stableDominance.toFixed(2)}%
                  </div>
                </div>
                <div className="p-2 rounded-lg border border-amber-500/30 bg-amber-500/5 col-span-2">
                  <div className="text-[10px] text-amber-500 uppercase font-medium">
                    Flight to Safety (BTC + Stables)
                  </div>
                  <div className="text-[16px] font-bold text-amber-300">
                    {data.flightToSafety.toFixed(2)}%
                  </div>
                  <div className="text-[9px] text-surface-700 mt-0.5">
                    Cowen's risk-off dominance gauge
                  </div>
                </div>
                <div className="p-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 col-span-2">
                  <div className="text-[10px] text-cyan-500 uppercase font-medium">
                    Stablecoin Supply Ratio (SSR)
                  </div>
                  <div className="text-[16px] font-bold text-cyan-300">{data.ssr.toFixed(2)}×</div>
                  <div className="text-[9px] text-surface-700 mt-0.5">
                    BTC mcap ÷ stables mcap ·{' '}
                    {data.ssr < 3
                      ? 'Dry powder on the sidelines'
                      : data.ssr < 6
                        ? 'Neutral deployment'
                        : 'Money already deployed'}
                  </div>
                </div>
                <div className="p-2 rounded-lg border border-border/40 bg-surface-100/20 col-span-2">
                  <div className="text-[10px] text-surface-700 uppercase font-medium">
                    Total Market Cap
                  </div>
                  <div className="text-[14px] font-bold text-surface-200">
                    ${(data.totalMarketCapUsd / 1e12).toFixed(2)}T
                  </div>
                  <div
                    className={`text-[11px] font-semibold ${
                      data.totalMarketCapChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {data.totalMarketCapChange24h >= 0 ? '+' : ''}
                    {data.totalMarketCapChange24h.toFixed(2)}% (24h)
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-surface-700 text-center">
            Source:{' '}
            <a
              href="https://www.coingecko.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:underline"
            >
              CoinGecko /global
            </a>
            {' · Free, no API key required'}
          </div>
        </>
      )}
    </Card>
  );
}
