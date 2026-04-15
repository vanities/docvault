import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card } from '@/components/ui/card';
import { Cpu, AlertCircle } from 'lucide-react';
import { useHashRate } from './useQuantData';

/** Format hash rate for display. blockchain.info reports in TH/s, so
 *  convert to PH/s → EH/s → ZH/s as the number grows. Modern total BTC
 *  hash rate is in the hundreds of EH/s range. */
function fmtHash(ths: number): string {
  if (ths >= 1_000_000_000) return `${(ths / 1_000_000_000).toFixed(2)} ZH/s`;
  if (ths >= 1_000_000) return `${(ths / 1_000_000).toFixed(1)} EH/s`;
  if (ths >= 1000) return `${(ths / 1000).toFixed(1)} PH/s`;
  return `${ths.toFixed(0)} TH/s`;
}

/** BTC Hash Rate + Hash Ribbons — the total compute power securing the
 *  Bitcoin network plus Charles Edwards' Hash Ribbons indicator. When the
 *  30d SMA of hash rate crosses back above the 60d SMA after a capitulation
 *  dip, it has historically been an excellent buy signal. */
export function HashRateChart() {
  const { data, loading, error } = useHashRate();

  const option = useMemo(() => {
    if (!data) return null;
    // Convert TH/s → EH/s for a readable y-axis on modern data. No rounding
    // (earlier iterations used toFixed(2) and collapsed 2013-era 0.000005
    // EH/s values to 0, which broke the log axis).
    const toEh = (th: number) => th / 1_000_000;

    // Trim to the last 8 years so we don't fight a 7-order-of-magnitude
    // span on the log axis. Hash Ribbons is a short/medium-term signal
    // anyway — the modern era is what you care about.
    const latestT = data.series.length > 0 ? data.series[data.series.length - 1].t : Date.now();
    const windowStart = latestT - 8 * 365 * 24 * 60 * 60 * 1000;
    const recent = data.series.filter((p) => p.t >= windowStart);

    const hash = recent.filter((p) => p.hashRate > 0).map((p) => [p.t, toEh(p.hashRate)]);
    const sma30 = recent
      .filter((p) => p.sma30 != null && (p.sma30 as number) > 0)
      .map((p) => [p.t, toEh(p.sma30 as number)]);
    const sma60 = recent
      .filter((p) => p.sma60 != null && (p.sma60 as number) > 0)
      .map((p) => [p.t, toEh(p.sma60 as number)]);

    // Hash ribbon events within the trimmed window — we render them as
    // vertical `markLine`s so we don't need a y-value (log scale can't
    // handle y=0 markers).
    const recentEvents = data.events.filter((e) => e.t >= windowStart);
    const eventLines = recentEvents.map((e) => ({
      xAxis: e.t,
      lineStyle: {
        color: e.type === 'recovery' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(244, 63, 94, 0.6)',
        width: 1,
        type: 'dashed' as const,
      },
      label: {
        show: true,
        position: 'end' as const,
        color: e.type === 'recovery' ? '#10b981' : '#f43f5e',
        fontSize: 9,
        formatter: e.type === 'recovery' ? '↑' : '↓',
      },
    }));

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(20, 24, 32, 0.95)',
        borderColor: 'rgba(100, 116, 139, 0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(14, 165, 233, 0.5)' } },
        valueFormatter: (v: number) => `${v.toFixed(1)} EH/s`,
      },
      legend: {
        data: ['Hash Rate', '30d SMA', '60d SMA'],
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 4,
      },
      grid: { top: 40, bottom: 40, left: 65, right: 20 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'log',
        name: 'EH/s',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.3)' } },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 10,
          formatter: (v: number) => {
            if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
            if (v >= 1) return v.toFixed(0);
            return v.toFixed(2);
          },
        },
        splitLine: { lineStyle: { color: 'rgba(100, 116, 139, 0.1)' } },
      },
      series: [
        {
          name: 'Hash Rate',
          type: 'line',
          data: hash,
          lineStyle: { color: 'rgba(100, 116, 139, 0.5)', width: 0.8 },
          itemStyle: { color: 'rgba(100, 116, 139, 0.5)' },
          symbol: 'none',
        },
        {
          name: '30d SMA',
          type: 'line',
          data: sma30,
          lineStyle: { color: '#06b6d4', width: 1.5 },
          itemStyle: { color: '#06b6d4' },
          symbol: 'none',
          markLine:
            eventLines.length > 0 ? { silent: true, symbol: 'none', data: eventLines } : undefined,
        },
        {
          name: '60d SMA',
          type: 'line',
          data: sma60,
          lineStyle: { color: '#f59e0b', width: 1.5 },
          itemStyle: { color: '#f59e0b' },
          symbol: 'none',
        },
      ],
    };
  }, [data]);

  const regime = data?.latest.regime ?? 'unknown';
  const regimeColor =
    regime === 'bullish'
      ? 'text-emerald-400'
      : regime === 'bearish'
        ? 'text-rose-400'
        : 'text-surface-700';
  const regimeLabel =
    regime === 'bullish'
      ? 'Miners Expanding'
      : regime === 'bearish'
        ? 'Miner Capitulation'
        : 'Unknown';

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-cyan-400" />
          BTC Hash Rate + Hash Ribbons
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          Total compute power securing the Bitcoin network. Charles Edwards&apos;{' '}
          <strong>Hash Ribbons</strong> indicator watches the 30-day and 60-day moving averages:
          when 30d crosses <span className="text-rose-400">below</span> 60d, miners are
          capitulating; when it crosses back <span className="text-emerald-400">above</span>, the
          buy signal fires. Historically this has called every major BTC cycle low within weeks.
        </p>
      </div>

      {loading && (
        <div className="h-[480px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading blockchain.info hash rate...
        </div>
      )}

      {error && !loading && (
        <div className="h-[480px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Hash rate not available</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
        </div>
      )}

      {!loading && !error && data && option && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl border-2 border-cyan-500/40 bg-cyan-500/5">
              <div className="text-[10px] text-cyan-500 uppercase tracking-wider font-medium">
                Hash Rate
              </div>
              <div className="text-[22px] font-bold text-cyan-400 mt-0.5">
                {fmtHash(data.latest.hashRate)}
              </div>
              <div className="text-[11px] text-surface-700">
                {new Date(data.latest.date).toLocaleDateString()}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                30d SMA
              </div>
              <div className="text-[22px] font-bold text-cyan-400 mt-0.5">
                {data.latest.sma30 != null ? fmtHash(data.latest.sma30) : '—'}
              </div>
              <div className="text-[11px] text-surface-700">Short-term trend</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                60d SMA
              </div>
              <div className="text-[22px] font-bold text-amber-400 mt-0.5">
                {data.latest.sma60 != null ? fmtHash(data.latest.sma60) : '—'}
              </div>
              <div className="text-[11px] text-surface-700">Slow baseline</div>
            </div>
            <div className="p-3 rounded-xl border border-border/40 bg-surface-100/30">
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Regime
              </div>
              <div className={`text-[16px] font-bold mt-0.5 ${regimeColor}`}>{regimeLabel}</div>
              <div className="text-[11px] text-surface-700">
                {data.latest.daysSinceRecovery != null
                  ? `${data.latest.daysSinceRecovery}d since last recovery`
                  : 'No recovery signal tracked'}
              </div>
            </div>
          </div>

          <ReactECharts
            option={option}
            style={{ height: '360px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />

          {/* Recent hash ribbon events */}
          {data.events.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-semibold text-surface-700 uppercase tracking-[0.15em] mb-2">
                Recent Hash Ribbon Events
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[...data.events]
                  .reverse()
                  .slice(0, 8)
                  .map((e, i) => (
                    <div
                      key={`${e.t}-${i}`}
                      className={`p-2 rounded-lg border flex items-center gap-2 ${
                        e.type === 'recovery'
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : 'border-rose-500/30 bg-rose-500/5'
                      }`}
                    >
                      <div
                        className={`text-[14px] font-bold ${
                          e.type === 'recovery' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {e.type === 'recovery' ? '↑' : '↓'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-mono text-surface-800">{e.date}</div>
                        <div
                          className={`text-[11px] font-semibold ${
                            e.type === 'recovery' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {e.type === 'recovery' ? 'Recovery (buy)' : 'Capitulation'}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="mt-3 text-[10px] text-surface-700 text-center">
            Source:{' '}
            <a
              href="https://www.blockchain.com/explorer/charts/hash-rate"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline"
            >
              blockchain.info charts/hash-rate
            </a>
            {' · Hash Ribbons by Charles Edwards (Capriole Investments)'}
          </div>
        </>
      )}
    </Card>
  );
}
