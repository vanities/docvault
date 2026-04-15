import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Gauge, AlertCircle } from 'lucide-react';
import { useBtcLogRegression } from './useQuantData';

/** BTC Risk Metric — composite 0-1 Cowen-style score.
 *  Blends 5 sub-indicators (Mayer multiple, 20W SMA distance, log-regression
 *  residual σ, RSI-14, drawdown from ATH), each normalized to a 0-1 rolling
 *  percentile, then averaged.
 *
 *  Per ITC: "Risk model created by Benjamin Cowen. Values closer to 1
 *  indicate higher risk and values closer to 0 indicate lower risk." */
export function BtcRiskMetricChart() {
  const { data, loading, error } = useBtcLogRegression();

  // Zone classification for current risk metric
  const zone = useMemo(() => {
    if (!data?.risk.latest.metric) return null;
    const r = data.risk.latest.metric;
    if (r < 0.15)
      return {
        label: 'Deep Value',
        color: 'text-emerald-500',
        tip: 'Historically, every generational buying opportunity.',
      };
    if (r < 0.3)
      return {
        label: 'Accumulation',
        color: 'text-emerald-400',
        tip: 'Max DCA. Size up your systematic buys.',
      };
    if (r < 0.45)
      return {
        label: 'Below Fair Value',
        color: 'text-cyan-400',
        tip: 'Continue DCA. Below-trend zone.',
      };
    if (r < 0.55)
      return {
        label: 'Fair Value',
        color: 'text-surface-200',
        tip: 'Neutral zone. Continue baseline DCA.',
      };
    if (r < 0.7)
      return {
        label: 'Above Fair Value',
        color: 'text-amber-400',
        tip: 'Reduce buying pace. Take some profits.',
      };
    if (r < 0.85)
      return {
        label: 'Overheated',
        color: 'text-orange-400',
        tip: 'Scale out. Cowen-style systematic profit taking.',
      };
    return {
      label: 'Euphoria',
      color: 'text-rose-500',
      tip: 'Top territory. Historically every cycle peak.',
    };
  }, [data]);

  // Main gauge + historical overlay combined chart option
  const option = useMemo(() => {
    if (!data) return null;

    // Downsample risk + price to keep rendering snappy
    const step = Math.max(1, Math.floor(data.prices.length / 1500));
    const riskLine: [number, number][] = [];
    const priceLine: [number, number][] = [];
    for (let i = 0; i < data.prices.length; i += step) {
      const r = data.risk.metric[i];
      if (r != null) riskLine.push([data.prices[i].t, Number(r.toFixed(4))]);
      priceLine.push([data.prices[i].t, Number(data.prices[i].price.toFixed(2))]);
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
        data: ['BTC Price', 'Risk Metric'],
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
          name: 'BTC',
          nameTextStyle: { color: '#fbbf24', fontSize: 11 },
          position: 'left',
          axisLine: { show: true, lineStyle: { color: '#fbbf24' } },
          axisLabel: { color: '#fbbf24', fontSize: 10 },
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
          name: 'BTC Price',
          type: 'line',
          yAxisIndex: 0,
          data: priceLine,
          lineStyle: { color: '#fbbf24', width: 1.5 },
          itemStyle: { color: '#fbbf24' },
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
              // High risk zone
              [{ yAxis: 0.75, itemStyle: { color: '#f43f5e' } }, { yAxis: 1.0 }],
              // Low risk zone
              [{ yAxis: 0, itemStyle: { color: '#10b981' } }, { yAxis: 0.25 }],
            ],
          },
        },
      ],
    };
  }, [data]);

  // Gauge-style option for the big current value readout
  const gaugeOption = useMemo(() => {
    if (!data?.risk.latest.metric) return null;
    const metric = data.risk.latest.metric;
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
          data: [{ value: metric }],
        },
      ],
    };
  }, [data]);

  // Component breakdown bar option
  const breakdownOption = useMemo(() => {
    if (!data) return null;
    const n = data.risk.latest.normalized;
    const items = [
      { name: 'Mayer\nMultiple', value: n.mayerMultiple },
      { name: '20W SMA\nDistance', value: n.sma20wDistance },
      { name: 'Regression\nσ', value: n.regressionSigma },
      { name: 'RSI-14', value: n.rsi14 },
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
    mayerMultiple: {
      label: 'Mayer Multiple',
      fmt: (v) => `${v.toFixed(2)}×`,
    },
    sma20wDistance: {
      label: '20W SMA Distance',
      fmt: (v) => `${(v * 100).toFixed(1)}%`,
    },
    regressionSigma: {
      label: 'Regression σ',
      fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}σ`,
    },
    rsi14: {
      label: 'RSI-14',
      fmt: (v) => v.toFixed(1),
    },
    drawdownFromAth: {
      label: 'Drawdown from ATH',
      fmt: (v) => `${(v * 100).toFixed(1)}%`,
    },
  };

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Gauge className="w-5 h-5 text-cyan-400" />
          BTC Risk Metric (Composite 0–1)
        </h3>
        <p className="text-[13px] text-surface-600 mt-1 leading-relaxed">
          Cowen-style 0–1 risk scalar blending 5 indicators: Mayer multiple, 20W SMA distance,
          log-regression σ, RSI-14, and drawdown from ATH. Each input percentile-ranked over a
          rolling 5-year window and averaged.{' '}
          <span className="text-emerald-400 font-semibold">0 = deep value</span>,{' '}
          <span className="text-rose-500 font-semibold">1 = euphoria</span>.
        </p>
      </div>

      {loading && (
        <div className="h-[560px] flex items-center justify-center text-surface-500 text-[13px]">
          Loading BTC history...
        </div>
      )}

      {error && !loading && (
        <div className="h-[560px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Failed to load risk metric</div>
          <div className="text-[11px] text-surface-500 max-w-md text-center">{error}</div>
        </div>
      )}

      {!loading && !error && data && option && (
        <>
          {/* Gauge + Zone */}
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

            {/* Component breakdown */}
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
                Each bar = that indicator's 5yr rolling percentile (0 = cheap, 1 = expensive)
              </div>
            </div>
          </div>

          {/* Raw component values row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
            {(Object.keys(componentLabels) as Array<keyof typeof componentLabels>).map((key) => {
              const meta = componentLabels[key];
              const raw =
                data.risk.latest.components[key as keyof typeof data.risk.latest.components];
              const norm =
                data.risk.latest.normalized[key as keyof typeof data.risk.latest.normalized];
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

          {/* Historical risk overlay with price */}
          <ReactECharts
            option={option}
            style={{ height: '340px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          <div className="mt-3 text-[10px] text-surface-500 text-center">
            Historical risk metric (cyan, right axis) overlaid on BTC price (orange, log scale).
            Green shading = low-risk (≤ 0.25), rose shading = high-risk (≥ 0.75).
          </div>
        </>
      )}
    </Card>
  );
}
