// =============================================================================
// Brokerage Portfolio Tracking
// =============================================================================
// Two modes:
// 1. SnapTrade integration — connect real brokerage accounts (Vanguard, Fidelity,
//    Robinhood, Chase, Navy Federal, etc.) via SnapTrade API. Free tier: 5 connections.
// 2. Manual holdings — enter ticker + shares, prices fetched via Yahoo Finance.

import { Snaptrade } from 'snaptrade-typescript-sdk';
import { enrichCusipLabels, isCusip } from './openfigi.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type BrokerId =
  | 'vanguard'
  | 'fidelity'
  | 'robinhood'
  | 'navy-federal'
  | 'chase'
  | 'altoira'
  | 'other';

export interface BrokerHolding {
  ticker: string;
  shares: number;
  costBasis?: number;
  purchaseDate?: string; // ISO date for short/long-term gain classification
  label?: string;
  // Brokerage-reported price per unit. Set when the source (e.g. SnapTrade)
  // already knows the price — bypasses Yahoo lookup, which has no quote for
  // CUSIPs like brokered CDs / Treasuries.
  price?: number;
}

export interface BrokerAccount {
  id: string;
  broker: BrokerId;
  name: string;
  url?: string;
  holdings: BrokerHolding[];
  overrideValue?: number; // flat dollar value override (skips price lookups)
  snaptradeAccountId?: string; // If linked via SnapTrade
}

export interface BrokerAccountWithValues extends BrokerAccount {
  holdings: (BrokerHolding & {
    price?: number;
    marketValue?: number;
    gainLoss?: number;
    gainLossPercent?: number;
    gainType?: 'short-term' | 'long-term' | 'unknown';
  })[];
  totalValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  shortTermGains: number;
  longTermGains: number;
}

export interface BrokerPortfolio {
  accounts: BrokerAccountWithValues[];
  totalValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  shortTermGains: number;
  longTermGains: number;
  lastUpdated: string;
}

// SnapTrade settings stored in settings.json
export interface SnapTradeConfig {
  clientId: string;
  consumerKey: string;
  userId?: string; // SnapTrade user ID (we use a fixed one)
  userSecret?: string; // SnapTrade user secret
}

// -----------------------------------------------------------------------------
// SnapTrade Client
// -----------------------------------------------------------------------------

let snaptradeClient: Snaptrade | null = null;

export function initSnapTrade(config: SnapTradeConfig): Snaptrade {
  snaptradeClient = new Snaptrade({
    clientId: config.clientId,
    consumerKey: config.consumerKey,
  });
  return snaptradeClient;
}

export function getSnapTradeClient(): Snaptrade | null {
  return snaptradeClient;
}

// Extract meaningful error detail from SnapTrade SDK errors (axios-wrapped)
export function extractSnapTradeError(err: unknown): string {
  const e = err as {
    message?: string;
    status?: number;
    response?: { data?: unknown; status?: number };
    body?: unknown;
    responseBody?: unknown;
  };
  // Try response.data first (axios pattern), then body, then responseBody
  const detail = e.response?.data ?? e.body ?? e.responseBody;
  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    // SnapTrade returns { detail: "...", code: "..." } or { message: "..." }
    const msg = d.detail ?? d.message ?? d.code ?? d.error;
    if (msg) return String(msg);
    // Fallback: stringify the whole body
    try {
      return JSON.stringify(detail);
    } catch {
      /* fall through */
    }
  }
  if (detail && typeof detail === 'string') return detail;
  const status = e.response?.status ?? e.status;
  return e.message || `SnapTrade error${status ? ` (${status})` : ''}`;
}

