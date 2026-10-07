import { useEffect, useRef } from 'react';
import { createChart, LineSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { Card } from '@/components/ui/card';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { useBtcLogRegression } from './useQuantData';

/** BTC Moving Averages + Mayer Multiple.
 *
 *  Combines two classic long-term BTC indicators on one chart:
 *  - 200-week SMA (Cowen's cycle trend line — bull/bear regime boundary)
 *  - 200-day SMA with Mayer bands at 0.8× / 1× / 2.4× (Trace Mayer's
 *    multiple, classic cycle top/bottom indicator)
 *
 *  Shares the BTC log-regression endpoint — no extra network cost. */
export function BtcMovingAveragesChart() {
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

    type Pt = { time: UTCTimestamp; value: number };
    const lineData = (arr: (number | null)[]): Pt[] =>
      cleanIdx
        .map((i) =>
          arr[i] != null ? { time: timeOf(data.prices[i].t), value: arr[i] as number } : null
        )
        .filter((p): p is Pt => p != null);

    // Mayer bands — compute from sma200d × multiplier
    const MAYER_COLORS: Record<number, { color: string; label: string }> = {
      0.8: { color: '#10b981', label: '0.8× (capitulation)' },
      1.0: { color: '#f1f5f9', label: '200D SMA (Mayer 1×)' },
      2.4: { color: '#f43f5e', label: '2.4× (top zone)' },
    };

    for (const mult of data.movingAverages.mayerBandMultipliers) {
      const meta = MAYER_COLORS[mult] ?? { color: '#94a3b8', label: `${mult}×` };
      const s = chart.addSeries(LineSeries, {
        color: meta.color,
        lineWidth: mult === 1 ? 2 : 1,
        lineStyle: mult === 1 ? 0 : 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: meta.label,
      });
      s.setData(lineData(data.movingAverages.sma200d.map((v) => (v != null ? v * mult : null))));
    }

    // 200W SMA — the "Cowen cycle line"
    const sma200wSeries = chart.addSeries(LineSeries, {
      color: '#06b6d4',
      lineWidth: 3,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false,
      title: '200W SMA',
    });
    sma200wSeries.setData(lineData(data.movingAverages.sma200w));

    // BTC price
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

  // Mayer multiple zone classification
  const mayerZone = (() => {
    if (!data) return null;
    const m = data.risk.latest.components.mayerMultiple;
    if (m == null) return null;
    if (m < 0.8) return { label: 'Capitulation', color: 'text-emerald-500' };
    if (m < 1.0) return { label: 'Below Fair Value', color: 'text-emerald-400' };
    if (m < 1.5) return { label: 'Above Fair Value', color: 'text-cyan-400' };
    if (m < 2.0) return { label: 'Extended', color: 'text-amber-400' };
    if (m < 2.4) return { label: 'Overheated', color: 'text-orange-400' };
    return { label: 'Top Zone', color: 'text-rose-500' };
  })();

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          BTC Moving Averages + Mayer Multiple
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          BTC price overlaid with the <strong className="text-cyan-400">200-week SMA</strong>{' '}
          (Cowen's cycle trend line — bull/bear regime boundary) and the{' '}
          <strong>200-day SMA with Mayer bands</strong> at 0.8× (capitulation), 1× (fair value), and
          2.4× (historical top zone, per Trace Mayer). The Mayer Multiple is{' '}
          <strong>price ÷ 200D SMA</strong>.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[11px]">{error}</div>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                BTC Price
              </div>
              <div className="text-[16px] font-bold text-amber-400 mt-0.5">
                ${data.latest.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                200W SMA
              </div>
              <div className="text-[16px] font-bold text-cyan-400 mt-0.5">
                {data.movingAverages.latest.sma200w != null
                  ? `$${data.movingAverages.latest.sma200w.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">
                {data.movingAverages.latest.priceVs200w != null
                  ? `Price = ${data.movingAverages.latest.priceVs200w.toFixed(2)}× of 200W`
                  : ''}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Mayer Multiple
              </div>
              <div className="text-[16px] font-bold text-surface-950 mt-0.5">
                {data.risk.latest.components.mayerMultiple != null
                  ? `${data.risk.latest.components.mayerMultiple.toFixed(2)}×`
                  : '—'}
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">Price ÷ 200D SMA</div>
            </div>
            <div className="p-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5">
              <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-medium">
                Zone
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${mayerZone?.color ?? 'text-surface-700'}`}
              >
                {mayerZone?.label ?? '—'}
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">Mayer classification</div>
            </div>
          </div>

          <div
            ref={containerRef}
            className="w-full rounded-lg overflow-hidden border border-border/30 bg-surface-50/20"
            style={{ height: '480px' }}
          />
        </>
      )}
    </Card>
  );
}
