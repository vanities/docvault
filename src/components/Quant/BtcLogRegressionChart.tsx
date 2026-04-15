import { useEffect, useRef } from 'react';
import {
  createChart,
  LineSeries,
  AreaSeries,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { Card } from '@/components/ui/card';
import { Activity, AlertCircle } from 'lucide-react';
import { useBtcLogRegression } from './useQuantData';

/** BTC log regression bands — the classic "rainbow chart" math.
 *  Fits log10(price) = slope * log10(days_since_genesis) + intercept on 10+
 *  years of daily BTC-USD closes and plots ±1/±2 stdev bands.
 *  Rendered with TradingView's lightweight-charts on a log scale. */
export function BtcLogRegressionChart() {
  const { data, loading, error } = useBtcLogRegression();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || !data) return;

    // Create the chart once per data payload
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

    // ±2 sigma band — outer (muted)
    const band2 = chart.addSeries(AreaSeries, {
      topColor: 'rgba(239, 68, 68, 0.08)',
      bottomColor: 'rgba(239, 68, 68, 0.08)',
      lineColor: 'rgba(239, 68, 68, 0.4)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const band2Lower = chart.addSeries(LineSeries, {
      color: 'rgba(34, 197, 94, 0.4)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    // ±1 sigma band — inner (more visible)
    const band1Upper = chart.addSeries(LineSeries, {
      color: 'rgba(239, 68, 68, 0.6)',
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const band1Lower = chart.addSeries(LineSeries, {
      color: 'rgba(34, 197, 94, 0.6)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Regression line (centerline)
    const fitLine = chart.addSeries(LineSeries, {
      color: '#f1f5f9',
      lineWidth: 2,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // BTC price — main series
    const priceSeries = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });

    // Helpers to convert our {t,price} points → lightweight-charts format.
    // lightweight-charts wants `time: UTCTimestamp` (seconds, not ms).
    const timeOf = (tMs: number): UTCTimestamp => Math.floor(tMs / 1000) as UTCTimestamp;

    // Deduplicate/normalize: lightweight-charts requires strictly increasing
    // time values. Yahoo returns daily bars but occasional duplicates crop
    // up around DST boundaries, so we dedupe by floored day.
    const seen = new Set<number>();
    const cleanIdx: number[] = [];
    for (let i = 0; i < data.prices.length; i++) {
      const dayKey = Math.floor(data.prices[i].t / 86_400_000);
      if (seen.has(dayKey)) continue;
      seen.add(dayKey);
      cleanIdx.push(i);
    }

    const priceData = cleanIdx.map((i) => ({
      time: timeOf(data.prices[i].t),
      value: data.prices[i].price,
    }));
    const fitData = cleanIdx.map((i) => ({
      time: timeOf(data.prices[i].t),
      value: data.fit.line[i],
    }));
    const u1Data = cleanIdx.map((i) => ({
      time: timeOf(data.prices[i].t),
      value: data.fit.upper1[i],
    }));
    const l1Data = cleanIdx.map((i) => ({
      time: timeOf(data.prices[i].t),
      value: data.fit.lower1[i],
    }));
    const u2Data = cleanIdx.map((i) => ({
      time: timeOf(data.prices[i].t),
      value: data.fit.upper2[i],
    }));
    const l2Data = cleanIdx.map((i) => ({
      time: timeOf(data.prices[i].t),
      value: data.fit.lower2[i],
    }));

    band2.setData(u2Data);
    band2Lower.setData(l2Data);
    band1Upper.setData(u1Data);
    band1Lower.setData(l1Data);
    fitLine.setData(fitData);
    priceSeries.setData(priceData);

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  // Risk-zone classification for the current residual sigma
  const zone = (() => {
    if (!data) return null;
    const s = data.latest.residualSigma;
    if (s <= -2) return { label: 'Deep Value', color: 'text-emerald-500' };
    if (s <= -1) return { label: 'Accumulation', color: 'text-emerald-400' };
    if (s <= 0) return { label: 'Below Trend', color: 'text-cyan-400' };
    if (s <= 1) return { label: 'Above Trend', color: 'text-amber-400' };
    if (s <= 2) return { label: 'Overheated', color: 'text-orange-400' };
    return { label: 'Euphoria', color: 'text-rose-500' };
  })();

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Activity className="w-5 h-5 text-amber-400" />
          BTC Log Regression Bands
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Log-log OLS fit of Bitcoin price vs. days since genesis, with ±1 and ±2 stdev bands. The
          classic &ldquo;rainbow chart&rdquo; math — current position relative to the trend tells
          you whether BTC is in accumulation, fair value, or euphoria.
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
                Current Price
              </div>
              <div className="text-[16px] font-bold text-amber-400 mt-0.5">
                ${data.latest.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Fair Value (Fit)
              </div>
              <div className="text-[16px] font-bold text-surface-200 mt-0.5">
                ${data.latest.fitted.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Residual σ
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${
                  data.latest.residualSigma >= 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {data.latest.residualSigma >= 0 ? '+' : ''}
                {data.latest.residualSigma.toFixed(2)}σ
              </div>
            </div>
            <div className="p-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5">
              <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-medium">
                Zone
              </div>
              <div className={`text-[16px] font-bold mt-0.5 ${zone?.color ?? ''}`}>
                {zone?.label ?? '—'}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-surface-700">
            <LegendSwatch color="#f59e0b" label="BTC Price" />
            <LegendSwatch color="#f1f5f9" label="Trend (OLS fit)" />
            <LegendSwatch color="rgba(239, 68, 68, 0.8)" label="±1σ Upper" dashed />
            <LegendSwatch color="rgba(34, 197, 94, 0.8)" label="±1σ Lower" dashed />
            <LegendSwatch color="rgba(239, 68, 68, 0.5)" label="±2σ Outer" />
            <span className="ml-auto text-surface-700">
              Slope: <span className="text-surface-300 font-mono">{data.slope.toFixed(3)}</span>
              {' · '}
              σ: <span className="text-surface-300 font-mono">{data.stdev.toFixed(3)}</span>
              {' · '}
              {data.prices.length.toLocaleString()} bars
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function LegendSwatch({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-4 h-0.5"
        style={{
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)`
            : color,
        }}
      />
      <span>{label}</span>
    </div>
  );
}
