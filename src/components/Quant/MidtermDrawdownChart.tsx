import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { TrendingDown, AlertCircle } from 'lucide-react';
import { useMidtermDrawdowns } from './useQuantData';

/** Midterm Drawdown Overlay — every midterm year since 1871 plotted as a
 *  drawdown curve from its pre-midterm peak, with 2026 highlighted live.
 *
 *  Answers "are we tracking hot or cold vs history" for the current midterm
 *  year. The average historical midterm has a ~20% drawdown with a Q3/Q4
 *  bottom followed by strong recovery through Year 3 (pre-election). */
export function MidtermDrawdownChart() {
  const { data, loading, error } = useMidtermDrawdowns();

  const option = useMemo(() => {
    if (!data) return null;

    const historicalSeries = data.curves
      .filter((c) => !c.isCurrent)
      .map((c) => ({
        name: c.label,
        type: 'line' as const,
        data: c.points.map((p) => [p.offsetMonths, Number((p.drawdown * 100).toFixed(2))]),
        lineStyle: {
          color: 'rgba(148, 163, 184, 0.3)',
          width: 1,
        },
        itemStyle: { color: 'rgba(148, 163, 184, 0.3)' },
        symbol: 'none',
        showSymbol: false,
        smooth: 0.15,
      }));

    // Average curve — thicker dashed
    const averageSeries = {
      name: 'Historical Average',
      type: 'line' as const,
      data: data.averageCurve.map((p) => [p.offsetMonths, Number((p.drawdown * 100).toFixed(2))]),
      lineStyle: {
        color: '#94a3b8',
        width: 2.5,
        type: 'dashed' as const,
      },
      itemStyle: { color: '#94a3b8' },
      symbol: 'none',
      smooth: 0.2,
    };

    // Live 2026 curve — thick cyan
    const liveCurve = data.curves.find((c) => c.isCurrent);
    const liveSeries = liveCurve
      ? {
          name: liveCurve.label,
          type: 'line' as const,
          data: liveCurve.points.map((p) => [
            p.offsetMonths,
            Number((p.drawdown * 100).toFixed(2)),
          ]),
          lineStyle: { color: '#0ea5e9', width: 3 },
          itemStyle: { color: '#0ea5e9' },
          symbol: 'circle',
          symbolSize: 6,
          smooth: 0.1,
          z: 100,
        }
      : null;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        valueFormatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`,
      },
      legend: {
        data: [...(liveSeries ? [liveSeries.name] : []), 'Historical Average'],
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 8,
      },
      grid: { top: 50, bottom: 50, left: 55, right: 30 },
      xAxis: {
        type: 'value',
        name: 'Months from peak',
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.08)' } },
      },
      yAxis: {
        type: 'value',
        name: 'Drawdown (%)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        max: 5,
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.08)' } },
      },
      series: [...historicalSeries, averageSeries, ...(liveSeries ? [liveSeries] : [])],
    };
  }, [data]);

  // Stats for the header cards
  const stats = useMemo(() => {
    if (!data) return null;
    const live = data.curves.find((c) => c.isCurrent);
    const liveDd = live?.points.length ? live.points[live.points.length - 1].drawdown * 100 : null;
    const liveOffset = live?.points.length
      ? live.points[live.points.length - 1].offsetMonths
      : null;
    // Average drawdown at the same offset as live
    let avgAtOffset: number | null = null;
    if (liveOffset != null) {
      const avgPt = data.averageCurve.find((p) => p.offsetMonths === liveOffset);
      if (avgPt) avgAtOffset = avgPt.drawdown * 100;
    }
    // Average bottom (minimum of averageCurve)
    const avgBottom = data.averageCurve.length
      ? Math.min(...data.averageCurve.map((p) => p.drawdown * 100))
      : null;
    const historical = data.curves.filter((c) => !c.isCurrent);
    return {
      liveDd,
      liveOffset,
      avgAtOffset,
      avgBottom,
      historicalCount: historical.length,
      peakDate: live?.peakDate ?? '—',
    };
  }, [data]);

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-cyan-400" />
          Midterm Drawdown Overlay
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Every midterm year since 1871 as a normalized drawdown curve from its pre-midterm peak
          through Year 3 (pre-election). The{' '}
          <span className="text-cyan-400 font-semibold">2026 curve</span> is tracked live. The
          dashed gray line is the historical average across all prior midterms — use it to see
          whether the current year is tracking ahead or behind the pattern.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading 155 years of Shiller data...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[11px]">{error}</div>
        </div>
      )}

      {!loading && !error && data && option && stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5">
              <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-medium">
                2026 Drawdown
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${
                  (stats.liveDd ?? 0) >= 0 ? 'text-emerald-400' : 'text-cyan-400'
                }`}
              >
                {stats.liveDd != null
                  ? `${stats.liveDd >= 0 ? '+' : ''}${stats.liveDd.toFixed(2)}%`
                  : '—'}
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">
                {stats.liveOffset != null ? `Month ${stats.liveOffset}` : 'No data'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Avg at Same Offset
              </div>
              <div className="text-[16px] font-bold text-surface-300 mt-0.5">
                {stats.avgAtOffset != null ? `${stats.avgAtOffset.toFixed(2)}%` : '—'}
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">Historical baseline</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Avg Bottom
              </div>
              <div className="text-[16px] font-bold text-rose-400 mt-0.5">
                {stats.avgBottom != null ? `${stats.avgBottom.toFixed(2)}%` : '—'}
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">
                Across {stats.historicalCount} midterms
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                2026 Peak
              </div>
              <div className="text-[13px] font-bold text-amber-400 mt-0.5">{stats.peakDate}</div>
              <div className="text-[10px] text-surface-700 mt-0.5">Reference high</div>
            </div>
          </div>

          <ReactECharts
            option={option}
            style={{ height: '440px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          <div className="mt-3 text-[10px] text-surface-700 text-center">
            Source: Shiller SP500 dataset. {data.curves.filter((c) => !c.isCurrent).length} complete
            historical midterms (thin gray) + historical average (dashed) + 2026 live (cyan). Only
            midterms where the peak occurred in the first half of the Y1-Y3 window are included, to
            keep the drawdown framing meaningful.
          </div>
        </>
      )}
    </Card>
  );
}
