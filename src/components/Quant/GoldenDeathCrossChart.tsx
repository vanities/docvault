import { useEffect, useRef } from 'react';
import {
  createChart,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { Card } from '@/components/ui/card';
import { Crosshair, AlertCircle } from 'lucide-react';
import { useBtcLogRegression } from './useQuantData';

/** Golden / Death Cross detector for BTC.
 *  Golden Cross = 50D SMA crosses above 200D SMA (bullish long-term signal).
 *  Death Cross = 50D SMA crosses below 200D SMA (bearish long-term signal).
 *  Per ITC: "A golden cross indicates a long-term bull market going forward.
 *  A death cross signals a long-term bear market." */
export function GoldenDeathCrossChart() {
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

    type Pt = { time: UTCTimestamp; value: number };
    const lineData = (arr: (number | null)[]): Pt[] =>
      cleanIdx
        .map((i) =>
          arr[i] != null ? { time: timeOf(data.prices[i].t), value: arr[i] as number } : null
        )
        .filter((p): p is Pt => p != null);

    // 200D SMA (slow)
    const slowLine = chart.addSeries(LineSeries, {
      color: '#f43f5e',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: '200D SMA',
    });
    slowLine.setData(lineData(data.movingAverages.sma200d));

    // 50D SMA (fast)
    const fastLine = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: '50D SMA',
    });
    fastLine.setData(lineData(data.movingAverages.sma50d));

    // BTC price (foreground)
    const priceSeries = chart.addSeries(LineSeries, {
      color: '#fbbf24',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      title: 'BTC',
    });
    priceSeries.setData(
      cleanIdx.map((i) => ({ time: timeOf(data.prices[i].t), value: data.prices[i].price }))
    );

    // Cross event markers on the price series
    const markers: SeriesMarker<Time>[] = data.goldenDeathCrosses.events.map((ev) => ({
      time: timeOf(ev.t),
      position: ev.type === 'golden' ? 'belowBar' : 'aboveBar',
      color: ev.type === 'golden' ? '#10b981' : '#f43f5e',
      shape: ev.type === 'golden' ? 'arrowUp' : 'arrowDown',
      text: ev.type === 'golden' ? 'G' : 'D',
    }));
    createSeriesMarkers(priceSeries, markers);

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Crosshair className="w-5 h-5 text-emerald-400" />
          Golden / Death Cross
        </h3>
        <p className="text-[13px] text-surface-600 mt-1 leading-relaxed">
          50-day SMA crossing the 200-day SMA. Per ITC:{' '}
          <em>
            &ldquo;A golden cross indicates a long-term bull market going forward. A death cross
            signals a long-term bear market.&rdquo;
          </em>{' '}
          <span className="text-emerald-400 font-semibold">G</span> = Golden (bullish),{' '}
          <span className="text-rose-400 font-semibold">D</span> = Death (bearish).
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
                50D SMA
              </div>
              <div className="text-[15px] font-bold text-emerald-400 mt-0.5">
                {data.movingAverages.latest.sma50d != null
                  ? `$${data.movingAverages.latest.sma50d.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                200D SMA
              </div>
              <div className="text-[15px] font-bold text-rose-400 mt-0.5">
                {data.movingAverages.latest.sma200d != null
                  ? `$${data.movingAverages.latest.sma200d.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
            </div>
            <div
              className={`p-3 rounded-xl border ${
                data.goldenDeathCrosses.currentRegime === 'bullish'
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-rose-500/40 bg-rose-500/5'
              }`}
            >
              <div
                className={`text-[10px] uppercase tracking-wider font-medium ${
                  data.goldenDeathCrosses.currentRegime === 'bullish'
                    ? 'text-emerald-500'
                    : 'text-rose-500'
                }`}
              >
                Regime
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${
                  data.goldenDeathCrosses.currentRegime === 'bullish'
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {data.goldenDeathCrosses.currentRegime === 'bullish' ? 'Bullish' : 'Bearish'}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">
                50D {data.goldenDeathCrosses.currentRegime === 'bullish' ? '>' : '<'} 200D
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                Last Cross
              </div>
              <div
                className={`text-[14px] font-bold mt-0.5 ${
                  data.goldenDeathCrosses.latestEvent?.type === 'golden'
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {data.goldenDeathCrosses.latestEvent
                  ? data.goldenDeathCrosses.latestEvent.type === 'golden'
                    ? 'Golden Cross'
                    : 'Death Cross'
                  : '—'}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">
                {data.goldenDeathCrosses.latestEvent
                  ? new Date(data.goldenDeathCrosses.latestEvent.t).toISOString().slice(0, 10)
                  : ''}
              </div>
            </div>
          </div>

          <div
            ref={containerRef}
            className="w-full rounded-lg overflow-hidden border border-border/30 bg-surface-50/20"
            style={{ height: '360px' }}
          />

          <div className="mt-3 text-[10px] text-surface-500 text-center">
            {data.goldenDeathCrosses.events.length} historical cross events
          </div>
        </>
      )}
    </Card>
  );
}
