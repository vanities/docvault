import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Gauge, AlertCircle } from 'lucide-react';
import { useSP500RiskMetric } from './useQuantData';

/** SP500 Risk Metric — Cowen-style 0-1 composite for equities, using the
 *  155-year Shiller cache. Blends 5 monthly inputs (Mayer-like 12m, 24m SMA
 *  distance, log-regression σ, 14m RSI, drawdown from ATH), each
 *  percentile-ranked over a rolling 50-year window and averaged. */
export function SP500RiskMetricChart() {
  const { data, loading, error } = useSP500RiskMetric();

  const zone = useMemo(() => {
    if (!data?.latest.metric) return null;
    const r = data.latest.metric;
    if (r < 0.15)
      return {
        label: 'Generational Low',
        color: 'text-emerald-500',
        tip: 'Every long-run bottom has been below this.',
      };
    if (r < 0.3)
      return {
        label: 'Accumulation',
        color: 'text-emerald-400',
        tip: 'Add aggressively. Forward 10yr returns historically strong.',
      };
    if (r < 0.45)
      return {
        label: 'Below Fair Value',
        color: 'text-cyan-400',
        tip: 'Good value. Continue baseline allocation.',
      };
    if (r < 0.55)
      return {
        label: 'Fair Value',
        color: 'text-surface-200',
        tip: 'Neutral zone. Stay the course.',
      };
    if (r < 0.7)
      return {
        label: 'Above Fair Value',
        color: 'text-amber-400',
        tip: 'Forward returns turning mediocre. Consider reducing leverage.',
      };
    if (r < 0.85)
      return {
        label: 'Expensive',
        color: 'text-orange-400',
        tip: 'Historically poor 10yr forward returns from here.',
      };
    return {
      label: 'Bubble',
      color: 'text-rose-500',
      tip: '2000, 1929, 2021 territory. Size accordingly.',
    };
  }, [data]);

  const option = useMemo(() => {
    if (!data) return null;
    // Yearly downsample to keep rendering snappy (155 × 12 = 1860 months)
    const step = Math.max(1, Math.floor(data.points.length / 1500));
    const riskLine: [number, number][] = [];
    const priceLine: [number, number][] = [];
    for (let i = 0; i < data.points.length; i += step) {
      const r = data.metric[i];
      if (r != null) riskLine.push([data.points[i].t, Number(r.toFixed(4))]);
      priceLine.push([data.points[i].t, Number(data.points[i].price.toFixed(2))]);
    }
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
        data: ['SP500 Price', 'Risk Metric'],
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
          type: 'log',
          name: 'SPX',
          nameTextStyle: { color: '#10b981', fontSize: 11 },
          position: 'left',
          axisLine: { show: true, lineStyle: { color: '#10b981' } },
          axisLabel: { color: '#10b981', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.08)' } },
        },
        {
          type: 'value',
          name: 'Risk',
          nameTextStyle: { color: '#06b6d4', fontSize: 11 },
          position: 'right',
          min: 0,
          max: 1,
          axisLine: { show: true, lineStyle: { color: '#06b6d4' } },
          axisLabel: { color: '#06b6d4', fontSize: 10, formatter: (v: number) => v.toFixed(1) },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'SP500 Price',
          type: 'line',
          yAxisIndex: 0,
          data: priceLine,
          lineStyle: { color: '#10b981', width: 1.5 },
          itemStyle: { color: '#10b981' },
          symbol: 'none',
        },
        {
          name: 'Risk Metric',
          type: 'line',
          yAxisIndex: 1,
          data: riskLine,
          smooth: 0.2,
          lineStyle: { color: '#06b6d4', width: 2 },
          itemStyle: { color: '#06b6d4' },
          symbol: 'none',
          markArea: {
            silent: true,
            itemStyle: { opacity: 0.08 },
            data: [
              [{ yAxis: 0.75, itemStyle: { color: '#f43f5e' } }, { yAxis: 1.0 }],
              [{ yAxis: 0, itemStyle: { color: '#10b981' } }, { yAxis: 0.25 }],
            ],
          },
        },
      ],
    };
  }, [data]);

  const gaugeOption = useMemo(() => {
    if (!data?.latest.metric) return null;
    return {
      backgroundColor: 'transparent',
      series: [
        {
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 1,
          radius: '95%',
          center: ['50%', '58%'],
          splitNumber: 10,
          axisLine: {
            lineStyle: {
              width: 18,
              color: [
                [0.15, '#10b981'],
                [0.3, '#22c55e'],
                [0.45, '#06b6d4'],
                [0.55, '#94a3b8'],
                [0.7, '#f59e0b'],
                [0.85, '#fb923c'],
                [1, '#f43f5e'],
              ],
            },
          },
          pointer: { itemStyle: { color: '#f1f5f9' }, width: 4, length: '75%' },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: '#94a3b8',
            distance: -30,
            fontSize: 10,
            formatter: (v: number) => v.toFixed(1),
          },
          title: { show: false },
          detail: {
            formatter: (v: number) => v.toFixed(3),
            fontSize: 28,
            fontWeight: 700,
            color: '#f1f5f9',
            offsetCenter: [0, '40%'],
          },
          data: [{ value: data.latest.metric }],
        },
      ],
    };
  }, [data]);

  const breakdownOption = useMemo(() => {
    if (!data) return null;
    const n = data.latest.normalized;
    const items = [
      { name: 'Mayer\n12m', value: n.mayerLike12m },
      { name: '24m SMA\nDistance', value: n.sma24mDistance },
      { name: 'Regression\nσ', value: n.regressionSigma },
      { name: 'RSI-14m', value: n.rsi14m },
      { name: 'Drawdown\nfrom ATH', value: n.drawdownFromAth },
    ].filter((x): x is { name: string; value: number } => x.value != null);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: (p: { name: string; value: number }) =>
          `${p.name.replace('\n', ' ')}: ${(p.value * 100).toFixed(1)}%`,
      },
      grid: { top: 10, bottom: 50, left: 40, right: 10 },
      xAxis: {
        type: 'category',
        data: items.map((i) => i.name),
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, lineHeight: 12 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        axisLine: { show: false },
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (v: number) => v.toFixed(1) },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.08)' } },
      },
      series: [
        {
          type: 'bar',
          data: items.map((i) => ({
            value: i.value,
            itemStyle: {
              color:
                i.value < 0.3
                  ? '#10b981'
                  : i.value < 0.5
                    ? '#06b6d4'
                    : i.value < 0.7
                      ? '#f59e0b'
                      : '#f43f5e',
            },
          })),
          barWidth: '50%',
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#94a3b8', type: 'dashed', opacity: 0.4 },
            label: { show: false },
            data: [{ yAxis: 0.5 }],
          },
        },
      ],
    };
  }, [data]);

  const componentLabels: Record<string, { label: string; fmt: (v: number) => string }> = {
    mayerLike12m: { label: 'Mayer (12m)', fmt: (v) => `${v.toFixed(2)}×` },
    sma24mDistance: { label: '24m SMA Dist', fmt: (v) => `${(v * 100).toFixed(1)}%` },
    regressionSigma: { label: 'Regression σ', fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}σ` },
    rsi14m: { label: 'RSI-14m', fmt: (v) => v.toFixed(1) },
    drawdownFromAth: { label: 'Drawdown ATH', fmt: (v) => `${(v * 100).toFixed(1)}%` },
  };

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Gauge className="w-5 h-5 text-cyan-400" />
          SP500 Risk Metric (Composite 0–1)
        </h3>
        <p className="text-[13px] text-surface-600 mt-1 leading-relaxed">
          Cowen-style 0–1 risk scalar adapted for the monthly Shiller SP500 dataset (1871–present).
          Five inputs percentile-ranked over a rolling 50-year window, then averaged.{' '}
          <span className="text-emerald-400 font-semibold">0 = generational low</span>,{' '}
          <span className="text-rose-500 font-semibold">1 = bubble</span>. The stock-market
          equivalent of our BTC risk metric.
        </p>
      </div>

      {loading && (
        <div className="h-[560px] flex items-center justify-center text-surface-500 text-[13px]">
          Loading 155 years of Shiller data...
        </div>
      )}

      {error && !loading && (
        <div className="h-[560px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[11px]">{error}</div>
        </div>
      )}

      {!loading && !error && data && option && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="p-4 rounded-xl border border-border/40 bg-surface-100/20">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium mb-2">
                Current Risk Metric
              </div>
              {gaugeOption && (
                <ReactECharts
                  option={gaugeOption}
                  style={{ height: '200px', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                  notMerge
                />
              )}
              {zone && (
                <div className="mt-2 text-center">
                  <div className={`text-[18px] font-bold ${zone.color}`}>{zone.label}</div>
                  <div className="text-[11px] text-surface-600 mt-1">{zone.tip}</div>
                </div>
              )}
            </div>
            <div className="p-4 rounded-xl border border-border/40 bg-surface-100/20">
              <div className="text-[10px] text-surface-500 uppercase tracking-wider font-medium mb-2">
                Component Percentile Breakdown
              </div>
              {breakdownOption && (
                <ReactECharts
                  option={breakdownOption}
                  style={{ height: '200px', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                  notMerge
                />
              )}
              <div className="text-[10px] text-surface-500 mt-2 text-center">
                Each bar = 50yr rolling percentile (0 = cheap, 1 = expensive)
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
            {(Object.keys(componentLabels) as Array<keyof typeof componentLabels>).map((key) => {
              const meta = componentLabels[key];
              const raw = data.latest.components[key as keyof typeof data.latest.components];
              const norm = data.latest.normalized[key as keyof typeof data.latest.normalized];
              return (
                <div key={key} className="p-2 rounded-lg border border-border/40 bg-surface-100/20">
                  <div className="text-[9px] text-surface-500 uppercase tracking-wider font-medium">
                    {meta.label}
                  </div>
                  <div className="text-[14px] font-bold text-surface-200 mt-0.5">
                    {raw != null ? meta.fmt(raw) : '—'}
                  </div>
                  <div className="text-[9px] text-cyan-400 mt-0.5">
                    {norm != null ? `p=${(norm * 100).toFixed(0)}` : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          <ReactECharts
            option={option}
            style={{ height: '340px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          <div className="mt-3 text-[10px] text-surface-500 text-center">
            Historical risk metric (cyan, right axis) overlaid on SP500 price (green, log). Source:
            Shiller dataset (1871–present).
          </div>
        </>
      )}
    </Card>
  );
}
