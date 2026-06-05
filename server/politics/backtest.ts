// Trade backtest — "if you'd copied this, where would it be now?". PURE math; the
// price-fetching (historical + current) is injected, so this layer is fully
// deterministic and golden-tested.
//
// Honesty rules baked in (per the agreed approach):
//   - STOCK BUYS: real P&L. Share count comes from the disclosure when the filer
//     states it ("Purchased 25,000 shares") — otherwise estimated from the
//     amount-range midpoint and flagged. cost basis → current value → gain.
//   - OPTIONS: we can't price a historical contract for free, so we report the
//     UNDERLYING's % move since the trade as a labeled proxy — never a fake
//     option P&L.
//   - SELLS: position value isn't applicable (they exited); we report the
//     underlying's move since the sale, labeled.

export interface SimInput {
  ticker: string;
  category: string; // 'buy' | 'sell' | 'exchange' | ...
  tradeDate: string; // YYYY-MM-DD
  amountMin: number | null;
  amountMax: number | null;
  /** Exact share count when the filer disclosed it; else null → estimate. */
  knownShares: number | null;
  isOption: boolean;
}

export interface PriceData {
  /** Underlying close on (or nearest before) the trade date. */
  entryPrice: number | null;
  /** Latest underlying price. */
  currentPrice: number | null;
}

export interface TradeSimulation {
  ticker: string;
  category: string;
  tradeDate: string;
  entryPrice: number | null;
  currentPrice: number | null;
  /** Underlying % move entry→current (the proxy used for options/sells). */
  underlyingPct: number | null;
  // Position economics — only populated for STOCK BUYS:
  shares: number | null;
  sharesKnown: boolean;
  costBasis: number | null;
  currentValue: number | null;
  gainAbs: number | null;
  gainPct: number | null;
  isOption: boolean;
  /** true when the figure is a proxy or rests on an estimated share count. */
  approximate: boolean;
  note: string | null;
}

/** Disclosed amount ranges → a single representative dollar figure (midpoint, or
 *  the lower bound for an open-ended "Over $X"). */
export function amountMidpoint(min: number | null, max: number | null): number | null {
  if (min == null) return null;
  return max != null ? (min + max) / 2 : min;
}

