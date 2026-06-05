// Copy-trade performance leaderboard. Reads /api/politics/backtest: politicians
// ranked by the blended return you'd have made mirroring their stock buys at the
// disclosed size on the disclosure date. Click a row to expand their per-trade
// breakdown. Options show the underlying's move (the contract isn't priced);
// figures resting on estimated share counts are flagged.

import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface Perf {
  politician: string;
  buyCount: number;
  optionBuyCount: number;
  totalCostBasis: number;
  totalCurrentValue: number;
  totalGainAbs: number;
  returnPct: number | null;
  winRate: number | null;
  estimatedShareFraction: number;
  optionUnderlyingAvgPct: number | null;
  imageUrl?: string | null;
}
interface Sim {
  ticker: string;
  category: string;
  tradeDate: string;
  entryPrice: number | null;
  currentPrice: number | null;
  underlyingPct: number | null;
  gainPct: number | null;
  gainAbs: number | null;
  isOption: boolean;
  approximate: boolean;
  note: string | null;
}

function usd(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${s}$${Math.round(a / 1_000)}K`;
  return `${s}$${Math.round(a)}`;
}
function pct(n: number | null): string {
  return n == null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}
function pctClass(n: number | null): string {
  if (n == null) return 'text-surface-500';
  return n >= 0 ? 'text-emerald-400' : 'text-rose-400';
}
function initials(name: string): string {
  return name
    .replace(/^(Hon\.|Rep\.|Sen\.|Mr\.|Mrs\.|Ms\.|Dr\.)\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
function Avatar({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (imageUrl && !failed)
    return (
      <img
        src={imageUrl}
        alt={name}
        onError={() => setFailed(true)}
        className="w-8 h-8 rounded-full object-cover object-top bg-surface-200 ring-1 ring-border/50 shrink-0"
      />
    );
  return (
    <div className="w-8 h-8 rounded-full bg-surface-200 text-surface-600 grid place-items-center text-[11px] font-semibold ring-1 ring-border/50 shrink-0">
      {initials(name)}
    </div>
  );
}

function Detail({ politician }: { politician: string }) {
  const [sims, setSims] = useState<Sim[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/politics/backtest?politician=${encodeURIComponent(politician)}`)
      .then((r) => r.json())
      .then((d) => alive && setSims(d.trades ?? []))
      .catch(() => alive && setSims([]));
    return () => {
      alive = false;
    };
  }, [politician]);

  if (!sims)
    return (
      <div className="py-3 text-center text-surface-500">
        <Loader2 className="w-4 h-4 animate-spin inline" />
      </div>
    );
  const buys = sims.filter(
    (s) => s.category === 'buy' && (s.gainPct != null || s.underlyingPct != null)
  );
  if (buys.length === 0) return <p className="py-2 text-xs text-surface-600">No priced buys.</p>;
  return (
    <div className="mt-2 border-t border-border/40 pt-2 space-y-1 max-h-72 overflow-y-auto">
      {buys.map((s, i) => {
        const ret = s.isOption ? s.underlyingPct : s.gainPct;
        return (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-surface-200">{s.ticker || '—'}</span>
              {s.isOption && (
                <span className="text-[10px] px-1 rounded bg-amber-500/15 text-amber-300">OPT</span>
              )}
              {s.approximate && !s.isOption && (
                <span className="text-[10px] text-surface-600" title={s.note ?? ''}>
                  ~
                </span>
              )}
              <span className="text-surface-600 tabular-nums">{s.tradeDate}</span>
            </span>
            <span className="flex items-center gap-2 shrink-0 tabular-nums">
              {s.entryPrice != null && (
                <span className="text-surface-500">
                  ${s.entryPrice.toFixed(0)}→${s.currentPrice?.toFixed(0) ?? '?'}
                </span>
              )}
              <span className={`font-semibold ${pctClass(ret)}`}>{pct(ret)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PerformancePanel() {
  const [rows, setRows] = useState<Perf[] | null>(null);
  const [meta, setMeta] = useState<{
    generatedAt: string | null;
    priced?: number;
    total?: number;
    note?: string;
  }>({ generatedAt: null });
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/politics/backtest?limit=100')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setRows(d.leaderboard ?? []);
        setMeta({
          generatedAt: d.generatedAt,
          priced: d.pricedTickers,
          total: d.totalTickers,
          note: d.note,
        });
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl text-surface-950 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            Copy-trade performance
          </h2>
          <p className="text-sm text-surface-600 mt-1 max-w-2xl">
            If you'd mirrored each politician's stock buys at the disclosed size on the disclosure
            date, your blended return today. Options show the underlying's move (the contract isn't
            priced); <span className="font-mono">~</span> marks figures resting on an estimated
            share count. ~45-day disclosure lag applies.
          </p>
        </div>
        {meta.priced != null && (
          <span className="text-xs text-surface-600">
            {meta.priced}/{meta.total} tickers priced
          </span>
        )}
      </div>

      <div className="mt-4">
        {!rows ? (
          <div className="flex items-center justify-center py-10 text-surface-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-surface-600 py-8 text-center">
            {meta.note ?? 'No backtest yet — it runs with the daily refresh.'}
          </p>
        ) : (
          <div className="space-y-1">
            {rows.map((p, i) => (
              <div
                key={p.politician}
                className="rounded-lg border border-border/50 bg-surface-900/30"
              >
                <button
                  onClick={() => setExpanded(expanded === p.politician ? null : p.politician)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-900/50"
                >
                  <span className="text-xs text-surface-600 tabular-nums w-5">{i + 1}</span>
                  <Avatar name={p.politician} imageUrl={p.imageUrl} />
                  <span className="flex-1 min-w-0">
                    <span className="text-sm text-surface-200 truncate block">{p.politician}</span>
                    <span className="text-xs text-surface-600">
                      {p.buyCount} buy{p.buyCount === 1 ? '' : 's'}
                      {p.optionBuyCount > 0 && ` · ${p.optionBuyCount} opt`}
                      {p.winRate != null && ` · ${Math.round(p.winRate * 100)}% up`}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className={`block text-sm font-semibold ${pctClass(p.returnPct)}`}>
                      {pct(p.returnPct)}
                    </span>
                    {p.totalGainAbs !== 0 && (
                      <span className={`block text-xs ${pctClass(p.totalGainAbs)}`}>
                        {usd(p.totalGainAbs)}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-surface-500 transition-transform ${expanded === p.politician ? 'rotate-180' : ''}`}
                  />
                </button>
                {expanded === p.politician && (
                  <div className="px-3 pb-3">
                    <Detail politician={p.politician} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