// Register a SnapTrade user (one-time setup)
export async function registerSnapTradeUser(
  config: SnapTradeConfig
): Promise<{ userId: string; userSecret: string }> {
  const client = initSnapTrade(config);
  const userId = config.userId || 'docvault-user';

  try {
    const response = await client.authentication.registerSnapTradeUser({
      userId,
    });
    return {
      userId,
      userSecret: response.data.userSecret || '',
    };
  } catch (err: unknown) {
    // User may already exist — try to re-register or use existing
    const error = err as {
      status?: number;
      response?: { status?: number; data?: { code?: string } };
      body?: { code?: string };
    };
    const status = error.response?.status ?? error.status;
    const code = error.response?.data?.code ?? error.body?.code;
    if (status === 409 || code === 'USER_ALREADY_EXISTS') {
      // User exists, we need the userSecret from settings
      if (config.userSecret) {
        return { userId, userSecret: config.userSecret };
      }
      throw new Error(
        'SnapTrade user already exists but userSecret not found. Delete and re-register.'
      );
    }
    throw new Error(extractSnapTradeError(err));
  }
}

// Generate connection portal URL for linking a brokerage
export async function getSnapTradeConnectUrl(config: SnapTradeConfig): Promise<string> {
  const client = initSnapTrade(config);
  if (!config.userId || !config.userSecret) {
    throw new Error('SnapTrade user not registered. Set up credentials first.');
  }

  const response = await client.authentication.loginSnapTradeUser({
    userId: config.userId,
    userSecret: config.userSecret,
  });

  return response.data.redirectURI || '';
}

// Fetch all connected accounts from SnapTrade
export async function fetchSnapTradeAccounts(config: SnapTradeConfig): Promise<BrokerAccount[]> {
  const client = initSnapTrade(config);
  if (!config.userId || !config.userSecret) return [];

  const response = await client.accountInformation.listUserAccounts({
    userId: config.userId,
    userSecret: config.userSecret,
  });

  const accounts: BrokerAccount[] = [];

  for (const acct of response.data || []) {
    // Determine broker from institution name
    const instName = (acct.institutionName || '').toLowerCase();
    let broker: BrokerId = 'fidelity'; // default
    if (instName.includes('vanguard')) broker = 'vanguard';
    else if (instName.includes('fidelity')) broker = 'fidelity';
    else if (instName.includes('robinhood')) broker = 'robinhood';
    else if (instName.includes('chase') || instName.includes('jpmorgan')) broker = 'chase';
    else if (instName.includes('navy federal')) broker = 'navy-federal';

    accounts.push({
      id: `snap-${acct.id}`,
      broker,
      name: acct.name || acct.institutionName || 'Unknown',
      holdings: [],
      snaptradeAccountId: acct.id,
    });
  }

  return accounts;
}

// Fetch holdings for a specific SnapTrade account
export async function fetchSnapTradeHoldings(
  config: SnapTradeConfig,
  accountId: string
): Promise<BrokerHolding[]> {
  const client = initSnapTrade(config);
  if (!config.userId || !config.userSecret) return [];

  const response = await client.accountInformation.getUserHoldings({
    accountId,
    userId: config.userId,
    userSecret: config.userSecret,
  });

  const holdings: BrokerHolding[] = [];
  const data = response.data;

  // Process positions
  for (const pos of data?.positions || []) {
    const symbol = pos.symbol?.symbol?.symbol;
    if (!symbol) continue;
    const units = pos.units || 0;
    if (units <= 0) continue;

    holdings.push({
      ticker: symbol,
      shares: units,
      costBasis: pos.averagePurchasePrice ? pos.averagePurchasePrice * units : undefined,
      label: pos.symbol?.symbol?.description || pos.symbol?.description || undefined,
      price: typeof pos.price === 'number' && pos.price > 0 ? pos.price : undefined,
    });
  }

  // OpenFIGI enrichment: for any holding whose ticker is a CUSIP and whose
  // label is missing or just the CUSIP itself (common for brokered CDs /
  // Treasuries), swap in a human-readable name + description.
  const cusipsNeedingLabel = holdings
    .filter(
      (h) => isCusip(h.ticker) && (!h.label || h.label.toUpperCase() === h.ticker.toUpperCase())
    )
    .map((h) => h.ticker);
  if (cusipsNeedingLabel.length > 0) {
    const labels = await enrichCusipLabels(cusipsNeedingLabel);
    for (const h of holdings) {
      const resolved = labels[h.ticker.toUpperCase()];
      if (resolved) h.label = resolved;
    }
  }

  return holdings;
}