/** Pull a share count out of a filer description ("Purchased 25,000 shares."). */
export function sharesFromDescription(desc: string | null | undefined): number | null {
  if (!desc) return null;
  const m = desc.match(/\b([\d,]{2,})\s+shares?\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pctMove(entry: number | null, current: number | null): number | null {
  return entry != null && current != null && entry > 0 ? current / entry - 1 : null;
}

/** Pure: turn a trade + its underlying prices into a copy-trade simulation. */
export function simulateTrade(input: SimInput, prices: PriceData): TradeSimulation {
  const { entryPrice, currentPrice } = prices;
  const underlyingPct = pctMove(entryPrice, currentPrice);
  const base = {
    ticker: input.ticker,
    category: input.category,
    tradeDate: input.tradeDate,
    entryPrice,
    currentPrice,
    underlyingPct,
    isOption: input.isOption,
    shares: null as number | null,
    sharesKnown: false,
    costBasis: null as number | null,
    currentValue: null as number | null,
    gainAbs: null as number | null,
    gainPct: null as number | null,
  };

  // Options → underlying-move proxy only (we can't price the contract).
  if (input.isOption) {
    return {
      ...base,
      approximate: true,
      note: 'Underlying move — option contract P&L not modeled',
    };
  }
  // Sells → not a holdable position to copy; report the move since they exited.
  if (input.category !== 'buy') {
    return {
      ...base,
      gainPct: underlyingPct,
      approximate: false,
      note: 'Underlying move since sale',
    };
  }

  // Stock buy → real position economics.
  const mid = amountMidpoint(input.amountMin, input.amountMax);
  const sharesKnown = input.knownShares != null && input.knownShares > 0;
  const shares = sharesKnown
    ? input.knownShares
    : mid != null && entryPrice != null && entryPrice > 0
      ? mid / entryPrice
      : null;
  const costBasis = sharesKnown && entryPrice != null ? input.knownShares! * entryPrice : mid; // disclosed midpoint
  const currentValue = shares != null && currentPrice != null ? shares * currentPrice : null;
  const gainAbs = currentValue != null && costBasis != null ? currentValue - costBasis : null;

  return {
    ...base,
    shares,
    sharesKnown,
    costBasis,
    currentValue,
    gainAbs,
    gainPct: underlyingPct,
    approximate: !sharesKnown,
    note: sharesKnown ? null : 'Shares estimated from the disclosed amount range',
  };
}

/** Bridge a stored trade to a SimInput (pure). Knows where the share count hides:
 *  an option exercise's shares, or a "Purchased N shares" description. */
export function simInputFromTrade(t: {
  ticker: string | null;
  category: string;
  tradeDate: string;
  amountMin: number | null;
  amountMax: number | null;
  description?: string | null;
  option?: { shares: number | null } | null;
}): SimInput {
  return {
    ticker: t.ticker ?? '',
    category: t.category,
    tradeDate: t.tradeDate,
    amountMin: t.amountMin,
    amountMax: t.amountMax,
    knownShares: t.option?.shares ?? sharesFromDescription(t.description),
    isOption: !!t.option,
  };
}

export interface PoliticianPerformance {
  politician: string;
  /** Stock buys with a computable position (the leaderboard basis). */
  buyCount: number;
  /** Option buys — reported via the underlying proxy, not in the $ totals. */
  optionBuyCount: number;
  totalCostBasis: number;
  totalCurrentValue: number;
  totalGainAbs: number;
  /** Blended copy-trade return: total gain / total cost basis. */
  returnPct: number | null;
  /** Fraction of priced stock buys that are up. */
  winRate: number | null;
  /** Fraction of stock buys whose share count was ESTIMATED (quality signal). */
  estimatedShareFraction: number;
  /** Average underlying % move across the politician's option buys. */
  optionUnderlyingAvgPct: number | null;
}

/** Pure: roll a politician's trade simulations into one performance row. The
 *  leaderboard ranks on `returnPct` — "if you'd copied every stock buy at the
 *  disclosed size, what's your blended return now". Options sit alongside as the
 *  underlying-move proxy; sells are excluded (no position to copy). */
export function aggregatePerformance(
  politician: string,
  sims: TradeSimulation[]
): PoliticianPerformance {
  const stockBuys = sims.filter(
    (s) => !s.isOption && s.category === 'buy' && s.costBasis != null && s.currentValue != null
  );
  const optionBuys = sims.filter((s) => s.isOption && s.category === 'buy');

  let totalCostBasis = 0;
  let totalCurrentValue = 0;
  let wins = 0;
  let priced = 0;
  let estimated = 0;
  for (const s of stockBuys) {
    totalCostBasis += s.costBasis!;
    totalCurrentValue += s.currentValue!;
    if (!s.sharesKnown) estimated += 1;
    if (s.gainPct != null) {
      priced += 1;
      if (s.gainPct > 0) wins += 1;
    }
  }
  const totalGainAbs = totalCurrentValue - totalCostBasis;
  const optPcts = optionBuys.map((s) => s.underlyingPct).filter((p): p is number => p != null);

  return {
    politician,
    buyCount: stockBuys.length,
    optionBuyCount: optionBuys.length,
    totalCostBasis,
    totalCurrentValue,
    totalGainAbs,
    returnPct: totalCostBasis > 0 ? totalGainAbs / totalCostBasis : null,
    winRate: priced > 0 ? wins / priced : null,
    estimatedShareFraction: stockBuys.length > 0 ? estimated / stockBuys.length : 0,
    optionUnderlyingAvgPct: optPcts.length
      ? optPcts.reduce((a, b) => a + b, 0) / optPcts.length
      : null,
  };
}
