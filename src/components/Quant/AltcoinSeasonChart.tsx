import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Sparkles, AlertCircle } from 'lucide-react';
import { useAltcoinSeason } from './useQuantData';

const REGIME_META = {
  'bitcoin-season': {
    label: 'Bitcoin Season',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    tip: 'BTC is outperforming most alts. Capital rotating into BTC.',
  },
  neutral: {
    label: 'Neutral',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    tip: 'Mixed — some alts beating BTC, others not. Transitional phase.',
  },
  'altcoin-season': {
    label: 'Altcoin Season',
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    tip: 'Most alts beating BTC — risk-on phase. Often late-cycle euphoria.',
  },
} as const;

/** Altcoin Season Index — percentage of the top 50 alts that have
 *  outperformed BTC over the past 90 days. Per ITC: "If the Altcoin Season
 *  Index is larger than 75 then it is altcoin season. Lower than 25 it is
 *  Bitcoin season." */
export function AltcoinSeasonChart() {
  const { data, loading, error } = useAltcoinSeason();
  const meta = data ? REGIME_META[data.regime] : null;

  const gaugeOption = useMemo(() => {
    if (!data) return null;
    return {
      backgroundColor: 'transparent',
      series: [
        {
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          radius: '95%',
          center: ['50%', '58%'],
          splitNumber: 10,
          axisLine: {
            lineStyle: {
              width: 20,
              color: [
                // BTC season (amber) → neutral (cyan) → altseason (rose)
                [0.25, '#f59e0b'],
                [0.75, '#06b6d4'],
                [1, '#f43f5e'],
              ],
            },
          },
          pointer: { itemStyle: { color: '#f1f5f9' }, width: 4, length: '75%' },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: '#94a3b8',
            distance: -35,
            fontSize: 10,
            formatter: (v: number) => {
              if (v === 0 || v === 25 || v === 50 || v === 75 || v === 100) return String(v);
              return '';
            },
          },
          title: { show: false },
          detail: {
            formatter: (v: number) => v.toFixed(0),
            fontSize: 36,
            fontWeight: 700,
            color: '#f1f5f9',
            offsetCenter: [0, '40%'],
          },
          data: [{ value: data.indexValue }],
        },
      ],
    };
  }, [data]);

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-rose-400" />
          Altcoin Season Index
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Percentage of the top 50 non-stablecoin alts that have outperformed BTC over the past 90
          days. Per ITC:{' '}
          <em>
            &ldquo;If the Altcoin Season Index is larger than 75 then it is altcoin season. Lower
            than 25 it is Bitcoin season.&rdquo;
          </em>{' '}
          Data: Yahoo Finance (CoinGecko's free tier dropped 90d returns).
        </p>
      </div>

      {loading && (
        <div className="h-[520px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading 50 alt tickers from Yahoo (batched, ~5s)...
        </div>
      )}

      {error && !loading && (
        <div className="h-[520px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[11px]">{error}</div>
        </div>
      )}

      {!loading && !error && data && meta && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Gauge */}
            <div className="p-4 rounded-xl border border-border/40 bg-surface-100/20">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium mb-2 text-center">
                Index
              </div>
              {gaugeOption && (
                <ReactECharts
                  option={gaugeOption}
                  style={{ height: '220px', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                  notMerge
                />
              )}
              <div className="mt-2 text-center">
                <div className={`text-[18px] font-bold ${meta.color}`}>{meta.label}</div>
                <div className="text-[11px] text-surface-800 mt-1 max-w-xs mx-auto">{meta.tip}</div>
              </div>
            </div>

            {/* Stats column */}
            <div className="flex flex-col justify-center gap-3">
              <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
                <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                  BTC 90d Return
                </div>
                <div
                  className={`text-[22px] font-bold mt-0.5 ${
                    data.btcReturn90d >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {data.btcReturn90d >= 0 ? '+' : ''}
                  {(data.btcReturn90d * 100).toFixed(2)}%
                </div>
                <div className="text-[10px] text-surface-700 mt-0.5">
                  Baseline the index is measured against
                </div>
              </div>
              <div className={`p-3 rounded-xl border ${meta.border} ${meta.bg}`}>
                <div className={`text-[10px] uppercase tracking-wider font-medium ${meta.color}`}>
                  Outperformers vs BTC
                </div>
                <div className={`text-[22px] font-bold mt-0.5 ${meta.color}`}>
                  {data.outperformerCount} / {data.totalCounted}
                </div>
                <div className="text-[10px] text-surface-700 mt-0.5">
                  {((data.outperformerCount / data.totalCounted) * 100).toFixed(1)}% of tracked alts
                  beat BTC
                </div>
              </div>
              {data.skipped.length > 0 && (
                <div className="p-2 rounded-lg border border-border/40 bg-surface-100/20">
                  <div className="text-[9px] text-surface-700 uppercase font-medium">
                    Skipped Tickers
                  </div>
                  <div className="text-[11px] text-surface-800 mt-0.5">
                    {data.skipped.join(', ')}
                  </div>
                  <div className="text-[9px] text-surface-700 mt-0.5">
                    Not available on Yahoo (rebranded or delisted)
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Top and bottom lists */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
              <div className="text-[11px] font-semibold text-emerald-400 mb-2">
                Top 10 Outperformers
              </div>
              <div className="space-y-1">
                {data.coins.slice(0, 10).map((c) => (
                  <div
                    key={c.symbol}
                    className="flex items-baseline justify-between text-[11px] border-b border-border/20 last:border-0 pb-1 last:pb-0"
                  >
                    <div>
                      <span className="font-mono font-bold text-surface-950">{c.symbol}</span>
                      <span className="text-surface-700 ml-1">{c.name}</span>
                    </div>
                    <div className="text-right">
                      <span
                        className={`font-mono ${
                          c.return90d >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {c.return90d >= 0 ? '+' : ''}
                        {(c.return90d * 100).toFixed(1)}%
                      </span>
                      <span className="text-[9px] text-surface-700 ml-1">
                        ({c.outperformance >= 0 ? '+' : ''}
                        {c.outperformance.toFixed(1)}pp)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-rose-500/20 bg-rose-500/5">
              <div className="text-[11px] font-semibold text-rose-400 mb-2">
                Bottom 10 Underperformers
              </div>
              <div className="space-y-1">
                {data.coins
                  .slice(-10)
                  .reverse()
                  .map((c) => (
                    <div
                      key={c.symbol}
                      className="flex items-baseline justify-between text-[11px] border-b border-border/20 last:border-0 pb-1 last:pb-0"
                    >
                      <div>
                        <span className="font-mono font-bold text-surface-950">{c.symbol}</span>
                        <span className="text-surface-700 ml-1">{c.name}</span>
                      </div>
                      <div className="text-right">
                        <span
                          className={`font-mono ${
                            c.return90d >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {c.return90d >= 0 ? '+' : ''}
                          {(c.return90d * 100).toFixed(1)}%
                        </span>
                        <span className="text-[9px] text-surface-700 ml-1">
                          ({c.outperformance >= 0 ? '+' : ''}
                          {c.outperformance.toFixed(1)}pp)
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
