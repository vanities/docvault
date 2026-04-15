import { useEffect, useRef } from 'react';
import { createChart, LineSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { Card } from '@/components/ui/card';
import { Target, AlertCircle } from 'lucide-react';
import { useBtcLogRegression } from './useQuantData';

/** Pi Cycle Top Indicator — 111D SMA crosses above 350D SMA × 2. Historically
 *  nailed BTC cycle peaks in 2013, 2017, 2021 within 3 days each. The "Pi"
 *  name comes from 350/111 ≈ π. */
export function PiCycleChart() {
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
        mode: 1, // Log
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

    // 350D SMA × 2 (slow — the "ceiling")
    const slowLine = chart.addSeries(LineSeries, {
      color: '#f43f5e',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: '350D × 2',
    });
    slowLine.setData(
      cleanIdx
        .map((i) =>
          data.piCycle.sma350dDouble[i] != null
            ? {
                time: timeOf(data.prices[i].t),
                value: data.piCycle.sma350dDouble[i] as number,
              }
            : null
        )
        .filter((v): v is { time: UTCTimestamp; value: number } => v != null)
    );

    // 111D SMA (fast — the "trigger")
    const fastLine = chart.addSeries(LineSeries, {
      color: '#06b6d4',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: '111D SMA',
    });
    fastLine.setData(
      cleanIdx
        .map((i) =>
          data.piCycle.sma111d[i] != null
            ? {
                time: timeOf(data.prices[i].t),
                value: data.piCycle.sma111d[i] as number,
              }
            : null
        )
        .filter((v): v is { time: UTCTimestamp; value: number } => v != null)
    );

    // BTC price
    const priceSeries = chart.addSeries(LineSeries, {
      color: '#fbbf24',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      title: 'BTC',
    });
    priceSeries.setData(
      cleanIdx.map((i) => ({
        time: timeOf(data.prices[i].t),
        value: data.prices[i].price,
      }))
    );

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
          <Target className="w-5 h-5 text-rose-400" />
          Pi Cycle Top Indicator
        </h3>
        <p className="text-[13px] text-surface-600 mt-1 leading-relaxed">
          Per ITC:{' '}
          <em>
            &ldquo;Local price bottom/top indicator using the crossover of the 111D SMA and the 2 ×
            350D SMA.&rdquo;
          </em>{' '}
          Signal fires when 111D SMA crosses <strong>above</strong> 350D × 2. Nailed the 2013, 2017,
          and 2021 BTC tops within 3 days each. The &ldquo;Pi&rdquo; name: 350 / 111 ≈ π.
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
                111D SMA
              </div>
              <div className="text-[16px] font-bold text-cyan-400 mt-0.5">
                {data.piCycle.latest.sma111d != null
                  ? `$${data.piCycle.latest.sma111d.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                350D SMA × 2
              </div>
              <div className="text-[16px] font-bold text-rose-400 mt-0.5">
                {data.piCycle.latest.sma350dDouble != null
                  ? `$${data.piCycle.latest.sma350dDouble.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                Ratio (111 / 350×2)
              </div>
              <div className="text-[16px] font-bold text-surface-200 mt-0.5">
                {data.piCycle.latest.ratio != null ? data.piCycle.latest.ratio.toFixed(3) : '—'}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">1.0 = crossover</div>
            </div>
            <div
              className={`p-3 rounded-xl border ${
                data.piCycle.latest.signalActive
                  ? 'border-rose-500/50 bg-rose-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/5'
              }`}
            >
              <div
                className={`text-[10px] uppercase tracking-wider font-medium ${
                  data.piCycle.latest.signalActive ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                Signal
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${
                  data.piCycle.latest.signalActive ? 'text-rose-500' : 'text-emerald-400'
                }`}
              >
                {data.piCycle.latest.signalActive ? 'TOP ACTIVE' : 'Inactive'}
              </div>
              <div className="text-[10px] text-surface-600 mt-0.5 leading-tight">
                {data.piCycle.latest.signalActive
                  ? 'Cycle top likely within ~3 days'
                  : 'No crossover — market is not at a cycle top'}
              </div>
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
