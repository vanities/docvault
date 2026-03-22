// =============================================================================
// Brokerage Portfolio Tracking
// =============================================================================
// Two modes:
// 1. SnapTrade integration — connect real brokerage accounts (Vanguard, Fidelity,
//    Robinhood, Chase, Navy Federal, etc.) via SnapTrade API. Free tier: 5 connections.
// 2. Manual holdings — enter ticker + shares, prices fetched via Yahoo Finance.

import { Snaptrade } from 'snaptrade-typescript-sdk';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type BrokerId = 'vanguard' | 'fidelity' | 'robinhood' | 'navy-federal' | 'chase';

export interface BrokerHolding {
  ticker: string;
  shares: number;
  costBasis?: number;
  purchaseDate?: string; // ISO date for short/long-term gain classification
  label?: string;
}

export interface BrokerAccount {
  id: string;
  broker: BrokerId;
  name: string;
  holdings: BrokerHolding[];
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
    const error = err as { status?: number; body?: { code?: string } };
    if (error.status === 409 || error.body?.code === 'USER_ALREADY_EXISTS') {
      // User exists, we need the userSecret from settings
      if (config.userSecret) {
        return { userId, userSecret: config.userSecret };
      }
      throw new Error(
        'SnapTrade user already exists but userSecret not found. Delete and re-register.'
      );
    }
    throw err;
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
    });
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
        const close = data.spark?.result?.[0]?.response?.[0]?.meta?.regularMarketPrice;
        if (close) prices[ticker] = close;
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
    for (const holding of account.holdings) {
      allTickers.add(holding.ticker.toUpperCase());
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
    const enrichedHoldings = account.holdings.map((h) => {
      const price = prices[h.ticker.toUpperCase()] || 0;
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
};
