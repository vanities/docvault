import { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import {
  Layers,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useSectorRotation, type SectorReturnData } from './useQuantData';

type SortKey = 'ticker' | 'ytd' | 'm1' | 'm3' | 'm6' | 'rs' | 'mom';

const QUADRANT_META = {
  leading: {
    label: 'Leading',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    dot: '#10b981',
    description: 'Already outperforming SPY AND still accelerating. Trend-follow.',
  },
  improving: {
    label: 'Improving',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    dot: '#06b6d4',
    description: 'Underperforming YoY but momentum turning up. Best risk-reward.',
  },
  weakening: {
    label: 'Weakening',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    dot: '#f59e0b',
    description: 'Still ahead YoY but momentum rolling over. Take profits.',
  },
  lagging: {
    label: 'Lagging',
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    dot: '#f43f5e',
    description: 'Below SPY AND losing ground. Avoid until improving.',
  },
  unknown: {
    label: '—',
    color: 'text-surface-700',
    bg: 'bg-surface-200/20',
    border: 'border-border/30',
    dot: '#64748b',
    description: '',
  },
} as const;

function fmtPct(v: number | null, decimals = 2): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

function QuadrantBadge({ quadrant }: { quadrant: SectorReturnData['quadrant'] }) {
  const meta = QUADRANT_META[quadrant];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wide ${meta.bg} ${meta.color} ${meta.border}`}
    >
      {quadrant === 'leading' && <TrendingUp className="w-3 h-3" />}
      {quadrant === 'improving' && <TrendingUp className="w-3 h-3" />}
      {quadrant === 'weakening' && <TrendingDown className="w-3 h-3" />}
      {quadrant === 'lagging' && <TrendingDown className="w-3 h-3" />}
      {meta.label}
    </span>
  );
}

function ReturnCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-surface-700">—</span>;
  const color = value >= 0 ? 'text-emerald-400' : 'text-rose-400';
  return <span className={`font-mono text-[12px] ${color}`}>{fmtPct(value)}</span>;
}

export function SectorRotationChart() {
  const { data, loading, error } = useSectorRotation();
  const [sortKey, setSortKey] = useState<SortKey>('rs');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    if (!data) return [];
    const getVal = (s: SectorReturnData): number | string => {
      switch (sortKey) {
        case 'ticker':
          return s.ticker;
        case 'ytd':
          return s.returns.ytd ?? -Infinity;
        case 'm1':
          return s.returns.m1 ?? -Infinity;
        case 'm3':
          return s.returns.m3 ?? -Infinity;
        case 'm6':
          return s.returns.m6 ?? -Infinity;
        case 'rs':
          return s.rsRatio ?? -Infinity;
        case 'mom':
          return s.momentum ?? -Infinity;
      }
    };
    return [...data.sectors].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [data, sortKey, sortDir]);

  const scatterOption = useMemo(() => {
    if (!data) return null;
    // Build the quadrant scatter: x = RS, y = Momentum, 100 is the axis origin
    const points = data.sectors
      .filter((s) => s.rsRatio != null && s.momentum != null)
      .map((s) => ({
        name: s.ticker,
        value: [s.rsRatio, s.momentum],
        sectorName: s.name,
        quadrant: s.quadrant,
        itemStyle: { color: QUADRANT_META[s.quadrant].dot },
      }));

    // Compute axis bounds with small padding so all points are visible
    const xs = points.map((p) => p.value[0] as number);
    const ys = points.map((p) => p.value[1] as number);
    const allVals = [...xs, ...ys];
    const maxDev = Math.max(...allVals.map((v) => Math.abs(v - 100)), 5);
    const pad = Math.max(maxDev * 1.2, 8);
    const xMin = 100 - pad;
    const xMax = 100 + pad;
    const yMin = 100 - pad;
    const yMax = 100 + pad;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: (rawParams: unknown) => {
          const p = rawParams as {
            data: {
              name: string;
              value: [number, number];
              sectorName: string;
              quadrant: keyof typeof QUADRANT_META;
            };
          };
          const meta = QUADRANT_META[p.data.quadrant];
          return `
            <div style="padding: 4px 2px;">
              <div style="font-weight: 600; color: #f1f5f9; font-size: 13px;">
                ${p.data.name} <span style="color:#94a3b8; font-weight: 400;">${p.data.sectorName}</span>
              </div>
              <div style="margin-top: 4px; font-size: 11px;">
                <div style="color:#94a3b8;">RS Ratio: <span style="color:#f1f5f9; font-weight:600;">${p.data.value[0].toFixed(2)}</span></div>
                <div style="color:#94a3b8;">Momentum: <span style="color:#f1f5f9; font-weight:600;">${p.data.value[1].toFixed(2)}</span></div>
                <div style="color: ${meta.dot}; font-weight: 600; margin-top:3px;">${meta.label}</div>
              </div>
            </div>
          `;
        },
      },
      grid: { top: 40, bottom: 50, left: 60, right: 30 },
      xAxis: {
        type: 'value',
        name: 'RS Ratio (1yr vs SPY)',
        nameLocation: 'middle',
        nameGap: 25,
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        min: xMin,
        max: xMax,
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
      },
      yAxis: {
        type: 'value',
        name: 'Momentum (3m vs SPY)',
        nameLocation: 'middle',
        nameGap: 45,
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        min: yMin,
        max: yMax,
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
      },
      // Quadrant backgrounds via markArea + axis lines at 100
      series: [
        {
          type: 'scatter',
          data: points,
          symbolSize: 28,
          label: {
            show: true,
            formatter: (p: { data: { name: string } }) => p.data.name,
            color: '#f1f5f9',
            fontSize: 10,
            fontWeight: 700,
            position: 'inside',
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(148, 163, 184, 0.4)', type: 'solid', width: 1 },
            label: { show: false },
            data: [{ xAxis: 100 }, { yAxis: 100 }],
          },
          markArea: {
            silent: true,
            itemStyle: { opacity: 0.06 },
            data: [
              // Leading (top-right) — emerald
              [{ coord: [100, 100], itemStyle: { color: '#10b981' } }, { coord: [xMax, yMax] }],
              // Improving (top-left) — cyan
              [{ coord: [xMin, 100], itemStyle: { color: '#06b6d4' } }, { coord: [100, yMax] }],
              // Weakening (bottom-right) — amber
              [{ coord: [100, yMin], itemStyle: { color: '#f59e0b' } }, { coord: [xMax, 100] }],
              // Lagging (bottom-left) — rose
              [{ coord: [xMin, yMin], itemStyle: { color: '#f43f5e' } }, { coord: [100, 100] }],
            ],
          },
        },
      ],
    };
  }, [data]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const SortHeader = ({
    label,
    k,
    align = 'right',
  }: {
    label: string;
    k: SortKey;
    align?: 'left' | 'right';
  }) => (
    <th
      className={`px-2 py-2 text-[10px] font-semibold text-surface-700 uppercase tracking-wider cursor-pointer hover:text-surface-800 select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => handleSort(k)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortKey === k &&
          (sortDir === 'desc' ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronUp className="w-3 h-3" />
          ))}
      </span>
    </th>
  );

  // Quadrant counts for summary
  const quadCounts = useMemo(() => {
    if (!data) return null;
    const counts = { leading: 0, improving: 0, weakening: 0, lagging: 0 };
    for (const s of data.sectors) {
      if (s.quadrant in counts) counts[s.quadrant as keyof typeof counts]++;
    }
    return counts;
  }, [data]);

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Layers className="w-5 h-5 text-emerald-400" />
          Sector Rotation
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          All 11 S&amp;P sector SPDR ETFs ranked by Relative Strength (1yr vs SPY) and Momentum (3m
          vs SPY), classified into the four Relative Rotation Graph quadrants.
          <span className="text-emerald-400 font-semibold"> Leading</span> and
          <span className="text-cyan-400 font-semibold"> Improving</span> sectors get your capital;{' '}
          <span className="text-amber-400 font-semibold">Weakening</span> and
          <span className="text-rose-400 font-semibold"> Lagging</span> don't.
        </p>
      </div>

      {loading && (
        <div className="h-[600px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading 12 tickers from Yahoo Finance...
        </div>
      )}

      {error && !loading && (
        <div className="h-[600px] flex flex-col items-center justify-center gap-2 text-danger-400">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Failed to load sector data</div>
          <div className="text-[11px] text-surface-700 max-w-md text-center">{error}</div>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Summary row: quadrant counts */}
          {quadCounts && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {(Object.keys(QUADRANT_META) as Array<keyof typeof QUADRANT_META>)
                .filter((k) => k !== 'unknown')
                .map((k) => {
                  const meta = QUADRANT_META[k];
                  const count = quadCounts[k as keyof typeof quadCounts] || 0;
                  return (
                    <div key={k} className={`p-2.5 rounded-lg border ${meta.bg} ${meta.border}`}>
                      <div
                        className={`text-[10px] font-semibold uppercase tracking-wider ${meta.color}`}
                      >
                        {meta.label}
                      </div>
                      <div className={`text-[18px] font-bold ${meta.color} mt-0.5`}>
                        {count}
                        <span className="text-[11px] text-surface-700 font-normal ml-1">
                          sectors
                        </span>
                      </div>
                      <div className="text-[10px] text-surface-800 mt-0.5 leading-tight">
                        {meta.description}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Quadrant scatter */}
          {scatterOption && (
            <div className="mb-4">
              <ReactECharts
                option={scatterOption}
                style={{ height: '380px', width: '100%' }}
                opts={{ renderer: 'canvas' }}
                notMerge
              />
            </div>
          )}

          {/* Sortable sector table */}
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border/40">
                  <SortHeader label="Ticker" k="ticker" align="left" />
                  <th className="px-2 py-2 text-left text-[10px] font-semibold text-surface-700 uppercase tracking-wider">
                    Sector
                  </th>
                  <th className="px-2 py-2 text-right text-[10px] font-semibold text-surface-700 uppercase tracking-wider">
                    Price
                  </th>
                  <SortHeader label="YTD" k="ytd" />
                  <SortHeader label="1M" k="m1" />
                  <SortHeader label="3M" k="m3" />
                  <SortHeader label="6M" k="m6" />
                  <SortHeader label="RS" k="rs" />
                  <SortHeader label="Mom" k="mom" />
                  <th className="px-2 py-2 text-right text-[10px] font-semibold text-surface-700 uppercase tracking-wider">
                    Quadrant
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr
                    key={s.ticker}
                    className="border-b border-border/20 hover:bg-surface-200/20 transition-colors"
                  >
                    <td className="px-2 py-2 font-mono font-bold text-surface-950">{s.ticker}</td>
                    <td className="px-2 py-2 text-surface-800">{s.name}</td>
                    <td className="px-2 py-2 text-right font-mono text-surface-800">
                      ${s.price.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <ReturnCell value={s.returns.ytd} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <ReturnCell value={s.returns.m1} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <ReturnCell value={s.returns.m3} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <ReturnCell value={s.returns.m6} />
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-surface-950">
                      {s.rsRatio != null ? s.rsRatio.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-surface-950">
                      {s.momentum != null ? s.momentum.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <QuadrantBadge quadrant={s.quadrant} />
                    </td>
                  </tr>
                ))}
                {/* SPY baseline row */}
                <tr className="border-t-2 border-border/60 bg-surface-200/10">
                  <td className="px-2 py-2 font-mono font-bold text-cyan-400">
                    {data.benchmark.ticker}
                  </td>
                  <td className="px-2 py-2 text-surface-700 italic">
                    {data.benchmark.name} (baseline)
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-surface-800">
                    ${data.benchmark.price.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <ReturnCell value={data.benchmark.returns.ytd} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <ReturnCell value={data.benchmark.returns.m1} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <ReturnCell value={data.benchmark.returns.m3} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <ReturnCell value={data.benchmark.returns.m6} />
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-surface-700">100.0</td>
                  <td className="px-2 py-2 text-right font-mono text-surface-700">100.0</td>
                  <td className="px-2 py-2 text-right text-[10px] text-surface-700">—</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-surface-700 items-center justify-between">
            <div>
              <span className="text-surface-800 font-medium">Source:</span>{' '}
              <span className="text-surface-900">Yahoo Finance</span>
              {' · '}
              <span className="text-surface-800 font-medium">Range:</span>{' '}
              <span className="text-surface-900">
                {data.dataRange.from} → {data.dataRange.to}
              </span>
            </div>
            <div className="text-surface-700">
              RS = 1yr return vs SPY · Mom = 3m return vs SPY · 100 = matching SPY
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
