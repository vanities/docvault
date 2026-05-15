// TickersPanel — aggregate view of every ticker tagged on any Research
// entry, with live prices and source-entry context.
//
// What this gives you that a generic watchlist doesn't: the "top tickers"
// here are *your* analyst-conviction tickers — the symbols that have shown
// up in transcripts, PDFs, and notes you've actually filed. The default
// sort weights both how *often* a ticker appears and how *recently*, so
// the top of the list is what your own library is currently focused on.

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

interface ResearchEntry {
  id: string;
  title?: string;
  author?: string;
  publisher?: string;
  reportDate?: string;
  uploadedAt: string;
  sourceUrl?: string;
  tickers?: string[];
}

/** Matches server/ticker-prices.ts:TickerQuote — duplicated here because
 *  ResearchPanel uses the same shape and there's no shared types dir. */
interface TickerQuote {
  symbol: string;
  price: number | null;
  currency: string | null;
  oneYearChangePct: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  sparklineCloses: number[] | null;
  name: string | null;
  fetchedAt: string;
  error: string | null;
}

interface MentionRef {
  entryId: string;
  entryTitle: string;
  /** YYYY-MM-DD — reportDate if set, otherwise uploadedAt's date. */
  date: string;
}

interface TickerInfo {
  symbol: string;
  mentions: MentionRef[];
  /** Sum of per-mention recency weights — bigger = surfaces sooner. */
  scoreFreqRecency: number;
  /** YYYY-MM-DD of the newest mention. */
  mostRecentDate: string;
}

type FilterMode = 'topPicks' | 'recent' | 'mentioned' | 'alpha';

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Each mention contributes a linear recency weight: 1.0 if filed today,
 *  0 if filed >= 365 days ago. Newer mentions therefore dominate the
 *  default sort, but multiple older mentions can still float a ticker. */
function recencyWeight(dateStr: string): number {
  const daysSince = Math.max(
    0,
    (Date.now() - new Date(`${dateStr}T00:00:00`).getTime()) / 86_400_000
  );
  return Math.max(0, 1 - daysSince / 365);
}

function aggregateTickers(entries: ResearchEntry[]): TickerInfo[] {
  const map = new Map<string, TickerInfo>();
  for (const e of entries) {
    if (!e.tickers || e.tickers.length === 0) continue;
    const date = e.reportDate ?? e.uploadedAt.slice(0, 10);
    const weight = recencyWeight(date);
    const ref: MentionRef = {
      entryId: e.id,
      entryTitle: e.title ?? e.id,
      date,
    };
    for (const sym of e.tickers) {
      const info = map.get(sym);
      if (info) {
        info.mentions.push(ref);
        info.scoreFreqRecency += weight;
        if (date > info.mostRecentDate) info.mostRecentDate = date;
      } else {
        map.set(sym, {
          symbol: sym,
          mentions: [ref],
          scoreFreqRecency: weight,
          mostRecentDate: date,
        });
      }
    }
  }
  return [...map.values()];
}

