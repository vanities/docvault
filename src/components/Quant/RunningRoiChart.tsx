import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { useRunningRoi, type RunningRoiAssetData, type RunningRoiWindowData } from './useQuantData';

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

const WINDOW_COLORS: Record<string, string> = {
  '1y': '#06b6d4',
  '2y': '#10b981',
  '3y': '#10b981',
  '4y': '#a855f7',
  '5y': '#f59e0b',
  '10y': '#f43f5e',
};

function WindowStatCard({ window, color }: { window: RunningRoiWindowData; color: string }) {
  const latest = window.latest;
  const pct = window.latestPercentile;
  const isPositive = latest != null && latest >= 0;
  return (
    <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
          {window.label}
        </div>
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      </div>
      <div
        className={`text-[22px] font-bold leading-tight ${
          latest == null ? 'text-surface-700' : isPositive ? 'text-emerald-400' : 'text-rose-400'
        }`}
      >
        {latest != null ? `${latest >= 0 ? '+' : ''}${fmtPct(latest)}` : '—'}
      </div>
      <div className="text-[10px] text-surface-700 mt-0.5">
        {pct != null ? `${(pct * 100).toFixed(0)}th pct (${window.count}n)` : 'insufficient data'}
      </div>
      <div className="text-[10px] text-surface-700 leading-tight">
        μ {fmtPct(window.mean)} · [{fmtPct(window.min)}, {fmtPct(window.max)}]
      </div>
    </div>
  );
}

function RoiChart({ asset }: { asset: RunningRoiAssetData }) {
  const [selectedLabel, setSelectedLabel] = useState<string>(asset.windows[0]?.label ?? '');
  const selected = asset.windows.find((w) => w.label === selectedLabel) ?? asset.windows[0];

  const option = useMemo(() => {
    if (!selected) return null;
    const color = WINDOW_COLORS[selected.label] ?? '#94a3b8';
    const points = selected.series.map((p) => [p.t, p.roi * 100]);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(14, 165, 233, 0.5)' } },
        valueFormatter: (v: number) => `${v.toFixed(1)}%`,
      },
      grid: { top: 20, bottom: 40, left: 55, right: 20 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: `${selected.label} ROI`,
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
      },
      series: [
        {
          name: selected.label,
          type: 'line',
          data: points,
          lineStyle: { color, width: 1.5 },
          itemStyle: { color },
          symbol: 'none',
          areaStyle: { color, opacity: 0.1 },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(148, 163, 184, 0.35)', type: 'dashed' },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    };
  }, [selected]);

  if (!selected) return null;

  return (
    <div>
      {/* Window picker pills */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {asset.windows.map((w) => {
          const active = w.label === selectedLabel;
          const color = WINDOW_COLORS[w.label] ?? '#94a3b8';
          return (
            <button
              key={w.label}
              type="button"
              onClick={() => setSelectedLabel(w.label)}
              className={`px-3 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                active
                  ? 'border-cyan-500/60 bg-cyan-500/10 text-surface-950'
                  : 'border-border/40 bg-surface-100/20 text-surface-800 hover:bg-surface-100/40'
              }`}
              style={active ? { borderColor: color, color } : undefined}
            >
              {w.label}
              <span className="text-surface-700 font-normal ml-1">({w.approxDays}d)</span>
            </button>
          );
        })}
      </div>

      {/* Per-window stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {asset.windows.map((w) => (
          <WindowStatCard key={w.label} window={w} color={WINDOW_COLORS[w.label] ?? '#94a3b8'} />
        ))}
      </div>

      {option && (
        <ReactECharts
          option={option}
          style={{ height: '320px', width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
        />
      )}

      <div className="mt-3 text-[10px] text-surface-700 text-center">
        Data: {asset.range.from} → {asset.range.to} · Each point is &ldquo;if you bought on this day
        and held for {selected.label}, your total return was X%&rdquo;
      </div>
    </div>
  );
}

/** Running ROI — "if you held for N bars starting any day, what was your
 *  ROI?" Cowen frequently shows this to answer questions like "is a 4-year
 *  hold historically profitable? what about right now?" Pure compute on
 *  cached BTC daily closes and Shiller monthly SPX bars. */
export function RunningRoiChart({ asset }: { asset: 'btc' | 'spx' }) {
  const { data, loading, error } = useRunningRoi();
  const title = asset === 'btc' ? 'BTC Running ROI' : 'S&P 500 Running ROI';
  const iconColor = asset === 'btc' ? 'text-amber-400' : 'text-emerald-400';
  const pickedAsset = data?.[asset];

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <TrendingUp className={`w-5 h-5 ${iconColor}`} />
          {title}
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Rolling holding-period returns: for each historical start date, what&apos;s the total ROI
          if you held for the selected window? The stat cards show where today&apos;s reading sits
          in the historical distribution. Cowen&apos;s angle: even long holds can be underwater —
          compare the current number to the percentile and the historical min/max to see how
          good/bad the current regime is.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading running ROI history...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Running ROI not available</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
        </div>
      )}

      {!loading && !error && pickedAsset && <RoiChart asset={pickedAsset} />}
    </Card>
  );
}
