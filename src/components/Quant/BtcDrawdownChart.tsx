import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { TrendingDown, AlertCircle } from 'lucide-react';
import { useBtcDrawdown } from './useQuantData';

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtUsd = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`);

/** BTC Drawdown from ATH — shows the running drawdown (0 = at ATH, negative
 *  = below ATH) plus every completed bear episode's peak-to-trough depth and
 *  recovery timing. Cowen frequently uses this as a bear-market progress
 *  tracker: "how deep are we compared to past cycles?" */
export function BtcDrawdownChart() {
  const { data, loading, error } = useBtcDrawdown();

  const option = useMemo(() => {
    if (!data) return null;
    const points = data.series.map((p) => [p.t, p.drawdown * 100]);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(251, 113, 133, 0.5)' } },
        valueFormatter: (v: number) => `${v.toFixed(2)}%`,
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
        name: 'Drawdown',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
        max: 0,
      },
      series: [
        {
          name: 'Drawdown',
          type: 'line',
          data: points,
          lineStyle: { color: '#f43f5e', width: 1.5 },
          itemStyle: { color: '#f43f5e' },
          symbol: 'none',
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(244, 63, 94, 0.05)' },
                { offset: 1, color: 'rgba(244, 63, 94, 0.4)' },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(148, 163, 184, 0.35)', type: 'dashed' },
            label: {
              color: '#94a3b8',
              fontSize: 9,
              formatter: (p: { value: number }) => `${p.value}%`,
            },
            data: [{ yAxis: -20 }, { yAxis: -50 }, { yAxis: -80 }],
          },
        },
      ],
    };
  }, [data]);

  const currentDrawdown = data?.latest.drawdown ?? 0;
  const currentColor =
    currentDrawdown <= -0.5
      ? 'text-rose-500'
      : currentDrawdown <= -0.2
        ? 'text-orange-400'
        : currentDrawdown <= -0.05
          ? 'text-amber-400'
          : 'text-emerald-400';
  const zone =
    currentDrawdown <= -0.5
      ? 'Deep Bear'
      : currentDrawdown <= -0.2
        ? 'Bear Zone'
        : currentDrawdown <= -0.05
          ? 'Correction'
          : 'Near ATH';

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-rose-400" />
          BTC Drawdown from ATH
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Running percentage drawdown from the all-time high. Every completed cycle has bottomed in
          the <span className="text-rose-400 font-semibold">-70% to -85%</span> zone. Above -20% is
          typically a correction, -20% to -50% is a bear market, and below -50% is deep-bear
          capitulation. Cowen uses this as a "how far through the bear are we?" gauge.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading BTC drawdown history...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">BTC drawdown not available</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
        </div>
      )}

      {!loading && !error && data && option && (
        <>
          {/* Stats header */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className={`p-3 rounded-xl border-2 border-rose-500/40 bg-rose-500/5`}>
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Current Drawdown
              </div>
              <div className={`text-[22px] font-bold ${currentColor} mt-0.5`}>
                {fmtPct(currentDrawdown)}
              </div>
              <div className={`text-[11px] font-semibold ${currentColor}`}>{zone}</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Days Since ATH
              </div>
              <div className="text-[22px] font-bold text-surface-200 mt-0.5">
                {data.latest.daysSinceAth}d
              </div>
              <div className="text-[11px] text-surface-700">ATH {fmtUsd(data.latest.ath)}</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Worst Ever
              </div>
              <div className="text-[22px] font-bold text-rose-400 mt-0.5">
                {fmtPct(data.stats.worstDrawdown)}
              </div>
              <div className="text-[11px] text-surface-700">All-time low</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Avg Bear Depth
              </div>
              <div className="text-[22px] font-bold text-amber-400 mt-0.5">
                {fmtPct(data.stats.avgBearDrawdown)}
              </div>
              <div className="text-[11px] text-surface-700">
                {data.episodes.filter((e) => e.daysToRecovery != null).length} completed cycles
              </div>
            </div>
          </div>

          <ReactECharts
            option={option}
            style={{ height: '360px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          {/* Episodes table */}
          <div className="mt-4">
            <div className="text-[11px] font-semibold text-surface-700 uppercase tracking-[0.15em] mb-2">
              Historical Drawdown Episodes
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-surface-700 border-b border-border/40">
                    <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider">
                      ATH
                    </th>
                    <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider">
                      ATH Price
                    </th>
                    <th className="text-left px-2 py-2 font-semibold uppercase tracking-wider">
                      Trough
                    </th>
                    <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider">
                      Max DD
                    </th>
                    <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider">
                      Days Down
                    </th>
                    <th className="text-right px-2 py-2 font-semibold uppercase tracking-wider">
                      Days to Recovery
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.episodes].reverse().map((e, i) => (
                    <tr
                      key={`${e.athDate}-${i}`}
                      className="border-b border-border/20 hover:bg-surface-100/30"
                    >
                      <td className="px-2 py-2 font-mono text-surface-300">{e.athDate}</td>
                      <td className="px-2 py-2 text-right font-mono text-surface-300">
                        {fmtUsd(e.athPrice)}
                      </td>
                      <td className="px-2 py-2 font-mono text-surface-300">{e.troughDate}</td>
                      <td className="px-2 py-2 text-right font-mono font-bold text-rose-400">
                        {fmtPct(e.maxDrawdown)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-surface-300">
                        {e.daysToTrough}d
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-surface-300">
                        {e.daysToRecovery != null ? (
                          `${e.daysToRecovery}d`
                        ) : (
                          <span className="text-amber-400 italic">in progress</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-surface-700 text-center">
            Pure compute on yahoo-finance2 <span className="font-mono">BTC-USD</span> daily closes
            (2014-09+). Episodes require ≥ 10% drawdown from a prior ATH.
          </div>
        </>
      )}
    </Card>
  );
}