function sortTickers(infos: TickerInfo[], mode: FilterMode): TickerInfo[] {
  const arr = [...infos];
  switch (mode) {
    case 'topPicks':
      arr.sort((a, b) => b.scoreFreqRecency - a.scoreFreqRecency);
      break;
    case 'recent':
      arr.sort((a, b) => b.mostRecentDate.localeCompare(a.mostRecentDate));
      break;
    case 'mentioned':
      arr.sort((a, b) => b.mentions.length - a.mentions.length);
      break;
    case 'alpha':
      arr.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function TickersPanel() {
  const [entries, setEntries] = useState<ResearchEntry[]>([]);
  const [quotes, setQuotes] = useState<TickerQuote[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('topPicks');

  const tickerInfos = useMemo(() => aggregateTickers(entries), [entries]);
  const sorted = useMemo(() => sortTickers(tickerInfos, filter), [tickerInfos, filter]);
  // Sorted-symbol-string so the effect doesn't refetch when only the
  // sort order changes (the set of symbols is what matters for fetching).
  const symbols = useMemo(
    () =>
      tickerInfos
        .map((t) => t.symbol)
        .sort()
        .join(','),
    [tickerInfos]
  );

  useEffect(() => {
    setLoadingEntries(true);
    fetch('/api/research')
      .then((r) => r.json() as Promise<{ entries: ResearchEntry[] }>)
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoadingEntries(false));
  }, []);

  useEffect(() => {
    if (!symbols) {
      setQuotes([]);
      return;
    }
    let cancelled = false;
    setLoadingQuotes(true);
    fetch(`/api/quant/tickers/prices?symbols=${encodeURIComponent(symbols)}`)
      .then((r) => r.json() as Promise<{ quotes: TickerQuote[] }>)
      .then((d) => {
        if (!cancelled) setQuotes(d.quotes ?? []);
      })
      .catch(() => {
        /* per-quote .error carries per-symbol failures */
      })
      .finally(() => {
        if (!cancelled) setLoadingQuotes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbols]);

  const quoteBySymbol = useMemo(() => {
    const m: Record<string, TickerQuote> = {};
    for (const q of quotes) m[q.symbol] = q;
    return m;
  }, [quotes]);

  if (loadingEntries) {
    return (
      <div className="text-center py-8 text-surface-700 text-[13px]">
        <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
        Loading entries…
      </div>
    );
  }

  if (tickerInfos.length === 0) {
    return (
      <div className="text-center py-12 text-surface-700 text-[13px] leading-relaxed">
        No tickers tagged on any Research entry yet.
        <br />
        Open an entry in the <span className="font-medium text-surface-800">Research</span> tab and
        add tickers in its metadata to see them here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sort toggle */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-surface-700">Sort:</span>
        {(
          [
            ['topPicks', 'Top picks'],
            ['recent', 'Most recent'],
            ['mentioned', 'Most mentioned'],
            ['alpha', 'A→Z'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setFilter(m)}
            className={`px-2 py-0.5 rounded transition-colors ${
              filter === m
                ? 'bg-surface-200/50 text-surface-950'
                : 'text-surface-600 hover:text-surface-800'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-surface-600">
          {tickerInfos.length} unique {tickerInfos.length === 1 ? 'ticker' : 'tickers'}
          {' · '}
          {entries.filter((e) => e.tickers?.length).length} tagged{' '}
          {entries.filter((e) => e.tickers?.length).length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {loadingQuotes && quotes.length === 0 && (
        <div className="text-[11px] text-surface-600 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading prices…
        </div>
      )}

      <div className="space-y-2">
        {sorted.map((info) => (
          <TickerRow key={info.symbol} info={info} quote={quoteBySymbol[info.symbol]} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-ticker row
// ---------------------------------------------------------------------------

function TickerRow({ info, quote }: { info: TickerInfo; quote: TickerQuote | undefined }) {
  const isUp = quote?.oneYearChangePct !== null && (quote?.oneYearChangePct ?? 0) >= 0;
  const sparklineData = (quote?.sparklineCloses ?? []).map((c, i) => ({ i, c }));
  const sparklineColor = isUp ? '#10b981' : '#f43f5e';
  const showCurrency = quote?.currency && quote.currency !== 'USD';

  // 0–100 position of current price within the 52w range, for the bar.
  const fiftyTwoPos =
    quote &&
    quote.price !== null &&
    quote.fiftyTwoWeekHigh !== null &&
    quote.fiftyTwoWeekLow !== null &&
    quote.fiftyTwoWeekHigh > quote.fiftyTwoWeekLow
      ? Math.min(
          100,
          Math.max(
            0,
            ((quote.price - quote.fiftyTwoWeekLow) /
              (quote.fiftyTwoWeekHigh - quote.fiftyTwoWeekLow)) *
              100
          )
        )
      : null;

  return (
    <Card variant="glass" className="px-4 py-3">
      <div className="flex items-center gap-4">
        {/* Symbol + name + mentions */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-mono font-semibold text-surface-950">
              {info.symbol}
            </span>
            {quote?.name && (
              <span className="text-[11px] text-surface-700 truncate">{quote.name}</span>
            )}
            <span className="text-[10px] text-surface-600">
              · {info.mentions.length} {info.mentions.length === 1 ? 'mention' : 'mentions'}
            </span>
          </div>
          <div className="text-[10px] text-surface-600 truncate mt-0.5">
            {info.mentions
              .slice(0, 3)
              .map((m) => m.entryTitle)
              .join(' · ')}
            {info.mentions.length > 3 && <span> · +{info.mentions.length - 3} more</span>}
          </div>
        </div>

        {/* Sparkline */}
        {sparklineData.length > 1 && (
          <div className="w-20 h-10 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <Line
                  type="monotone"
                  dataKey="c"
                  stroke={sparklineColor}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Price + 1y% + 52w position bar */}
        <div className="flex flex-col items-end min-w-32 flex-shrink-0">
          {!quote ? (
            <span className="text-[10px] text-surface-600">—</span>
          ) : quote.error ? (
            <span className="text-[10px] text-rose-400" title={quote.error}>
              price error
            </span>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-mono font-semibold text-surface-950">
                  {quote.price !== null ? quote.price.toFixed(2) : '?'}
                </span>
                {showCurrency && (
                  <span className="text-[10px] text-surface-600">{quote.currency}</span>
                )}
                <span
                  className={`text-[11px] font-mono ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {quote.oneYearChangePct !== null
                    ? (isUp ? '+' : '') + quote.oneYearChangePct.toFixed(0) + '%'
                    : '?'}
                </span>
              </div>
              {fiftyTwoPos !== null && (
                <div className="mt-1 w-32">
                  <div className="relative h-1 bg-surface-200/50 rounded-full">
                    <div
                      className={`absolute h-full w-0.5 rounded-full -translate-x-1/2 ${isUp ? 'bg-emerald-400' : 'bg-rose-400'}`}
                      style={{ left: `${fiftyTwoPos}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-surface-600 mt-0.5 font-mono">
                    <span>{quote.fiftyTwoWeekLow?.toFixed(0)}</span>
                    <span>{quote.fiftyTwoWeekHigh?.toFixed(0)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
