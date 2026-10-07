import { useMemo, type ReactNode } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { AlertCircle, type LucideIcon } from 'lucide-react';
import type { MacroSeriesData, MacroDashboardData } from './useQuantData';

/** Shared mini-chart dashboard component — used by the Housing, GDP, Commodities,
 *  and VIX Term Structure cards. Each series is rendered as a small line with
 *  latest value + YoY change, following the same visual language as the existing
 *  Macro / Inflation / Jobs / Financial Conditions dashboards. */
export function SeriesDashboardCard({
  title,
  titleIcon: TitleIcon,
  titleIconClass,
  description,
  loading,
  error,
  data,
  colors,
  formatValue,
  formatYoyDetail,
  goodDirection,
  gridCols = 'md:grid-cols-2 lg:grid-cols-3',
  footer,
  missingKeyHint,
}: {
  title: string;
  titleIcon: LucideIcon;
  titleIconClass: string;
  description: ReactNode;
  loading: boolean;
  error: string | null;
  data: MacroDashboardData | null;
  colors: Record<string, string>;
  /** Format the latest value for display (optional — defaults to toLocaleString). */
  formatValue?: (s: MacroSeriesData, v: number) => string;
  /** Optional YoY detail formatter. Defaults to "+X.XX% YoY". */
  formatYoyDetail?: (s: MacroSeriesData, yoy: number) => string;
  /** Map each series id → 'up' (rising is good) or 'down' (rising is bad). */
  goodDirection?: Record<string, 'up' | 'down'>;
  /** Tailwind grid-cols classes for the mini-chart grid. Defaults to 3-col lg. */
  gridCols?: string;
  footer?: ReactNode;
  missingKeyHint?: boolean;
}) {
  const defaultFmt = (s: MacroSeriesData, v: number) =>
    `${v.toLocaleString(undefined, { maximumFractionDigits: s.decimals })}${s.unit}`;
  const fmtValue = formatValue ?? defaultFmt;
  const fmtYoy =
    formatYoyDetail ??
    ((_s: MacroSeriesData, yoy: number) => `${yoy >= 0 ? '+' : ''}${yoy.toFixed(2)}% YoY`);

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <TitleIcon className={`w-5 h-5 ${titleIconClass}`} />
          {title}
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">{description}</p>
      </div>

      {loading && (
        <div className="h-[400px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading series...
        </div>
      )}

      {error && !loading && (
        <div className="h-[400px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">{title} not available</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
          {missingKeyHint && error.toLowerCase().includes('fred api key') && (
            <div className="text-[11px] text-cyan-400 mt-2">
              Add your free FRED API key in <strong>Settings → Quant</strong>.
            </div>
          )}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${gridCols} gap-3`}>
            {data.series.map((s) => (
              <MiniChart
                key={s.id}
                series={s}
                color={colors[s.id] ?? '#94a3b8'}
                fmtValue={fmtValue}
                fmtYoy={fmtYoy}
                direction={goodDirection?.[s.id] ?? 'up'}
              />
            ))}
          </div>
          {footer && <div className="mt-3 text-[10px] text-surface-700 text-center">{footer}</div>}
        </>
      )}
    </Card>
  );
}

function MiniChart({
  series,
  color,
  fmtValue,
  fmtYoy,
  direction,
}: {
  series: MacroSeriesData;
  color: string;
  fmtValue: (s: MacroSeriesData, v: number) => string;
  fmtYoy: (s: MacroSeriesData, yoy: number) => string;
  direction: 'up' | 'down';
}) {
  const option = useMemo(() => {
    const points = series.points.map((p) => [p.t, p.value]);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        valueFormatter: (v: number) => fmtValue(series, v),
      },
      grid: { top: 5, bottom: 18, left: 50, right: 5 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 9 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { show: false },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 9,
          formatter: (v: number) => {
            if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
            if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
            return v.toFixed(series.decimals <= 1 ? 1 : 2);
          },
        },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.06)' } },
      },
      series: [
        {
          type: 'line',
          data: points,
          lineStyle: { color, width: 1.5 },
          itemStyle: { color },
          symbol: 'none',
          areaStyle: { color, opacity: 0.08 },
        },
      ],
    };
  }, [series, color, fmtValue]);

  const yoy = series.yoyChange ?? 0;
  const yoyGood = direction === 'up' ? yoy >= 0 : yoy < 0;
  const yoyClass = yoyGood ? 'text-emerald-400' : 'text-rose-400';

  return (
    <div className="p-3 rounded-xl border border-border/40 bg-surface-100/20">
      <div className="flex items-baseline justify-between mb-1">
        <div>
          <div className="text-[11px] font-semibold text-surface-950">{series.label}</div>
          <div className="text-[9px] text-surface-700 leading-tight">
            <span className="font-mono">{series.id}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-bold" style={{ color }}>
            {series.latest ? fmtValue(series, series.latest.value) : '—'}
          </div>
          {series.yoyChange != null && (
            <div className={`text-[10px] font-semibold ${yoyClass}`}>{fmtYoy(series, yoy)}</div>
          )}
        </div>
      </div>
      <ReactECharts
        option={option}
        style={{ height: '90px', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
      />
      <div className="text-[9px] text-surface-700 mt-1 leading-tight">{series.description}</div>
    </div>
  );
}