// Fetch all holdings from all SnapTrade-connected accounts
export async function fetchAllSnapTradeHoldings(
  config: SnapTradeConfig,
  onProgress?: (current: number, total: number, label: string) => void
): Promise<BrokerAccount[]> {
  const stAccounts = await fetchSnapTradeAccounts(config);
  const total = stAccounts.length;

  for (let i = 0; i < stAccounts.length; i++) {
    const acct = stAccounts[i];
    onProgress?.(i + 1, total, acct.name);
    if (acct.snaptradeAccountId) {
      acct.holdings = await fetchSnapTradeHoldings(config, acct.snaptradeAccountId);
    }
  }

  return stAccounts;
}

// -----------------------------------------------------------------------------
// Activity History (BUYs / SELLs / DIVIDENDs / TRANSFERs / etc)
// -----------------------------------------------------------------------------
// SnapTrade returns a `UniversalActivity` shape that varies by broker. Vanguard
// in particular returns `symbol: null` and packs the security name into
// `description` text — so we always preserve `description` and accept that
// `ticker` can be null.

export interface BrokerActivity {
  id: string;
  accountId: string; // SnapTrade account UUID (without the "snap-" prefix)
  type: string; // BUY | SELL | DIVIDEND | WITHDRAWAL | SWEEP IN/OUT | REI | TRANSFER | FEE | INTEREST | ...
  tradeDate: string; // ISO datetime
  settlementDate: string | null;
  ticker: string | null; // raw.symbol.symbol.symbol when present, else null (use description)
  description: string; // always populated; primary label when ticker is null
  units: number; // signed — negative on SELL, positive on BUY
  price: number;
  amount: number; // gross dollars (positive)
  fee: number;
  currency: string; // ISO 3-letter code
  institution: string;
  externalReferenceId: string | null;
}

export interface AccountActivities {
  activities: BrokerActivity[];
  lastSyncedDate: string; // YYYY-MM-DD — high-water mark for incremental sync
  earliestActivityDate: string | null;
}

export interface ActivitiesCache {
  accounts: Record<string, AccountActivities>;
  updatedAt: string;
}

// Pagination is by offset/limit; SnapTrade caps page size around 1000. We use
// 500 as a reasonable balance between request count and memory.
const ACTIVITY_PAGE_SIZE = 500;
// Overlap window on incremental sync — re-fetches the trailing N days each time
// so corrections / delayed-posting trades aren't missed. Dedupe is by `id`.
const INCREMENTAL_OVERLAP_DAYS = 7;

interface RawActivitySymbol {
  symbol?: { symbol?: string | null; description?: string | null } | null;
  description?: string | null;
}

interface RawActivity {
  id?: string;
  symbol?: RawActivitySymbol | null;
  type?: string | null;
  description?: string | null;
  amount?: number | null;
  price?: number | null;
  units?: number | null;
  fee?: number | null;
  trade_date?: string | null;
  settlement_date?: string | null;
  institution?: string | null;
  external_reference_id?: string | null;
  currency?: { code?: string | null } | null;
}

function normalizeActivity(raw: RawActivity, accountId: string): BrokerActivity | null {
  if (!raw.id || !raw.trade_date) return null;
  const ticker = raw.symbol?.symbol?.symbol ?? null;
  return {
    id: raw.id,
    accountId,
    type: raw.type || 'UNKNOWN',
    tradeDate: raw.trade_date,
    settlementDate: raw.settlement_date ?? null,
    ticker,
    description: raw.description || raw.symbol?.symbol?.description || ticker || '',
    units: typeof raw.units === 'number' ? raw.units : 0,
    price: typeof raw.price === 'number' ? raw.price : 0,
    amount: typeof raw.amount === 'number' ? raw.amount : 0,
    fee: typeof raw.fee === 'number' ? raw.fee : 0,
    currency: raw.currency?.code || 'USD',
    institution: raw.institution || '',
    externalReferenceId: raw.external_reference_id ?? null,
  };
}

