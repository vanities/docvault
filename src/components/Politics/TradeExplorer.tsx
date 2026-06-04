import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Search, TrendingUp, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface Spender {
  politician: string;
  chamber: string;
  trades: number;
  buys: number;
  sells: number;
  estMin: number;
  estMax: number;
  tickers: string[];
  lastTradeDate: string | null;
}

interface Trade {
  politicianName: string;
  chamber: string;
  ticker: string | null;
  assetName: string;
  category: string;
  transactionDescription: string;
  tradeDate: string;
  amount: string | null;
  sourceUrl: string | null;
}

const CHAMBER_LABEL: Record<string, string> = {
  house: 'House',
  senate: 'Senate',
  executive: 'Executive',
};

/** Compact USD: 1_500_000 → "$1.5M", 250_000 → "$250K". */
function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function categoryClass(category: string): string {
  if (category === 'buy') return 'text-emerald-400';
  if (category === 'sell') return 'text-rose-400';
  if (category === 'exchange') return 'text-sky-400';
  return 'text-surface-500';
}

export function TradeExplorer() {
  const [spenders, setSpenders] = useState<Spender[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/politics/top-spenders?limit=200')
      .then((res) => res.json() as Promise<{ spenders?: Spender[] }>)
      .then((data) => {
        if (!cancelled) setSpenders(data.spenders ?? []);
      })
      .catch(() => {
        if (!cancelled) setSpenders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setTrades([]);
      return;
    }
    let cancelled = false;
    setTradesLoading(true);
    fetch(`/api/politics/trades?politician=${encodeURIComponent(selected)}&limit=400`)
      .then((res) => res.json() as Promise<{ trades?: Trade[] }>)
      .then((data) => {
        if (!cancelled) setTrades(data.trades ?? []);
      })
      .catch(() => {
        if (!cancelled) setTrades([]);
      })
      .finally(() => {
        if (!cancelled) setTradesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? spenders.filter((s) => s.politician.toLowerCase().includes(q)) : spenders;
    return rows.slice(0, q ? 50 : 20);
  }, [spenders, query]);

  return (
    <Card variant="glass" className="p-4 border-border/50">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          {selected ? (
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-xs text-surface-600 hover:text-surface-900"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Top spenders
            </button>
          ) : (
            <>
              <Users className="w-4 h-4 text-surface-600" />
              <h3 className="text-sm font-semibold text-surface-950">Politician trades</h3>
            </>
          )}
        </div>
        {!selected && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search politician (e.g. Pelosi)…"
              className="pl-7 pr-2 py-1 text-xs bg-surface-100/60 border border-border/50 rounded-md text-surface-900 placeholder:text-surface-500 focus:outline-none focus:border-accent-400/60 w-56"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-surface-600 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading trades…
        </div>
      ) : selected ? (
        <PoliticianTrades politician={selected} trades={trades} loading={tradesLoading} />
      ) : filtered.length === 0 ? (
        <p className="text-xs text-surface-600 py-4">
          {query
            ? `No politician matching “${query}” in the cached trades.`
            : 'No trades cached yet. Run the politics refresh or a backfill.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((s, i) => (
            <button
              key={s.politician}
              onClick={() => setSelected(s.politician)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-100/60 text-left transition-colors"
            >
              <span className="text-[11px] font-mono text-surface-500 w-5 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-surface-950 truncate">
                    {s.politician}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-surface-500 shrink-0">
                    {CHAMBER_LABEL[s.chamber] ?? s.chamber}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-surface-600">
                  <span className="text-emerald-400/80">{s.buys} buy</span>
                  <span className="text-rose-400/80">{s.sells} sell</span>
                  {s.tickers.length > 0 && (
                    <span className="font-mono text-accent-400/80 truncate">
                      {s.tickers.slice(0, 5).join(' ')}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[13px] font-semibold text-surface-900 tabular-nums">
                  ≤{usd(s.estMax)}
                </div>
                <div className="text-[10px] text-surface-500">{s.trades} trades</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function PoliticianTrades({
  politician,
  trades,
  loading,
}: {
  politician: string;
  trades: Trade[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-surface-600 py-6 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading {politician}'s trades…
      </div>
    );
  }
  if (trades.length === 0) {
    return <p className="text-xs text-surface-600 py-4">No cached trades for {politician}.</p>;
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="w-4 h-4 text-surface-600" />
        <h3 className="text-sm font-semibold text-surface-950">{politician}</h3>
        <span className="text-[11px] text-surface-500">{trades.length} trades</span>
      </div>
      <div className="max-h-96 overflow-y-auto -mx-1">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-surface-50/95 backdrop-blur">
            <tr className="text-[10px] uppercase tracking-wide text-surface-500 text-left">
              <th className="px-2 py-1 font-medium">Date</th>
              <th className="px-2 py-1 font-medium">Type</th>
              <th className="px-2 py-1 font-medium">Ticker</th>
              <th className="px-2 py-1 font-medium">Asset</th>
              <th className="px-2 py-1 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={`${t.tradeDate}-${t.ticker}-${i}`} className="border-t border-border/30">
                <td className="px-2 py-1 text-surface-700 tabular-nums whitespace-nowrap">
                  {t.tradeDate}
                </td>
                <td className={`px-2 py-1 font-medium ${categoryClass(t.category)}`}>
                  {t.transactionDescription || t.category}
                </td>
                <td className="px-2 py-1 font-mono text-accent-400">{t.ticker ?? '—'}</td>
                <td
                  className="px-2 py-1 text-surface-700 max-w-[14rem] truncate"
                  title={t.assetName}
                >
                  {t.assetName}
                </td>
                <td className="px-2 py-1 text-surface-800 text-right whitespace-nowrap tabular-nums">
                  {t.amount ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
