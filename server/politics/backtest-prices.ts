// Underlying price history for the backtest — one year of daily closes + the
// current price per ticker, from yahoo-finance2's chart() API, cached to disk.
// Lets the runner resolve "price on the trade date" and "price now" for every
// disclosed ticker without re-hitting Yahoo on each request.

import YahooFinance from 'yahoo-finance2';
import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../data.js';
import { createLogger } from '../logger.js';

const yf = new YahooFinance();
const log = createLogger('PoliticsBacktestPrices');

const CACHE_FILE = path.join(DATA_DIR, '.docvault-backtest-prices.json');
const TTL_MS = 12 * 60 * 60 * 1000; // 12h — daily recompute, so a half-day is plenty fresh
const CONCURRENCY = 6; // be gentle on Yahoo

export interface DailyClose {
  date: string; // YYYY-MM-DD
  close: number;
}
export interface TickerHistory {
  symbol: string;
  closes: DailyClose[]; // ascending by date
  current: number | null;
  fetchedAt: string;
  error: string | null;
}

interface CacheStore {
  version: 1;
  histories: Record<string, TickerHistory>;
}

/** Pure: the close on, or the most recent before, `date`. Falls back to the
 *  earliest available close when the trade predates our history window. */
export function closeOnOrBefore(closes: DailyClose[], date: string): number | null {
  let best: number | null = null;
  for (const c of closes) {
    if (c.date <= date) best = c.close;
    else break; // ascending — we've passed the date
  }
  return best ?? closes[0]?.close ?? null;
}

async function loadCache(): Promise<CacheStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')) as CacheStore;
    if (parsed.version === 1 && parsed.histories) return parsed;
  } catch {
    /* miss */
  }
  return { version: 1, histories: {} };
}

async function saveCache(store: CacheStore): Promise<void> {
  const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store));
  await fs.rename(tmp, CACHE_FILE);
}

async function fetchHistory(symbol: string): Promise<TickerHistory> {
  const now = new Date().toISOString();
  try {
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    const chart = await yf.chart(symbol, { period1: start, interval: '1d' });
    const closes: DailyClose[] = (chart.quotes ?? [])
      .map((q) => ({
        date:
          q.date instanceof Date ? q.date.toISOString().slice(0, 10) : String(q.date).slice(0, 10),
        close: q.close,
      }))
      .filter((c): c is DailyClose => typeof c.close === 'number');
    const current =
      typeof chart.meta?.regularMarketPrice === 'number'
        ? chart.meta.regularMarketPrice
        : (closes[closes.length - 1]?.close ?? null);
    return { symbol, closes, current, fetchedAt: now, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.debug(`history fetch failed for ${symbol}: ${msg}`);
    return { symbol, closes: [], current: null, fetchedAt: now, error: msg };
  }
}

/** Fetch (or serve cached) one-year daily history for each ticker. Concurrency-
 *  limited + 12h cache so a backtest run touches Yahoo at most once per ticker
 *  per half-day. */
export async function getHistories(symbols: string[]): Promise<Map<string, TickerHistory>> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const cache = await loadCache();
  const out = new Map<string, TickerHistory>();
  const stale: string[] = [];
  const cutoff = Date.now() - TTL_MS;

  for (const sym of wanted) {
    const hit = cache.histories[sym];
    if (hit && !hit.error && Date.parse(hit.fetchedAt) > cutoff) out.set(sym, hit);
    else stale.push(sym);
  }

  log.info(`backtest prices: ${out.size} cached, fetching ${stale.length}`);

  for (let i = 0; i < stale.length; i += CONCURRENCY) {
    const batch = stale.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((s) => fetchHistory(s)));
    for (const h of results) {
      out.set(h.symbol, h);
      cache.histories[h.symbol] = h;
    }
  }

  if (stale.length > 0)
    await saveCache(cache).catch((e) => log.warn(`price cache save failed: ${e}`));
  const ok = [...out.values()].filter((h) => !h.error && h.current != null).length;
  log.info(`backtest prices: ${ok}/${wanted.length} tickers priced`);
  return out;
}
