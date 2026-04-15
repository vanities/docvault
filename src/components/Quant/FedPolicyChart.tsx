import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Landmark, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { useFedPolicy } from './useQuantData';

const STANCE_META = {
  cutting: {
    label: 'Cutting Cycle',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    tip: 'Fed is easing — typically risk-on for equities and crypto.',
  },
  hiking: {
    label: 'Hiking Cycle',
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    tip: 'Fed is tightening — typically risk-off, strengthens DXY.',
  },
  hold: {
    label: 'Hold',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    tip: 'Rate stable — market watching for the next pivot.',
  },
} as const;

/** Fed Policy chart — effective federal funds rate plotted with the target
 *  upper/lower band and markers on every rate change event. Shows the
 *  current stance (cutting/hiking/hold) and recent FOMC decisions. */
export function FedPolicyChart() {
  const { data, loading, error } = useFedPolicy();
  const meta = data ? STANCE_META[data.latest.stance] : null;

  const option = useMemo(() => {
    if (!data) return null;

    // Downsample effective rate to keep it snappy
    const step = Math.max(1, Math.floor(data.effectiveRate.length / 2500));
    const eff = data.effectiveRate
      .filter((_, i) => i % step === 0)
      .map((p) => [p.t, Number(p.rate.toFixed(2))]);
    const upper = data.targetUpper
      .filter((_, i) => i % step === 0)
      .map((p) => [p.t, Number(p.rate.toFixed(2))]);
    const lower = data.targetLower
      .filter((_, i) => i % step === 0)
      .map((p) => [p.t, Number(p.rate.toFixed(2))]);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(14, 165, 233, 0.5)' } },
        valueFormatter: (v: number) => `${v.toFixed(2)}%`,
      },
      legend: {
        data: ['Effective Rate', 'Target Upper', 'Target Lower'],
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 8,
      },
      grid: { top: 50, bottom: 40, left: 55, right: 30 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Rate (%)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
      },
      series: [
        {
          name: 'Target Upper',
          type: 'line',
          data: upper,
          lineStyle: { color: 'rgba(239, 68, 68, 0.5)', width: 1, type: 'dashed' },
          itemStyle: { color: 'rgba(239, 68, 68, 0.5)' },
          symbol: 'none',
          step: 'start',
        },
        {
          name: 'Target Lower',
          type: 'line',
          data: lower,
          lineStyle: { color: 'rgba(34, 197, 94, 0.5)', width: 1, type: 'dashed' },
          itemStyle: { color: 'rgba(34, 197, 94, 0.5)' },
          symbol: 'none',
          step: 'start',
        },
        {
          name: 'Effective Rate',
          type: 'line',
          data: eff,
          lineStyle: { color: '#06b6d4', width: 2 },
          itemStyle: { color: '#06b6d4' },
          symbol: 'none',
        },
      ],
    };
  }, [data]);

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Landmark className="w-5 h-5 text-cyan-400" />
          Fed Policy &amp; Rate Decisions
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Effective federal funds rate plotted against the FOMC target range (upper/lower bounds,
          2008+). Every rate change event is detected by walking the target history — hikes and cuts
          with their basis-point deltas. The current{' '}
          <span className="text-cyan-400 font-semibold">stance</span> is classified from the last 5
          rate changes.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading FRED rate history...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Fed policy not available</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
          {error.toLowerCase().includes('fred api key') && (
            <div className="text-[11px] text-cyan-400 mt-2">
              Add your free FRED API key in <strong>Settings → Quant</strong>.
            </div>
          )}
        </div>
      )}

      {!loading && !error && data && option && meta && (
        <>
          {/* Stats header */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5">
              <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-medium">
                Target Range
              </div>
              <div className="text-[16px] font-bold text-cyan-400 mt-0.5">
                {data.latest.targetLower.toFixed(2)}–{data.latest.targetUpper.toFixed(2)}%
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">
                Midpoint {((data.latest.targetUpper + data.latest.targetLower) / 2).toFixed(2)}%
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Effective Rate
              </div>
              <div className="text-[16px] font-bold text-surface-950 mt-0.5">
                {data.latest.effectiveRate.toFixed(2)}%
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">Market actual</div>
            </div>
            <div className={`p-3 rounded-xl border ${meta.border} ${meta.bg}`}>
              <div className={`text-[10px] uppercase tracking-wider font-medium ${meta.color}`}>
                Current Stance
              </div>
              <div className={`text-[16px] font-bold mt-0.5 ${meta.color}`}>{meta.label}</div>
              <div className="text-[10px] text-surface-800 mt-0.5 leading-tight">{meta.tip}</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Days Since Last Change
              </div>
              <div className="text-[16px] font-bold text-surface-950 mt-0.5">
                {data.latest.daysSinceLastChange}d
              </div>
              <div className="text-[10px] text-surface-700 mt-0.5">
                {data.rateChanges.length} total changes tracked
              </div>
            </div>
          </div>

          {/* Main chart */}
          <ReactECharts
            option={option}
            style={{ height: '360px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          {/* Recent rate changes list */}
          <div className="mt-4">
            <div className="text-[11px] font-semibold text-surface-700 uppercase tracking-[0.15em] mb-2">
              Recent FOMC Decisions
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[...data.rateChanges]
                .reverse()
                .slice(0, 10)
                .map((c, i) => {
                  const date = new Date(c.t).toISOString().slice(0, 10);
                  return (
                    <div
                      key={`${c.t}-${i}`}
                      className={`p-2 rounded-lg border flex items-center gap-2 ${
                        c.type === 'hike'
                          ? 'border-rose-500/30 bg-rose-500/5'
                          : 'border-emerald-500/30 bg-emerald-500/5'
                      }`}
                    >
                      {c.type === 'hike' ? (
                        <ArrowUp className="w-4 h-4 text-rose-400 flex-shrink-0" />
                      ) : (
                        <ArrowDown className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-mono text-surface-800">{date}</div>
                        <div
                          className={`text-[12px] font-bold ${
                            c.type === 'hike' ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {c.type === 'hike' ? '+' : ''}
                          {c.changeBps}bps → {c.newRate.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="mt-3 text-[10px] text-surface-700 text-center">
            Source:{' '}
            <a
              href="https://fred.stlouisfed.org/series/DFEDTARU"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline"
            >
              FRED (DFF + DFEDTARU/DFEDTARL)
            </a>
            {' · '}Target range history from 2008-12 onward
          </div>
        </>
      )}
    </Card>
  );
}
