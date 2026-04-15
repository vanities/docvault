import { useEffect, useRef } from 'react';
import {
  createChart,
  LineSeries,
  AreaSeries,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { Card } from '@/components/ui/card';
import { Shield, AlertCircle } from 'lucide-react';
import { useBtcLogRegression } from './useQuantData';

const STATE_META = {
  above: {
    label: 'Above Band',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    tip: 'Bull market intact — price trading above the support band.',
  },
  inside: {
    label: 'Testing Band',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    tip: 'Price inside the band — critical support test in progress.',
  },
  below: {
    label: 'Below Band',
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    tip: 'Lost support — bear market / trend change risk.',
  },
  unknown: {
    label: '—',
    color: 'text-surface-500',
    bg: 'bg-surface-200/20',
    border: 'border-border/30',
    tip: '',
  },
} as const;

/** Bull Market Support Band — 20W SMA + 21W EMA. Per ITC: "The bull market
 *  support band is the area between the 20W simple moving average and 21W
 *  exponential moving average." Cowen watches this for the Jan/Feb test
 *  in halving years. */
export function BmsbChart() {
  const { data, loading, error } = useBtcLogRegression();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || !data) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(100, 116, 139, 0.08)' },
        horzLines: { color: 'rgba(100, 116, 139, 0.08)' },
      },
      rightPriceScale: {
        mode: 1,
        borderColor: 'rgba(100, 116, 139, 0.3)',
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: { borderColor: 'rgba(100, 116, 139, 0.3)', timeVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    const timeOf = (tMs: number): UTCTimestamp => Math.floor(tMs / 1000) as UTCTimestamp;
    const seen = new Set<number>();
    const cleanIdx: number[] = [];
    for (let i = 0; i < data.prices.length; i++) {
      const day = Math.floor(data.prices[i].t / 86_400_000);
      if (seen.has(day)) continue;
      seen.add(day);
      cleanIdx.push(i);
    }

    // Band fill (between SMA and EMA) using an area series seeded at the upper band
    const upperLine = chart.addSeries(AreaSeries, {
      topColor: 'rgba(34, 197, 94, 0.15)',
      bottomColor: 'rgba(34, 197, 94, 0.02)',
      lineColor: 'rgba(34, 197, 94, 0.6)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const lowerLine = chart.addSeries(LineSeries, {
      color: 'rgba(239, 68, 68, 0.6)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: '21W EMA',
    });
    const smaLine = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: '20W SMA',
    });

    const upperBand: { time: UTCTimestamp; value: number }[] = [];
    const lowerBand: { time: UTCTimestamp; value: number }[] = [];
    const smaData: { time: UTCTimestamp; value: number }[] = [];
    for (const i of cleanIdx) {
      const s = data.bmsb.sma20w[i];
      const e = data.bmsb.ema21w[i];
      if (s == null || e == null) continue;
      upperBand.push({ time: timeOf(data.prices[i].t), value: Math.max(s, e) });
      lowerBand.push({ time: timeOf(data.prices[i].t), value: Math.min(s, e) });
      smaData.push({ time: timeOf(data.prices[i].t), value: s });
    }
    upperLine.setData(upperBand);
    lowerLine.setData(lowerBand);
    smaLine.setData(smaData);

    // BTC price on top
    const priceSeries = chart.addSeries(LineSeries, {
      color: '#fbbf24',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      title: 'BTC',
    });
    priceSeries.setData(
      cleanIdx.map((i) => ({ time: timeOf(data.prices[i].t), value: data.prices[i].price }))
    );

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  const meta = data ? STATE_META[data.bmsb.latest.state] : STATE_META.unknown;

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          Bull Market Support Band (BMSB)
        </h3>
        <p className="text-[13px] text-surface-600 mt-1 leading-relaxed">
          20-week simple moving average + 21-week exponential moving average. Per ITC:{' '}
          <em>
            &ldquo;The bull market support band is the area between the 20W simple moving average
            and 21W exponential moving average.&rdquo;
          </em>{' '}
          Cowen's key signal for the January/February halving-year test.
        </p>
      </div>

      {loading && (
        <div className="h-[360px] flex items-center justify-center text-surface-500 text-[13px]">
          Loading...
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                BTC Price
              </div>
              <div className="text-[16px] font-bold text-amber-400 mt-0.5">
                ${data.latest.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                20W SMA
              </div>
              <div className="text-[16px] font-bold text-emerald-400 mt-0.5">
                {data.bmsb.latest.sma20w != null
                  ? `$${data.bmsb.latest.sma20w.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                21W EMA
              </div>
              <div className="text-[16px] font-bold text-rose-400 mt-0.5">
                {data.bmsb.latest.ema21w != null
                  ? `$${data.bmsb.latest.ema21w.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
            </div>
            <div className={`p-3 rounded-xl border ${meta.border} ${meta.bg}`}>
              <div className={`text-[10px] uppercase tracking-wider font-medium ${meta.color}`}>
                State
              </div>
              <div className={`text-[16px] font-bold mt-0.5 ${meta.color}`}>{meta.label}</div>
              <div className="text-[10px] text-surface-600 mt-0.5 leading-tight">{meta.tip}</div>
            </div>
          </div>

          <div
            ref={containerRef}
            className="w-full rounded-lg overflow-hidden border border-border/30 bg-surface-50/20"
            style={{ height: '360px' }}
          />
        </>
      )}
    </Card>
  );
}
