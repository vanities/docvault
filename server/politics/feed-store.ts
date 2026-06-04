// Politics feed store — the single rolling-window cache (.docvault-politics.json)
// plus the forward-only merge helpers and the consumer-shaped payload builder.
//
// Two merge strategies:
//   - upsertByKey  : bills/executive actions get UPDATED in place (a bill goes
//                    introduced → signed), keyed by id, newest kept, capped.
//   - appendNew    : trades/filings are immutable once parsed — only genuinely
//                    new keys are prepended; the rest are dropped.

import { promises as fs } from 'fs';
import { DATA_DIR, POLITICS_CACHE_FILE } from '../data.js';
import type {
  BillRecord,
  ExecutiveActionRecord,
  FilingRecord,
  PoliticsCache,
  TradeRecord,
} from './types.js';

// Rolling-window caps — generous enough for a forward-only feed, small enough
// that the file stays light and the UI stays fast.
const CAP_BILLS = 250;
const CAP_EXEC = 200;
// Trades are capped PER SOURCE so one high-volume filer can't dominate. House and
// Senate hold a full year of filings (so the browse/top-spenders view is real);
// OGE-278-T (Trump) stays bounded because his ~1,100-row bond filings would
// otherwise balloon the cache.
const TRADE_CAP_BY_SOURCE: Record<string, number> = {
  'house-ptr': 6000,
  'senate-ptr': 6000,
  'oge-278t': 600,
};
const DEFAULT_TRADE_CAP = 2000;
function tradeCapForSource(source: string): number {
  return TRADE_CAP_BY_SOURCE[source] ?? DEFAULT_TRADE_CAP;
}
const CAP_FILINGS = 500;
const CAP_SEEN = 12000; // per-ledger LRU ceiling (holds a year of filing ids)

export function emptyPoliticsCache(): PoliticsCache {
  return {
    generatedAt: null,
    bills: [],
    executiveActions: [],
    trades: [],
    filings: [],
    cursors: {},
    seen: { houseDocIds: [], ogeDocIds: [], senateFilingIds: [] },
  };
}

function cachePath(dataDir: string): string {
  return dataDir === DATA_DIR ? POLITICS_CACHE_FILE : `${dataDir}/.docvault-politics.json`;
}

export async function loadPoliticsCache(dataDir: string = DATA_DIR): Promise<PoliticsCache> {
  try {
    const raw = await fs.readFile(cachePath(dataDir), 'utf8');
    return { ...emptyPoliticsCache(), ...(JSON.parse(raw) as Partial<PoliticsCache>) };
  } catch {
    return emptyPoliticsCache();
  }
}

