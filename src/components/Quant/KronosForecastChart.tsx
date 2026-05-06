import { Card } from '@/components/ui/card';
import { Brain, AlertCircle, ExternalLink } from 'lucide-react';
import { useKronosForecast } from './useQuantData';

function upsideZone(p: number): {
  label: string;
  color: string;
  bg: string;
  border: string;
} {
  // Anchored at 50% — significant deviation either way is the signal. Below
  // 30 / above 70 is a strong directional bet from the model.
  if (p >= 0.7)
    return {
      label: 'Strong Upside',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/40',
    };
  if (p >= 0.55)
    return {
      label: 'Bullish Tilt',
      color: 'text-emerald-300',
      bg: 'bg-emerald-500/5',
      border: 'border-emerald-500/30',
    };
  if (p >= 0.45)
    return {
      label: 'Coin Flip',
      color: 'text-amber-300',
      bg: 'bg-amber-500/5',
      border: 'border-amber-500/30',
    };
  if (p >= 0.3)
    return {
      label: 'Bearish Tilt',
      color: 'text-rose-300',
      bg: 'bg-rose-500/5',
      border: 'border-rose-500/30',
    };
  return {
    label: 'Strong Downside',
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/40',
  };
}

function volAmpZone(p: number): {
  label: string;
  color: string;
  bg: string;
  border: string;
} {
  if (p >= 0.75)
    return {
      label: 'Vol Spike Likely',
      color: 'text-orange-400',
      bg: 'bg-orange-500/10',
      border: 'border-orange-500/40',
    };
  if (p >= 0.5)
    return {
      label: 'Elevated Vol',
      color: 'text-amber-300',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/40',
    };
  return {
    label: 'Calm Expected',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/40',
  };
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const minutes = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Kronos foundation model — BTC/USDT 24h probabilistic forecast scraped
 *  from shiyu-coder.github.io/Kronos-demo. Two scalars (upside probability +
 *  volatility amplification) plus the upstream Monte-Carlo chart. Treat as
 *  one signal among many — it's a 4M-param model on hourly Binance candles,
 *  useful as a tilt indicator, not a trade trigger. */
export function KronosForecastChart() {
  const { data, loading, error } = useKronosForecast();

  const upZone = data ? upsideZone(data.upsideProbability) : null;
  const volZone = data ? volAmpZone(data.volAmplification) : null;
  const stale = data?.stale === true;

  return (
    <Card variant="glass" className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-950 flex items-center gap-2">
          <Brain className="w-5 h-5 text-fuchsia-400" />
          Kronos Forecast{' '}
          <span className="text-[12px] font-normal text-surface-700">BTC/USDT · 24h horizon</span>
        </h3>
        <p className="text-[13px] text-surface-800 mt-1 leading-relaxed">
          A foundation model pre-trained on candlestick data. Kronos-mini (4M params) runs
          Monte-Carlo sampling over the last 360 hours of Binance 1h candles to produce a
          probabilistic forecast. Two scalars: probability the price rises in 24h, and probability
          volatility spikes. Updated hourly upstream.
        </p>
      </div>

      {loading && (
        <div className="h-[400px] flex items-center justify-center text-surface-700 text-[13px]">
          Loading Kronos forecast...
        </div>
      )}

      {error && !loading && (
        <div className="h-[400px] flex flex-col items-center justify-center gap-2 text-danger-400 p-6 text-center">
          <AlertCircle className="w-5 h-5" />
          <div className="text-[13px] font-medium">Kronos forecast unavailable</div>
          <div className="text-[11px] text-surface-700 max-w-md">{error}</div>
        </div>
      )}

      {!loading && !error && data && upZone && volZone && (
        <>
          {stale && (
            <div className="mb-3 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-300">
              Showing cached forecast — upstream fetch failed. {data.fetchError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div className={`p-4 rounded-xl border-2 ${upZone.border} ${upZone.bg}`}>
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Upside Probability (24h)
              </div>
              <div className={`text-[36px] font-bold ${upZone.color} mt-0.5 leading-none`}>
                {(data.upsideProbability * 100).toFixed(1)}%
              </div>
              <div className={`text-[12px] font-semibold mt-1 ${upZone.color}`}>{upZone.label}</div>
              <div className="text-[11px] text-surface-700 mt-2">
                P(price 24h from now &gt; last close)
              </div>
            </div>
            <div className={`p-4 rounded-xl border-2 ${volZone.border} ${volZone.bg}`}>
              <div className="text-[10px] text-surface-700 uppercase tracking-wider font-medium">
                Volatility Amplification (24h)
              </div>
              <div className={`text-[36px] font-bold ${volZone.color} mt-0.5 leading-none`}>
                {(data.volAmplification * 100).toFixed(1)}%
              </div>
              <div className={`text-[12px] font-semibold mt-1 ${volZone.color}`}>
                {volZone.label}
              </div>
              <div className="text-[11px] text-surface-700 mt-2">
                P(next-24h vol &gt; recent historical vol)
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/40 bg-surface-100/30 p-3 mb-3">
            <div className="text-[11px] text-surface-700 mb-2">
              24-hour probabilistic forecast (Monte-Carlo, N=30). Blue = recent history, orange =
              mean prediction, shaded band = full forecast range.
            </div>
            <img
              src={data.chartUrl}
              alt="Kronos BTC/USDT 24h probabilistic forecast"
              className="w-full rounded-lg"
              loading="lazy"
            />
          </div>

          <div className="flex items-center justify-between gap-4 text-[10px] text-surface-700 flex-wrap">
            <div>
              Upstream model run: <span className="text-surface-900">{data.upstreamUpdatedAt}</span>{' '}
              · {timeAgo(data.upstreamUpdatedAt)}
            </div>
            <div className="flex items-center gap-3">
              <a
                href="https://shiyu-coder.github.io/Kronos-demo/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline inline-flex items-center gap-1"
              >
                Demo <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href="https://github.com/shiyu-coder/Kronos"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline inline-flex items-center gap-1"
              >
                GitHub <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href="https://arxiv.org/abs/2508.02739"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline inline-flex items-center gap-1"
              >
                Paper <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
