import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Mirrors the server's PredictionMarketsResponse (server/prediction-markets.ts),
// plus the cache envelope fields the /api/quant/predictions route adds.
type PredictionSource = 'kalshi' | 'polymarket';

interface PredictionMarket {
  id: string;
  source: PredictionSource;
  question: string;
  probability: number;
  volumeUsd: number;
  liquidityUsd?: number;
  closeTime: string | null;
  url: string;
  domain: 'finance' | 'politics';
  topic: string;
  change24h?: number | null;
}

interface PredictionMarketsResponse {
  finance: PredictionMarket[];
  politics: PredictionMarket[];
  fetchedAt: string;
  sources: { kalshi: boolean; polymarket: boolean };
  errors?: string[];
  cached?: boolean;
  stale?: boolean;
  fetchError?: string;
}

function formatVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleDateString();
}

function probBarColor(p: number): string {
  if (p >= 66) return 'bg-emerald-500';
  if (p >= 33) return 'bg-amber-500';
  return 'bg-rose-500';
}

function SourceBadge({ source }: { source: PredictionSource }) {
  const cls =
    source === 'kalshi' ? 'text-cyan-400 bg-cyan-500/10' : 'text-violet-400 bg-violet-500/10';
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {source === 'kalshi' ? 'Kalshi' : 'Polymarket'}
    </span>
  );
}

function MarketRow({ m }: { m: PredictionMarket }) {
  const close = m.closeTime ? new Date(m.closeTime) : null;
  const closeLabel =
    close && !Number.isNaN(close.getTime())
      ? close.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
  const prob = Math.min(100, Math.max(0, m.probability));

  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <SourceBadge source={m.source} />
          <span className="text-[10px] text-surface-600">{m.topic}</span>
        </div>
        <a
          href={m.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start gap-1 text-[13px] text-surface-900 hover:text-accent-400"
        >
          <span className="leading-snug">{m.question}</span>
          <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100" />
        </a>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-surface-600">
          <span>{formatVolume(m.volumeUsd)} vol</span>
          {closeLabel && <span>· closes {closeLabel}</span>}
          {typeof m.change24h === 'number' && m.change24h !== 0 && (
            <span
              className={`inline-flex items-center gap-0.5 ${
                m.change24h > 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {m.change24h > 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {Math.abs(m.change24h)}pp
            </span>
          )}
        </div>
      </div>
      <div className="w-24 flex-shrink-0 text-right">
        <div className="text-2xl font-semibold tabular-nums text-surface-950">
          {Math.round(m.probability)}%
        </div>
        <div className="mt-1 h-1.5 w-full bg-surface-200/50 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${probBarColor(m.probability)}`}
            style={{ width: `${prob}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function MarketSection({
  title,
  icon: Icon,
  markets,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  markets: PredictionMarket[];
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-surface-600" />
        <h2 className="text-[11px] font-semibold text-surface-700 uppercase tracking-[0.15em]">
          {title}
        </h2>
        <span className="text-[11px] text-surface-500">{markets.length}</span>
      </div>
      {markets.length === 0 ? (
        <Card variant="glass" className="p-4 border-border/50">
          <p className="text-xs text-surface-600">No {title.toLowerCase()} markets right now.</p>
        </Card>
      ) : (
        <Card variant="glass" className="px-4 border-border/50 divide-y divide-border/40">
          {markets.map((m) => (
            <MarketRow key={`${m.source}:${m.id}`} m={m} />
          ))}
        </Card>
      )}
    </section>
  );
}

export function PredictionsView() {
  const [data, setData] = useState<PredictionMarketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((bust: boolean) => {
    let cancelled = false;
    if (bust) setRefreshing(true);
    else setLoading(true);
    setError(null);
    // Cache-bust on manual refresh so we bypass the browser Cache-Control.
    fetch(`/api/quant/predictions${bust ? `?_=${Date.now()}` : ''}`)
      .then((res) => res.json() as Promise<PredictionMarketsResponse & { error?: string }>)
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(false), [load]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-surface-600 font-semibold">
            Predictions
          </p>
          <h1 className="font-display text-3xl text-surface-950 italic mt-1">Prediction markets</h1>
          <p className="text-sm text-surface-700 mt-2 max-w-3xl">
            Live finance and political odds from Kalshi and Polymarket — real-money-weighted
            probabilities on the questions you track (Fed, recession, crypto, elections, Congress,
            geopolitics). Sports and novelty markets are filtered out.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load(true)}
          disabled={loading || refreshing}
          className="flex-shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-surface-600">
          <span>Updated {relativeTime(data.fetchedAt)}</span>
          {data.cached && <span className="px-1.5 py-0.5 rounded bg-surface-200/50">cached</span>}
          {data.stale && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">stale</span>
          )}
          <span>·</span>
          <span className={data.sources.kalshi ? 'text-cyan-400' : 'text-surface-500 line-through'}>
            Kalshi
          </span>
          <span
            className={
              data.sources.polymarket ? 'text-violet-400' : 'text-surface-500 line-through'
            }
          >
            Polymarket
          </span>
          {data.errors?.length ? (
            <span className="text-amber-400">· {data.errors.join('; ')}</span>
          ) : null}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-sm text-surface-600 py-12">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading prediction markets…
        </div>
      ) : error ? (
        <Card variant="glass" className="p-4 border-border/50">
          <div className="flex items-center gap-2 text-sm text-rose-400">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        </Card>
      ) : data ? (
        <div className="space-y-6">
          <MarketSection title="Finance" icon={TrendingUp} markets={data.finance} />
          <MarketSection title="Politics" icon={Scale} markets={data.politics} />
        </div>
      ) : null}
    </div>
  );
}