// Walks the paginated activities endpoint for one account in one date window.
export async function fetchSnapTradeActivities(
  config: SnapTradeConfig,
  accountId: string,
  startDate?: string,
  endDate?: string
): Promise<BrokerActivity[]> {
  const client = initSnapTrade(config);
  if (!config.userId || !config.userSecret) return [];

  const out: BrokerActivity[] = [];
  let offset = 0;

  while (true) {
    const res = await client.accountInformation.getAccountActivities({
      accountId,
      userId: config.userId,
      userSecret: config.userSecret,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      offset,
      limit: ACTIVITY_PAGE_SIZE,
    });

    const body = res.data as { data?: RawActivity[]; pagination?: { total?: number } };
    const page = body.data ?? [];
    for (const raw of page) {
      const activity = normalizeActivity(raw, accountId);
      if (activity) out.push(activity);
    }

    const total = body.pagination?.total ?? page.length;
    offset += page.length;
    if (page.length === 0 || offset >= total) break;
  }

  return out;
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Drives sync across every SnapTrade-linked account. On first run for an
// account, fetches everything (no startDate). On subsequent runs, fetches
// from `lastSyncedDate - INCREMENTAL_OVERLAP_DAYS` to today and merges.
export async function syncAllSnapTradeActivities(
  config: SnapTradeConfig,
  existing: ActivitiesCache,
  onProgress?: (current: number, total: number, label: string) => void
): Promise<ActivitiesCache> {
  const stAccounts = await fetchSnapTradeAccounts(config);
  const total = stAccounts.length;
  const today = isoDateOnly(new Date());
  const next: ActivitiesCache = {
    accounts: { ...existing.accounts },
    updatedAt: new Date().toISOString(),
  };

  for (let i = 0; i < stAccounts.length; i++) {
    const acct = stAccounts[i];
    onProgress?.(i + 1, total, acct.name);
    if (!acct.snaptradeAccountId) continue;

    const accountId = acct.snaptradeAccountId;
    const prior = existing.accounts[accountId];
    let startDate: string | undefined;
    if (prior?.lastSyncedDate) {
      const overlap = new Date(prior.lastSyncedDate);
      overlap.setUTCDate(overlap.getUTCDate() - INCREMENTAL_OVERLAP_DAYS);
      startDate = isoDateOnly(overlap);
    }

    const fetched = await fetchSnapTradeActivities(config, accountId, startDate, today);

    const merged = new Map<string, BrokerActivity>();
    for (const a of prior?.activities ?? []) merged.set(a.id, a);
    for (const a of fetched) merged.set(a.id, a); // newer wins on duplicate id
    const activities = Array.from(merged.values()).sort((a, b) =>
      a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0
    );

    next.accounts[accountId] = {
      activities,
      lastSyncedDate: today,
      earliestActivityDate:
        activities.length > 0 ? activities[activities.length - 1].tradeDate.slice(0, 10) : null,
    };
  }

  return next;
}

// Delete SnapTrade user (cleanup)
export async function deleteSnapTradeUser(config: SnapTradeConfig): Promise<void> {
  const client = initSnapTrade(config);
  if (!config.userId) return;
  await client.authentication.deleteSnapTradeUser({ userId: config.userId });
}

// -----------------------------------------------------------------------------
// Price Cache (Yahoo Finance, 60s TTL)
// -----------------------------------------------------------------------------

let stockPriceCache: Record<string, number> = {};
let stockPriceCacheTime = 0;
const STOCK_PRICE_CACHE_TTL = 60_000;

const TICKER_NAMES: Record<string, string> = {
  VTI: 'Vanguard Total Stock Market ETF',
  VXUS: 'Vanguard Total International Stock ETF',
  VOO: 'Vanguard S&P 500 ETF',
  VGT: 'Vanguard Information Technology ETF',
  VNQ: 'Vanguard Real Estate ETF',
  BND: 'Vanguard Total Bond Market ETF',
  VTSAX: 'Vanguard Total Stock Market Index Fund',
  VFIAX: 'Vanguard 500 Index Fund',
  VTIAX: 'Vanguard Total International Stock Index Fund',
  VBTLX: 'Vanguard Total Bond Market Index Fund',
  FXAIX: 'Fidelity 500 Index Fund',
  FSKAX: 'Fidelity Total Market Index Fund',
  FTIHX: 'Fidelity Total International Index Fund',
  FXNAX: 'Fidelity US Bond Index Fund',
  SPAXX: 'Fidelity Government Money Market Fund',
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corporation',
  GOOGL: 'Alphabet Inc.',
  AMZN: 'Amazon.com Inc.',
  NVDA: 'NVIDIA Corporation',
  TSLA: 'Tesla Inc.',
  META: 'Meta Platforms Inc.',
  SPY: 'SPDR S&P 500 ETF',
  QQQ: 'Invesco QQQ Trust',
  IWM: 'iShares Russell 2000 ETF',
};

export function getTickerName(ticker: string): string {
  return TICKER_NAMES[ticker.toUpperCase()] || ticker.toUpperCase();
}

export async function fetchStockPrices(tickers: string[]): Promise<Record<string, number>> {
  const now = Date.now();
  const upperTickers = [...new Set(tickers.map((t) => t.toUpperCase()))];

  const allCached = upperTickers.every((t) => stockPriceCache[t] !== undefined);
  if (allCached && now - stockPriceCacheTime < STOCK_PRICE_CACHE_TTL) {
    return stockPriceCache;
  }

  try {
    const symbols = upperTickers.join(',');
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols}&range=1d&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });

    if (!res.ok) return await fetchPricesIndividually(upperTickers);

    const data = await res.json();
    const prices: Record<string, number> = { ...stockPriceCache };

    for (const ticker of upperTickers) {
      // New flat format: data[TICKER].close[last]
      const flat = data[ticker];
      if (flat?.close?.length) {
        prices[ticker] = flat.close[flat.close.length - 1];
        continue;
      }
      // Legacy nested format: data.spark.result[].response[].meta.regularMarketPrice
      const spark = data.spark?.result?.find((r: { symbol: string }) => r.symbol === ticker);
      const close = spark?.response?.[0]?.meta?.regularMarketPrice;
      if (close) prices[ticker] = close;
    }

    stockPriceCache = prices;
    stockPriceCacheTime = now;
    return prices;
  } catch {
    return await fetchPricesIndividually(upperTickers);
  }
}

