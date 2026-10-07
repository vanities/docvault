import { useEffect, useRef } from 'react';
import { createChart, LineSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { Card } from '@/components/ui/card';
import { GitBranch, AlertCircle } from 'lucide-react';
import { useBtcLogRegression } from './useQuantData';

/** Cowen Corridor — BTC price plotted against multiples of the 20-week SMA.
 *  Per ITC: "A corridor which are multiples of the 20WMA made such that it
 *  acted as support and resistance historically."
 *
 *  Uses the same endpoint as the BTC log regression chart, so mounting this
 *  chart alongside the log-regression chart is free (shared cache). */
export function CowenCorridorChart() {
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
        mode: 1, // Logarithmic
        borderColor: 'rgba(100, 116, 139, 0.3)',
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: 'rgba(100, 116, 139, 0.3)',
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(14, 165, 233, 0.5)', labelBackgroundColor: '#0ea5e9' },
        horzLine: { color: 'rgba(14, 165, 233, 0.5)', labelBackgroundColor: '#0ea5e9' },
      },
    });
    chartRef.current = chart;

    const timeOf = (tMs: number): UTCTimestamp => Math.floor(tMs / 1000) as UTCTimestamp;

    // Dedupe by day
    const seen = new Set<number>();
    const cleanIdx: number[] = [];
    for (let i = 0; i < data.prices.length; i++) {
      const dayKey = Math.floor(data.prices[i].t / 86_400_000);
      if (seen.has(dayKey)) continue;
      seen.add(dayKey);
      cleanIdx.push(i);
    }

    // Color gradient across multipliers: cool (low/support) → warm (high/resistance)
    // 0.4 emerald, 0.6 cyan, 1.0 white, 1.6 amber, 2.5 orange, 4.0 rose
    const MULT_COLORS = [
      '#10b981', // 0.4x — deep support
      '#06b6d4', // 0.6x — support
      '#f1f5f9', // 1.0x — 20WMA itself
      '#f59e0b', // 1.6x — resistance
      '#fb923c', // 2.5x — strong resistance
      '#f43f5e', // 4.0x — distribution
    ];

    for (let mi = 0; mi < data.corridor.multipliers.length; mi++) {
      const mult = data.corridor.multipliers[mi];
      const color = MULT_COLORS[mi] ?? '#94a3b8';
      const isCenter = mult === 1.0;
      const line = chart.addSeries(LineSeries, {
        color,
        lineWidth: isCenter ? 2 : 1,
        lineStyle: isCenter ? 0 : 2, // center solid, others dashed
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: `${mult}×`,
      });
      const series = cleanIdx
        .map((i) => {
          const s = data.corridor.sma20w[i];
          if (s == null) return null;
          return {
            time: timeOf(data.prices[i].t),
            value: s * mult,
          };
        })
        .filter((v): v is { time: UTCTimestamp; value: number } => v != null);
      line.setData(series);
    }

    // BTC price on top
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

  // Current corridor zone classification
  const zone = (() => {
    if (!data?.corridor.latest.currentMultiple) return null;
    const m = data.corridor.latest.currentMultiple;
    if (m <= 0.4) return { label: 'Deep Support', color: 'text-emerald-500' };
    if (m <= 0.6) return { label: 'Accumulation', color: 'text-emerald-400' };
    if (m <= 1.0) return { label: 'Below 20WMA', color: 'text-cyan-400' };
    if (m <= 1.6) return { label: 'Above 20WMA', color: 'text-amber-400' };
    if (m <= 2.5) return { label: 'Euphoria Zone', color: 'text-orange-400' };
    return { label: 'Distribution', color: 'text-rose-500' };
  })();

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-cyan-400" />
          Cowen Corridor
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          BTC price against multiples of the 20-week moving average. Per ITC:{' '}
          <em>
            &ldquo;A corridor which are multiples of the 20WMA made such that it acted as support
            and resistance historically.&rdquo;
          </em>{' '}
          Band levels: 0.4× / 0.6× / 1.0× / 1.6× / 2.5× / 4.0× of the 20WMA.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading BTC history...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Failed to load BTC data</div>
          <div className="text-[11px] text-surface-700 max-w-md text-center">{error}</div>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div
            ref={containerRef}
            className="w-full rounded-lg overflow-hidden border border-border/30 bg-surface-50/20"
            style={{ height: '480px' }}
          />

          {/* Stats row */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
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
                20W SMA
              </div>
              <div className="text-[16px] font-bold text-surface-950 mt-0.5">
                {data.corridor.latest.sma20w != null
                  ? `$${data.corridor.latest.sma20w.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Corridor Multiple
              </div>
              <div className="text-[16px] font-bold text-cyan-400 mt-0.5">
                {data.corridor.latest.currentMultiple != null
                  ? `${data.corridor.latest.currentMultiple.toFixed(2)}×`
                  : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5">
              <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-medium">
                Zone
              </div>
              <div className={`text-[16px] font-bold mt-0.5 ${zone?.color ?? 'text-surface-700'}`}>
                {zone?.label ?? '—'}
              </div>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-surface-700">
            Note: ITC's actual corridor multipliers are proprietary — these are reasonable picks
            (0.4/0.6/1.0/1.6/2.5/4.0) that historically aligned with BTC cycle levels.
          </div>
        </>
      )}
    </Card>
  );
}