export async function savePoliticsCache(
  cache: PoliticsCache,
  dataDir: string = DATA_DIR
): Promise<void> {
  const finalPath = cachePath(dataDir);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(cache, null, 2)}\n`);
  await fs.rename(tmpPath, finalPath); // atomic swap — never truncate the live file
}

/** Replace-by-key merge: incoming wins, sorted newest-first by `dateOf`, capped. */
export function upsertByKey<T>(
  existing: T[],
  incoming: T[],
  keyOf: (item: T) => string,
  dateOf: (item: T) => string,
  cap: number
): T[] {
  const byKey = new Map<string, T>();
  for (const item of existing) byKey.set(keyOf(item), item);
  for (const item of incoming) byKey.set(keyOf(item), item);
  return [...byKey.values()].sort((a, b) => dateOf(b).localeCompare(dateOf(a))).slice(0, cap);
}

/** Append-only merge: prepend genuinely-new keys, drop the rest, capped. */
export function appendNew<T>(
  existing: T[],
  incoming: T[],
  keyOf: (item: T) => string,
  cap: number
): T[] {
  const have = new Set(existing.map(keyOf));
  const fresh = incoming.filter((item) => !have.has(keyOf(item)));
  return [...fresh, ...existing].slice(0, cap);
}

export function mergeBills(cache: PoliticsCache, incoming: BillRecord[]): void {
  cache.bills = upsertByKey(
    cache.bills,
    incoming,
    (b) => b.externalId,
    (b) => b.updateDate,
    CAP_BILLS
  );
}

export function mergeExecutiveActions(
  cache: PoliticsCache,
  incoming: ExecutiveActionRecord[]
): void {
  cache.executiveActions = upsertByKey(
    cache.executiveActions,
    incoming,
    (a) => a.slug,
    (a) => a.issuedDate,
    CAP_EXEC
  );
}

export function mergeTrades(cache: PoliticsCache, incoming: TradeRecord[]): void {
  // Upsert everything newest-first, then keep at most CAP_TRADES_PER_SOURCE of
  // each source so no single filer dominates, then re-sort the combined set.
  const merged = upsertByKey(
    cache.trades,
    incoming,
    (t) => t.externalId,
    (t) => t.tradeDate,
    Number.MAX_SAFE_INTEGER
  );
  const perSource = new Map<string, number>();
  const kept: TradeRecord[] = [];
  for (const trade of merged) {
    const count = perSource.get(trade.source) ?? 0;
    if (count >= tradeCapForSource(trade.source)) continue;
    perSource.set(trade.source, count + 1);
    kept.push(trade);
  }
  cache.trades = kept;
}

export function mergeFilings(cache: PoliticsCache, incoming: FilingRecord[]): void {
  cache.filings = appendNew(cache.filings, incoming, (f) => f.externalId, CAP_FILINGS);
}

/** Record processed source-document ids so we never re-fetch/re-parse them. */
export function markSeen(seen: string[], ids: string[]): string[] {
  return [...new Set([...ids, ...seen])].slice(0, CAP_SEEN);
}

/** Map a bill to the "vote"-shaped object the existing Politics consumers read
 *  (`vote.bill.title`, `vote.billTitle`, `vote.question`, `vote.externalId`). */
function billToVote(bill: BillRecord): Record<string, unknown> {
  return {
    externalId: bill.externalId,
    title: bill.title,
    billTitle: bill.title,
    question: bill.latestAction ?? bill.title,
    status: bill.status,
    latestAction: bill.latestAction,
    latestActionDate: bill.latestActionDate,
    updateDate: bill.updateDate,
    url: bill.url,
    bill: { title: bill.title, officialId: bill.officialId },
  };
}

export interface FeedSyncJob {
  name: string;
  status: string;
  error?: string | null;
  ranAt?: string | null;
}

/** The `/api/politics/feed` response. The index signature lets it stand in for
 *  the structural payload the research↔politics linker consumes. */
export interface PoliticsFeedPayload {
  configured: true;
  ok: boolean;
  baseUrl: string;
  service: string;
  checkedAt: string;
  [key: string]: unknown;
}

/** Reshape the cache into the `/api/politics/feed` response. Field names mirror
 *  the old Check the Vote success payload so the existing consumers keep working. */
export function buildFeedPayload(
  cache: PoliticsCache,
  sync: { jobs: FeedSyncJob[] } = { jobs: [] }
): PoliticsFeedPayload {
  return {
    configured: true,
    ok: cache.generatedAt != null,
    baseUrl: 'local',
    service: 'docvault-politics',
    checkedAt: cache.generatedAt ?? new Date().toISOString(),
    health: { service: 'docvault-politics' },
    sync,
    votes: { votes: cache.bills.map(billToVote) },
    trades: { trades: cache.trades },
    filings: { filings: cache.filings },
    // New first-class arrays for the rewired UI:
    bills: cache.bills,
    executiveActions: cache.executiveActions,
  };
}

/** Load the cache and reshape it into the feed payload — used by the
 *  research↔politics linker route (replaces the old Check the Vote fetch). */
export async function loadPoliticsFeedPayload(
  dataDir: string = DATA_DIR
): Promise<PoliticsFeedPayload> {
  return buildFeedPayload(await loadPoliticsCache(dataDir));
}

// --- Browse / aggregate ------------------------------------------------------

/** One month of buy/sell counts — feeds the leaderboard sparklines. */
export interface MonthBucket {
  m: string; // YYYY-MM
  b: number; // buy count
  s: number; // sell count
}

export interface SpenderSummary {
  politician: string;
  chamber: string;
  trades: number;
  buys: number;
  sells: number;
  estMin: number; // Σ amountMin (lower bound of disclosed bands)
  estMax: number; // Σ amountMax (upper bound)
  tickers: string[];
  lastTradeDate: string | null;
  monthly: MonthBucket[]; // last 12 months of buy/sell counts (shared axis)
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** The `count` calendar months ending at `anchor` (YYYY-MM), oldest first. */
export function recentMonths(anchor: string, count: number): string[] {
  const [y, m] = anchor.split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Bucket a politician's trades into the given months (buy/sell counts). */
export function monthlyBuySell(trades: TradeRecord[], months: string[]): MonthBucket[] {
  const idx = new Map(months.map((m, i) => [m, i]));
  const buckets: MonthBucket[] = months.map((m) => ({ m, b: 0, s: 0 }));
  for (const t of trades) {
    const i = idx.get(monthKey(t.tradeDate));
    if (i == null) continue;
    if (t.category === 'buy') buckets[i].b += 1;
    else if (t.category === 'sell') buckets[i].s += 1;
  }
  return buckets;
}

/** Aggregate cached trades by politician, ranked by upper-bound dollar volume. */
export function topSpenders(cache: PoliticsCache, limit = 25): SpenderSummary[] {
  const byName = new Map<string, TradeRecord[]>();
  let latestMonth = '';
  for (const trade of cache.trades) {
    const list = byName.get(trade.politicianName);
    if (list) list.push(trade);
    else byName.set(trade.politicianName, [trade]);
    const mk = monthKey(trade.tradeDate);
    if (mk > latestMonth) latestMonth = mk;
  }
  // All sparklines share one axis (the 12 months ending at the cache's latest trade).
  const months = latestMonth ? recentMonths(latestMonth, 12) : [];

  const out: SpenderSummary[] = [];
  for (const [politician, list] of byName) {
    out.push({
      politician,
      chamber: list[0].chamber,
      trades: list.length,
      buys: list.filter((t) => t.category === 'buy').length,
      sells: list.filter((t) => t.category === 'sell').length,
      estMin: list.reduce((sum, t) => sum + (t.amountMin ?? 0), 0),
      estMax: list.reduce((sum, t) => sum + (t.amountMax ?? 0), 0),
      tickers: [...new Set(list.map((t) => t.ticker).filter((x): x is string => Boolean(x)))].slice(
        0,
        12
      ),
      lastTradeDate: list.reduce<string | null>(
        (max, t) => (max == null || t.tradeDate > max ? t.tradeDate : max),
        null
      ),
      monthly: monthlyBuySell(list, months),
    });
  }
  return out.sort((a, b) => b.estMax - a.estMax).slice(0, limit);
}

export interface TradeFilter {
  politician?: string;
  chamber?: string;
  category?: string;
  ticker?: string;
  limit?: number;
}

/** Filter cached trades (case-insensitive politician/ticker substring), newest first. */
export function filterTrades(cache: PoliticsCache, filter: TradeFilter): TradeRecord[] {
  const pol = filter.politician?.trim().toLowerCase();
  const tkr = filter.ticker?.trim().toUpperCase();
  return cache.trades
    .filter((t) => {
      if (pol && !t.politicianName.toLowerCase().includes(pol)) return false;
      if (filter.chamber && t.chamber !== filter.chamber) return false;
      if (filter.category && t.category !== filter.category) return false;
      if (tkr && (t.ticker?.toUpperCase() ?? '') !== tkr) return false;
      return true;
    })
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
    .slice(0, filter.limit ?? 200);
}
