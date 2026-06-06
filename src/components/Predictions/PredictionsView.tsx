import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Scale,
  TrendingUp,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTopN } from '@/hooks/useTopN';
import { ShowMore } from '@/components/ui/ShowMore';

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

const MOVER_THRESHOLD_PP = 1; // ignore sub-1pp noise in the movers strip

function formatVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
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

function closeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

// Direction is encoded twice (arrow + colour) so it reads at a glance; magnitude
// in percentage points. Emerald up / rose down matches the Midnight Ledger palette.
function ChangeChip({ change }: { change: number }) {
  const up = change > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono ${up ? 'text-accent-400' : 'text-danger-400'}`}
    >
      <Icon className="w-3 h-3" />
      {Math.abs(change)}pp
    </span>
  );
}

// Neutral emerald fill — bar length encodes magnitude; we deliberately don't
// colour by probability band, since a low-probability market isn't "bad".
function ProbBar({ p }: { p: number }) {
  const w = Math.min(100, Math.max(0, p));
  return (
    <div className="h-1.5 w-full bg-surface-200/60 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full bg-accent-500 transition-[width] duration-500 ease-out"
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

// "What changed since you last looked" — Change Blindness: surface movement
// rather than silently updating values buried in two 30-row lists.
function TopMovers({ markets }: { markets: PredictionMarket[] }) {
  if (markets.length === 0) return null;
  return (
    <section>
      <h2 className="text-[11px] font-semibold text-surface-700 uppercase tracking-[0.15em] mb-2">
        Biggest 24h moves
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        {markets.map((m) => (
          <a
            key={`${m.source}:${m.id}`}
            href={m.url}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card rounded-xl p-3 flex flex-col gap-2 hover:border-border-strong transition-colors group"
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-mono font-semibold text-surface-950">
                {Math.round(m.probability)}%
              </span>
              <ChangeChip change={m.change24h ?? 0} />
            </div>
            <p className="text-[12px] text-surface-800 leading-snug line-clamp-2 group-hover:text-surface-950">
              {m.question}
            </p>
            <div className="flex items-center gap-2 mt-auto">
              <SourceBadge source={m.source} />
              <span className="text-[10px] font-mono text-surface-600">
                {formatVolume(m.volumeUsd)}
              </span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function MarketRow({ m }: { m: PredictionMarket }) {
  const close = closeLabel(m.closeTime);
  return (
    <div className="flex items-center gap-4 py-3 group">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <SourceBadge source={m.source} />
          <span className="text-[10px] text-surface-600 uppercase tracking-wide">{m.topic}</span>
        </div>
        <a
          href={m.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-start gap-1 text-[13px] text-surface-900 hover:text-accent-400 transition-colors"
        >
          <span className="leading-snug">{m.question}</span>
          <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
        </a>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-surface-600">
          <span className="font-mono">{formatVolume(m.volumeUsd)}</span>
          <span className="text-surface-500">vol</span>
          {close && (
            <>
              <span className="text-surface-700">·</span>
              <span>closes {close}</span>
            </>
          )}
          {typeof m.change24h === 'number' && m.change24h !== 0 && (
            <>
              <span className="text-surface-700">·</span>
              <ChangeChip change={m.change24h} />
            </>
          )}
        </div>
      </div>
      <div className="w-28 flex-shrink-0">
        <div className="text-right font-mono font-semibold text-surface-950 leading-none mb-1.5">
          <span className="text-2xl">{Math.round(m.probability)}</span>
          <span className="text-sm text-surface-600">%</span>
        </div>
        <ProbBar p={m.probability} />
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
  const totalVol = markets.reduce((s, m) => s + (m.volumeUsd || 0), 0);
  const list = useTopN(markets, 10);
  return (
    <section className="animate-fade-in">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-surface-600" />
        <h2 className="text-[11px] font-semibold text-surface-700 uppercase tracking-[0.15em]">
          {title}
        </h2>
        <span className="text-[11px] text-surface-500">·</span>
        <span className="text-[11px] text-surface-600">{markets.length} markets</span>
        {totalVol > 0 && (
          <>
            <span className="text-[11px] text-surface-500">·</span>
            <span className="text-[11px] font-mono text-surface-600">
              {formatVolume(totalVol)} vol
            </span>
          </>
        )}
      </div>
      {markets.length === 0 ? (
        <Card variant="glass" className="p-4 border-border/50">
          <p className="text-xs text-surface-600">No {title.toLowerCase()} markets right now.</p>
        </Card>
      ) : (
        <Card variant="glass" className="px-4 border-border/50 divide-y divide-border/40">
          {list.visible.map((m) => (
            <MarketRow key={`${m.source}:${m.id}`} m={m} />
          ))}
          <ShowMore
            expanded={list.expanded}
            hiddenCount={list.hiddenCount}
            onToggle={list.toggle}
          />
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

  // Biggest absolute movers across both domains — the "what changed" hero.
  const movers = useMemo(() => {
    if (!data) return [];
    return [...data.finance, ...data.politics]
      .filter((m) => typeof m.change24h === 'number' && Math.abs(m.change24h) >= MOVER_THRESHOLD_PP)
      .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))
      .slice(0, 4);
  }, [data]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-surface-600 font-semibold">
            Predictions
          </p>
          <h1 className="font-display text-3xl text-surface-950 italic mt-1">Prediction markets</h1>
          <p className="text-sm text-surface-700 mt-2 max-w-3xl">
            Real-money-weighted odds from Kalshi and Polymarket on the finance and political
            questions you track. These are live market probabilities — what traders are betting, not
            certainties. Sports and novelty markets are filtered out.
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
          <span className="text-surface-700">·</span>
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
        <div className="space-y-7">
          <TopMovers markets={movers} />
          <MarketSection title="Finance" icon={TrendingUp} markets={data.finance} />
          <MarketSection title="Politics" icon={Scale} markets={data.politics} />
        </div>
      ) : null}
    </div>
  );
}
