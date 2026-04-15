import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { CalendarRange, AlertCircle } from 'lucide-react';
import { usePresidentialCycle } from './useQuantData';

/** Presidential Cycle heatmap — average SPX monthly return for each
 *  (year-of-cycle, calendar month) cell, rendered as an ECharts heatmap.
 *  Cowen-style: blue = negative, red = positive, intensity scales with magnitude.
 *  The current month/year-of-cycle is highlighted. */
export function PresidentialCycleChart() {
  const { data, loading, error } = usePresidentialCycle();

  const option = useMemo(() => {
    if (!data) return null;

    // Flatten to ECharts heatmap format: [monthIdx, yearOfCycleIdx, value]
    // ECharts' yAxis renders bottom-up by default; we want Y1 on top, Y4 on
    // bottom, so we flip the y-axis index.
    const flipped = [3, 2, 1, 0];
    const points: [number, number, number][] = [];
    for (let y = 0; y < 4; y++) {
      for (let m = 0; m < 12; m++) {
        points.push([m, flipped[y], Number(data.matrix[y][m].toFixed(2))]);
      }
    }

    // Symmetric color scale so 0 is the visual midpoint.
    const absMax = Math.max(...data.matrix.flat().map((v) => Math.abs(v)), 1);
    const clampedMax = Math.min(Math.ceil(absMax * 2) / 2, 5); // cap at ±5% for consistent coloring

    const nowMonth = new Date().getMonth(); // 0-indexed
    const currentYoC = data.currentYearOfCycle - 1; // 0-indexed
    const currentYoCFlipped = flipped[currentYoC];

    return {
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: (rawParams: unknown) => {
          const params = rawParams as { value: [number, number, number] };
          const [mi, yiFlipped, val] = params.value;
          const yi = flipped[yiFlipped];
          const year = data.yearLabels[yi];
          const month = data.monthLabels[mi];
          const count = data.counts[yi][mi];
          const color = val >= 0 ? '#10b981' : '#f43f5e';
          return `
            <div style="padding: 4px 2px;">
              <div style="font-weight: 600; color: #f1f5f9;">${year}</div>
              <div style="color: #94a3b8; font-size: 11px;">${month}</div>
              <div style="margin-top: 6px; font-size: 14px; font-weight: 600; color: ${color};">
                ${val >= 0 ? '+' : ''}${val.toFixed(2)}%
              </div>
              <div style="color: #64748b; font-size: 10px; margin-top: 2px;">
                avg across ${count} observations
              </div>
            </div>
          `;
        },
      },
      grid: {
        top: 50,
        bottom: 60,
        left: 140,
        right: 30,
      },
      xAxis: {
        type: 'category',
        data: data.monthLabels,
        splitArea: { show: true },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          fontWeight: 500,
        },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: flipped.map((i) => data.yearLabels[i]),
        splitArea: { show: true },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          fontWeight: 500,
        },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisTick: { show: false },
      },
      visualMap: {
        min: -clampedMax,
        max: clampedMax,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 10,
        inRange: {
          // Cowen-style red/green diverging — negative = red, positive = green
          color: [
            '#7f1d1d',
            '#b91c1c',
            '#ef4444',
            '#fca5a5',
            '#f1f5f9',
            '#86efac',
            '#22c55e',
            '#16a34a',
            '#14532d',
          ],
        },
        textStyle: { color: '#94a3b8', fontSize: 11 },
        itemWidth: 14,
        itemHeight: 180,
        formatter: (val: number) => `${val >= 0 ? '+' : ''}${val.toFixed(1)}%`,
      },
      series: [
        {
          type: 'heatmap',
          data: points,
          label: {
            show: true,
            formatter: (rawParams: unknown) => {
              const params = rawParams as { value: [number, number, number] };
              const val = params.value[2];
              return `${val >= 0 ? '+' : ''}${val.toFixed(1)}`;
            },
            color: '#0f172a',
            fontSize: 10,
            fontWeight: 600,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(14, 165, 233, 0.5)',
            },
          },
          markPoint: {
            symbol: 'pin',
            symbolSize: 40,
            itemStyle: { color: '#0ea5e9' },
            label: { color: '#fff', fontSize: 10, fontWeight: 700 },
            data: [
              {
                name: 'Now',
                coord: [nowMonth, currentYoCFlipped],
                value: 'NOW',
              },
            ],
          },
        },
      ],
    };
  }, [data]);

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <CalendarRange className="w-5 h-5 text-cyan-400" />
          Presidential Cycle Heatmap
        </h3>
        <p className="text-[13px] text-surface-600 mt-1 leading-relaxed">
          Average monthly S&amp;P 500 return by year-of-cycle and calendar month. Year 2 (midterm)
          is historically the weakest; Year 3 (pre-election) is the best. The
          <span className="text-cyan-400 font-semibold"> NOW</span> pin marks where we are in the
          cycle today.
        </p>
      </div>

      {loading && (
        <div className="h-[420px] flex items-center justify-center text-surface-500 text-[13px]">
          Loading {data?.dataRange ? '...' : 'Shiller dataset (1871–present)...'}
        </div>
      )}

      {error && !loading && (
        <div className="h-[420px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Failed to load cycle data</div>
          <div className="text-[11px] text-surface-500">{error}</div>
        </div>
      )}

      {!loading && !error && option && data && (
        <>
          <ReactECharts
            option={option}
            style={{ height: '420px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-surface-500 items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-surface-600 font-medium">Source:</span>{' '}
                <span className="text-surface-900">
                  {data.source === 'shiller'
                    ? 'Shiller SP500 (GitHub)'
                    : 'Yahoo Finance (fallback)'}
                </span>
              </div>
              <div>
                <span className="text-surface-600 font-medium">Range:</span>{' '}
                <span className="text-surface-900">
                  {data.dataRange.from} → {data.dataRange.to}
                </span>
              </div>
              <div>
                <span className="text-surface-600 font-medium">Current:</span>{' '}
                <span className="text-cyan-400 font-semibold">
                  {data.currentYear} · Y{data.currentYearOfCycle}{' '}
                  {
                    ['Post-election', 'Midterm', 'Pre-election', 'Election'][
                      data.currentYearOfCycle - 1
                    ]
                  }
                </span>
              </div>
            </div>
            {data.stale && (
              <div className="text-amber-400">⚠ Stale cache — latest refresh failed</div>
            )}
          </div>

          {/* Annual average row */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            {data.yearLabels.map((label, i) => {
              const annual = data.matrix[i].reduce((a, b) => a + b, 0);
              const isCurrent = i === data.currentYearOfCycle - 1;
              return (
                <div
                  key={label}
                  className={`p-2 rounded-lg border ${
                    isCurrent
                      ? 'border-cyan-500/50 bg-cyan-500/10'
                      : 'border-border/40 bg-surface-100/30'
                  }`}
                >
                  <div className="text-[10px] text-surface-500 font-medium uppercase tracking-wider">
                    {label}
                  </div>
                  <div
                    className={`text-[15px] font-bold mt-0.5 ${
                      annual >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {annual >= 0 ? '+' : ''}
                    {annual.toFixed(2)}%
                  </div>
                  <div className="text-[9px] text-surface-500 mt-0.5">avg annual sum</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
