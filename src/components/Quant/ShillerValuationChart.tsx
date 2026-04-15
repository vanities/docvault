import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Scale, AlertCircle } from 'lucide-react';
import { useShillerValuation } from './useQuantData';

/** Shiller CAPE + SP500 Dividend Yield — valuation history back to 1871.
 *  CAPE = price / 10-year average of real earnings.
 *  DY = trailing 12m dividends / price × 100.
 *  Both come from the Shiller dataset we already cache for the Presidential
 *  Cycle chart, so no new network fetches on the common path. */
export function ShillerValuationChart() {
  const { data, loading, error } = useShillerValuation();

  // Zone classification for current CAPE percentile
  const capeZone = useMemo(() => {
    if (!data || data.capePercentile == null) return null;
    const p = data.capePercentile;
    if (p < 20) return { label: 'Historically Cheap', color: 'text-emerald-500' };
    if (p < 40) return { label: 'Below Average', color: 'text-emerald-400' };
    if (p < 60) return { label: 'Fair Value', color: 'text-cyan-400' };
    if (p < 80) return { label: 'Above Average', color: 'text-amber-400' };
    if (p < 95) return { label: 'Expensive', color: 'text-orange-400' };
    return { label: 'Bubble Territory', color: 'text-rose-500' };
  }, [data]);

  const option = useMemo(() => {
    if (!data) return null;

    // Downsample to yearly to keep the chart readable (155 years × 12 months
    // is too dense to render smoothly). Take the January data point of each
    // year plus the very latest non-null points.
    const yearly = data.points.filter((p) => p.date.endsWith('-01'));
    // Always include the latest point with CAPE if it isn't in January
    const lastCape = [...data.points].reverse().find((p) => p.cape != null);
    if (lastCape && !yearly.includes(lastCape)) yearly.push(lastCape);

    const capeSeries = yearly
      .filter((p) => p.cape != null)
      .map((p) => [p.t, Number(p.cape!.toFixed(2))]);
    const dySeries = yearly
      .filter((p) => p.divYield != null)
      .map((p) => [p.t, Number(p.divYield!.toFixed(2))]);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(14, 165, 233, 0.5)' } },
      },
      legend: {
        data: ['CAPE (Shiller PE)', 'SP500 Dividend Yield %'],
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 8,
      },
      grid: { top: 50, bottom: 40, left: 60, right: 60 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: 'CAPE',
          nameTextStyle: { color: '#94a3b8', fontSize: 11 },
          position: 'left',
          axisLine: { show: true, lineStyle: { color: '#f59e0b' } },
          axisLabel: { color: '#f59e0b', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
        },
        {
          type: 'value',
          name: 'DY %',
          nameTextStyle: { color: '#94a3b8', fontSize: 11 },
          position: 'right',
          axisLine: { show: true, lineStyle: { color: '#06b6d4' } },
          axisLabel: { color: '#06b6d4', fontSize: 10, formatter: '{value}%' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'CAPE (Shiller PE)',
          type: 'line',
          yAxisIndex: 0,
          data: capeSeries,
          smooth: 0.2,
          lineStyle: { color: '#f59e0b', width: 2 },
          itemStyle: { color: '#f59e0b' },
          symbol: 'none',
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#94a3b8', type: 'dashed', width: 1 },
            label: {
              color: '#94a3b8',
              fontSize: 10,
              formatter: `Median ${data.medians.cape.toFixed(1)}`,
              position: 'end',
            },
            data: [{ yAxis: data.medians.cape }],
          },
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(239, 68, 68, 0.06)' },
            data: [
              // Dot-com + 2021 + present expensive zone (CAPE > 30)
              [{ yAxis: 30 }, { yAxis: 100 }],
            ],
          },
        },
        {
          name: 'SP500 Dividend Yield %',
          type: 'line',
          yAxisIndex: 1,
          data: dySeries,
          smooth: 0.2,
          lineStyle: { color: '#06b6d4', width: 2 },
          itemStyle: { color: '#06b6d4' },
          symbol: 'none',
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#94a3b8', type: 'dashed', width: 1, opacity: 0.4 },
            label: {
              color: '#94a3b8',
              fontSize: 10,
              formatter: `Median ${data.medians.divYield.toFixed(1)}%`,
              position: 'start',
            },
            data: [{ yAxis: data.medians.divYield }],
          },
        },
      ],
    };
  }, [data]);

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Scale className="w-5 h-5 text-amber-400" />
          Shiller CAPE &amp; SP500 Dividend Yield
        </h3>
        <p className="text-[13px] text-surface-600 mt-1 leading-relaxed">
          Cyclically-adjusted PE (CAPE) = S&amp;P 500 price ÷ 10-year average of real earnings.
          Dividend yield = trailing 12m dividends ÷ price. Both back to <strong>1871</strong> (155
          years) from Shiller's dataset. High CAPE and low DY historically precede poor 10-year
          forward returns.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-500 text-[13px]">
          Loading Shiller valuation history (1871–present)...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Failed to load Shiller valuation</div>
          <div className="text-[11px] text-surface-500 max-w-md text-center">{error}</div>
        </div>
      )}

      {!loading && !error && data && option && (
        <>
          {/* Stats header */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                Current CAPE
              </div>
              <div className="text-[16px] font-bold text-amber-400 mt-0.5">
                {data.latest.cape != null ? data.latest.cape.toFixed(2) : '—'}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">
                Median: {data.medians.cape.toFixed(1)}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                Dividend Yield
              </div>
              <div className="text-[16px] font-bold text-cyan-400 mt-0.5">
                {data.latest.divYield != null ? `${data.latest.divYield.toFixed(2)}%` : '—'}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">
                Median: {data.medians.divYield.toFixed(2)}%
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">
                CAPE Percentile
              </div>
              <div className="text-[16px] font-bold text-surface-200 mt-0.5">
                {data.capePercentile != null ? `${data.capePercentile.toFixed(1)}th` : '—'}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">vs. 155 years</div>
            </div>
            <div className="p-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5">
              <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-medium">
                Zone
              </div>
              <div
                className={`text-[16px] font-bold mt-0.5 ${capeZone?.color ?? 'text-surface-500'}`}
              >
                {capeZone?.label ?? '—'}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">Valuation regime</div>
            </div>
          </div>

          {/* Main chart */}
          <ReactECharts
            option={option}
            style={{ height: '420px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          {/* Footer */}
          <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-surface-500 items-center justify-between">
            <div>
              <span className="text-surface-600 font-medium">Source:</span>{' '}
              <a
                href="https://github.com/datasets/s-and-p-500"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 hover:underline"
              >
                Shiller SP500 (GitHub datasets/s-and-p-500)
              </a>
              {' · '}
              <span className="text-surface-600 font-medium">Data as of:</span>{' '}
              <span className="text-surface-900">{data.latest.date}</span>
            </div>
            <div className="text-surface-500">
              Range: {data.dataRange.from} → {data.dataRange.to} ({data.points.length} months)
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
