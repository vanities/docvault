// Consensus panel — surfaces clustered activity: when several different
// politicians buy (or sell) the same ticker within a short window. Reads
// /api/politics/clusters (server/politics/clusters.ts). One member buying a name
// is noise; a cluster of them in a few weeks is the signal worth seeing.

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface ClusterTrade {
  politicianName: string;
  tradeDate: string;
  amount: string | null;
  amountRange: string | null;
  category: string;
  sourceUrl: string | null;
}

interface Cluster {
  ticker: string;
  direction: 'buy' | 'sell';
  politicians: string[];
  politicianCount: number;
  tradeCount: number;
  firstDate: string;
  lastDate: string;
  spanDays: number;
  amountMin: number | null;
  amountMax: number | null;
  trades: ClusterTrade[];
  politicianImages: { name: string; imageUrl?: string | null }[];
}

type DirectionFilter = 'all' | 'buy' | 'sell';
type SortKey = 'members' | 'recent' | 'amount' | 'trades';

const SORT_LABELS: Record<SortKey, string> = {
  members: 'Most members',
  recent: 'Most recent',
  amount: 'Largest $',
  trades: 'Most trades',
};

/** Client-side re-sort of the already-fetched clusters. */
function sortClusters(clusters: Cluster[], key: SortKey): Cluster[] {
  const out = [...clusters];
  out.sort((a, b) => {
    switch (key) {
      case 'recent':
        return b.lastDate.localeCompare(a.lastDate) || b.politicianCount - a.politicianCount;
      case 'amount':
        return (b.amountMax ?? 0) - (a.amountMax ?? 0) || b.politicianCount - a.politicianCount;
      case 'trades':
        return b.tradeCount - a.tradeCount || b.politicianCount - a.politicianCount;
      case 'members':
      default:
        return (
          b.politicianCount - a.politicianCount ||
          b.tradeCount - a.tradeCount ||
          b.lastDate.localeCompare(a.lastDate)
        );
    }
  });
  return out;
}

/** Compact USD: 1_500_000 → "$1.5M", 250_000 → "$250K". */
function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function tickerUrl(ticker: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker.replace(/\./g, '-'))}`;
}

function initialsOf(name: string): string {
  return name
    .replace(/^(Hon\.|Rep\.|Sen\.|Mr\.|Mrs\.|Ms\.|Dr\.)\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function Avatar({
  name,
  imageUrl,
  size = 30,
}: {
  name: string;
  imageUrl?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt={name}
        title={name}
        onError={() => setFailed(true)}
        className="rounded-full object-cover object-top bg-surface-200 ring-2 ring-surface-900"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      title={name}
      className="rounded-full bg-surface-200 text-surface-600 grid place-items-center font-semibold ring-2 ring-surface-900"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initialsOf(name)}
    </div>
  );
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

function ClusterCard({ cluster }: { cluster: Cluster }) {
  const [open, setOpen] = useState(false);
  const buy = cluster.direction === 'buy';
  const shownAvatars = cluster.politicianImages.slice(0, 7);
  const extra = cluster.politicianCount - shownAvatars.length;
  return (
    <div className="rounded-lg border border-border/60 bg-surface-900/40 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <a
            href={tickerUrl(cluster.ticker)}
            target="_blank"
            rel="noreferrer"
            className="font-mono font-bold text-base text-surface-100 hover:text-sky-400 inline-flex items-center gap-1"
          >
            {cluster.ticker}
            <ExternalLink className="w-3 h-3 opacity-50" />
          </a>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
              buy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
            }`}
          >
            {buy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {buy ? 'Bought' : 'Sold'}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-surface-200 shrink-0">
          <Users className="w-3.5 h-3.5 text-surface-500" />
          {cluster.politicianCount}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-2.5">
        <div className="flex -space-x-2">
          {shownAvatars.map((p) => (
            <Avatar key={p.name} name={p.name} imageUrl={p.imageUrl} />
          ))}
          {extra > 0 && (
            <div className="rounded-full bg-surface-800 text-surface-300 grid place-items-center text-[11px] font-semibold ring-2 ring-surface-900 w-[30px] h-[30px]">
              +{extra}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2.5 text-xs text-surface-500">
        <span>
          {fmtDate(cluster.firstDate)} – {fmtDate(cluster.lastDate)}
          {cluster.spanDays > 0 && <span className="text-surface-600"> · {cluster.spanDays}d</span>}
        </span>
        {cluster.amountMin != null && cluster.amountMax != null && (
          <span className="font-mono text-surface-400">
            {usd(cluster.amountMin)}–{usd(cluster.amountMax)}
          </span>
        )}
        <span>
          {cluster.tradeCount} trade{cluster.tradeCount === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-sky-500 hover:text-sky-400 font-medium"
        >
          {open ? 'Hide' : 'Details'}
        </button>
      </div>

      {open && (
        <div className="mt-2.5 border-t border-border/40 pt-2 space-y-1">
          {cluster.trades.map((t, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-surface-300 truncate">{t.politicianName}</span>
              <span className="flex items-center gap-2 shrink-0 text-surface-500">
                {(t.amountRange || t.amount) && (
                  <span className="font-mono">{t.amountRange || t.amount}</span>
                )}
                <span className="tabular-nums">{fmtDate(t.tradeDate)}</span>
                {t.sourceUrl && (
                  <a
                    href={t.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-surface-600 hover:text-sky-400"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConsensusPanel() {
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [windowDays, setWindowDays] = useState(60);
  const [sort, setSort] = useState<SortKey>('members');

  const sorted = useMemo(() => sortClusters(clusters ?? [], sort), [clusters, sort]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams({ windowDays: String(windowDays), limit: '40' });
    if (direction !== 'all') params.set('direction', direction);
    fetch(`/api/politics/clusters?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (alive) setClusters(data.clusters ?? []);
      })
      .catch(() => {
        if (alive) setClusters([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [direction, windowDays]);

  const tabs: { key: DirectionFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'buy', label: 'Buys' },
    { key: 'sell', label: 'Sells' },
  ];

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl text-surface-950 flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-500" />
            Consensus trades
          </h2>
          <p className="text-sm text-surface-600 mt-1 max-w-2xl">
            Tickers multiple members traded the same way within {windowDays} days of each other —
            clustered buying or selling worth a closer look.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border/60 overflow-hidden text-sm">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setDirection(t.key)}
                className={`px-3 py-1 font-medium ${
                  direction === t.key
                    ? 'bg-surface-800 text-surface-100'
                    : 'text-surface-500 hover:text-surface-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="text-sm bg-surface-900 border border-border/60 rounded-md px-2 py-1 text-surface-300"
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            title="Sort clusters"
            className="text-sm bg-surface-900 border border-border/60 rounded-md px-2 py-1 text-surface-300"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-surface-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : sorted.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {sorted.map((c) => (
              <ClusterCard key={`${c.ticker}-${c.direction}-${c.firstDate}`} cluster={c} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-surface-600 py-8 text-center">
            No consensus clusters in this window yet — needs ≥2 members trading the same ticker the
            same way within {windowDays} days.
          </p>
        )}
      </div>
    </Card>
  );
}
