// Backtest runner — the impure orchestration: pull every disclosed ticker's
// price history, simulate each trade ("if you'd copied it"), roll up per
// politician into a leaderboard, and cache the result. Recomputed daily with the
// politics refresh; the endpoint just serves the cache.

import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../data.js';
import { createLogger } from '../logger.js';
import { loadPoliticsCache } from './feed-store.js';
import { closeOnOrBefore, getHistories } from './backtest-prices.js';
import {
  aggregatePerformance,
  simInputFromTrade,
  simulateTrade,
  type PoliticianPerformance,
  type TradeSimulation,
} from './backtest.js';
import type { TradeRecord } from './types.js';

const log = createLogger('PoliticsBacktest');
const CACHE_FILE = path.join(DATA_DIR, '.docvault-politics-backtest.json');

export interface BacktestResult {
  generatedAt: string;
  totalTickers: number;
  pricedTickers: number;
  /** Per-politician performance, ranked by blended copy-trade return (desc). */
  leaderboard: PoliticianPerformance[];
  /** Per-politician trade simulations, for the drill-down detail. */
  trades: Record<string, TradeSimulation[]>;
}

/** Run the backtest over the current (or supplied) trade set, cache + return it. */
export async function runBacktest(trades?: TradeRecord[]): Promise<BacktestResult> {
  const started = Date.now();
  const all = trades ?? (await loadPoliticsCache()).trades;
  const withTicker = all.filter((t) => t.ticker);
  const tickers = withTicker.map((t) => t.ticker!);
  log.info(
    `backtest: ${withTicker.length} trades, ${new Set(tickers.map((t) => t.toUpperCase())).size} unique tickers`
  );

  const histories = await getHistories(tickers);

  const byPolitician = new Map<string, TradeSimulation[]>();
  for (const t of withTicker) {
    const h = histories.get(t.ticker!.toUpperCase());
    const entryPrice = h ? closeOnOrBefore(h.closes, t.tradeDate) : null;
    const sim = simulateTrade(simInputFromTrade(t), {
      entryPrice,
      currentPrice: h?.current ?? null,
    });
    const arr = byPolitician.get(t.politicianName);
    if (arr) arr.push(sim);
    else byPolitician.set(t.politicianName, [sim]);
  }

  const leaderboard = [...byPolitician.entries()]
    .map(([name, sims]) => aggregatePerformance(name, sims))
    .filter((p) => p.buyCount > 0 || p.optionBuyCount > 0)
    .sort(
      (a, b) =>
        (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity) || b.totalGainAbs - a.totalGainAbs
    );

  const result: BacktestResult = {
    generatedAt: new Date().toISOString(),
    totalTickers: new Set(tickers.map((t) => t.toUpperCase())).size,
    pricedTickers: [...histories.values()].filter((h) => h.current != null).length,
    leaderboard,
    trades: Object.fromEntries(byPolitician),
  };

  try {
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(result));
    await fs.rename(tmp, CACHE_FILE);
  } catch (err) {
    log.warn(`backtest cache save failed: ${err instanceof Error ? err.message : err}`);
  }

  log.info(
    `backtest: ${leaderboard.length} politicians ranked, ${result.pricedTickers}/${result.totalTickers} tickers priced (${((Date.now() - started) / 1000).toFixed(1)}s)`
  );
  return result;
}

export async function loadBacktest(): Promise<BacktestResult | null> {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')) as BacktestResult;
  } catch {
    return null;
  }
}
