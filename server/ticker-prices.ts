// Ticker price fetching with on-disk TTL cache.
//
// Wraps yahoo-finance2's chart() API to return current price + 1-year
// change + 52-week range in a single call per ticker. Caches results in
// .docvault-ticker-cache.json so the Tickers aggregate view and the
// per-entry price strips don't hammer Yahoo on every page load.
//
// Cache TTL is 15 minutes for successes (long enough to absorb a normal
// browsing session, short enough that intraday moves show up on next
// refresh) and 1 minute for failures (so a typo or delisted symbol
// doesn't repeatedly hit Yahoo — but if you fix it, you don't wait long).

import { promises as fs } from 'fs';
import path from 'path';
import YahooFinance from 'yahoo-finance2';

// v3.14+ requires explicit instantiation; the historical default singleton
// has been deprecated. One module-level instance is enough.
const yahooFinance = new YahooFinance();
import { DATA_DIR, ensureDir } from './data.js';
import { createLogger } from './logger.js';

const log = createLogger('TickerPrices');

const CACHE_FILE = path.join(DATA_DIR, '.docvault-ticker-cache.json');
const SUCCESS_TTL_MS = 15 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;

export interface TickerQuote {
  symbol: string;
  price: number | null;
  currency: string | null;
  /** 1-year price change as a percentage (current vs ~1y-ago close). */
  oneYearChangePct: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /**
   * ~52 weekly close samples covering the past year, ending at the most
   * recent close. Used for inline sparklines next to the price. Null
   * when the ticker has no usable history (delisted, new listing, error).
   */
  sparklineCloses: number[] | null;
  /** Yahoo's longName, falling back to shortName, then null. */
  name: string | null;
  /** ISO timestamp of when this quote was fetched (success or failure). */
  fetchedAt: string;
  /** Null on success; user-facing string on failure. */
  error: string | null;
}

interface CacheStore {
  version: 1;
  quotes: Record<string, TickerQuote>;
}

// ---------------------------------------------------------------------------
// On-disk cache — atomic tmp→rename writes (same pattern as research store).
// ---------------------------------------------------------------------------

async function loadCache(): Promise<CacheStore> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CacheStore>;
    return { version: 1, quotes: parsed.quotes ?? {} };
  } catch {
    return { version: 1, quotes: {} };
  }
}

async function saveCache(store: CacheStore): Promise<void> {
  await ensureDir(DATA_DIR);
  const tmp = `${CACHE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, CACHE_FILE);
}

function isStale(quote: TickerQuote): boolean {
  const ttl = quote.error ? FAILURE_TTL_MS : SUCCESS_TTL_MS;
  return Date.now() - new Date(quote.fetchedAt).getTime() > ttl;
}

// ---------------------------------------------------------------------------
// Yahoo fetch — one chart() call per symbol gives every field we display.
// ---------------------------------------------------------------------------

const SPARKLINE_TARGET_POINTS = 52;

/** Downsample a daily close array to ~52 weekly points, always preserving
 *  the most recent value so the sparkline ends at "now". */
function downsampleForSparkline(closes: number[]): number[] | null {
  if (closes.length === 0) return null;
  const step = Math.max(1, Math.floor(closes.length / SPARKLINE_TARGET_POINTS));
  const sampled = closes.filter((_, i) => i % step === 0);
  const last = closes[closes.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

async function fetchOne(symbol: string): Promise<TickerQuote> {
  const now = new Date().toISOString();
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const chart = await yahooFinance.chart(symbol, {
      period1: oneYearAgo,
      interval: '1d',
    });
    const meta = chart.meta;
    const closes = (chart.quotes ?? [])
      .map((q) => q.close)
      .filter((c): c is number => typeof c === 'number');
    const firstClose = closes[0];
    const price =
      typeof meta.regularMarketPrice === 'number'
        ? meta.regularMarketPrice
        : (closes[closes.length - 1] ?? null);
    const oneYearChangePct =
      typeof firstClose === 'number' && typeof price === 'number' && firstClose > 0
        ? ((price - firstClose) / firstClose) * 100
        : null;
    return {
      symbol,
      price,
      currency: meta.currency ?? null,
      oneYearChangePct,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      sparklineCloses: downsampleForSparkline(closes),
      name: meta.longName ?? meta.shortName ?? null,
      fetchedAt: now,
      error: null,
    };
  } catch (err) {
    return {
      symbol,
      price: null,
      currency: null,
      oneYearChangePct: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      sparklineCloses: null,
      name: null,
      fetchedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch quotes for a batch of tickers with cache-first semantics. Cached
 * results within their TTL are returned as-is; misses are fetched in
 * parallel and written back to the cache. Response order matches input.
 */
export async function fetchTickerPrices(symbols: string[]): Promise<{
  quotes: TickerQuote[];
  cached: number;
  fetched: number;
}> {
  if (symbols.length === 0) return { quotes: [], cached: 0, fetched: 0 };

  const store = await loadCache();
  const result: Record<string, TickerQuote> = {};
  const misses: string[] = [];

  for (const sym of symbols) {
    const cached = store.quotes[sym];
    if (cached && !isStale(cached)) {
      result[sym] = cached;
    } else {
      misses.push(sym);
    }
  }

  if (misses.length > 0) {
    const fetched = await Promise.all(misses.map(fetchOne));
    for (const q of fetched) {
      store.quotes[q.symbol] = q;
      result[q.symbol] = q;
    }
    await saveCache(store);
    const okCount = fetched.filter((f) => !f.error).length;
    log.info(
      `Fetched ${fetched.length} ticker quotes (${okCount} ok, ${fetched.length - okCount} errored)`
    );
  }

  const quotes = symbols.map((sym) => result[sym]);
  return { quotes, cached: symbols.length - misses.length, fetched: misses.length };
}
