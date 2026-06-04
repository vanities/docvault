import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Loader2, Search, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface MonthBucket {
  m: string; // YYYY-MM
  b: number; // buy count
  s: number; // sell count
}

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
  imageUrl?: string | null;
  monthly?: MonthBucket[];
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
  amountMin: number | null;
  amountMax: number | null;
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

/** Headshot with an initials fallback when the image is missing or fails to load. */
function Avatar({
  name,
  imageUrl,
  size = 38,
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
        onError={() => setFailed(true)}
        className="rounded-full object-cover object-top bg-surface-200 shrink-0 ring-1 ring-border/50"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-surface-200 text-surface-600 grid place-items-center font-semibold shrink-0 ring-1 ring-border/50"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initialsOf(name)}
    </div>
  );
}

/** Tiny diverging sparkline: buys up (green), sells down (red), per month. */
function Sparkline({
  monthly,
  width = 66,
  height = 22,
}: {
  monthly?: MonthBucket[];
  width?: number;
  height?: number;
}) {
  if (!monthly || monthly.length === 0) return <div style={{ width }} className="shrink-0" />;
  const max = Math.max(1, ...monthly.map((m) => Math.max(m.b, m.s)));
  const n = monthly.length;
  const gap = 1.5;
  const bw = Math.max(1, (width - gap * (n - 1)) / n);
  const mid = height / 2;
  return (
    <svg width={width} height={height} className="shrink-0 text-surface-500" aria-hidden="true">
      <line x1={0} y1={mid} x2={width} y2={mid} stroke="currentColor" strokeOpacity={0.2} />
      {monthly.map((m, i) => {
        const x = i * (bw + gap);
        const bh = (m.b / max) * (mid - 1);
        const sh = (m.s / max) * (mid - 1);
        return (
          <g key={m.m}>
            {m.b > 0 && (
              <rect
                x={x}
                y={mid - bh}
                width={bw}
                height={bh}
                rx={0.5}
                className="fill-emerald-400"
              />
            )}
            {m.s > 0 && (
              <rect x={x} y={mid} width={bw} height={sh} rx={0.5} className="fill-rose-400" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Inclusive list of YYYY-MM from `start` to `end`. */
function monthsBetween(start: string, end: string): string[] {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const out: string[] = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); ) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

interface UsdMonth {
  m: string;
  buyUsd: number;
  sellUsd: number;
  buyN: number;
  sellN: number;
}

function monthlyUsdFromTrades(trades: Trade[], maxMonths = 15): UsdMonth[] {
  if (trades.length === 0) return [];
  const present = [...new Set(trades.map((t) => t.tradeDate.slice(0, 7)))].sort();
  const span = present.slice(-maxMonths);
  const months = monthsBetween(span[0], present[present.length - 1]).slice(-maxMonths);
  const map = new Map<string, UsdMonth>(
    months.map((m) => [m, { m, buyUsd: 0, sellUsd: 0, buyN: 0, sellN: 0 }])
  );
  for (const t of trades) {
    const bucket = map.get(t.tradeDate.slice(0, 7));
    if (!bucket) continue;
    const v = t.amountMax ?? 0;
    if (t.category === 'buy') {
      bucket.buyUsd += v;
      bucket.buyN += 1;
    } else if (t.category === 'sell') {
      bucket.sellUsd += v;
      bucket.sellN += 1;
    }
  }
  return [...map.values()];
}

/** Detail timeline: monthly buy ($, up/green) vs sell ($, down/red) diverging bars. */
function BuySellChart({ trades }: { trades: Trade[] }) {
  const series = useMemo(() => monthlyUsdFromTrades(trades), [trades]);
  if (series.length < 2) return null;
  const max = Math.max(1, ...series.map((p) => Math.max(p.buyUsd, p.sellUsd)));
  const W = 100; // viewBox units (scales to container width)
  const H = 64;
  const mid = H / 2;
  const n = series.length;
  const gap = 0.6;
  const bw = Math.max(0.5, (W - gap * (n - 1)) / n);
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wide text-surface-500">
          Buy / sell timeline ($ disclosed, by month)
        </span>
        <span className="flex items-center gap-2 text-[10px]">
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-2 h-2 rounded-sm bg-emerald-400" /> buys
          </span>
          <span className="flex items-center gap-1 text-rose-400">
            <span className="w-2 h-2 rounded-sm bg-rose-400" /> sells
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full text-surface-500"
        style={{ height: 88 }}
      >
        <line x1={0} y1={mid} x2={W} y2={mid} stroke="currentColor" strokeOpacity={0.25} />
        {series.map((p, i) => {
          const x = i * (bw + gap);
          const bh = (p.buyUsd / max) * (mid - 1);
          const sh = (p.sellUsd / max) * (mid - 1);
          return (
            <g key={p.m}>
              <title>{`${p.m} · ${p.buyN} buys ${usd(p.buyUsd)} · ${p.sellN} sells ${usd(p.sellUsd)}`}</title>
              <rect x={x} y={0} width={bw + gap} height={H} fill="transparent" />
              {p.buyUsd > 0 && (
                <rect x={x} y={mid - bh} width={bw} height={bh} className="fill-emerald-400" />
              )}
              {p.sellUsd > 0 && (
                <rect x={x} y={mid} width={bw} height={sh} className="fill-rose-400" />
              )}
            </g>
          );
        })}
      </svg>
      {/* Month captions rendered as HTML (not SVG) so they aren't stretched by
          preserveAspectRatio="none". Hover any bar for the exact month + $. */}
      <div className="flex justify-between text-[10px] text-surface-500 mt-1">
        <span>{series[0].m}</span>
        {series.length > 2 && <span>{series[Math.floor(series.length / 2)].m}</span>}
        <span>{series[series.length - 1].m}</span>
      </div>
    </div>
  );
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

  const selectedSpender = useMemo(
    () => spenders.find((s) => s.politician === selected) ?? null,
    [spenders, selected]
  );

  return (
    <Card variant="glass" className="p-4 border-border/50">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          {selected ? (
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-xs text-surface-600 hover:text-surface-900 cursor-pointer"
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
        <PoliticianTrades
          politician={selected}
          spender={selectedSpender}
          trades={trades}
          loading={tradesLoading}
        />
      ) : filtered.length === 0 ? (
        <p className="text-xs text-surface-600 py-4">
          {query
            ? `No politician matching “${query}” in the cached trades.`
            : 'No trades cached yet. Run the politics refresh or a backfill.'}
        </p>
      ) : (
        <div className="space-y-1">
          {filtered.map((s, i) => (
            <button
              key={s.politician}
              onClick={() => setSelected(s.politician)}
              className="group w-full flex items-center gap-3 px-2.5 py-2 rounded-xl border border-transparent hover:border-border/60 hover:bg-surface-100/70 cursor-pointer text-left transition-colors"
            >
              <span className="text-[11px] font-mono text-surface-500 w-4 shrink-0 text-right">
                {i + 1}
              </span>
              <Avatar name={s.politician} imageUrl={s.imageUrl} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-surface-950 truncate group-hover:text-accent-300">
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
              <div className="hidden sm:block" title="Buys (green) vs sells (red) by month">
                <Sparkline monthly={s.monthly} />
              </div>
              <div className="text-right shrink-0">
                <div className="text-[13px] font-semibold text-surface-900 tabular-nums">
                  ≤{usd(s.estMax)}
                </div>
                <div className="text-[10px] text-surface-500">{s.trades} trades</div>
              </div>
              <ChevronRight className="w-4 h-4 text-surface-400 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-surface-700" />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function PoliticianTrades({
  politician,
  spender,
  trades,
  loading,
}: {
  politician: string;
  spender: Spender | null;
  trades: Trade[];
  loading: boolean;
}) {
  return (
    <div>
      {/* Header card: headshot + name + summary stats */}
      <div className="flex items-start gap-4 mb-4 p-3 rounded-xl bg-surface-100/40 border border-border/40">
        <Avatar name={politician} imageUrl={spender?.imageUrl} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-surface-950 truncate">{politician}</h3>
            {spender && (
              <span className="text-[10px] uppercase tracking-wide text-surface-500 shrink-0">
                {CHAMBER_LABEL[spender.chamber] ?? spender.chamber}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1.5 text-[12px]">
            <span className="text-surface-700">
              <span className="font-semibold text-surface-950">
                {spender?.trades ?? trades.length}
              </span>{' '}
              trades
            </span>
            <span className="text-emerald-400">{spender?.buys ?? 0} buys</span>
            <span className="text-rose-400">{spender?.sells ?? 0} sells</span>
            {spender && (
              <span className="text-surface-600">
                ≤ <span className="font-semibold text-surface-800">{usd(spender.estMax)}</span>{' '}
                disclosed
              </span>
            )}
          </div>
          {spender && spender.tickers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {spender.tickers.map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-surface-200/70 px-1.5 py-0.5 text-[10px] font-mono text-accent-400"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {!loading && <BuySellChart trades={trades} />}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-surface-600 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading trades…
        </div>
      ) : trades.length === 0 ? (
        <p className="text-xs text-surface-600 py-4">No cached trades for {politician}.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto -mx-1 rounded-lg border border-border/30">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface-100/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wide text-surface-500 text-left">
                <th className="px-2.5 py-1.5 font-medium">Date</th>
                <th className="px-2.5 py-1.5 font-medium">Type</th>
                <th className="px-2.5 py-1.5 font-medium">Ticker</th>
                <th className="px-2.5 py-1.5 font-medium">Asset</th>
                <th className="px-2.5 py-1.5 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr
                  key={`${t.tradeDate}-${t.ticker}-${i}`}
                  className="border-t border-border/30 hover:bg-surface-100/40"
                >
                  <td className="px-2.5 py-1.5 text-surface-700 tabular-nums whitespace-nowrap">
                    {t.tradeDate}
                  </td>
                  <td className={`px-2.5 py-1.5 font-medium ${categoryClass(t.category)}`}>
                    {t.transactionDescription || t.category}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-accent-400">{t.ticker ?? '—'}</td>
                  <td
                    className="px-2.5 py-1.5 text-surface-700 max-w-[14rem] truncate"
                    title={t.assetName}
                  >
                    {t.assetName}
                  </td>
                  <td className="px-2.5 py-1.5 text-surface-800 text-right whitespace-nowrap tabular-nums">
                    {t.amount ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