async function fetchPricesIndividually(tickers: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = { ...stockPriceCache };

  for (const ticker of tickers) {
    if (prices[ticker]) continue;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${ticker}&range=1d&interval=1d`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const data = await res.json();
        // New flat format: data[TICKER].close[last]
        const flat = data[ticker];
        if (flat?.close?.length) {
          prices[ticker] = flat.close[flat.close.length - 1];
        } else {
          // Legacy nested format
          const close = data.spark?.result?.[0]?.response?.[0]?.meta?.regularMarketPrice;
          if (close) prices[ticker] = close;
        }
      }
    } catch {
      // Skip failed lookups
    }
  }

  stockPriceCache = prices;
  stockPriceCacheTime = Date.now();
  return prices;
}

// -----------------------------------------------------------------------------
// Gain Type Classification
// -----------------------------------------------------------------------------

const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function classifyGainType(purchaseDate?: string): 'short-term' | 'long-term' | 'unknown' {
  if (!purchaseDate) return 'unknown';
  const held = Date.now() - new Date(purchaseDate).getTime();
  return held >= ONE_YEAR_MS ? 'long-term' : 'short-term';
}

// -----------------------------------------------------------------------------
// Portfolio Builder (works for both manual and SnapTrade accounts)
// -----------------------------------------------------------------------------

export async function buildPortfolio(
  accounts: BrokerAccount[],
  onProgress?: (current: number, total: number, label: string) => void
): Promise<BrokerPortfolio> {
  const allTickers = new Set<string>();
  for (const account of accounts) {
    if (account.overrideValue !== undefined) continue; // skip price lookups for override accounts
    for (const holding of account.holdings) {
      const upper = holding.ticker.toUpperCase();
      // Skip Yahoo lookup if the brokerage already gave us a price (bonds,
      // CDs, money-market funds) — Yahoo has no quote for CUSIPs anyway.
      if (upper !== 'USD' && holding.price === undefined) allTickers.add(upper);
    }
  }

  const totalSteps = accounts.length + 1;
  onProgress?.(0, totalSteps, 'Fetching prices');

  const prices = allTickers.size > 0 ? await fetchStockPrices(Array.from(allTickers)) : {};
  onProgress?.(1, totalSteps, 'Prices loaded');

  let completed = 1;
  const enrichedAccounts: BrokerAccountWithValues[] = accounts.map((account) => {
    completed++;
    onProgress?.(completed, totalSteps, account.name);

    // Override accounts: use flat dollar value, no holdings enrichment
    if (account.overrideValue !== undefined) {
      return {
        ...account,
        holdings: [],
        totalValue: account.overrideValue,
        totalCostBasis: 0,
        totalGainLoss: 0,
        shortTermGains: 0,
        longTermGains: 0,
      };
    }

    const enrichedHoldings = account.holdings.map((h) => {
      const upperTicker = h.ticker.toUpperCase();
      // Brokerage-reported price wins (live CD/bond quote). Fall back to
      // Yahoo for manual holdings. USD is always 1.
      const price = upperTicker === 'USD' ? 1 : (h.price ?? prices[upperTicker] ?? 0);
      const marketValue = h.shares * price;
      const costBasis = h.costBasis || 0;
      const gainLoss = costBasis > 0 ? marketValue - costBasis : 0;
      const gainLossPercent = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
      const gainType = classifyGainType(h.purchaseDate);
      return {
        ...h,
        label: h.label || getTickerName(h.ticker),
        price,
        marketValue,
        gainLoss,
        gainLossPercent,
        gainType,
      };
    });

    const totalValue = enrichedHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
    const totalCostBasis = enrichedHoldings.reduce((sum, h) => sum + (h.costBasis || 0), 0);
    const shortTermGains = enrichedHoldings
      .filter((h) => h.gainType === 'short-term' && h.gainLoss > 0)
      .reduce((sum, h) => sum + h.gainLoss, 0);
    const longTermGains = enrichedHoldings
      .filter((h) => h.gainType === 'long-term' && h.gainLoss > 0)
      .reduce((sum, h) => sum + h.gainLoss, 0);

    return {
      ...account,
      holdings: enrichedHoldings,
      totalValue,
      totalCostBasis,
      totalGainLoss: totalCostBasis > 0 ? totalValue - totalCostBasis : 0,
      shortTermGains,
      longTermGains,
    };
  });

  const totalValue = enrichedAccounts.reduce((sum, a) => sum + a.totalValue, 0);
  const totalCostBasis = enrichedAccounts.reduce((sum, a) => sum + a.totalCostBasis, 0);
  const shortTermGains = enrichedAccounts.reduce((sum, a) => sum + a.shortTermGains, 0);
  const longTermGains = enrichedAccounts.reduce((sum, a) => sum + a.longTermGains, 0);

  return {
    accounts: enrichedAccounts,
    totalValue,
    totalCostBasis,
    totalGainLoss: totalCostBasis > 0 ? totalValue - totalCostBasis : 0,
    shortTermGains,
    longTermGains,
    lastUpdated: new Date().toISOString(),
  };
}

export const BROKER_LABELS: Record<BrokerId, string> = {
  vanguard: 'Vanguard',
  fidelity: 'Fidelity',
  robinhood: 'Robinhood',
  'navy-federal': 'Navy Federal',
  chase: 'Chase',
  altoira: 'Alto IRA',
  other: 'Other',
};
